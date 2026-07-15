# GIF 인코더 상향 조사 — gifenc vs gifski vs ffmpeg (최고품질 GIF 파이프라인)

> 티켓: [#123](https://github.com/b-wani/recap/issues/123) · 맵: [#117](https://github.com/b-wani/recap/issues/117)
> 목적: 목적지가 "GIF 단일 출력 · Dooray 첨부 최고품질"로 재정의된 뒤, **현 `gifenc` 파이프라인보다 더 나은 GIF를 낼 인코더가 있는지** 1차 사료 + 실측으로 판정하고 #122(프리셋·UI 최종 스펙)의 입력을 만든다.

## TL;DR (권고)

**`gifenc` 유지를 권고한다.** 화면 녹화 콘텐츠에서 대안 인코더의 **측정 화질 이득이 작고**(gifenc SSIM 0.988 ≈ gifski-q100 0.989, 게다가 gifenc가 파일이 더 작음), 반대로 네이티브 인코더 도입의 **통합 비용은 크고 영구적**이다 — nested 바이너리의 macOS 서명+공증(hardened runtime), copyleft 라이선스(gifski **AGPL-3.0**, ffmpeg-static **GPL-3.0**), 플랫폼당 수십 MB, renderer→main IPC 경로 신설. 앱은 현재 **네이티브 바이너리를 하나도 배포하지 않는다**(녹화는 mediabunny=WebCodecs/Chromium). 목적지의 "최고품질 GIF"는 인코더 교체보다 **이미 확정된 해상도+fps 사용자 선택([#121](https://github.com/b-wani/recap/issues/121))** 으로 더 잘 달성된다.

- 이 결론은 [#120](https://github.com/b-wani/recap/issues/120)("gifenc는 이미 화질-최대에 근접, 색 축 튜닝 이득 작음")·[#121](https://github.com/b-wani/recap/issues/121)("선명함=해상도, 부드러움=fps, 색/밴딩 무시 가능")과 **일치**하며, #120의 ⚠️경고(그 결론은 gifenc 한정 — R1에서 재검토)를 이 조사가 **해소**한다: 인코더를 바꿔도 이득이 작다.
- **유일한 실질 약점 + 조건부 예외**는 아래 [§6](#6-gifenc의-유일한-약점--조건부-예외) 참고.

## 1. 실측 방법

- **소스**: 화면 녹화 특성을 재현한 합성 스트레스 클립 — 애니메이션 대각 그라디언트(밴딩 유발) + 안티에일리어싱 텍스트 + 좌↔우 팬 + 줌인. 1280×720, ~3.3s, 83프레임. `generate.sh`로 재생성(레포가 `*.mp4`/`*.gif`를 gitignore하므로 소스·GIF 산출물은 트래킹하지 않음 — 재현 스크립트로 복원).
  - repo의 `e2e/fixtures/recording.mp4`(4KB·거의 정적)는 그라디언트/모션 화질 차이를 드러내지 못해 부적합 → 통제된 합성 소스를 사용.
- **조건 통일**: 전 인코더 1280×720 · 25fps · 256색. (fps는 [#119](https://github.com/b-wani/recap/issues/119) 실효 상한 계열 중 하나)
- **gifenc**: 앱 경로(`src/renderer/src/export.ts` `renderRecipeToGif`)를 node로 재현 — 프레임마다 `quantize(256)`→`applyPalette`→`writeFrame`(무디더). gifenc 1.0.3.
- **도구**: ffmpeg(palettegen/paletteuse), gifski 1.34.0, node. 지표는 ffmpeg `ssim`/`psnr`(원본 무손실 레퍼런스 대비).
- **재현**: `gif-encoder-samples/generate.sh` (+`gifenc-encode.mjs`).

> ⚠️ 하니스 주의(재현 시): gifenc의 `applyPalette`는 넘긴 TypedArray **뷰의 offset/length를 무시하고 `data.buffer` 전체를 읽는다**. 큰 버퍼의 subarray를 넘기면 전 프레임을 한 프레임으로 인코딩해 결과가 수백 MB로 폭증한다. 반드시 프레임을 **독립 버퍼로 복사**해 넘길 것. (실제 앱은 `ctx.getImageData`가 프레임별 독립 버퍼라 정상.)

## 2. 실측 결과 (1280×720 / 25fps / 83프레임 / 256색)

| 인코더 · 설정 | 파일 크기 | 인코딩 시간 | SSIM↑ | PSNR(dB)↑ |
|---|--:|--:|--:|--:|
| **gifenc (무디더) — 현행** | **3.91 MB** | 2034 ms | 0.9881 | 40.18 |
| ffmpeg none (global palette) | 7.06 MB | 912 ms | 0.9973 | 48.33 |
| ffmpeg sierra2_4a (global) | 8.86 MB | 2271 ms | 0.9964 | 47.14 |
| ffmpeg bayer3 + stats=diff + diff_mode | 13.03 MB | 929 ms | 0.9520 | 41.59 |
| ffmpeg per-frame (single + new=1, sierra2_4a) | 9.49 MB | 3062 ms | 0.9975 | 49.01 |
| gifski q100 | 8.14 MB | 1778 ms | 0.9889 | 46.03 |
| gifski q90 | 3.56 MB | 1559 ms | 0.9588 | 39.93 |
| gifski q80 | 2.14 MB | 1536 ms | 0.9474 | 37.07 |

시간은 지표성(gifenc=단일스레드 JS+raw 로드 포함, gifski=멀티스레드, ffmpeg=palettegen 2-pass). 랩 정밀도 아님.

> **‼️ SSIM/PSNR 해석 함정 (반드시 읽을 것)**: 두 지표는 **원본과의 픽셀 일치도**를 재므로 **디더링 노이즈를 오차로 벌점**한다. 따라서 SSIM 최고인 ffmpeg none/perframe이 "가장 좋아 보인다"는 뜻이 **아니다** — "원본에서 수치적으로 가장 덜 벗어났다"는 뜻이다. 디더링(bayer·gifski의 시간축 디더)은 **일부러** 노이즈를 넣어 밴딩을 지각적으로 없애므로 SSIM이 낮게 나온다. 표는 화질 순위표가 아니라 "충실도 vs 디더 트레이드오프" 지도로 읽어야 한다.

시각 비교(그라디언트+텍스트 크롭, 프레임 40, **git 트래킹됨**): `gif-encoder-samples/quality-crop-montage.png`
(3×2 그리드, 좌→우·상→하 순서: **REF(원본) · gifenc · gifski-q100 / ffmpeg-perframe · ffmpeg-bayer · gifski-q80**)
모션 비교 GIF(480p, 앱 현재 출력 해상도)는 `*.gif` gitignore로 미트래킹 — `generate.sh`로 재생성.

**관찰**: 텍스트 AA는 전 인코더에서 선명. 그라디언트 차이는 **미묘**하며, 디더가 눈에 띄는 건 ffmpeg-bayer(디더 텍스처+파일 폭증 13MB)뿐. gifenc는 SSIM 0.988로 gifski-q100(0.989)과 대등하면서 파일이 절반 이하(3.9 vs 8.1MB). → **#120/#121의 "이 콘텐츠에선 색/밴딩 축 이득 작음"을 실측 재확인.**

## 3. 인코더별 상세 (1차 사료)

### gifenc (현행) — 순수 JS, 무디더
출처: <https://github.com/mattdesl/gifenc>
- 양자화: PnnQuant.js 포트(Pairwise Nearest Neighbor). `quantize` `format`=`rgb565`(기본)/`rgb444`/`rgba4444`. 1-bit 투명(`transparent`/`transparentIndex`) 지원. 프레임별/글로벌 팔레트 모두 가능(`writeFrame`의 optional palette).
- **디더링 없음** (README 명시: "no dithering support … best suited for simple flat-style vector graphics, rather than photographs"). delta-frame(프레임간 diff 인코딩) 없음.
- 런타임: 순수 JS ~9KB, WASM/네이티브 무의존. → **번들·서명·라이선스 부담 0, renderer 내 실행.**

### gifski — 최고 지각 화질 후보 (네이티브 Rust, AGPL-3.0)
출처: <https://github.com/ImageOptim/gifski> · <https://gif.ski/> · <https://github.com/jamsinclair/gifski-wasm>
- 알고리즘: pngquant/libimagequant 기반. **프레임별 팔레트 + 프레임간 색 공유(cross-frame) + 시간축(temporal) 디더링** → "thousands of colors per frame". 단일 프레임 Floyd-Steinberg의 프레임간 "boiling"을 시간축 디더로 억제 — 이것이 gifenc/gifsicle류 대비 지각 화질 우위의 근거.
- 노브(CLI): `--quality(1-100)`, `--motion-quality`, `--lossy-quality`(낮출수록 작지만 grainy/smearing), `--fps`, `--extra`(느리지만 ~1%↑).
- **`-W/--width`는 "최대 폭"** — 기본 상한으로 다운스케일함(실측: 1280→640 자동 축소). 원해상도 유지엔 `--width/--height` 명시 필수. **통합 gotcha.**
- 바이너리: arm64 코어 1.22MB(homebrew·동적링크 기준; 배포용 정적/유니버설은 더 큼). 
- **WASM 대안** `gifski-wasm`(npm, jamsinclair): 네이티브 바이너리 없음 → **executable 공증 회피**. 단 `encode()`는 `quality`만 노출(**`--motion/--lossy-quality` 없음**), Node/renderer 단일스레드(느림), **AGPL-3.0**(여전히 copyleft), WASM 번들 가중.
- **라이선스: AGPL-3.0** — 폐쇄소스 배포 데스크톱 앱에 사실상 부적합(핵심 리스크).

### ffmpeg palettegen/paletteuse — 가장 빠르고 튜닝 폭 넓음 (네이티브, GPL)
출처: <https://ffmpeg.org/ffmpeg-filters.html>
- `palettegen`: `max_colors`(기본 256), `stats_mode`=`full`(기본)/`diff`(변화 픽셀 가중—정적 UI 배경에 유리)/`single`(프레임별 팔레트, `paletteuse new=1`과 짝).
- `paletteuse`: `dither`=`bayer`(ordered)/`sierra2_4a`(기본)/`floyd_steinberg`/`none`/…, `bayer_scale`(0–5), `diff_mode=rectangle`(변화 영역만 재처리 — **화면 녹화의 정적UI+움직이는 커서/줌에 직접 유리**), `new=1`(프레임별 팔레트).
- 디더 선택: **ordered(bayer)** 는 패턴 고정이라 정적 영역이 프레임간 안 떨림(화면 녹화·플랫 UI에 적합, 압축도 유리) / **error-diffusion(sierra·floyd)** 은 정지 화질 좋으나 모션에서 "boiling"(→`diff_mode`로 완화).
- 배포: 앱이 현재 ffmpeg를 **전혀** 안 씀. `ffmpeg-static`(GPL-3.0, 플랫폼당 수십 MB)을 번들해 main에서 `child_process` spawn하는 것이 표준 — GIF만을 위해 과중.

### imagemagick — 최약 후보 (참고)
출처: <https://usage.imagemagick.org/quantize/>
- `-colors N`(Adaptive Spatial Subdivision), `-dither FloydSteinberg`/`+dither`/`-ordered-dither`. 시간축/프레임간 팔레트 지능 없음, 벤치마크상 최저속. gifski/ffmpeg 대비 채택 이유 없음.

### 속도(공개 벤치마크, 참고)
출처: <https://www.bit-101.com/2017/2021/09/more-gif-making-tips-and-tools/> (300프레임 grayscale) — ffmpeg 5.8s / gifski 19.3s / imagemagick 43.8s. ffmpeg ≈ gifski의 3.3배 빠름(단 grayscale 기준; 저자도 "컬러면 달라질 수 있다" 단서). gifenc는 공개 벤치 없음(JS라 네이티브보다 느림 예상).

## 4. 통합·번들 비용 (Electron macOS) — 결정 축

출처: <https://www.electronjs.org/docs/latest/tutorial/code-signing> · <https://github.com/eugeneware/ffmpeg-static>
- macOS 배포는 **서명+공증(notarization) 필수**. 번들된 **모든 executable/dylib**을 Developer ID로 deep-sign하고 hardened runtime을 요구 — 제3자 gifski/ffmpeg 바이너리도 예외 없이 서명·공증 대상.
- 표준 패턴: 네이티브 바이너리를 리소스로 번들 → **main 프로세스**에서 `child_process` spawn(renderer에서 직접 호출 불가). 즉 renderer(프레임 생성)→main(spawn)→GIF 회수의 **새 IPC 경로** 필요.
- **현재 앱은 네이티브 바이너리 0개** — 하나 추가는 build/sign/CI의 구조적 변경.

| | gifenc(현행) | gifski 네이티브 | gifski-wasm | ffmpeg-static |
|---|---|---|---|---|
| 번들 형태 | 순수 JS(~9KB) | nested 바이너리 | WASM+JS | nested 바이너리(수십 MB) |
| macOS 서명/공증 | 불필요 | **필요** | 불필요(리소스) | **필요** |
| 실행 위치 | renderer | main+IPC | renderer/node | main+IPC |
| 라이선스 | (permissive) | **AGPL-3.0** | **AGPL-3.0** | **GPL-3.0** |
| 화질 노브 | format/색수 | quality/motion/lossy | quality만 | dither/diff/stats |

## 5. 교체 시 열리는 품질 노브 (참고)
- gifski: `--quality`(용량 레버 — gifenc엔 없는 축), `--motion-quality`, `--lossy-quality`, cross-frame 팔레트, 시간축 디더.
- ffmpeg: dither 모드/`bayer_scale`/`stats_mode=diff`/`diff_mode=rectangle`/`new=1`.
- 단 [#121](https://github.com/b-wani/recap/issues/121)이 **용량 레버를 해상도+fps로 확정**했으므로 gifski의 quality 노브가 여는 새 UX는 불필요.

## 6. gifenc의 유일한 약점 + 조건부 예외
gifenc가 대안 대비 실제로 지는 유일한 축은 **무디더 → 부드러운 그라디언트 밴딩**이다. 이번 합성 스트레스에선 차이가 미묘했다(§2). **만약** 실제 Recap 캡처(앱 UI 그림자/그라디언트)에서 밴딩이 거슬리는 수준이면, 가장 싼 완화책은 인코더 교체가 아니라 **gifenc `quantize` 앞단에 ordered(Bayer) 디더 1스텝을 파이프라인에 추가**하는 것(gifenc엔 디더 API가 없어 RGBA 버퍼에 수동 적용). → 지금 할 일 아님, 필요시 별도 마이크로 조사 티켓.

## 7. 맵 영향 (#122 입력 / delta-frames fog)
- **#122(프리셋·UI 최종 스펙)**: 인코더 = **gifenc 확정(교체 없음)**. UI에 인코더-품질 슬라이더 없음. 용량은 해상도/fps/색수로 제어(#121). #122는 이 위에서 UI 형태만 확정하면 됨.
- **delta/투명 프레임 fog**: 네이티브 인코더면 프레임간 최적화가 "공짜"로 따라오지만, gifenc 유지 권고에 따라 delta 용량절감은 **여전히 수동 구현(gifenc 투명) 또는 해상도/fps로 흡수**로 남는다. 즉 이 조사는 delta-frames를 scope로 강제하지 **않으며**, 맵이 이미 세운 대로 "#122가 용량 표시+경고+해상도/fps 하향으로 충분하면 out of scope, 부족하면 구현 티켓" 판단에 맡긴다.

## 8. 출처
gifenc <https://github.com/mattdesl/gifenc> · gifski <https://github.com/ImageOptim/gifski> · <https://gif.ski/> · gifski-wasm <https://github.com/jamsinclair/gifski-wasm> · ffmpeg filters <https://ffmpeg.org/ffmpeg-filters.html> · imagemagick <https://usage.imagemagick.org/quantize/> · Electron 서명 <https://www.electronjs.org/docs/latest/tutorial/code-signing> · ffmpeg-static <https://github.com/eugeneware/ffmpeg-static> · 속도벤치 <https://www.bit-101.com/2017/2021/09/more-gif-making-tips-and-tools/>
