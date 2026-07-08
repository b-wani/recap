/**
 * 프레임 합성 그리기 층 — 효과 계산을 하지 않는다.
 * `sampleComposition`이 낸 합성 파라미터(카메라·커서·클릭·배경/패딩·배지)를 2D 컨텍스트에
 * 그대로 그리기만 한다. 미리보기(온스크린 캔버스)와 익스포트(오프스크린 캔버스)가
 * 이 한 함수를 공유하므로 두 결과물이 동일하게 나온다.
 */

import type { FrameComposition, FrameSize } from '../../shared/recipe'

/** 온스크린·오프스크린 양쪽에서 통용되는 2D 컨텍스트. */
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/** 원본 px → 캔버스 px 매핑 — 카메라 뷰를 패딩 인셋 영역에 대응시킨다. */
interface Mapping {
  toCanvasX: (x: number) => number
  toCanvasY: (y: number) => number
  /** 캔버스 px / 원본 px (오버레이 크기 환산용). 패딩 0이면 camera.scale와 같다. */
  drawScale: number
}

/**
 * 라운딩(논리 px)을 프레임 해상도에 비례시키는 기준 짧은 변(논리 px). 프레임 짧은 변이 이
 * 값이면 cornerRadius가 곧 실제 px가 되고, Retina처럼 픽셀이 더 크면 그만큼 커진다 — 어떤
 * 해상도에서도 같은 인상을 준다.
 */
const RADIUS_REFERENCE_SHORT_SIDE = 800

/**
 * 합성 파라미터 한 프레임을 그린다. 컨텍스트의 캔버스는 원본 크기(source)로 맞춰져 있다고 본다.
 * 순서: 배경 채우기 → (섀도) → 라운딩 클립 안에 카메라 뷰·오버레이 → (켜져 있으면) 배지.
 */
export function drawComposition(
  ctx: Ctx,
  image: CanvasImageSource,
  comp: FrameComposition,
  source: FrameSize
): void {
  const { camera, cursor, click, background, badge, keyOverlay } = comp
  const W = source.width
  const H = source.height

  // 배경 — 단색 또는 그라디언트.
  fillBackground(ctx, background, W, H)

  // 패딩 인셋 — 짧은 변 대비 비율. 콘텐츠는 이 안쪽에 그린다.
  const pad = Math.min(W, H) * background.padding
  const dx = pad
  const dy = pad
  const dw = W - 2 * pad
  const dh = H - 2 * pad

  // 라운딩 반경(px) — 논리 px를 프레임 해상도에 비례시키고, 콘텐츠 반변을 넘지 않게 가둔다.
  const radius = Math.max(
    0,
    Math.min(background.cornerRadius * (Math.min(W, H) / RADIUS_REFERENCE_SHORT_SIDE), dw / 2, dh / 2)
  )

  // 드롭 섀도 — 콘텐츠 실루엣을 라운딩 사각형으로 한 번 채워 둘레에 그림자를 드리운다.
  // (그 위에 불투명한 영상이 덮이므로 실루엣 자체는 보이지 않고 그림자만 남는다.)
  if (background.shadow > 0) {
    ctx.save()
    ctx.shadowColor = `rgba(0, 0, 0, ${Math.min(1, background.shadow)})`
    ctx.shadowBlur = Math.min(W, H) * 0.05 * background.shadow + Math.min(W, H) * 0.01
    ctx.shadowOffsetY = Math.min(W, H) * 0.012
    ctx.fillStyle = '#000000'
    roundRect(ctx, dx, dy, dw, dh, radius)
    ctx.fill()
    ctx.restore()
  }

  // 라운딩 클립 안에서 카메라 뷰와 커서·클릭 오버레이를 그린다(모서리가 함께 깎인다).
  ctx.save()
  roundRect(ctx, dx, dy, dw, dh, radius)
  ctx.clip()

  // 카메라가 지정한 원본 영역을 인셋 영역에 그린다.
  const viewW = W / camera.scale
  const viewH = H / camera.scale
  const sx = camera.x - viewW / 2
  const sy = camera.y - viewH / 2
  ctx.drawImage(image, sx, sy, viewW, viewH, dx, dy, dw, dh)

  // 커서·클릭 오버레이 — 인셋 영역 좌표계로 매핑해 그린다.
  const map: Mapping = {
    toCanvasX: (x) => dx + ((x - sx) / viewW) * dw,
    toCanvasY: (y) => dy + ((y - sy) / viewH) * dh,
    drawScale: dw / viewW
  }
  if (click) drawClickHighlight(ctx, click, map)
  if (cursor) drawCursor(ctx, cursor, click, map)
  ctx.restore()

  // 뷰포트 크기 배지 + (있으면) 맥락 배지. 배경(패딩) 위 고정 좌표라 클립 밖에서 그린다.
  if (badge.visible) drawBadges(ctx, badge, W, H)

  // 키 입력 오버레이 — 화면 하단 중앙, 카메라 변환과 무관한 고정 좌표.
  if (keyOverlay) drawKeyOverlay(ctx, keyOverlay, W, H)
}

