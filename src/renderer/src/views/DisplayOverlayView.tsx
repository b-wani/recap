import { useEffect, useRef, useState } from 'react'
import type { DisplayOverlayContext } from '../../../shared/ipc'

/** 사이드카 고정 캡처 프레임레이트(ScreenRecorder.swift) — 배지 표시용, 선택 항목 아님. */
const CAPTURE_FPS = 60

/**
 * Display 선택 오버레이(#71) — 디스플레이 하나를 정확히 덮는 딤 창. 커서가 올라온
 * 화면(=이 창)만 CSS `:hover` 로 딤이 걷히고, 중앙의 해상도·FPS 배지 + Start recording
 * (또는 오버레이 아무 곳이나 클릭)으로 그 디스플레이 녹화를 확정한다. 카운트다운 옵션이
 * 켜져 있으면 확정 후 이 창 안에서 3-2-1 을 세고 시작한다.
 */
export function DisplayOverlayView({ context }: { context: DisplayOverlayContext }): JSX.Element {
  const [count, setCount] = useState<number | null>(null)
  const startedRef = useRef(false)

  // Esc: 카운트다운 중이면 카운트다운만 중단, 아니면 arming 자체를 취소한다(ToolbarView와 동일 관례).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (count !== null) setCount(null)
      else void window.hoppy.captureCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [count])

  // 카운트다운 진행 — 0 에 도달하면 이 디스플레이로 녹화를 시작한다(main 이 툴바·오버레이를 파괴).
  useEffect(() => {
    if (count === null) return
    if (count <= 0) {
      if (!startedRef.current) {
        startedRef.current = true
        void window.hoppy.captureStart('display', context.targetId)
      }
      return
    }
    const id = setTimeout(() => setCount((c) => (c === null ? null : c - 1)), 1000)
    return () => clearTimeout(id)
  }, [count, context.targetId])

  const onConfirm = (): void => {
    if (count !== null) return
    if (context.countdownEnabled) setCount(3)
    else void window.hoppy.captureStart('display', context.targetId)
  }

  return (
    <div className="display-overlay" onClick={onConfirm}>
      {count !== null ? (
        <div
          className="display-overlay-picker display-overlay-countdown"
          role="status"
          aria-live="assertive"
        >
          <span className="countdown-num">{count === 0 ? '●' : count}</span>
          <span className="countdown-hint">Esc 로 취소</span>
        </div>
      ) : (
        <div className="display-overlay-picker">
          <span className="display-overlay-res">
            {context.width}×{context.height} · {CAPTURE_FPS}fps
          </span>
          <button type="button" className="btn btn-record display-overlay-start">
            ● Start recording
          </button>
        </div>
      )}
    </div>
  )
}
