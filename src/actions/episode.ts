// Выбор файла в списке «Файлы» раздачи после «запусти фильм».

export interface FileEntry {
  season?: number
  episode?: number
  /** Сколько просмотрено, % (Timeline Lampa). */
  percent: number
}

/** Досмотрено на столько процентов - значит, серия просмотрена. */
export const WATCHED_PERCENT = 90

/**
 * Индекс файла, который нужно запустить, или null - оставить выбор человеку.
 * - один файл (фильм): он;
 * - сериал: последняя серия с прогрессом, если досмотрена меньше чем на 90%,
 *   иначе следующая; ничего не смотрели - первая серия;
 * - несколько файлов без номеров серий: null.
 */
export function chooseFile(files: FileEntry[], watched = WATCHED_PERCENT): number | null {
  if (files.length === 1) return 0

  const episodes = files
    .map((f, index) => ({ ...f, index }))
    .filter((f) => (f.episode || 0) > 0)
    .sort((a, b) => (a.season || 0) - (b.season || 0) || (a.episode || 0) - (b.episode || 0))
  if (episodes.length < 2) return null

  let last = -1
  episodes.forEach((f, i) => {
    if (f.percent > 0) last = i
  })
  if (last === -1) return episodes[0].index
  if (episodes[last].percent < watched) return episodes[last].index
  // Последняя просмотренная серия - финальная: выбор за человеком.
  return last + 1 < episodes.length ? episodes[last + 1].index : null
}
