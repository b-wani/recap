import { useEffect, useState } from 'react'
import type { RecordingSummary } from '../../../shared/ipc'
import { sortRecordings, type LibrarySortKey } from '../../../shared/library-sort'
import { formatDate, formatElapsed } from '../format'
import { HoppyMascot } from '../components/HoppyMascot'

const SORT_OPTIONS: { value: LibrarySortKey; label: string }[] = [
  { value: 'newest', label: '최신순' },
  { value: 'oldest', label: '오래된순' },
  { value: 'duration', label: '길이순' }
]

/**
 * 라이브러리 창(#78) — 녹화 전체를 썸네일 그리드로 브라우즈하는 독립 창. 최근 목록
 * 로직(IdleView 상속)에 정렬을 더한다. 카드 클릭 = 에디터 창 열기(`editor:open` 재사용).
 */
export function LibraryView(): JSX.Element {
  const [recordings, setRecordings] = useState<RecordingSummary[]>([])
  const [sortKey, setSortKey] = useState<LibrarySortKey>('newest')

  useEffect(() => {
    window.recap.listRecordings().then(setRecordings)
  }, [])

  const sorted = sortRecordings(recordings, sortKey)

  return (
    <div className="library">
      <header className="library-header">
        <h1 className="library-title">라이브러리</h1>
        <select
          className="library-sort"
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as LibrarySortKey)}
          aria-label="정렬"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </header>

      {sorted.length === 0 ? (
        <div className="library-empty">
          <HoppyMascot className="library-mascot" />
          <h2>아직 담긴 녹화가 없어요</h2>
          <p>
            어디서든 <kbd>⌥⌘R</kbd> 로 첫 녹화를 시작해보세요.
          </p>
        </div>
      ) : (
        <div className="library-grid">
          {sorted.map((r) => (
            <button
              key={r.folder}
              type="button"
              className="library-card"
              onClick={() => window.recap.openEditor(r.folder)}
            >
              <span className="library-card-thumb">
                {r.thumbnailUrl ? (
                  <img src={r.thumbnailUrl} alt="" />
                ) : (
                  <span className="library-card-thumb-fallback" aria-hidden>
                    🎬
                  </span>
                )}
                <span className="library-card-duration">{formatElapsed(r.durationMs)}</span>
              </span>
              <span className="library-card-body">
                <span className="library-card-date">{formatDate(r.startedAt)}</span>
                <span className="library-card-meta">
                  {formatElapsed(r.durationMs)} · 이벤트 {r.eventCount}개
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
