/**
 * 녹화 로컬 영속화 — 녹화 폴더를 읽고 쓰는 유일한 지점.
 *
 * 한 녹화는 ~/Movies/Hoppy/{timestamp}/ 폴더 하나다. 그 안에:
 *  - 원본 영상 (사이드카가 기록)
 *  - events.json  (이벤트 트랙)
 *  - recipe.json  (렌더 레시피 — 편집 상태. 미리보기에서 유도·편집되어 저장된다)
 *  - recording.json (매니페스트 — 위 세 산출물을 묶어 "다시 열기"를 가능케 한다)
 *
 * 매니페스트가 세 산출물을 한데 묶으므로, 앱을 재시작해도 폴더만 훑어 최근 녹화
 * 목록을 세우고 그 편집 상태를 그대로 복원할 수 있다.
 */

import { readFile, writeFile, readdir, access } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { CaptureTarget, EventTrack } from '../shared/event-track'
import type { RenderRecipe } from '../shared/recipe'
import { serializeRecipe, parseRecipe } from '../shared/recipe.persist'
import type { StylePreset } from '../shared/style-preset'
import { serializePresets, parsePresets } from '../shared/style-preset.persist'
import type { RecordingSummary } from '../shared/ipc'
import { resolveTitle } from '../shared/library-title'

const MANIFEST_FILE = 'recording.json'
const EVENTS_FILE = 'events.json'
const RECIPE_FILE = 'recipe.json'
const THUMBNAIL_FILE = 'thumbnail.jpg'
/** 온보딩 완료 플래그 파일 이름. userData 폴더에 하나만 둔다. */
const ONBOARDING_FILE = 'onboarding.json'
/** 스타일 프리셋 목록 파일 이름. userData 폴더에 하나만 둔다(녹화 폴더와 무관한 앱 전역 저장소, #77). */
const STYLE_PRESETS_FILE = 'style-presets.json'

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
  /** 사용자 지정 제목(#79 라이브러리 이름변경). 없으면(마이그레이션 전 녹화) 폴더 이름 폴백. */
  title?: string
}

const MANIFEST_VERSION = 1

/** 녹화들이 저장되는 최상위 폴더. Recorder와 이 모듈이 공유하는 단일 기준. */
export function recordingsBaseDir(): string {
  return join(homedir(), 'Movies', 'Hoppy')
}

/** 녹화 폴더에 매니페스트를 쓴다. 녹화 마무리 시 세 산출물을 묶는다. */
export async function writeManifest(folder: string, manifest: RecordingManifest): Promise<void> {
  await writeFile(join(folder, MANIFEST_FILE), JSON.stringify(manifest, null, 2), 'utf8')
}

/** 렌더 레시피(편집 상태)를 녹화 폴더에 저장한다. 편집할 때마다 덮어쓴다. */
export async function saveRecipe(folder: string, recipe: RenderRecipe): Promise<void> {
  await writeFile(join(folder, RECIPE_FILE), serializeRecipe(recipe), 'utf8')
}

