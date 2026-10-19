import { beforeEach, describe, expect, it } from 'vitest'
import { runAction } from '../src/actions'
import { genreNames } from '../src/actions/genres'
import { buildPool, lastRecommended } from '../src/actions/recommend'
import { choose, kindOf, mergeCandidates, profile, rating, seedsFrom, suitable } from '../src/actions/taste'
import type { LampaGlobal, TmdbItem } from '../src/lampa/types'

const g = globalThis as unknown as { window: { Lampa?: LampaGlobal } }
g.window = g.window || (globalThis as never)

const movie = (id: number, extra: Partial<TmdbItem> = {}): TmdbItem => ({
  id,
  title: `Фильм ${id}`,
  original_title: `Movie ${id}`,
  release_date: '2015-01-01',
  vote_count: 2000,
  vote_average: 7.5,
  genre_ids: [878],
  poster_path: `/p${id}.jpg`,
  ...extra,
})
const tv = (id: number, extra: Partial<TmdbItem> = {}): TmdbItem => ({
  id,
  name: `Сериал ${id}`,
  original_name: `Show ${id}`,
  first_air_date: '2018-01-01',
  vote_count: 2000,
  vote_average: 8,
  genre_ids: [18],
  poster_path: `/t${id}.jpg`,
  ...extra,
})

describe('taste', () => {
  it('kindOf', () => {
    expect(kindOf(movie(1))).toBe('movie')
    expect(kindOf(tv(1))).toBe('tv')
  })

  it('затравки: свежие и лайкнутые весят больше, без повторов', () => {
    const seeds = seedsFrom({ history: [movie(1), movie(2), movie(3)], like: [movie(3)], book: [movie(1)] })
    expect(seeds.map((s) => s.card.id)).toEqual([3, 1, 2])
    expect(seeds[1].weight).toBe(1)
  })

  it('рейтинг сглажен числом голосов', () => {
    expect(rating(movie(1, { vote_average: 9.5, vote_count: 10 }))).toBeLessThan(rating(movie(2, { vote_average: 8, vote_count: 5000 })))
  })

  it('совпадение в рекомендациях нескольких затравок поднимает кандидата', () => {
    const seeds = seedsFrom({ history: [movie(1), movie(2)], like: [], book: [] })
    const merged = mergeCandidates([
      { seed: seeds[0], items: [movie(10), movie(11)] },
      { seed: seeds[1], items: [movie(11), movie(12)] },
    ])
    expect(merged.find((c) => c.card.id === 11)?.hits).toBeCloseTo(1.9)
    // При random = 0 выбирается лучший.
    expect(choose(merged, profile(merged), () => 0)?.card.id).toBe(11)
  })

  it('профиль жанров влияет на выбор', () => {
    const seeds = seedsFrom({ history: [movie(1), movie(2)], like: [], book: [] })
    const merged = mergeCandidates([
      { seed: seeds[0], items: [movie(10, { genre_ids: [27] }), movie(11, { genre_ids: [35] }), movie(12, { genre_ids: [35] })] },
      { seed: seeds[1], items: [movie(13, { genre_ids: [35] })] },
    ])
    const taste = profile(merged)
    expect(taste[35]).toBeGreaterThan(taste[27])
    // 10 и 11 рекомендованы одной затравкой, но комедия ближе к вкусу.
    const pair = merged.filter((c) => c.card.id === 10 || c.card.id === 11)
    expect(choose(pair, taste, () => 0)?.card.id).toBe(11)
  })

  it('фильтр: тип, жанр, просмотренное, малоизвестное, без постера', () => {
    const c = (card: TmdbItem) => ({ card, kind: kindOf(card), hits: 1 })
    const f = { exclude: { 'movie:2': true } }
    expect(suitable(c(movie(1)), f)).toBe(true)
    expect(suitable(c(movie(2)), f)).toBe(false)
    expect(suitable(c(movie(3, { vote_count: 10 })), f)).toBe(false)
    expect(suitable(c(movie(4, { poster_path: undefined })), f)).toBe(false)
    expect(suitable(c(movie(1)), { ...f, kind: 'tv' })).toBe(false)
    expect(suitable(c(movie(1)), { ...f, genres: { movie: [35], tv: [35] } })).toBe(false)
    expect(suitable(c(movie(1)), { ...f, genres: { movie: [878], tv: [10765] } })).toBe(true)
  })

  it('жанры по-русски', () => {
    expect(genreNames([878, 10765, 18, 35])).toEqual(['фантастика', 'драма'])
  })
})

