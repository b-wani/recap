// A vs C (ordered/Bayer dither) 프로토타입 — recap 충실 콘텐츠로 gifenc GIF 4종 생성.
// A = 무디더(현행 앱 경로), C-low/med/high = quantize 앞단에 8x8 Bayer ordered dither.
// 프레임은 순수 JS로 픽셀 직접 계산(캔버스 라이브러리 무의존). compose.ts/recipe.ts 재현.
//
// 실행: node render.mjs   (dither-ac/ 안에서)
// 산출: A.gif, C-low.gif, C-med.gif, C-high.gif + 콘솔에 크기/시간 표.
import { writeFileSync } from 'node:fs'
import { GIFEncoder, quantize, applyPalette } from '/Users/nhn/Projects/recap/.claude/worktrees/wf-141-mp4-encoder/node_modules/gifenc/dist/gifenc.esm.js'

const W = 1280, H = 720, N = 48, FPS = 25, MAX_COLORS = 256
const delay = 1000 / FPS
const shortSide = Math.min(W, H)

// ---- 색 유틸 ----
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const lerp = (a, b, t) => a + (b - a) * t
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
const lerpRGB = (c0, c1, t) => [lerp(c0[0], c1[0], t), lerp(c0[1], c1[1], t), lerp(c0[2], c1[2], t)]

// ---- 배경 그라디언트 (compose.ts fillBackground, slate 프리셋) ----
const BG0 = hex('#2b2b30'), BG1 = hex('#161618')
const angle = 145
const rad = (angle * Math.PI) / 180
const ux = Math.sin(rad), uy = Math.cos(rad)
const cx = W / 2, cy = H / 2
const half = (Math.abs(ux) * W + Math.abs(uy) * H) / 2
// 캔버스 linear-gradient t: (px-cx)*ux+(py-cy)*uy + half 를 2*half로 정규화.
function bgColor(px, py) {
  const t = clamp(((px - cx) * ux + (py - cy) * uy + half) / (2 * half), 0, 1)
  return lerpRGB(BG0, BG1, t)
}

// ---- 창(라운드 rect) 지오메트리 (compose.ts) ----
const pad = shortSide * 0.08
const dx = pad, dy = pad, dw = W - 2 * pad, dh = H - 2 * pad
const radius = Math.max(0, Math.min(12 * (shortSide / 800), dw / 2, dh / 2))

// 라운드 rect 부호거리 (음수=내부). rectCx/Cy 중심, hx/hy 반변, r 반경.
function rrSD(px, py, rx, ry, rw, rh, r) {
  const hx = rw / 2, hy = rh / 2
  const qx = Math.abs(px - (rx + hx)) - (hx - r)
  const qy = Math.abs(py - (ry + hy)) - (hy - r)
  const ax = Math.max(qx, 0), ay = Math.max(qy, 0)
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r
}

// ---- 드롭 섀도 (compose.ts: black, offsetY, soft falloff) ----
const shadowOffsetY = shortSide * 0.012
const shadowSoft = shortSide * 0.06 // falloff 폭
const shadowPeak = 0.5
// 배경 위 섀도 알파 (창 외부에서만 보임). offsetY만큼 아래로 옮긴 rect 기준.
function shadowAlpha(px, py) {
  const d = rrSD(px, py - shadowOffsetY, dx, dy, dw, dh, radius)
  if (d <= 0) return 0 // 창(콘텐츠)에 덮이는 안쪽은 무시
  return shadowPeak * clamp(1 - d / shadowSoft, 0, 1) // 선형 falloff 램프
}

// ---- 창 콘텐츠 (앱 UI): 밝은 세로 그라디언트 + 바/블록 + 바이올렛 액센트 스트립 ----
// 콘텐츠는 source 좌표계 [0,W]x[0,H]에서 정의하고, 카메라 변환으로 창에 매핑한다.
const UI0 = hex('#f4f4f6'), UI1 = hex('#dcdce2') // 부드러운 밝은 그라디언트 (밴딩 스트레스)
const VIOLET = hex('#6C4DF5')
const CARD = hex('#c9c9d2')
const CARD2 = hex('#b7b7c4')
function contentColor(sx, sy) {
  // 밝은 세로 그라디언트 (콘텐츠 전 영역)
  let col = lerpRGB(UI0, UI1, clamp(sy / H, 0, 1))
  // 상단 바이올렛 액센트 스트립 (얇은 가로 띠)
  if (sy >= 40 && sy <= 96 && sx >= 40 && sx <= W - 40) col = VIOLET
  // 솔리드 블록 2개 (라운드 무시, 단색)
  if (sy >= 150 && sy <= 470 && sx >= 60 && sx <= 360) col = CARD
  if (sy >= 150 && sy <= 300 && sx >= 400 && sx <= W - 60) col = CARD2
  // 하단 얇은 바이올렛 바
  if (sy >= 560 && sy <= 600 && sx >= 60 && sx <= 520) col = VIOLET
  return col
}

