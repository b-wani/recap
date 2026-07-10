import {
  app,
  shell,
  clipboard,
  BrowserWindow,
  ipcMain,
  protocol,
  net,
  screen,
  systemPreferences,
  desktopCapturer,
  nativeImage,
  globalShortcut,
  Notification,
  dialog
} from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeFile } from 'node:fs/promises'
import { is } from '@electron-toolkit/utils'
import { Recorder, type RecordingResult } from './recorder'
import { AppTray } from './tray'
import { WindowRegistry, type WindowEntry } from './window-registry'
import { matchDisplayTargets } from './display-overlay'
import { isSubscribedRole } from './capture-broadcast'
import {
  listRecordings,
  loadRecording,
  saveRecipe,
  saveThumbnail,
  isOnboardingComplete,
  saveOnboardingComplete
} from './storage'
import {
  IpcChannel,
  type CaptureTarget,
  type CaptureMode,
  type RecordingState,
  type RecordingSummary,
  type ExportSaveResult,
  type EditorContext,
  type OverlayContext,
  type WindowPickerOverlayContext,
  type AreaOverlayContext,
  type DisplayOverlayContext,
  type Rect
} from '../shared/ipc'
import { buildWindowHash, type WindowRole } from '../shared/window-url'
import type { RenderRecipe } from '../shared/recipe'
import type { ExportFormat } from '../shared/export-preset'
import type { PermissionKind, PermissionStatus } from '../shared/onboarding'
import { overlayRectToSourceRect } from '../shared/area-rect'

/** 원본 영상 파일을 렌더러 미리보기에 안전하게 공급하는 커스텀 스킴. */
const MEDIA_SCHEME = 'recap-media'

protocol.registerSchemesAsPrivileged([
  {
    scheme: MEDIA_SCHEME,
    privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true }
  }
])

/**
 * 열린 창들의 단일 대장. 구 단일 `mainWindow` 전역을 대체한다(#64/#69). main 은
 * 이 레지스트리로 role 별 창을 지목해 메시지를 보내거나 컨텍스트를 돌려준다. 지금은
 * `shell`(온보딩·idle·녹화·미리보기를 한 창에서 스왑하는 전환기 통합 창) 하나만 상주하며,
 * editor(#75)·library(#78)·welcome(#80)·toolbar/overlay(#70~) 티켓이 role 을 채워 나간다.
 */
const registry = new WindowRegistry<BrowserWindow>()

/** 현재 상주 shell 창(구 `mainWindow` 대체). 없으면 null. */
function shellWindow(): BrowserWindow | null {
  return registry.firstByRole('shell')?.window ?? null
}

let appTray: AppTray | null = null
/** 앱 종료 절차 진입 여부. 창 닫기(X)를 '숨김'으로 바꾸되, 실제 종료 시엔 통과시킨다. */
let isQuitting = false
/** 최신 녹화 상태 — 트레이/단축키 토글이 idle↔recording 을 판단하는 근거. */
let currentState: RecordingState = { status: 'idle' }
/**
 * 3-2-1 카운트다운 토글의 현재 값. 툴바 설정 팝오버가 바꾸고, Display 선택 오버레이(#71)
 * 생성 시 이 스냅샷을 창 컨텍스트로 실어 보낸다(오버레이가 다른 창이라 로컬 state 공유 불가).
 */
let countdownEnabled = true
/**
 * 캡처 툴바가 마지막으로 보고한 모드. Display 오버레이 생성은 사이드카 대상 목록 조회를
 * 기다리는 비동기 경로라, 응답이 오는 사이 사용자가 다른 모드로 옮겼을 수 있어
 * `createDisplayOverlays` 가 완료 시 이 값으로 여전히 display 인지 재확인한다.
 */
let armingMode: CaptureMode = 'display'

/** 목록·녹화 등 기본 화면의 창 크기. */
const DEFAULT_WINDOW_SIZE = { width: 1180, height: 760 }
/** 에디터(미리보기 + 사이드바 + 타임라인) 창의 초기 크기(#35, 독립 창 추출은 #75). */
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
  // 레지스트리 기반 구독 role 타깃 전송(#74) — 캡처 상태 구독 role(shell·툴바·오버레이·
  // REC 알약)에만 보낸다. 에디터/라이브러리/Welcome 은 캡처 상태와 무관해 받지 않는다.
  for (const entry of registry.all()) {
    if (isSubscribedRole(entry.role)) entry.window.webContents.send(IpcChannel.State, state)
  }
  appTray?.update(state)
  syncWindowForState(state)
}

