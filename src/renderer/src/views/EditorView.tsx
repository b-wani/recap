import { useEffect, useRef, useState } from 'react'
import type { EditorContext } from '../../../shared/ipc'
import {
  deriveRecipe,
  sampleComposition,
  type FrameSize,
  type RenderRecipe
} from '../../../shared/recipe'
import { deleteZoomSegment, trimmedDurationMs } from '../../../shared/recipe.edit'
import { applyStylePreset, type StylePreset } from '../../../shared/style-preset'
import { drawComposition } from '../compose'
import {
  DEFAULT_SELECTION,
  defaultHeightForSource,
  reconcileSelectionForFormat,
  resolveGifConfig,
  resolveMp4Config,
  estimateSizeBytes,
  estimateExportSeconds,
  exceedsSizeLimit,
  extensionForFormat,
  type ExportFormat,
  type ExportSelection
} from '../../../shared/export-preset'
import { renderRecipeToGif, renderRecipeToMp4, type ExportSignal } from '../export'
import { formatElapsed } from '../format'
import { Timeline } from '../components/Timeline'
import { Sidebar } from '../components/Sidebar'
import {
  ExportPanel,
  ExportProgressOverlay,
  type ExportStatus,
  type ExportIntent
} from '../components/ExportPanel'

/**
 * 합성된 캔버스의 현재 프레임을 작은 JPEG로 줄여 녹화 폴더에 썸네일 캐시로 저장한다.
 * idle 런처의 최근 녹화 목록이 이 캐시를 읽어 첫 프레임 미리보기를 그린다.
 */
async function saveThumbnailFromCanvas(canvas: HTMLCanvasElement, folder: string): Promise<void> {
  const maxWidth = 320
  const scale = Math.min(1, maxWidth / canvas.width)
  const w = Math.max(1, Math.round(canvas.width * scale))
  const h = Math.max(1, Math.round(canvas.height * scale))
  const off = document.createElement('canvas')
  off.width = w
  off.height = h
  const ctx = off.getContext('2d')
  if (!ctx) return
  ctx.drawImage(canvas, 0, 0, w, h)
  const blob = await new Promise<Blob | null>((resolve) =>
    off.toBlob(resolve, 'image/jpeg', 0.7)
  )
  if (!blob) return
  await window.recap.saveThumbnail(folder, await blob.arrayBuffer())
}

/**
 * 에디터 창의 렌더러 엔트리(role 'editor', #75). 독립 문서창 하나가 녹화 하나를 편집한다 —
 * 자기 컨텍스트(연 녹화물 + recipe 편집분)를 창 로컬로 소유하며, 전역 캡처 상태는 구독하지
 * 않는다. `context`는 main이 `window:get-context`로 돌려준 페이로드(App.tsx가 pull).
 */