/** 배경을 채운다 — 단색 또는 선형 그라디언트(angle deg). */
function fillBackground(
  ctx: Ctx,
  background: FrameComposition['background'],
  W: number,
  H: number
): void {
  if (background.type === 'gradient') {
    const rad = (background.gradient.angle * Math.PI) / 180
    // 각도 방향(0=위→아래, 90=왼→오른쪽)으로 프레임 중심을 가로지르는 그라디언트 축.
    const cx = W / 2
    const cy = H / 2
    const ux = Math.sin(rad)
    const uy = Math.cos(rad)
    const half = (Math.abs(ux) * W + Math.abs(uy) * H) / 2
    const grad = ctx.createLinearGradient(cx - ux * half, cy - uy * half, cx + ux * half, cy + uy * half)
    grad.addColorStop(0, background.gradient.stops[0])
    grad.addColorStop(1, background.gradient.stops[1])
    ctx.fillStyle = grad
  } else {
    ctx.fillStyle = background.color
  }
  ctx.fillRect(0, 0, W, H)
}

/** 클릭 하이라이트: 퍼지는 리플(원). 커서 아래에 먼저 그린다. */
function drawClickHighlight(
  ctx: Ctx,
  click: NonNullable<FrameComposition['click']>,
  map: Mapping
): void {
  const cx = map.toCanvasX(click.x)
  const cy = map.toCanvasY(click.y)
  const radius = 8 + 44 * click.progress * map.drawScale
  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  ctx.strokeStyle = `rgba(56, 189, 248, ${(1 - click.progress) * 0.9})`
  ctx.lineWidth = 3
  ctx.stroke()
}

/** 스무딩된 커서: 화살표 벡터. 눌림 스케일 — 클릭 순간 살짝 작아졌다 돌아온다. */
function drawCursor(
  ctx: Ctx,
  cursor: NonNullable<FrameComposition['cursor']>,
  click: FrameComposition['click'],
  map: Mapping
): void {
  const cx = map.toCanvasX(cursor.x)
  const cy = map.toCanvasY(cursor.y)
  const press = click ? 1 - 0.2 * (1 - click.progress) : 1
  drawArrowCursor(ctx, cx, cy, 18 * cursor.size * map.drawScale * press)
}

/** 화살표 커서 벡터 하나. (tipX, tipY)가 커서 끝점. */
function drawArrowCursor(ctx: Ctx, tipX: number, tipY: number, size: number): void {
  ctx.save()
  ctx.translate(tipX, tipY)
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(0, size)
  ctx.lineTo(size * 0.28, size * 0.75)
  ctx.lineTo(size * 0.52, size * 0.52)
  ctx.closePath()
  ctx.fillStyle = '#0f172a'
  ctx.fill()
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.restore()
}

