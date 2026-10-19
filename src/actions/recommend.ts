// Действие recommend: советует фильм или сериал по истории просмотров и открывает карточку.
//
// Рекомендации TMDB для каждой затравки - это десяток запросов, а сервер ждёт
// ответ 2 секунды. Поэтому пул кандидатов собирается заранее, в фоне (после
// старта и после пополнения истории), а команда берёт готовое из Lampa.Storage.

import * as lampa from '../lampa'
import type { TmdbItem } from '../lampa'
import type { Pick } from './match'
import { GENRES, genreNames, type Kind } from './genres'
import type { Action } from './registry'
import {
  type Candidate,
  cardKey,
  choose,
  mergeCandidates,
  profile,
  type Seed,
  seedsFrom,
  suitable,
} from './taste'

const POOL_KEY = 'alica_rec_pool'
const RECENT_KEY = 'alica_rec_recent'
const LAST_KEY = 'alica_rec_last'

export const timing = {
  // Живой запрос (жанр, которого нет в пуле): должен уложиться в ожидание сервера.
  liveMs: 1500,
  poolMaxAgeMs: 12 * 3600 * 1000,
  startDelayMs: 30 * 1000,
  rebuildDelayMs: 60 * 1000,
}

const POOL_MAX = 200
const RECENT_DAYS = 14
const RECENT_MAX = 100
// Из пула, если подходящих меньше, добираем живым запросом.
const ENOUGH = 5

interface Pool {
  built: number
  seeds: string
  items: Candidate[]
}

interface Recent {
  key: string
  at: number
}

// Поля, нужные карточке и алгоритму; остальное не храним, чтобы не раздувать Storage.
const FIELDS = [
  'id',
  'title',
  'name',
  'original_title',
  'original_name',
  'original_language',
  'release_date',
  'first_air_date',
  'genre_ids',
  'vote_average',
  'vote_count',
  'popularity',
  'poster_path',
  'backdrop_path',
]

function slim(card: TmdbItem): TmdbItem {
  const out: Record<string, unknown> = {}
  for (const f of FIELDS) if (card[f] !== undefined && card[f] !== null) out[f] = card[f]
  return out as TmdbItem
}

function currentSeeds(): Seed[] {
  return seedsFrom({
    history: lampa.favorites('history'),
    like: lampa.favorites('like'),
    book: lampa.favorites('book').concat(lampa.favorites('wath')),
  })
}

function signature(seeds: Seed[]): string {
  return seeds.map((s) => cardKey(s.card, s.kind)).join(',')
}

/** Уже смотрели, бросили или лайкнули (лайк ставят просмотренному). */
function watchedKeys(): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const type of ['history', 'viewed', 'thrown', 'like']) {
    for (const card of lampa.favorites(type)) out[cardKey(card)] = true
  }
  return out
}

function recentList(now: number): Recent[] {
  const border = now - RECENT_DAYS * 24 * 3600 * 1000
  return lampa
    .storageJson<Recent[]>(RECENT_KEY, [])
    .filter((r) => r && typeof r.key === 'string' && r.at > border)
}

function remember(c: Candidate, now: number): void {
  const recent = recentList(now).filter((r) => r.key !== cardKey(c.card, c.kind))
  recent.unshift({ key: cardKey(c.card, c.kind), at: now })
  lampa.storageSetJson(RECENT_KEY, recent.slice(0, RECENT_MAX))
  lampa.storageSetJson(LAST_KEY, { card: c.card, kind: c.kind })
}

/** Последняя рекомендация: её запускает «давай» после «посоветуй». */
export function lastRecommended(): Pick | null {
  const last = lampa.storageJson<{ card?: TmdbItem; kind?: Kind } | null>(LAST_KEY, null)
  if (!last || !last.card || typeof last.card.id !== 'number') return null
  const card = last.card
  const year = parseInt(String(card.release_date || card.first_air_date || '').slice(0, 4), 10)
  return {
    item: card,
    method: last.kind === 'tv' ? 'tv' : 'movie',
    title: String(card.title || card.name || ''),
    year: year > 0 ? year : undefined,
  }
}

let building: Promise<Pool> | null = null

/** Собирает пул: рекомендации TMDB для каждой затравки, последовательно, в фоне. */
export function buildPool(): Promise<Pool> {
  if (building) return building
  building = (async () => {
    const seeds = currentSeeds()
    const groups: { seed: Seed; items: TmdbItem[] }[] = []
    for (const seed of seeds) {
      try {
        const items = await lampa.tmdb(`${seed.kind}/${seed.card.id}/recommendations`)
        groups.push({ seed, items })
      } catch (e) {
        console.warn('AlicaConnector', 'recommendations', seed.card.id, e)
      }
    }
    const items = mergeCandidates(groups)
      .sort((a, b) => b.hits - a.hits)
      .slice(0, POOL_MAX)
      .map((c) => ({ ...c, card: slim(c.card) }))
    const pool: Pool = { built: Date.now(), seeds: signature(seeds), items }
    // Если TMDB не ответил ни на одну затравку, старый пул лучше пустого.
    if (items.length || !seeds.length) lampa.storageSetJson(POOL_KEY, pool)
    return pool
  })()
  const done = (): void => {
    building = null
  }
  building.then(done, done)
  return building
}

