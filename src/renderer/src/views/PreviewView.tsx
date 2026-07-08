import { useEffect, useRef, useState } from 'react'
import type { RecordingState } from '../../../shared/ipc'
import {
  deriveRecipe,
  sampleComposition,
  ZOOM_DEFAULTS,
  type FrameSize,
  type RenderRecipe
} from '../../../shared/recipe'
import { setZoomSegmentScale, trimmedDurationMs } from '../../../shared/recipe.edit'
import { drawComposition } from '../compose'
import { GITHUB_PRESET, exceedsSizeLimit, type ExportFormat } from '../../../shared/export-preset'
import { renderRecipeToMp4, renderRecipeToGif } from '../export'
import { formatElapsed } from '../format'
import { Timeline } from '../components/Timeline'
import { ExportPanel, type ExportStatus } from '../components/ExportPanel'

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
  const [selected, setSelected] = useState<number | null>(null)
  const [exportStatus, setExportStatus] = useState<ExportStatus>({ phase: 'idle' })
  const [sidebarOpen, setSidebarOpen] = useState(true)

  // RAF 루프·익스포트는 최신 레시피를 ref로 읽는다 — 편집(타임라인·배경/배지)이 다음 프레임에 즉시 반영된다.
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

  // 트림 반영 길이 (메타 바·사이드바에서 공유).
  const lengthMs = recipe ? trimmedDurationMs(recipe) : state.durationMs

  return (
    <section className="editor">
      <video
        ref={videoRef}
        src={state.videoUrl}
        onLoadedMetadata={handleMetadata}
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

      <div className="editor-body">
        <div className="editor-main">
          <div className="canvas-wrap">
            <canvas ref={canvasRef} className="preview-canvas" />
          </div>
          {recipe && (
            <Timeline
              recipe={recipe}
              selected={selected}
              onSelect={setSelected}
              onChange={setRecipe}
            />
          )}
        </div>

        {sidebarOpen && recipe && (
          <aside className="editor-sidebar">
            {/* ① 줌 구간 — 선택된 구간이 있을 때만 배율 버튼 */}
            <fieldset className="side-section">
              <legend className="side-section-title">줌 구간</legend>
              {selected !== null && recipe.zoomSegments[selected] ? (
                <>
                  <p className="side-hint">구간 #{selected + 1} 배율</p>
                  <div className="scale-buttons">
                    {ZOOM_DEFAULTS.scales.map((s) => (
                      <button
                        key={s}
                        type="button"
                        className={`btn btn-scale${recipe.zoomSegments[selected].scale === s ? ' is-active' : ''}`}
                        onClick={() => setRecipe((r) => (r ? setZoomSegmentScale(r, selected, s) : r))}
                      >
                        {s.toFixed(1)}x
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <p className="side-hint">타임라인에서 줌 구간을 선택하면 배율을 조절할 수 있습니다.</p>
              )}
            </fieldset>

            {/* ② 배경 / 패딩 */}
            <fieldset className="side-section">
              <legend className="side-section-title">배경 / 패딩</legend>
              <label className="control control-row">
                <span>배경색</span>
                <input
                  type="color"
                  value={recipe.background.color}
                  onChange={(e) =>
                    setRecipe((r) =>
                      r ? { ...r, background: { ...r.background, color: e.target.value } } : r
                    )
                  }
                />
              </label>
              <label className="control">
                <span className="control-row">
                  <span>패딩</span>
                  <span className="control-value">{Math.round(recipe.background.padding * 100)}%</span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={0.4}
                  step={0.01}
                  value={recipe.background.padding}
                  onChange={(e) =>
                    setRecipe((r) =>
                      r
                        ? { ...r, background: { ...r.background, padding: Number(e.target.value) } }
                        : r
                    )
                  }
                />
              </label>
            </fieldset>

            {/* ③ 배지 · 키 입력 오버레이 */}
            <fieldset className="side-section">
              <legend className="side-section-title">배지 · 키 입력</legend>
              <label className="control control-check">
                <input
                  type="checkbox"
                  checked={recipe.badge.visible}
                  onChange={(e) =>
                    setRecipe((r) =>
                      r ? { ...r, badge: { ...r.badge, visible: e.target.checked } } : r
                    )
                  }
                />
                <span>뷰포트 크기 배지</span>
              </label>
              <label className="control">
                <span>맥락 (브랜치/커밋)</span>
                <input
                  type="text"
                  className="control-text"
                  placeholder="예: feat/v2-overlay @ 61e6fd6"
                  value={recipe.badge.contextLabel}
                  onChange={(e) =>
                    setRecipe((r) =>
                      r ? { ...r, badge: { ...r.badge, contextLabel: e.target.value } } : r
                    )
                  }
                />
              </label>
              <label className="control control-check">
                <input
                  type="checkbox"
                  checked={recipe.keystrokes.overlayVisible}
                  onChange={(e) =>
                    setRecipe((r) =>
                      r
                        ? { ...r, keystrokes: { ...r.keystrokes, overlayVisible: e.target.checked } }
                        : r
                    )
                  }
                />
                <span>키 입력 오버레이</span>
              </label>
            </fieldset>

            {/* ④ 익스포트 */}
            <fieldset className="side-section">
              <legend className="side-section-title">익스포트</legend>
              <ExportPanel status={exportStatus} onExport={handleExport} />
            </fieldset>

            {/* 메타 정보 (사이드바 하단) */}
            <dl className="meta">
              <div>
                <dt>자동 줌</dt>
                <dd>{recipe.zoomSegments.length}개 구간 (클릭에서 자동 생성)</dd>
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
          </aside>
        )}

        <button
          className="sidebar-toggle"
          onClick={() => setSidebarOpen((v) => !v)}
          title={sidebarOpen ? '사이드바 접기' : '사이드바 펼치기'}
          aria-label={sidebarOpen ? '사이드바 접기' : '사이드바 펼치기'}
        >
          {sidebarOpen ? '›' : '‹'}
        </button>
      </div>
    </section>
  )
}
