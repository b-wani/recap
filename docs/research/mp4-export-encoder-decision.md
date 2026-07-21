# MP4 export 인코더·아키텍처 결정 (#141)

ADR 0004(Screen Studio 완벽 모작)로 export가 MP4·GIF 듀얼로 복원되면서, ADR 0003이
제거한 MP4 경로를 **어떤 방식으로 되살릴지** 정한다. 품질 상한은 Screen Studio 동등 이상
(최대 4K 60fps). 이 문서는 웨이파인더 티켓 **② MP4 export 방식·인코더 결정**의 산출물이며,
결과로 (a) export 인코딩 아키텍처 스펙과 (b) 목적지 프리셋(MP4/GIF) 방향을 낸다.

**1차 소스**: MDN(WebCodecs/VideoEncoder), W3C WebCodecs AVC·HEVC 코덱 등록 사양,
Chromium 릴리스 노트, mediabunny 공식 문서·GitHub, ffmpeg.wasm 공식 성능 문서,
x264/FFmpeg 라이선스 문서. 코드 근거는 로컬 리포(`src/sidecar/`, `src/renderer/src/`).

## 요약 (결론 먼저)

**채택: WebCodecs `VideoEncoder` + `mediabunny`(캔버스 소스·mp4 muxer) 재도입.**
기본 H.264(`avc1.640033`, High L5.1), HEVC는 선택적 "더 작은 파일" 모드.

결정을 가르는 단일 사실: **export는 캡처 원본(`raw.mp4`)을 재인코딩하는 게 아니라, 렌더러에서
Canvas 2D로 효과(줌·커서·배경/패딩·배지)를 매 프레임 재합성한 캔버스를 인코딩한다**
(`src/renderer/src/compose.ts` `drawComposition` + `src/shared/recipe.ts` `sampleComposition`,
미리보기와 export가 같은 합성 경로를 공유). 따라서 인코더는 "합성된 캔버스 프레임"을 입력으로
받아야 하고, 프레임이 이미 렌더러 안 캔버스에 있으므로 **인프로세스 WebCodecs가 가장 짧은 경로**다.

| 후보 | 프레임 입력 | 4K60 성능·화질 | 번들/유지보수 | 라이선스/배포 | 판정 |
|------|-----------|--------------|--------------|--------------|:----:|
| **WebCodecs + mediabunny** | 캔버스 직결(`CanvasSource`) | HW(VideoToolbox) 원속·원화질 | +1 dep, MPL-2.0, 0-deps, ~수 kB | OS 코덱 사용(자체 인코더 미배포) | **채택** |
| 네이티브 Swift AVFoundation 사이드카 | 렌더러→main→Swift 프레임 전송 | 동일 VideoToolbox | 두 번째 코드베이스·IPC 프레임 경계 | 문제 없음 | 탈락(중복) |
| ffmpeg.wasm | 캔버스→wasm 메모리 | 네이티브의 4~8% 속도, 2GB 메모리 벽 | 대형 wasm, COOP/COEP 필요 | 문제 없음 | 탈락(성능) |
| 네이티브 ffmpeg 사이드카(libx264) | 렌더러→ffmpeg stdin | 네이티브 속도 | +70MB급 바이너리 | GPL + MPEG-LA H.264 특허 노출 | 탈락(라이선스/무게) |
| mediabunny 재도입 | = 채택안 | = 채택안 | = 채택안 | = 채택안 | (채택안과 동일) |

> 후보의 "mediabunny 재도입"과 "WebCodecs + muxer"는 사실상 같은 선택이다 — 현대 mediabunny는
> WebCodecs 인코딩과 mp4 muxing을 함께 감싸는 라이브러리이기 때문(§2·§3). ADR 0003이 제거한
> 그 `mediabunny`를, 통합·개선된 현재 형태로 되살리는 것이 채택안이다.

## 후보별 근거

### ① WebCodecs `VideoEncoder` (채택 코어)

- **안정·기본 노출**: WebCodecs는 Chrome 94(2021-09)부터 stable. Electron 33.4 = Chromium 130으로
  `VideoEncoder`는 렌더러 전역에 플래그 없이 노출된다. `[MDN WebCodecs API / VideoEncoder,
  Chrome Platform Status]`
- **macOS 하드웨어 인코딩 = VideoToolbox**: Chromium은 macOS에서 H.264/HEVC 인코드를 Apple
  VideoToolbox로 라우팅한다. 즉 **Screen Studio가 쓰는 AVFoundation과 같은 OS 코덱** — 같은
  코덱을 같은 설정으로 돌리므로 "동등 이상" 화질이 구조적으로 성립한다(느낌이 아니라 코덱 동일).
  최근 Chrome은 macOS per-frame QP(≥135)와 Apple Silicon HEVC 인코드 상한 확대(8192×4352@120fps)를
  더했다. `[MDN Codec selection, StaZhu/enable-chromium-hevc-hardware-decoding]`
