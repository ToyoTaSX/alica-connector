// Подбор рекомендации: затравки из истории, профиль жанров, оценка кандидатов.
// Чистые функции без Lampa, чтобы алгоритм было удобно тестировать.

import type { TmdbItem } from '../lampa'
import type { Kind } from './genres'

export interface Seed {
  card: TmdbItem
  kind: Kind
  weight: number
}

/** Кандидат из рекомендаций TMDB; hits - сумма весов затравок, которые его рекомендовали. */
export interface Candidate {
  card: TmdbItem
  kind: Kind
  hits: number
}

export interface Lists {
  history: TmdbItem[]
  like: TmdbItem[]
  book: TmdbItem[]
}

export const SEEDS_MAX = 12
// Байесовское сглаживание рейтинга: фильм с 9.0 и 12 голосами не должен побеждать.
const PRIOR_VOTES = 300
const PRIOR_RATING = 6.5
const MIN_VOTES = 50
const TOP = 8

export function kindOf(card: TmdbItem): Kind {
  return card.name !== undefined ||
    card.original_name !== undefined ||
    card.first_air_date !== undefined ||
    Boolean(card.number_of_seasons)
    ? 'tv'
    : 'movie'
}

export function cardKey(card: TmdbItem, kind: Kind = kindOf(card)): string {
  return `${kind}:${card.id}`
}

export function genreIds(card: TmdbItem): number[] {
  if (Array.isArray(card.genre_ids)) return card.genre_ids
  if (Array.isArray(card.genres)) {
    return (card.genres as { id?: number }[]).map((g) => Number(g.id)).filter((id) => id > 0)
  }
  return []
}

/**
 * Затравки: что смотрели недавно (история пополняется при запуске раздачи), что
 * лайкнули и отложили в закладки. Свежие и лайкнутые весят больше.
 */
export function seedsFrom(lists: Lists): Seed[] {
  const seeds: Record<string, Seed> = {}
  const order: string[] = []
  const add = (card: TmdbItem, weight: number): void => {
    if (!card || typeof card.id !== 'number') return
    const kind = kindOf(card)
    const key = cardKey(card, kind)
    const seed = seeds[key]
    if (seed) {
      seed.weight = Math.max(seed.weight, weight)
    } else {
      seeds[key] = { card, kind, weight }
      order.push(key)
    }
  }
  const liked: Record<string, boolean> = {}
  for (const card of lists.like) liked[cardKey(card)] = true

  lists.history.slice(0, 8).forEach((card, i) => {
    const recency = Math.max(0.3, 1 - i * 0.1)
    add(card, recency * (liked[cardKey(card)] ? 1.5 : 1))
  })
  lists.like.slice(0, 4).forEach((card) => add(card, 1.2))
  lists.book.slice(0, 3).forEach((card) => add(card, 0.7))

  return order
    .map((key) => seeds[key])
    .sort((a, b) => b.weight - a.weight)
    .slice(0, SEEDS_MAX)
}

/**
 * Доля каждого жанра во вкусе, сумма = 1. Считается по рекомендациям с весом
 * hits: в истории Lampa хранит карточку без genre_ids, а рекомендации к
 * просмотренному повторяют его жанры.
 */
export function profile(candidates: Candidate[]): Record<number, number> {
  const out: Record<number, number> = {}
  let total = 0
  for (const c of candidates) {
    for (const id of genreIds(c.card)) {
      out[id] = (out[id] || 0) + c.hits
      total += c.hits
    }
  }
  if (total > 0) for (const id in out) out[id] /= total
  return out
}

/** Сливает рекомендации затравок: фильм из рекомендаций нескольких затравок набирает hits. */
export function mergeCandidates(groups: { seed: Seed; items: TmdbItem[] }[]): Candidate[] {
  const byKey: Record<string, Candidate> = {}
  const order: string[] = []
  for (const { seed, items } of groups) {
    for (const card of items) {
      if (!card || typeof card.id !== 'number') continue
      // Рекомендации к фильму - фильмы, к сериалу - сериалы.
      const kind = seed.kind
      const key = cardKey(card, kind)
      const found = byKey[key]
      if (found) {
        found.hits += seed.weight
      } else {
        byKey[key] = { card, kind, hits: seed.weight }
        order.push(key)
      }
    }
  }
  return order.map((key) => byKey[key])
}

export function rating(card: TmdbItem): number {
  const v = Number(card.vote_count) || 0
  const r = Number(card.vote_average) || 0
  return (v * r + PRIOR_VOTES * PRIOR_RATING) / (v + PRIOR_VOTES)
}

export function score(c: Candidate, taste: Record<number, number>): number {
  const votes = Number(c.card.vote_count) || 0
  const ids = genreIds(c.card)
  let affinity = 0
  for (const id of ids) affinity += taste[id] || 0
  let s = c.hits * 10
  s += (rating(c.card) - PRIOR_RATING) * 10
  s += Math.min(10, Math.log10(votes + 1) * 3)
  s += Math.min(1, affinity) * 15
  return s
}

export interface Filter {
  kind?: Kind
  genres?: Record<Kind, number[]>
  exclude: Record<string, boolean>
}

export function suitable(c: Candidate, f: Filter): boolean {
  if (f.kind && c.kind !== f.kind) return false
  if (f.exclude[cardKey(c.card, c.kind)]) return false
  if ((Number(c.card.vote_count) || 0) < MIN_VOTES) return false
  if (!c.card.poster_path) return false
  if (f.genres) {
    const wanted = f.genres[c.kind]
    if (!wanted.length) return false
    const ids = genreIds(c.card)
    if (!wanted.some((id) => ids.indexOf(id) >= 0)) return false
  }
  return true
}

/**
 * Случайный из лучших по оценке, с весами: «ещё» каждый раз даёт новое,
 * но не проваливается в слабые варианты.
 */
export function choose(
  candidates: Candidate[],
  taste: Record<number, number>,
  random: () => number = Math.random,
): Candidate | null {
  if (!candidates.length) return null
  const ranked = candidates
    .map((c) => ({ c, s: score(c, taste) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, TOP)
  const floor = ranked[ranked.length - 1].s
  const weights = ranked.map((r) => r.s - floor + 3)
  let x = random() * weights.reduce((a, b) => a + b, 0)
  for (let i = 0; i < ranked.length; i++) {
    x -= weights[i]
    if (x < 0) return ranked[i].c
  }
  return ranked[0].c
}
