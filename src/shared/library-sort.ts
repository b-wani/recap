/** 라이브러리 창의 정렬 순수 로직 — `RecordingSummary` 목록을 정렬 키에 따라 정렬한다. */

import type { RecordingSummary } from './ipc'

/** 라이브러리 정렬 셀렉트의 세 옵션. `newest` 가 기본(storage 가 이미 이 순서로 반환). */
export type LibrarySortKey = 'newest' | 'oldest' | 'duration'

/** 원본 배열을 바꾸지 않고 정렬된 새 배열을 돌려준다. */
export function sortRecordings(
  list: readonly RecordingSummary[],
  key: LibrarySortKey
): RecordingSummary[] {
  const copy = [...list]
  switch (key) {
    case 'newest':
      return copy.sort((a, b) => b.startedAt - a.startedAt)
    case 'oldest':
      return copy.sort((a, b) => a.startedAt - b.startedAt)
    case 'duration':
      return copy.sort((a, b) => b.durationMs - a.durationMs)
  }
}
