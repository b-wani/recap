# UI 결함 인벤토리 — 전체 플로우 점검 (#135)

> 맵 [지도: 배속 · 타이핑 줌 · UI 개편](https://github.com/b-wani/recap/issues/129)의 리서치 티켓. C2(UI 개편 방향/프로토타입)의 입력이 되는 **결함 목록**이다. 결정이 아니라 관찰이며, 우선순위는 C2에서 정한다.

## 방법 (재현 조건)

두 경로로 수집했다.

1. **라이브 구동 감사** — `e2e/inventory.spec.ts`(일회성 하네스). `electron-vite build` 산출물을 실제 Electron 으로 기동하고, 도달 가능한 화면을 순회하며 스크린샷 + 전역 오버플로우 DOM 감사(`scrollWidth − clientWidth > 1`, `overflow:hidden`=잘림 / `visible`=삐져나옴 / 뷰포트 가로 스크롤=파손)를 돌렸다.
   - 재현: `pnpm build && npx playwright test e2e/inventory.spec.ts` → 스크린샷 `test-results/inventory/`, 감사 로그는 stdout `[AUDIT]`.
   - 적대적 픽스처: 아주 긴 대상 제목, 좁은 창 폭(760px)을 일부러 주입 — 정상 픽스처로는 오버플로우가 드러나지 않는다.
   - 온보딩 권한 게이트는 main 의 `permissions:status` IPC 핸들러를 테스트에서 스텁해 통과시켰다(실제 권한 없이 2~7단계 도달).
2. **정적 분석** — 실제 캡처 플로에서만 전용 크기의 프레임리스 창으로 생성되는 표면(캡처 툴바·REC pill·선택 오버레이 3종)은 `openWindow` 로 강제 소환하면 기본 프레임(1180×760)으로 열려 레이아웃이 왜곡된다. 이 표면들과 export 완료/경고 상태는 라이브 대신 JSX+CSS 정적 분석으로 다뤘다(§5).

스크린샷 자산: `docs/research/ui-defect-inventory/shots/`.

## 화면 커버리지

| 플로우 | 화면 | 방법 | 스크린샷 |
|---|---|---|---|
| 온보딩 | Welcome 7단계 전부 | 라이브 | `shots/onb-01-permissions.png` 외 |
| 프리뷰/편집 | 에디터(정상·긴 제목·760px 좁은 창) | 라이브 | `shots/editor-*.png` |
| 익스포트 | export 팝오버(idle) | 라이브 | `shots/editor-export-popover.png` |
| 라이브러리 | 카드 그리드 | 라이브 | `shots/library-cards.png` |
| 녹화 | 캡처 툴바·REC pill·선택 오버레이(display/area/window) | 정적 | — (§5) |
| 익스포트 | export 완료/경고/오류 상태 | 정적 | — (§5) |

## 결함 목록

심각도: **High**(플로우 차단/명백한 파손) · **Med**(눈에 띄는 품질 저하·특정 입력에서 파손) · **Low**(미세·엣지) · **Info**(참고). 총 24건.

**상위(High) 4건 먼저:**
- **D-08** — 첫 export 성공 후 재내보내기 UI 영구 불가(`exportStatus` idle 리셋 없음). 경고 문구와 자기모순.
- **D-14** — 캡처 툴바 힌트가 520px pill 을 넘쳐 줄바꿈(단일 줄 pill 파손).
- **D-15** — REC pill 타임코드가 40px 폰트로 56px pill 에서 클립.
- **D-01** — 에디터 상단 바 대상 제목에 truncation 없음 → 좁은 폭/긴 제목에서 줄바꿈·버튼 밀림.

### A. 오버플로우 / 잘림

| ID | 심각도 | 화면 / 컴포넌트 | 관찰 | 근거 |
|---|---|---|---|---|
| **D-01** | Med | 에디터 상단 바 대상 제목 · `EditorView.tsx:282-285` (`.editor-bar-meta`) | 제목에 ellipsis/clamp/`min-width:0` 가 없다. 1200px 에선 긴 제목이 한 줄로 들어갔지만(`editor-long-title-1200.png`), 760px 에선 **2줄로 줄바꿈**되고 길이 구분자 `·`가 붕 뜬 채 `00:04` 앞에 남는다. 더 긴 제목/더 좁은 폭에선 녹화·익스포트 버튼을 밀 위험. | `editor-narrow-760.png`, `editor-bar-long-title.png` |
| **D-02** | Low | 에디터 `.control` 라벨(패딩·라운딩) | `scrollWidth`가 `clientWidth`를 2px 초과(sub-pixel spill). 육안 무해, 감사 신호로만 기록. | `[AUDIT] editor-*` |
| **D-03** | Low | 타임라인 `.tl-lane.tl-lane-clip` | 가로 4px 클립(`overflow:hidden`). 트랙 우측 미세 잘림. | `[AUDIT] editor-*` |

### B. 정렬 / 레이아웃

| ID | 심각도 | 화면 / 컴포넌트 | 관찰 | 근거 |
|---|---|---|---|---|
| **D-04** | Med | export 팝오버 · `.export-popover`(absolute, `index.css:214`, width 260px) | 팝오버가 사이드바 **배경 섹션 위를 덮어** 스타일 스와치가 팝오버 뒤로 가린다. 버튼 근처 오프셋이 아니라 사이드바 콘텐츠와 겹치는 위치. | `editor-export-popover.png` |
| **D-05** | Low | 에디터 좁은 창(≤820px) · narrow-window 미디어쿼리 `index.css:1272` | 사이드바가 캔버스 아래로 1열 스택된다(에디터 minWidth 720px 라 720~820px 밴드는 실제 도달 가능). 파손은 아니나 이 밴드에서 상단 바 제목 줄바꿈(D-01)과 겹쳐 정돈감이 떨어진다. | `editor-narrow-760.png` |
| **D-06** | Low | 라이브러리 카드 메타 · `LibraryView.tsx:167-170` | 메타 한 줄(`날짜 · 길이 · 이벤트 N개`)이 카드 폭에서 `이벤트` / `515개`로 어정쩡하게 줄바꿈. | `library-cards.png` |

### C. 플로우 갭 / 막다른 길

| ID | 심각도 | 화면 / 컴포넌트 | 관찰 | 근거 |
|---|---|---|---|---|
| **D-07** | Med | 에디터 상단 바 · `EditorView.tsx:280-317` | 에디터에 앱 내 **되돌아가기/닫기/라이브러리로** 어포던스가 없다. OS 창 크롬에만 의존. 라이브러리 ↔ 에디터 앱 내 내비게이션 없음. | 코드 |
| **D-08** | **High** | export 완료(done) · `ExportPanel.tsx:49-66`, `EditorView.tsx:59` | `exportStatus`를 `'idle'`로 되돌리는 코드 경로가 **없다**. 한 번 export 성공하면 done 상태(`Finder에서 열기`·`경로 복사`)가 고정되고, 팝오버를 닫았다 열어도 그대로 — **해상도/fps 셀렉터와 `GIF 내보내기` 버튼이 다시 나타나지 않는다.** 설정 바꿔 재내보내기가 에디터 재시작 전까지 불가. 게다가 초과 경고 문구는 "해상도/fps를 낮춰 다시 내보내기"(`LIMIT_LABEL:16`)라 안내하지만 그 컨트롤이 없어 **자기모순**. (참고: `error` 상태는 셀렉터+버튼이 남아 복구 가능.) | 코드 |
| **D-09** | Med | 온보딩 권한 단계 · `WelcomeView.tsx:140`, `arePermissionsSatisfied` | 두 권한 모두 granted 여야 `다음`이 열린다. 미허용 시 **건너뛰기/나중에** 어포던스가 없어, 유일한 탈출은 창 닫기(main 소유). | 코드 |
| **D-10** | Low | 에디터/오버레이 컨텍스트 로딩 · `App.tsx:49,56` | IPC 컨텍스트 도착 전 `<></>`(빈 화면) 렌더 — 로딩 상태 없음. 컨텍스트가 끝내 안 오면 영구 빈 창. | 코드 |
| **D-11** | Info | 알 수 없는 role · `App.tsx:67-72` `PlaceholderView` | 전용 화면 없는 role 은 raw JSON 덤프 화면(액션 없음). 정상 플로에선 도달 불가하나 dead-end. | 코드 |

### D. 일관성 / 중복 컨트롤

| ID | 심각도 | 화면 / 컴포넌트 | 관찰 | 근거 |
|---|---|---|---|---|
| **D-12** | Low | 온보딩 권한 카드 · `WelcomeView.tsx:207-211` | 이미 granted 인 권한도 `✓ 허용됨` 옆에 **비활성 `허용` 버튼**이 남아 보인다(중복·혼란). | `onb-01-permissions.png` |

### E. 참고 관찰 (Info)

- **D-13** — 라이브러리 카드 다수가 썸네일 없이 클래퍼보드 플레이스홀더로 표시(`library-cards.png`). UI 결함이라기보단 썸네일 생성 커버리지 갭 — C2 범위 밖일 수 있으나 시각적 완성도에 영향.

## 5. 정적 분석 — 녹화 표면 · export 상태 · dead CSS

라이브로 못 잡는 표면(캡처 툴바 `520×96`·REC pill `220×56`·프레임리스 오버레이)은 `src/main/index.ts`의 고정 창 크기(`TOOLBAR_SIZE` :545, `REC_PILL_SIZE` :589)와 CSS·JSX 를 대조해 분석했다. 픽셀 추정은 브라우저 실측이 아니라 고정 크기+토큰 계산이므로, 창 크기/해당 규칙이 바뀌지 않는 한 유효하다. 런타임 데이터 의존 항목은 그렇게 표기했다.

### 녹화 표면 — 오버플로우

| ID | 심각도 | 컴포넌트 | 관찰 | CSS |
|---|---|---|---|---|
| **D-14** | High | 캡처 툴바 힌트(display) · `ToolbarView.tsx:90` | `"녹화할 화면에서 Start recording 을 누르세요"`(~270px)가 모드 그룹+아이콘 버튼 2개를 뺀 ~120px 슬롯에 안 들어가 2~3줄로 줄바꿈 → 520×96 단일 줄 pill 파손. `window`/`area` 힌트(`:92`·`:94`)도 초과(→ Med). | `.toolbar-hint` `index.css:1364` (색/폰트만, `white-space`·shrink 없음) |
| **D-15** | High | REC pill 타임코드 · `RecPillView.tsx:25` | `.rec-time`가 `--text-xl`=**40px**(대형 녹화 화면과 공유 클래스). pill 콘텐츠 박스는 ~40px 높이·~172px 폭 — 점(12)+`00:00`(~120px)+정지 버튼이 안 맞아 가로 클립/버튼 밀림. | `.rec-time` `index.css:267-273`, `.rec-pill` `index.css:1418-1432` |
| **D-16** | Low | 경과 시간 포맷 · `format.ts:1-6` | `MM:SS`만 — 99분 초과 시 `100:00`(6글자)로 이미 빠듯한 pill 을 더 넓힘. 런타임 데이터 의존(장시간 녹화 한정). | — |
| **D-17** | Med | Area 크기 배지 · `AreaOverlayView.tsx:109` | 배지가 `.area-size-badge{top:-30px}`로 rect 위에 뜨는데 부모 `.area-overlay`는 `overflow:hidden` — rect 를 화면 상단(y≈0)에 그리면 배지가 뷰포트 밖으로 잘림. | `index.css:1642-1644` / `:1627` |
| **D-18** | Med | Area "녹화 시작" 버튼 · `AreaOverlayView.tsx:119` | 절대배치 `.area-start`(nowrap ~90px)에 `.area-rect` min-size 없음 — 작은 영역을 드래그하면 버튼이 선택 박스 밖으로 삐져나옴. | `index.css:1656-1661` |

### 녹화 표면 · 익스포트 — 플로우 갭

| ID | 심각도 | 컴포넌트 | 관찰 |
|---|---|---|---|
| **D-08**(재확인) | High | export done | 위 C 섹션 참조 — 정적 분석도 동일 결론(`done`에 재내보내기 없음 + `exportStatus` idle 리셋 경로 없음). |
| **D-19** | Med | export 인코딩 중 · `ExportPanel.tsx:33-47` | 진행바만 있고 **취소 컨트롤 없음**, 인코딩 중 팝오버 dismiss 불가(`EditorView.tsx:76`). 긴 GIF 인코딩을 중단 못 함. |
| **D-20** | Med | 윈도우 피커 오버레이 · `WindowPickerOverlayView.tsx:19-91` | `mousemove`/`onClick`만 등록 — **Esc 핸들러·✕ 취소 버튼 없음**(Area/툴바엔 있음). 이 창이 포커스를 쥐면 창-선택 모드를 창 안에서 취소할 길 없음(포커스 배선 의존). |

### 일관성 / 토큰 드리프트

| ID | 심각도 | 컴포넌트 | 관찰 |
|---|---|---|---|
| **D-21** | Med | 에디터 상단 바 · `EditorView.tsx:294`·`:298` | 레드 `.btn-record`("● 같은 대상 다시 녹화")가 화이트 `.btn-export-primary` 바로 옆 — **DESIGN.md:70 위반**("레드 버튼과 화이트 primary를 나란히 두지 않는다"). 라이브로도 확인됨(`editor-*.png`). |
| **D-22** | Low | export 경고/오류 `<p>` · `ExportPanel.tsx:56`·`:71` | `.export-warn`가 `<p>` 기본 margin 을 리셋 안 해 컨테이너 `gap` 대신 브라우저 기본 여백 — 간격 드리프트. | 
| **D-23** | Low | 여러 표면 | 하드코딩 색 `.display-overlay:hover{background:rgba(10,10,11,.3)}`(`index.css:1736`, DESIGN.md:120 위반), 스케일 밖 px(`.area-*` `border-radius:2px`, `.icon-btn` `34px`, `.tl-lane-label` `10px`). 토큰화 또는 예외 명시 필요. |

### Dead / orphaned CSS (렌더러 전체 `className` grep 결과 참조 없음)

| ID | 심각도 | 관찰 |
|---|---|---|
| **D-24** | Low(정리) | 아래 블록은 어떤 뷰도 렌더하지 않음 — 삭제 후보(동적/`dangerouslySetInnerHTML` 생성원 없음 확인 전제): `.recording`·`.rec-indicator`(`index.css:235`·`241`, 단 같은 블록의 `.rec-dot`/`.rec-time`은 pill 이 사용 중), `.recent*`(`:277-359`, 라이브러리로 대체됨), `.target-card*`(`:405-457`), `.picker*`(`:380-403`), `.empty-hint`(`:362-377`). |

## C2 로 넘기는 관점

- **오버플로우의 근본 원인은 "가변/고정 길이 텍스트 + 상자에 truncation 규약 부재"** — 대상 제목(D-01), 툴바 힌트(D-14), REC 타임코드(D-15), export 경고(D-22), 라이브러리 메타(D-06)가 같은 계열. 개편 시 **텍스트 truncation/줄바꿈 규약과 고정 크기 표면(pill·팝오버)의 콘텐츠 예산**을 디자인 시스템 레벨에서 한 번 정하는 게 개별 패치보다 낫다.
- **플로우 갭은 두 종류** — (a) export done 막다른 길(D-08)·인코딩 취소 없음(D-19)은 개편과 무관한 **명백한 기능 결함**이라 선행 수정 가능. (b) 창 간 내비게이션·로딩/빈/오류 상태(D-07·D-10·D-20)는 "각 창이 독립"이라는 현 구조의 부산물 — 개편에서 어디까지 앱 내로 끌어올지가 방향 결정 포인트.
- **DESIGN.md 위반(D-21: 레드 옆 화이트 primary)과 토큰 드리프트(D-23)** — 방금 적용한 모노크롬 시스템(커밋 69d579a)과 어긋난 지점. 개편의 정합성 기준점.
- **Dead CSS(D-24)** 정리는 개편 전 index.css(2016줄) 부피를 줄여 작업을 쉽게 함 — 개편 준비 작업으로 선행 권장.
- 세부 오버플로우(D-02·D-03·D-16·D-22)는 개편과 무관한 미세 항목이라 별도 처리 가능.

## 부록 — 재현 하네스

`e2e/inventory.spec.ts` 는 이 인벤토리의 라이브 증거를 재생성하는 일회성 하네스다(회귀 스위트 아님). 유지 부담이 되면 삭제해도 무방하나, C2/구현 단계에서 오버플로우 회귀를 자동 확인하는 씨앗으로 남겨둘 수 있다.
