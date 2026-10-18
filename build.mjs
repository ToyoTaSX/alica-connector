// Сборка в один IIFE-файл для Lampa: dist/alica-connector.js
// ALICA_SERVER=lampa.example.com node build.mjs - адрес сервера по умолчанию
import { readFileSync } from 'node:fs'
import * as esbuild from 'esbuild'

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))

await esbuild.build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/alica-connector.js',
  bundle: true,
  format: 'iife',
  // Tizen 4 (ТВ 2018 года) ~ Chromium 56
  target: process.env.ALICA_TARGET || 'chrome56',
  minify: process.argv.includes('--minify'),
  legalComments: 'none',
  charset: 'utf8',
  define: {
    __VERSION__: JSON.stringify(pkg.version),
    __DEFAULT_SERVER__: JSON.stringify(process.env.ALICA_SERVER || ''),
  },
  banner: { js: `/* AlicaConnector ${pkg.version} */` },
  logLevel: 'info',
})