function loadPool(): Pool {
  const pool = lampa.storageJson<Pool | null>(POOL_KEY, null)
  return pool && Array.isArray(pool.items) ? pool : { built: 0, seeds: '', items: [] }
}

function poolStale(): boolean {
  const pool = loadPool()
  return Date.now() - pool.built > timing.poolMaxAgeMs || pool.seeds !== signature(currentSeeds())
}

function rebuildInBackground(): void {
  buildPool().catch((e) => console.error('AlicaConnector', 'pool', e))
}

/** Фоновая сборка пула: после старта, после пополнения истории и раз в 12 часов. */
export function initRecommendations(): void {
  setTimeout(() => {
    if (poolStale()) rebuildInBackground()
  }, timing.startDelayMs)
  setInterval(() => {
    if (poolStale()) rebuildInBackground()
  }, timing.poolMaxAgeMs / 2)

  let timer: ReturnType<typeof setTimeout> | undefined
  lampa.onFavoriteAdd((where) => {
    if (where !== 'history' && where !== 'like' && where !== 'book' && where !== 'wath') return
    if (timer) clearTimeout(timer)
    timer = setTimeout(rebuildInBackground, timing.rebuildDelayMs)
  })
}

/** Популярное по жанру или в тренде: когда истории мало или жанра нет в пуле. */
async function live(kind: Kind, genre: string | undefined, seeds: Seed[]): Promise<Candidate[]> {
  const page = 1 + Math.floor(Math.random() * 3)
  const ids = genre ? GENRES[genre][kind] : []
  if (genre && !ids.length) return []
  const items = genre
    ? await lampa.tmdb(
        `discover/${kind}`,
        {
          genres: ids.join('|'),
          sort_by: 'popularity.desc',
          filter: { 'vote_count.gte': 300 },
          page,
        },
        timing.liveMs,
      )
    : await lampa.tmdb(`trending/${kind}/week`, { page }, timing.liveMs)
  // Чуть-чуть hits, чтобы вкус пользователя всё же влиял через затравки.
  const weight = seeds.length ? 0.2 : 0
  return items.map((card) => ({ card: slim(card), kind, hits: weight }))
}

/** Запрошенный жанр - первым в ответе («комедия», а не «приключения»). */
function wantedFirst(ids: number[], wanted: number[]): number[] {
  return ids.filter((id) => wanted.indexOf(id) >= 0).concat(ids.filter((id) => wanted.indexOf(id) < 0))
}

export const recommend: Action = {
  name: 'recommend',
  async run(params) {
    const kind = params.kind === 'tv' || params.kind === 'movie' ? (params.kind as Kind) : undefined
    const genre = typeof params.genre === 'string' && GENRES[params.genre] ? params.genre : undefined
    const now = Date.now()

    const seeds = currentSeeds()
    const watched = watchedKeys()
    const exclude: Record<string, boolean> = { ...watched }
    for (const r of recentList(now)) exclude[r.key] = true
    const filter = { kind, genres: genre ? GENRES[genre] : undefined, exclude }

    const pool = loadPool()
    if (!pool.items.length || poolStale()) rebuildInBackground()
    const taste = profile(pool.items)

    let candidates = pool.items.filter((c) => suitable(c, filter))
    if (candidates.length < ENOUGH) {
      try {
        const extra = await live(kind || 'movie', genre, seeds)
        const seen: Record<string, boolean> = {}
        for (const c of candidates) seen[cardKey(c.card, c.kind)] = true
        candidates = candidates.concat(
          extra.filter((c) => !seen[cardKey(c.card, c.kind)] && suitable(c, filter)),
        )
      } catch (e) {
        console.warn('AlicaConnector', 'recommend live', e)
      }
    }
    // Всё подходящее уже советовали: повторяем старое, но не просмотренное.
    if (!candidates.length) {
      candidates = pool.items.filter((c) => suitable(c, { ...filter, exclude: watched }))
    }

    const pick = choose(candidates, taste)
    if (!pick) {
      lampa.noty('Алиса: не нашла, что посоветовать')
      return { ok: false, error: 'no_recommendations' }
    }
    remember(pick, now)

    const card = pick.card
    const title = String(card.title || card.name || '')
    const year = parseInt(String(card.release_date || card.first_air_date || '').slice(0, 4), 10)
    lampa.openFull(card)
    lampa.noty(`Алиса: советую ${title}${year > 0 ? ` (${year})` : ''}`)
    return {
      ok: true,
      data: {
        title,
        year: year > 0 ? year : undefined,
        id: card.id,
        method: pick.kind,
        genres: genreNames(wantedFirst(card.genre_ids || [], genre ? GENRES[genre][pick.kind] : [])),
        rating: Math.round((Number(card.vote_average) || 0) * 10) / 10,
        personal: pick.hits >= 0.5,
      },
    }
  },
}
