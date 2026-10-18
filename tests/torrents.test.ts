import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runAction } from '../src/actions'
import { chooseTorrent, resolution } from '../src/actions/quality'
import type { LampaGlobal, TmdbItem, TorrentItem } from '../src/lampa/types'

const g = globalThis as unknown as {
  window: { Lampa?: LampaGlobal; lampa_settings?: { torrents_use?: boolean } }
}
g.window = g.window || (globalThis as never)

const t = (Title: string, Seeders: number, extra: Partial<TorrentItem> = {}): TorrentItem => ({
  Title,
  Seeders,
  MagnetUri: 'magnet:?xt=urn:btih:' + Title.length,
  ...extra,
})

describe('resolution', () => {
  it.each([
    ['Dune (2021) WEB-DL 2160p HDR', 2160],
    ['Дюна / Dune [2021, UHD BDRemux, HDR10]', 2160],
    ['Dune 4K', 2160],
    ['Дюна (2021) BDRip 1080p', 1080],
    ['Dune 1080i HDTV', 1080],
    ['Dune 720p', null],
    ['Dune DVDRip', null],
  ])('%s', (title, res) => expect(resolution(title)).toBe(res))
})

describe('chooseTorrent', () => {
  it('больше сидов среди 1080p+', () => {
    const r = chooseTorrent([
      t('Dune 2021 720p', 900),
      t('Dune 2021 1080p', 120),
      t('Dune 2021 2160p HDR', 340),
    ])
    expect(r).toMatchObject({ quality: '2160p', seeds: 340 })
  })

  it('без экранок и 3D', () => {
    const r = chooseTorrent([
      t('Dune 2021 CAMRip 1080p', 999),
      t('Дюна 2021 1080p TS', 800),
      t('Дюна 2021 1080p Экранка', 700),
      t('Dune 2021 1080p 3D', 600),
      t('Dune 2021 1080p WEB-DL', 10),
    ])
    expect(r?.item.Title).toBe('Dune 2021 1080p WEB-DL')
  })

  it('только Dolby Vision - пропускаем, гибрид DV+HDR10 - берём', () => {
    expect(chooseTorrent([t('Dune 2160p DV', 500), t('Dune 1080p', 5)])?.item.Title).toBe('Dune 1080p')
    expect(chooseTorrent([t('Dune 2160p HDR10, DV', 500), t('Dune 1080p', 5)])?.seeds).toBe(500)
    expect(chooseTorrent([t('Dune 2160p DV', 500)], { skipDolbyVisionOnly: false })?.seeds).toBe(500)
  })

  it('другой год в названии - сиквел или ремейк', () => {
    const r = chooseTorrent(
      [t('Дюна: Часть вторая 2024 2160p', 999), t('Dune 1984 1080p', 500), t('Dune 2021 1080p', 50)],
      { year: 2021 },
    )
    expect(r?.item.Title).toBe('Dune 2021 1080p')
  })

  it('нет ссылки - пропускаем; ничего не подошло - null', () => {
    expect(chooseTorrent([t('Dune 1080p', 9, { MagnetUri: undefined })])).toBeNull()
    expect(chooseTorrent([t('Dune 720p', 9)])).toBeNull()
  })
})

const dune: TmdbItem = {
  id: 438631, title: 'Дюна', original_title: 'Dune', release_date: '2021-09-15',
  vote_count: 12000, poster_path: '/p.jpg', genre_ids: [878],
}

