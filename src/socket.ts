// Соединение с сервером: привязка, hello, команды, heartbeat, переподключение.
// Не зависит от Lampa: всё внешнее приходит через опции (удобно тестировать).

import {
  type ActionResult,
  CLOSE_BAD_TOKEN,
  CLOSE_REPLACED,
  type CommandMessage,
  PROTOCOL_VERSION,
  type ServerMessage,
} from './protocol'

export type Status =
  | 'no_server' // не задан адрес сервера
  | 'unpaired' // нет токена, нужен код привязки
  | 'connecting'
  | 'online'
  | 'offline' // нет связи, ждём переподключения
  | 'bad_code'
  | 'too_many_attempts'
  | 'replaced' // подключился другой клиент с тем же токеном

export interface WebSocketLike {
  readyState: number
  send(data: string): void
  close(code?: number): void
  onopen: ((ev: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onclose: ((ev: { code: number }) => void) | null
  onerror: ((ev: unknown) => void) | null
}

export interface ConnectionOptions {
  url: () => string
  getToken: () => string
  setToken: (token: string) => void
  device: string
  plugin: string
  actions: () => string[]
  onCommand: (cmd: CommandMessage) => Promise<ActionResult>
  onStatus: (status: Status) => void
  createSocket?: (url: string) => WebSocketLike
  pingInterval?: number
  /** Если от сервера столько ничего не приходит, считаем соединение мёртвым. */
  deadTimeout?: number
  backoff?: number[]
}

const OPEN = 1
const DEFAULT_BACKOFF = [1000, 2000, 5000, 10000, 30000, 60000]

export class Connection {
  private ws: WebSocketLike | null = null
  private pairCode = ''
  private attempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private lastMessageAt = 0
  private stopped = true
  status: Status = 'connecting'

  constructor(private readonly opts: ConnectionOptions) {}

  /** Запуск; повторный вызов переподключает (например, после смены адреса). */
  start(): void {
    this.stopped = false
    this.attempt = 0
    this.reconnect(0)
  }

  stop(): void {
    this.stopped = true
    this.clearTimers()
    this.drop()
  }

  /** Привязка по коду: подключаемся (если нужно) и отправляем pair. */
  pair(code: string): void {
    this.pairCode = code.trim()
    if (!this.pairCode) return
    if (this.ws && this.ws.readyState === OPEN) this.sendPair()
    else this.start()
  }

  /** Забыть токен и отключиться. */
  unpair(): void {
    this.opts.setToken('')
    this.pairCode = ''
    this.stop()
    this.setStatus('unpaired')
  }

  private connect(): void {
    this.drop()
    const url = this.opts.url()
    if (!url) return this.setStatus('no_server')
    if (!this.opts.getToken() && !this.pairCode) return this.setStatus('unpaired')

    this.setStatus('connecting')
    let ws: WebSocketLike
    try {
      ws = this.opts.createSocket
        ? this.opts.createSocket(url)
        : (new WebSocket(url) as unknown as WebSocketLike)
    } catch {
      return this.scheduleReconnect()
    }
    this.ws = ws

    ws.onopen = () => {
      this.lastMessageAt = Date.now()
      this.startPing()
      if (this.pairCode) this.sendPair()
      else this.sendHello()
    }
    ws.onmessage = (ev) => {
      this.lastMessageAt = Date.now()
      this.handle(ev.data)
    }
    ws.onerror = () => {
      // за ошибкой всегда следует onclose
    }
    ws.onclose = (ev) => {
      if (this.ws !== ws) return
      this.ws = null
      this.stopPing()
      if (this.stopped) return
      if (ev.code === CLOSE_BAD_TOKEN) {
        if (this.status !== 'unpaired') this.setStatus('unpaired')
        return
      }
      if (ev.code === CLOSE_REPLACED) return this.setStatus('replaced')
      if (this.status === 'bad_code' || this.status === 'too_many_attempts') return
      this.setStatus('offline')
      this.scheduleReconnect()
    }
  }

  private handle(raw: unknown): void {
    let msg: ServerMessage
    try {
      msg = JSON.parse(String(raw)) as ServerMessage
    } catch {
      return
    }
    switch (msg.type) {
      case 'paired':
        this.pairCode = ''
        this.opts.setToken(msg.token)
        this.sendHello()
        break
      case 'welcome':
        this.attempt = 0
        this.setStatus('online')
        break
      case 'command':
        void this.runCommand(msg)
        break
      case 'ping':
        this.send({ type: 'pong' })
        break
      case 'error':
        this.handleError(msg.error)
        break
    }
  }

  private handleError(error: string): void {
    if (error === 'bad_token') {
      this.opts.setToken('')
      this.setStatus('unpaired')
    } else if (error === 'bad_code' || error === 'too_many_attempts') {
      this.pairCode = ''
      this.setStatus(error)
      // Токена нет, держать соединение незачем.
      if (!this.opts.getToken()) this.drop()
    }
  }

  private async runCommand(cmd: CommandMessage): Promise<void> {
    let result: ActionResult
    try {
      result = await this.opts.onCommand(cmd)
    } catch {
      result = { ok: false, error: 'internal' }
    }
    this.send({ type: 'result', id: cmd.id, ...result })
  }

  private sendPair(): void {
    this.send({ type: 'pair', code: this.pairCode, device: this.opts.device })
  }

  private sendHello(): void {
    this.send({
      type: 'hello',
      token: this.opts.getToken(),
      plugin: this.opts.plugin,
      actions: this.opts.actions(),
    })
  }

  private send(msg: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === OPEN) {
      this.ws.send(JSON.stringify({ v: PROTOCOL_VERSION, ...msg }))
    }
  }

  private startPing(): void {
    this.stopPing()
    const interval = this.opts.pingInterval ?? 25000
    const dead = this.opts.deadTimeout ?? 60000
    this.pingTimer = setInterval(() => {
      if (Date.now() - this.lastMessageAt > dead) {
        // Соединение «повисло» (например, после сна ТВ): рвём и переподключаемся.
        const ws = this.ws
        this.ws = null
        this.stopPing()
        try {
          ws?.close()
        } catch {
          // ignore
        }
        this.setStatus('offline')
        this.scheduleReconnect()
        return
      }
      this.send({ type: 'ping' })
    }, interval)
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.pingTimer = null
  }

  private scheduleReconnect(): void {
    if (this.stopped) return
    const steps = this.opts.backoff ?? DEFAULT_BACKOFF
    const base = steps[Math.min(this.attempt, steps.length - 1)]
    this.attempt++
    this.reconnect(base + Math.floor(Math.random() * base * 0.2))
  }

  private reconnect(delay: number): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  private clearTimers(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.stopPing()
  }

  private drop(): void {
    const ws = this.ws
    this.ws = null
    this.stopPing()
    if (ws) {
      ws.onclose = null
      try {
        ws.close()
      } catch {
        // ignore
      }
    }
  }

  private setStatus(status: Status): void {
    if (this.status === status) return
    this.status = status
    this.opts.onStatus(status)
  }
}
