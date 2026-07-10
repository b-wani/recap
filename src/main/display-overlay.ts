import type { CaptureTarget } from '../shared/ipc'

/** Electron `screen.getAllDisplays()` 항목에서 뽑아 쓰는 최소 필드(순수 로직 입력). */
export interface DisplayBounds {
  /** Electron 의 `Display.id` — macOS 에서는 사이드카의 `CGDirectDisplayID` 와 같은 수다. */
  id: number
  x: number
  y: number
  width: number
  height: number
}

/** Display 선택 오버레이 창 하나를 만드는 데 필요한 정보(디스플레이 위치 + 대상 + 해상도). */
export interface DisplayOverlayTarget {
  bounds: DisplayBounds
  /** 사이드카에 넘길 대상 id(`display:<번호>`) — Start 클릭 시 그대로 recording:start 에 싣는다. */
  targetId: string
  /** 배지에 보일 논리 해상도(포인트). */
  width: number
  height: number
}

/**
 * Electron 디스플레이 목록을 사이드카 `CaptureTarget`(kind=display) 목록과 `display:<id>` 로
 * 짝짓는다. 순서는 `displays` 순서를 따른다. 사이드카가 아직 모르는 디스플레이(권한 갱신 중
 * 새로 붙은 모니터 등)는 매칭이 안 되므로 결과에서 빠진다 — 오버레이가 그 화면엔 안 뜬다.
 */
export function matchDisplayTargets(
  displays: DisplayBounds[],
  targets: CaptureTarget[]
): DisplayOverlayTarget[] {
  const byDisplayId = new Map<number, CaptureTarget>()
  for (const t of targets) {
    if (t.kind !== 'display') continue
    const id = Number(t.id.slice('display:'.length))
    if (Number.isFinite(id)) byDisplayId.set(id, t)
  }

  const out: DisplayOverlayTarget[] = []
  for (const d of displays) {
    const t = byDisplayId.get(d.id)
    if (!t) continue
    out.push({ bounds: d, targetId: t.id, width: t.width, height: t.height })
  }
  return out
}
