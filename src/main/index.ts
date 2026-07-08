import {
  app,
  shell,
  clipboard,
  BrowserWindow,
  ipcMain,
  protocol,
  net,
  systemPreferences,
  desktopCapturer,
  nativeImage,
  globalShortcut,
  Notification
} from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeFile } from 'node:fs/promises'
import { is } from '@electron-toolkit/utils'
import { Recorder } from './recorder'
import { AppTray } from './tray'
import { listRecordings, loadRecording, saveRecipe } from './storage'
import {
  IpcChannel,
  type CaptureTarget,
  type RecordingState,
  type RecordingSummary,
  type ExportSaveResult
} from '../shared/ipc'
import type { RenderRecipe } from '../shared/recipe'
import type { ExportFormat } from '../shared/export-preset'

/** 원본 영상 파일을 렌더러 미리보기에 안전하게 공급하는 커스텀 스킴. */
const MEDIA_SCHEME = 'recap-media'

protocol.registerSchemesAsPrivileged([
  {
    scheme: MEDIA_SCHEME,
    privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true }
  }
])

let mainWindow: BrowserWindow | null = null
let appTray: AppTray | null = null
/** 앱 종료 절차 진입 여부. 창 닫기(X)를 '숨김'으로 바꾸되, 실제 종료 시엔 통과시킨다. */
let isQuitting = false
/** 최신 녹화 상태 — 트레이/단축키 토글이 idle↔recording 을 판단하는 근거. */
let currentState: RecordingState = { status: 'idle' }
/** 마지막으로 녹화한 캡처 대상 id — ⌥⌘R/트레이의 '기본 대상'으로 재사용한다. */
let lastTargetId: string | null = null

/** 목록·녹화 등 기본 화면의 창 크기. */
const DEFAULT_WINDOW_SIZE = { width: 1180, height: 760 }
/** 편집기(미리보기 + 사이드바 + 타임라인) 진입 시 넓히는 창 크기(#35). */
const EDITOR_WINDOW_SIZE = { width: 1200, height: 760 }

function sidecarPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'recap-capture')
    : join(app.getAppPath(), 'src/sidecar/.build/recap-capture')
}

/**
 * 브랜드 에셋 경로를 해석한다. `scripts/build-icons.sh` 산출물이며,
 * 사이드카와 같은 규칙으로 해석한다 — 패키징 전에는 저장소 루트에서 읽는다.
 */
function brandAssetPath(file: string): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'assets/brand', file)
    : join(app.getAppPath(), 'assets/brand', file)
}

function brandIconPath(): string {
  return brandAssetPath('icon.png')
}

/** 절대 경로를 미리보기용 recap-media URL로 만든다. */
function mediaUrl(filePath: string): string {
  return `${MEDIA_SCHEME}://file/${encodeURIComponent(filePath)}`
}

const recorder = new Recorder(sidecarPath())

/**
 * 상태 변화의 단일 진입점. 렌더러·트레이·창 표시 정책을 한곳에서 동기화한다.
 * (녹화 콜백·다시 열기·오류 모두 이 함수를 거친다.)
 */
function applyState(state: RecordingState): void {
  currentState = state
  if (state.status === 'recording') lastTargetId = state.target.id
  mainWindow?.webContents.send(IpcChannel.State, state)
  appTray?.update(state)
  syncWindowForState(state)
}

/**
 * 상태에 맞춰 창 표시를 조정한다. 녹화 중에는 창을 숨겨 캡처 대상을 가리지 않고
 * (트레이가 상태를 표시), 정지 → 미리보기/오류 진입 시 편집기 창을 자동으로 띄운다.
 * idle 은 사용자가 숨긴 상태를 존중해 건드리지 않는다(트레이로 재호출 가능).
 */
function syncWindowForState(state: RecordingState): void {
  switch (state.status) {
    case 'recording':
      mainWindow?.hide()
      break
    case 'preview':
    case 'error':
      showLauncher()
      break
  }
}

/** 런처/편집기 창을 표시·포커스한다. 메뉴바 상주 모드에서 창이 뜨는 동안 Dock 도 보인다. */
function showLauncher(): void {
  if (!mainWindow) return
  if (process.platform === 'darwin' && app.dock) void app.dock.show()
  mainWindow.show()
  mainWindow.focus()
}

