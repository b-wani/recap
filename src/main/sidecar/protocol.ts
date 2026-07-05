/**
 * 사이드카 프로토콜 — Swift 캡처 사이드카와 Electron 본체 사이의 명시적 계약.
 *
 * ADR 0001에 따라 사이드카는 "한 번 만들면 안 건드리는" 층이다. 본체는 이 계약만
 * 알면 되고, 사이드카는 원본 영상 기록과 마우스 이벤트 스트리밍만 담당한다.
 * 효과 로직은 이 경계 어디에도 없다.
 *
 * 전송 형식: 사이드카는 stdout에 newline-delimited JSON(JSONL)으로 메시지를 흘리고,
 * 본체는 stdin에 명령 한 줄을 쓴다. 문서화된 계약은 docs/sidecar-protocol.md 참고.
 */

import type {
  CursorKind,
  MouseEventKind,
  MouseSample,
  EventTrack,
  CaptureTarget,
  CaptureTargetKind
} from '../../shared/event-track'

// 이벤트 트랙·캡처 대상 도메인 타입은 shared에 있다 (자동 효과 파이프라인·미리보기도 공유).
// 기존 소비자와의 호환을 위해 여기서 재노출한다.
export type { CursorKind, MouseEventKind, MouseSample, EventTrack, CaptureTarget, CaptureTargetKind }

/** 계약 버전. 호환 불가능한 변경 시 올린다. ready 메시지로 본체가 검증한다. */
export const SIDECAR_PROTOCOL_VERSION = 2

/** 본체 → 사이드카 명령. 사이드카 stdin에 한 줄씩 쓴다. */
export const SidecarCommand = {
  /** 녹화 정지. 사이드카는 원본 파일을 마무리하고 stopped를 보낸 뒤 종료한다. */
  Stop: 'stop'
} as const

/** `list` 명령의 응답 — 선택 가능한 캡처 대상 목록. 이 스트림의 유일한 메시지. */
export interface TargetListMessage {
  type: 'targets'
  protocolVersion: number
  targets: CaptureTarget[]
}

/** 사이드카가 준비되어 원본 기록을 시작했음을 알린다. 스트림의 첫 메시지. */
export interface ReadyMessage {
  type: 'ready'
  protocolVersion: number
  /** 원본 영상이 기록될 파일의 절대 경로. */
  rawVideoPath: string
  /** 녹화 시작 시점 (Unix epoch ms). 이후 event.t의 기준점. */
  startedAt: number
  /** 실제로 캡처 중인 대상. 이후 event.x/y가 이 대상의 좌표계(좌상단 원점) 기준이다. */
  target: CaptureTarget
}

/** 마우스 이벤트 하나 — 이벤트 트랙의 원소. */
export interface EventMessage {
  type: 'event'
  kind: MouseEventKind
  /** 녹화 시작(ready.startedAt)으로부터의 경과 시간 (ms). */
  t: number
  /** 캡처 대상 좌표계 기준 위치 (대상의 좌상단이 원점, 포인트 단위). */
  x: number
  y: number
  cursor: CursorKind
}

/** 녹화가 정상 종료되고 원본 파일이 기록되었음을 알린다. 스트림의 마지막 메시지. */
export interface StoppedMessage {
  type: 'stopped'
  /** 원본 영상의 최종 절대 경로 (ready와 동일해야 한다). */
  rawVideoPath: string
  /** 녹화 길이 (ms). */
  durationMs: number
  /** 사이드카가 스트리밍한 이벤트 총 개수. 본체 집계와 대조용. */
  eventCount: number
}

/** 화면 녹화 권한 없음 등 복구 불가능한 오류. 녹화는 조용히 실패하지 않는다. */
export type SidecarErrorCode =
  | 'permission-denied' // ScreenCaptureKit 화면 녹화 권한 없음
  | 'no-display' // 캡처할 디스플레이를 찾지 못함
  | 'capture-failed' // ScreenCaptureKit 캡처 실패
  | 'target-not-found' // --target으로 지정한 창/디스플레이가 사라짐

export interface ErrorMessage {
  type: 'error'
  code: SidecarErrorCode
  message: string
}

export type SidecarMessage =
  | ReadyMessage
  | EventMessage
  | StoppedMessage
  | ErrorMessage
  | TargetListMessage