/**
 * 상태에 맞춰 창 표시를 조정한다. 녹화 중에는 창을 숨겨 캡처 대상을 가리지 않고
 * (트레이가 상태를 표시), 오류 진입 시 shell 창을 자동으로 띄운다. idle 은 사용자가
 * 숨긴 상태를 존중해 건드리지 않는다(트레이로 재호출 가능). 정지 시 에디터 창 자동
 * 생성은 `createEditorWindow`가 별도로 맡는다(전역 상태와 무관한 창이라 여기서 다루지 않는다).
 */
function syncWindowForState(state: RecordingState): void {
  switch (state.status) {
    case 'recording':
      shellWindow()?.hide()
      showRecPill()
      break
    case 'error':
      destroyRecPill()
      showLauncher()
      break
    default:
      destroyRecPill()
  }
}

/** 런처/편집기 창을 표시·포커스한다. 메뉴바 상주 모드에서 창이 뜨는 동안 Dock 도 보인다. */
function showLauncher(): void {
  const win = shellWindow()
  if (!win) return
  if (process.platform === 'darwin' && app.dock) void app.dock.show()
  win.show()
  win.focus()
}

/** 방금 끝난 녹화 결과를 에디터 컨텍스트로 옮긴다(레시피는 아직 없음 — 렌더러가 유도). */
function editorContextFromResult(result: RecordingResult): EditorContext {
  return {
    videoUrl: mediaUrl(result.videoPath),
    folder: result.folder,
    durationMs: result.durationMs,
    eventCount: result.eventCount,
    target: result.target,
    eventTrack: result.eventTrack
  }
}

/** 저장된 녹화 폴더를 에디터 컨텍스트로 로드한다. 저장된 레시피가 있으면 함께 싣는다. */
async function editorContextFromFolder(folder: string): Promise<EditorContext> {
  const loaded = await loadRecording(folder)
  return {
    videoUrl: mediaUrl(loaded.videoPath),
    folder: loaded.folder,
    durationMs: loaded.durationMs,
    eventCount: loaded.eventCount,
    eventTrack: loaded.eventTrack,
    target: loaded.target,
    ...(loaded.recipe ? { recipe: loaded.recipe } : {})
  }
}

/**
 * 독립 에디터 창을 만든다(#75). 다중 인스턴스 — 닫으면 destroy, 여러 녹화를 동시에
 * 여러 창으로 열 수 있다. 캡처 상태를 구독하지 않으며, 자기 컨텍스트만 창 로컬로 소유한다.
 */
function createEditorWindow(context: EditorContext): WindowEntry<BrowserWindow> {
  const entry = createRoleWindow(
    'editor',
    {
      width: EDITOR_WINDOW_SIZE.width,
      height: EDITOR_WINDOW_SIZE.height,
      minWidth: 720,
      minHeight: 560,
      show: false,
      title: 'Recap 편집기',
      icon: brandIconPath()
    },
    context
  )
  entry.window.once('ready-to-show', () => {
    entry.window.show()
    entry.window.focus()
  })
  return entry
}

/** 저장된 녹화 폴더를 에디터 창으로 연다. IPC(`editor:open`)·트레이 '최근 녹화'가 공유한다. */
async function openEditorForFolder(folder: string): Promise<void> {
  createEditorWindow(await editorContextFromFolder(folder))
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
 * 온보딩 권한 단계가 폴링으로 읽는 두 권한의 granted 상태. 화면 녹화는
 * getMediaAccessStatus('screen'), 손쉬운 사용은 isTrustedAccessibilityClient(false)로
 * 읽는다(인자 false — 프롬프트를 유발하지 않는다). 비 macOS는 충족으로 간주한다
 * (기존 ensureScreenAccess의 darwin 분기 관례).
 */
function readPermissionStatus(): PermissionStatus {
  if (process.platform !== 'darwin') return { screen: true, accessibility: true }
  return {
    screen: systemPreferences.getMediaAccessStatus('screen') === 'granted',
    accessibility: systemPreferences.isTrustedAccessibilityClient(false)
  }
}

/**
 * 지정한 권한 종류의 시스템 설정 패널을 연다. 화면 녹화는 열기 전에
 * desktopCapturer.getSources()를 1회 호출해 이 앱이 '화면 기록' 목록에 등록되도록
 * 보장한다(결과는 버린다). 비 macOS에서는 할 일이 없다.
 */
async function openPermissionSettings(kind: PermissionKind): Promise<void> {
  if (process.platform !== 'darwin') return
  if (kind === 'screen') {
    try {
      await desktopCapturer.getSources({ types: ['screen'] })
    } catch {
      // 목록 등록이 목적이라 결과는 쓰지 않는다.
    }
    await shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
    )
  } else {
    await shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
    )
  }
}

