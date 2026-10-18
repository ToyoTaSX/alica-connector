import { describe, expect, it } from 'vitest'
import { chooseFile, type FileEntry } from '../src/actions/episode'

const ep = (episode: number, percent = 0, season = 1): FileEntry => ({ season, episode, percent })

describe('chooseFile', () => {
  it('один файл - он', () => {
    expect(chooseFile([{ percent: 0 }])).toBe(0)
  })

  it('ничего не смотрели - первая серия', () => {
    expect(chooseFile([ep(1), ep(2), ep(3)])).toBe(0)
  })

  it('последняя серия досмотрена меньше чем на 90% - она', () => {
    expect(chooseFile([ep(1, 100), ep(2, 40), ep(3)])).toBe(1)
    expect(chooseFile([ep(1, 100), ep(2, 89), ep(3)])).toBe(1)
  })

  it('последняя серия досмотрена на 90% и больше - следующая', () => {
    expect(chooseFile([ep(1, 100), ep(2, 90), ep(3)])).toBe(2)
    expect(chooseFile([ep(1, 100), ep(2, 100), ep(3)])).toBe(2)
  })

  it('берётся самая поздняя серия с прогрессом, даже если ранние пропущены', () => {
    expect(chooseFile([ep(1, 100), ep(2), ep(3, 95), ep(4)])).toBe(3)
  })

  it('порядок по сезону и серии, а не по положению в списке', () => {
    const files = [ep(2, 0, 2), ep(1, 100, 2), ep(10, 100, 1)]
    expect(chooseFile(files)).toBe(0) // S2E1 досмотрена -> S2E2
  })

  it('финальная серия досмотрена - выбор за человеком', () => {
    expect(chooseFile([ep(1, 100), ep(2, 100)])).toBeNull()
  })

  it('несколько файлов без номеров серий - выбор за человеком', () => {
    expect(chooseFile([{ percent: 0 }, { percent: 0 }])).toBeNull()
  })
})
