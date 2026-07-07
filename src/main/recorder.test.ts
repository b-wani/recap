import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readFile, writeFile, rm, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Recorder } from './recorder'

/**
 * 동시 사이드카 스폰 회귀 테스트.
 *
 * 사이드카(list)가 동시에 2개 뜨면 replayd 경합으로 한쪽이 응답 없이 매달린다
 * (React StrictMode 이중 마운트가 dev에서 이걸 항상 유발했다). 본체는 동시
 * listTargets 호출을 사이드카 프로세스 하나로 합쳐야 한다.
 */

const TARGETS_LINE = JSON.stringify({
  type: 'targets',
  protocolVersion: 3,
  targets: [{ kind: 'display', id: 'display:1', title: '전체 화면', width: 100, height: 100 }]
})

let dir: string
let fakeSidecar: string
let spawnLog: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'recorder-test-'))
  fakeSidecar = join(dir, 'fake-sidecar.sh')
  spawnLog = join(dir, 'spawns.log')
  // 스폰될 때마다 로그에 한 줄 남기고, 잠깐 있다가 targets 한 줄을 내보내는 가짜 사이드카.
  await writeFile(
    fakeSidecar,
    `#!/bin/sh\necho spawn >> "${spawnLog}"\nsleep 0.2\necho '${TARGETS_LINE}'\n`,
    'utf8'
  )
  await chmod(fakeSidecar, 0o755)
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function spawnCount(): Promise<number> {
  const log = await readFile(spawnLog, 'utf8').catch(() => '')
  return log.split('\n').filter(Boolean).length
}

describe('Recorder.listTargets', () => {
  it('대상 목록을 반환한다', async () => {
    const recorder = new Recorder(fakeSidecar)
    const targets = await recorder.listTargets()
    expect(targets).toHaveLength(1)
    expect(targets[0].id).toBe('display:1')
  })

  it('동시 호출이 사이드카를 하나만 띄우고 같은 결과를 공유한다', async () => {
    const recorder = new Recorder(fakeSidecar)
    const [a, b] = await Promise.all([recorder.listTargets(), recorder.listTargets()])
    expect(a).toEqual(b)
    expect(await spawnCount()).toBe(1)
  })

  it('완료된 뒤의 재호출은 새로 조회한다 (창 목록은 변한다)', async () => {
    const recorder = new Recorder(fakeSidecar)
    await recorder.listTargets()
    await recorder.listTargets()
    expect(await spawnCount()).toBe(2)
  })
})
