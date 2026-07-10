import { useEffect, useState } from 'react'
import type { RecordingSummary } from '../../../shared/ipc'
import { sortRecordings, type LibrarySortKey } from '../../../shared/library-sort'
import { filterByTitle } from '../../../shared/library-search'
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
 *
 * 항목 관리(#79): 카드 `⋯`/우클릭 메뉴에서 이름변경·파일 위치 열기·삭제. 헤더 검색이
 * title로 필터한다.
 */
export function LibraryView(): JSX.Element {
  const [recordings, setRecordings] = useState<RecordingSummary[]>([])
  const [sortKey, setSortKey] = useState<LibrarySortKey>('newest')
  const [query, setQuery] = useState('')
  const [menuFolder, setMenuFolder] = useState<string | null>(null)
  const [editingFolder, setEditingFolder] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  useEffect(() => {
    window.hoppy.listRecordings().then(setRecordings)
  }, [])

  const filtered = filterByTitle(sortRecordings(recordings, sortKey), query)

  function openMenu(folder: string, e: React.MouseEvent): void {
    e.preventDefault()
    e.stopPropagation()
    setMenuFolder(folder)
  }

  function closeMenu(): void {
    setMenuFolder(null)
  }

  function startRename(r: RecordingSummary, e: React.MouseEvent): void {
    e.stopPropagation()
    setMenuFolder(null)
    setEditingFolder(r.folder)
    setEditValue(r.title)
  }

  async function commitRename(folder: string): Promise<void> {
    const title = editValue.trim()
    setEditingFolder(null)
    if (!title) return
    await window.hoppy.renameRecording(folder, title)
    setRecordings((prev) => prev.map((r) => (r.folder === folder ? { ...r, title } : r)))
  }

  function reveal(folder: string, e: React.MouseEvent): void {
    e.stopPropagation()
    setMenuFolder(null)
    window.hoppy.revealRecording(folder)
  }

  async function remove(folder: string, e: React.MouseEvent): Promise<void> {
    e.stopPropagation()
    setMenuFolder(null)
    const deleted = await window.hoppy.trashRecording(folder)
    if (deleted) setRecordings((prev) => prev.filter((r) => r.folder !== folder))
  }

  return (
    <div className="library">
      <header className="library-header">
        <h1 className="library-title">라이브러리</h1>
        <div className="library-header-controls">
          <input
            type="search"
            className="library-search"
            placeholder="제목으로 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="제목으로 검색"
          />
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
        </div>
      </header>

      {recordings.length === 0 ? (
        <div className="library-empty">
          <HoppyMascot className="library-mascot" />
          <h2>아직 담긴 녹화가 없어요</h2>
          <p>
            어디서든 <kbd>⌥⌘R</kbd> 로 첫 녹화를 시작해보세요.
          </p>
        </div>
      ) : (
        <div className="library-grid">
          {filtered.map((r) => (
            <div
              key={r.folder}
              className="library-card"
              role="button"
              tabIndex={0}
              onClick={() => window.hoppy.openEditor(r.folder)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') window.hoppy.openEditor(r.folder)
              }}
              onContextMenu={(e) => openMenu(r.folder, e)}
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

              <button
                type="button"
                className="library-card-menu-btn"
                aria-label="항목 관리"
                onClick={(e) => openMenu(r.folder, e)}
              >
                ⋯
              </button>

              {menuFolder === r.folder && (
                <LibraryCardMenu
                  onClose={closeMenu}
                  onRename={(e) => startRename(r, e)}
                  onReveal={(e) => reveal(r.folder, e)}
                  onDelete={(e) => void remove(r.folder, e)}
                />
              )}

              <span className="library-card-body">
                {editingFolder === r.folder ? (
                  <input
                    autoFocus
                    className="library-card-title-input"
                    value={editValue}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={() => void commitRename(r.folder)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void commitRename(r.folder)
                      if (e.key === 'Escape') setEditingFolder(null)
                    }}
                  />
                ) : (
                  <span className="library-card-title-text">{r.title}</span>
                )}
                <span className="library-card-meta">
                  {formatDate(r.startedAt)} · {formatElapsed(r.durationMs)} · 이벤트{' '}
                  {r.eventCount}개
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** 카드 `⋯`/우클릭이 여는 항목 관리 드롭다운. 배경 클릭으로 닫는다(파괴적 액션만 레드). */
function LibraryCardMenu(props: {
  onClose: () => void
  onRename: (e: React.MouseEvent) => void
  onReveal: (e: React.MouseEvent) => void
  onDelete: (e: React.MouseEvent) => void
}): JSX.Element {
  return (
    <>
      <div
        className="library-card-menu-backdrop"
        onClick={(e) => {
          e.stopPropagation()
          props.onClose()
        }}
      />
      <div className="library-card-menu" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="library-card-menu-item" onClick={props.onRename}>
          이름 변경
        </button>
        <button type="button" className="library-card-menu-item" onClick={props.onReveal}>
          파일 위치 열기
        </button>
        <button
          type="button"
          className="library-card-menu-item is-destructive"
          onClick={props.onDelete}
        >
          삭제
        </button>
      </div>
    </>
  )
}
