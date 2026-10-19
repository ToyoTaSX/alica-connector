import * as lampa from '../lampa'
import { chooseFile } from './episode'
import { describe, findCard } from './find'
import type { Pick } from './match'
import { chooseTorrent, quality } from './quality'
import { lastRecommended } from './recommend'
import type { Action } from './registry'

export const timing = {
  // Запас сверх таймаута парсера: сам экран ещё строит список и фильтры.
  extraWaitMs: 8000,
  // TorrServer грузит метаданные раздачи; Lampa сама ждёт до 90 секунд.
  filesWaitMs: 90000,
}

/** Список «Файлы» раздачи: запускает нужную серию (или единственный файл) сразу. */
async function pressFile(files: Promise<lampa.RenderedFile[]>): Promise<void> {
  const list = await files
  const index = chooseFile(
    list.map((f) => ({
      season: f.element.season,
      episode: f.element.episode,
      percent: Number(f.element.timeline?.percent) || 0,
    })),
  )
  if (index === null) return
  const file = list[index]
  if (list.length > 1 && file.element.episode) {
    const season = file.element.season ? `сезон ${file.element.season}, ` : ''
    lampa.noty(`Алиса: ${season}серия ${file.element.episode}`)
  }
  lampa.pressTorrent(file)
}

export const play: Action = {
  name: 'play',
  async run(params) {
    // {recommended: true} - «давай» после «посоветуй»: последняя рекомендация.
    const recommended = params.recommended === true
    const query = String(params.query || '').trim()
    if (!query && !recommended) return { ok: false, error: 'bad_params' }
    if (!lampa.torrentsEnabled()) {
      lampa.noty('Алиса: торренты в Lampa выключены')
      return { ok: false, error: 'torrents_disabled' }
    }
    if (!lampa.canStartTorrent()) {
      lampa.noty('Алиса: не указан TorrServer в настройках Lampa')
      return { ok: false, error: 'no_torrserver' }
    }

    const pick: Pick | null = recommended ? lastRecommended() : await findCard(query)
    if (!pick) {
      lampa.noty(recommended ? 'Алиса: нечего запускать' : `Алиса: не нашла «${query}»`)
      return { ok: false, error: recommended ? 'nothing_recommended' : 'not_found' }
    }
    const movie = lampa.toMovie(pick.item)
    const info = { title: pick.title, year: pick.year, id: pick.item.id }
    const wait = lampa.parserTimeout() + timing.extraWaitMs

    // Штатный экран торрентов: поиск, сортировка и фильтр - как настроено в Lampa.
    lampa.noty(`Алиса: ищу раздачу для ${describe(pick)}`)
    let list = await lampa.waitTorrentList(() => lampa.openTorrents(movie), wait)
    if (!list.length) {
      // Парсер (jac.red) иногда не успевает с первого раза, повтор обычно быстрый.
      lampa.noty('Алиса: парсер не ответил, пробую ещё раз')
      list = await lampa.waitTorrentList(() => lampa.reloadActivity(), wait)
    }

    const choice = chooseTorrent(list, lampa.viewedTorrents())
    if (!choice) {
      lampa.noty(`Алиса: нет раздач для ${describe(pick)}`)
      return { ok: false, error: 'no_torrents', data: info }
    }

    const element = choice.rendered.element
    // Слушаем список файлов до нажатия: он может появиться почти сразу.
    const files = lampa.waitTorrentFiles(timing.filesWaitMs)
    lampa.pressTorrent(choice.rendered)
    pressFile(files).catch((e) => console.error('AlicaConnector', 'file', e))
    lampa.noty(`Алиса: ${choice.last ? 'продолжаю' : 'запускаю'} ${element.Title}`.slice(0, 160))
    return {
      ok: true,
      data: {
        ...info,
        choice: choice.last ? 'last' : 'top',
        quality: quality(element.Title),
        seeds: Number(element.Seeders) || 0,
        tracker: element.Tracker,
        torrent: element.Title,
      },
    }
  },
}