/** 녹화 참조 — 원본 영상 파일과 그 메타데이터를 가리킨다. */
export interface RecordingRef {
  rawVideoPath: string
  startedAt: number
  durationMs: number
  /** 녹화된 캡처 대상 (전체 화면 또는 특정 창). */
  target: CaptureTarget
}

/** 세션 전체를 접은 결과. 성공 시 원본 참조와 이벤트 트랙이 분리되어 나온다. */
export type SidecarOutcome =
  | { ok: true; recording: RecordingRef; eventTrack: EventTrack }
  | { ok: false; error: ErrorMessage }

/** 계약 위반(파싱 불가, 순서 위반 등) 시 던지는 오류. */
export class SidecarProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SidecarProtocolError'
  }
}

const CURSOR_KINDS: readonly CursorKind[] = ['arrow', 'pointer', 'ibeam']
const EVENT_KINDS: readonly MouseEventKind[] = ['move', 'down', 'up']
const TARGET_KINDS: readonly CaptureTargetKind[] = ['display', 'window']
const ERROR_CODES: readonly SidecarErrorCode[] = [
  'permission-denied',
  'no-display',
  'capture-failed',
  'target-not-found'
]

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

/** 캡처 대상 하나를 검증·정규화한다. 계약을 벗어나면 SidecarProtocolError. */
function parseTarget(raw: unknown, where: string): CaptureTarget {
  if (typeof raw !== 'object' || raw === null)
    throw new SidecarProtocolError(`${where}: target가 객체가 아니다`)
  const t = raw as Record<string, unknown>
  if (!TARGET_KINDS.includes(t.kind as CaptureTargetKind))
    throw new SidecarProtocolError(`${where}: 알 수 없는 target.kind ${String(t.kind)}`)
  if (!isNonEmptyString(t.id)) throw new SidecarProtocolError(`${where}: target.id 누락`)
  if (typeof t.title !== 'string') throw new SidecarProtocolError(`${where}: target.title 누락`)
  if (!isFiniteNumber(t.width) || !isFiniteNumber(t.height))
    throw new SidecarProtocolError(`${where}: target 크기 누락`)
  return {
    kind: t.kind as CaptureTargetKind,
    id: t.id,
    title: t.title,
    width: t.width,
    height: t.height
  }
}

/**
 * 사이드카 stdout 한 줄을 타입 있는 메시지로 파싱·검증한다.
 * 계약을 벗어난 줄이면 SidecarProtocolError를 던진다 — 조용히 무시하지 않는다.
 */
export function parseSidecarLine(line: string): SidecarMessage {
  const trimmed = line.trim()
  let raw: unknown
  try {
    raw = JSON.parse(trimmed)
  } catch {
    throw new SidecarProtocolError(`JSON이 아닌 줄: ${truncate(trimmed)}`)
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new SidecarProtocolError(`객체가 아닌 메시지: ${truncate(trimmed)}`)
  }
  const msg = raw as Record<string, unknown>

  switch (msg.type) {
    case 'targets':
      if (!isFiniteNumber(msg.protocolVersion))
        throw new SidecarProtocolError('targets: protocolVersion 누락')
      if (!Array.isArray(msg.targets))
        throw new SidecarProtocolError('targets: targets 배열 누락')
      return {
        type: 'targets',
        protocolVersion: msg.protocolVersion,
        targets: msg.targets.map((t) => parseTarget(t, 'targets'))
      }

    case 'ready':
      if (!isFiniteNumber(msg.protocolVersion))
        throw new SidecarProtocolError('ready: protocolVersion 누락')
      if (!isNonEmptyString(msg.rawVideoPath))
        throw new SidecarProtocolError('ready: rawVideoPath 누락')
      if (!isFiniteNumber(msg.startedAt))
        throw new SidecarProtocolError('ready: startedAt 누락')
      return {
        type: 'ready',
        protocolVersion: msg.protocolVersion,
        rawVideoPath: msg.rawVideoPath,
        startedAt: msg.startedAt,
        target: parseTarget(msg.target, 'ready')
      }

    case 'event':
      if (!EVENT_KINDS.includes(msg.kind as MouseEventKind))
        throw new SidecarProtocolError(`event: 알 수 없는 kind ${String(msg.kind)}`)
      if (!isFiniteNumber(msg.t)) throw new SidecarProtocolError('event: t 누락')
      if (!isFiniteNumber(msg.x) || !isFiniteNumber(msg.y))
        throw new SidecarProtocolError('event: 좌표 누락')
      if (!CURSOR_KINDS.includes(msg.cursor as CursorKind))
        throw new SidecarProtocolError(`event: 알 수 없는 cursor ${String(msg.cursor)}`)
      return {
        type: 'event',
        kind: msg.kind as MouseEventKind,
        t: msg.t,
        x: msg.x,
        y: msg.y,
        cursor: msg.cursor as CursorKind
      }

    case 'stopped':
      if (!isNonEmptyString(msg.rawVideoPath))
        throw new SidecarProtocolError('stopped: rawVideoPath 누락')
      if (!isFiniteNumber(msg.durationMs))
        throw new SidecarProtocolError('stopped: durationMs 누락')
      if (!isFiniteNumber(msg.eventCount))
        throw new SidecarProtocolError('stopped: eventCount 누락')
      return {
        type: 'stopped',
        rawVideoPath: msg.rawVideoPath,
        durationMs: msg.durationMs,
        eventCount: msg.eventCount
      }

    case 'error':
      if (!ERROR_CODES.includes(msg.code as SidecarErrorCode))
        throw new SidecarProtocolError(`error: 알 수 없는 code ${String(msg.code)}`)
      return {
        type: 'error',
        code: msg.code as SidecarErrorCode,
        message: isNonEmptyString(msg.message) ? msg.message : ''
      }

    default:
      throw new SidecarProtocolError(`알 수 없는 메시지 type: ${String(msg.type)}`)
  }
}