/**
 * 저장된 녹화를 다시 열어 미리보기 상태로 복원한다. 저장된 레시피가 있으면 그대로,
 * 없으면 렌더러가 이벤트 트랙에서 다시 유도한다. IPC(최근 목록 클릭)·트레이가 공유한다.
 */
async function openRecordingToPreview(folder: string): Promise<void> {
  const loaded = await loadRecording(folder)
  applyState({
    status: 'preview',
    videoUrl: mediaUrl(loaded.videoPath),
    folder: loaded.folder,
    durationMs: loaded.durationMs,
    eventCount: loaded.eventCount,
    eventTrack: loaded.eventTrack,
    target: loaded.target,
    ...(loaded.recipe ? { recipe: loaded.recipe } : {})
  })
}

const PERMISSION_MESSAGE =
  '화면 녹화 권한이 필요합니다. 시스템 설정 > 개인정보 보호 및 보안 > 화면 기록에서 ' +
  '이 앱(개발 중에는 "Electron")을 허용한 뒤 앱을 다시 시작하세요.'

/**
 * 화면 녹화 권한을 보장한다. 사이드카는 Electron의 자식 프로세스라 TCC 책임
 * 프로세스가 Electron이며, Electron이 권한을 받아야 사이드카가 캡처할 수 있다.
 * 권한이 없으면 사이드카의 SCShareableContent 호출이 프롬프트를 기다리며 무한
 * 대기해 조용히 멈춘다 — 그래서 사이드카를 띄우기 전에 여기서 먼저 막는다.
 */
async function ensureScreenAccess(): Promise<boolean> {
  if (process.platform !== 'darwin') return true
  if (systemPreferences.getMediaAccessStatus('screen') === 'granted') return true
  // OS가 이 앱을 '화면 기록' 목록에 등록하고 프롬프트를 띄우도록 유도한다(최선의 시도).
  try {
    await desktopCapturer.getSources({ types: ['screen'] })
  } catch {
    // 프롬프트 유도가 목적이라 결과는 쓰지 않는다.
  }
  return systemPreferences.getMediaAccessStatus('screen') === 'granted'
}

/**
 * 지정 대상의 녹화를 시작한다. IPC(렌더러 버튼) · 트레이 · 전역 단축키가 공유한다.
 * 상태 전파는 모두 applyState 를 거쳐 렌더러·트레이·창 표시를 함께 동기화한다.
 */
async function startRecording(targetId: string): Promise<void> {
  if (recorder.isRecording) return

  if (!(await ensureScreenAccess())) {
    // 조용히 멈추지 않고 안내한다 — 화면 기록 설정 창을 열어준다.
    shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
    )
    applyState({ status: 'error', code: 'permission-denied', message: PERMISSION_MESSAGE })
    return
  }

  // 이벤트마다 상태를 밀면 마우스 이동에서 폭주하므로 카운트 갱신은 스로틀한다.
  let lastPush = 0
  let startedAt = 0
  let target: CaptureTarget

  await recorder.start(targetId, {
    onReady: (info) => {
      startedAt = info.startedAt
      target = info.target
      applyState({ status: 'recording', startedAt, eventCount: 0, target })
    },
    onEvent: (count) => {
      const now = Date.now()
      if (now - lastPush < 400) return
      lastPush = now
      applyState({ status: 'recording', startedAt, eventCount: count, target })
    },
    onError: (code, message) => {
      applyState({ status: 'error', code, message })
    },
    onComplete: (result) => {
      applyState({
        status: 'preview',
        videoUrl: mediaUrl(result.videoPath),
        folder: result.folder,
        durationMs: result.durationMs,
        eventCount: result.eventCount,
        target: result.target,
        eventTrack: result.eventTrack
      })
    }
  })
}

