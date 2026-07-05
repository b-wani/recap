import { useEffect, useRef, useState } from 'react'
import type { RecordingState } from '../../shared/ipc'
import {
  deriveRecipe,
  sampleRecipe,
  type CameraTransform,
  type FrameSize,
  type RenderRecipe
} from '../../shared/recipe'
import {
  deleteZoomSegment,
  moveZoomSegment,
  resizeZoomSegment,
  trimRecipe,
  trimmedDurationMs,
  type ZoomEdge
} from '../../shared/recipe.edit'

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = String(Math.floor(total / 60)).padStart(2, '0')
  const s = String(total % 60).padStart(2, '0')
  return `${m}:${s}`
}

export default function App(): JSX.Element {
  const [state, setState] = useState<RecordingState>({ status: 'idle' })

  useEffect(() => window.devScreen.onStateChange(setState), [])

  return (
    <main className="app">
      <h1 className="title">dev-screen</h1>
      {state.status === 'idle' && <IdleView />}
      {state.status === 'recording' && <RecordingView state={state} />}
      {state.status === 'preview' && <PreviewView state={state} />}
      {state.status === 'error' && <ErrorView state={state} />}
    </main>
  )
}

function IdleView(): JSX.Element {
  return (
    <section className="panel">
      <p className="hint">전체 화면 녹화를 시작합니다.</p>
      <button className="btn btn-record" onClick={() => window.devScreen.start()}>
        ● 녹화 시작
      </button>
    </section>
  )
}

function RecordingView({
  state
}: {
  state: Extract<RecordingState, { status: 'recording' }>
}): JSX.Element {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [])

  return (
    <section className="panel">
      <div className="rec-indicator">
        <span className="rec-dot" aria-hidden />
        <span className="rec-label">녹화 중</span>
        <span className="rec-time">{formatElapsed(now - state.startedAt)}</span>
      </div>
      <p className="hint">마우스 이벤트 {state.eventCount}개 기록됨</p>
      <button className="btn btn-stop" onClick={() => window.devScreen.stop()}>
        ■ 정지
      </button>
    </section>
  )
}

