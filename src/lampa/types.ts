// Используемая часть глобального объекта Lampa (сверено с lampa-source 3.3.7).
// API неофициальный, поэтому все поля необязательные: наличие проверяет адаптер.

export interface TmdbItem {
  id: number
  title?: string
  name?: string
  original_title?: string
  original_name?: string
  release_date?: string
  first_air_date?: string
  popularity?: number
  vote_count?: number
  source?: string
  [key: string]: unknown
}

export interface TmdbList {
  results?: TmdbItem[]
}

/** Раздача из Lampa.Parser.get (Jackett/Prowlarr/TorrServer). */
export interface TorrentItem {
  Title: string
  Seeders?: number
  Peers?: number
  Size?: number
  MagnetUri?: string
  Link?: string
  Tracker?: string
  poster?: string
  [key: string]: unknown
}

export interface JQueryLike {
  find(selector: string): JQueryLike
  text(value: string): JQueryLike
  toggleClass(name: string, state: boolean): JQueryLike
}

export interface SettingsParam {
  component: string
  param: {
    name: string
    type: 'input' | 'static' | 'button' | 'title' | 'select' | 'trigger'
    values?: string | Record<string, string>
    default?: string | boolean
    placeholder?: string
  }
  field: { name: string; description?: string }
  onRender?: (item: JQueryLike) => void
  onChange?: (value?: string) => void
}

export interface Listener {
  follow(event: string, cb: (e: { type?: string; name?: string }) => void): void
}

export interface LampaGlobal {
  Listener?: Listener
  Storage?: {
    get(name: string, empty?: unknown): unknown
    set(name: string, value: unknown): void
    field?(name: string): unknown
  }
  Noty?: { show(text: string, params?: { time?: number }): void }
  SettingsApi?: {
    addComponent(data: { component: string; name: string; icon: string }): void
    addParam(data: SettingsParam): void
  }
  Settings?: { listener?: Listener }
  Api?: {
    search(params: { query: string }, cb: (res: { movie?: TmdbList; tv?: TmdbList }) => void): void
    img?(src: string, size?: string): string
  }
  Parser?: {
    get(
      params: Record<string, unknown>,
      ok: (data: { Results?: TorrentItem[] }) => void,
      fail: (error: string) => void,
    ): void
  }
  Torrent?: { start(element: TorrentItem, movie: Record<string, unknown>): void }
  Torserver?: { url?(): string }
  Router?: { call(name: string, data: Record<string, unknown>): void }
  Activity?: { push(object: Record<string, unknown>): void }
  Player?: { opened?(): boolean; close?(): void }
  Platform?: { get?(): string; is?(name: string): boolean }
}

declare global {
  interface Window {
    Lampa?: LampaGlobal
    appready?: boolean
    lampa_settings?: { torrents_use?: boolean }
  }
}
