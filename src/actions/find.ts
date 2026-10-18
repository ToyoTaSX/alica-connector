// Поиск карточки по фразе: общий шаг для open_card, torrents и play.

import * as lampa from '../lampa'
import { type Pick, pickBest, splitYear } from './match'

export async function findCard(query: string): Promise<Pick | null> {
  let results = await lampa.search(query)
  // «дюна 2021»: если с годом ничего не нашлось, ищем без него.
  const { title, year } = splitYear(query)
  if (year !== undefined && !results.movie.length && !results.tv.length) {
    results = await lampa.search(title)
  }
  return pickBest(results, query)
}

export function describe(pick: Pick): string {
  return pick.year ? `${pick.title} (${pick.year})` : pick.title
}
