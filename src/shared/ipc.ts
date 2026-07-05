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
  /** 저장된 녹화 하나를 다시 열어 미리보기 상태로 복원한다. */
  OpenRecording: 'recording:open',
  /** 익스포트 바이트를 녹화 폴더에 저장한다(포맷에 따라 export.mp4 / export.gif). */
  ExportSave: 'export:save',
  /** 저장된 파일을 Finder에서 연다. */
  ExportReveal: 'export:reveal',
  /** 저장된 파일 경로를 클립보드에 복사한다. */
  ExportCopyPath: 'export:copy-path'
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
}

/** 익스포트 저장 결과 — 렌더러가 완료 UI(경로·용량·경고)를 그리는 데 쓴다. */
export interface ExportSaveResult {
  /** 저장된 파일 절대 경로. */
  path: string
  /** 저장된 파일 크기(bytes). 용량 상한 초과 판정에 쓴다. */
  sizeBytes: number
}

/** 녹화 워크플로의 상태 머신. 렌더러는 이 상태만 보고 화면을 그린다. */
export type RecordingState =
  | { status: 'idle' }
  | { status: 'recording'; startedAt: number; eventCount: number; target: CaptureTarget }
  | {
      status: 'preview'
      /** 원본 미리보기 재생용 URL (devscreen-media 프로토콜). */
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
