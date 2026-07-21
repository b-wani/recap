# export 포맷·목적지 프리셋 구조 결정 (#146)

> 티켓: [#146](https://github.com/b-wani/recap/issues/146) · 맵: [#140](https://github.com/b-wani/recap/issues/140)
> 전제: 인코더 결정 [#141](https://github.com/b-wani/recap/issues/141)(WebCodecs+mediabunny, MP4/GIF 듀얼) · 인코더 조사 [#123](https://github.com/b-wani/recap/issues/123)(gifenc 유지)

## 결론 요약

1. **목적지 우선(X/Dooray) 모델 폐기 → 포맷 우선 패널.** Screen Studio 실측 export 패널을 정본으로 모작한다(스크린샷: `docs/research/screen-studio-samples/export/`). SS엔 "목적지" 개념이 없고 **포맷 토글 + 압축 품질 티어**다.
2. **recap 차별화 = Screen Studio 코어 + 최고품질 GIF.** GIF를 이류로 취급하는 SS·Recordly와 달리 recap은 **1080p / 50fps GIF**를 제공한다(Recordly는 720p/30fps로 자체 제한). 이것이 recap의 존재 이유.
3. **인코더는 그대로**: MP4=WebCodecs+mediabunny(#141), GIF=gifenc(#123). 네이티브 바이너리 0개 유지.
4. **품질 티어 = Screen Studio 4티어 문자 그대로**(`Studio / Social Media / Web / Web (Low)`).
5. **밴딩용 Bayer 디더 = 최상위 티어(Studio) 전용.** 전역 기본 아님(프로토타입 근거 아래 §4).

## 1. 패널 구조 (Screen Studio 실측 정본)

`docs/research/screen-studio-samples/export/ss-export-panel.png` 기준. 포맷 우선, 목적지 없음.

- **Export as**: `[MP4 | GIF]` 세그먼트 토글 (1차 축)
- **Frame rate**: 드롭다운
- **Output Size**: `[720p | 1080p | 4K]` 세그먼트 + 실시간 `W × H px` 실측 표기
- **Quality (Compression level)**: `[Studio | Social Media | Web | Web (Low)]` 세그먼트 + 선택별 설명문
- **액션**: `Export to file` · `Copy to clipboard` · `Cancel`
- **하단 추정치**: 예상 시간 + 최대 용량
- **진행 화면**: 전체화면 + `소스 → 목적경로` 알약 + `Exporting… N%` + 경과·잔여 + `Stop export`

## 2. 컨트롤별 스펙

### Export as
`ExportFormat = 'mp4' | 'gif'`. ADR 0003이 제거한 타입을 재도입.

### Frame rate
- **MP4**: `60 / 30 / 24`, 기본 **60**.
- **GIF**: `50 / 30 / 25 / 20 / 15`, 기본 **50**. ⚠️ **50fps가 GIF 포맷 천장** — 지연이 센티초 정수라 100/60=1.667cs는 표현 불가, **60fps GIF는 만들 수 없다**. 60fps가 필요하면 MP4.

### Output Size (+ 실시간 px)
- **MP4**: `720p / 1080p / 4K`. 원본 초과 옵션은 비활성(업스케일 금지, 현행 로직 유지).
- **GIF**: `720p / 1080p`. **4K GIF는 미제공** — 용량이 비현실적이고 "최고품질 GIF"와 자기모순(§4).

### Quality (Compression level) — 티어 매핑

**MP4** — WebCodecs QP 모드(#141). 해상도·fps와 독립("Quality setting does not impact export speed", SS와 동일).

| 티어 | H.264 QP(출발점) | 성격 |
|---|--:|---|
| Studio | ~18 | 최고화질, 재편집용. 압축 거의 안 보임 |
| Social Media | ~23 | 공유 균형 |
| Web | ~28 | 가벼움 |
| Web (Low) | ~32 | 최소 용량 |

**GIF** — QP 없음. #123이 "화질 레버=해상도·fps, 색축은 미묘"로 확정했으므로 티어는 **색 수 + 디더**에 매핑(UI 스켈레톤은 MP4와 동일 = SS 일관성).

| 티어 | 색 수 | 디더 | 성격 |
|---|--:|---|---|
| Studio | 256 | **Bayer ON** | 밴딩 없는 최고품질(용량↑) |
| Social Media | 256 | OFF | 현행 기본 화질 |
| Web | 128 | OFF | 가벼움 |
| Web (Low) | 64 | OFF | 최소 용량 |

> GIF 티어의 실효는 주로 최상위(Studio)의 디더에 몰린다 — GIF 포맷상 색축 이득이 작다는 게 #123 실측 결론이라 불가피.

### 액션
- **Export to file**: 저장 다이얼로그. IPC `saveExport(bytes, folder, format)`로 일반화(#141) — `export.gif`/`export.mp4`.
- **Copy to clipboard**: **실제 미디어를 클립보드로 복사**(SS 패리티, 현행 "경로 복사"에서 격상). Dooray 본문에 붙여넣기 워크플로의 핵심 — 신규 IPC 필요.
- **Cancel**.

### 사전 추정치 + Dooray 경고
- SS식 **예상 시간 + 최대 용량**을 export 전에 표시.
- GIF가 **Dooray 인라인 임계(≈25MB)** 초과 시 경고(현행 `DOORAY_GIF_PRESET.warnSizeBytes` 정책 유지) — SS 추정치 표시와 자연스럽게 결합.

### GIF 루프
**무한 루프 고정(토글 없음).** Dooray 본문 인라인 자동재생이 목적이므로 항상 루프. (Recordly는 토글을 두지만 우리 목적지엔 불필요.)

### 진행 화면
SS식 전체화면 진행 UI 모작(소스→목적 알약, %, 경과·잔여, Stop export). 현행 인라인 진행바 대체.

## 3. 제외 / 후속

- **Recordly 고유 컨트롤 제외**(SS 패널에 없음): 인코딩 강도 티어(Fast/Balanced/Quality), 파이프라인 선택(Legacy/Lightning), NVIDIA CUDA, 캡션 파일 export.
- **HEVC "더 작은 파일" 모드**: #141이 선택 모드로 남겼으나 SS 패널엔 없고 `isConfigSupported` 게이팅·Apple 밖 호환성 이슈 → **후속 안개**(맵 "Not yet specified").
- **종횡비(16:9/1:1/9:16) + 애니메이션 재프레이밍**: 이 티켓 밖 → **별도 티켓 승격**.

## 4. Bayer 디더 = Studio 전용 결정 근거 (프로토타입)

실제 recap 합성(slate 다크 그라디언트 `#2b2b30`→`#161618` @145° + 드롭 섀도 + 라이트 UI 그라디언트, 48프레임 애니)을 A(무디더) vs C(Bayer 8×8, 강도 8/16/28)로 인코딩. 몽타주: `docs/research/gif-encoder-samples/dither-ac-montage.png`.

| 변형 | Bayer 강도 | 크기 | vs A |
|---|--:|--:|--:|
| A (무디더, 현행) | 0 | 0.72 MB | 기준 |
| C-low | 8 | 1.86 MB | 2.6× |
| C-med | 16 | 2.94 MB | 4.1× |
| C-high | 28 | 4.32 MB | 6.0× |

- 디더 이득은 **어두운 데코레이션(배경·섀도 계단 윤곽)에 국한**, 실제 화면 콘텐츠(밝은 UI)엔 이득 거의 없음.
- **용량은 4배**(C-med) 폭증 — LZW 압축을 디더 노이즈가 깨뜨림. Dooray 인라인(25MB)과 정면충돌.
- C-high는 평면 색(바이올렛)에까지 노이즈 → 과함. 스윗스팟 C-med(s16).
- Bayer는 고정 패턴이라 정적 영역 프레임간 떨림(boiling) 없음.

→ **전역 기본은 A**, "밴딩 없는 최고품질"은 **Studio 티어의 명시적 선택**으로 제공(디더 s≈16).

## 5. 데이터 모델 (export-preset.ts 재구조화 방향)

- `ExportFormat = 'mp4' | 'gif'` 재도입.
- `QualityTier = 'studio' | 'social' | 'web' | 'web-low'`.
- GIF 단일 정책(`DOORAY_GIF_PRESET`·`resolveGifConfig`)을 **포맷별 정책 + 티어 매핑**으로 재구조화:
  - `resolveMp4Config(tier, size, fps, source)` → `{ codec, qp, width, height, fps }`
  - `resolveGifConfig(tier, size, fps, source)` → `{ maxColors, dither, width, height, delayCs }`
- 순수 TypeScript 유지(미리보기·export·테스트 공유).
- IPC: `saveExport(bytes, folder, format)` 일반화 + 클립보드 미디어 복사 IPC 신설.

## 6. 구현 참조 — Recordly

오픈소스 SS 대안 [Recordly](https://github.com/webadderallorg/Recordly)의 실제 구현이 우리 #141 결정(**WebCodecs + mediabunny + PixiJS/Canvas 재합성 WYSIWYG**)과 정확히 일치함을 확인. **동작·구현 방식 참조용**으로 유효(ADR 0002 원칙대로 코드 복사는 금지 — 라이선스 `NOASSERTION`이기도 함). UI/UX는 Screen Studio가 정본.

## 근거 자산

- Screen Studio 실측 패널: `docs/research/screen-studio-samples/export/{ss-export-panel,ss-export-progress}.png`
- 디더 A/C 프로토타입: `docs/research/gif-encoder-samples/dither-ac-montage.png` (+ `dither-ac/` 재현 하니스)
- 인코더 조사: `docs/research/gif-encoder-comparison.md` (#123)
- 인코더 결정: #141 `mp4-export-encoder-decision.md`