describe('recommend', () => {
  let store: Record<string, unknown>
  let routed: Record<string, unknown>[]
  let requests: string[]
  let fav: Record<string, TmdbItem[]>
  let tmdb: (method: string) => TmdbItem[] | null

  beforeEach(() => {
    store = {}
    routed = []
    requests = []
    fav = { history: [movie(1), tv(2)], like: [], book: [], wath: [], viewed: [], thrown: [] }
    tmdb = (method) => {
      if (method === 'movie/1/recommendations') return [movie(1), movie(10), movie(11, { genre_ids: [35] }), movie(12), movie(13), movie(14)]
      if (method === 'tv/2/recommendations') return [tv(20), tv(21)]
      if (method.indexOf('discover/') === 0) return [movie(30, { genre_ids: [12, 27] }), movie(31, { genre_ids: [12, 27] })]
      if (method === 'trending/tv/week') return [tv(40)]
      return null
    }
    g.window.Lampa = {
      Storage: { get: (k, e) => (k in store ? store[k] : e), set: (k, v) => (store[k] = JSON.parse(JSON.stringify(v))) },
      Favorite: { get: ({ type }) => fav[type] || [] },
      Api: {
        search: () => {},
        sources: {
          tmdb: {
            get: (method, _params, ok, err) => {
              requests.push(method)
              const r = tmdb(method)
              setTimeout(() => (r ? ok({ results: r }) : err?.()), 0)
            },
          },
        },
      },
      Router: { call: (name, data) => routed.push({ name, ...data }) },
      Noty: { show: () => {} },
    }
  })

  it('пул из рекомендаций затравок, без уже просмотренного', async () => {
    await buildPool()
    expect(requests).toEqual(['movie/1/recommendations', 'tv/2/recommendations'])
    const r = await runAction('recommend', { kind: 'movie' })
    expect(r.ok).toBe(true)
    expect([10, 11, 12, 13, 14]).toContain(r.data?.id)
    expect(r.data).toMatchObject({ method: 'movie', personal: true })
    expect(routed[0]).toMatchObject({ name: 'full', id: r.data?.id })
  })

  it('«ещё» не повторяет уже советованное', async () => {
    await buildPool()
    const first = await runAction('recommend', { kind: 'movie' })
    const second = await runAction('recommend', { kind: 'movie' })
    expect(second.data?.id).not.toBe(first.data?.id)
    expect(lastRecommended()?.item.id).toBe(second.data?.id)
  })

  it('сериал из пула', async () => {
    await buildPool()
    const r = await runAction('recommend', { kind: 'tv' })
    expect([20, 21, 40]).toContain(r.data?.id)
    expect(lastRecommended()).toMatchObject({ method: 'tv' })
  })

  it('жанра нет в пуле -> популярное по жанру из TMDB', async () => {
    await buildPool()
    const r = await runAction('recommend', { kind: 'movie', genre: 'horror' })
    expect([30, 31]).toContain(r.data?.id)
    expect(requests).toContain('discover/movie')
    expect(r.data).toMatchObject({ genres: ['ужасы', 'приключения'] })
  })

  it('без истории -> тренды', async () => {
    fav.history = []
    const r = await runAction('recommend', { kind: 'tv' })
    expect(r).toMatchObject({ ok: true, data: { id: 40, personal: false } })
  })

  it('нечего советовать', async () => {
    fav.history = []
    tmdb = () => null
    expect(await runAction('recommend', {})).toEqual({ ok: false, error: 'no_recommendations' })
  })
})
