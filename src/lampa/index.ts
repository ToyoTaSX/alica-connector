// Адаптер к API Lampa. Остальной код плагина не обращается к window.Lampa напрямую.

import type {
  JQueryLike,
  LampaGlobal,
  ListenerEvent,
  SettingsParam,
  TmdbItem,
  TorrentFile,
  TorrentItem,
} from './types'

export type { JQueryLike, SettingsParam, TmdbItem, TorrentFile, TorrentItem } from './types'

export class LampaError extends Error {}

function lampa(): LampaGlobal {
  if (!window.Lampa) throw new LampaError('Lampa не загружена')
  return window.Lampa
}

/** Вызывает cb, когда Lampa полностью готова (событие app:ready). */
export function onReady(cb: () => void): void {
  if (window.appready) return cb()
  const listener = window.Lampa?.Listener
  if (listener) {
    listener.follow('app', (e) => {
      if (e.type === 'ready') cb()
    })
  } else {
    // Плагин загрузился раньше Lampa: ждём появления глобального объекта.
    const timer = setInterval(() => {
      if (window.appready) {
        clearInterval(timer)
        cb()
      }
    }, 500)
  }
}

/** Значение настройки Lampa с учётом её значения по умолчанию (Storage.field). */
export function setting(name: string): unknown {
  const st = window.Lampa?.Storage
  if (st && typeof st.field === 'function') return st.field(name)
  return st?.get(name)
}

export const storage = {
  get(name: string, fallback = ''): string {
    const value = window.Lampa?.Storage?.get(name, fallback)
    return value === undefined || value === null ? fallback : String(value)
  },
  set(name: string, value: string): void {
    window.Lampa?.Storage?.set(name, value)
  },
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

/** Всплывающее уведомление (Noty вставляет текст как HTML, поэтому экранируем). */
export function noty(text: string): void {
  window.Lampa?.Noty?.show(escapeHtml(text))
}

export function platform(): string {
  return window.Lampa?.Platform?.get?.() || 'unknown'
}

export interface SettingsSection {
  component: string
  name: string
  icon: string
  params: Omit<SettingsParam, 'component'>[]
}

export function addSettings(section: SettingsSection): void {
  const api = lampa().SettingsApi
  if (!api) throw new LampaError('нет Lampa.SettingsApi')
  api.addComponent({ component: section.component, name: section.name, icon: section.icon })
  for (const p of section.params) api.addParam({ ...p, component: section.component })
}

export function onSettingsOpen(component: string, cb: () => void): void {
  window.Lampa?.Settings?.listener?.follow('open', (e) => {
    if (e.name === component) cb()
  })
}

export interface SearchResults {
  movie: TmdbItem[]
  tv: TmdbItem[]
}

/** Поиск через источник TMDB в Lampa (её прокси и язык из настроек). */
export function search(query: string, timeoutMs = 15000): Promise<SearchResults> {
  const api = lampa().Api
  if (!api || typeof api.search !== 'function') {
    return Promise.reject(new LampaError('нет Lampa.Api.search'))
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new LampaError('search timeout')), timeoutMs)
    // Lampa подставляет query в URL как есть, поэтому кодируем сами (как глобальный поиск).
    api.search({ query: encodeURIComponent(query) }, (res) => {
      clearTimeout(timer)
      resolve({ movie: res.movie?.results || [], tv: res.tv?.results || [] })
    })
  })
}

/** Открывает карточку фильма или сериала (component: 'full'). */
export function openFull(card: TmdbItem): void {
  const l = lampa()
  if (l.Player?.opened?.()) l.Player.close?.()

  const data = { ...card, source: card.source || 'tmdb' }
  if (l.Router && typeof l.Router.call === 'function') {
    l.Router.call('full', data)
  } else if (l.Activity && typeof l.Activity.push === 'function') {
    l.Activity.push({
      url: '',
      component: 'full',
      id: card.id,
      method: card.original_name !== undefined || card.name !== undefined ? 'tv' : 'movie',
      card: data,
      source: data.source,
      page: 1,
    })
  } else {
    throw new LampaError('нет Lampa.Router и Lampa.Activity')
  }
}

/** Карточка в том виде, в каком её ждут экран торрентов и Lampa.Parser. */
export type Movie = TmdbItem & {
  title: string
  original_title: string
  genres: { id?: number; name: string }[]
  img?: string
}

export function toMovie(card: TmdbItem): Movie {
  const isTv = card.original_name !== undefined || card.name !== undefined
  const movie: Movie = {
    ...card,
    title: String(card.title || card.name || ''),
    original_title: String(card.original_title || card.original_name || card.title || card.name || ''),
    // Парсер Jackett делает movie.genres.map(...), а в результатах поиска есть только genre_ids.
    genres: Array.isArray(card.genres) ? (card.genres as Movie['genres']) : [],
    source: card.source || 'tmdb',
  }
  // Категория раздач в Jackett: number_of_seasons > 0 -> сериалы.
  if (isTv && movie.number_of_seasons === undefined) movie.number_of_seasons = 1
  const poster = typeof card.poster_path === 'string' ? card.poster_path : ''
  const img = poster && window.Lampa?.Api?.img?.(poster)
  if (img) movie.img = img
  return movie
}