/**
 * 권한 적용을 위한 재시작 확인 다이얼로그를 띄우고, 수락 시 앱을 재시작한다.
 * macOS는 권한을 켜도 실행 중인 프로세스에 즉시 반영되지 않을 수 있어, 온보딩이
 * 권한 granted 전이를 감지하면 이 다이얼로그로 안내한다(두 권한 동일 정책).
 */
async function confirmRestart(): Promise<void> {
  const options = {
    type: 'question' as const,
    buttons: ['재시작할게요', '아직이요'],
    defaultId: 0,
    cancelId: 1,
    message: '권한을 적용하려면 재시작이 필요해요',
    detail:
      'macOS는 권한을 켜도 실행 중인 앱에는 바로 반영되지 않을 수 있어요. ' +
      '지금 재시작하면 방금 허용한 권한이 적용됩니다.'
  }
  const parent = shellWindow()
  const { response } = parent
    ? await dialog.showMessageBox(parent, options)
    : await dialog.showMessageBox(options)
  if (response === 0) {
    app.relaunch()
    app.exit(0)
  }
}

/**
 * 지정 대상의 녹화를 시작한다. IPC(렌더러 버튼) · 트레이 · 전역 단축키가 공유한다.
 * `sourceRect` 를 주면 Area(영역) crop 녹화(#72) — 사이드카 v4로 그대로 전달된다.
 * 상태 전파는 모두 applyState 를 거쳐 렌더러·트레이·창 표시를 함께 동기화한다.
 */
async function startRecording(targetId: string, sourceRect?: Rect): Promise<void> {
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

  await recorder.start(
    targetId,
    {
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
        // 녹화 정지 → 저장 완료. 전역 캡처 상태는 idle로 복귀하고, 결과물은 새 에디터
        // 창으로 연다(#75) — 편집 상태(recipe)는 에디터 창이 자기 로컬로 소유한다.
        applyState({ status: 'idle' })
        createEditorWindow(editorContextFromResult(result))
      }
    },
    undefined,
    sourceRect
  )
}

/**
 * ⌥⌘R · 트레이 토글. 녹화 중이면 정지, 아니면 캡처 툴바를 소환한다(#70). 예전처럼 즉시
 * 녹화를 시작하지 않고, 대상·모드는 툴바와 자식 오버레이에서 고른다.
 */
function toggleRecord(): void {
  if (recorder.isRecording) {
    recorder.stop()
    return
  }
  summonToolbar()
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

/**
 * 렌더러를 창에 싣는다. 부여받은 `windowId`·`role` 을 URL 해시로 실어 보내면
 * 렌더러가 부팅 시 읽어 자기 정체를 알고, 큰 페이로드는 `window:get-context` 로 당겨온다.
 */
function loadRenderer(win: BrowserWindow, id: number, role: WindowRole): void {
  const hash = buildWindowHash({ id, role })
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#${hash}`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { hash })
  }
}

/**
 * role 별 창 생성의 단일 경로(구 `createWindow` 일반화). 창을 만들고 레지스트리에
 * 등록해 `windowId` 를 부여하며, 초기 컨텍스트를 실어 두고 파괴 시 자동으로 대장에서 지운다.
 * 외부 링크는 기본 브라우저로 넘긴다(공통). shell 의 상주(닫기=숨김) 정책은 호출부에서 얹는다.
 */
function createRoleWindow(
  role: WindowRole,
  options: Electron.BrowserWindowConstructorOptions,
  context: unknown = null
): WindowEntry<BrowserWindow> {
  const win = new BrowserWindow({
    ...options,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      ...options.webPreferences
    }
  })

  const entry = registry.create(role, win, context)

  // 창이 실제로 파괴되면 대장에서 지운다(닫기=숨김인 shell 은 종료 때만 여기 도달).
  win.on('closed', () => registry.remove(entry.id))

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  loadRenderer(win, entry.id, role)
  return entry
}

/** 아직 전용 스펙이 없는 role 의 창 기본값(#70~ 각 티켓이 role 별로 대체한다). */
function defaultWindowOptions(): Electron.BrowserWindowConstructorOptions {
  return {
    width: DEFAULT_WINDOW_SIZE.width,
    height: DEFAULT_WINDOW_SIZE.height,
    show: true,
    title: 'Recap',
    icon: brandIconPath()
  }
}

/**
 * 상주 shell 창을 만든다. 온보딩·idle·녹화·미리보기를 한 창에서 스왑하는 전환기 통합 창으로,
 * 닫기(X)는 종료가 아니라 숨김(메뉴바 상주)이다. 이후 티켓이 이 창의 책임을 role 별로 떼어낸다.
 */
