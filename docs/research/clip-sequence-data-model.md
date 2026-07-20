# 클립 시퀀스 데이터 모델 설계 (#144)

ADR 0004(Screen Studio 완벽 모작)로 **컷/분할·속도 조절**이 목표 범위에 들어오면서, 현재
"단일 원본 + 파생 파라미터" 구조의 렌더 레시피를 **클립 시퀀스** 구조로 어떻게 전환할지 정한다.
이 문서는 웨이파인더 티켓 **③ 클립 시퀀스 데이터 모델 설계**의 산출물이며, 결과로 (a) 자료구조
형태, (b) 좌표계 재정의, (c) 샘플링 API 계층, (d) 마이그레이션 전략, (e) CONTEXT.md 용어 갱신
스펙을 낸다. 이 맵은 계획(결정) 맵이므로 **실제 코드·CONTEXT.md 변경은 후속 구현 effort**가 맡고,
이 문서는 그 구현이 따를 확정 스펙이다.

**코드 근거(로컬 리포)**: `src/shared/recipe.ts`(타입·유도·샘플링), `src/shared/recipe.edit.ts`
(경량 편집), `src/shared/recipe.persist.ts`(직렬화·검증), `CONTEXT.md`(도메인 용어).

## 문제 (한 문장)

오늘 `zoomSegments`·`cursor.keyframes`·`keystrokes.keys`·`trim`은 전부 **단일 source-시간**
좌표에 찍혀 있고 **출력 시간 == source 시간**이다. 컷(중간 구간 제거)과 속도(한 클립을 2×로 재생)는
이 등식을 깨므로, 데이터 모델이 그 단절을 어떻게 흡수할지 정해야 한다.

## 요약 (결론 먼저)

**채택: 클립 시퀀스 + source-시간 앵커링 + 얇은 output↔source 매핑 계층.**

```ts
interface RenderRecipe {
  source: FrameSize
  viewport?: FrameSize
  zoomScale: number
  durationMs: number          // source 총길이 (유지)
  clips: Clip[]               // 신규 — trim 대체
  zoomSegments: ZoomSegment[] // 그대로, source 시간에 앵커
  cursor: CursorTrack         // 그대로, source 시간
  keystrokes: KeystrokeTrack  // 그대로, source 시간
  background: BackgroundStyle // 불변
  badge: BadgeConfig          // 불변
  // trim: Trim  ← 필드 제거
}

interface Clip {
  id: string          // 안정적 식별자 (UI 선택·편집 대상)
  sourceStartMs: number
  sourceEndMs: number
  speed: number       // 재생 배율 (1 = 원속)
}
```

핵심을 가르는 단일 사실: **효과 계산(줌 이징·팬·커서 스무딩·클릭·키 오버레이)은 전부
source 시간을 입력으로 하는 순수 함수(`sampleComposition(recipe, sourceT)`)에 있다.** 따라서
클립 시퀀스는 그 함수를 건드리지 않고, 그 **위에** "출력 시간을 걸으면 source 시간으로 되돌려
주는" 매핑만 얹으면 된다. 재작성 없이 컷·속도를 얻는 가장 짧은 경로다.

## 결정 목록

### 1. 좌표계 — source-시간 유지 (재앵커링 안 함)

`zoomSegments`·`cursor`·`keystrokes`는 지금처럼 **source 시간에 고정**한다. 컷/속도는 별도
매핑 계층이 흡수한다.

- **대안(기각)**: 모든 앵커를 편집된 출력 시간으로 재앵커링. 컷/속도가 바뀔 때마다 zoom/cursor/key를
  재계산해야 하고, 검증된 순수 코어와 그 테스트를 전부 재작성해야 한다.
- **선택 근거**: 효과 로직이 이미 source 시간의 순수 함수라, 앵커를 그대로 두면 기존 유도·샘플링·
  편집·직렬화 로직과 테스트가 사실상 불변으로 남는다.

### 2. trim 흡수 — `trim` 필드 제거

`trim: {startMs, endMs}`은 "살아남는 source 구간"을 표현하는데, 클립 시퀀스도 같은 것을 표현한다
(양끝 클립 경계 = 앞/뒤 트림, 클립 사이 간극 = 컷). 두 곳에서 동시에 정의하면 모순(`trim`과 클립
경계 불일치)이 생기므로, **하나로 통일**한다.

- 신규 레시피 = 클립 1개 `[0, durationMs]`, speed 1.
- 앞트림 = `clips[0].sourceStartMs` 올림 / 뒤트림 = `clips[last].sourceEndMs` 내림.
- 컷 = 한 클립을 둘로 분할하고 사이 구간 제거(간극 생성).

### 3. 순서·겹침 — source 오름차순·비겹침·재정렬 불가

클립은 항상 `sourceStartMs` 오름차순이고 구간이 겹치지 않는다. **클립 재정렬(reorder)은
지원하지 않는다** — 컷/속도/트림만.

