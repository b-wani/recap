import { describe, it, expect } from 'vitest'
import { sortRecordings } from './library-sort'
import type { RecordingSummary } from './ipc'

function summary(overrides: Partial<RecordingSummary>): RecordingSummary {
  return {
    folder: '/tmp/x',
    name: 'x',
    startedAt: 0,
    durationMs: 0,
    eventCount: 0,
    ...overrides
  }
}

describe('sortRecordings', () => {
  const list: RecordingSummary[] = [
    summary({ folder: 'a', startedAt: 100, durationMs: 5000 }),
    summary({ folder: 'b', startedAt: 300, durationMs: 1000 }),
    summary({ folder: 'c', startedAt: 200, durationMs: 9000 })
  ]

  it('newest: startedAt 내림차순', () => {
    expect(sortRecordings(list, 'newest').map((r) => r.folder)).toEqual(['b', 'c', 'a'])
  })

  it('oldest: startedAt 오름차순', () => {
    expect(sortRecordings(list, 'oldest').map((r) => r.folder)).toEqual(['a', 'c', 'b'])
  })

  it('duration: durationMs 내림차순', () => {
    expect(sortRecordings(list, 'duration').map((r) => r.folder)).toEqual(['c', 'a', 'b'])
  })

  it('원본 배열을 변형하지 않는다', () => {
    const before = [...list]
    sortRecordings(list, 'oldest')
    expect(list).toEqual(before)
  })
})
