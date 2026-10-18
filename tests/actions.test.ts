import { beforeEach, describe, expect, it, vi } from 'vitest'
import { actionNames, runAction } from '../src/actions'
import { normalize, pickBest, splitYear } from '../src/actions/match'
import type { LampaGlobal, TmdbItem } from '../src/lampa/types'
import { normalizeServerUrl } from '../src/protocol'

const g = globalThis as unknown as { window: { Lampa?: LampaGlobal; appready?: boolean } }
g.window = g.window || (globalThis as never)

const dune2021: TmdbItem = { id: 438631, title: 'Дюна', original_title: 'Dune', release_date: '2021-09-15', vote_count: 12000 }
const dune1984: TmdbItem = { id: 841, title: 'Дюна', original_title: 'Dune', release_date: '1984-12-14', vote_count: 3000 }
const dune2: TmdbItem = { id: 693134, title: 'Дюна: Часть вторая', original_title: 'Dune: Part Two', release_date: '2024-02-27', vote_count: 6000 }
const duneTv: TmdbItem = { id: 90228, name: 'Дюна: Пророчество', original_name: 'Dune: Prophecy', first_air_date: '2024-11-17' }

describe('match', () => {
  it('normalize', () => {
    expect(normalize('  Ёлки-2!  ')).toBe('елки 2')
    expect(normalize('Dune: Part Two')).toBe('dune part two')
  })

  it('splitYear', () => {
    expect(splitYear('дюна 1984')).toEqual({ title: 'дюна', year: 1984 })
    expect(splitYear('дюна 2021 года')).toEqual({ title: 'дюна', year: 2021 })
    expect(splitYear('1917')).toEqual({ title: '1917' })
    expect(splitYear('бегущий по лезвию 2049')).toEqual({ title: 'бегущий по лезвию', year: 2049 })
  })

  it('точное название и порядок TMDB', () => {
    const r = pickBest({ movie: [dune2021, dune2, dune1984], tv: [duneTv] }, 'дюна')
    expect(r?.item.id).toBe(438631)
    expect(r).toMatchObject({ method: 'movie', title: 'Дюна', year: 2021 })
  })

  it('год из фразы', () => {
    expect(pickBest({ movie: [dune2021, dune2, dune1984], tv: [] }, 'дюна 1984')?.item.id).toBe(841)
  })

  it('оригинальное название', () => {
    expect(pickBest({ movie: [dune2021, dune2], tv: [] }, 'dune part two')?.item.id).toBe(693134)
  })

  it('сериал, если фильмов нет', () => {
    expect(pickBest({ movie: [], tv: [duneTv] }, 'дюна пророчество')).toMatchObject({ method: 'tv', title: 'Дюна: Пророчество' })
  })

  it('известный сериал важнее одноимённого малоизвестного фильма', () => {
    const film: TmdbItem = { id: 468469, title: 'Во все тяжкие', original_title: 'Kaalakaandi', release_date: '2018-01-12', vote_count: 33 }
    const elCamino: TmdbItem = { id: 559969, title: 'El Camino: фильм по мотивам сериала Во все тяжкие', release_date: '2019-10-11', vote_count: 5915 }
    const bb: TmdbItem = { id: 1396, name: 'Во все тяжкие', original_name: 'Breaking Bad', first_air_date: '2008-01-20', vote_count: 18871 }
    expect(pickBest({ movie: [film, elCamino], tv: [bb] }, 'во все тяжкие')).toMatchObject({ method: 'tv', item: { id: 1396 } })
  })

  it('фильм важнее одноимённого мини-сериала', () => {
    const duneMini: TmdbItem = { id: 2398, name: 'Дюна', original_name: 'Dune', first_air_date: '2000-12-03', vote_count: 700 }
    expect(pickBest({ movie: [dune2021, dune2, dune1984], tv: [duneMini] }, 'дюна')?.item.id).toBe(438631)
  })

  it('пусто', () => {
    expect(pickBest({ movie: [], tv: [] }, 'абв')).toBeNull()
  })
})

