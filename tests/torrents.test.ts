import { beforeEach, describe, expect, it } from 'vitest'
import { runAction } from '../src/actions'
import { timing } from '../src/actions/play'
import { chooseTorrent, quality } from '../src/actions/quality'
import type { RenderedTorrent } from '../src/lampa'
import type { JQueryLike, LampaGlobal, ListenerEvent, TmdbItem, TorrentItem } from '../src/lampa/types'

const g = globalThis as unknown as {
  window: { Lampa?: LampaGlobal; lampa_settings?: { torrents_use?: boolean } }
}
g.window = g.window || (globalThis as never)

function fakeItem(onEnter: () => void = () => {}): JQueryLike {
  const item: JQueryLike = {
    find: () => item,
    text: () => item,
    toggleClass: () => item,
    trigger: (event) => {
      if (event === 'hover:enter') onEnter()
      return item
    },
  }
  return item
}

const t = (Title: string, Seeders: number, hash = Title): TorrentItem => ({ Title, Seeders, hash })
const r = (element: TorrentItem): RenderedTorrent => ({ element, item: fakeItem() })

describe('quality', () => {
  it.each([
    ['Dune (2021) WEB-DL 2160p HDR', '2160p'],
    ['Интерстеллар 4K, HEVC, HDR', '2160p'],
    ['Дюна (2021) BDRip 1080p', '1080p'],
    ['Dune 1080i HDTV', '1080p'],
    ['Dune 720p', '720p'],
    ['Dune DVDRip', undefined],
  ])('%s', (title, q) => expect(quality(title)).toBe(q))
})

describe('chooseTorrent', () => {
  it('без истории - верхняя', () => {
    const list = [r(t('a', 5)), r(t('b', 900))]
    expect(chooseTorrent(list, [])).toMatchObject({ last: false, rendered: { element: { Title: 'a' } } })
  })

  it('последняя запущенная важнее верхней', () => {
    const list = [r(t('a', 5)), r(t('b', 900)), r(t('c', 1))]
    expect(chooseTorrent(list, ['x', 'c', 'b'])).toMatchObject({ last: true, rendered: { element: { Title: 'b' } } })
    expect(chooseTorrent(list, ['b', 'c'])).toMatchObject({ last: true, rendered: { element: { Title: 'c' } } })
  })

  it('пусто', () => {
    expect(chooseTorrent([], ['a'])).toBeNull()
  })
})

const dune: TmdbItem = {
  id: 438631, title: 'Дюна', original_title: 'Dune', release_date: '2021-09-15',
  vote_count: 12000, poster_path: '/p.jpg',
}

