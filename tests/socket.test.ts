import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActionResult, CommandMessage } from '../src/protocol'
import { Connection, type ConnectionOptions, type Status, type WebSocketLike } from '../src/socket'

class FakeSocket implements WebSocketLike {
  readyState = 0
  sent: Record<string, unknown>[] = []
  closed = false
  onopen: ((ev: unknown) => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onclose: ((ev: { code: number }) => void) | null = null
  onerror: ((ev: unknown) => void) | null = null

  constructor(public url: string) {}
  send(data: string) {
    this.sent.push(JSON.parse(data))
  }
  close() {
    this.closed = true
    this.readyState = 3
  }
  open() {
    this.readyState = 1
    this.onopen?.({})
  }
  receive(msg: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify({ v: 1, ...msg }) })
  }
  serverClose(code = 1006) {
    this.readyState = 3
    this.onclose?.({ code })
  }
  last() {
    return this.sent[this.sent.length - 1]
  }
}

let sockets: FakeSocket[]
let token: string
let statuses: Status[]

function make(over: Partial<ConnectionOptions> = {}) {
  return new Connection({
    url: () => 'wss://srv/ws',
    getToken: () => token,
    setToken: (t) => {
      token = t
    },
    device: 'test',
    plugin: '0.1.0',
    actions: () => ['open_card'],
    onCommand: async (): Promise<ActionResult> => ({ ok: true, data: { title: 'Дюна' } }),
    onStatus: (s) => statuses.push(s),
    createSocket: (url) => {
      const s = new FakeSocket(url)
      sockets.push(s)
      return s
    },
    backoff: [1000, 5000],
    ...over,
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  sockets = []
  token = ''
  statuses = []
})
afterEach(() => vi.useRealTimers())

describe('Connection', () => {
  it('без токена не подключается и просит код', () => {
    make().start()
    vi.advanceTimersByTime(10)
    expect(sockets).toHaveLength(0)
    expect(statuses).toEqual(['unpaired'])
  })

  it('привязка: pair -> paired -> hello -> welcome', () => {
    const c = make()
    c.start()
    vi.advanceTimersByTime(10)
    c.pair('12345678')
    vi.advanceTimersByTime(10)
    const ws = sockets[0]
    ws.open()
    expect(ws.last()).toEqual({ v: 1, type: 'pair', code: '12345678', device: 'test' })
    ws.receive({ type: 'paired', token: 'tok' })
    expect(token).toBe('tok')
    expect(ws.last()).toEqual({
      v: 1, type: 'hello', token: 'tok', plugin: '0.1.0', actions: ['open_card'],
    })
    ws.receive({ type: 'welcome' })
    expect(c.status).toBe('online')
  })

  it('неверный код: статус bad_code, соединение закрыто, без переподключения', () => {
    const c = make()
    c.pair('000000')
    vi.advanceTimersByTime(10)
    sockets[0].open()
    sockets[0].receive({ type: 'error', error: 'bad_code' })
    expect(c.status).toBe('bad_code')
    expect(sockets[0].closed).toBe(true)
    vi.advanceTimersByTime(120000)
    expect(sockets).toHaveLength(1)
  })

  it('выполняет команду и отправляет результат с тем же id', async () => {
    token = 'tok'
    const onCommand = vi.fn(async (cmd: CommandMessage): Promise<ActionResult> => ({
      ok: true, data: { q: cmd.params.query },
    }))
    make({ onCommand }).start()
    vi.advanceTimersByTime(10)
    const ws = sockets[0]
    ws.open()
    ws.receive({ type: 'welcome' })
    ws.receive({ type: 'command', id: 'c1', action: 'open_card', params: { query: 'дюна' } })
    await vi.waitFor(() => expect(ws.last()).toMatchObject({ type: 'result', id: 'c1' }))
    expect(ws.last()).toEqual({ v: 1, type: 'result', id: 'c1', ok: true, data: { q: 'дюна' } })
  })

  it('ошибка в обработчике -> result internal', async () => {
    token = 'tok'
    make({ onCommand: async () => { throw new Error('boom') } }).start()
    vi.advanceTimersByTime(10)
    sockets[0].open()
    sockets[0].receive({ type: 'command', id: 'c2', action: 'x', params: {} })
    await vi.waitFor(() =>
      expect(sockets[0].last()).toEqual({ v: 1, type: 'result', id: 'c2', ok: false, error: 'internal' }),
    )
  })

  it('обрыв -> переподключение с нарастающей паузой', () => {
    token = 'tok'
    make().start()
    vi.advanceTimersByTime(10)
    sockets[0].open()
    sockets[0].serverClose()
    expect(statuses).toContain('offline')
    vi.advanceTimersByTime(1300)
    expect(sockets).toHaveLength(2)
    sockets[1].serverClose()
    vi.advanceTimersByTime(4000)
    expect(sockets).toHaveLength(2)
    vi.advanceTimersByTime(2100)
    expect(sockets).toHaveLength(3)
  })

  it('bad_token: токен стирается, переподключения нет', () => {
    token = 'old'
    const c = make()
    c.start()
    vi.advanceTimersByTime(10)
    sockets[0].open()
    sockets[0].receive({ type: 'error', error: 'bad_token' })
    sockets[0].serverClose(4001)
    expect(token).toBe('')
    expect(c.status).toBe('unpaired')
    vi.advanceTimersByTime(120000)
    expect(sockets).toHaveLength(1)
  })

  it('4002: другой клиент занял токен - не переподключаемся', () => {
    token = 'tok'
    const c = make()
    c.start()
    vi.advanceTimersByTime(10)
    sockets[0].open()
    sockets[0].serverClose(4002)
    expect(c.status).toBe('replaced')
    vi.advanceTimersByTime(120000)
    expect(sockets).toHaveLength(1)
  })

  it('heartbeat: ping, а при тишине - переподключение', () => {
    token = 'tok'
    make({ pingInterval: 1000, deadTimeout: 3000 }).start()
    vi.advanceTimersByTime(10)
    const ws = sockets[0]
    ws.open()
    vi.advanceTimersByTime(1000)
    expect(ws.last()).toEqual({ v: 1, type: 'ping' })
    vi.advanceTimersByTime(3000)
    expect(ws.closed).toBe(true)
    vi.advanceTimersByTime(1300)
    expect(sockets).toHaveLength(2)
  })

  it('отвечает pong на ping сервера', () => {
    token = 'tok'
    make().start()
    vi.advanceTimersByTime(10)
    sockets[0].open()
    sockets[0].receive({ type: 'ping' })
    expect(sockets[0].last()).toEqual({ v: 1, type: 'pong' })
  })

  it('без адреса сервера - статус no_server', () => {
    token = 'tok'
    make({ url: () => '' }).start()
    vi.advanceTimersByTime(10)
    expect(statuses).toEqual(['no_server'])
  })
})
