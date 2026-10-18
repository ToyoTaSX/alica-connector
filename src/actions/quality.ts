// Выбор раздачи для «запусти фильм»: 1080p и выше, без экранок, больше всего сидов.

import type { TorrentItem } from '../lampa'

/** 2160 или 1080; null - качество ниже или не указано. */
export function resolution(title: string): 2160 | 1080 | null {
  const t = title.toLowerCase()
  if (/\b(2160p|4k|uhd)\b/.test(t)) return 2160
  if (/\b1080[pi]\b/.test(t)) return 1080
  return null
}

// CAMRip, TS/TeleSync, TC/TeleCine, экранка - запись из кинотеатра.
// \b не работает с кириллицей, поэтому «экранка» - отдельно.
const CAM = /\b(cam|camrip|hdcam|ts|hdts|telesync|tc|telecine)\b|экранк/i
// Samsung не поддерживает Dolby Vision: раздача только с DV (профиль 5) покажет
// зелёно-фиолетовую картинку. Гибрид DV + HDR10 подходит.
const DV = /\b(dv|dovi|dolby vision)\b/i
const HDR = /\bhdr(10\+?)?\b/i
const THREE_D = /\b3d\b/i

export interface Choice {
  item: TorrentItem
  quality: '2160p' | '1080p'
  seeds: number
}

export interface ChooseOptions {
  /** Год фильма: раздачи с другим годом в названии отбрасываем (сиквелы, ремейки). */
  year?: number
  /** Отбрасывать раздачи только с Dolby Vision (по умолчанию - да, Samsung). */
  skipDolbyVisionOnly?: boolean
}

function yearMatches(title: string, year?: number): boolean {
  if (!year) return true
  const years = (title.match(/\b(19|20)\d{2}\b/g) || []).map(Number)
  return years.length === 0 || years.some((y) => Math.abs(y - year) <= 1)
}

export function chooseTorrent(items: TorrentItem[], opts: ChooseOptions = {}): Choice | null {
  const skipDv = opts.skipDolbyVisionOnly !== false
  let best: Choice | null = null

  for (const item of items) {
    const title = String(item.Title || '')
    const res = resolution(title)
    if (!res || CAM.test(title) || THREE_D.test(title)) continue
    if (skipDv && DV.test(title) && !HDR.test(title)) continue
    if (!yearMatches(title, opts.year)) continue
    if (!item.MagnetUri && !item.Link) continue

    const seeds = Number(item.Seeders) || 0
    if (!best || seeds > best.seeds || (seeds === best.seeds && res > parseInt(best.quality))) {
      best = { item, quality: res === 2160 ? '2160p' : '1080p', seeds }
    }
  }
  return best
}
