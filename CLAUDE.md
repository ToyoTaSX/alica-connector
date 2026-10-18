# CLAUDE.md

Плагин Lampa AlicaConnector: выполняет команды навыка Алисы «Лампа ТВ».
Описание - `README.md`, решения - `../PROJECT.md`, общие правила -
`../CLAUDE.md`. Общаться по-русски.

## Команды

```bash
npm ci
npm test
npm run typecheck
npm run build && node --check dist/alica-connector.js
```

## Устройство

- `src/lampa/` - единственное место, где трогается `window.Lampa`; все поля в
  `types.ts` необязательные, наличие функций проверять перед вызовом.
- `src/actions/` - действие = объект `{name, run}` + `register()` в `index.ts`;
  список действий уходит серверу в `hello`.
- `play` работает через штатные экраны Lampa: события `Listener` `torrent` /
  `render` и `torrent_file` / `render`, нажатие - `item.trigger('hover:enter')`.
- `src/socket.ts` не зависит от Lampa (тестируется с фейковым сокетом).

## Правила

- Целевой движок - Chromium 56: без `\p{...}`, `Array.prototype.at/flat`,
  `Promise.finally`; `\b` не работает с кириллицей. Синтаксис понижает esbuild.
- Тексты на экране ТВ - через `lampa.noty` (экранирует HTML).
- Перед изменениями вызовов Lampa сверяться с `yumata/lampa-source` версии на
  ТВ (сейчас 3.3.7).
- Публикация: поднять `version` в `package.json`, пуш в `main` (GitHub Actions
  выкладывает на Pages), ключ `~/.ssh/id_rsa`.