- **선택 근거**: 출력을 걸으면 source 시간이 **단조 증가** → output↔source 매핑이 piecewise-linear
  단조 → source-고정 zoom/cursor가 깔끔하게 대응(한 줌 구간이 출력에서 둘로 쪼개지거나 순서가
  뒤집히는 병리가 없다). Screen Studio 슬라이스 모델과도 정합.

### 4. 속도×모션 — 균일 적용 (source-시간 압축)

클립 speed는 그 구간의 **모든 것**(줌 램프·spring 이징·커서 이동·클릭·키 오버레이)을 함께
압축한다.

- 예: 클립 `[5000,8000]`(source 3s) @2× → 출력 1.5s. 줌 램프 500ms(source) → 250ms(출력),
  ④에서 정한 spring 0.5s → 0.25s.
- **선택 근거**: "이 구간을 빨리 감기"의 자연스러운 의미이고, source-앵커링이 공짜로 주는 동작
  (매핑이 source 시간을 speed배 빠르게 전진 → source 시간으로 샘플하는 모든 효과가 함께 압축).
  샘플러는 speed를 몰라도 된다. 모션만 출력 시간으로 유지하려면 샘플러가 클립 speed를 주입받아야
  해 source→sample 분리가 깨진다(기각).

### 5. 식별 — 클립마다 안정적 `id`

`zoomSegments`는 index로 주소하지만(통째로 삭제/이동/조절만 하므로 충분), 클립은 **split**이
시퀀스 중간에 새 클립을 끼워 이후 index를 전부 밀어낸다. 타임라인 UI가 "선택/속도편집 중인
클립"을 그 조작 너머로 안정 추적하려면 index로는 깨진다. 따라서 클립은 `id: string`으로 주소한다.

- 편집 연산: `splitClip(recipe, clipId, atMs)`, `deleteClip(recipe, clipId)`,
  `setClipSpeed(recipe, clipId, speed)`.

### 6. 샘플링 API — 얇은 output 계층 추가 (source-시간 core 불변)

`sampleComposition(recipe, sourceT)`는 source-시간 순수 core로 **그대로 둔다.** 그 위에 얇은
계층을 얹는다:

```ts
outputDurationMs(recipe): number
  // = Σ (clip.sourceEndMs - clip.sourceStartMs) / clip.speed

sourceAtOutput(recipe, outputMs): number
  // 출력 시간 → source 시간. 어느 클립인지 찾아 그 안에서 speed로 되돌린다.

sampleCompositionAtOutput(recipe, outputMs): FrameComposition
  // = sampleComposition(recipe, sourceAtOutput(recipe, outputMs))
```

- 플레이어(미리보기 스크러버)·익스포트만 **출력 시간을 걸도록** 전환하고 새 함수를 호출한다.
- 기존 source-시간 테스트(`recipe.sample.test`·`recipe.compose.test`)는 core가 불변이라 보존.
- **`sampleRecipe`의 `trim` 가드 제거**: 지금 `t < recipe.trim.startMs …`로 트림 밖을 neutral로
  되돌리는데, `trim`이 사라지고 매핑은 **항상 클립 안의 source 시간만** core에 넘기므로(간극은
  방문하지 않음) 이 가드는 불필요해진다. 클립 시퀀스가 유효 도메인을 정의한다.

### 7. 마이그레이션 — graceful 업그레이드, `formatVersion` 1 유지

persist 계층의 기존 철학(누락 필드를 기본값으로 채워 조용히 상향, 여러 추가 변경에도 버전 1 유지)을
그대로 따른다. 이번 변경은 `trim` 제거 + `clips` 추가지만, 구버전 파일이 그대로 열리므로 호환
= 버전 안 올림.

- `validateClips`(신규): `r.clips`가 있으면 검증. 없으면(구버전) `r.trim`(또는 없으면
  `[0, durationMs]`)에서 **클립 1개 합성** — `{ id, sourceStartMs, sourceEndMs, speed: 1 }`.
- `trim` 검증(`validateTrim`)은 제거하되, 구버전 로드용으로 `r.trim` 읽기는 위 합성 안에서만 남긴다.
- `RECIPE_FORMAT_VERSION`은 1 유지.

### 8. id 생성 — 결정적 파생 (max+1, 상태·난수 없음)

`recipe.edit.ts`와 validator는 전부 순수 함수다(난수·부수효과 금지). 새 클립 id는 **현재 클립들의
숫자 접미사 최댓값 + 1**로 파생한다(예: `c1`,`c2` 존재 → 새 클립 `c3`).

- recipe에 카운터 필드를 두지 않는다(모델 최소).
- 유일성은 **현재 클립 집합 내**에서만 보장하면 충분(UI 선택 식별 용도).
- validator의 합성 클립도 같은 규칙(첫 클립 `c1` 등).
- **대안(기각)**: 카운터 필드 저장(모델·persist 부담↑), 호출자 주입(순수하나 각 호출부가 id 책임·
  validator 합성 경로 애매), 내부 nanoid(순수성 위반).

