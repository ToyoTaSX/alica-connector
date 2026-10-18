import * as lampa from '../lampa'
import { describe, findCard } from './find'
import type { Action } from './registry'

export const torrents: Action = {
  name: 'torrents',
  async run(params) {
    const query = String(params.query || '').trim()
    if (!query) return { ok: false, error: 'bad_params' }
    if (!lampa.torrentsEnabled()) {
      lampa.noty('Алиса: торренты в Lampa выключены')
      return { ok: false, error: 'torrents_disabled' }
    }

    const pick = await findCard(query)
    if (!pick) {
      lampa.noty(`Алиса: не нашла «${query}»`)
      return { ok: false, error: 'not_found' }
    }

    // Поиск раздач делает сам экран торрентов парсером из настроек Lampa.
    lampa.openTorrents(lampa.toMovie(pick.item))
    lampa.noty(`Алиса: торренты для ${describe(pick)}`)
    return { ok: true, data: { title: pick.title, year: pick.year, id: pick.item.id } }
  },
}
