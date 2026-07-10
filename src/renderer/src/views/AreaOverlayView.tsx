import { useCallback, useEffect, useRef, useState } from 'react'
import type { Rect } from '../../../shared/ipc'
import {
  rectFromPoints,
  moveRect,
  resizeRectByHandle,
  type ResizeHandle
} from '../../../shared/area-rect'

/** 확정 전 리사이즈 8핸들 렌더 순서 — 모서리 4 + 변 4. */
const HANDLES: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

type DragState =
  | { kind: 'draw'; startX: number; startY: number }
  | { kind: 'move'; startX: number; startY: number; startRect: Rect }
  | { kind: 'resize'; handle: ResizeHandle; startX: number; startY: number; startRect: Rect }

/**
 * Area 모드 선택 오버레이(#72) — 디스플레이 전체를 덮는 자식 창. 드래그로 사각형을 그리고,
 * 확정 전 8핸들 리사이즈 + 내부 드래그 이동을 지원한다. Start(rec pill)/Enter 로 확정하면
 * 오버레이 로컬 rect(DIP, 좌상단 원점)를 main 에 넘긴다 — 전역 좌표 매핑은 main 책임(#57 §4).
 */
export function AreaOverlayView(): JSX.Element {
  const [rect, setRect] = useState<Rect | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const boundsRef = useRef({ width: window.innerWidth, height: window.innerHeight })

  const cancel = useCallback((): void => void window.recap.captureCancel(), [])

  const confirm = useCallback((): void => {
    if (!rect || rect.width <= 0 || rect.height <= 0) return
    void window.recap.captureAreaConfirm(rect)
  }, [rect])

  // ESC = 취소, Enter = 확정(사각형이 있을 때만). 어느 컨트롤에 포커스가 있든 동작한다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') cancel()
      else if (e.key === 'Enter') confirm()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cancel, confirm])

  // 드래그 중(그리기/이동/리사이즈) 마우스 이동·업은 창 전체에서 받는다 — 핸들/사각형
  // 밖으로 커서가 나가도 드래그가 끊기지 않게. 이동 결과는 오버레이 경계(bounds) 안으로 클램프된다.
  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      const drag = dragRef.current
      if (!drag) return
      const bounds = boundsRef.current
      if (drag.kind === 'draw') {
        setRect(rectFromPoints(drag.startX, drag.startY, e.clientX, e.clientY))
      } else if (drag.kind === 'move') {
        setRect(moveRect(drag.startRect, e.clientX - drag.startX, e.clientY - drag.startY, bounds))
      } else {
        setRect(
          resizeRectByHandle(
            drag.startRect,
            drag.handle,
            e.clientX - drag.startX,
            e.clientY - drag.startY,
            bounds
          )
        )
      }
    }
    const onUp = (): void => {
      dragRef.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  // 딤(사각형 밖) 위 mousedown = 새 드래그로 처음부터 다시 그린다.
  const onDimMouseDown = (e: React.MouseEvent): void => {
    dragRef.current = { kind: 'draw', startX: e.clientX, startY: e.clientY }
    setRect({ x: e.clientX, y: e.clientY, width: 0, height: 0 })
  }

  const onRectMouseDown = (e: React.MouseEvent): void => {
    e.stopPropagation()
    if (!rect) return
    dragRef.current = { kind: 'move', startX: e.clientX, startY: e.clientY, startRect: rect }
  }

  const onHandleMouseDown =
    (handle: ResizeHandle) =>
    (e: React.MouseEvent): void => {
      e.stopPropagation()
      if (!rect) return
      dragRef.current = { kind: 'resize', handle, startX: e.clientX, startY: e.clientY, startRect: rect }
    }

  const hasRect = rect !== null && rect.width > 0 && rect.height > 0

  return (
    <div className="area-overlay" onMouseDown={onDimMouseDown}>
      {hasRect && rect ? (
        <div
          className="area-rect"
          style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
          onMouseDown={onRectMouseDown}
        >
          <span className="area-size-badge">
            {Math.round(rect.width)}×{Math.round(rect.height)}
          </span>
          {HANDLES.map((h) => (
            <span
              key={h}
              className={`area-handle area-handle-${h}`}
              onMouseDown={onHandleMouseDown(h)}
            />
          ))}
          <button type="button" className="btn btn-record area-start" onClick={confirm}>
            ● 녹화 시작
          </button>
        </div>
      ) : null}
      <button type="button" className="icon-btn area-cancel" aria-label="취소" onClick={cancel}>
        ✕
      </button>
    </div>
  )
}
