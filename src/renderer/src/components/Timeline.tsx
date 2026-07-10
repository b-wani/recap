import { useRef } from 'react'
import {
  moveZoomSegment,
  resizeZoomSegment,
  trimRecipe,
  type ZoomEdge
} from '../../../shared/recipe.edit'
import type { RenderRecipe } from '../../../shared/recipe'

/**
 * 편집 타임라인 — 경량 편집의 전부를 담는 얇은 UI 층.
 *
 * 사용자 조작(줌 구간 삭제/이동/길이 조절, 앞뒤 트리밍)을 recipe.edit의 변환 함수
 * 호출로 옮기고, 그 결과 레시피를 onChange로 올린다. 편집 규칙과 경계 처리는 전부
 * 변환 함수 안에 있으므로 여기서는 픽셀↔ms 환산과 드래그 배선만 한다.
 *
 * 컷 편집(중간 잘라내기)·속도 조절·자막은 여기에 컨트롤이 없다(SPEC 범위 제외).
 */
export function Timeline({
  recipe,
  selected,
  currentMs,
  onSelect,
  onChange
}: {
  recipe: RenderRecipe
  selected: number | null
  /** 재생 헤드 위치(ms) — 트랙 위에 세로선으로 표시한다. */
  currentMs: number
  onSelect: (index: number | null) => void
  onChange: (recipe: RenderRecipe) => void
}): JSX.Element {
  const trackRef = useRef<HTMLDivElement>(null)
  const { durationMs, trim, zoomSegments } = recipe
  const pct = (ms: number): string => `${(ms / durationMs) * 100}%`

  // 드래그 시작 시점의 레시피를 스냅샷으로 잡고, 이동량(ms)을 변환 함수에 넘긴다.
  const onTrimDrag = (edge: 'startMs' | 'endMs') => (e: React.PointerEvent): void => {
    const snap = recipe
    const baseMs = edge === 'startMs' ? snap.trim.startMs : snap.trim.endMs
    beginDrag(e, trackRef.current, durationMs, (deltaMs) => {
      onChange(trimRecipe(snap, { [edge]: baseMs + deltaMs }))
    })
  }

  const onSegmentMove = (index: number) => (e: React.PointerEvent): void => {
    onSelect(index)
    const snap = recipe
    beginDrag(e, trackRef.current, durationMs, (deltaMs) => {
      onChange(moveZoomSegment(snap, index, deltaMs))
    })
  }

  const onSegmentResize =
    (index: number, edge: ZoomEdge) =>
    (e: React.PointerEvent): void => {
      onSelect(index)
      const snap = recipe
      beginDrag(e, trackRef.current, durationMs, (deltaMs) => {
        onChange(resizeZoomSegment(snap, index, edge, deltaMs))
      })
    }

  return (
    <div className="timeline">
      {/* 재생 헤드가 두 레인을 관통하도록 같은 폭의 래퍼 안에 트랙(클립 레인, 픽셀↔ms 기준)과
          줌 레인을 함께 둔다. 빈 곳 클릭은 여기서 한 번만 받아 선택을 해제한다. */}
      <div ref={trackRef} className="tl-lanes" onPointerDown={() => onSelect(null)}>
        <p className="tl-lane-label">클립</p>
        <div className="tl-lane tl-lane-clip">
          <div className="tl-film" aria-hidden />
          {/* 트림 창 밖(앞/뒤)은 어둡게 — 최종 영상에서 제외되는 구간. */}
          <div className="tl-trimmed" style={{ left: 0, width: pct(trim.startMs) }} />
          <div
            className="tl-trimmed"
            style={{ left: pct(trim.endMs), width: pct(durationMs - trim.endMs) }}
          />
          {/* 트림 핸들 — 앞뒤로 끌어 최종 영상 범위를 정한다. */}
          <span
            className="tl-trim-handle tl-trim-start"
            style={{ left: pct(trim.startMs) }}
            onPointerDown={onTrimDrag('startMs')}
            title="앞 트리밍"
          />
          <span
            className="tl-trim-handle tl-trim-end"
            style={{ left: pct(trim.endMs) }}
            onPointerDown={onTrimDrag('endMs')}
            title="뒤 트리밍"
          />
        </div>

        <p className="tl-lane-label">줌 구간</p>
        <div className="tl-lane tl-lane-zoom">
          {zoomSegments.map((seg, i) => (
            <div
              key={i}
              className={`tl-seg${selected === i ? ' is-selected' : ''}`}
              style={{ left: pct(seg.startMs), width: pct(seg.endMs - seg.startMs) }}
              onPointerDown={onSegmentMove(i)}
              title="드래그로 이동 · 가장자리로 길이 조절"
            >
              <span
                className="tl-seg-edge tl-seg-edge-start"
                onPointerDown={onSegmentResize(i, 'start')}
              />
              <span className="tl-seg-label">🔍 {(seg.endMs - seg.startMs) / 1000}s</span>
              <span
                className="tl-seg-edge tl-seg-edge-end"
                onPointerDown={onSegmentResize(i, 'end')}
              />
            </div>
          ))}
        </div>

        {/* 재생 헤드 — 현재 재생 위치. 클립·줌 두 레인을 관통한다. */}
        <span className="tl-playhead" style={{ left: pct(currentMs) }} aria-hidden />
      </div>
      <p className="tl-help">
        줌 구간을 끌어 이동 · 가장자리로 길이 조절 · 선택하면 사이드바에서 배율·삭제 · 양끝
        앰버 핸들로 앞뒤 트리밍
      </p>
    </div>
  )
}

/**
 * 포인터 드래그 배선 — 드래그 시작점 대비 이동 픽셀을 트랙 폭 기준 ms로 환산해
 * onDelta에 흘린다. 이벤트 전파를 막아 상위(트랙 클릭=선택 해제)와 겹치지 않게 한다.
 */
function beginDrag(
  e: React.PointerEvent,
  trackEl: HTMLElement | null,
  durationMs: number,
  onDelta: (deltaMs: number) => void
): void {
  if (!trackEl) return
  e.preventDefault()
  e.stopPropagation()
  const startX = e.clientX
  const msPerPx = durationMs / trackEl.getBoundingClientRect().width
  const move = (ev: PointerEvent): void => onDelta((ev.clientX - startX) * msPerPx)
  const up = (): void => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}
