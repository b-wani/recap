import { isSection, RAIL_ITEMS, type EditorSection, type RailId } from './editor-rail'

/**
 * 캔버스↔우측 사이드바 사이 세로 아이콘 툴 레일(#162). 선택도구·커서·카메라·캡션·단축키를
 * 세로로 쌓고, 클릭 시 상위가 우측 사이드바 섹션을 전환한다. 오디오는 무음 코어 범위 밖이라
 * 비활성 표시만 한다. 아이콘은 currentColor 스트로크 SVG(무채색 골격 유지).
 */

const ICON: Record<RailId, JSX.Element> = {
  // 선택 도구 — 화살표 포인터
  select: <path d="M5 3l14 8-6 1.5L10 19 5 3z" fill="currentColor" stroke="none" />,
  // 커서 — 마우스
  cursor: (
    <>
      <rect x="7" y="3" width="10" height="18" rx="5" />
      <path d="M12 3v6" />
    </>
  ),
  // 카메라(줌) — 뷰파인더 프레임
  camera: (
    <>
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="M16 10l5-3v10l-5-3" />
    </>
  ),
  // 캡션 · 배지 — 말풍선 + 텍스트
  caption: (
    <>
      <rect x="3" y="4" width="18" height="14" rx="2" />
      <path d="M7 9h10M7 13h6" />
    </>
  ),
  // 단축키 오버레이 — 키보드
  shortcuts: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
    </>
  ),
  // 오디오(범위 밖) — 스피커
  audio: (
    <>
      <path d="M4 9v6h4l5 4V5L8 9H4z" />
      <path d="M17 8a5 5 0 010 8" />
    </>
  )
}

export function EditorRail({
  active,
  onSelect
}: {
  active: EditorSection
  onSelect: (section: EditorSection) => void
}): JSX.Element {
  return (
    <nav className="editor-rail" aria-label="편집 도구">
      {RAIL_ITEMS.map((item) => {
        const isActive = isSection(item.id) && item.id === active
        return (
          <button
            key={item.id}
            type="button"
            className={`rail-btn${isActive ? ' is-active' : ''}`}
            disabled={item.disabled}
            title={item.label}
            aria-label={item.label}
            aria-pressed={isActive}
            onClick={() => {
              if (isSection(item.id)) onSelect(item.id)
            }}
          >
            <svg
              className="rail-icon"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              {ICON[item.id]}
            </svg>
          </button>
        )
      })}
    </nav>
  )
}
