// Выбор фильма из результатов поиска TMDB по фразе пользователя.

import type { TmdbItem } from '../lampa'

export type Method = 'movie' | 'tv'

export interface Pick {
  item: TmdbItem
  method: Method
  title: string
  year?: number
}

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    // без \p{L}: Unicode property escapes появились только в Chrome 64
    .replace(/[^a-z0-9а-я\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** «дюна 2021» -> { title: «дюна», year: 2021 }. */
export function splitYear(query: string): { title: string; year?: number } {
  const m = query.trim().match(/^(.+?)\s+((?:19|20)\d{2})(?:\s+года?)?$/)
  return m ? { title: m[1], year: Number(m[2]) } : { title: query.trim() }
}

function itemYear(item: TmdbItem): number | undefined {
  const date = item.release_date || item.first_air_date || ''
  const year = parseInt(date.slice(0, 4), 10)
  return Number.isFinite(year) && year > 0 ? year : undefined
}

function score(item: TmdbItem, method: Method, index: number, title: string, year?: number) {
  const titles = [item.title, item.name, item.original_title, item.original_name]
    .filter((t): t is string => typeof t === 'string')
    .map(normalize)
  let s = 0
  if (titles.includes(title)) s += 100
  else if (titles.some((t) => t.startsWith(title))) s += 30
  const y = itemYear(item)
  if (year !== undefined && y !== undefined) s += y === year ? 60 : -Math.min(30, Math.abs(y - year) * 3)
  if (method === 'movie') s += 5 // просили «фильм»: при равенстве - фильм, а не сериал
  s += Math.max(0, 20 - index * 2) // порядок релевантности TMDB
  // Известность важнее типа: «во все тяжкие» - сериал Breaking Bad (19k голосов),
  // а не одноимённый фильм с 33 голосами.
  s += Math.min(35, Math.log10((item.vote_count || 0) + 1) * 8)
  return s
}

export function pickBest(
  results: { movie: TmdbItem[]; tv: TmdbItem[] },
  query: string,
): Pick | null {
  const { title: rawTitle, year } = splitYear(query)
  const title = normalize(rawTitle)
  let best: Pick | null = null
  let bestScore = -Infinity

  for (const method of ['movie', 'tv'] as const) {
    const items = results[method]
    for (let index = 0; index < items.length; index++) {
      const item = items[index]
      if (!item || typeof item.id !== 'number') continue
      const s = score(item, method, index, title, year)
      if (s > bestScore) {
        bestScore = s
        best = { item, method, title: item.title || item.name || rawTitle, year: itemYear(item) }
      }
    }
  }
  return best
}