function createShellWindow(): WindowEntry<BrowserWindow> {
  const entry = createRoleWindow(
    'shell',
    {
      width: DEFAULT_WINDOW_SIZE.width,
      height: DEFAULT_WINDOW_SIZE.height,
      minWidth: 720,
      minHeight: 560,
      show: false,
      title: 'Recap',
      icon: brandIconPath()
    },
    { role: 'shell' }
  )
  const win = entry.window

  win.on('ready-to-show', () => win.show())

  // 창 닫기(X)는 앱 종료가 아니라 숨김 — 앱은 메뉴바에 상주한다. 종료는 트레이의 '종료'로만.
  win.on('close', (e) => {
    if (isQuitting) return
    e.preventDefault()
    win.hide()
  })
  // 창이 숨으면 Dock 아이콘도 감춰 메뉴바 전용 상태로, 다시 뜨면 보이게 한다.
  win.on('hide', () => {
    if (process.platform === 'darwin' && app.dock) void app.dock.hide()
  })

  return entry
}

/** 상주 shell 창을 보장한다(없으면 생성). 부팅·activate 진입점이 공유한다. */
function ensureShellWindow(): void {
  if (!shellWindow()) createShellWindow()
}

/** Welcome(온보딩) 창의 고정 크기 — 비리사이즈(#80). */
const WELCOME_WINDOW_SIZE = { width: 820, height: 580 }

/** 현재 열린 Welcome 창(없으면 null). */
function welcomeWindow(): BrowserWindow | null {
  return registry.firstByRole('welcome')?.window ?? null
}

/**
 * Welcome(온보딩) 창을 만든다(#80). 고정 820×580 비리사이즈, 표준 타이틀바.
 * 셸(마스코트 히어로 + 챕터 내비 + 본문 패널)은 렌더러(WelcomeView)가 그리고,
 * 완료 시(onboarding:complete IPC) 이 창을 닫는 건 registerIpc 의 핸들러가 맡는다.
 */
function createWelcomeWindow(): WindowEntry<BrowserWindow> {
  const entry = createRoleWindow(
    'welcome',
    {
      width: WELCOME_WINDOW_SIZE.width,
      height: WELCOME_WINDOW_SIZE.height,
      resizable: false,
      show: false,
      title: 'Recap 시작하기',
      icon: brandIconPath()
    },
    { role: 'welcome' }
  )
  entry.window.on('ready-to-show', () => entry.window.show())
  return entry
}

/**
 * Welcome 창을 소환한다 — 첫 실행 자동 소환과 트레이 'Welcome 다시 보기' 수동 재소환이
 * 공유하는 진입점. 이미 떠 있으면 새로 만들지 않고 포커스한다(중복 창 금지).
 */
function summonWelcome(): void {
  const existing = registry.firstByRole('welcome')
  if (existing) {
    existing.window.show()
    existing.window.focus()
    return
  }
  createWelcomeWindow()
}

/** 라이브러리 창의 기본 크기(#78) — 목록·녹화 등 기본 화면과 동일한 규모로 시작한다. */
const LIBRARY_WINDOW_SIZE = DEFAULT_WINDOW_SIZE

/**
 * 라이브러리 창을 만든다(#78). 싱글톤 — 닫아도(X) destroy 하지 않고 hide 해 빠른
 * 재소환(트레이 '라이브러리 열기'·`window:open`)을 지원한다. 종료 절차 중에는(`isQuitting`)
 * 실제로 닫혀야 하므로 shell 창과 동일한 가드를 둔다. 콘텐츠(그리드)는 렌더러가
 * `recordings:list` IPC로 직접 로드해, 창 컨텍스트 페이로드는 필요 없다.
 */
function createLibraryWindow(): WindowEntry<BrowserWindow> {
  const entry = createRoleWindow('library', {
    width: LIBRARY_WINDOW_SIZE.width,
    height: LIBRARY_WINDOW_SIZE.height,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: '라이브러리',
    icon: brandIconPath()
  })
  const win = entry.window
  win.on('ready-to-show', () => win.show())
  win.on('close', (e) => {
    if (isQuitting) return
    e.preventDefault()
    win.hide()
  })
  return entry
}

/**
 * 라이브러리 창을 소환한다 — 트레이 '라이브러리 열기'와 `window:open`이 공유하는 진입점.
 * 이미 떠 있으면(hide 상태 포함) 새로 만들지 않고 표시·포커스한다.
 */
function summonLibrary(): void {
  const existing = registry.firstByRole('library')
  if (existing) {
    existing.window.show()
    existing.window.focus()
    return
  }
  createLibraryWindow()
}

/** 캡처 툴바 창의 크기(플로팅 pill). 렌더러가 이 안에 알약 크롬을 그린다. */
const TOOLBAR_SIZE = { width: 520, height: 96 }

