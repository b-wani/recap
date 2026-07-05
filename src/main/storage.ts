/**
 * 녹화 로컬 영속화 — 녹화 폴더를 읽고 쓰는 유일한 지점.
 *
 * 한 녹화는 ~/Movies/DevScreen/{timestamp}/ 폴더 하나다. 그 안에:
 *  - 원본 영상 (사이드카가 기록)
 *  - events.json  (이벤트 트랙)
 *  - recipe.json  (렌더 레시피 — 편집 상태. 미리보기에서 유도·편집되어 저장된다)
 *  - recording.json (매니페스트 — 위 세 산출물을 묶어 "다시 열기"를 가능케 한다)
 *
 * 매니페스트가 세 산출물을 한데 묶으므로, 앱을 재시작해도 폴더만 훑어 최근 녹화
 * 목록을 세우고 그 편집 상태를 그대로 복원할 수 있다.
 */

import { readFile, writeFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { CaptureTarget, EventTrack } from '../shared/event-track'
import type { RenderRecipe } from '../shared/recipe'
import { serializeRecipe, parseRecipe } from '../shared/recipe.persist'
import type { RecordingSummary } from '../shared/ipc'

const MANIFEST_FILE = 'recording.json'
const EVENTS_FILE = 'events.json'
const RECIPE_FILE = 'recipe.json'

/** 녹화 폴더가 담는 모든 것의 절대 경로 색인. 세 산출물을 하나로 묶는다. */
export interface RecordingManifest {
  /** 매니페스트 스키마 버전. */
  version: number
  /** 원본 영상 파일 절대 경로. */
  videoPath: string
  /** 녹화 시작 시점 (Unix epoch ms). 목록 정렬 기준. */
  startedAt: number
  /** 녹화 길이 (ms). */
  durationMs: number
  /** 이벤트 트랙 개수. */
  eventCount: number
  /** 녹화된 캡처 대상 (전체 화면 또는 특정 창). 다시 열 때 미리보기가 복원한다. */
  target: CaptureTarget
}

const MANIFEST_VERSION = 1

/** 녹화들이 저장되는 최상위 폴더. Recorder와 이 모듈이 공유하는 단일 기준. */
export function recordingsBaseDir(): string {
  return join(homedir(), 'Movies', 'DevScreen')
}

/** 녹화 폴더에 매니페스트를 쓴다. 녹화 마무리 시 세 산출물을 묶는다. */
export async function writeManifest(folder: string, manifest: RecordingManifest): Promise<void> {
  await writeFile(join(folder, MANIFEST_FILE), JSON.stringify(manifest, null, 2), 'utf8')
}

/** 렌더 레시피(편집 상태)를 녹화 폴더에 저장한다. 편집할 때마다 덮어쓴다. */
export async function saveRecipe(folder: string, recipe: RenderRecipe): Promise<void> {
  await writeFile(join(folder, RECIPE_FILE), serializeRecipe(recipe), 'utf8')
}

/** 다시 연 녹화가 미리보기에 필요로 하는 모든 것. */
export interface LoadedRecording {
  folder: string
  videoPath: string
  durationMs: number
  eventCount: number
  eventTrack: EventTrack
  /** 녹화된 캡처 대상 (전체 화면 또는 특정 창). */
  target: CaptureTarget
  /** 저장된 편집 상태. 없으면(레시피 저장 전) 이벤트 트랙에서 다시 유도한다. */
  recipe: RenderRecipe | null
}

/**
 * baseDir 아래 녹화들을 최신순으로 나열한다. 매니페스트가 없거나 손상된 폴더는
 * 목록에서 조용히 제외한다 (진행 중이거나 깨진 녹화가 목록을 막지 않도록).
 */
export async function listRecordings(baseDir = recordingsBaseDir()): Promise<RecordingSummary[]> {
  let entries: string[]
  try {
    entries = await readdir(baseDir)
  } catch {
    return [] // 폴더가 아직 없으면 빈 목록.
  }

  const summaries: RecordingSummary[] = []
  for (const name of entries) {
    const folder = join(baseDir, name)
    const manifest = await readManifest(folder)
    if (!manifest) continue
    summaries.push({
      folder,
      name,
      startedAt: manifest.startedAt,
      durationMs: manifest.durationMs,
      eventCount: manifest.eventCount
    })
  }
  return summaries.sort((a, b) => b.startedAt - a.startedAt)
}

/**
 * 녹화 폴더 하나를 로드한다. 매니페스트·이벤트 트랙은 필수, 레시피는 있으면 복원하고
 * 없거나 손상되었으면 null (미리보기가 이벤트 트랙에서 다시 유도한다).
 */
export async function loadRecording(folder: string): Promise<LoadedRecording> {
  const manifest = await readManifest(folder)
  if (!manifest) throw new Error(`녹화 매니페스트를 읽을 수 없습니다: ${folder}`)

  const eventTrack = JSON.parse(await readFile(join(folder, EVENTS_FILE), 'utf8')) as EventTrack

  return {
    folder,
    videoPath: manifest.videoPath,
    durationMs: manifest.durationMs,
    eventCount: manifest.eventCount,
    eventTrack,
    target: manifest.target,
    recipe: await readRecipe(folder)
  }
}

async function readManifest(folder: string): Promise<RecordingManifest | null> {
  try {
    const raw = JSON.parse(await readFile(join(folder, MANIFEST_FILE), 'utf8')) as RecordingManifest
    if (raw.version !== MANIFEST_VERSION || typeof raw.videoPath !== 'string') return null
    if (typeof raw.target !== 'object' || raw.target === null) return null
    return raw
  } catch {
    return null
  }
}

async function readRecipe(folder: string): Promise<RenderRecipe | null> {
  try {
    return parseRecipe(await readFile(join(folder, RECIPE_FILE), 'utf8'))
  } catch {
    return null // 레시피 미저장 또는 손상 — 미리보기가 이벤트 트랙에서 다시 유도한다.
  }
}

export { MANIFEST_VERSION }
