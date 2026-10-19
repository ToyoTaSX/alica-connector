// Жанры TMDB. Сервер присылает ключ жанра (comedy, scifi...), id у фильмов и
// сериалов в TMDB разные, поэтому для каждого ключа - два списка.

export type Kind = 'movie' | 'tv'

export const GENRES: Record<string, Record<Kind, number[]>> = {
  action: { movie: [28], tv: [10759] },
  adventure: { movie: [12], tv: [10759] },
  animation: { movie: [16], tv: [16] },
  comedy: { movie: [35], tv: [35] },
  crime: { movie: [80], tv: [80] },
  detective: { movie: [9648, 80], tv: [9648, 80] },
  documentary: { movie: [99], tv: [99] },
  drama: { movie: [18], tv: [18] },
  family: { movie: [10751], tv: [10751] },
  fantasy: { movie: [14], tv: [10765] },
  history: { movie: [36], tv: [10768] },
  horror: { movie: [27], tv: [9648] },
  music: { movie: [10402], tv: [] },
  romance: { movie: [10749], tv: [18] },
  scifi: { movie: [878], tv: [10765] },
  thriller: { movie: [53], tv: [80, 9648] },
  war: { movie: [10752], tv: [10768] },
  western: { movie: [37], tv: [37] },
}

const NAMES: Record<number, string> = {
  12: 'приключения',
  14: 'фэнтези',
  16: 'мультфильм',
  18: 'драма',
  27: 'ужасы',
  28: 'боевик',
  35: 'комедия',
  36: 'история',
  37: 'вестерн',
  53: 'триллер',
  80: 'криминал',
  99: 'документальный',
  878: 'фантастика',
  9648: 'детектив',
  10402: 'музыка',
  10749: 'мелодрама',
  10751: 'семейный',
  10752: 'военный',
  10759: 'боевик',
  10762: 'детский',
  10764: 'реалити',
  10765: 'фантастика',
  10766: 'мыльная опера',
  10768: 'военный',
}

/** Русские названия жанров карточки, без повторов. */
export function genreNames(ids: number[] | undefined, limit = 2): string[] {
  const out: string[] = []
  for (const id of ids || []) {
    const name = NAMES[id]
    if (name && out.indexOf(name) < 0) out.push(name)
    if (out.length >= limit) break
  }
  return out
}
