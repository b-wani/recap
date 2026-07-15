// 앱의 GIF 경로(renderer/src/export.ts renderRecipeToGif)를 재현:
// 프레임마다 quantize(256) → applyPalette → writeFrame(무디더). gifenc 1.0.3 사용.
import { readFileSync, writeFileSync } from 'node:fs'
import { GIFEncoder, quantize, applyPalette } from '/Users/nhn/orca/workspaces/recap/main-2/node_modules/gifenc/dist/gifenc.esm.js'

const W = 1280, H = 720, FPS = 25, MAX_COLORS = 256
const raw = readFileSync(process.argv[2])
const bytesPerFrame = W * H * 4
const nFrames = Math.floor(raw.length / bytesPerFrame)
const delay = 1000 / FPS

const t0 = process.hrtime.bigint()
const enc = GIFEncoder()
for (let i = 0; i < nFrames; i++) {
  // 프레임을 독립 버퍼로 복사 — gifenc applyPalette는 뷰의 offset/length를 무시하고
  // data.buffer 전체를 읽으므로, 앱의 getImageData(프레임별 독립 버퍼)와 동일하게 맞춘다.
  const start = raw.byteOffset + i * bytesPerFrame
  const data = new Uint8ClampedArray(raw.buffer.slice(start, start + bytesPerFrame))
  const palette = quantize(data, MAX_COLORS)
  const index = applyPalette(data, palette)
  enc.writeFrame(index, W, H, { palette, delay })
}
enc.finish()
const t1 = process.hrtime.bigint()
const out = enc.bytes()
writeFileSync(process.argv[3], out)
console.log(`gifenc: ${nFrames} frames, ${(out.length/1024/1024).toFixed(2)} MB, ${Number(t1-t0)/1e6|0} ms`)
