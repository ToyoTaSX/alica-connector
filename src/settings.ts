// Раздел «AlicaConnector» в настройках Lampa: статус, адрес сервера, код привязки.

import * as lampa from './lampa'
import type { JQueryLike } from './lampa'
import type { Connection, Status } from './socket'

export const COMPONENT = 'alica_connector'
export const KEY_SERVER = 'alica_connector_server'
export const KEY_CODE = 'alica_connector_code'
export const KEY_TOKEN = 'alica_connector_token'

const ICON =
  '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
  '<rect x="8" y="2" width="8" height="13" rx="4" stroke="currentColor" stroke-width="2"/>' +
  '<path d="M5 11a7 7 0 0 0 14 0M12 18v4" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round"/></svg>'

export const STATUS_TEXT: Record<Status, string> = {
  no_server: 'Укажите адрес сервера',
  unpaired: 'Не привязан: введите код привязки',
  connecting: 'Подключение…',
  online: 'Подключено',
  offline: 'Нет связи с сервером, переподключаюсь',
  bad_code: 'Неверный код привязки',
  too_many_attempts: 'Слишком много попыток, подождите 15 минут',
  replaced: 'Подключилась другая копия Lampa с этим токеном',
}

let statusItem: JQueryLike | null = null
let codeItem: JQueryLike | null = null

export function showStatus(status: Status): void {
  statusItem?.find('.settings-param__descr').text(STATUS_TEXT[status])
}

export function initSettings(conn: Connection, version: string, defaultServer: string): void {
  lampa.addSettings({
    component: COMPONENT,
    name: 'AlicaConnector',
    icon: ICON,
    params: [
      {
        param: { name: 'alica_connector_status', type: 'static' },
        field: { name: `Статус (версия ${version})`, description: STATUS_TEXT[conn.status] },
        onRender: (item) => {
          statusItem = item
          showStatus(conn.status)
        },
      },
      {
        param: {
          name: KEY_SERVER,
          type: 'input',
          values: '',
          default: defaultServer,
          placeholder: 'lampa.example.com',
        },
        field: { name: 'Адрес сервера', description: 'Домен сервера lampa-alice-server' },
        onChange: () => conn.start(),
      },
      {
        param: { name: KEY_CODE, type: 'input', values: '', default: '', placeholder: '' },
        field: {
          name: 'Код привязки',
          description: 'PAIR_CODE из .env сервера. Вводится один раз',
        },
        onRender: (item) => {
          codeItem = item
        },
        onChange: (value) => {
          // Код не храним и не показываем: после привязки нужен только токен.
          lampa.storage.set(KEY_CODE, '')
          codeItem?.find('.settings-param__value').text('')
          if (value) conn.pair(value)
        },
      },
      {
        param: { name: 'alica_connector_unpair', type: 'button' },
        field: { name: 'Отвязать телевизор', description: 'Забыть токен устройства' },
        onChange: () => {
          conn.unpair()
          lampa.noty('AlicaConnector: телевизор отвязан')
        },
      },
    ],
  })
}