function PreviewView({
  state
}: {
  state: Extract<RecordingState, { status: 'preview' }>
}): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const recipeRef = useRef<RenderRecipe | null>(null)
  const [recipe, setRecipe] = useState<RenderRecipe | null>(null)
  const [selected, setSelected] = useState<number | null>(null)

  // RAF 루프는 최신 레시피를 ref로 읽는다 — 편집이 다음 프레임에 즉시 반영된다.
  useEffect(() => {
    recipeRef.current = recipe
  }, [recipe])

  // 영상 메타데이터가 오면(원본 크기 확정) 이벤트 트랙에서 렌더 레시피를 유도한다.
  const handleMetadata = (): void => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    const source: FrameSize = { width: video.videoWidth, height: video.videoHeight }
    canvas.width = source.width
    canvas.height = source.height
    setRecipe(deriveRecipe(state.eventTrack, { source }))
  }

  // 재생 루프: 트림 창 안에서만 반복 재생하고, 매 프레임 샘플링해 그대로 그린다.
  useEffect(() => {
    let raf = 0
    const tick = (): void => {
      raf = requestAnimationFrame(tick)
      const video = videoRef.current
      const canvas = canvasRef.current
      const recipe = recipeRef.current
      if (!video || !canvas || !recipe) return
      const tMs = video.currentTime * 1000
      // 트림 앞뒤 밖으로 나가면 트림 시작으로 되감아 창 안만 재생한다.
      if (tMs < recipe.trim.startMs || tMs >= recipe.trim.endMs) {
        video.currentTime = recipe.trim.startMs / 1000
      }
      const camera = sampleRecipe(recipe, video.currentTime * 1000)
      drawSampledFrame(canvas, video, camera, recipe.source)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <section className="panel preview">
      <video
        ref={videoRef}
        src={state.videoUrl}
        onLoadedMetadata={handleMetadata}
        autoPlay
        muted
        playsInline
        style={{ display: 'none' }}
      />
      <canvas ref={canvasRef} className="preview-canvas" />
      {recipe && (
        <Timeline
          recipe={recipe}
          selected={selected}
          onSelect={setSelected}
          onChange={setRecipe}
        />
      )}
      <dl className="meta">
        <div>
          <dt>길이</dt>
          <dd>
            {recipe ? formatElapsed(trimmedDurationMs(recipe)) : formatElapsed(state.durationMs)}
            {recipe && trimmedDurationMs(recipe) !== state.durationMs && (
              <span className="meta-sub"> (원본 {formatElapsed(state.durationMs)})</span>
            )}
          </dd>
        </div>
        <div>
          <dt>자동 줌</dt>
          <dd>{recipe?.zoomSegments.length ?? 0}개 구간 (클릭에서 자동 생성)</dd>
        </div>
        <div>
          <dt>이벤트 트랙</dt>
          <dd>{state.eventCount}개 이벤트 (events.json 분리 저장)</dd>
        </div>
        <div>
          <dt>폴더</dt>
          <dd className="path">{state.folder}</dd>
        </div>
      </dl>
      <button className="btn btn-record" onClick={() => window.devScreen.start()}>
        ● 다시 녹화
      </button>
    </section>
  )
}

/**
 * 편집 타임라인 — 경량 편집의 전부를 담는 얇은 UI 층.
 *
 * 사용자 조작(줌 구간 삭제/이동/길이 조절, 앞뒤 트리밍)을 recipe.edit의 변환 함수
 * 호출로 옮기고, 그 결과 레시피를 onChange로 올린다. 편집 규칙과 경계 처리는 전부
 * 변환 함수 안에 있으므로 여기서는 픽셀↔ms 환산과 드래그 배선만 한다.
 *
 * 컷 편집(중간 잘라내기)·속도 조절·자막은 여기에 컨트롤이 없다(SPEC 범위 제외).
 */
function Timeline({
  recipe,
  selected,
  onSelect,
  onChange
}: {
  recipe: RenderRecipe
  selected: number | null
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

  const onDelete = (index: number) => (): void => {
    onChange(deleteZoomSegment(recipe, index))
    onSelect(null)
  }

  return (
    <div className="timeline">
      <div
        ref={trackRef}
        className="tl-track"
        onPointerDown={() => onSelect(null)}
      >
        {/* 트림 창 밖(앞/뒤)은 어둡게 — 최종 영상에서 제외되는 구간. */}
        <div className="tl-trimmed" style={{ left: 0, width: pct(trim.startMs) }} />
        <div
          className="tl-trimmed"
          style={{ left: pct(trim.endMs), width: pct(durationMs - trim.endMs) }}
        />

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
            {selected === i && (
              <button
                className="tl-seg-del"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={onDelete(i)}
                title="줌 구간 삭제"
              >
                ×
              </button>
            )}
          </div>
        ))}

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
      <p className="tl-help">
        줌 구간을 끌어 이동 · 가장자리로 길이 조절 · 선택 후 ×로 삭제 · 양끝 핸들로 앞뒤
        트리밍
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

/**
 * 미리보기 렌더링 층 — 효과 계산을 하지 않는다. 샘플링된 카메라 변환(camera)이
 * 지정한 원본 영역을 캔버스에 그리기만 한다.
 */
function drawSampledFrame(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  camera: CameraTransform,
  source: FrameSize
): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const viewW = source.width / camera.scale
  const viewH = source.height / camera.scale
  const sx = camera.x - viewW / 2
  const sy = camera.y - viewH / 2
  ctx.drawImage(video, sx, sy, viewW, viewH, 0, 0, canvas.width, canvas.height)
}

function ErrorView({
  state
}: {
  state: Extract<RecordingState, { status: 'error' }>
}): JSX.Element {
  const isPermission = state.code === 'permission-denied'
  return (
    <section className="panel error">
      <h2>{isPermission ? '화면 녹화 권한이 필요합니다' : '녹화에 실패했습니다'}</h2>
      <p className="err-message">{state.message}</p>
      {isPermission && (
        <ol className="steps">
          <li>시스템 설정 → 개인정보 보호 및 보안 → 화면 기록을 엽니다.</li>
          <li>목록에서 dev-screen을 켭니다.</li>
          <li>앱을 다시 실행한 뒤 아래 버튼으로 재시도합니다.</li>
        </ol>
      )}
      <button className="btn" onClick={() => window.devScreen.start()}>
        다시 시도
      </button>
    </section>
  )
}
