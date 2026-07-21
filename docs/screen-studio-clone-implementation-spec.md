# Screen Studio 모작 — 구현 effort 핸드오프 스펙

> 웨이파인더 맵 [지도: Screen Studio 완벽 모작](https://github.com/b-wani/recap/issues/140)의 **destination 산출물**.
> 맵에서 확정된 6개 결정을 구현 effort로 넘길 단일 스펙으로 취합한다. 각 결정의 1차 근거는 해당 티켓·근거 문서 링크에 있으며, 이 문서는 **인덱스 + 상호 의존 + 구현 순서 + 잔여 미결정**을 담는다.
>
> - 상위 방향: **ADR 0004** (Screen Studio 모작을 목표로) — 정본.
> - 용어: 루트 [CONTEXT.md](../CONTEXT.md).
> - 이 문서는 **계획(결정)까지**. 실제 코드 변경은 후속 구현 effort가 수행한다.
> - ⚠️ 이 문서가 링크하는 근거 문서 일부(`mp4-export-encoder-decision.md`, `clip-sequence-data-model.md`, `export-format-preset-structure.md`, ADR 0004)는 각 결정 티켓의 PR 브랜치에서 생성됐다. 병합 순서에 따라 main에 아직 없을 수 있으니, 없으면 해당 PR에서 확인한다.

## 구현 순서 (= 맵 blocking 체인)

```
② MP4 출력 복원  →  ④ 모션 품질  →  ① 앱 크롬 리스킨  →  ③ 컷/속도(데이터 모델 수술)
```

- **② 먼저**: 픽셀 비교를 원화질(MP4)로 해야 정확하고, ④ 모션 품질 검증의 전제다.
- **④ 다음**: 줌·커서 모션이 이후 크롬·타임라인 UI가 표현할 대상을 확정한다.
- **① 그다음**: 팔레트·레일·타임라인 크롬은 ③ 데이터 모델과 연동되는 부분(컷·속도 트랙)을 제외하면 독립적으로 진행 가능.
- **③ 마지막**: `trim` 제거 → `clips[]` 데이터 모델 수술은 가장 침습적이라, 렌더·export가 안정된 뒤 수행.

⑤ 커서 후편집은 ④(Spring 이징 재사용)에 의존하므로 ④ 이후, 커서 컨트롤은 ① 크롬 사이드바에 얹힌다.

---

## ① 앱 크롬 픽셀 모작 — 하이브리드 리스킨

**티켓**: [① 앱 크롬 픽셀 모작 스펙·전략](https://github.com/b-wani/recap/issues/143) · 근거 에셋: [에디터 크롬 프로토타입](https://claude.ai/code/artifact/e3873dae-c75e-4d93-98df-85031c31b6e8)

**전략 = 하이브리드**. 전면 교체 불필요 — 레이아웃 골격이 이미 Screen Studio와 정합([screen-studio-alignment-audit.md](./research/screen-studio-alignment-audit.md)), 스타일은 `src/renderer/src/index.css` 단일 파일(2016줄)에 `:root` 토큰으로 중앙집중, 색 하드코딩 사실상 0.

### 1) 토큰/CSS 점진 리스킨 (`:root` diff)

| 토큰 | 현행 | 신규 | 비고 |
|---|---|---|---|
| `--bg` | `#0a0a0b` | `#08080B` | 무채색 골격 유지, 살짝 더 검게 |
| `--surface` | — | `#141519` | 사이드바·바 (스포이드) |
| `--primary`(→`--accent`) | `#f5f5f7` 화이트 | **`#6C4DF5` 바이올렛** | Export·primary 버튼·선택/활성 신호·슬라이더 채움. rename 후 값 교체 |
| `--accent-bright` | — | `#8B5CF6` | hover |
| `--clip` (신규) | — | `#C89B3C` 골드 / 필 `~#5E4514` | Clip 트랙 |
| `--zoom` | `#55555a` 뉴트럴 | **`#5B45F0` 바이올렛** | Zoom 트랙 |
| `--rec` | `#FF453A` | `#FF453A` | **성역 — 불변** |

- 모노크롬(#115) 규칙은 ADR 0004대로 보류. REC 레드만 성역, 나머지는 무채색+바이올렛+골드로 재정의.
- 컴포넌트 JSX·className은 거의 불변(인라인 스타일 12건 전부 동적 위치/크기값).
- 정밀 hex는 구현 시 실물 스포이드로 미세조정.

### 2) 신규 구축 (토큰 교체로 안 되는 국소 영역)

- **에디터 세로 아이콘 레일**: 캔버스↔우측 사이드바 사이 신설(선택도구·커서·카메라·캡션·단축키; 오디오는 범위 밖 비활성). `EditorView.tsx:264-378`을 `1fr rail side` 3열로 재편(현행 2열+top-bar). 우측 사이드바 배치(#58) 유지, 레일이 사이드바 섹션 전환.
- **권한 화면 본문(#47)**: `OnboardingStepBody.tsx:12-14` permissions 단계 본문 비어 있음 → 신규 작성.

### 3) 표면별 크롬 (동일 토큰 시스템)

- **타이틀바**: 트래픽라이트·폴더·휴지통·중앙 파일명·Undo/Redo·Presets·사이드바토글·품질게이지·바이올렛 Export.
- **하단 컨트롤 바**: `Wide 16:9 ▾`+Crop / 재생 컨트롤 / 컷(가위)+타임라인 줌 슬라이더. (aspect·crop·cut 인터랙션은 ③과 연동 — ①은 크롬만.)
- **타임라인**: 골드 Clip 트랙(파형·`7s ⏱1x`) + 바이올렛 Zoom 트랙(`2x 🔒Auto`) + 골드 트림 버블 + 바이올렛 재생헤드.
- **온보딩/권한·녹화 바·윈도우 선택**: 같은 토큰으로 리스킨.

---

## ② MP4 export 인코더 — WebCodecs + mediabunny

**티켓**: [② MP4 export 방식·인코더 결정](https://github.com/b-wani/recap/issues/141) · 근거: `docs/research/mp4-export-encoder-decision.md`(PR #145)

**선택을 가른 단일 사실**: export는 캡처 원본을 재인코딩하는 게 아니라, 렌더러 Canvas 2D로 효과를 매 프레임 **재합성한 캔버스**를 인코딩한다(`compose.ts`/`recipe.ts`, 미리보기와 공유 경로). 프레임이 이미 렌더러 캔버스에 있으므로 인프로세스 WebCodecs가 최단 경로.

- **채택**: WebCodecs `VideoEncoder` + mediabunny(`CanvasSource`→`Mp4OutputFormat`). macOS WebCodecs는 Apple **VideoToolbox** HW 인코딩 → Screen Studio(AVFoundation)와 **같은 OS 코덱** → 동화질이 구조적으로 성립. mediabunny는 MPL-2.0·0-deps·수 kB.
- **기본 인코더**: `avc1.640033`(H.264 High L5.1), `bitrateMode: quantizer`, `latencyMode: quality`, `hardwareAcceleration: prefer-hardware`, `avc.format: avc`. `isConfigSupported`로 게이팅.
- **HEVC**(`hvc1.*`)는 선택적 소파일 모드 → 잔여 미결정 참조.
- **탈락**: 네이티브 Swift AVFoundation 사이드카(IPC 경계 중복, 4K BGRA ≈2GB/s), ffmpeg.wasm(4K60 부적합), 네이티브 ffmpeg(GPL+H.264 특허 노출·70MB 번들).
- **아키텍처**: GIF 경로와 대칭 — 합성 완전 재사용, 인코더만 분기(`renderRecipeToMp4`). `export:save` IPC를 포맷 인자 받도록 일반화(현재 `export.gif` 하드코딩). `ExportFormat` 재도입(구체 UI는 export 프리셋 참조).
- **fps·해상도 선택 = export 시점** (캡처는 Retina 2x·60fps 최대화질 고정). 맵 안개 "녹화 vs export 시점" 해소.

---

## ③ 클립 시퀀스 데이터 모델 — clips[] + source-시간 앵커링

**티켓**: [③ 클립 시퀀스 데이터 모델 설계](https://github.com/b-wani/recap/issues/144) · 근거: `docs/research/clip-sequence-data-model.md`(PR #147)

효과 계산이 이미 source 시간의 순수 함수(`sampleComposition(recipe, sourceT)`)라, 클립 시퀀스를 그 **위에** 얹고 얇은 output↔source 매핑만 추가 → 재작성 없이 컷·속도를 얻는다.

```ts
interface RenderRecipe { …; durationMs; clips: Clip[]; zoomSegments; cursor; keystrokes; …  /* trim 제거 */ }
interface Clip { id: string; sourceStartMs: number; sourceEndMs: number; speed: number }
```

**9개 결정**:
1. **좌표계** — zoom/cursor/keystrokes는 source 시간에 그대로 앵커(재앵커링 안 함).
2. **trim 흡수** — `trim` 필드 제거. 앞/뒤 트림 = 양끝 클립 경계, 컷 = 분할+간극.
3. **순서** — 클립 source 오름차순·비겹침·재정렬 불가 → 매핑 piecewise-linear 단조.
4. **속도** — 균일 압축. 2× 클립은 그 안의 줌/spring/커서가 모두 source-시간째로 압축.
5. **식별** — 클립마다 안정적 `id`. `splitClip`/`deleteClip`/`setClipSpeed`가 id로 주소.
6. **API** — `sampleComposition(recipe, sourceT)` core 불변. 신규 `outputDurationMs`·`sourceAtOutput`·`sampleCompositionAtOutput`. 플레이어·export만 output 시간 전환. `sampleRecipe` trim 가드 제거.
7. **마이그레이션** — graceful, `formatVersion` 1 유지. 구버전 trim→클립 1개 합성.
8. **id 생성** — 결정적 `max(숫자접미사)+1`, 상태·난수 없음.
9. **컷×줌** — 줌 구간 불변, 매핑이 제거된 source 범위를 건너뜀(경계 줌 점프 허용).

**후속 구현 튜닝 상수**: 허용 속도 배율 집합(`SPEED_DEFAULTS`)·최소 클립 길이 클램프, 컷/분할 UI. CONTEXT.md 용어 갱신도 구현 effort가 반영.

---

## ④ 줌·커서 모션 품질 — Spring 이징 + 모션 블러

**티켓**: [④ 줌·커서 모션 품질 스펙](https://github.com/b-wani/recap/issues/142) · 근거: [모션 비교 프로토타입](https://claude.ai/code/artifact/3e51e7d2-a77d-4e10-876e-ebefd26adb13) (실물 대조, 육안 판정)

1. **이징 = Spring (Slow 프리셋)** — tension **120** · friction **26** · mass **1** → 감쇠비 **1.19(과감쇠)**, 오버슈트 없음, 엄밀 안착 ≈1160ms.
   - smoothstep(대칭 ease-in-out)보다 spring 과감쇠가 실물의 "안착하듯 멈추는" 느낌을 잘 잡는다. 실물엔 뚜렷한 오버슈트 없음.
   - **캘리브레이션**: 과감쇠라 초반 대부분 도달·꼬리만 느림 → 체감 도착이 관찰치 ≈0.5s에 오도록 미세조정 여지(tension 소폭↑) 열어 둠.
   - spring 채택 = **고정 duration 폐기**. 현행 `rampInMs`/`rampOutMs`(각 500ms 고정)를 spring 안착 기반으로 대체.
2. **모션 블러 = 도입, 셔터각 ≈2×** — 줌인/아웃·패닝 전환에 방향성(줌은 방사형) 블러. 정지(hold) 구간엔 0. 현행 `recipe.ts` 미구현 → 신규. 렌더 파이프라인 구현 방식·강도 곡선은 구현 effort가 확정(프로토타입은 2D Canvas 서브프레임 누적 근사).
3. **Hold push-in = 도입 안 함** — 현행 정적 hold(`sampleRecipe` hold 구간 `scale = seg.scale` 고정) 유지. 변경 없음.

---

## ⑤ 커서 후편집 — 구현 커서 컨트롤 4종 (최종 목록)

**티켓**: [⑤ 커서 후편집 스펙](https://github.com/b-wani/recap/issues/150) · [SS 커서 7개 컨트롤 분류](https://github.com/b-wani/recap/issues/153) · 근거: `docs/research/screen-studio-samples/cursor/` 실물 2장 (출처 https://screen.studio/guide/cursor)

구현할 커서 컨트롤은 **총 4종**. 모두 `CursorTrack` 필드.

| 컨트롤 | 데이터 | 기본값 | 스펙 |
|---|---|---|---|
| **크기 후조정** | `CursorTrack.size`(기존 `number` 재사용, 이산→연속) | 1.0x | 이산 프리셋 `[1,1.5,2]` → **연속 슬라이더 + Reset**. 범위 0.5~2.0x·step 0.1x·Reset→1.0x. |
| **유휴 자동 숨김** | `CursorTrack.hideWhenIdle`(신규) | **OFF** | SS식 단순 토글. 내부 고정 상수: 유휴 임계 1500ms(이동 <2px), 페이드아웃 400ms ease-out, 페이드인 150ms. |
| **루프 초기위치 복귀** | `CursorTrack.loopReturn`(신규) | **ON** | 출력 마지막 800ms 동안 시작 위치(t=0 좌표)로 보간. 이징 = **④ Spring(Slow) 재사용**. recap 차별화 축(루프 GIF)이라 기본 ON. |
| **커서 완전 숨김** | `CursorTrack.hidden`(신규) | **OFF** | `drawCursor` 진입 직전 `if (track.hidden) return`. SS 패널 최상단. |

### 명시적 스코프 아웃 (SS 커서 패널 나머지 6개 — 잔여 미결정 아님)

- **Cursor type Touch** — macOS 무음 데모 코어 밖.
- **Always use default system cursor** — moot. recap `drawCursor`는 이미 항상 단일 arrow만 렌더.
- **Rotate cursor while moving** — 스타일 폴리시 → 모작 완성 후 차별화 effort(ADR 0004).
- **Stop cursor movement at end** — ⑤ `loopReturn` + ③ 트림이 흡수.
- **Remove cursor shakes** — 기존 `CursorTrack.smoothingMs`가 커버.
- **Optimize original cursor types** — moot(타입별 비트맵 렌더 없음).

---

## export 포맷·프리셋 구조 (②/GIF 공통 UI)

**티켓**: [export 포맷·목적지 프리셋 구조](https://github.com/b-wani/recap/issues/146) · 근거: `docs/research/export-format-preset-structure.md`(PR #148)

1. **목적지 우선(X/Dooray) 폐기 → 포맷 우선 패널** (Screen Studio 실측 모작, `docs/research/screen-studio-samples/export/`): 포맷 토글 + Output Size + Frame rate + Quality(압축 티어).
2. **recap 차별화 = SS 코어 + 최고품질 GIF**: **1080p / 50fps GIF**. ⚠️ 50fps가 GIF 포맷 천장(60fps는 MP4 전용).
3. **품질 티어 = SS 4티어 문자 그대로**: `Studio / Social Media / Web / Web (Low)`. MP4=QP(18/23/28/32), GIF=색 수+디더(Studio 256+디더 → Web(Low) 64색).
4. **Bayer 디더 = Studio 티어 전용** — A/C 프로토타입: 이득은 어두운 데코에 국소, 용량 4배(LZW 파괴). 몽타주 `docs/research/gif-encoder-samples/dither-ac-montage.png`.
5. **인코더 유지**: MP4 WebCodecs+mediabunny(②/#141), GIF gifenc(#123). 네이티브 바이너리 0개.
6. **부수**: Copy to clipboard = 실제 미디어 복사로 격상(Dooray 붙여넣기 핵심). 사전 추정치 + Dooray 25MB 경고 유지, 전체화면 진행 화면 SS 모작. GIF 무한 루프 고정.
7. **재구조화**: `ExportFormat` 재도입 + `export-preset.ts`를 포맷별 정책+티어 매핑으로.

---

## 잔여 미결정 (구현 착수 전 판단 불필요, 후속 티켓화)

- **HEVC "더 작은 파일" 모드**: ②가 선택 모드로 남기고 export 프리셋 결정이 Screen Studio export 패널 밖임을 확인. `isConfigSupported` 게이팅·Apple 밖 재생 호환성 필요. **최고품질 GIF/MP4 스펙이 안정된 뒤 필요시 티켓화** — 구현 착수를 막지 않음.

## 명시적 스코프 아웃 (이 모작 effort 밖)

- **오디오**(마이크·시스템 오디오·클릭 사운드), **웹캠 PIP**, **자동 자막**, **iPhone/iPad 미러링** — 무음 코어 한정(ADR 0004).
- **키입력 트리거 줌**(타이핑 줌) — Screen Studio에 없음. 자동 줌 트리거는 클릭뿐.
- **4K GIF** — 용량 비현실적·"최고품질 GIF"(1080p+50fps로 달성)와 자기모순. GIF는 1080p 상한.
- **종횡비 전환·자동 재프레이밍(16:9/1:1/9:16)** — [#149](https://github.com/b-wani/recap/issues/149) 참조. recap 목적지=Dooray 가로형 데모, 세로/정사각은 차별화 축과 무관. 16:9 고정.
- **모노크롬 디자인 재적용** — 모작 완성 후 별도 재디자인 단계.

---

## 근거 문서·티켓 인덱스

| 결정 | 티켓 | 근거 문서/에셋 |
|---|---|---|
| ① 앱 크롬 리스킨 | [#143](https://github.com/b-wani/recap/issues/143) | [크롬 프로토타입](https://claude.ai/code/artifact/e3873dae-c75e-4d93-98df-85031c31b6e8), [alignment-audit](./research/screen-studio-alignment-audit.md) |
| ② MP4 인코더 | [#141](https://github.com/b-wani/recap/issues/141) | `research/mp4-export-encoder-decision.md`(PR #145) |
| ③ 클립 시퀀스 | [#144](https://github.com/b-wani/recap/issues/144) | `research/clip-sequence-data-model.md`(PR #147) |
| ④ 모션 품질 | [#142](https://github.com/b-wani/recap/issues/142) | [모션 프로토타입](https://claude.ai/code/artifact/3e51e7d2-a77d-4e10-876e-ebefd26adb13) |
| ⑤ 커서 후편집 | [#150](https://github.com/b-wani/recap/issues/150) · [#153](https://github.com/b-wani/recap/issues/153) | `research/screen-studio-samples/cursor/` |
| export 프리셋 | [#146](https://github.com/b-wani/recap/issues/146) | `research/export-format-preset-structure.md`(PR #148) |
| 상위 방향 | — | ADR 0004 (Screen Studio 모작 목표) |
