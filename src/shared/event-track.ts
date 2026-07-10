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

/** 캡처 대상 종류 — 디스플레이(전체 화면) 또는 개별 창. */
export type CaptureTargetKind = 'display' | 'window'

/**
 * 사각형(포인트). 좌표 원점 규약은 쓰이는 필드(CaptureTarget.frame·sourceRect)의
 * 설명을 따른다 — 두 필드 모두 전역 좌표지만 y 원점 규약이 다르다.
 */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 녹화 대상 후보. 사이드카 `list` 명령이 열거하고, 본체는 이 중 하나의 `id`를 골라
 * `record --target <id>`로 넘긴다. width·height는 대상의 논리 크기(포인트)이며,
 * 이벤트 좌표가 놓이는 좌표 공간의 경계다 (좌상단 원점).
 */
export interface CaptureTarget {
  kind: CaptureTargetKind
  /** 사이드카에 넘기는 안정적 식별자. `display:<번호>` 또는 `window:<CGWindowID>`. */
  id: string
  /** 사람이 읽는 이름 (디스플레이명 또는 "앱 — 창 제목"). */
  title: string
  /** 대상 폭 (포인트). 이벤트 x 좌표의 상한. */
  width: number
  /** 대상 높이 (포인트). 이벤트 y 좌표의 상한. */
  height: number
  /**
   * 창 프레임 — 전역 AppKit 좌표(좌하단 원점, 포인트). `window` 대상만 싣는다.
   * Window 선택 오버레이가 커서 아래 창 프레임을 그리는 데 쓴다. 사이드카 v4(프로토콜 4)가
   * 채우며, display 대상과 이전 버전 호환을 위해 선택적이다. 이벤트 좌표 계약과는 무관하다.
   */
  frame?: Rect
  /**
   * Area crop 원본 사각형 — 전역 좌표(포인트). Area 캡처일 때만 싣는다. 이때 부모 `kind`는
   * 여전히 `display`이고 width/height는 crop 크기로 접혀 있다 — 다운스트림은 kind 분기를
   * 늘리지 않고 좌표 공간 크기만 crop 크기로 본다. 사이드카 v4(프로토콜 4)가 채운다.
   */
  sourceRect?: Rect
}

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
 * 키 입력 하나 — 녹화 중 누른 단축키·특수키의 정규화된 조합 문자열.
 * 프라이버시상 수식키(⌘⌥⇧⌃) 조합과 특수키(Enter/Tab/Esc/화살표/Delete 등)만 기록하고,
 * 수식키 없는 일반 타이핑 문자는 담지 않는다. 마우스 이벤트와 분리 저장된다.
 */
export interface KeySample {
  /** 녹화 시작(startedAt)으로부터의 경과 시간 (ms). */
  t: number
  /** 정규화된 조합 문자열 (예: "⌘S", "⌥⌘I", "Enter"). */
  combo: string
}

/**
 * 이벤트 트랙 — 원본 영상과 분리 저장되는 마우스 이벤트 로그(events.json의 형태).
 * 자동 효과(줌 구간) 유도의 입력이 된다.
 */
export interface EventTrack {
  protocolVersion: number
  startedAt: number
  durationMs: number
  /**
   * 좌표가 놓인 캡처 대상 (전체 화면 또는 특정 창). 자동 줌·커서 좌표는 이 경계
   * (좌상단 원점) 안에 놓인다. 사이드카 v2가 채운다. 대상 정보 없이 만든 이벤트
   * 트랙(예: 테스트 픽스처)과의 호환을 위해 선택적이다.
   */
  target?: CaptureTarget
  samples: MouseSample[]
  /**
   * 키 입력 로그 — 단축키·특수키만. 마우스 samples와 분리한다. 사이드카 v3(프로토콜 3)가
   * 채운다. 키 데이터 없이 만든 이벤트 트랙(v1/v2 픽스처)과의 호환을 위해 선택적이다.
   */
  keys?: KeySample[]
}