describe('torrents / play', () => {
  let pushed: Record<string, unknown>[]
  let notes: string[]
  let pressed: string[]
  let reloads: number
  let settings: Record<string, unknown>
  let viewed: string[]

  /** Фейковая Lampa: экран торрентов отрисовывает screens[n] для n-го открытия. */
  function fake(screens: TorrentItem[][]) {
    const listeners: ((e: ListenerEvent) => void)[] = []
    let active: unknown = null
    let opened = 0
    const render = () => {
      const list = screens[opened++] || []
      const me = active
      setTimeout(() => {
        for (const element of list) {
          if (active !== me) return
          const ev = { type: 'render', element, item: fakeItem(() => pressed.push(element.Title)) }
          for (const cb of [...listeners]) cb(ev)
        }
      }, 10)
    }
    const l: LampaGlobal = {
      Listener: {
        follow: (_n, cb) => listeners.push(cb),
        remove: (_n, cb) => listeners.splice(listeners.indexOf(cb), 1),
      },
      Storage: {
        get: (n, d) => (n === 'torrents_view' ? JSON.stringify(viewed) : d),
        set: () => {},
        field: (n) => settings[n],
      },
      Api: {
        search: (_p, cb) => setTimeout(() => cb({ movie: { results: [dune] }, tv: { results: [] } }), 0),
        img: (src) => 'https://img' + src,
      },
      Torrent: { start: () => {} },
      Torserver: { url: () => 'http://192.168.1.10:8090' },
      Platform: { is: () => false },
      Activity: {
        push: (o) => {
          pushed.push(o)
          active = o
          render()
        },
        active: () => active,
        replace: () => {
          reloads++
          active = { ...(active as object) }
          render()
        },
      },
      Noty: { show: (x) => notes.push(x) },
    }
    g.window.Lampa = l
    return l
  }

  beforeEach(() => {
    pushed = []
    notes = []
    pressed = []
    reloads = 0
    viewed = []
    // parse_timeout 0.05 c, чтобы тесты не ждали 15 секунд
    settings = { parser_use: true, parse_lang: 'df_year', parse_timeout: 0.05 }
    g.window.lampa_settings = { torrents_use: true }
    timing.extraWaitMs = 0
  })

  it('torrents: открывает штатный экран с подготовленной карточкой', async () => {
    fake([[]])
    const res = await runAction('torrents', { query: 'дюна' })
    expect(res).toEqual({ ok: true, data: { title: 'Дюна', year: 2021, id: 438631 } })
    expect(pushed[0]).toMatchObject({
      component: 'torrents',
      search: 'Dune 2021',
      search_one: 'Дюна',
      search_two: 'Dune',
      movie: { id: 438631, title: 'Дюна', original_title: 'Dune', genres: [], img: 'https://img/p.jpg' },
    })
  })

  it('torrents: выключены в Lampa', async () => {
    fake([])
    settings.parser_use = false
    expect(await runAction('torrents', { query: 'дюна' })).toEqual({ ok: false, error: 'torrents_disabled' })
  })

  it('play: открывает экран торрентов и нажимает верхнюю раздачу', async () => {
    fake([[t('Dune 2021 2160p HDR', 340), t('Dune 2021 1080p', 900)]])
    const res = await runAction('play', { query: 'дюна' })
    expect(pushed[0]).toMatchObject({ component: 'torrents' })
    expect(pressed).toEqual(['Dune 2021 2160p HDR'])
    expect(res).toMatchObject({
      ok: true,
      data: { title: 'Дюна', choice: 'top', quality: '2160p', seeds: 340 },
    })
  })

  it('play: нажимает последнюю запущенную раздачу', async () => {
    viewed = ['Dune 2021 1080p']
    fake([[t('Dune 2021 2160p HDR', 340), t('Dune 2021 1080p', 900)]])
    const res = await runAction('play', { query: 'дюна' })
    expect(pressed).toEqual(['Dune 2021 1080p'])
    expect(res).toMatchObject({ ok: true, data: { choice: 'last', quality: '1080p' } })
  })

  it('play: пустой экран -> перезагрузка и вторая попытка', async () => {
    fake([[], [t('Dune 2021 1080p', 50)]])
    const res = await runAction('play', { query: 'дюна' })
    expect(reloads).toBe(1)
    expect(pressed).toEqual(['Dune 2021 1080p'])
    expect(res).toMatchObject({ ok: true, data: { seeds: 50 } })
  })

  it('play: дважды пусто -> no_torrents, ничего не нажато', async () => {
    fake([[], []])
    expect(await runAction('play', { query: 'дюна' })).toMatchObject({ ok: false, error: 'no_torrents' })
    expect(pressed).toEqual([])
  })

  it('play: нет TorrServer', async () => {
    const l = fake([])
    l.Torserver = { url: () => '' }
    expect(await runAction('play', { query: 'дюна' })).toEqual({ ok: false, error: 'no_torrserver' })
  })

  it('play: на Android TorrServer не обязателен', async () => {
    const l = fake([[t('Dune 2021 1080p', 5)]])
    l.Torserver = { url: () => '' }
    l.Platform = { is: (n) => n === 'android' }
    expect(await runAction('play', { query: 'дюна' })).toMatchObject({ ok: true })
  })
})
