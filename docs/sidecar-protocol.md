# 사이드카 프로토콜 (v4)

Swift 캡처 사이드카(`recap-capture`)와 Electron 본체 사이의 계약. [ADR 0001](./adr/0001-electron-with-swift-capture-sidecar.md)에 따라 사이드카는 "한 번 만들면 안 건드리는" 층이며, 이 계약은 그 경계를 명시적으로 고정한다. 효과 로직은 이 경계 어디에도 없다 — 사이드카는 **원본 영상 기록**과 **마우스·키 이벤트 스트리밍**만 한다. 키 오버레이 계산은 전부 순수 코어(`recipe.ts`)에서 하며, 사이드카는 정규화된 조합 문자열만 흘린다.

계약의 코드 표현:

- 본체(소비자): [`src/main/sidecar/protocol.ts`](../src/main/sidecar/protocol.ts) — 타입·파서·접기 함수, 계약 테스트(`protocol.test.ts`)로 검증.
- 사이드카(생산자): [`src/sidecar/Sources/recap-capture/Protocol.swift`](../src/sidecar/Sources/recap-capture/Protocol.swift).

두 구현은 아래 스키마를 공유하며, `protocolVersion`이 어긋나면 본체가 세션을 거부한다.

## 실행 · 전송

```
recap-capture list                                                  선택 가능한 캡처 대상 열거
recap-capture record --out <녹화 폴더> --target <id>                  해당 대상 녹화
recap-capture record --out <녹화 폴더> --target <id> --sourceRect x,y,w,h   Area(영역) 녹화
```

- **캡처 대상 선택**: 녹화 전 본체는 `list`로 사이드카를 한 번 띄워 선택지(전체 화면 디스플레이 + 열린 창)를 받고, 사용자가 고른 대상의 `id`를 `record --target <id>`로 넘긴다. `--target`이 없으면 주 디스플레이(전체 화면)로 시작한다.
- **Area(영역) 녹화 (v4)**: `--sourceRect x,y,w,h`(전역 AppKit 좌표·포인트, 좌하단 원점)를 함께 넘기면 디스플레이의 그 사각형만 녹화한다. crop은 대상 모델에 접혀(아래 `sourceRect` 참조) 다운스트림 좌표 계약을 바꾸지 않는다. `w,h`가 양수가 아니거나 형식이 어긋나면 사이드카는 `exit 64`로 거부한다.
- **본체 → 사이드카**: `record` 세션 중 명령을 사이드카 **stdin**에 한 줄씩 쓴다.
  - `stop` — 녹화 정지. 사이드카는 원본 파일을 마무리하고 `stopped`를 보낸 뒤 종료한다.
  - stdin이 닫히거나 `SIGTERM`을 받아도 정지로 간주한다 (조용히 죽지 않는다).
- **사이드카 → 본체**: **stdout**에 newline-delimited JSON(JSONL). 한 줄에 메시지 하나.
  - stdout은 이벤트 스트림 전용이다. 로그·경고는 stderr로만 나간다.

## 캡처 대상 (`CaptureTarget`)

`targets`·`ready` 메시지가 싣는 대상 기술. 효과가 아니라 "무엇을 캡처하는가"의 메타데이터다.

| 필드 | 타입 | 설명 |
|---|---|---|
| `kind` | `"display" \| "window"` | 전체 화면 또는 개별 창. **Area(영역)도 `display`로 표현**하고 `sourceRect`로 구분한다 (kind 유니언을 넓히지 않는다) |
| `id` | string | 사이드카에 넘기는 식별자. `display:<displayID>` 또는 `window:<windowID>` |
| `title` | string | 사람이 읽는 이름 (디스플레이명 또는 "앱 — 창 제목") |
| `width`, `height` | number | 대상의 논리 크기(포인트). **이벤트 좌표가 놓이는 좌표 공간의 경계**. Area면 crop 크기 |
| `frame` | `{x,y,width,height}`? | **(v4) `window`만.** 창의 전역 프레임(AppKit 좌하단 원점, 포인트). Window 선택 오버레이가 커서 아래 창을 그리는 데 쓴다. 이벤트 좌표 계약과 무관하다 |
| `sourceRect` | `{x,y,width,height}`? | **(v4) Area만.** 요청한 crop 사각형(전역 AppKit 좌표·포인트). 있으면 이 대상은 Area 캡처이며, `origin`이 crop 좌상단·`width/height`가 crop 크기로 접혀 있다. display/window는 없다 |

**좌표 접기(v4 Area)**: crop을 기존 대상 모델에 접는다 — `ready.target`의 `width/height`=crop 크기(포인트), 내부 `origin`=crop 전역 좌상단(포인트), `*Px`=크기×scaleFactor. 그래서 이벤트 좌표 계약(좌상단 원점·포인트·`[0,w]×[0,h]`)이 **display/window/Area에서 완전히 동일**하다. `sourceRect`는 crop이었음을 알리는 메타데이터일 뿐이다.

## 메시지 (사이드카 → 본체)

`list` 세션은 `targets` 하나만 내보내고 종료한다. `record` 세션은 항상 `ready`로 시작해 `stopped`로 끝난다. 실패 시 `error` 하나만 나오고 종료한다.

### `targets`

`list`의 응답 — 선택 가능한 캡처 대상 목록. `list` 세션의 유일한 메시지.