- **4K60 한계**: 4K60은 Apple Silicon VideoToolbox 하드웨어 상한 안. 단 칩·OS별로 상한이 달라
  **반드시 `VideoEncoder.isConfigSupported(config)`로 사전 게이팅**하고 미지원 시 소프트웨어 폴백/
  하향한다. `[MDN Codec selection]`
- **코덱 문자열은 완전 지정 필수**: H.264 `avc1.<6 hex>`(예 High L5.1 = `avc1.640033`),
  HEVC `hvc1.*`/`hev1.*`. `"h264"` 같은 축약은 불가. `[W3C WebCodecs AVC/HEVC 등록 사양]`

### ② muxing — mediabunny (채택 wrapper)

- WebCodecs는 `EncodedVideoChunk`만 내보내고 컨테이너(mp4)는 직접 mux해야 한다.
- `mp4-muxer`/`webm-muxer`(Vanilagy)는 **deprecated**, 공식적으로 mediabunny로 통합·대체됐다
  (문서 명시). `[mp4-muxer docs / migration guide, mediabunny introduction]`
- **mediabunny**: mux+demux, WebCodecs 인코드/디코드 래핑, `Input`(읽기)·`Output`+`Mp4OutputFormat`+
  `BufferTarget`(쓰기)·`Conversion`(변환), 비디오 소스로 **`CanvasSource`** 제공 — 캔버스를 그대로
  소스로 먹인다. Electron 렌더러에서는 브라우저 WebCodecs 경로를 그대로 쓴다. **MPL-2.0,
  의존성 0, 순수 TS, 트리셰이킹으로 수 kB 수준.** `[mediabunny introduction / GitHub]`
- 채택안이 캔버스 소스를 그대로 먹일 수 있어 글루 코드가 최소이고, 나중에 기존 mp4를 읽어
  트림/재인코딩(`Input`/`Conversion`)하는 확장 여지도 같은 라이브러리 안에 있다.

### ③ 네이티브 Swift AVFoundation 사이드카 — 탈락(중복)

- 앱엔 이미 캡처용 Swift 사이드카(`src/sidecar/Sources/recap-capture/ScreenRecorder.swift`,
  ScreenCaptureKit + `AVAssetWriter` H.264 60fps)가 있어 **같은 VideoToolbox**에 닿는다.
- 그러나 export 효과는 렌더러 캔버스에서 합성되므로, 사이드카로 인코딩하려면 합성 프레임을
  렌더러→main→Swift로 전송해야 한다. 4K BGRA는 프레임당 ≈33MB, 60fps면 ≈2GB/s — 실용적이지 않고,
  아니면 합성 로직 자체를 Swift/Metal로 이중 구현해야 한다. Chromium이 인프로세스로 이미 노출한
  것을 두 번째 코드베이스·IPC 경계로 대체하는 셈이라 탈락. (ProRes 등 WebCodecs가 표현 못 하는
  포맷이나 렌더러와 완전히 분리된 인코딩이 필요할 때만 재검토.)

### ④ ffmpeg.wasm — 탈락(성능)

- 공식 문서가 "네이티브만큼 빠르지 않다"고 명시. 자체 벤치(WebM→MP4)에서 싱글스레드 ≈128.8s vs
  네이티브 5.2s(~4%), 멀티스레드 ≈60.4s(~8%). 4K60 인터랙티브 export엔 부적합. `[ffmpeg.wasm Performance]`
- WASM 선형 메모리 상한(~2GB 실용/4GB 이론)에 4K 프레임 버퍼가 부딪혀 상한 아래서도 OOM 가능.
  `[ffmpeg.wasm Discussion #755]`
- 멀티스레드 코어는 `SharedArrayBuffer`→COOP/COEP 헤더 필요(배포 제약). `[ffmpeg.wasm 문서]`

### ⑤ 네이티브 ffmpeg 사이드카(libx264) — 탈락(라이선스/무게)

- 속도는 충분하나, libx264는 GPL이고 **소프트웨어 라이선스와 별개로 H.264 특허가 MPEG-LA 풀에
  묶여** 배포 제품에 특허 라이선스 취득 의무가 생길 수 있다. GPL 경로는 소스 공개/특허 그랜트
  의무도 유발. 70MB급 바이너리 번들도 부담. `[x264.org Licensing, FFmpeg commercial license guide]`
- 대조적으로 **WebCodecs는 OS(VideoToolbox) 코덱을 쓰므로 자체 H.264 인코더를 배포하지 않는다**
  — GPL·MPEG-LA 노출을 원천 회피. 이것이 네이티브 ffmpeg 대비 채택안의 결정적 이점.