describe('normalizeServerUrl', () => {
  it.each([
    ['lampa.example.com', 'wss://lampa.example.com/ws'],
    ['https://lampa.example.com/', 'wss://lampa.example.com/ws'],
    ['ws://localhost:8000', 'ws://localhost:8000/ws'],
    ['wss://x.y/ws', 'wss://x.y/ws'],
    ['  ', ''],
  ])('%s', (input, out) => expect(normalizeServerUrl(input)).toBe(out))
})

describe('open_card', () => {
  let routed: Record<string, unknown>[]
  let notes: string[]
  let queries: string[]

  function fakeLampa(results: (q: string) => { movie?: TmdbItem[]; tv?: TmdbItem[] }): LampaGlobal {
    return {
      Api: {
        search: (params, cb) => {
          queries.push(params.query)
          const r = results(decodeURIComponent(params.query))
          setTimeout(() => cb({ movie: { results: r.movie || [] }, tv: { results: r.tv || [] } }), 0)
        },
      },
      Router: { call: (name, data) => routed.push({ name, ...data }) },
      Noty: { show: (t) => notes.push(t) },
    }
  }

  beforeEach(() => {
    routed = []
    notes = []
    queries = []
  })

  it('зарегистрирован', () => {
    expect(actionNames()).toContain('open_card')
  })

  it('находит и открывает карточку', async () => {
    g.window.Lampa = fakeLampa(() => ({ movie: [dune2021, dune1984] }))
    const r = await runAction('open_card', { query: 'дюна' })
    expect(r).toEqual({ ok: true, data: { title: 'Дюна', year: 2021, id: 438631, method: 'movie' } })
    expect(routed).toEqual([{ name: 'full', ...dune2021, source: 'tmdb' }])
    expect(queries).toEqual([encodeURIComponent('дюна')])
    expect(notes[0]).toBe('Алиса: Дюна (2021)')
  })

  it('закрывает плеер перед открытием', async () => {
    const close = vi.fn()
    g.window.Lampa = { ...fakeLampa(() => ({ movie: [dune2021] })), Player: { opened: () => true, close } }
    await runAction('open_card', { query: 'дюна' })
    expect(close).toHaveBeenCalled()
  })

  it('с годом ничего нет -> повторный поиск без года', async () => {
    g.window.Lampa = fakeLampa((q) => (q === 'дюна' ? { movie: [dune2021, dune1984] } : {}))
    const r = await runAction('open_card', { query: 'дюна 1984' })
    expect(queries.map(decodeURIComponent)).toEqual(['дюна 1984', 'дюна'])
    expect(r).toMatchObject({ ok: true, data: { id: 841 } })
  })

  it('не нашла -> not_found', async () => {
    g.window.Lampa = fakeLampa(() => ({}))
    expect(await runAction('open_card', { query: 'абв' })).toEqual({ ok: false, error: 'not_found' })
    expect(routed).toEqual([])
  })

  it('без Router - Activity.push', async () => {
    const push = vi.fn()
    const l = fakeLampa(() => ({ movie: [dune2021] }))
    delete l.Router
    g.window.Lampa = { ...l, Activity: { push } }
    await runAction('open_card', { query: 'дюна' })
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ component: 'full', id: 438631, method: 'movie' }))
  })

  it('экранирует HTML в уведомлении', async () => {
    g.window.Lampa = fakeLampa(() => ({ movie: [{ id: 1, title: '<b>x</b>' }] }))
    await runAction('open_card', { query: '<b>x</b>' })
    expect(notes[0]).toBe('Алиса: &#60;b&#62;x&#60;/b&#62;')
  })

  it('неизвестное действие', async () => {
    expect(await runAction('nope', {})).toEqual({ ok: false, error: 'unknown_action' })
  })
})
