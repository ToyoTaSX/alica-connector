// Выбор раздачи на экране торрентов для «запусти фильм».

import type { RenderedTorrent } from '../lampa'

/** «2160p», «1080p», «720p»... из названия раздачи; undefined - не указано. */
export function quality(title: string): string | undefined {
  const t = title.toLowerCase()
  if (/\b(2160p|4k|uhd)\b/.test(t)) return '2160p'
  const m = t.match(/\b(\d{3,4})[pi]\b/)
  return m ? `${m[1]}p` : undefined
}

export interface Choice {
  rendered: RenderedTorrent
  /** true - раздача, которую запускали последней; false - верхняя в списке. */
  last: boolean
}

/**
 * Последняя запущенная раздача (по порядку хэшей в torrents_view), иначе верхняя.
 * Порядок и фильтр списка - те, что выбраны на экране торрентов в Lampa.
 */
export function chooseTorrent(list: RenderedTorrent[], viewed: string[]): Choice | null {
  let best: RenderedTorrent | null = null
  let bestIndex = -1
  for (const rendered of list) {
    const hash = rendered.element.hash
    const index = typeof hash === 'string' ? viewed.lastIndexOf(hash) : -1
    if (index > bestIndex) {
      best = rendered
      bestIndex = index
    }
  }
  if (best) return { rendered: best, last: true }
  return list.length ? { rendered: list[0], last: false } : null
}
