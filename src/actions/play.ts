import * as lampa from '../lampa'
import { describe, findCard } from './find'
import { chooseTorrent } from './quality'
import type { Action } from './registry'

export const play: Action = {
  name: 'play',
  async run(params) {
    const query = String(params.query || '').trim()
    if (!query) return { ok: false, error: 'bad_params' }
    if (!lampa.torrentsEnabled()) {
      lampa.noty('Алиса: торренты в Lampa выключены')
      return { ok: false, error: 'torrents_disabled' }
    }
    if (!lampa.canStartTorrent()) {
      lampa.noty('Алиса: не указан TorrServer в настройках Lampa')
      return { ok: false, error: 'no_torrserver' }
    }

    const pick = await findCard(query)
    if (!pick) {
      lampa.noty(`Алиса: не нашла «${query}»`)
      return { ok: false, error: 'not_found' }
    }
    const movie = lampa.toMovie(pick.item)
    const info = { title: pick.title, year: pick.year, id: pick.item.id }

    lampa.openFull(pick.item)
    lampa.noty(`Алиса: ищу раздачу для ${describe(pick)}`)

    let items
    try {
      items = await lampa.findTorrents(movie)
    } catch (e) {
      // Парсер не настроен или не ответил: показываем штатный экран с его ошибкой.
      console.error('AlicaConnector', 'parser', e)
      lampa.openTorrents(movie)
      return { ok: true, data: { ...info, fallback: 'torrents' } }
    }

    if (!items.length) {
      lampa.noty(`Алиса: нет раздач для ${describe(pick)}`)
      return { ok: false, error: 'no_torrents', data: info }
    }

    const choice = chooseTorrent(items, { year: pick.year })
    if (!choice) {
      lampa.noty(`Алиса: нет раздач 1080p и выше для ${describe(pick)}`)
      return { ok: false, error: 'no_quality', data: info }
    }

    lampa.startTorrent(choice.item, movie)
    lampa.noty(`Алиса: ${choice.quality}, ${choice.seeds} сидов`)
    return {
      ok: true,
      data: {
        ...info,
        quality: choice.quality,
        seeds: choice.seeds,
        tracker: choice.item.Tracker,
        torrent: choice.item.Title,
      },
    }
  },
}