/**
 * 캡처 툴바 창(arming 의 얼굴, #70). 온디맨드 플로팅 pill — 프레임 없는 투명 창을
 * 주 디스플레이 작업영역 하단 중앙에 띄운다. `screen-saver` 레벨 always-on-top 이라
 * 전체화면 앱 위에도 뜨고, content-protection 으로 녹화 화면에는 찍히지 않는다.
 */
function createToolbarWindow(): WindowEntry<BrowserWindow> {
  const { workArea } = screen.getPrimaryDisplay()
  const x = Math.round(workArea.x + (workArea.width - TOOLBAR_SIZE.width) / 2)
  const y = Math.round(workArea.y + workArea.height - TOOLBAR_SIZE.height - 48)
  const entry = createRoleWindow('toolbar', {
    width: TOOLBAR_SIZE.width,
    height: TOOLBAR_SIZE.height,
    x,
    y,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: true,
    fullscreenable: false,
    skipTaskbar: true,
    show: false
  })
  const win = entry.window
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setContentProtection(true)
  if (process.platform === 'darwin') {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  }
  win.once('ready-to-show', () => {
    win.show()
    win.focus()
  })
  return entry
}

/** 열려 있는 캡처 툴바 창을 모두 파괴한다(arming 종료 — 취소/녹화 시작 공통). */
function destroyToolbars(): void {
  for (const entry of registry.allByRole('toolbar')) entry.window.destroy()
}

/** 플로팅 REC 알약 창의 크기(#74). 점 + 타임코드 + 정지 버튼을 담는 작은 pill. */
const REC_PILL_SIZE = { width: 220, height: 56 }

/**
 * 플로팅 REC 알약 창(녹화 중 표시·정지 표면, #74). 캡처 툴바가 녹화 시작 시 이미
 * 닫혀 있어 자리가 겹치지 않는다 — 주 디스플레이 작업영역 상단 중앙에 띄운다.
 * 캡처 툴바·선택 오버레이와 같은 이유로 always-on-top + content-protected 다
 * (화면 녹화 자체에는 찍히지 않아야 한다).
 */
function createRecPillWindow(): WindowEntry<BrowserWindow> {
  const { workArea } = screen.getPrimaryDisplay()
  const x = Math.round(workArea.x + (workArea.width - REC_PILL_SIZE.width) / 2)
  const y = Math.round(workArea.y + 24)
  const entry = createRoleWindow('rec-pill', {
    width: REC_PILL_SIZE.width,
    height: REC_PILL_SIZE.height,
    x,
    y,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    focusable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false
  })
  const win = entry.window
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setContentProtection(true)
  if (process.platform === 'darwin') {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  }
  win.once('ready-to-show', () => win.show())
  return entry
}

/** REC 알약을 보장한다(없으면 생성) — 녹화 진입 시 `syncWindowForState` 가 호출한다. */
function showRecPill(): void {
  if (registry.firstByRole('rec-pill')) return
  createRecPillWindow()
}

/** 열려 있는 REC 알약을 모두 파괴한다(녹화 종료·취소 공통). */
function destroyRecPill(): void {
  for (const entry of registry.allByRole('rec-pill')) entry.window.destroy()
}

/**
 * Window 선택 오버레이 창(#73). 모든 디스플레이 bounds 를 합친 가상 데스크톱 전체를
 * 덮는 단일 프레임 없는 투명 창이다. 기본은 클릭스루(`setIgnoreMouseEvents(true,
 * {forward:true})`) — 마우스 이동은 렌더러로 포워딩돼 호버 하이라이트를 그릴 수 있지만
 * 클릭은 아래 창으로 그대로 흘러간다. 렌더러가 커서 아래 창을 찾으면(hitTest) 그 순간만
 * `overlay:hover`로 알려 클릭스루를 잠깐 끄고, 그 클릭을 오버레이가 직접 받아 확정한다
 * (`overlay:select`) — 그래서 빈 데스크톱 클릭은 아래로 흘러 사실상 무시되고, 창 위
 * 클릭만 오버레이가 가로챈다.
 */
function createWindowPickerOverlay(): WindowEntry<BrowserWindow> {
  const displays = screen.getAllDisplays()
  const minX = Math.min(...displays.map((d) => d.bounds.x))
  const minY = Math.min(...displays.map((d) => d.bounds.y))
  const maxX = Math.max(...displays.map((d) => d.bounds.x + d.bounds.width))
  const maxY = Math.max(...displays.map((d) => d.bounds.y + d.bounds.height))
  const context: WindowPickerOverlayContext = {
    kind: 'window-picker',
    screenHeightPt: screen.getPrimaryDisplay().size.height,
    originX: minX,
    originY: minY
  }

  const entry = createRoleWindow(
    'overlay',
    {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      movable: false,
      focusable: false,
      fullscreenable: false,
      skipTaskbar: true,
      show: false
    },
    context
  )
  const win = entry.window
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setContentProtection(true)
  win.setIgnoreMouseEvents(true, { forward: true })
  if (process.platform === 'darwin') {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  }
  win.once('ready-to-show', () => win.show())
  return entry
}