/** ⌥⌘R · 트레이 토글. 녹화 중이면 정지, 아니면 마지막/기본 대상으로 시작한다. */
async function toggleRecord(): Promise<void> {
  if (recorder.isRecording) {
    recorder.stop()
    return
  }
  let targetId = lastTargetId
  if (!targetId) {
    // 처음 실행 등 마지막 대상이 없으면 사용 가능한 첫 대상을 기본으로 잡는다.
    try {
      if (!(await ensureScreenAccess())) throw new Error(PERMISSION_MESSAGE)
      const targets = await recorder.listTargets()
      targetId = targets[0]?.id ?? null
    } catch {
      // 목록 실패(권한 등)면 런처를 열어 사용자가 직접 고르게 한다.
    }
  }
  if (targetId) void startRecording(targetId)
  else showLauncher()
}

/**
 * 파일을 macOS 클립보드에 '파일 참조'로 복사한다. 텍스트가 아니라 파일로 붙으므로
 * Finder 에 ⌘V 로 파일이 생기고, GitHub 코멘트 등 웹 입력창에는 첨부 업로드가 트리거된다.
 * NSFilenamesPboardType(legacy)는 파일 경로 배열 plist 를 기대한다 — 가장 널리 동작하는 방식.
 */
function copyFileReferenceToClipboard(path: string): void {
  if (process.platform !== 'darwin') {
    clipboard.writeText(path)
    return
  }
  const plist =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
    `<plist version="1.0"><array><string>${path}</string></array></plist>`
  clipboard.writeBuffer('NSFilenamesPboardType', Buffer.from(plist, 'utf8'))
}