/** Строка поиска раздач так же, как у кнопки «Торренты» в карточке (настройка parse_lang). */
export function torrentQuery(movie: Movie): { search: string; search_one: string; search_two: string } {
  const year = String(movie.first_air_date || movie.release_date || '0000').slice(0, 4)
  const df = movie.original_title
  const lg = movie.title
  const combinations: Record<string, string> = {
    df,
    df_year: `${df} ${year}`,
    df_lg: `${df} ${lg}`,
    df_lg_year: `${df} ${lg} ${year}`,
    lg,
    lg_year: `${lg} ${year}`,
    lg_df: `${lg} ${df}`,
    lg_df_year: `${lg} ${df} ${year}`,
  }
  const mode = String(setting('parse_lang') || 'df')
  return { search: combinations[mode] || df, search_one: lg, search_two: df }
}

/** Встроенные торренты включены (плагин etor) и выбран парсер. */
export function torrentsEnabled(): boolean {
  return window.lampa_settings?.torrents_use !== false && Boolean(setting('parser_use'))
}

/** Штатный экран торрентов Lampa для фильма. */
export function openTorrents(movie: Movie): void {
  const l = lampa()
  if (!l.Activity || typeof l.Activity.push !== 'function') throw new LampaError('нет Lampa.Activity')
  if (l.Player?.opened?.()) l.Player.close?.()
  l.Activity.push({
    url: '',
    title: 'Торренты',
    component: 'torrents',
    ...torrentQuery(movie),
    movie,
    page: 1,
  })
}

/** Пересоздать текущий экран (экран торрентов заново запросит парсер). */
export function reloadActivity(): void {
  const activity = lampa().Activity
  if (!activity || typeof activity.replace !== 'function') throw new LampaError('нет Lampa.Activity.replace')
  activity.replace({})
}

/** Таймаут парсера из настроек Lampa, мс. */
export function parserTimeout(): number {
  const seconds = Number(setting('parse_timeout'))
  return (Number.isFinite(seconds) && seconds > 0 ? seconds : 15) * 1000
}

export interface RenderedTorrent {
  element: TorrentItem
  item: JQueryLike
}

/**
 * Выполняет open() и собирает раздачи, которые отрисует экран торрентов (событие
 * Lampa.Listener 'torrent' / 'render'). Список считается готовым, когда события
 * затихли на settleMs; пустой массив - за timeoutMs ничего не появилось.
 */
export function waitTorrentList(
  open: () => void,
  timeoutMs: number,
  settleMs = 700,
): Promise<RenderedTorrent[]> {
  const l = lampa()
  const listener = l.Listener
  if (!listener || typeof listener.remove !== 'function') {
    return Promise.reject(new LampaError('нет Lampa.Listener'))
  }
  return new Promise((resolve, reject) => {
    const items: RenderedTorrent[] = []
    let target: unknown
    let settle: ReturnType<typeof setTimeout> | undefined
    const done = (): void => {
      clearTimeout(timer)
      if (settle) clearTimeout(settle)
      listener.remove?.('torrent', onEvent)
      resolve(items)
    }
    const onEvent = (e: ListenerEvent): void => {
      if (e.type !== 'render' || !e.element || !e.item) return
      // Только раздачи экрана, который открыли мы.
      if (target !== undefined && l.Activity?.active?.() !== target) return
      items.push({ element: e.element, item: e.item })
      if (settle) clearTimeout(settle)
      settle = setTimeout(done, settleMs)
    }
    const timer = setTimeout(done, timeoutMs)
    listener.follow('torrent', onEvent)
    try {
      open()
      target = l.Activity?.active?.()
    } catch (e) {
      clearTimeout(timer)
      listener.remove?.('torrent', onEvent)
      reject(e)
    }
  })
}

export interface RenderedFile {
  element: TorrentFile
  item: JQueryLike
}

/**
 * Ждёт список «Файлы» раздачи (Lampa.Listener 'torrent_file' / 'render') и отдаёт
 * его файлы. TorrServer может грузить метаданные долго, отсюда большой таймаут.
 */
export function waitTorrentFiles(timeoutMs: number, settleMs = 300): Promise<RenderedFile[]> {
  const listener = lampa().Listener
  if (!listener || typeof listener.remove !== 'function') {
    return Promise.reject(new LampaError('нет Lampa.Listener'))
  }
  return new Promise((resolve) => {
    const files: RenderedFile[] = []
    let settle: ReturnType<typeof setTimeout> | undefined
    const done = (): void => {
      clearTimeout(timer)
      if (settle) clearTimeout(settle)
      listener.remove?.('torrent_file', onEvent)
      resolve(files)
    }
    const onEvent = (e: ListenerEvent): void => {
      if (e.type !== 'render' || !e.element || !e.item) return
      files.push({ element: e.element, item: e.item })
      if (settle) clearTimeout(settle)
      settle = setTimeout(done, settleMs)
    }
    const timer = setTimeout(done, timeoutMs)
    listener.follow('torrent_file', onEvent)
  })
}

/** Хэши запущенных раздач в порядке запуска (Lampa хранит их в torrents_view). */
export function viewedTorrents(): string[] {
  let value = window.Lampa?.Storage?.get('torrents_view', '[]')
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      value = []
    }
  }
  return Array.isArray(value) ? value.map(String) : []
}

/** Нажать как OK на пульте: раздачу (TorrServer, история, отметка) или файл (плеер). */
export function pressTorrent(rendered: { item: JQueryLike }): void {
  rendered.item.trigger('hover:enter')
}

/** Есть куда отдать раздачу: TorrServer в настройках или торрент-клиент Android. */
export function canStartTorrent(): boolean {
  const l = window.Lampa
  if (!l?.Torrent) return false
  if (l.Platform?.is?.('android')) return true
  return Boolean(l.Torserver?.url?.())
}
