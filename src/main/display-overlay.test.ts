import { describe, it, expect } from 'vitest'
import { matchDisplayTargets, type DisplayBounds } from './display-overlay'
import type { CaptureTarget } from '../shared/ipc'

function target(id: string, width: number, height: number): CaptureTarget {
  return { kind: 'display', id, title: `전체 화면 (${width}×${height})`, width, height }
}

describe('matchDisplayTargets', () => {
  it('display:<id> 로 Electron 디스플레이와 사이드카 대상을 짝짓는다', () => {
    const displays: DisplayBounds[] = [
      { id: 1, x: 0, y: 0, width: 1920, height: 1080 },
      { id: 2, x: 1920, y: 0, width: 2560, height: 1440 }
    ]
    const targets = [target('display:1', 1920, 1080), target('display:2', 2560, 1440)]

    const matches = matchDisplayTargets(displays, targets)

    expect(matches).toEqual([
      { bounds: displays[0], targetId: 'display:1', width: 1920, height: 1080 },
      { bounds: displays[1], targetId: 'display:2', width: 2560, height: 1440 }
    ])
  })

  it('displays 순서를 유지한다(사이드카 targets 순서와 달라도)', () => {
    const displays: DisplayBounds[] = [
      { id: 2, x: 1920, y: 0, width: 2560, height: 1440 },
      { id: 1, x: 0, y: 0, width: 1920, height: 1080 }
    ]
    const targets = [target('display:1', 1920, 1080), target('display:2', 2560, 1440)]

    const matches = matchDisplayTargets(displays, targets)

    expect(matches.map((m) => m.targetId)).toEqual(['display:2', 'display:1'])
  })

  it('사이드카가 모르는 디스플레이는 매칭에서 빠진다', () => {
    const displays: DisplayBounds[] = [{ id: 99, x: 0, y: 0, width: 1920, height: 1080 }]
    const targets = [target('display:1', 1920, 1080)]

    expect(matchDisplayTargets(displays, targets)).toEqual([])
  })

  it('window 종류 대상은 무시한다', () => {
    const displays: DisplayBounds[] = [{ id: 1, x: 0, y: 0, width: 1920, height: 1080 }]
    const targets: CaptureTarget[] = [
      { kind: 'window', id: 'window:42', title: '앱 — 창', width: 800, height: 600 },
      target('display:1', 1920, 1080)
    ]

    expect(matchDisplayTargets(displays, targets)).toEqual([
      { bounds: displays[0], targetId: 'display:1', width: 1920, height: 1080 }
    ])
  })
})