describe('torrents / play', () => {
  let pushed: Record<string, unknown>[]
  let routed: Record<string, unknown>[]
  let started: { item: TorrentItem; movie: Record<string, unknown> }[]
  let notes: string[]
  let parserCalls: Record<string, unknown>[]
  let settings: Record<string, unknown>

  function fake(parser: (ok: (d: { Results: TorrentItem[] }) => void, fail: (e: string) => void) => void) {
    const l: LampaGlobal = {
      Storage: { get: () => '', set: () => {}, field: (n) => settings[n] },
      Api: {
        search: (_p, cb) => setTimeout(() => cb({ movie: { results: [dune] }, tv: { results: [] } }), 0),
        img: (src) => 'https://img' + src,
      },
      Parser: {
        get: (params, ok, fail) => {
          parserCalls.push(params)
          parser(ok, fail)
        },
      },
      Torrent: { start: (item, movie) => started.push({ item, movie }) },
      Torserver: { url: () => 'http://192.168.1.10:8090' },
      Platform: { is: () => false },
      Router: { call: (name, data) => routed.push({ name, id: data.id }) },
      Activity: { push: (o) => pushed.push(o) },
      Noty: { show: (x) => notes.push(x) },
    }
    g.window.Lampa = l
    return l
  }

  beforeEach(() => {
    pushed = []
    routed = []
    started = []
    notes = []
    parserCalls = []
    settings = { parser_use: true, parse_lang: 'df_year' }
    g.window.lampa_settings = { torrents_use: true }
  })

  it('torrents: открывает штатный экран с подготовленной карточкой', async () => {
    fake(() => {})
    const r = await runAction('torrents', { query: 'дюна' })
    expect(r).toEqual({ ok: true, data: { title: 'Дюна', year: 2021, id: 438631 } })
    expect(pushed).toHaveLength(1)
    expect(pushed[0]).toMatchObject({
      component: 'torrents',
      search: 'Dune 2021',
      search_one: 'Дюна',
      search_two: 'Dune',
      movie: { id: 438631, title: 'Дюна', original_title: 'Dune', genres: [], img: 'https://img/p.jpg' },
    })
  })

  it('torrents: выключены в Lampa', async () => {
    fake(() => {})
    settings.parser_use = false
    expect(await runAction('torrents', { query: 'дюна' })).toEqual({ ok: false, error: 'torrents_disabled' })
  })

  it('play: лучшая раздача уходит в Torrent.start', async () => {
    fake((ok) => setTimeout(() => ok({ Results: [
      t('Dune 2021 1080p', 120, { Tracker: 'rutracker' }),
      t('Dune 2021 2160p HDR', 340, { Tracker: 'kinozal' }),
      t('Dune 2021 720p', 999),
    ] }), 0))
    const r = await runAction('play', { query: 'дюна' })
    expect(r).toMatchObject({
      ok: true,
      data: { title: 'Дюна', year: 2021, quality: '2160p', seeds: 340, tracker: 'kinozal' },
    })
    expect(routed).toEqual([{ name: 'full', id: 438631 }])
    expect(started).toHaveLength(1)
    expect(started[0].item.Title).toBe('Dune 2021 2160p HDR')
    expect(started[0].item.poster).toBe('https://img/p.jpg')
    expect(started[0].movie).toMatchObject({ id: 438631, genres: [] })
    expect(parserCalls[0]).toMatchObject({ search: 'Dune 2021', movie: { id: 438631 } })
  })

  it('play: нет 1080p+ -> no_quality, ничего не запускаем', async () => {
    fake((ok) => ok({ Results: [t('Dune 2021 720p', 999)] }))
    expect(await runAction('play', { query: 'дюна' })).toMatchObject({ ok: false, error: 'no_quality' })
    expect(started).toEqual([])
  })

  it('play: раздач нет', async () => {
    fake((ok) => ok({ Results: [] }))
    expect(await runAction('play', { query: 'дюна' })).toMatchObject({ ok: false, error: 'no_torrents' })
  })

  it('play: ошибка парсера -> открываем экран торрентов', async () => {
    fake((_ok, fail) => fail('Укажите ссылку для парсинга: Jackett'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await runAction('play', { query: 'дюна' })
    err.mockRestore()
    expect(r).toMatchObject({ ok: true, data: { fallback: 'torrents' } })
    expect(pushed[0]).toMatchObject({ component: 'torrents' })
    expect(started).toEqual([])
  })

  it('play: нет TorrServer', async () => {
    const l = fake(() => {})
    l.Torserver = { url: () => '' }
    expect(await runAction('play', { query: 'дюна' })).toEqual({ ok: false, error: 'no_torrserver' })
  })

  it('play: на Android TorrServer не обязателен', async () => {
    const l = fake((ok) => ok({ Results: [t('Dune 2021 1080p', 5)] }))
    l.Torserver = { url: () => '' }
    l.Platform = { is: (n) => n === 'android' }
    expect(await runAction('play', { query: 'дюна' })).toMatchObject({ ok: true })
  })
})
