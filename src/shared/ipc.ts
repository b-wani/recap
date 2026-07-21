/** 본체 ↔ 렌더러 IPC 계약. 채널 이름과 상태 모양을 양쪽이 공유한다. */

import type { CaptureTarget, EventTrack, Rect } from './event-track'
import type { RenderRecipe } from './recipe'

export type { CaptureTarget, Rect }

export const IpcChannel = {
  /** 선택 가능한 캡처 대상(전체 화면 + 열린 창) 목록을 조회한다. */
  ListTargets: 'recording:list-targets',
  Start: 'recording:start',
  Stop: 'recording:stop',
  State: 'recording:state',
  /** 렌더러가 유도·편집한 렌더 레시피를 녹화 폴더에 저장한다. */
  SaveRecipe: 'recipe:save',
  /** 로컬에 저장된 최근 녹화 목록을 가져온다. */
  ListRecordings: 'recordings:list',
  /** 미리보기 첫 프레임 썸네일(JPEG)을 녹화 폴더에 캐시로 저장한다. */
  SaveThumbnail: 'thumbnail:save',
  /** 저장된 녹화를 독립 에디터 창으로 연다(다중 인스턴스, #75). */
  EditorOpen: 'editor:open',
  /** 익스포트한 바이트를 녹화 폴더에 저장한다(포맷 인자로 `export.{ext}` 일반화, #155). */
  ExportSave: 'export:save',
  /** 저장된 파일을 Finder에서 연다. */
  ExportReveal: 'export:reveal',
  /** 저장된 파일(실제 미디어)을 클립보드에 파일 참조로 복사한다 — Dooray 본문에 ⌘V 첨부(#159). */
  ExportCopyMedia: 'export:copy-media',
  /** 녹화 제목을 바꿔 manifest에 저장한다(#79 라이브러리 이름변경). */
  RenameRecording: 'recordings:rename',
  /** 확인 다이얼로그 후 녹화 폴더를 휴지통으로 옮긴다. 취소되면 false. */
  TrashRecording: 'recordings:trash',
  /** 녹화 폴더를 Finder에서 연다(파일 위치 열기). */
  RevealRecording: 'recordings:reveal',
  /** 지정 role 의 창을 연다(이미 열린 싱글톤이면 focus). 새 창의 windowId 를 돌려준다. */
  WindowOpen: 'window:open',
  /** 창 생성 시 main 이 넣어 둔 초기 컨텍스트를 windowId 로 당겨온다(렌더러 부팅 pull). */
  WindowGetContext: 'window:get-context',
  /** Display 선택 오버레이가 고른 대상(targetId)으로 녹화를 시작한다(#71). arming→recording. */
  CaptureStart: 'capture:start',
  /** arming 취소 — 캡처 툴바·오버레이를 닫고 idle 로 되돌린다(Esc/✕). */
  CaptureCancel: 'capture:cancel',
  /** 캡처 모드 전환을 알린다 — 모드별 선택 오버레이를 띄우고, 다른 종류는 닫는다(#71/#73/#72). */
  CaptureSetMode: 'capture:set-mode',
  /**
   * 3-2-1 카운트다운 설정을 main 에 반영한다(#71). 선택 오버레이는 툴바와 다른 창(프로세스)이라
   * 로컬 React state 를 공유할 수 없어, 오버레이 생성 시 컨텍스트로 스냅샷을 실어 보낸다.
   */
  CaptureSetCountdown: 'capture:set-countdown',
  /** Window 선택 오버레이의 호버 상태 변화 — main 이 오버레이 창의 클릭스루 여부를 토글한다(#73). */
  OverlayHover: 'overlay:hover',
  /** Window 선택 오버레이에서 창을 클릭해 확정 — 그 대상으로 녹화를 시작한다(#73). */
  OverlaySelect: 'overlay:select',
  /** Area 오버레이에서 확정한 로컬 rect 로 crop 녹화를 시작한다(#72). */
  CaptureAreaConfirm: 'capture:area-confirm',
  /** 온보딩 완료를 로컬(userData)에 저장한다(마지막 단계 완료 액션). */
  OnboardingComplete: 'onboarding:complete',
  /** 화면 녹화·손쉬운 사용 권한의 granted 여부를 조회한다(온보딩 권한 단계 폴링). */
  PermissionStatus: 'permissions:status',
  /** 지정한 권한 종류의 시스템 설정 패널을 연다(화면 녹화는 열기 전 TCC 목록 등록). */
  OpenPermissionSettings: 'permissions:open-settings',
  /** 권한 적용을 위한 재시작 확인 다이얼로그를 띄우고, 수락 시 앱을 재시작한다. */
  ConfirmRestart: 'app:confirm-restart',
  /** 현재 레시피의 스타일(배경/커서)을 이름 붙여 앱 전역 프리셋으로 저장한다(#77). */
  PresetSave: 'presets:save',
  /** 저장된 스타일 프리셋 목록을 가져온다(#77). */
  PresetList: 'presets:list',
  /** 스타일 프리셋을 삭제한다(#77). */
  PresetDelete: 'presets:delete'
} as const

