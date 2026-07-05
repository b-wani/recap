/** 본체 ↔ 렌더러 IPC 계약. 채널 이름과 상태 모양을 양쪽이 공유한다. */

import type { EventTrack } from './event-track'

export const IpcChannel = {
  Start: 'recording:start',
  Stop: 'recording:stop',
  State: 'recording:state'
} as const

/** 녹화 워크플로의 상태 머신. 렌더러는 이 상태만 보고 화면을 그린다. */
export type RecordingState =
  | { status: 'idle' }
  | { status: 'recording'; startedAt: number; eventCount: number }
  | {
      status: 'preview'
      /** 원본 미리보기 재생용 URL (devscreen-media 프로토콜). */
      videoUrl: string
      folder: string
      durationMs: number
      eventCount: number
      /** 자동 효과(줌 구간) 유도의 입력. 렌더러가 이걸로 렌더 레시피를 만든다. */
      eventTrack: EventTrack
    }
  | { status: 'error'; code: string; message: string }
