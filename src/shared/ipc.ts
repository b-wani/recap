/** 본체 ↔ 렌더러 IPC 계약. 채널 이름과 상태 모양을 양쪽이 공유한다. */

import type { CaptureTarget, EventTrack } from './event-track'
import type { RenderRecipe } from './recipe'

export type { CaptureTarget }

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
  /** 저장된 녹화 하나를 다시 열어 미리보기 상태로 복원한다. */
  OpenRecording: 'recording:open',
  /** 익스포트 바이트를 녹화 폴더에 저장한다(포맷에 따라 export.mp4 / export.gif). */
  ExportSave: 'export:save',
  /** 저장된 파일을 Finder에서 연다. */
  ExportReveal: 'export:reveal',
  /** 저장된 파일 경로를 클립보드에 복사한다. */
  ExportCopyPath: 'export:copy-path',
  /** 편집기 진입/이탈에 맞춰 창 크기를 조절한다(편집기는 넓게, 그 외엔 원래 크기). */
  SetEditorMode: 'window:editor-mode',
  /** 지정 role 의 창을 연다(이미 열린 싱글톤이면 focus). 새 창의 windowId 를 돌려준다. */
  WindowOpen: 'window:open',
  /** 창 생성 시 main 이 넣어 둔 초기 컨텍스트를 windowId 로 당겨온다(렌더러 부팅 pull). */
  WindowGetContext: 'window:get-context',
  /** 캡처 툴바에서 고른 모드로 녹화를 시작한다(Display 는 주 디스플레이). arming→recording. */
  CaptureStart: 'capture:start',
  /** arming 취소 — 캡처 툴바·오버레이를 닫고 idle 로 되돌린다(Esc/✕). */
  CaptureCancel: 'capture:cancel',
  /** 온보딩 완료를 로컬(userData)에 저장한다(마지막 단계 완료 액션). */
  OnboardingComplete: 'onboarding:complete',
  /** 화면 녹화·손쉬운 사용 권한의 granted 여부를 조회한다(온보딩 권한 단계 폴링). */
  PermissionStatus: 'permissions:status',
  /** 지정한 권한 종류의 시스템 설정 패널을 연다(화면 녹화는 열기 전 TCC 목록 등록). */
  OpenPermissionSettings: 'permissions:open-settings',
  /** 권한 적용을 위한 재시작 확인 다이얼로그를 띄우고, 수락 시 앱을 재시작한다. */
  ConfirmRestart: 'app:confirm-restart'
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

/** 녹화 워크플로의 상태 머신. 렌더러는 이 상태만 보고 화면을 그린다. */
export type RecordingState =
  | { status: 'idle' }
  /** 캡처 툴바가 떠 대상·모드를 고르는 중(녹화 전). ⌥⌘R/메뉴바 소환으로 진입, Esc/✕로 idle. */
  | { status: 'arming' }
  | { status: 'recording'; startedAt: number; eventCount: number; target: CaptureTarget }
  | {
      status: 'preview'
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
  | { status: 'error'; code: string; message: string }