| 필드 | 타입 | 설명 |
|---|---|---|
| `type` | `"targets"` | |
| `protocolVersion` | number | 계약 버전 (현재 `4`) |
| `targets` | `CaptureTarget[]` | 전체 화면 + 선택 가능한 창 목록 |

예시 (v4 — 창 대상이 전역 `frame`을 싣는다):

```json
{"type":"targets","protocolVersion":4,"targets":[
  {"kind":"display","id":"display:1","title":"내장 Retina 디스플레이","width":1440,"height":900},
  {"kind":"window","id":"window:47","title":"Safari — GitHub","width":1200,"height":800,"frame":{"x":100,"y":80,"width":1200,"height":800}}
]}
```

### `ready`

준비 완료, 원본 기록 시작. `record` 스트림의 첫 메시지.

| 필드 | 타입 | 설명 |
|---|---|---|
| `type` | `"ready"` | |
| `protocolVersion` | number | 계약 버전 (현재 `4`) |
| `rawVideoPath` | string | 원본 영상이 기록될 절대 경로 |
| `startedAt` | number | 녹화 시작 시점 (Unix epoch ms). 이후 `event.t`의 기준점 |
| `target` | `CaptureTarget` | 실제로 캡처 중인 대상. 이후 `event.x/y`가 이 대상의 좌표계 기준 |

예시 (v4 — Area 녹화. crop이 `display` 대상에 접혀 `sourceRect`로 표시된다):

```json
{"type":"ready","protocolVersion":4,"rawVideoPath":"/…/raw.mp4","startedAt":1751879700000,
 "target":{"kind":"display","id":"display:1","title":"영역 (820×540)","width":820,"height":540,
           "sourceRect":{"x":500,"y":300,"width":820,"height":540}}}
```

이후 `event.x/y`는 crop 좌상단이 원점(포인트)이라 `[0,820]×[0,540]` 안에 놓인다 — display/window와 동일한 계약이다.

### `event`

마우스 이벤트 하나 — 이벤트 트랙의 원소. 스크롤·호버는 기록하지 않는다.

| 필드 | 타입 | 설명 |
|---|---|---|
| `type` | `"event"` | |
| `kind` | `"move" \| "down" \| "up"` | |
| `t` | number | `startedAt`으로부터 경과 시간 (ms) |
| `x`, `y` | number | **캡처 대상 좌표계** 위치 (대상의 좌상단이 원점, 포인트). 창 녹화면 창 기준이라 자동 줌이 클릭 지점을 정확히 확대한다 |
| `cursor` | `"arrow" \| "pointer" \| "ibeam"` | 커서 모양 (스켈레톤은 `arrow` 고정) |

### `key`

키 입력 하나 — 키 오버레이의 입력. 마우스 `event`와 **분리된** 스트림이며, `eventCount` 대조에 포함되지 않는다.

| 필드 | 타입 | 설명 |
|---|---|---|
| `type` | `"key"` | |
| `t` | number | `startedAt`으로부터 경과 시간 (ms) |
| `combo` | string | 정규화된 조합 문자열 (예: `"⌘S"`, `"⌥⌘I"`, `"Enter"`) |

**프라이버시 경계**: 수식키(⌘⌥⇧⌃) 조합과 특수키(Enter/Tab/Esc/화살표/Delete 등)만 캡처한다. 수식키 없는 일반 타이핑 문자(비밀번호·커밋 메시지 본문 등)는 **캡처하지 않는다** — `events.json`에도 남지 않는다. 키 입력은 자동 줌을 트리거하지 않는다(마우스 클릭만).

### `stopped`

정상 종료, 원본 파일 기록 완료. 스트림의 마지막 메시지.

| 필드 | 타입 | 설명 |
|---|---|---|
| `type` | `"stopped"` | |
| `rawVideoPath` | string | 원본 영상 최종 경로 (`ready`와 동일) |
| `durationMs` | number | 녹화 길이 (ms) |
| `eventCount` | number | 스트리밍한 **마우스** 이벤트 총 개수 (본체 집계와 대조). 키 이벤트는 세지 않는다 |

### `error`

복구 불가능한 오류. 녹화는 조용히 실패하지 않는다.

| 필드 | 타입 | 설명 |
|---|---|---|
| `type` | `"error"` | |
| `code` | `"permission-denied" \| "no-display" \| "capture-failed" \| "target-not-found"` | `target-not-found`는 `--target`으로 지정한 창/디스플레이가 사라졌을 때 |
| `message` | string | 사람이 읽을 설명 |

## 본체의 소비 방식

본체는 스트림 전체를 접어(`foldSidecarMessages`) 두 산출물로 **분리**한다:

- **녹화 참조** `{ rawVideoPath, startedAt, durationMs, target }` — 원본 영상 파일과 녹화된 대상을 가리킨다.
- **이벤트 트랙** `{ protocolVersion, startedAt, durationMs, target, samples[], keys[] }` — `events.json`으로 원본과 분리 저장되며, 자동 효과(줌 구간) 유도의 입력이 된다. `target`은 좌표 공간의 경계를 알려 자동 줌의 클램핑에 쓰인다. `keys[]`는 키 오버레이의 입력으로 마우스 `samples[]`와 분리된다(줌 유도에는 쓰이지 않는다).

`error`가 있으면 접기는 실패 결과를 반환하고, 본체는 사용자에게 안내를 표시한다.
