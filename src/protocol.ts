// Протокол WebSocket с lampa-alice-server (PROJECT.md, раздел 8; README сервера).

export const PROTOCOL_VERSION = 1

export interface CommandMessage {
  v: number
  type: 'command'
  id: string
  action: string
  params: Record<string, unknown>
}

export type ServerMessage =
  | CommandMessage
  | { v: number; type: 'paired'; token: string }
  | { v: number; type: 'welcome' }
  | { v: number; type: 'error'; error: string }
  | { v: number; type: 'ping' }
  | { v: number; type: 'pong' }

export type ActionResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string; data?: Record<string, unknown> }

/** Коды закрытия соединения сервером. */
export const CLOSE_BAD_TOKEN = 4001
export const CLOSE_REPLACED = 4002

/** «lampa.example.com» -> «wss://lampa.example.com/ws». */
export function normalizeServerUrl(input: string): string {
  let url = input.trim().replace(/\/+$/, '')
  if (!url) return ''
  if (/^https?:\/\//i.test(url)) url = url.replace(/^http/i, 'ws')
  if (!/^wss?:\/\//i.test(url)) url = 'wss://' + url
  if (!/\/ws$/.test(url)) url += '/ws'
  return url
}