/**
 * Area 선택 오버레이 창(#72). 주 디스플레이 하나를 정확히 덮는 프레임 없는 투명 창 —
 * 단일 디스플레이 한정. Window picker 와 달리 클릭스루가 아니다(드래그로 사각형을 그리는
 * 창이라 모든 마우스 이벤트를 직접 받는다). 확정 rect 는 오버레이 로컬(DIP) 그대로 받아
 * main 이 전역 sourceRect 로 매핑한다(`confirmAreaSelection`).
 */
function createAreaOverlayWindow(display: Electron.Display): WindowEntry<BrowserWindow> {
  const { bounds } = display
  const context: AreaOverlayContext = { kind: 'area' }
  const entry = createRoleWindow(
    'overlay',
    {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      movable: false,
      fullscreenable: false,
      skipTaskbar: true,
      show: false
    },
    context
  )
  const win = entry.window
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setContentProtection(true)
  if (process.platform === 'darwin') {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  }
  win.once('ready-to-show', () => {
    win.show()
    win.focus()
  })
  return entry
}

/**
 * Display 선택 오버레이 창 하나(#71). 디스플레이 하나를 정확히 덮는 프레임 없는 투명
 * 창으로, 딤·해상도 배지·Start 는 렌더러(DisplayOverlayView)가 그린다. 창 경계가 곧
 * 디스플레이 경계라 hover 하이라이트는 CSS `:hover` 만으로 성립한다(교차 창 커서 추적 불필요).
 */
function createDisplayOverlayWindow(
  bounds: Electron.Rectangle,
  context: DisplayOverlayContext
): WindowEntry<BrowserWindow> {
  const entry = createRoleWindow(
    'overlay',
    {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      movable: false,
      fullscreenable: false,
      skipTaskbar: true,
      show: false
    },
    context
  )
  const win = entry.window
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setContentProtection(true)
  if (process.platform === 'darwin') {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  }
  win.once('ready-to-show', () => win.show())
  return entry
}

/**
 * Display 선택 오버레이를 디스플레이마다 하나씩 띄운다(#71). 사이드카 대상 목록으로
 * Electron 디스플레이와 `display:<id>` 를 짝지어(매칭 로직은 display-overlay.ts) 각 창에
 * 자기 대상 id·해상도를 실어 보낸다. 목록 조회를 기다리는 동안 모드가 바뀌거나 arming 을
 * 벗어났을 수 있어, 응답 후 현재 상태를 재확인하고 어긋나면 조용히 포기한다.
 */
async function createDisplayOverlays(): Promise<void> {
  let targets: CaptureTarget[] = []
  try {
    targets = await recorder.listTargets()
  } catch {
    return // 목록 실패(권한 등)는 오버레이를 안 띄운다 — 권한 안내는 녹화 시작 경로가 맡는다.
  }
  if (currentState.status !== 'arming' || armingMode !== 'display') return
  if (registry.allByRole('overlay').length > 0) return

  const displays = screen.getAllDisplays().map((d) => ({ id: d.id, ...d.bounds }))
  for (const match of matchDisplayTargets(displays, targets)) {
    createDisplayOverlayWindow(match.bounds, {
      kind: 'display',
      targetId: match.targetId,
      width: match.width,
      height: match.height,
      countdownEnabled
    })
  }
}

/** 열려 있는 선택 오버레이 창을 모두 파괴한다(모드 전환·취소·확정 공통). */
function destroyOverlays(): void {
  for (const entry of registry.allByRole('overlay')) entry.window.destroy()
}

/**
 * 캡처 툴바를 소환한다(idle→arming). 이미 떠 있으면 새로 만들지 않고 포커스한다.
 * ⌥⌘R·메뉴바 좌클릭·트레이 '녹화 시작'이 공유하는 진입점.
 */
function summonToolbar(): void {
  const existing = registry.firstByRole('toolbar')
  if (existing) {
    existing.window.show()
    existing.window.focus()
    return
  }
  createToolbarWindow()
  applyState({ status: 'arming' })
}

/** arming 취소 — 툴바·오버레이를 닫고 idle 로 되돌린다(Esc/✕). */
function cancelArming(): void {
  destroyToolbars()
  destroyOverlays()
  if (currentState.status === 'arming') applyState({ status: 'idle' })
}

/**
 * 캡처 툴바의 모드 전환을 반영한다(#71/#73/#72). Display 는 디스플레이당 선택 오버레이,
 * Window 는 창 선택 오버레이, Area 는 영역 선택 오버레이(주 디스플레이)를 띄운다 —
 * 같은 종류가 이미 떠 있으면 그대로 두고, 다른 종류는 닫고 새로 만든다.
 */