### 9. 컷×줌 경계 — 줌 구간 불변, 매핑이 건너뜀

컷이 줌 구간 중간을 가로질러도 줌 구간은 손대지 않는다. 매핑이 제거된 source 범위를 방문하지
않으므로, 출력에서는 컷 경계에서 줌 상태가 이어진다(중간 생략된 램프/홀드는 사라지고, 경계에서
줌 상태 점프가 생길 수 있음).

- **선택 근거**: source-앵커링의 자연 결과이고 추가 편집 로직이 0이다. "컷 시 줌 구간도 잘라
  재조정"은 매끈하지만 편집 연산이 `zoomSegments`를 건드려야 해 source-고정 순수성 이점을 일부
  잃는다(필요하면 후속 effort로 미룸).

## 좌표계·매핑 정의 (구현 기준)

출력 시간 `outputMs`를 클립 순서대로 누적 소비해 source 시간으로 되돌린다.

```
acc = 0
for clip in clips (source 오름차순):
  clipOutLen = (clip.sourceEndMs - clip.sourceStartMs) / clip.speed
  if outputMs <= acc + clipOutLen:
    within = outputMs - acc
    return clip.sourceStartMs + within * clip.speed   // ← sourceT
  acc += clipOutLen
return 마지막 클립의 sourceEndMs                        // 끝 클램프
```

- `zoomSegments`/`cursor`/`keystrokes`는 이 `sourceT`로 기존 함수가 샘플 → 컷된 source 범위는
  자연히 제외, 속도는 자연히 압축.
- 스크러버/타임라인 길이·재생 위치는 전부 `outputDurationMs`·출력 시간 기준.

## 영향 범위

| 파일 | 변경 |
|------|------|
| `src/shared/recipe.ts` | `Clip` 타입·`clips` 필드 추가, `Trim`/`trim` 제거, `outputDurationMs`·`sourceAtOutput`·`sampleCompositionAtOutput` 추가, `sampleRecipe`의 trim 가드 제거, `deriveRecipe`가 clips 1개 초기화 |
| `src/shared/recipe.edit.ts` | `trimRecipe`→양끝 클립 경계 조정으로 대체, `splitClip`·`deleteClip`·`setClipSpeed` 신규, `trimmedDurationMs`→`outputDurationMs`로 대체 |
| `src/shared/recipe.persist.ts` | `validateClips` 신규(구버전 trim→클립 1개 합성), `validateTrim` 제거, `RECIPE_FORMAT_VERSION` 1 유지 |
| `CONTEXT.md` | 아래 "도메인 용어 갱신 스펙" 반영 |
| 플레이어·익스포트 호출부(`src/renderer/…`) | 출력 시간을 걸도록 전환, `sampleCompositionAtOutput`·`outputDurationMs` 사용 |

## 도메인 용어 갱신 스펙 (CONTEXT.md — 구현 effort가 반영)

- **신규: 클립 (Clip)** — 렌더 레시피가 최종 영상으로 남기는 원본의 한 조각. `[sourceStartMs,
  sourceEndMs]` 구간과 재생 속도 배율을 가진다. 컷/분할은 클립을 나누고, 속도 조절은 클립의
  배율을 바꾼다. _Avoid_: 슬라이스(내부 표현), 세그먼트(줌 구간과 혼동).
- **신규: 클립 시퀀스 (Clip Sequence)** — source 오름차순·비겹침으로 늘어선 클립들의 순서 목록.
  최종 영상의 출력 타임라인은 이 클립들을 이어 붙인 것이다. 클립 사이 간극이 컷(제거된 구간)이다.
- **갱신: 렌더 레시피** — 정의의 "트림 지점"을 "클립 시퀀스"로 교체("… 클립 시퀀스, 줌 구간 목록,
  배경/패딩 스타일, 커서 설정 …"). 트림은 이제 클립 시퀀스의 양끝 경계로 표현된다.
- **갱신: 경량 편집** — 컷 편집·속도 조절을 **더 이상 제외하지 않는다**(클립 시퀀스로 수용).
  자막은 계속 제외. "실수하면 재녹화" 문구는 트림·줌 범위를 넘어선 편집에 대한 한정으로 완화.

## 후속 effort로 미루는 튜닝 디테일 (모델 결정에 불필요)

- 허용 속도 배율 집합(`SPEED_DEFAULTS.speeds`, 예 0.5/1/1.5/2)과 스냅 규칙 — `ZOOM_DEFAULTS.scales`
  선례를 따름.
- 최소 클립 길이 클램프(`MIN_CLIP_MS`) — `MIN_TRIM_MS` 선례를 따름.
- 컷/분할 UI 제스처·타임라인 렌더링.