export function EditorView({ context: state }: { context: EditorContext }): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const recipeRef = useRef<RenderRecipe | null>(null)
  const [recipe, setRecipe] = useState<RenderRecipe | null>(null)
  // 선택 상태는 이 하나로 소유한다(줌 구간 인덱스 문자열, 없으면 null). 빈 곳 클릭·Esc로 해제.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [exportStatus, setExportStatus] = useState<ExportStatus>({ phase: 'idle' })
  // 익스포트 선택(해상도·fps·품질 티어, #159). 창 열린 동안 유지되고 새 에디터 창이면 기본값으로
  // 리셋된다(창 하나가 클립 하나 — 컴포넌트 재마운트가 곧 리셋). 원본이 작으면 메타데이터 로드 시 폴백.
  const [selection, setSelection] = useState<ExportSelection>(DEFAULT_SELECTION)
  // 익스포트 출력 포맷(#155). 기본 GIF(recap 차별화 축), MP4는 원화질 출력. 창 재마운트가 곧 리셋.
  const [format, setFormat] = useState<ExportFormat>('gif')
  // 진행 중 익스포트의 취소 토큰 — 전체화면 진행 화면의 Stop export가 aborted를 세운다.
  const exportSignalRef = useRef<ExportSignal | null>(null)
  const [playing, setPlaying] = useState(true)
  const [currentMs, setCurrentMs] = useState(0)
  // 상단 바 익스포트 버튼 아래 팝오버 열림 상태(D3: 익스포트 동선을 상단 바 primary로).
  const [exportOpen, setExportOpen] = useState(false)
  const exportBoxRef = useRef<HTMLDivElement>(null)
  // 앱 전역 스타일 프리셋 목록(#77) — 배경/커서 스타일 번들. 줌/트림 등 녹화별 편집과 무관.
  const [presets, setPresets] = useState<StylePreset[]>([])

  // 창 부팅 시 저장된 스타일 프리셋 목록을 한 번 불러온다.
  useEffect(() => {
    void window.recap.listPresets().then(setPresets)
  }, [])

  // 팝오버 밖 클릭 시 닫는다(인코딩 중에는 진행 상황을 계속 보여주도록 열어 둔다).
  useEffect(() => {
    if (!exportOpen) return
    const onDown = (e: PointerEvent): void => {
      if (exportBoxRef.current && !exportBoxRef.current.contains(e.target as Node)) {
        setExportOpen(false)
      }
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [exportOpen])

  // Esc로 선택을 해제해 사이드바를 기본 패널로 되돌린다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setSelectedId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 프레임 스텝(1/60s) — 재생 컨트롤의 ◀|/|▶ 버튼과 ←/→ 단축키가 공유한다.
  const stepFrame = (dir: -1 | 1): void => {
    const video = videoRef.current
    const recipe = recipeRef.current
    if (!video || !recipe) return
    const frameMs = 1000 / 60
    const nextMs = Math.min(
      recipe.trim.endMs,
      Math.max(recipe.trim.startMs, video.currentTime * 1000 + dir * frameMs)
    )
    video.pause()
    video.currentTime = nextMs / 1000
    setCurrentMs(nextMs)
  }

  // 재생 단축키(편집기 마운트 동안만): Space 재생/정지, ←/→ 프레임(1/60s) 이동.
  // 입력 필드·색상 피커 포커스 중에는 타이핑/조작과 충돌하지 않도록 무시한다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const el = document.activeElement
      if (
        el instanceof HTMLElement &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'SELECT' ||
          el.tagName === 'TEXTAREA' ||
          el.isContentEditable)
      ) {
        return
      }
      const video = videoRef.current
      if (!video || !recipeRef.current) return
      if (e.key === ' ') {
        e.preventDefault()
        if (video.paused) void video.play()
        else video.pause()
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        stepFrame(e.key === 'ArrowRight' ? 1 : -1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // RAF 루프·익스포트는 최신 레시피를 ref로 읽는다 — 편집(타임라인·배경/배지·커서)이 다음 프레임에 즉시 반영된다.
  // 편집 상태는 그대로 녹화 폴더에 저장해 다시 열었을 때 복원되게 한다(이슈 #9 영속화). 저장은 창 로컬로 동작한다.
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
    // 기본 해상도는 포맷 기본값이지만 원본을 넘기지 않는다 — 원본이 작으면 가능한 최대 옵션으로 폴백.
    setSelection((s) => ({ ...s, height: defaultHeightForSource(format, next.source.height) }))
  }

  // 재생 루프: 트림 창 안에서만 반복 재생하고, 매 프레임 합성 파라미터를 샘플링해 그대로 그린다.
  const lastTickRef = useRef(0)
  // 썸네일은 미리보기 진입 후 첫 유효 프레임에서 한 번만 캡처한다.
  const thumbSavedRef = useRef(false)
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
      // 첫 유효 프레임이 그려지면 썸네일을 한 번 캡처해 폴더에 캐시한다(최근 목록용).
      if (!thumbSavedRef.current && video.readyState >= 2 && video.videoWidth > 0) {
        thumbSavedRef.current = true
        void saveThumbnailFromCanvas(canvas, state.folder)
      }
      // 재생 헤드 표시는 ~12fps로만 갱신해 리렌더를 억제한다.
      const now = performance.now()
      if (now - lastTickRef.current > 80) {
        lastTickRef.current = now
        setCurrentMs(video.currentTime * 1000)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [state.folder])

  // 포맷 토글: 선택을 새 포맷의 허용 범위로 재조정한다(예: MP4 60fps→GIF 50fps, 4K→1080p).
  // 해상도는 원본 상한 안에서 포맷 기본으로 다시 폴백한다(포맷별 옵션이 달라서).
  const onFormatChange = (next: ExportFormat): void => {
    setFormat(next)
    setSelection((s) => {
      const reconciled = reconcileSelectionForFormat(next, s)
      const src = recipeRef.current?.source.height ?? 0
      return { ...reconciled, height: defaultHeightForSource(next, src) }
    })
  }

  // 익스포트: 미리보기와 동일한 레시피로 원본을 선택 포맷(GIF/MP4)으로 인코딩한다.
  // 합성은 공유하고 인코더만 분기한다(#155). intent가 clipboard면 저장 후 실제 미디어를 클립보드로
  // 복사한다(#159). 용량 경고는 Dooray 인라인 대상인 GIF에만 적용한다.
  const handleExport = async (intent: ExportIntent): Promise<void> => {
    const video = videoRef.current
    const recipe = recipeRef.current
    if (!video || !recipe) return
    const signal: ExportSignal = { aborted: false }
    exportSignalRef.current = signal
    setExportStatus({
      phase: 'encoding',
      renderedFrames: 0,
      totalFrames: 0,
      startedAt: Date.now()
    })
    try {
      const startedAt = Date.now()
      const onProgress = (p: { renderedFrames: number; totalFrames: number }): void =>
        setExportStatus({ phase: 'encoding', ...p, startedAt })
      const bytes =
        format === 'mp4'
          ? await renderRecipeToMp4(video, recipe, selection, onProgress, signal)
          : await renderRecipeToGif(video, recipe, selection, onProgress, signal)
      const { path, sizeBytes } = await window.recap.saveExport(bytes, state.folder, format)
      if (intent === 'clipboard') await window.recap.copyExportMedia(path)
      setExportStatus({
        phase: 'done',
        path,
        sizeBytes,
        exceedsLimit: format === 'gif' && exceedsSizeLimit(sizeBytes),
        copied: intent === 'clipboard'
      })
    } catch (err) {
      // Stop export로 취소하면 조용히 idle로 되돌린다(에러 아님).
      if (err instanceof Error && err.name === 'AbortError') setExportStatus({ phase: 'idle' })
      else
        setExportStatus({ phase: 'error', message: err instanceof Error ? err.message : String(err) })
    } finally {
      exportSignalRef.current = null
    }
  }

  // 전체화면 진행 화면의 Stop export — 취소 토큰을 세우면 인코딩 루프가 AbortError로 빠져나온다.
  const onStopExport = (): void => {
    if (exportSignalRef.current) exportSignalRef.current.aborted = true
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

  // 현재 스타일(배경/커서)을 이름 붙여 앱 전역 프리셋으로 저장한다(#77).
  const onSavePreset = async (name: string): Promise<void> => {
    if (!recipe) return
    const saved = await window.recap.savePreset(name, recipe)
    setPresets((prev) => [...prev, saved])
  }
  // 저장된 프리셋의 스타일을 현재 레시피에 반영한다(줌/트림 등은 불변, 순수 함수 적용).
  const onApplyPreset = (preset: StylePreset): void => {
    update((r) => applyStylePreset(r, preset))
  }
  const onDeletePreset = async (id: string): Promise<void> => {
    await window.recap.deletePreset(id)
    setPresets((prev) => prev.filter((p) => p.id !== id))
  }

  // 트림 반영 길이 (메타 바·재생 컨트롤에서 공유).
  const lengthMs = recipe ? trimmedDurationMs(recipe) : state.durationMs

  // 사전 추정치(예상 시간·최대 용량) — 선택·포맷·트림 길이로 매번 다시 계산한다(순수, #159 AC7).
  const estimate = ((): { sizeBytes: number; seconds: number; exceedsLimit: boolean } => {
    if (!recipe) return { sizeBytes: 0, seconds: 0, exceedsLimit: false }
    const config =
      format === 'mp4'
        ? resolveMp4Config(recipe.source, selection)
        : resolveGifConfig(recipe.source, selection)
    const sizeBytes = estimateSizeBytes(format, config, lengthMs, selection.tier)
    return {
      sizeBytes,
      seconds: estimateExportSeconds(format, config, lengthMs),
      exceedsLimit: format === 'gif' && exceedsSizeLimit(sizeBytes)
    }
  })()

  // 전체화면 진행 화면용 소스→목적 라벨(SS 알약 모작).
  const sourceLabel = state.target.title
  const destLabel = `export.${extensionForFormat(format)}`

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

      {/* 상단 바 — 좌측 녹화 정체성(대상·길이), 우측 재녹화 + 익스포트(primary) */}
      <header className="editor-bar">
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
        <div className="export-anchor" ref={exportBoxRef}>
          <button
            className="btn btn-export-primary"
            onClick={() => setExportOpen((v) => !v)}
            aria-expanded={exportOpen}
          >
            익스포트 ▸
          </button>
          {exportOpen && (
            <div className="export-popover">
              <ExportPanel
                status={exportStatus}
                format={format}
                onFormatChange={onFormatChange}
                selection={selection}
                onSelectionChange={setSelection}
                sourceHeight={recipe?.source.height ?? 0}
                estimate={estimate}
                onExport={handleExport}
                onClose={() => setExportOpen(false)}
              />
            </div>
          )}
        </div>
      </header>

      {exportStatus.phase === 'encoding' && (
        <ExportProgressOverlay
          format={format}
          renderedFrames={exportStatus.renderedFrames}
          totalFrames={exportStatus.totalFrames}
          startedAt={exportStatus.startedAt}
          sourceLabel={sourceLabel}
          destLabel={destLabel}
          onStop={onStopExport}
        />
      )}

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
            eventCount={state.eventCount}
            folder={state.folder}
            presets={presets}
            onSavePreset={onSavePreset}
            onApplyPreset={onApplyPreset}
            onDeletePreset={onDeletePreset}
          />
        )}

        {recipe && (
          <div className="editor-timeline">
            <div className="playback">
              <button
                className="btn btn-sm playback-step"
                onClick={() => stepFrame(-1)}
                aria-label="이전 프레임"
              >
                ◀|
              </button>
              <button
                className="btn btn-sm playback-toggle"
                onClick={togglePlay}
                aria-label={playing ? '일시정지' : '재생'}
              >
                {playing ? '⏸' : '▶'}
              </button>
              <button
                className="btn btn-sm playback-step"
                onClick={() => stepFrame(1)}
                aria-label="다음 프레임"
              >
                |▶
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