function setCaptureMode(mode: CaptureMode): void {
  armingMode = mode
  const wanted: OverlayContext['kind'] =
    mode === 'window' ? 'window-picker' : mode === 'area' ? 'area' : 'display'
  const existing = registry.firstByRole('overlay')
  const existingKind = (existing?.context as OverlayContext | null)?.kind ?? null
  if (existingKind === wanted) return
  destroyOverlays()
  if (wanted === 'window-picker') createWindowPickerOverlay()
  else if (wanted === 'area') createAreaOverlayWindow(screen.getPrimaryDisplay())
  else void createDisplayOverlays()
}

/** 주 디스플레이(전체 화면) 대상의 id 를 사이드카 목록에서 찾는다. 실패하면 null. */
async function resolveDisplayTargetId(): Promise<string | null> {
  try {
    if (!(await ensureScreenAccess())) throw new Error(PERMISSION_MESSAGE)
    const targets = await recorder.listTargets()
    return targets.find((t) => t.kind === 'display')?.id ?? targets[0]?.id ?? null
  } catch {
    // 목록 실패(권한 등)는 호출부가 안내한다.
    return null
  }
}

/**
 * Display 선택 오버레이가 고른 대상으로 녹화를 시작한다(#71). 카운트다운은 오버레이
 * 렌더러가 처리하고 여기선 즉시 시작한다. Window 는 `overlay:select`, Area 는
 * `capture:area-confirm` 이 별도 경로라 여기 도달하지 않는다 — targetId 없이 오면 무시.
 */
function startFromToolbar(mode: CaptureMode, targetId?: string): void {
  if (mode !== 'display' || !targetId) return
  destroyToolbars()
  destroyOverlays()
  void startRecording(targetId)
}

/**
 * Window 선택 오버레이에서 창을 클릭해 확정했다(#73). 툴바·오버레이를 닫고 그 대상으로
 * 바로 녹화를 시작한다 — Display 의 `startFromToolbar` 와 달리 대상이 이미 정해져 있다.
 */
function selectWindowTarget(targetId: string): void {
  destroyToolbars()
  destroyOverlays()
  void startRecording(targetId)
}

/**
 * Area 오버레이에서 확정한 로컬 rect(DIP, 좌상단 원점)로 crop 녹화를 시작한다(#72).
 * 오버레이는 정확히 그 디스플레이 전체를 덮으므로 오버레이 창의 `getBounds()` 원점이
 * 곧 `+display.bounds.origin` 단계이고, 주 디스플레이 높이로 AppKit y 를 뒤집으면
 * 사이드카가 기대하는 `sourceRect`(전역 AppKit 좌표)가 된다.
 */
