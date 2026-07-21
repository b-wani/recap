import { useRef, useState } from 'react'
import {
  deleteClip,
  moveZoomSegment,
  resizeZoomSegment,
  setClipBoundary,
  setClipSpeed,
  splitClip,
  type ZoomEdge
} from '../../../shared/recipe.edit'
import { SPEED_DEFAULTS, sourceAtOutput, type RenderRecipe } from '../../../shared/recipe'

/**
 * 편집 타임라인 — 경량 편집의 전부를 담는 얇은 UI 층.
 *
 * 사용자 조작(줌 구간 삭제/이동/길이 조절, 앞뒤 트리밍=양끝 클립 경계, 컷=분할·삭제, 속도)을
 * recipe.edit의 변환 함수 호출로 옮기고, 그 결과 레시피를 onChange로 올린다. 편집 규칙과 경계
 * 처리는 전부 변환 함수 안에 있으므로 여기서는 픽셀↔ms 환산과 드래그 배선만 한다.
 *
 * 클립 레인은 source 시간축([0, durationMs])에 클립들을 그린다 — 클립 사이/양끝의 어두운 구간이
 * 컷(제거된 source)이다. 재생 헤드는 출력 시간(currentMs)이라 source로 되돌려 표시한다.
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
  /** 재생 헤드 위치(출력 ms) — source로 되돌려 트랙 위에 세로선으로 표시한다. */
  currentMs: number
  onSelect: (index: number | null) => void
  onChange: (recipe: RenderRecipe) => void
}): JSX.Element {
  const trackRef = useRef<HTMLDivElement>(null)
  const { durationMs, clips, zoomSegments } = recipe
  const pct = (ms: number): string => `${(ms / durationMs) * 100}%`

  // 선택된 클립 id(로컬) — 속도·삭제 편집 대상. split이 index를 밀어도 id로 안정 추적한다.
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null)
  const selectedClip = clips.find((c) => c.id === selectedClipId)

  // 재생 헤드의 source 시각(컷·속도 매핑을 되돌린 값).
  const playheadSourceMs = sourceAtOutput(recipe, currentMs)

  // 트림(양끝 클립 경계) 드래그 — 시작 스냅샷 기준 이동량(ms)을 setClipBoundary에 넘긴다.
  const onBoundaryDrag = (edge: 'start' | 'end') => (e: React.PointerEvent): void => {
    const snap = recipe
    const baseMs =
      edge === 'start' ? snap.clips[0].sourceStartMs : snap.clips[snap.clips.length - 1].sourceEndMs
    beginDrag(e, trackRef.current, durationMs, (deltaMs) => {
      onChange(setClipBoundary(snap, edge, baseMs + deltaMs))
    })
  }

  // 재생 헤드가 걸친 클립을 그 지점에서 둘로 나눈다(컷의 첫 절반). 이어 한쪽을 삭제하면 간극이 컷.
  const onSplit = (): void => {
    const clip = clips.find(
      (c) => playheadSourceMs > c.sourceStartMs && playheadSourceMs < c.sourceEndMs
    )
    if (!clip) return
    onChange(splitClip(recipe, clip.id, playheadSourceMs))
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

  const firstStart = clips[0].sourceStartMs
  const lastEnd = clips[clips.length - 1].sourceEndMs

  return (
    <div className="timeline">
      {/* 재생 헤드가 두 레인을 관통하도록 같은 폭의 래퍼 안에 트랙(클립 레인, 픽셀↔ms 기준)과
          줌 레인을 함께 둔다. 빈 곳 클릭은 여기서 한 번만 받아 선택을 해제한다. */}
      <div
        ref={trackRef}
        className="tl-lanes"
        onPointerDown={() => {
          onSelect(null)
          setSelectedClipId(null)
        }}
      >
        <p className="tl-lane-label">클립</p>
        <div className="tl-lane tl-lane-clip">
          <div className="tl-film" aria-hidden />
          {/* 컷(제거된 source) — 첫 클립 앞·클립 사이 간극·마지막 클립 뒤를 어둡게. */}
          <div className="tl-trimmed" style={{ left: 0, width: pct(firstStart) }} />
          <div
            className="tl-trimmed"
            style={{ left: pct(lastEnd), width: pct(durationMs - lastEnd) }}
          />
          {clips.slice(1).map((c, i) => {
            const prevEnd = clips[i].sourceEndMs
            return (
              <div
                key={`gap-${c.id}`}
                className="tl-trimmed"
                style={{ left: pct(prevEnd), width: pct(c.sourceStartMs - prevEnd) }}
              />
            )
          })}
          {/* 클립 블록 — 클릭으로 선택(속도·삭제 대상). */}
          {clips.map((c) => (
            <div
              key={c.id}
              className={`tl-clip${selectedClipId === c.id ? ' is-selected' : ''}`}
              style={{ left: pct(c.sourceStartMs), width: pct(c.sourceEndMs - c.sourceStartMs) }}
              onPointerDown={(e) => {
                e.stopPropagation()
                onSelect(null)
                setSelectedClipId(c.id)
              }}
              title="클릭해 선택 · 속도·삭제 편집"
            >
              {c.speed !== 1 && <span className="tl-clip-speed">{c.speed}×</span>}
            </div>
          ))}
          {/* 트림 핸들 — 양끝 클립 경계를 끌어 앞뒤 트리밍한다. */}
          <span
            className="tl-trim-handle tl-trim-start"
            style={{ left: pct(firstStart) }}
            onPointerDown={onBoundaryDrag('start')}
            title="앞 트리밍"
          />
          <span
            className="tl-trim-handle tl-trim-end"
            style={{ left: pct(lastEnd) }}
            onPointerDown={onBoundaryDrag('end')}
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

        {/* 재생 헤드 — 현재 재생 위치(source). 클립·줌 두 레인을 관통한다. */}
        <span className="tl-playhead" style={{ left: pct(playheadSourceMs) }} aria-hidden />
      </div>

      {/* 클립 편집 툴바 — 재생 위치 분할 + (선택 시) 속도·삭제. */}
      <div className="tl-clip-tools">
        <button type="button" className="btn btn-sm" onClick={onSplit}>
          ✂ 재생 위치에서 분할
        </button>
        {selectedClip && (
          <>
            <span className="tl-clip-tools-sep" aria-hidden>
              ·
            </span>
            <span className="side-hint">속도</span>
            <div className="scale-buttons">
              {SPEED_DEFAULTS.speeds.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`btn btn-scale${selectedClip.speed === s ? ' is-active' : ''}`}
                  onClick={() => onChange(setClipSpeed(recipe, selectedClip.id, s))}
                >
                  {s}×
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn btn-sm btn-danger"
              disabled={clips.length <= 1}
              onClick={() => {
                onChange(deleteClip(recipe, selectedClip.id))
                setSelectedClipId(null)
              }}
            >
              클립 삭제
            </button>
          </>
        )}
      </div>

      <p className="tl-help">
        클립을 클릭해 속도·삭제 · 재생 위치에서 분할해 컷 · 줌 구간을 끌어 이동·길이 조절 · 양끝
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