## 채택 아키텍처 스펙

GIF 경로와 대칭 구조로 둔다 — 합성은 완전히 재사용하고 인코더만 분기한다.

1. **프레임 합성(공유)**: 기존 `sampleComposition`(효과 계산) + `drawComposition`(그리기)를 그대로
   쓴다. `compose.ts`는 이미 `OffscreenCanvasRenderingContext2D`를 지원하므로 export는
   OffscreenCanvas에 원본 좌표계로 그린다(미리보기와 동일 합성 — "보이는 것 = 내보내는 것" 유지).
2. **인코딩 층 분기**: `renderer/src/export.ts`의 `renderRecipeToGif`와 대칭으로
   `renderRecipeToMp4`(가칭)를 둔다. 프레임마다 합성 캔버스를 mediabunny `CanvasSource`로 밀어
   `Output`(`Mp4OutputFormat`, `BufferTarget`)에서 `ArrayBuffer`를 회수한다. GIF의 gifenc 자리에
   mediabunny가 들어가는 형태.
3. **저장(기존 IPC 일반화)**: 현재 main 핸들러(`export:save`, `src/main/index.ts`)가 출력 경로를
   `export.gif`로 하드코딩한다. 포맷/확장자를 받도록 일반화해 `export.mp4`도 같은 경로로 저장한다
   (`window.recap.saveExport(bytes, folder, format)` 형태). 클립보드 파일 참조·완료 알림은 공용.
4. **포맷 차원 재도입**: ADR 0003이 지운 `ExportFormat`을 되살려야 한다 — 다만 **구체적 UI·프리셋
   구조는 이 티켓이 아니라 후속 "export 포맷·목적지 프리셋" 티켓의 몫**(아래 후속 참조).

### 기본 인코더 설정(권고 출발점)

`[MDN VideoEncoder.configure / W3C 등록 사양]` 근거:

- `codec: "avc1.640033"` — H.264 High L5.1(4K 대응). 배포 호환성 위해 H.264가 기본.
- `bitrateMode: "quantizer"`(품질 타깃) 또는 충분히 높은 `bitrate`. 화면 녹화 "최대 화질"엔
  비트레이트 타깃보다 QP 타깃이 유리. (macOS per-frame QP는 Chrome ≥135 필요 — 미지원 환경은
  높은 `bitrate` + `"variable"`로 폴백.)
- `latencyMode: "quality"`(라이브 아님, 기본값).
- `hardwareAcceleration: "prefer-hardware"`(힌트 — 실패 시 자동 폴백).
- `avc: { format: "avc" }` — mp4 muxer가 요구하는 AVCC 형식(annexb 아님).
- **HEVC(`hvc1.*`)는 선택 모드**: 동화질 더 작은 파일이지만 Apple 밖 재생 호환성이 약해 기본에서
  제외. `isConfigSupported`로 게이팅해 옵션 제공.
- **모든 설정은 `isConfigSupported`로 사전 검증** 후 configure.

### 화질 판정 근거

"동등 이상"은 코덱이 Screen Studio(AVFoundation)와 동일한 VideoToolbox이므로 같은 프로파일·
QP·해상도·fps에서 성립한다. 픽셀 근접 비교(ADR 0004의 나란히 녹화 비교)는 GIF(256색)가 아니라
이 원화질 MP4로 수행한다 — 티켓 ②를 ④(모션 품질)보다 앞에 둔 이유와 정합.

## 이 결정으로 정해지는 부수 사항

- **fps·해상도 선택 시점 = export 시점**: 캡처는 최대 화질 고정(Retina 2x·60fps,
  `ScreenRecorder.swift`)을 유지하고, 사용자 해상도·fps 선택은 export 시점에 한다(현행 GIF 선택
  모델과 동일: `GIF_HEIGHTS`/`GIF_FPS_OPTIONS`). 별도 티켓 불필요 — 아키텍처가 이를 정한다.
  (맵 "Not yet specified"의 "녹화 시점 vs export 시점" 안개 항목은 이 결정으로 해소.)

## 후속(승격/열린 항목)

- **승격 → 신규 티켓**: export 포맷·목적지 프리셋 구조 (MP4/GIF × X 루핑 MP4 / Dooray 인라인 GIF),
  `ExportFormat` 재도입, `export-preset.ts` 재구조화, 포맷 선택 UI. 인코더가 정해진 지금 스펙 가능.
- **의존성 추가 필요**: `mediabunny`(런타임). 현재 런타임 dep은 `gifenc` 하나뿐 → 두 번째 추가.
- **구현 시 검증**: 대상 배포 하드웨어에서 4K60 `isConfigSupported` 실측, 소프트웨어 폴백 경로 확인.
