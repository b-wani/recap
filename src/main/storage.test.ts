import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it, expect } from 'vitest'
import {
  writeManifest,
  saveRecipe,
  listRecordings,
  loadRecording,
  MANIFEST_VERSION,
  type RecordingManifest
} from './storage'
import type { EventTrack } from '../shared/event-track'
import type { RenderRecipe } from '../shared/recipe'
import { sampleRecipe } from '../shared/recipe'

const eventTrack: EventTrack = {
  protocolVersion: 1,
  startedAt: 1000,
  durationMs: 5000,
  samples: [{ t: 1000, kind: 'down', x: 400, y: 300, cursor: 'arrow' }]
}

const recipe: RenderRecipe = {
  source: { width: 1000, height: 800 },
  zoomScale: 2,
  durationMs: 5000,
  zoomSegments: [
    { startMs: 500, fullInAtMs: 1000, holdEndMs: 3000, endMs: 3500, scale: 2, keyframes: [{ t: 1000, x: 400, y: 300 }] }
  ],
  cursor: {
    keyframes: [{ t: 1000, x: 400, y: 300, cursor: 'arrow' }],
    clicks: [{ t: 1000, x: 400, y: 300 }],
    size: 1,
    smoothingMs: 120
  },
  trim: { startMs: 250, endMs: 4750 },
  background: {
    type: 'color',
    color: '#1c1c1e',
    gradient: { angle: 145, stops: ['#2b2b30', '#161618'] },
    padding: 0.06,
    cornerRadius: 0,
    shadow: 0
  },
  badge: { visible: true, contextLabel: '' },
  keystrokes: { keys: [], overlayVisible: false }
}

function manifest(startedAt: number): RecordingManifest {
  return {
    version: MANIFEST_VERSION,
    videoPath: join('/movies', String(startedAt), 'raw.mp4'),
    startedAt,
    durationMs: 5000,
    eventCount: eventTrack.samples.length,
    target: { kind: 'display', id: 'display:1', title: '내장 디스플레이', width: 1000, height: 800 }
  }
}

let base: string

async function makeRecording(name: string, startedAt: number): Promise<string> {
  const folder = join(base, name)
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, 'events.json'), JSON.stringify(eventTrack), 'utf8')
  await writeManifest(folder, manifest(startedAt))
  return folder
}

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'recap-storage-'))
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

describe('녹화 로컬 영속화: 목록·다시 열기', () => {
  it('저장된 녹화들을 최신순으로 나열한다', async () => {
    await makeRecording('a', 1000)
    await makeRecording('b', 3000)
    await makeRecording('c', 2000)

    const list = await listRecordings(base)
    expect(list.map((r) => r.name)).toEqual(['b', 'c', 'a'])
    expect(list[0].startedAt).toBe(3000)
    expect(list[0].eventCount).toBe(1)
  })

  it('매니페스트가 없거나 손상된 폴더는 목록에서 제외한다', async () => {
    await makeRecording('good', 1000)
    await mkdir(join(base, 'no-manifest'), { recursive: true })
    await mkdir(join(base, 'broken'), { recursive: true })
    await writeFile(join(base, 'broken', 'recording.json'), 'not json', 'utf8')

    const list = await listRecordings(base)
    expect(list.map((r) => r.name)).toEqual(['good'])
  })

  it('베이스 폴더가 없으면 빈 목록을 준다', async () => {
    expect(await listRecordings(join(base, 'does-not-exist'))).toEqual([])
  })

  it('레시피를 저장하면 다시 열 때 저장된 편집 상태가 그대로 복원된다', async () => {
    const folder = await makeRecording('a', 1000)
    await saveRecipe(folder, recipe)

    const loaded = await loadRecording(folder)
    expect(loaded.recipe).toEqual(recipe)
    expect(loaded.eventTrack).toEqual(eventTrack)
    expect(loaded.videoPath).toBe(manifest(1000).videoPath)

    // 복원된 레시피가 저장 전과 동일한 샘플링 출력을 낸다.
    for (let t = 0; t <= recipe.durationMs; t += 100) {
      expect(sampleRecipe(loaded.recipe!, t)).toEqual(sampleRecipe(recipe, t))
    }
  })

  it('레시피 미저장 녹화는 recipe가 null이다 (미리보기가 다시 유도)', async () => {
    const folder = await makeRecording('a', 1000)
    const loaded = await loadRecording(folder)
    expect(loaded.recipe).toBeNull()
  })
})
