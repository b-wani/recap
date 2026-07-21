/**
 * 에디터 세로 아이콘 레일(#162)의 항목 정의 — 캔버스↔우측 사이드바 사이 툴 레일.
 * 레일 항목 선택이 우측 사이드바 섹션을 전환한다. 순수 데이터만 두어 단위테스트가 가능하게 하고,
 * 렌더(SVG 아이콘)는 EditorRail.tsx가 담당한다.
 */

/** 우측 사이드바가 그릴 수 있는 섹션(레일이 전환하는 대상). */
export type EditorSection = 'select' | 'cursor' | 'camera' | 'caption' | 'shortcuts'

/** 레일 버튼 식별자 — 섹션 + 범위 밖(비활성) 오디오. */
export type RailId = EditorSection | 'audio'

export interface RailItem {
  id: RailId
  /** 접근성 라벨 겸 툴팁. */
  label: string
  /** 무음 코어 범위 밖(오디오)은 비활성 표시. */
  disabled?: boolean
}

/** 레일 항목(위→아래 순서). 오디오는 범위 밖이라 비활성. */
export const RAIL_ITEMS: RailItem[] = [
  { id: 'select', label: '선택 도구' },
  { id: 'cursor', label: '커서' },
  { id: 'camera', label: '카메라 (줌)' },
  { id: 'caption', label: '캡션 · 배지' },
  { id: 'shortcuts', label: '단축키 오버레이' },
  { id: 'audio', label: '오디오 (범위 밖)', disabled: true }
]

/** 활성 가능한(섹션) 항목인지 — 비활성 오디오를 걸러낸다. */
export function isSection(id: RailId): id is EditorSection {
  return id !== 'audio'
}
