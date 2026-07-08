import { useEffect, useRef, useState } from 'react'
import type { RecordingState } from '../../../shared/ipc'
import {
  deriveRecipe,
  sampleComposition,
  type FrameSize,
  type RenderRecipe
} from '../../../shared/recipe'
import { deleteZoomSegment, trimmedDurationMs } from '../../../shared/recipe.edit'
import { drawComposition } from '../compose'
import { GITHUB_PRESET, exceedsSizeLimit, type ExportFormat } from '../../../shared/export-preset'
import { renderRecipeToMp4, renderRecipeToGif } from '../export'
import { formatElapsed } from '../format'
import { Timeline } from '../components/Timeline'
import { Sidebar } from '../components/Sidebar'
import { type ExportStatus } from '../components/ExportPanel'

export function PreviewView({
  state,
  onExit
}: {
  state: Extract<RecordingState, { status: 'preview' }>
  onExit: () => void
}): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const recipeRef = useRef<RenderRecipe | null>(null)
  const [recipe, setRecipe] = useState<RenderRecipe | null>(null)
  // 선택 상태는 이 하나로 소유한다(줌 구간 인덱스 문자열, 없으면 null). 빈 곳 클릭·Esc로 해제.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [exportStatus, setExportStatus] = useState<ExportStatus>({ phase: 'idle' })
  const [playing, setPlaying] = useState(true)
  const [currentMs, setCurrentMs] = useState(0)

  // 편집기 진입 동안 창을 넓히고(#35), 목록·재녹화 등으로 벗어나면 원래 크기로 되돌린다.
  useEffect(() => {
    void window.recap.setEditorMode(true)
    return () => void window.recap.setEditorMode(false)
  }, [])

  // Esc로 선택을 해제해 사이드바를 기본 패널로 되돌린다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setSelectedId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // RAF 루프·익스포트는 최신 레시피를 ref로 읽는다 — 편집(타임라인·배경/배지·커서)이 다음 프레임에 즉시 반영된다.
  // 편집 상태는 그대로 녹화 폴더에 저장해 다시 열었을 때 복원되게 한다(이슈 #9 영속화).
  useEffect(() => {
    recipeRef.current = recipe
    if (recipe) void window.recap.saveRecipe(state.folder, recipe)
  }, [recipe, state.folder])

  // 영상 메타데이터가 오면(원본 크기 확정) 렌더 레시피를 확정한다.
  // 다시 연 녹화면 저장된 레시피(편집 상태)를 그대로 복원하고, 갓 끝난 녹화면
  // 이벤트 트랙에서 유도한다(저장은 위 useEffect가 담당한다).
  const handleMetadata = (): void => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return

    let next: RenderRecipe
    if (state.recipe) {
      next = state.recipe
    } else {
      const source: FrameSize = { width: video.videoWidth, height: video.videoHeight }
      // 배경/패딩·배지 기본값은 deriveRecipe가 레시피에 담아 준다(이슈 #8: 레시피에 저장).
      next = deriveRecipe(state.eventTrack, { source })
    }
    canvas.width = next.source.width
    canvas.height = next.source.height
    setRecipe(next)
  }

  // 재생 루프: 트림 창 안에서만 반복 재생하고, 매 프레임 합성 파라미터를 샘플링해 그대로 그린다.
  const lastTickRef = useRef(0)
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
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      // 카메라·커서·클릭·배경/패딩·배지를 한 번에 샘플링해 공용 그리기 함수로 그린다.
      const comp = sampleComposition(recipe, video.currentTime * 1000)
      drawComposition(ctx, video, comp, recipe.source)
      // 재생 헤드 표시는 ~12fps로만 갱신해 리렌더를 억제한다.
      const now = performance.now()
      if (now - lastTickRef.current > 80) {
        lastTickRef.current = now
        setCurrentMs(video.currentTime * 1000)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  // 익스포트: 미리보기와 동일한 레시피로 원본을 인코딩해 폴더에 저장한다(MP4/GIF 선택).
  const handleExport = async (format: ExportFormat): Promise<void> => {
    const video = videoRef.current
    const recipe = recipeRef.current
    if (!video || !recipe) return
    setExportStatus({ phase: 'encoding', format, renderedFrames: 0, totalFrames: 0 })
    try {
      const render = format === 'gif' ? renderRecipeToGif : renderRecipeToMp4
      const bytes = await render(video, recipe, GITHUB_PRESET, (p) =>
        setExportStatus({ phase: 'encoding', format, ...p })
      )
      const { path, sizeBytes } = await window.recap.saveExport(bytes, state.folder, format)
      setExportStatus({
        phase: 'done',
        format,
        path,
        sizeBytes,
        exceedsLimit: exceedsSizeLimit(GITHUB_PRESET, sizeBytes, format)
      })
    } catch (err) {
      setExportStatus({ phase: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  const togglePlay = (): void => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) void video.play()
    else video.pause()
  }

  const selected = selectedId === null ? null : Number(selectedId)
  const update = (fn: (r: RenderRecipe) => RenderRecipe): void =>
    setRecipe((r) => (r ? fn(r) : r))
  const onDeleteSegment = (index: number): void => {
    update((r) => deleteZoomSegment(r, index))
    setSelectedId(null)
  }

  // 트림 반영 길이 (메타 바·재생 컨트롤에서 공유).
  const lengthMs = recipe ? trimmedDurationMs(recipe) : state.durationMs

  return (
    <section className="editor">
      <video
        ref={videoRef}
        src={state.videoUrl}
        onLoadedMetadata={handleMetadata}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        crossOrigin="anonymous"
        autoPlay
        muted
        playsInline
        style={{ display: 'none' }}
      />

      {/* 캔버스 위 얇은 메타 바 — 대상·길이 + 목록/재녹화 액션 */}
      <header className="editor-bar">
        <button className="btn btn-ghost btn-sm" onClick={onExit}>
          ← 목록
        </button>
        <div className="editor-bar-meta">
          <span>
            {state.target.kind === 'display' ? '전체 화면' : '창'} — {state.target.title} (
            {Math.round(state.target.width)}×{Math.round(state.target.height)})
          </span>
          <span className="dot-sep" aria-hidden>
            ·
          </span>
          <span className="len">{formatElapsed(lengthMs)}</span>
          {recipe && lengthMs !== state.durationMs && (
            <span className="meta-sub">(원본 {formatElapsed(state.durationMs)})</span>
          )}
        </div>
        <button className="btn btn-record btn-sm" onClick={() => window.recap.start(state.target.id)}>
          ● 같은 대상 다시 녹화
        </button>
      </header>

      {/* 3영역: 좌상단 캔버스 · 우측 사이드바 · 하단 전폭 타임라인 */}
      <div className="editor-body">
        <div className="canvas-wrap">
          <canvas ref={canvasRef} className="preview-canvas" />
        </div>

        {recipe && (
          <Sidebar
            recipe={recipe}
            update={update}
            selected={selected}
            onDeleteSegment={onDeleteSegment}
            exportStatus={exportStatus}
            onExport={handleExport}
            eventCount={state.eventCount}
            folder={state.folder}
          />
        )}

        {recipe && (
          <div className="editor-timeline">
            <div className="playback">
              <button
                className="btn btn-sm playback-toggle"
                onClick={togglePlay}
                aria-label={playing ? '일시정지' : '재생'}
              >
                {playing ? '⏸' : '▶'}
              </button>
              <span className="playback-time">
                {formatElapsed(Math.max(0, currentMs - recipe.trim.startMs))} / {formatElapsed(lengthMs)}
              </span>
            </div>
            <Timeline
              recipe={recipe}
              selected={selected}
              currentMs={currentMs}
              onSelect={(i) => setSelectedId(i === null ? null : String(i))}
              onChange={setRecipe}
            />
          </div>
        )}
      </div>
    </section>
  )
}