// ---- 한 프레임 합성 (RGBA) ----
function renderFrame(i) {
  const buf = new Uint8ClampedArray(W * H * 4)
  const p = i / (N - 1) // 0..1
  // 카메라: 줌 1.0 -> 1.25, 살짝 가로 팬 (compose.ts 카메라 매핑)
  const scale = 1 + 0.25 * p
  const camX = W / 2 + 70 * p
  const camY = H / 2
  const viewW = W / scale, viewH = H / scale
  const camSx = camX - viewW / 2, camSy = camY - viewH / 2

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4
      // 창 내부인가?
      const sd = rrSD(x + 0.5, y + 0.5, dx, dy, dw, dh, radius)
      let r, g, b
      if (sd < 0.5) {
        // 창 콘텐츠 — 카메라 변환으로 source 좌표 샘플
        const srcX = camSx + ((x + 0.5 - dx) / dw) * viewW
        const srcY = camSy + ((y + 0.5 - dy) / dh) * viewH
        const cc = contentColor(srcX, srcY)
        if (sd > -0.5) {
          // 가장자리 1px AA: 배경(+섀도)과 블렌드
          const cov = clamp(0.5 - sd, 0, 1)
          const bg = bgColor(x + 0.5, y + 0.5)
          const a = shadowAlpha(x + 0.5, y + 0.5)
          const br = bg[0] * (1 - a), bgc = bg[1] * (1 - a), bb = bg[2] * (1 - a)
          r = lerp(br, cc[0], cov); g = lerp(bgc, cc[1], cov); b = lerp(bb, cc[2], cov)
        } else {
          r = cc[0]; g = cc[1]; b = cc[2]
        }
      } else {
        // 배경 + 드롭 섀도
        const bg = bgColor(x + 0.5, y + 0.5)
        const a = shadowAlpha(x + 0.5, y + 0.5)
        r = bg[0] * (1 - a); g = bg[1] * (1 - a); b = bg[2] * (1 - a)
      }
      buf[o] = r; buf[o + 1] = g; buf[o + 2] = b; buf[o + 3] = 255
    }
  }
  return buf
}

// ---- 8x8 Bayer ordered dither ----
const BAYER8 = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21]
]
// 정규화 임계값 -0.5..+0.484 (값/64 - 0.5)
const BTHRESH = BAYER8.map((row) => row.map((v) => v / 64 - 0.5))

// 프레임 RGBA의 복사본에 Bayer dither 적용 (알파 불변). spread = 확산 강도.
function dither(src, spread) {
  const out = new Uint8ClampedArray(src) // 복사본
  for (let y = 0; y < H; y++) {
    const brow = BTHRESH[y & 7]
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4
      const t = brow[x & 7] * spread
      out[o] = clamp(src[o] + t, 0, 255)
      out[o + 1] = clamp(src[o + 1] + t, 0, 255)
      out[o + 2] = clamp(src[o + 2] + t, 0, 255)
      // 알파 유지
    }
  }
  return out
}

// ---- 프레임 생성 (48장, 메모리 유지) ----
console.log(`generating ${N} frames ${W}x${H} ...`)
const frames = []
for (let i = 0; i < N; i++) frames.push(renderFrame(i))

// 참고용 프레임30 원본 RGBA 저장 (ffmpeg PNG 추출용은 GIF에서 하지만, 여기선 GIF만)
// ---- 인코딩 ----
const variants = [
  { name: 'A', file: 'A.gif', spread: 0 },
  { name: 'C-low', file: 'C-low.gif', spread: 8 },
  { name: 'C-med', file: 'C-med.gif', spread: 16 },
  { name: 'C-high', file: 'C-high.gif', spread: 28 }
]

const results = []
for (const v of variants) {
  const t0 = process.hrtime.bigint()
  const enc = GIFEncoder()
  for (let i = 0; i < N; i++) {
    // 프레임을 독립 버퍼로 (gifenc applyPalette는 buffer 전체를 읽음 — comparison.md 경고)
    const data = v.spread === 0
      ? new Uint8ClampedArray(frames[i]) // A: 원본 복사
      : dither(frames[i], v.spread)      // C: dither된 복사본
    const palette = quantize(data, MAX_COLORS)
    const index = applyPalette(data, palette)
    enc.writeFrame(index, W, H, { palette, delay })
  }
  enc.finish()
  const t1 = process.hrtime.bigint()
  const bytes = enc.bytes()
  writeFileSync(new URL(v.file, import.meta.url), bytes)
  const mb = bytes.length / 1024 / 1024
  const ms = Number(t1 - t0) / 1e6
  results.push({ ...v, mb, ms })
  console.log(`${v.name.padEnd(7)} spread=${String(v.spread).padStart(2)}  ${mb.toFixed(2)} MB  ${ms.toFixed(0)} ms  -> ${v.file}`)
}

console.log('\n| variant | spread | size (MB) | encode (ms) |')
console.log('|---|--:|--:|--:|')
for (const r of results) console.log(`| ${r.name} | ${r.spread} | ${r.mb.toFixed(2)} | ${r.ms.toFixed(0)} |`)
