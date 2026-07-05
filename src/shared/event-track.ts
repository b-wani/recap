/**
 * 이벤트 트랙 도메인 타입 — 원본 영상과 분리 저장되는 마우스 이벤트 로그.
 *
 * 사이드카 프로토콜(main)과 자동 효과 파이프라인(shared), 미리보기(renderer)가
 * 공유하는 순수 타입이라 shared에 둔다. Electron·Canvas·WebCodecs에 의존하지 않는다.
 */

/** 재현 대상 커서 모양 3종. 그 외는 arrow로 대체된다 (SPEC 커서 렌더링). */
export type CursorKind = 'arrow' | 'pointer' | 'ibeam'

/** 마우스 이벤트 종류. 스크롤·호버는 이벤트 트랙에 기록하지 않는다. */
export type MouseEventKind = 'move' | 'down' | 'up'

/** 마우스 이벤트 하나 — 이벤트 트랙의 원소. */
export interface MouseSample {
  /** 녹화 시작(startedAt)으로부터의 경과 시간 (ms). */
  t: number
  kind: MouseEventKind
  /** 원본 좌표계 기준 위치 (좌상단 원점). */
  x: number
  y: number
  cursor: CursorKind
}

/**
 * 이벤트 트랙 — 원본 영상과 분리 저장되는 마우스 이벤트 로그(events.json의 형태).
 * 자동 효과(줌 구간) 유도의 입력이 된다.
 */
export interface EventTrack {
  protocolVersion: number
  startedAt: number
  durationMs: number
  samples: MouseSample[]
}
