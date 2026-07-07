import { contextBridge, ipcRenderer } from 'electron'
import {
  IpcChannel,
  type CaptureTarget,
  type RecordingState,
  type RecordingSummary,
  type ExportSaveResult
} from '../shared/ipc'
import type { RenderRecipe } from '../shared/recipe'
import type { ExportFormat } from '../shared/export-preset'

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
  /** 저장된 녹화를 다시 연다. 결과는 onStateChange로 미리보기 상태가 온다. */
  openRecording: (folder: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannel.OpenRecording, folder),
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
    ipcRenderer.invoke(IpcChannel.ExportCopyPath, path)
}

contextBridge.exposeInMainWorld('recap', api)

export type RecapApi = typeof api
