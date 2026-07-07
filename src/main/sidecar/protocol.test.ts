import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  foldSidecarMessages,
  parseSidecarLine,
  SidecarProtocolError,
  SIDECAR_PROTOCOL_VERSION,
  type SidecarMessage
} from './protocol'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

/** 픽스처 JSONL 파일을 읽어 타입 있는 메시지 배열로 파싱한다 (본체가 실제로 하는 일). */
function parseFixture(name: string): SidecarMessage[] {
  const text = readFileSync(join(fixturesDir, name), 'utf8')
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map(parseSidecarLine)
}

describe('사이드카 프로토콜 계약', () => {
  it('list 응답은 전체 화면(디스플레이)과 개별 창을 모두 선택지로 담는다', () => {
    const msgs = parseFixture('targets.jsonl')
    expect(msgs).toHaveLength(1)
    const targets = msgs[0]
    if (targets.type !== 'targets') throw new Error('targets 메시지가 아니다')

    expect(targets.protocolVersion).toBe(SIDECAR_PROTOCOL_VERSION)
    // 전체 화면 선택지 하나 이상.
    expect(targets.targets.some((t) => t.kind === 'display')).toBe(true)
    // 개별 창 선택지가 좌표 공간 크기와 함께 열거된다.
    const window = targets.targets.find((t) => t.id === 'window:47')
    expect(window).toEqual({
      kind: 'window',
      id: 'window:47',
      title: 'Safari — GitHub',
      width: 1200,
      height: 800
    })
  })

  it('창 녹화 세션을 녹화 참조와 이벤트 트랙으로 분리하고 대상을 양쪽에 실어 준다', () => {
    const outcome = foldSidecarMessages(parseFixture('session-with-clicks.jsonl'))

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    const target = {
      kind: 'window' as const,
      id: 'window:47',
      title: 'Safari — GitHub',
      width: 1200,
      height: 800
    }

    // 녹화 참조 — 원본 영상 파일과 녹화된 대상을 가리킨다.
    expect(outcome.recording).toEqual({
      rawVideoPath: '/Users/dev/Movies/Recap/2026-07-05_1530/raw.mp4',
      startedAt: 1751710200000,
      durationMs: 1500,
      target
    })

    // 이벤트 트랙 — 좌표가 놓인 대상을 함께 담아 자동 줌의 클램핑 경계를 알려 준다.
    expect(outcome.eventTrack.protocolVersion).toBe(SIDECAR_PROTOCOL_VERSION)
    expect(outcome.eventTrack.startedAt).toBe(1751710200000)
    expect(outcome.eventTrack.target).toEqual(target)
    expect(outcome.eventTrack.samples).toHaveLength(7)

    // 두 번의 클릭(down)이 창 좌표계 기준으로 보존된다 — 자동 줌이 이 지점을 확대한다.
    const downs = outcome.eventTrack.samples.filter((s) => s.kind === 'down')
    expect(downs).toEqual([
      { t: 300, kind: 'down', x: 420, y: 310, cursor: 'pointer' },
      { t: 980, kind: 'down', x: 800, y: 200, cursor: 'ibeam' }
    ])
    // 클릭 좌표가 대상 경계(1200×800) 안에 있다.
    for (const d of downs) {
      expect(d.x).toBeGreaterThanOrEqual(0)
      expect(d.x).toBeLessThanOrEqual(target.width)
      expect(d.y).toBeGreaterThanOrEqual(0)
      expect(d.y).toBeLessThanOrEqual(target.height)
    }

    // 이벤트 트랙에 원본 영상 경로는 섞이지 않는다 (분리 저장).
    expect(outcome.eventTrack).not.toHaveProperty('rawVideoPath')
  })

  it('키 입력 세션을 마우스 트랙과 분리된 키 트랙으로 접는다 (#25)', () => {
    const outcome = foldSidecarMessages(parseFixture('session-with-keys.jsonl'))
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    // 키는 이벤트 트랙의 별도 키 트랙으로 모인다 — 마우스 samples와 섞이지 않는다.
    expect(outcome.eventTrack.keys).toEqual([
      { t: 800, combo: '⌘S' },
      { t: 1600, combo: '⌥⌘I' },
      { t: 2400, combo: 'Enter' },
      { t: 2900, combo: 'Esc' }
    ])
    // 마우스 samples에는 키가 섞이지 않는다.
    expect(outcome.eventTrack.samples).toHaveLength(3)
    expect(outcome.eventTrack.samples.every((s) => s.kind === 'move' || s.kind === 'down' || s.kind === 'up')).toBe(true)
  })

  it('eventCount 대조는 마우스만 세고, 키 이벤트와 무관하다 (#25)', () => {
    // 픽스처 stopped.eventCount=3(마우스). 키 4개가 있어도 대조는 통과한다.
    const outcome = foldSidecarMessages(parseFixture('session-with-keys.jsonl'))
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.eventTrack.samples).toHaveLength(3)
    expect(outcome.eventTrack.keys).toHaveLength(4)
  })

  it('프라이버시 경계: 키 스트림은 단축키·특수키만 담는다 (일반 문자 미캡처) (#25)', () => {
    const outcome = foldSidecarMessages(parseFixture('session-with-keys.jsonl'))
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    // 모든 조합은 수식키 기호를 포함하거나 특수키 이름이다 — 맨 소문자(일반 타이핑)는 없다.
    const modifiers = /[⌘⌥⇧⌃]/
    const specials = new Set(['Enter', 'Tab', 'Esc', 'Delete', '←', '→', '↑', '↓', 'Home', 'End', 'PageUp', 'PageDown'])
    for (const k of outcome.eventTrack.keys ?? []) {
      expect(modifiers.test(k.combo) || specials.has(k.combo)).toBe(true)
    }
  })

  it('key 메시지를 파싱·검증한다 (불량 줄은 프로토콜 에러) (#25)', () => {
    expect(parseSidecarLine('{"type":"key","t":800,"combo":"⌘S"}')).toEqual({
      type: 'key',
      t: 800,
      combo: '⌘S'
    })
    // combo 누락·t 누락은 계약 위반.
    expect(() => parseSidecarLine('{"type":"key","t":800}')).toThrow(SidecarProtocolError)
    expect(() => parseSidecarLine('{"type":"key","combo":"⌘S"}')).toThrow(SidecarProtocolError)
    expect(() => parseSidecarLine('{"type":"key","t":800,"combo":""}')).toThrow(SidecarProtocolError)
  })

  it('권한 거부 세션은 실패 결과로 표면화된다 (조용히 실패하지 않는다)', () => {
    const outcome = foldSidecarMessages(parseFixture('permission-denied.jsonl'))

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.error.code).toBe('permission-denied')
    expect(outcome.error.message).toContain('화면 기록')
  })

  it('지정한 창이 사라지면 target-not-found 오류가 표면화된다', () => {
    const msg = parseSidecarLine(
      '{"type":"error","code":"target-not-found","message":"선택한 창을 찾지 못했습니다."}'
    )
    const outcome = foldSidecarMessages([msg])
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.error.code).toBe('target-not-found')
  })

  it('계약을 벗어난 줄은 조용히 무시하지 않고 오류를 던진다', () => {
    expect(() => parseSidecarLine('이건 JSON이 아니다')).toThrow(SidecarProtocolError)
    expect(() =>
      parseSidecarLine('{"type":"event","kind":"scroll","t":1,"x":0,"y":0,"cursor":"arrow"}')
    ).toThrow(SidecarProtocolError)
    expect(() => parseSidecarLine('{"type":"ready","protocolVersion":2}')).toThrow(
      SidecarProtocolError
    )
  })

  it('ready에 캡처 대상이 없으면 계약 위반이다', () => {
    expect(() =>
      parseSidecarLine(
        '{"type":"ready","protocolVersion":2,"rawVideoPath":"/tmp/raw.mp4","startedAt":1}'
      )
    ).toThrow(SidecarProtocolError)
    // target에 크기가 빠져도 위반이다 (좌표 공간 경계를 알 수 없다).
    expect(() =>
      parseSidecarLine(
        '{"type":"ready","protocolVersion":2,"rawVideoPath":"/tmp/raw.mp4","startedAt":1,"target":{"kind":"window","id":"window:1","title":"x"}}'
      )
    ).toThrow(SidecarProtocolError)
  })

  it('구버전(v1) 사이드카 세션은 프로토콜 불일치로 거부된다', () => {
    const msgs = parseFixture('session-with-clicks.jsonl')
    const ready = msgs[0]
    if (ready.type !== 'ready') throw new Error('픽스처 전제 위반')
    ready.protocolVersion = 1
    expect(() => foldSidecarMessages(msgs)).toThrow(SidecarProtocolError)
  })

  it('ready로 시작하지 않으면 계약 위반이다', () => {
    const msgs = parseFixture('session-with-clicks.jsonl').slice(1)
    expect(() => foldSidecarMessages(msgs)).toThrow(SidecarProtocolError)
  })

  it('stopped.eventCount가 스트림과 어긋나면 계약 위반이다', () => {
    const msgs = parseFixture('session-with-clicks.jsonl')
    const stopped = msgs[msgs.length - 1]
    if (stopped.type !== 'stopped') throw new Error('픽스처 전제 위반')
    stopped.eventCount = 99
    expect(() => foldSidecarMessages(msgs)).toThrow(SidecarProtocolError)
  })
})
