import { useEffect, useRef, useState } from 'react'
import type { CaptureTarget, WindowPickerOverlayContext } from '../../../shared/ipc'
import { flipRect, hitTestWindowAt } from '../../../shared/window-picker'

interface HighlightRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Window 선택 오버레이(#73) — 가상 데스크톱 전체를 덮는 딤 창의 렌더러 쪽. 기본은
 * 클릭스루(main 이 `setIgnoreMouseEvents(true, {forward:true})`로 열어 둔다)라, 여기선
 * 포워딩된 `mousemove`만으로 커서 아래 창을 히트테스트하고 하이라이트를 그린다. 호버가
 * 생기면 `overlay:hover`로 알려 그 순간만 클릭스루를 끄고, 다음 클릭을 이 창이 직접 받아
 * `overlay:select`로 확정한다 — 그래서 빈 데스크톱 클릭은 아래로 흘러 사실상 무시된다(#73).
 */
export function WindowPickerOverlayView({ windowId }: { windowId: number }): JSX.Element {
  const [context, setContext] = useState<WindowPickerOverlayContext | null>(null)
  const [targets, setTargets] = useState<CaptureTarget[]>([])
  const [hover, setHover] = useState<{ target: CaptureTarget; rect: HighlightRect } | null>(null)
  const hoveringRef = useRef(false)

  useEffect(() => {
    void window.hoppy.getWindowContext(windowId).then((c) => setContext(c as WindowPickerOverlayContext))
    void window.hoppy.listTargets().then(setTargets)
  }, [windowId])

  useEffect(() => {
    if (!context) return

    const onMove = (e: MouseEvent): void => {
      // main 이 좌표를 얹어 오는 게 아니라 clientX/Y(오버레이 로컬)뿐이라, 이 창의 전역
      // 원점(originX/Y)을 더해 Electron 화면 좌표(좌상단 원점)로 되돌린 뒤 히트테스트한다.
      const point = { x: context.originX + e.clientX, y: context.originY + e.clientY }
      const hit = hitTestWindowAt(point, targets, context.screenHeightPt)

      if (hit && hit.frame) {
        const flipped = flipRect(hit.frame, context.screenHeightPt)
        setHover({
          target: hit,
          rect: {
            x: flipped.x - context.originX,
            y: flipped.y - context.originY,
            width: flipped.width,
            height: flipped.height
          }
        })
        if (!hoveringRef.current) {
          hoveringRef.current = true
          void window.hoppy.overlayHover(true)
        }
      } else {
        setHover(null)
        if (hoveringRef.current) {
          hoveringRef.current = false
          void window.hoppy.overlayHover(false)
        }
      }
    }

    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [context, targets])

  // 클릭스루가 꺼져 있을 때만(=호버 중일 때만) 이 창이 클릭을 받는다 — 빈 데스크톱
  // 클릭은 애초에 이 핸들러에 닿지 않고 아래 창으로 흘러간다.
  const onClick = (): void => {
    if (!hover) return
    void window.hoppy.overlaySelect(hover.target.id)
  }

  return (
    <div className="window-picker-overlay" onClick={onClick}>
      {hover ? (
        <div
          className="window-picker-highlight"
          style={{
            left: hover.rect.x,
            top: hover.rect.y,
            width: hover.rect.width,
            height: hover.rect.height
          }}
        >
          <span className="window-picker-label">{hover.target.title}</span>
        </div>
      ) : null}
    </div>
  )
}
