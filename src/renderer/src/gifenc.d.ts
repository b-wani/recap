/** gifenc(1.0.3)는 타입 정의를 배포하지 않아 사용하는 표면만 최소로 선언한다. */
declare module 'gifenc' {
  /** [r, g, b] 또는 [r, g, b, a] 색상 팔레트. */
  export type Palette = number[][]

  export interface WriteFrameOpts {
    palette?: Palette
    /** 프레임 표시 시간(ms). 내부에서 센티초로 반올림된다. */
    delay?: number
    transparent?: boolean
    transparentIndex?: number
    repeat?: number
  }

  export interface GifEncoderInstance {
    writeFrame(index: Uint8Array, width: number, height: number, opts?: WriteFrameOpts): void
    finish(): void
    /** 정확히 잘린 GIF 바이트 사본. */
    bytes(): Uint8Array
    bytesView(): Uint8Array
    reset(): void
  }

  export function GIFEncoder(opts?: { auto?: boolean; initialCapacity?: number }): GifEncoderInstance

  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    opts?: { format?: 'rgb565' | 'rgb444' | 'rgba4444'; oneBitAlpha?: boolean | number; clearAlpha?: boolean }
  ): Palette

  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: Palette,
    format?: 'rgb565' | 'rgb444' | 'rgba4444'
  ): Uint8Array
}
