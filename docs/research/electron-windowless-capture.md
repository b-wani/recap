# Electron 창 없는 캡처 UX 기술 조사 (#53)

Screen Studio식 캡처 UX(플로팅 툴바·전체 화면 오버레이·창 하이라이트·영역 드래그·메뉴바 상주)를
Electron(macOS)에서 구현할 수 있는지 조사한 결과다. 결론부터: **성립한다.** Screen Studio 자체가
Electron 앱이고([BuildWith](https://buildwith.app/apps/screenstudio),
[개발자 블로그](https://pietrasiak.com/)), Kap(Electron)이 오버레이·크로퍼·독 전환을 모두
구현해 놓았다([wulkano/Kap](https://github.com/wulkano/Kap)). 단, 항목 3(창 하이라이트)은
Electron 단독으로는 불가하고 사이드카 프로토콜 확장이 필요하다.

## 판정 요약

| # | 항목 | 판정 | 핵심 수단 |
|---|------|------|-----------|
| 1 | 플로팅 캡처 툴바 | **가능** | frameless + `setAlwaysOnTop(true, 'screen-saver')` + `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })` |
| 2 | 투명 전체 화면 오버레이 + 부분 클릭스루 | **가능** | `transparent: true` + `setIgnoreMouseEvents(true, { forward: true })` + CSS `pointer-events` 토글 |
| 3 | Window 선택 시 대상 창 하이라이트 | **우회 경로** | 사이드카 `SCWindow.frame` → 프로토콜 확장(현재 `CaptureTarget`에 프레임 없음) + Electron 오버레이 창 |
| 4 | Area 드래그 선택 + 전역 좌표 | **가능** | 디스플레이당 오버레이 창(Kap 방식) + `screen` 모듈 DIP 좌표 |
| 5 | 메뉴바 상주 + Dock 숨김/표시 | **가능(함정 있음)** | `app.dock.hide()/show()` — 이미 Recap에 구현됨. 알려진 상호작용 버그 다수 |
| 6 | 권한·멀티 디스플레이·성능 | **관리 가능** | 오버레이 창 자체는 무권한. 창 목록·프레임은 화면 녹화 권한, 전역 입력은 손쉬운 사용(둘 다 온보딩에 이미 존재) |

---

## 1. 플로팅 캡처 툴바 — 가능

frameless(`frame: false`) + 투명 배경 창에 다음 조합으로 Screen Studio식 툴바가 성립한다.

```ts
toolbar.setAlwaysOnTop(true, 'screen-saver')            // 풀스크린 앱 위까지
toolbar.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })  // 모든 Space + 풀스크린 Space
```

- `'screen-saver'` 레벨은 NSWindow 레벨 중 시스템 창 직전의 최상위로, 다른 앱의
  풀스크린/프레젠테이션 모드 위에도 표시된다
  ([BrowserWindow docs](https://www.electronjs.org/docs/latest/api/browser-window),
  [electron#10078](https://github.com/electron/electron/issues/10078)).
- `visibleOnFullScreen: true`는 macOS 네이티브 풀스크린 Space에서도 창이 사라지지 않게 한다.
  창 자체에 `fullscreen: true`·`fullscreenable`을 주면 `canJoinAllSpaces` 동작과 충돌하므로 피한다.
- Kap의 크로퍼도 정확히 이 조합이다: `cropper.setAlwaysOnTop(true, 'screen-saver', 1)`
  ([Kap main/windows/cropper.ts](https://github.com/wulkano/Kap/blob/main/main/windows/cropper.ts)).

**NSPanel이 필요한가?** 표시 자체에는 불필요하다. NSPanel(non-activating)이 필요한 경우는
"툴바를 클릭해도 아래 앱의 포커스를 뺏지 않아야 할 때"뿐이다. Electron은 macOS에서
`type: 'panel'`을 지원하지만(ElectronNSPanel — 런타임에 `NSWindowStyleMaskNonactivatingPanel`을
붙이는 방식, [PR #34388](https://github.com/electron/electron/pull/34388)) 알려진 제약이 있다:

- Sonoma 이전엔 `focus()`가 앱 전체를 활성화하는 버그가 있었고 패널 한정으로 수정됨
  ([PR #40307](https://github.com/electron/electron/pull/40307)).
- `hide()` 시 배경의 다른 창이 딸려 올라오는 문제
  ([#35483](https://github.com/electron/electron/issues/35483)),
  nonactivating styleMask 관련 크래시/경고 이력
  ([#35815](https://github.com/electron/electron/issues/35815),
  [#31538](https://github.com/electron/electron/issues/31538)).

**권고**: 툴바는 일반 frameless 창 + `focusable: false`(입력이 필요 없다면)로 시작하고,
"포커스 안 뺏는 입력"이 정말 필요해질 때만 `type: 'panel'`을 검토한다.

## 2. 투명 전체 화면 오버레이(딤 + 중앙 배지) — 가능

`{ frame: false, transparent: true, hasShadow: false, enableLargerThanScreen: true }` 창을
디스플레이 bounds에 맞춰 띄우고, 렌더러에서 반투명 검정 배경 + 중앙 배지를 그리면 된다.

부분 클릭스루는 `setIgnoreMouseEvents`의 `forward` 옵션으로 제어한다
([Custom Window Interactions](https://www.electronjs.org/docs/latest/tutorial/custom-window-interactions)):

```ts
win.setIgnoreMouseEvents(true, { forward: true })
```

- `forward: true`면 클릭은 아래 창으로 통과시키되 mousemove는 렌더러로 전달돼
  `mouseenter`/`mouseleave`를 받을 수 있다(macOS·Windows 지원).
- 표준 패턴: 배지 위에 커서가 오면(`mouseenter`) `setIgnoreMouseEvents(false)`로 복원,
  벗어나면(`mouseleave`) 다시 클릭스루로. CSS는 `body { pointer-events: none }` +
  상호작용 요소만 `pointer-events: all`.
- 주의: `forward`는 창 단위 토글이라 "영역별 클릭스루"는 위 mouseenter/leave 왕복으로
  구현해야 하고, 렌더러↔메인 IPC 왕복이 한 프레임 늦을 수 있다(체감상 문제 없는 수준,
  Kap·다수 오버레이 앱이 동일 패턴).

## 3. Window 선택 시 대상 창 하이라이트 — 우회 경로 (사이드카 확장 필요)

다른 앱 창 "위에" 직접 그릴 수는 없고, **대상 창의 프레임을 알아낸 뒤 그 위치에 투명
오버레이 창(테두리만 렌더)을 띄우는** 방식이 표준이다. 문제는 프레임 획득이다.

- Electron의 `desktopCapturer`는 창 id·이름·썸네일만 주고 **화면상 좌표(frame)를 주지 않는다**.
- ScreenCaptureKit의 `SCShareableContent` → `SCWindow.frame`(CGRect)이 정답이다
  ([SCShareableContent docs](https://developer.apple.com/documentation/screencapturekit/scshareablecontent),
  [Capturing screen content in macOS](https://developer.apple.com/documentation/ScreenCaptureKit/capturing-screen-content-in-macos)).
  Recap 사이드카는 이미 `list` 모드에서 SCShareableContent를 조회하므로 자연스러운 확장점이다.
- **현재 계약의 공백**: `CaptureTarget`(src/main/sidecar/protocol.ts, `SIDECAR_PROTOCOL_VERSION = 3`)은
  `kind/id/title/width/height`만 나르고 **x/y 프레임이 없다**. 하이라이트를 하려면 targets 메시지에
  창 프레임(전역 좌표)과 소속 디스플레이를 추가하는 프로토콜 v4 확장이 필요하다.
- **좌표계 함정**: `SCWindow.frame`은 상단-좌측 원점(flipped) 좌표로 온다는 보고가 있다 —
  AppKit의 하단-좌측 원점 `NSScreen.frame`과 다르므로 변환에 주의
  ([Transform SCWindow coordinate](https://blog.eusoftbank.com/en/2024/10/transform-scwindow-coordinate/),
  [Apple Forums](https://developer.apple.com/forums/thread/750965)). Electron `screen` 모듈의
  DIP 좌표(상단-좌측 원점)와는 오히려 방향이 같아, 사이드카에서 포인트 단위 top-left 기준으로
  정규화해 보내면 Electron 쪽 변환이 최소화된다.
- 하이라이트 갱신(대상 창이 움직일 때 따라가기)은 폴링(SCShareableContent 재조회) 또는
  선택 순간 1회 스냅샷으로 시작하는 것이 현실적이다. 실시간 추적은 손쉬운 사용 권한 기반
  AX API가 필요해 비용이 크다 — 선택 UI 단계에서는 정적 프레임으로 충분하다.

대안으로 렌더러에서 `desktopCapturer` 썸네일 그리드로 창을 고르는 방식(현재 Recap 런처와 동일
계열)은 오버레이 없이 성립하지만, "화면 위에서 직접 고르는" Screen Studio UX는 위 우회 경로가 필요하다.

## 4. Area 드래그 선택 오버레이 + 전역 좌표 — 가능

Kap이 그대로 실증한다: **디스플레이마다 그 bounds를 덮는 투명 창을 하나씩** 띄우고
(`screen.getAllDisplays()` → `new BrowserWindow({ x, y, width, height, transparent, frame: false, enableLargerThanScreen: true })`),
렌더러에서 드래그 사각형을 그린 뒤 `창 로컬 좌표 + display.bounds 원점`으로 전역 좌표를 얻는다
([Kap cropper.ts](https://github.com/wulkano/Kap/blob/main/main/windows/cropper.ts),
[Kap renderer/components/cropper](https://github.com/wulkano/Kap/tree/main/renderer/components/cropper)).

- **좌표계**: Electron `screen` 모듈은 DIP(device-independent pixel)를 쓴다
  ([screen docs](https://www.electronjs.org/docs/latest/api/screen)). macOS에서 DIP는 곧
  포인트라서, 사이드카(ScreenCaptureKit도 포인트 기준 콘텐츠 rect + `scaleFactor`)와 단위가
  일치한다 — Retina 배율은 각 `Display.scaleFactor`로 픽셀 환산만 하면 된다. Windows처럼
  디스플레이별 DPI 섞임 문제가 macOS에서는 없다.
- **멀티 디스플레이**: 드래그가 시작된 디스플레이의 오버레이만 활성(active)으로 두고 나머지는
  딤 처리(Kap의 `activeDisplayId` 패턴). `display-added`/`display-removed` 이벤트에서 오버레이를
  다시 세팅해야 한다(Kap은 변경 시 전부 닫는다).
- **디스플레이 id 매핑 함정**: Electron `Display.id`가 CGDirectDisplayID와 일치한다고 보장되지
  않으므로, 사이드카 display 대상과 매칭할 땐 id 대신 bounds(원점+크기) 매칭이 안전하다.
- 선택된 rect는 사이드카에 "display 대상 + 포인트 단위 crop rect"로 넘긴다 —
  ScreenCaptureKit은 `SCStreamConfiguration.sourceRect`로 영역 캡처를 지원한다.
  (사이드카 record 명령의 인자 확장 = 프로토콜 v4 범위.)

## 5. 메뉴바 상주 + Dock 숨김/표시 — 가능, 함정 다수

Recap은 이미 구현했다(src/main/index.ts — 창 hide 시 `app.dock.hide()`, showLauncher 시
`app.dock.show()`, 트레이 상주). 패키징 시 `LSUIElement`(Info.plist)로 시작부터 숨길 수도 있다.
알려진 함정:

- `setVisibleOnAllWorkspaces(true)`가 `app.dock.hide()`를 방해한다
  ([#25368](https://github.com/electron/electron/issues/25368)) — **오버레이/툴바 창(항목 1·2·4)과
  Dock 전환을 병행할 때 순서에 주의**: dock.hide 먼저, 그 다음 워크스페이스 설정.
- `app.hide()`와 `app.dock.hide()`는 함께 쓰면 깨진다
  ([#16093](https://github.com/electron/electron/issues/16093)).
- Dock을 숨기면 ⌘Tab 앱 전환기에서 사라진다
  ([#6283](https://github.com/electron/electron/issues/6283)) — 메뉴바 앱의 의도된 트레이드오프.
- 일부 창 조작은 Dock이 보여야 정상 동작해서 Kap은 `ensureDockIsShowing(action)` 헬퍼로
  "잠깐 보였다 다시 숨기기"를 감쌌다([Kap main/utils/dock.ts](https://github.com/wulkano/Kap/blob/main/main/utils/dock.ts)) —
  같은 유틸을 두는 것을 권장.
- 시작 시 `dock.hide()` 호출은 아이콘이 깜빡인다([#3498](https://github.com/electron/electron/issues/3498)) —
  근본 해결은 패키징 후 `LSUIElement: true`.

## 6. 권한·멀티 디스플레이·성능 상호작용

**권한** — 온보딩(#47)이 이미 다루는 두 권한으로 충분하다:

| 기능 | 필요 권한 |
|------|-----------|
| 오버레이·툴바 창 표시 자체 | 없음 |
| 창 목록·제목·프레임 (SCShareableContent / desktopCapturer) | 화면 녹화 |
| 캡처(사이드카 record) | 화면 녹화 (TCC 책임 프로세스는 Electron — 기존 주석대로) |
| 전역 마우스/키 이벤트 스트림 (사이드카 CGEventTap) | 손쉬운 사용 |
| 오버레이 창 안에서의 드래그 선택 | 없음 (자기 창의 DOM 이벤트) |

즉 Area 드래그 자체는 무권한으로 시작할 수 있고, Window 하이라이트는 화면 녹화 권한이
먼저 필요하다(어차피 녹화 전 필수라 UX 순서만 맞추면 된다).

**녹화에 오버레이가 찍히는 문제** — display 캡처 중 툴바·카운트다운 배지가 결과 영상에
들어가면 안 된다. 두 가지 경로:

1. Electron `win.setContentProtection(true)` — macOS에서 `NSWindowSharingNone`을 설정해
   해당 창이 화면 캡처에서 제외된다([BrowserWindow docs](https://www.electronjs.org/docs/latest/api/browser-window)).
   가장 간단하고 사이드카 변경이 없다.
2. 사이드카에서 `SCContentFilter`의 `excludingWindows`로 Electron 창들을 제외 — 창 id 전달이
   필요해 결합이 늘어난다. 1안 우선.

**성능** — 투명 전체 화면 창은 GPU 합성 비용이 있다. 디스플레이 수만큼 BrowserWindow가 뜨므로
(각각 렌더러 프로세스) 선택 UI가 열려 있는 동안만 생성하고 닫을 때 destroy한다(Kap과 동일).
딤/테두리 렌더는 CSS만으로 충분하며 캡처 프레임 경로(사이드카)와 완전히 분리돼 녹화 성능에
영향이 없다. `setIgnoreMouseEvents(forward)`는 mousemove를 렌더러로 계속 흘리므로 오버레이
렌더러에서 무거운 작업을 하지 않는다.

---

## Recap 구조에의 함의 (사이드카 vs Electron 역할 분담)

ADR 0001의 경계("사이드카 = 원본 기록 + 이벤트 스트림, 효과 로직 없음")는 그대로 유지된다.
창 없는 캡처 UX는 전부 **Electron 본체의 창 계층** 문제이고, 사이드카에는 "메타데이터 확장"만 필요하다:

| 역할 | 담당 |
|------|------|
| 플로팅 툴바·딤 오버레이·드래그 선택 UI·하이라이트 테두리 렌더 | Electron (새 BrowserWindow 계층: 디스플레이당 오버레이 + 툴바 패널) |
| 창/디스플레이 목록 + **프레임(전역 포인트 좌표)** | 사이드카 `list` — **프로토콜 v4: `CaptureTarget`에 `frame {x,y}` 및 디스플레이 소속 추가** |
| 영역 캡처 (crop rect) | 사이드카 `record` — v4: `--rect` 인자 + `SCStreamConfiguration.sourceRect` |
| 오버레이의 녹화 제외 | Electron `setContentProtection(true)` (사이드카 무변경) |
| 권한 게이트 | 기존 온보딩 그대로 (화면 녹화 + 손쉬운 사용) |

단계적 도입 순서 제안: (a) 툴바+딤 오버레이(권한·프로토콜 무변경) → (b) Area 드래그
(프로토콜 v4: rect 캡처) → (c) Window 하이라이트(프로토콜 v4: 창 프레임).

## 근거 링크 모음

- Electron 공식: [BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window) ·
  [screen](https://www.electronjs.org/docs/latest/api/screen) ·
  [Custom Window Interactions (클릭스루)](https://www.electronjs.org/docs/latest/tutorial/custom-window-interactions) ·
  [BaseWindow options (type: panel)](https://www.electronjs.org/docs/latest/api/structures/base-window-options)
- Electron 이슈/PR: [#10078 풀스크린 위 alwaysOnTop](https://github.com/electron/electron/issues/10078) ·
  [#34388 panel 지원](https://github.com/electron/electron/pull/34388) ·
  [#40307 panel focus 수정](https://github.com/electron/electron/pull/40307) ·
  [#35815 nonactivating styleMask](https://github.com/electron/electron/issues/35815) ·
  [#25368 visibleOnAllWorkspaces vs dock.hide](https://github.com/electron/electron/issues/25368) ·
  [#16093 app.hide vs dock.hide](https://github.com/electron/electron/issues/16093) ·
  [#6283 dock 숨김 시 ⌘Tab 제외](https://github.com/electron/electron/issues/6283) ·
  [#3498 시작 시 dock 깜빡임](https://github.com/electron/electron/issues/3498)
- ScreenCaptureKit: [SCShareableContent](https://developer.apple.com/documentation/screencapturekit/scshareablecontent) ·
  [Capturing screen content in macOS](https://developer.apple.com/documentation/ScreenCaptureKit/capturing-screen-content-in-macos) ·
  [SCWindow.frame 좌표계 분석](https://blog.eusoftbank.com/en/2024/10/transform-scwindow-coordinate/)
- 유사 앱: [Kap cropper.ts](https://github.com/wulkano/Kap/blob/main/main/windows/cropper.ts) ·
  [Kap dock.ts](https://github.com/wulkano/Kap/blob/main/main/utils/dock.ts) ·
  [Screen Studio는 Electron](https://buildwith.app/apps/screenstudio) ·
  [Cap (Tauri, 참고)](https://github.com/CapSoftware/Cap)
