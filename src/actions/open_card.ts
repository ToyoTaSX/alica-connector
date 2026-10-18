import * as lampa from '../lampa'
import { describe, findCard } from './find'
import type { Action } from './registry'

export const openCard: Action = {
  name: 'open_card',
  async run(params) {
    const query = String(params.query || '').trim()
    if (!query) return { ok: false, error: 'bad_params' }

    const pick = await findCard(query)
    if (!pick) {
      lampa.noty(`Алиса: не нашла «${query}»`)
      return { ok: false, error: 'not_found' }
    }

    lampa.openFull(pick.item)
    lampa.noty(`Алиса: ${describe(pick)}`)
    return {
      ok: true,
      data: { title: pick.title, year: pick.year, id: pick.item.id, method: pick.method },
    }
  },
}