/**
 * 우하단에 뷰포트 크기 배지를, 맥락 문자열이 있으면 그 왼쪽에 맥락 배지를 나란히 그린다.
 * 두 배지는 배경색으로 구분한다 — 뷰포트는 반투명 검정, 맥락은 파란 액센트.
 * 카메라 변환과 무관한 화면 고정 좌표에 그린다. 크기는 프레임에 비례.
 */
function drawBadges(
  ctx: Ctx,
  badge: FrameComposition['badge'],
  W: number,
  H: number
): void {
  const fontSize = Math.round(Math.min(W, H) * 0.028)
  const padX = fontSize * 0.7
  const padY = fontSize * 0.45
  const margin = fontSize
  const gap = fontSize * 0.5
  const boxH = fontSize + padY * 2
  const boxY = H - margin - boxH
  const radius = boxH / 2

  ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'

  // 우하단부터 왼쪽으로 채운다: 뷰포트 배지 먼저, 그 왼쪽에 맥락 배지.
  let right = W - margin
  right = drawPill(ctx, badge.label, right, boxY, boxH, padX, radius, 'rgba(0, 0, 0, 0.55)')
  if (badge.contextLabel !== '') {
    drawPill(ctx, badge.contextLabel, right - gap, boxY, boxH, padX, radius, 'rgba(10, 132, 255, 0.85)')
  }
}

/** 오른쪽 가장자리 rightX에 알약 하나를 그리고, 그 왼쪽 가장자리 X를 반환한다. */
function drawPill(
  ctx: Ctx,
  label: string,
  rightX: number,
  boxY: number,
  boxH: number,
  padX: number,
  radius: number,
  fill: string
): number {
  const textW = ctx.measureText(label).width
  const boxW = textW + padX * 2
  const boxX = rightX - boxW

  ctx.fillStyle = fill
  roundRect(ctx, boxX, boxY, boxW, boxH, radius)
  ctx.fill()

  ctx.fillStyle = '#ffffff'
  ctx.fillText(label, boxX + padX, boxY + boxH / 2)
  return boxX
}

/**
 * 화면 하단 중앙에 키 입력 오버레이(알약)를 그린다. 카메라 변환과 무관한 화면 고정 좌표라
 * 확대 중에도 읽힌다. fade가 끝으로 갈수록 부드럽게 사라진다(잠깐 떴다 사라지는 자막).
 */
function drawKeyOverlay(
  ctx: Ctx,
  overlay: NonNullable<FrameComposition['keyOverlay']>,
  W: number,
  H: number
): void {
  // 앞 70%는 완전 불투명, 마지막 30% 동안 페이드아웃.
  const opacity = overlay.fade < 0.7 ? 1 : Math.max(0, 1 - (overlay.fade - 0.7) / 0.3)
  if (opacity <= 0) return

  const fontSize = Math.round(Math.min(W, H) * 0.045)
  const padX = fontSize * 0.8
  const padY = fontSize * 0.5
  const marginBottom = Math.min(W, H) * 0.08

  ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'

  const textW = ctx.measureText(overlay.combo).width
  const boxW = textW + padX * 2
  const boxH = fontSize + padY * 2
  const boxX = (W - boxW) / 2
  const boxY = H - marginBottom - boxH
  const radius = fontSize * 0.4

  ctx.save()
  ctx.globalAlpha = opacity
  ctx.fillStyle = 'rgba(20, 20, 22, 0.82)'
  roundRect(ctx, boxX, boxY, boxW, boxH, radius)
  ctx.fill()

  ctx.fillStyle = '#ffffff'
  ctx.fillText(overlay.combo, W / 2, boxY + boxH / 2)
  ctx.restore()
}

/** 둥근 사각형 경로. (구형 컨텍스트의 roundRect 미지원 대비) */
function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