async function confirmAreaSelection(localRect: Rect): Promise<void> {
  const overlay = registry.firstByRole('overlay')
  if (!overlay || (overlay.context as OverlayContext | null)?.kind !== 'area') return
  const overlayBounds = overlay.window.getBounds()
  const flipHeight = screen.getPrimaryDisplay().bounds.height
  const sourceRect = overlayRectToSourceRect(localRect, overlayBounds, flipHeight)

  const targetId = await resolveDisplayTargetId()
  destroyToolbars()
  destroyOverlays()
  if (targetId) void startRecording(targetId, sourceRect)
  else applyState({ status: 'error', code: 'no-display', message: PERMISSION_MESSAGE })
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
    (): Promise<RecordingSummary[]> => listRecordings(undefined, mediaUrl)
  )

  // 렌더러가 미리보기 첫 프레임을 캡처한 JPEG를 녹화 폴더에 썸네일 캐시로 저장한다.
  ipcMain.handle(IpcChannel.SaveThumbnail, (_e, folder: string, bytes: ArrayBuffer) =>
    saveThumbnail(folder, Buffer.from(bytes))
  )

  ipcMain.handle(IpcChannel.EditorOpen, (_e, folder: string) => openEditorForFolder(folder))

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

  // 지정 role 의 창을 연다. 싱글톤 role(shell·library·welcome)은 이미 열려 있으면
  // 새로 만들지 않고 기존 창을 표시·포커스한다. 새/기존 창의 windowId 를 돌려준다.
  ipcMain.handle(IpcChannel.WindowOpen, (_e, role: WindowRole, context: unknown) => {
    const isSingleton = role === 'shell' || role === 'library' || role === 'welcome'
    if (isSingleton) {
      const existing = registry.firstByRole(role)
      if (existing) {
        existing.window.show()
        existing.window.focus()
        return existing.id
      }
    }
    const entry =
      role === 'shell'
        ? createShellWindow()
        : role === 'welcome'
          ? createWelcomeWindow()
          : role === 'library'
            ? createLibraryWindow()
            : createRoleWindow(role, defaultWindowOptions(), context)
    return entry.id
  })

  // 창 생성 시 넣어 둔 초기 컨텍스트를 windowId 로 돌려준다(렌더러 부팅 pull). 없으면 null.
  ipcMain.handle(IpcChannel.WindowGetContext, (_e, id: number) => registry.get(id)?.context ?? null)

  // 캡처 툴바: 선택 오버레이가 고른 대상으로 녹화 시작(#71) · arming 취소.
  ipcMain.handle(IpcChannel.CaptureStart, (_e, mode: CaptureMode, targetId?: string) =>
    startFromToolbar(mode, targetId)
  )
  ipcMain.handle(IpcChannel.CaptureCancel, () => cancelArming())
  // 모드 전환 — 모드별 선택 오버레이를 띄우고, 다른 종류는 닫는다.
  ipcMain.handle(IpcChannel.CaptureSetMode, (_e, mode: CaptureMode) => setCaptureMode(mode))
  // 3-2-1 카운트다운 설정 — 다음에 만들 Display 오버레이 창의 컨텍스트 스냅샷에 반영된다.
  ipcMain.handle(IpcChannel.CaptureSetCountdown, (_e, enabled: boolean) => {
    countdownEnabled = enabled
  })

  // Window 선택 오버레이(#73): 호버 상태에 따라 그 창의 클릭스루를 토글하고(hover=true 면
  // 다음 클릭을 오버레이가 직접 받도록 끈다), 클릭 확정은 그 대상으로 바로 녹화를 시작한다.
  ipcMain.handle(IpcChannel.OverlayHover, (e, hovering: boolean) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    win?.setIgnoreMouseEvents(!hovering, hovering ? undefined : { forward: true })
  })
  ipcMain.handle(IpcChannel.OverlaySelect, (_e, targetId: string) => selectWindowTarget(targetId))

  // Area 오버레이(#72) 확정 — 로컬 rect 를 전역 sourceRect 로 매핑해 crop 녹화를 시작한다.
  ipcMain.handle(IpcChannel.CaptureAreaConfirm, (_e, rect: Rect) => confirmAreaSelection(rect))

  // 완료 시 플래그를 저장하고 Welcome 창을 닫은 뒤(#80), shell 창을 보인다(없으면 새로 만든다).
  ipcMain.handle(IpcChannel.OnboardingComplete, async () => {
    await saveOnboardingComplete(app.getPath('userData'))
    welcomeWindow()?.close()
    if (shellWindow()) showLauncher()
    else createShellWindow()
  })

  // 온보딩 권한 단계: 상태 조회(폴링) · 설정 패널 열기 · 재시작 확인 다이얼로그.
  ipcMain.handle(IpcChannel.PermissionStatus, (): PermissionStatus => readPermissionStatus())
  ipcMain.handle(IpcChannel.OpenPermissionSettings, (_e, kind: PermissionKind) =>
    openPermissionSettings(kind)
  )
  ipcMain.handle(IpcChannel.ConfirmRestart, () => confirmRestart())
}

// dev 모드에서도 메뉴바·Dock·창 타이틀이 제품명으로 뜨도록 앱 이름을 고정한다
// (패키징 전에는 package.json name이 소문자 "recap"으로 잡히기 때문).
app.setName('Recap')

app.whenReady().then(async () => {
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
  // 완료 플래그가 없으면(첫 실행 등) Welcome 창을 자동 소환한다(#80) — 이 판정을
  // 예전엔 App.tsx(렌더러)가 했지만, 창이 분리되며 main으로 옮겨왔다. 완료 후엔
  // Welcome이 닫히며 onboarding:complete 핸들러가 shell 창을 새로 만든다.
  const onboarded = await isOnboardingComplete(app.getPath('userData'))
  if (onboarded) createShellWindow()
  else summonWelcome()
  setupTray()
  registerGlobalShortcut()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) ensureShellWindow()
    else showLauncher()
  })
})

/** 메뉴바 트레이를 세운다. 진입점·녹화 상태 표시·정지·종료를 담당한다. */
function setupTray(): void {
  appTray = new AppTray(brandAssetPath('tray-idle.png'), brandAssetPath('tray-recording.png'), {
    onToggleRecord: () => void toggleRecord(),
    onShowLauncher: () => showLauncher(),
    onShowWelcome: () => summonWelcome(),
    onShowLibrary: () => summonLibrary(),
    onOpenRecording: (folder) => {
      void openEditorForFolder(folder).catch((err) => console.error('[tray] 녹화 열기 실패', err))
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
