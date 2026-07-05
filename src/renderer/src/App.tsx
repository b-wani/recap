import { useEffect, useRef, useState } from 'react'
import type { RecordingState } from '../../shared/ipc'
import {
  deriveRecipe,
  sampleRecipe,
  type CameraTransform,
  type FrameSize,
  type RenderRecipe
} from '../../shared/recipe'

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
  const [zoomCount, setZoomCount] = useState(0)

  // 영상 메타데이터가 오면(원본 크기 확정) 이벤트 트랙에서 렌더 레시피를 유도한다.
  const handleMetadata = (): void => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    const source: FrameSize = { width: video.videoWidth, height: video.videoHeight }
    canvas.width = source.width
    canvas.height = source.height
    const recipe = deriveRecipe(state.eventTrack, { source })
    recipeRef.current = recipe
    setZoomCount(recipe.zoomSegments.length)
  }

  // 재생 루프: 매 프레임 현재 시각을 샘플링해 카메라 변환을 얻고, 그대로 그린다.
  useEffect(() => {
    let raf = 0
    const tick = (): void => {
      raf = requestAnimationFrame(tick)
      const video = videoRef.current
      const canvas = canvasRef.current
      const recipe = recipeRef.current
      if (!video || !canvas || !recipe) return
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
        loop
        playsInline
        style={{ display: 'none' }}
      />
      <canvas ref={canvasRef} className="preview-canvas" />
      <dl className="meta">
        <div>
          <dt>길이</dt>
          <dd>{formatElapsed(state.durationMs)}</dd>
        </div>
        <div>
          <dt>자동 줌</dt>
          <dd>{zoomCount}개 구간 (클릭에서 자동 생성)</dd>
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