/** 최근 녹화 목록의 한 항목 — 다시 열기 UI가 그린다. */
export interface RecordingSummary {
  /** 녹화 폴더 절대 경로. 다시 열기의 식별자. */
  folder: string
  /** 폴더 이름 (timestamp). 목록 라벨. */
  name: string
  /** 녹화 시작 시점 (Unix epoch ms). 최신순 정렬 기준. */
  startedAt: number
  durationMs: number
  eventCount: number
  /** 표시용 제목 — manifest에 사용자 지정 title이 있으면 그 값, 없으면 `name`(폴더 이름) 폴백(#79). */
  title: string
  /** 첫 프레임 썸네일 캐시의 미리보기 URL. 캐시가 없는 구버전 녹화면 없음. */
  thumbnailUrl?: string
}

/** 익스포트 저장 결과 — 렌더러가 완료 UI(경로·용량·경고)를 그리는 데 쓴다. */
export interface ExportSaveResult {
  /** 저장된 파일 절대 경로. */
  path: string
  /** 저장된 파일 크기(bytes). 용량 상한 초과 판정에 쓴다. */
  sizeBytes: number
}

/** 캡처 툴바의 3모드. 활성 모드에 따라 자식 선택 오버레이(#71~#73)가 다르게 그려진다. */
export type CaptureMode = 'display' | 'window' | 'area'

/**
 * Window 선택 오버레이 창의 초기 컨텍스트(#73) — main 이 창 생성 시 넣어 둔다.
 * 오버레이는 전체 가상 데스크톱(모든 디스플레이 bounds 합집합)을 덮는 단일 창이라,
 * flipped 좌표(Electron 화면 좌표)를 오버레이 로컬 DOM 좌표로 옮기려면 자신의 전역
 * 원점(originX/Y)을 알아야 한다. screenHeightPt는 flip 환산의 기준(주 디스플레이 높이).
 */
export interface WindowPickerOverlayContext {
  kind: 'window-picker'
  screenHeightPt: number
  originX: number
  originY: number
}

/**
 * Area 선택 오버레이 창의 초기 컨텍스트(#72). 오버레이는 주 디스플레이 하나를 정확히
 * 덮는 창이고 확정 rect 는 오버레이 로컬(DIP) 그대로 main 에 넘기므로(전역 매핑은 main
 * 책임) 판별자 외 페이로드가 없다.
 */
export interface AreaOverlayContext {
  kind: 'area'
}

/**
 * Display 선택 오버레이 창의 초기 컨텍스트(#71). 디스플레이당 창 하나 — 각 창이 자기
 * 디스플레이의 대상 id 와 배지용 논리 해상도를 받는다. FPS 는 사이드카 고정값(60)이라
 * 싣지 않는다. 카운트다운 설정은 툴바 로컬 state 의 생성 시점 스냅샷이다.
 */
export interface DisplayOverlayContext {
  kind: 'display'
  /** 사이드카에 넘길 대상 id(`display:<번호>`) — Start 확정 시 그대로 녹화를 시작한다. */
  targetId: string
  /** 배지에 보일 논리 해상도(포인트). */
  width: number
  height: number
  /** 툴바 설정 팝오버의 3-2-1 카운트다운 토글 스냅샷. */
  countdownEnabled: boolean
}

/** role 'overlay' 창의 초기 컨텍스트 — 렌더러가 `kind` 로 어떤 오버레이인지 분기한다. */
export type OverlayContext = WindowPickerOverlayContext | AreaOverlayContext | DisplayOverlayContext

/** 녹화 워크플로의 상태 머신. 렌더러는 이 상태만 보고 화면을 그린다. 전역 `preview` 상태는
 * 없다(#75) — 녹화 정지 시 main이 저장 후 독립 에디터 창을 자동 생성하고, 전역 상태는 idle로 복귀한다. */
export type RecordingState =
  | { status: 'idle' }
  /** 캡처 툴바가 떠 대상·모드를 고르는 중(녹화 전). ⌥⌘R/메뉴바 소환으로 진입, Esc/✕로 idle. */
  | { status: 'arming' }
  | { status: 'recording'; startedAt: number; eventCount: number; target: CaptureTarget }
  | { status: 'error'; code: string; message: string }

/**
 * 에디터 창의 초기 컨텍스트(#75) — main이 `editor:open` 처리 시 창 생성과 함께 넣어 두고,
 * 렌더러가 `window:get-context`로 당겨온다(pull 모델). 에디터 창은 이 페이로드를 창 로컬
 * 상태로 소유하며, 전역 캡처 상태를 구독하지 않는다.
 */
export interface EditorContext {
  /** 원본 미리보기 재생용 URL (recap-media 프로토콜). */
  videoUrl: string
  folder: string
  durationMs: number
  eventCount: number
  /** 녹화된 캡처 대상 (전체 화면 또는 특정 창). */
  target: CaptureTarget
  /** 자동 효과(줌 구간) 유도의 입력. 렌더러가 이걸로 렌더 레시피를 만든다. */
  eventTrack: EventTrack
  /**
   * 저장된 렌더 레시피(편집 상태). 다시 연 녹화면 이 값으로 복원하고,
   * 갓 끝난 녹화(또는 레시피 미저장)면 없으므로 렌더러가 이벤트 트랙에서 유도한다.
   */
  recipe?: RenderRecipe
}
