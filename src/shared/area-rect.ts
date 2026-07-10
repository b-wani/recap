/**
 * Area 선택 오버레이의 순수 기하 로직 — 드래그 정규화, 8핸들 리사이즈, 이동, 좌표 매핑.
 * Electron·DOM에 의존하지 않는 순수 함수라 vitest로 바로 테스트한다(#72).
 */

import type { Rect } from './event-track'

export interface Size {
  width: number
  height: number
}

/** 확정 전 리사이즈 8핸들 — 모서리 4 + 변 4. */
export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

/** Area 사각형의 최소 크기(DIP) — 리사이즈·드래그 모두 이 아래로 줄지 않는다. */
export const MIN_AREA_SIZE = 40

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), Math.max(min, max))
}

/** 드래그 시작점·끝점(어느 방향이든)에서 항상 양수 width/height 인 사각형을 만든다. */
export function rectFromPoints(x1: number, y1: number, x2: number, y2: number): Rect {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1)
  }
}

/** 사각형을 (dx,dy)만큼 이동한다. 오버레이 경계(bounds) 밖으로 나가지 않게 클램프한다. */
export function moveRect(rect: Rect, dx: number, dy: number, bounds: Size): Rect {
  return {
    ...rect,
    x: clamp(rect.x + dx, 0, bounds.width - rect.width),
    y: clamp(rect.y + dy, 0, bounds.height - rect.height)
  }
}

/**
 * 지정한 핸들을 (dx,dy)만큼 끌어 리사이즈한다. 반대쪽 모서리/변은 고정되고,
 * 최소 크기(minSize) 아래로 줄지 않으며 오버레이 경계 밖으로 늘어나지 않는다.
 */
export function resizeRectByHandle(
  rect: Rect,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  bounds: Size,
  minSize = MIN_AREA_SIZE
): Rect {
  let left = rect.x
  let top = rect.y
  let right = rect.x + rect.width
  let bottom = rect.y + rect.height

  if (handle.includes('w')) left = clamp(left + dx, 0, right - minSize)
  if (handle.includes('e')) right = clamp(right + dx, left + minSize, bounds.width)
  if (handle.includes('n')) top = clamp(top + dy, 0, bottom - minSize)
  if (handle.includes('s')) bottom = clamp(bottom + dy, top + minSize, bounds.height)

  return { x: left, y: top, width: right - left, height: bottom - top }
}

/**
 * overlay-local rect(DIP, 좌상단 원점) → 사이드카가 기대하는 sourceRect(AppKit 전역 좌표,
 * 좌하단 원점)로 매핑한다. displayOrigin = 오버레이가 뜬 디스플레이의 전역 좌상단 원점(DIP).
 * appKitFlipHeight = 주 디스플레이 높이(포인트) — 사이드카 Coords.flipHeight 와 동일 규약.
 */
export function overlayRectToSourceRect(
  local: Rect,
  displayOrigin: { x: number; y: number },
  appKitFlipHeight: number
): Rect {
  const globalX = local.x + displayOrigin.x
  const globalY = local.y + displayOrigin.y
  return {
    x: globalX,
    y: appKitFlipHeight - (globalY + local.height),
    width: local.width,
    height: local.height
  }
}