/**
 * 세션의 전체 메시지를 접어 녹화 참조와 이벤트 트랙으로 분리한다.
 * 이것이 "사이드카가 보낸 것 → 본체의 이벤트 트랙·녹화 참조" 계약의 핵심이다.
 *
 * - error 메시지가 있으면 즉시 실패 결과를 반환한다 (권한 거부 등).
 * - 성공하려면 ready로 시작해 stopped로 끝나야 한다.
 * - 이벤트 트랙은 원본 영상 경로와 분리된 samples 배열로 나온다.
 */
export function foldSidecarMessages(messages: SidecarMessage[]): SidecarOutcome {
  const errorMsg = messages.find((m): m is ErrorMessage => m.type === 'error')
  if (errorMsg) {
    return { ok: false, error: errorMsg }
  }

  const ready = messages[0]
  if (!ready || ready.type !== 'ready') {
    throw new SidecarProtocolError('세션이 ready로 시작하지 않았다')
  }
  if (ready.protocolVersion !== SIDECAR_PROTOCOL_VERSION) {
    throw new SidecarProtocolError(
      `프로토콜 버전 불일치: 사이드카 ${ready.protocolVersion}, 본체 ${SIDECAR_PROTOCOL_VERSION}`
    )
  }

  const stopped = messages[messages.length - 1]
  if (!stopped || stopped.type !== 'stopped') {
    throw new SidecarProtocolError('세션이 stopped로 끝나지 않았다')
  }
  if (stopped.rawVideoPath !== ready.rawVideoPath) {
    throw new SidecarProtocolError('stopped의 rawVideoPath가 ready와 다르다')
  }

  const samples: MouseSample[] = messages
    .filter((m): m is EventMessage => m.type === 'event')
    .map(({ t, kind, x, y, cursor }) => ({ t, kind, x, y, cursor }))

  if (samples.length !== stopped.eventCount) {
    throw new SidecarProtocolError(
      `이벤트 개수 불일치: 스트림 ${samples.length}, stopped.eventCount ${stopped.eventCount}`
    )
  }

  return {
    ok: true,
    recording: {
      rawVideoPath: ready.rawVideoPath,
      startedAt: ready.startedAt,
      durationMs: stopped.durationMs,
      target: ready.target
    },
    eventTrack: {
      protocolVersion: ready.protocolVersion,
      startedAt: ready.startedAt,
      durationMs: stopped.durationMs,
      target: ready.target,
      samples
    }
  }
}

function truncate(s: string, max = 80): string {
  return s.length > max ? `${s.slice(0, max)}…` : s
}
