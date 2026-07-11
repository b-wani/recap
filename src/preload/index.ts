import { contextBridge, ipcRenderer } from 'electron'
import {
  IpcChannel,
  type CaptureTarget,
  type CaptureMode,
  type RecordingState,
  type RecordingSummary,
  type ExportSaveResult,
  type Rect
} from '../shared/ipc'
import type { RenderRecipe } from '../shared/recipe'
import type { StylePreset } from '../shared/style-preset'
import type { ExportFormat } from '../shared/export-preset'
import type { PermissionKind, PermissionStatus } from '../shared/onboarding'
import type { WindowRole } from '../shared/window-url'

/** 렌더러에 노출되는 안전한 API 표면. */
const api = {
  /** 선택 가능한 캡처 대상(전체 화면 + 열린 창) 목록을 조회한다. */
  listTargets: (): Promise<CaptureTarget[]> => ipcRenderer.invoke(IpcChannel.ListTargets),
  /** 지정한 대상의 녹화를 시작한다. targetId는 listTargets가 준 CaptureTarget.id. */
  start: (targetId: string): Promise<void> => ipcRenderer.invoke(IpcChannel.Start, targetId),
  stop: (): Promise<void> => ipcRenderer.invoke(IpcChannel.Stop),
  /** 녹화 상태 변화를 구독한다. 해제 함수를 반환한다. */
  onStateChange: (cb: (state: RecordingState) => void): (() => void) => {
    const listener = (_e: unknown, state: RecordingState): void => cb(state)
    ipcRenderer.on(IpcChannel.State, listener)
    return () => ipcRenderer.removeListener(IpcChannel.State, listener)
  },
  /** 유도·편집한 렌더 레시피를 녹화 폴더에 저장한다. */
  saveRecipe: (folder: string, recipe: RenderRecipe): Promise<void> =>
    ipcRenderer.invoke(IpcChannel.SaveRecipe, folder, recipe),
  /** 로컬에 저장된 최근 녹화 목록을 최신순으로 가져온다. */
  listRecordings: (): Promise<RecordingSummary[]> => ipcRenderer.invoke(IpcChannel.ListRecordings),
  /** 미리보기 첫 프레임 썸네일(JPEG 바이트)을 녹화 폴더에 캐시로 저장한다. */
  saveThumbnail: (folder: string, bytes: ArrayBuffer): Promise<void> =>
    ipcRenderer.invoke(IpcChannel.SaveThumbnail, folder, bytes),
  /** 저장된 녹화를 독립 에디터 창으로 연다(다중 인스턴스, #75). */
  openEditor: (folder: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannel.EditorOpen, folder),
  /** 익스포트된 바이트를 포맷에 맞춰 녹화 폴더에 저장하고 경로·용량을 돌려받는다. */
  saveExport: (
    bytes: ArrayBuffer,
    folder: string,
    format: ExportFormat
  ): Promise<ExportSaveResult> => ipcRenderer.invoke(IpcChannel.ExportSave, bytes, folder, format),
  /** 저장된 파일을 Finder에서 연다. */
  revealExport: (path: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannel.ExportReveal, path),
  /** 저장된 파일 경로를 클립보드에 복사한다. */
  copyExportPath: (path: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannel.ExportCopyPath, path),
  /** 녹화 제목을 바꿔 manifest에 저장한다(#79). */
  renameRecording: (folder: string, title: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannel.RenameRecording, folder, title),
  /** 확인 다이얼로그 후 녹화 폴더를 휴지통으로 옮긴다. 취소되면 false를 돌려준다. */
  trashRecording: (folder: string): Promise<boolean> =>
    ipcRenderer.invoke(IpcChannel.TrashRecording, folder),
  /** 녹화 폴더를 Finder에서 연다. */
  revealRecording: (folder: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannel.RevealRecording, folder),
  /** 지정 role 의 창을 연다(싱글톤이면 기존 창 focus). 새/기존 창의 windowId 를 돌려받는다. */
  openWindow: (role: WindowRole, context?: unknown): Promise<number> =>
    ipcRenderer.invoke(IpcChannel.WindowOpen, role, context),
  /** 이 창의 초기 컨텍스트를 windowId 로 당겨온다(부팅 시 role 별 페이로드 로드). */
  getWindowContext: (id: number): Promise<unknown> =>
    ipcRenderer.invoke(IpcChannel.WindowGetContext, id),
  /** Display 선택 오버레이가 고른 대상으로 녹화를 시작한다(targetId=CaptureTarget.id, #71). */
  captureStart: (mode: CaptureMode, targetId?: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannel.CaptureStart, mode, targetId),
  /** arming 취소 — 툴바·오버레이를 닫고 idle 로. */
  captureCancel: (): Promise<void> => ipcRenderer.invoke(IpcChannel.CaptureCancel),
  /** 캡처 모드 전환을 알린다(모드별 선택 오버레이 생성, 다른 종류는 파괴). */
  captureSetMode: (mode: CaptureMode): Promise<void> =>
    ipcRenderer.invoke(IpcChannel.CaptureSetMode, mode),
  /** 3-2-1 카운트다운 설정을 main 에 반영한다(Display 오버레이가 생성 시점 값을 컨텍스트로 받는다). */
  captureSetCountdown: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke(IpcChannel.CaptureSetCountdown, enabled),
  /** Area 오버레이에서 확정한 로컬 rect 로 crop 녹화를 시작한다. */
  captureAreaConfirm: (rect: Rect): Promise<void> =>
    ipcRenderer.invoke(IpcChannel.CaptureAreaConfirm, rect),
  /** Window 선택 오버레이의 호버 상태 변화를 알린다(창 위=클릭 캡처, 빈 데스크톱=클릭스루). */
  overlayHover: (hovering: boolean): Promise<void> =>
    ipcRenderer.invoke(IpcChannel.OverlayHover, hovering),
  /** Window 선택 오버레이에서 창을 클릭해 확정 — 그 대상으로 녹화를 시작한다. */
  overlaySelect: (targetId: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannel.OverlaySelect, targetId),
  /** 온보딩 완료를 로컬에 저장한다. 마지막 단계 완료 액션에서 호출한다. */
  completeOnboarding: (): Promise<void> => ipcRenderer.invoke(IpcChannel.OnboardingComplete),
  /** 화면 녹화·손쉬운 사용 권한의 granted 여부를 조회한다(권한 단계 250ms 폴링). */
  getPermissionStatus: (): Promise<PermissionStatus> =>
    ipcRenderer.invoke(IpcChannel.PermissionStatus),
  /** 지정한 권한 종류의 시스템 설정 패널을 연다(화면 녹화는 열기 전 목록 등록). */
  openPermissionSettings: (kind: PermissionKind): Promise<void> =>
    ipcRenderer.invoke(IpcChannel.OpenPermissionSettings, kind),
  /** 재시작 확인 다이얼로그를 띄우고, 수락 시 앱을 재시작한다. */
  confirmRestart: (): Promise<void> => ipcRenderer.invoke(IpcChannel.ConfirmRestart),
  /** 현재 레시피의 스타일(배경/커서)을 이름 붙여 앱 전역 프리셋으로 저장한다. 저장된 프리셋(id 포함)을 돌려받는다. */
  savePreset: (name: string, recipe: RenderRecipe): Promise<StylePreset> =>
    ipcRenderer.invoke(IpcChannel.PresetSave, name, recipe),
  /** 저장된 스타일 프리셋 목록을 가져온다. */
  listPresets: (): Promise<StylePreset[]> => ipcRenderer.invoke(IpcChannel.PresetList),
  /** 스타일 프리셋을 삭제한다. */
  deletePreset: (id: string): Promise<void> => ipcRenderer.invoke(IpcChannel.PresetDelete, id)
}

contextBridge.exposeInMainWorld('recap', api)

export type RecapApi = typeof api