/** 첫 프레임 썸네일(JPEG)을 녹화 폴더에 캐시로 저장한다. 미리보기 진입 시 한 번 쓴다. */
export async function saveThumbnail(folder: string, bytes: Buffer): Promise<void> {
  await writeFile(join(folder, THUMBNAIL_FILE), bytes)
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
 *
 * 썸네일 캐시가 있는 폴더는 toThumbnailUrl로 미리보기 URL을 만든다(스킴은 본체가 소유).
 * 캐시가 없는 구버전 녹화는 thumbnailUrl 없이 그대로 나열한다.
 */
export async function listRecordings(
  baseDir = recordingsBaseDir(),
  toThumbnailUrl?: (absPath: string) => string
): Promise<RecordingSummary[]> {
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
    const thumbPath = join(folder, THUMBNAIL_FILE)
    const hasThumb = toThumbnailUrl ? await fileExists(thumbPath) : false
    summaries.push({
      folder,
      name,
      startedAt: manifest.startedAt,
      durationMs: manifest.durationMs,
      eventCount: manifest.eventCount,
      title: resolveTitle(manifest.title, name),
      ...(hasThumb ? { thumbnailUrl: toThumbnailUrl!(thumbPath) } : {})
    })
  }
  return summaries.sort((a, b) => b.startedAt - a.startedAt)
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
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

/**
 * 녹화의 표시 제목을 바꿔 manifest에 저장한다(#79 라이브러리 이름변경). 다른 매니페스트
 * 필드는 그대로 유지 — title만 갱신하는 부분 쓰기.
 */
export async function renameRecording(folder: string, title: string): Promise<void> {
  const manifest = await readManifest(folder)
  if (!manifest) throw new Error(`녹화 매니페스트를 읽을 수 없습니다: ${folder}`)
  await writeManifest(folder, { ...manifest, title })
}

/**
 * 녹화 폴더를 통째로 휴지통으로 옮긴다(복구 가능 삭제, #79). 실제 이동은 Electron의
 * `shell.trashItem`이 하므로, 이 함수는 그 호출을 주입받아 storage 모듈을 Electron 프리
 * (vitest에서 테스트 가능)하게 유지한다.
 */
export async function trashRecording(
  folder: string,
  trashItem: (path: string) => Promise<void>
): Promise<void> {
  await trashItem(folder)
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

/**
 * 온보딩 완료 플래그를 userData에 저장한다. 마지막 단계 완료 액션에서 한 번 쓴다.
 * (녹화 폴더와 무관하므로 userData 경로를 인자로 받는다 — 테스트는 임시 폴더를 넘긴다.)
 */
export async function saveOnboardingComplete(userDataDir: string): Promise<void> {
  await writeFile(join(userDataDir, ONBOARDING_FILE), JSON.stringify({ completed: true }), 'utf8')
}

/**
 * 온보딩 완료 여부를 읽는다. 파일이 없거나 손상되면 미완료로 본다 — 도중 종료 시
 * 플래그가 없어 다음 실행에서 온보딩이 다시 뜬다.
 */
export async function isOnboardingComplete(userDataDir: string): Promise<boolean> {
  try {
    const raw = JSON.parse(await readFile(join(userDataDir, ONBOARDING_FILE), 'utf8'))
    return raw?.completed === true
  } catch {
    return false
  }
}

/**
 * 앱 전역 스타일 프리셋 목록을 userData에서 읽는다(녹화별 저장소와 무관, #77).
 * 파일이 없거나 손상되면 빈 목록(프리셋 목록이 아예 막히지 않도록).
 */
export async function listStylePresets(userDataDir: string): Promise<StylePreset[]> {
  try {
    return parsePresets(await readFile(join(userDataDir, STYLE_PRESETS_FILE), 'utf8'))
  } catch {
    return []
  }
}

/**
 * 스타일 프리셋을 userData에 저장한다. 같은 id가 이미 있으면 덮어쓰고, 없으면 추가한다
 * (이름 바꾸기 등 향후 갱신에도 재사용 가능하도록 upsert로 둔다).
 */
export async function saveStylePreset(userDataDir: string, preset: StylePreset): Promise<void> {
  const existing = await listStylePresets(userDataDir)
  const next = [...existing.filter((p) => p.id !== preset.id), preset]
  await writeFile(join(userDataDir, STYLE_PRESETS_FILE), serializePresets(next), 'utf8')
}

/** 지정 id의 스타일 프리셋을 userData에서 지운다. 없는 id면 조용히 통과한다. */
export async function deleteStylePreset(userDataDir: string, id: string): Promise<void> {
  const existing = await listStylePresets(userDataDir)
  const next = existing.filter((p) => p.id !== id)
  await writeFile(join(userDataDir, STYLE_PRESETS_FILE), serializePresets(next), 'utf8')
}

export { MANIFEST_VERSION }
