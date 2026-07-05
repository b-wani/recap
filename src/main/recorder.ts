import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  parseSidecarLine,
  foldSidecarMessages,
  SidecarProtocolError,
  type CaptureTarget,
  type SidecarMessage
} from './sidecar/protocol'
import type { EventTrack } from '../shared/event-track'
import { recordingsBaseDir, writeManifest, MANIFEST_VERSION } from './storage'

/**
 * 사이드카 프로세스의 수명주기를 관리한다. 본체 쪽에서 사이드카 프로토콜 계약을
 * 소비하는 유일한 지점 — stdout 스트림을 파싱해 이벤트 트랙과 녹화 참조로 접는다.
 * (파싱·접기 로직 자체는 protocol.ts에 있고 계약 테스트로 검증된다.)
 */

export interface RecordingResult {
  /** 녹화 폴더 (~/Movies/DevScreen/{timestamp}). */
  folder: string
  /** 원본 영상 파일 절대 경로. */
  videoPath: string
  /** 이벤트 트랙 파일(events.json) 절대 경로. 원본과 분리 저장된다. */
  eventsPath: string
  /** 이벤트 트랙 자체 — 렌더러가 자동 효과(줌) 유도의 입력으로 쓴다. */
  eventTrack: EventTrack
  durationMs: number
  eventCount: number
  /** 녹화된 캡처 대상 (전체 화면 또는 특정 창). */
  target: CaptureTarget
}

export interface RecorderCallbacks {
  onReady: (info: { startedAt: number; target: CaptureTarget }) => void
  onEvent: (count: number) => void
  onError: (code: string, message: string) => void
  onComplete: (result: RecordingResult) => void
}

function timestampFolderName(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
}

export class Recorder {
  private child: ChildProcessWithoutNullStreams | null = null
  private messages: SidecarMessage[] = []
  private folder = ''
  private eventCount = 0
  private finalized = false

  constructor(private readonly sidecarPath: string) {}

  get isRecording(): boolean {
    return this.child !== null
  }

  /**
   * 선택 가능한 캡처 대상(전체 화면 + 열린 창)을 사이드카에게 물어본다.
   * 사이드카를 `list` 모드로 한 번 띄워 targets 메시지 한 줄을 받고 종료시킨다.
   */
  listTargets(): Promise<CaptureTarget[]> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.sidecarPath, ['list'], { stdio: ['ignore', 'pipe', 'pipe'] })
      let settled = false
      const rl = createInterface({ input: child.stdout })
      rl.on('line', (line) => {
        if (settled || line.trim().length === 0) return
        try {
          const msg = parseSidecarLine(line)
          if (msg.type === 'targets') {
            settled = true
            resolve(msg.targets)
          } else if (msg.type === 'error') {
            settled = true
            reject(new Error(`${msg.code}: ${msg.message}`))
          }
        } catch (err) {
          if (err instanceof SidecarProtocolError) console.error('[sidecar 프로토콜 위반]', err.message)
        }
      })
      child.stderr.on('data', (d) => console.error('[sidecar]', String(d).trimEnd()))
      child.on('error', (err) => {
        if (settled) return
        settled = true
        reject(err)
      })
      child.on('exit', () => {
        if (settled) return
        settled = true
        reject(new Error('사이드카가 대상 목록을 반환하지 않고 종료되었습니다'))
      })
    })
  }

  /** 사이드카를 띄우고 지정한 대상(전체 화면 또는 특정 창)의 녹화를 시작한다. */
  async start(targetId: string, cb: RecorderCallbacks, now = new Date()): Promise<void> {
    if (this.child) throw new Error('이미 녹화 중입니다')

    this.messages = []
    this.eventCount = 0
    this.finalized = false
    this.folder = join(recordingsBaseDir(), timestampFolderName(now))
    await mkdir(this.folder, { recursive: true })

    const child = spawn(this.sidecarPath, ['record', '--out', this.folder, '--target', targetId], {
      stdio: ['pipe', 'pipe', 'pipe']
    })
    this.child = child

    const rl = createInterface({ input: child.stdout })
    rl.on('line', (line) => {
      if (line.trim().length === 0) return
      let msg: SidecarMessage
      try {
        msg = parseSidecarLine(line)
      } catch (err) {
        // 계약을 벗어난 줄은 조용히 무시하지 않고 로그로 남긴다.
        if (err instanceof SidecarProtocolError) console.error('[sidecar 프로토콜 위반]', err.message)
        else console.error('[sidecar 파싱 오류]', err)
        return
      }
      this.messages.push(msg)
      this.handleMessage(msg, cb)
    })

    child.stderr.on('data', (d) => console.error('[sidecar]', String(d).trimEnd()))

    child.on('error', (err) => {
      cb.onError('capture-failed', `사이드카를 실행할 수 없습니다: ${err.message}`)
      this.cleanup()
    })

    child.on('exit', (code) => {
      // stopped 없이 종료되었고 아직 마무리 안 됐으면 비정상 종료로 알린다.
      if (!this.finalized && !this.messages.some((m) => m.type === 'error')) {
        cb.onError('capture-failed', `사이드카가 예기치 않게 종료되었습니다 (code ${code}).`)
      }
      this.cleanup()
    })
  }

  private handleMessage(msg: SidecarMessage, cb: RecorderCallbacks): void {
    switch (msg.type) {
      case 'ready':
        cb.onReady({ startedAt: msg.startedAt, target: msg.target })
        break
      case 'event':
        this.eventCount += 1
        cb.onEvent(this.eventCount)
        break
      case 'error':
        cb.onError(msg.code, msg.message)
        break
      case 'stopped':
        void this.finalize(cb)
        break
    }
  }

  /** 접기 결과를 파일로 떨궈 녹화를 마무리한다. 원본과 이벤트 트랙을 분리 저장한다. */
  private async finalize(cb: RecorderCallbacks): Promise<void> {
    if (this.finalized) return
    this.finalized = true

    const outcome = foldSidecarMessages(this.messages)
    if (!outcome.ok) {
      cb.onError(outcome.error.code, outcome.error.message)
      return
    }

    const eventsPath = join(this.folder, 'events.json')
    await writeFile(eventsPath, JSON.stringify(outcome.eventTrack, null, 2), 'utf8')

    // 세 산출물(원본·이벤트 트랙·레시피)을 묶어 "다시 열기"를 가능케 하는 매니페스트.
    // 레시피는 미리보기에서 유도·저장되므로 여기서는 원본·이벤트 트랙만 묶는다.
    await writeManifest(this.folder, {
      version: MANIFEST_VERSION,
      videoPath: outcome.recording.rawVideoPath,
      startedAt: outcome.recording.startedAt,
      durationMs: outcome.recording.durationMs,
      eventCount: outcome.eventTrack.samples.length,
      target: outcome.recording.target
    })

    cb.onComplete({
      folder: this.folder,
      videoPath: outcome.recording.rawVideoPath,
      eventsPath,
      eventTrack: outcome.eventTrack,
      durationMs: outcome.recording.durationMs,
      eventCount: outcome.eventTrack.samples.length,
      target: outcome.recording.target
    })
  }

  /** 녹화 정지를 요청한다. 사이드카가 원본을 마무리하고 stopped를 보낸다. */
  stop(): void {
    if (!this.child) return
    this.child.stdin.write('stop\n')
  }

  private cleanup(): void {
    this.child = null
  }
}
