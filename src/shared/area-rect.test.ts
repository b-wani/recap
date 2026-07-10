import { describe, it, expect } from 'vitest'
import {
  rectFromPoints,
  moveRect,
  resizeRectByHandle,
  overlayRectToSourceRect,
  MIN_AREA_SIZE
} from './area-rect'

describe('rectFromPoints', () => {
  it('시작점이 좌상단이면 그대로 사각형을 만든다', () => {
    expect(rectFromPoints(10, 20, 110, 220)).toEqual({ x: 10, y: 20, width: 100, height: 200 })
  })

  it('어느 방향으로 드래그해도 항상 양수 width/height 로 정규화한다', () => {
    expect(rectFromPoints(110, 220, 10, 20)).toEqual({ x: 10, y: 20, width: 100, height: 200 })
    expect(rectFromPoints(10, 220, 110, 20)).toEqual({ x: 10, y: 20, width: 100, height: 200 })
  })
})

describe('moveRect', () => {
  const rect = { x: 100, y: 100, width: 200, height: 150 }
  const bounds = { width: 1000, height: 800 }

  it('델타만큼 이동한다', () => {
    expect(moveRect(rect, 10, -5, bounds)).toEqual({ x: 110, y: 95, width: 200, height: 150 })
  })

  it('경계 밖으로 나가지 않게 클램프한다(좌상단)', () => {
    expect(moveRect(rect, -1000, -1000, bounds)).toEqual({ x: 0, y: 0, width: 200, height: 150 })
  })

  it('경계 밖으로 나가지 않게 클램프한다(우하단)', () => {
    expect(moveRect(rect, 1000, 1000, bounds)).toEqual({
      x: 800,
      y: 650,
      width: 200,
      height: 150
    })
  })
})

describe('resizeRectByHandle', () => {
  const rect = { x: 100, y: 100, width: 200, height: 150 }
  const bounds = { width: 1000, height: 800 }

  it('se 핸들은 우하단 모서리를 늘린다', () => {
    expect(resizeRectByHandle(rect, 'se', 50, 30, bounds)).toEqual({
      x: 100,
      y: 100,
      width: 250,
      height: 180
    })
  })

  it('nw 핸들은 좌상단 모서리를 옮기며 반대쪽 모서리는 고정한다', () => {
    expect(resizeRectByHandle(rect, 'nw', -20, -10, bounds)).toEqual({
      x: 80,
      y: 90,
      width: 220,
      height: 160
    })
  })

  it('e 핸들은 폭만 바꾼다', () => {
    expect(resizeRectByHandle(rect, 'e', 40, 999, bounds)).toEqual({
      x: 100,
      y: 100,
      width: 240,
      height: 150
    })
  })

  it('s 핸들은 높이만 바꾼다', () => {
    expect(resizeRectByHandle(rect, 's', 999, 40, bounds)).toEqual({
      x: 100,
      y: 100,
      width: 200,
      height: 190
    })
  })

  it('최소 크기 가드 — w 핸들을 반대쪽을 넘어서 끌어도 최소 크기 밑으로 줄지 않는다', () => {
    const r = resizeRectByHandle(rect, 'w', 10000, 0, bounds)
    expect(r.width).toBe(MIN_AREA_SIZE)
    expect(r.x).toBe(rect.x + rect.width - MIN_AREA_SIZE)
  })

  it('최소 크기 가드 — se 핸들을 반대로 끌어도 최소 크기 밑으로 줄지 않는다', () => {
    const r = resizeRectByHandle(rect, 'se', -10000, -10000, bounds)
    expect(r.width).toBe(MIN_AREA_SIZE)
    expect(r.height).toBe(MIN_AREA_SIZE)
  })

  it('경계 밖으로는 늘어나지 않는다(e 핸들이 화면 우측 경계에 막힌다)', () => {
    const r = resizeRectByHandle(rect, 'e', 100000, 0, bounds)
    expect(r.x + r.width).toBe(bounds.width)
  })
})

describe('overlayRectToSourceRect', () => {
  it('오버레이 로컬 rect 를 디스플레이 원점만큼 밀고 AppKit y 를 뒤집는다', () => {
    // 디스플레이 원점 (0,0), 주 디스플레이 높이 1080, 오버레이 로컬 rect (100,200,300,400)
    // → 전역(top-left) rect = (100,200,300,400)
    // → AppKit flip: y' = 1080 - (200+400) = 480
    const local = { x: 100, y: 200, width: 300, height: 400 }
    expect(overlayRectToSourceRect(local, { x: 0, y: 0 }, 1080)).toEqual({
      x: 100,
      y: 480,
      width: 300,
      height: 400
    })
  })

  it('보조 디스플레이(원점이 0이 아닌)도 전역 좌표에 원점을 더한다', () => {
    const local = { x: 10, y: 10, width: 50, height: 50 }
    // 보조 디스플레이 원점 (1440, 0), 주 디스플레이 높이 900
    expect(overlayRectToSourceRect(local, { x: 1440, y: 0 }, 900)).toEqual({
      x: 1450,
      y: 840,
      width: 50,
      height: 50
    })
  })
})