/** 익스포트 완료를 시스템 알림으로 알린다. 클릭하면 Finder 에서 파일을 보여준다. */
function notifyExportDone(path: string, format: ExportFormat): void {
  if (!Notification.isSupported()) return
  const notification = new Notification({
    title: '익스포트 완료',
    body: `${format.toUpperCase()} 파일이 클립보드에 복사됐어요 — PR/티켓에 ⌘V 로 붙여넣으세요.`
  })
  notification.on('click', () => shell.showItemInFolder(path))
  notification.show()
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: DEFAULT_WINDOW_SIZE.width,
    height: DEFAULT_WINDOW_SIZE.height,
    minWidth: 720,
    minHeight: 560,
    show: false,
    title: 'Recap',
    icon: brandIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // 창 닫기(X)는 앱 종료가 아니라 숨김 — 앱은 메뉴바에 상주한다. 종료는 트레이의 '종료'로만.
  mainWindow.on('close', (e) => {
    if (isQuitting) return
    e.preventDefault()
    mainWindow?.hide()
  })
  // 창이 숨으면 Dock 아이콘도 감춰 메뉴바 전용 상태로, 다시 뜨면 보이게 한다.
  mainWindow.on('hide', () => {
    if (process.platform === 'darwin' && app.dock) void app.dock.hide()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  ipcMain.handle(IpcChannel.ListTargets, async () => {
    if (!(await ensureScreenAccess())) throw new Error(PERMISSION_MESSAGE)
    return recorder.listTargets()
  })

  ipcMain.handle(IpcChannel.Start, (_e, targetId: string) => startRecording(targetId))

  ipcMain.handle(IpcChannel.Stop, () => {
    recorder.stop()
  })

  // 렌더러가 유도·편집한 레시피를 녹화 폴더에 저장한다 (편집 상태 영속화).
  ipcMain.handle(
    IpcChannel.SaveRecipe,
    (_e, folder: string, recipe: RenderRecipe) => saveRecipe(folder, recipe)
  )

  ipcMain.handle(
    IpcChannel.ListRecordings,
    (): Promise<RecordingSummary[]> => listRecordings()
  )

  ipcMain.handle(IpcChannel.OpenRecording, (_e, folder: string) => openRecordingToPreview(folder))

  // 렌더러가 인코딩한 익스포트 바이트를 녹화 폴더에 저장한다(export.mp4 / export.gif).
  ipcMain.handle(
    IpcChannel.ExportSave,
    async (
      _e,
      bytes: ArrayBuffer,
      folder: string,
      format: ExportFormat
    ): Promise<ExportSaveResult> => {
      const path = join(folder, `export.${format}`)
      const buffer = Buffer.from(bytes)
      await writeFile(path, buffer)
      // 익스포트 완료 = 진입 플로우의 종착점. 파일을 클립보드에 참조로 복사해
      // PR/티켓 코멘트에 곧바로 ⌘V 첨부할 수 있게 하고, 시스템 알림으로 알린다(#37).
      copyFileReferenceToClipboard(path)
      notifyExportDone(path, format)
      return { path, sizeBytes: buffer.byteLength }
    }
  )

  ipcMain.handle(IpcChannel.ExportReveal, (_e, path: string) => {
    shell.showItemInFolder(path)
  })

  ipcMain.handle(IpcChannel.ExportCopyPath, (_e, path: string) => {
    clipboard.writeText(path)
  })

  // 편집기 진입 시 창을 넓히고 이탈 시 원래 크기로 되돌린다. 최대화 상태면 건드리지 않는다.
  ipcMain.handle(IpcChannel.SetEditorMode, (_e, on: boolean) => {
    if (!mainWindow || mainWindow.isMaximized() || mainWindow.isFullScreen()) return
    const size = on ? EDITOR_WINDOW_SIZE : DEFAULT_WINDOW_SIZE
    mainWindow.setSize(size.width, size.height, true)
  })
}

// dev 모드에서도 메뉴바·Dock·창 타이틀이 제품명으로 뜨도록 앱 이름을 고정한다
// (패키징 전에는 package.json name이 소문자 "recap"으로 잡히기 때문).
app.setName('Recap')

app.whenReady().then(() => {
  // dev 실행에서도 Dock 에 브랜드 아이콘이 뜨도록 지정한다(패키징 전 기본 Electron 아이콘 대체).
  if (process.platform === 'darwin' && app.dock) {
    const icon = nativeImage.createFromPath(brandIconPath())
    if (!icon.isEmpty()) app.dock.setIcon(icon)
  }

  protocol.handle(MEDIA_SCHEME, async (request) => {
    const url = new URL(request.url)
    const filePath = decodeURIComponent(url.pathname.replace(/^\//, ''))
    // 원본 요청(메서드·Range 헤더)을 그대로 파일 URL로 넘겨 시크(range)를 지원한다.
    const res = await net.fetch(pathToFileURL(filePath).toString(), {
      method: request.method,
      headers: request.headers
    })
    // 커스텀 스킴은 렌더러와 교차 출처라, 익스포트 시 캔버스가 오염되지 않도록 CORS를 연다.
    const headers = new Headers(res.headers)
    headers.set('Access-Control-Allow-Origin', '*')
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
  })

  registerIpc()
  createWindow()
  setupTray()
  registerGlobalShortcut()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else showLauncher()
  })
})

/** 메뉴바 트레이를 세운다. 진입점·녹화 상태 표시·정지·종료를 담당한다. */
function setupTray(): void {
  appTray = new AppTray(brandAssetPath('tray-idle.png'), brandAssetPath('tray-recording.png'), {
    onToggleRecord: () => void toggleRecord(),
    onShowLauncher: () => showLauncher(),
    onOpenRecording: (folder) => {
      showLauncher()
      void openRecordingToPreview(folder).catch((err) =>
        console.error('[tray] 녹화 열기 실패', err)
      )
    },
    listRecentRecordings: () => listRecordings(),
    onQuit: () => {
      isQuitting = true
      app.quit()
    }
  })
  appTray.update(currentState)
}

/**
 * 전역 단축키 ⌥⌘R 을 녹화 시작/정지 토글로 등록한다. 등록 실패(다른 앱이 선점 등)는
 * 치명적이지 않으므로 경고만 남긴다 — 트레이/창 진입은 그대로 동작한다.
 */
function registerGlobalShortcut(): void {
  const ok = globalShortcut.register('Alt+Command+R', () => void toggleRecord())
  if (!ok) console.warn('[shortcut] ⌥⌘R 등록에 실패했습니다 (다른 앱이 선점했을 수 있음)')
}

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  // 메뉴바 상주 앱이라 창이 모두 닫혀도(숨겨도) 종료하지 않는다. macOS 외에는 종료.
  if (process.platform !== 'darwin') app.quit()
})
