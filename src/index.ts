// AlicaConnector: плагин Lampa, выполняет голосовые команды навыка Алисы «Лампа».

import { actionNames, runAction } from './actions'
import * as lampa from './lampa'
import { normalizeServerUrl } from './protocol'
import { initSettings, KEY_SERVER, KEY_TOKEN, showStatus, STATUS_TEXT } from './settings'
import { Connection, type Status } from './socket'

declare const __VERSION__: string
declare const __DEFAULT_SERVER__: string

declare global {
  interface Window {
    alica_connector_loaded?: boolean
  }
}

function start(): void {
  let previous: Status | null = null

  const conn = new Connection({
    url: () => normalizeServerUrl(lampa.storage.get(KEY_SERVER) || __DEFAULT_SERVER__),
    getToken: () => lampa.storage.get(KEY_TOKEN),
    setToken: (token) => lampa.storage.set(KEY_TOKEN, token),
    device: `Lampa ${lampa.platform()}`,
    plugin: __VERSION__,
    actions: actionNames,
    onCommand: (cmd) => runAction(cmd.action, cmd.params),
    onStatus: (status) => {
      showStatus(status)
      // Сообщаем только о значимых переходах, а не о каждом переподключении.
      if (status === 'online' && previous !== 'offline' && previous !== null) {
        lampa.noty('AlicaConnector: подключено')
      }
      if (status === 'bad_code' || status === 'too_many_attempts' || status === 'replaced') {
        lampa.noty(`AlicaConnector: ${STATUS_TEXT[status].toLowerCase()}`)
      }
      if (status !== 'connecting') previous = status
    },
  })

  initSettings(conn, __VERSION__, __DEFAULT_SERVER__)
  conn.start()
}

if (!window.alica_connector_loaded) {
  window.alica_connector_loaded = true
  lampa.onReady(start)
}
