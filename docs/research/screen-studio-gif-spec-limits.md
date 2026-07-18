# Screen Studio GIF export 스펙 한계 조사

- 조사일: 2026-07-19
- 조사 대상: Screen Studio 공식 가이드(`screen.studio/guide`), 공식 피드백 허브(`hub.screen.studio`), 유사 도구(CleanShot X, Gifox, ScreenToGif) 공식/커뮤니티 문서
- 방법: WebSearch로 후보 페이지 수집 → WebFetch로 공식 export 설정 가이드·4K GIF 기능요청 스레드 본문 추출 → 경쟁 도구 상한은 공식 features/changelog·커뮤니티로 교차 확인. 실제 앱 설치·export 실측은 하지 않음(웹 조사 한정).
- 신뢰도 표기: [공식]=screen.studio 도메인, [피드백]=hub.screen.studio 사용자 스레드, [보조]=제3자/커뮤니티, [미확인]=출처로 확정 불가

## 요약 (직답)

- **해상도 상한: 1080p(HD)가 GIF의 실질 상한.** 공식 export 가이드는 해상도 예시로 "4K와 HD"를 들지만, GIF에 한해 사용자가 4K를 못 얻어 MP4로 뽑아 외부 변환한다는 공식 피드백 스레드가 존재한다 → **GIF은 최대 1080p, 4K/원본초과는 GIF 직접 export 불가(추정상 캡)**. [공식][피드백]
- **프레임레이트 상한: 60fps.** 공식 export 가이드가 fps 옵션으로 **24 / 30 / 60**을 명시한다. GIF 전용으로 60이 별도 제한되는지는 문서에 명시 없음(일반 export 옵션 기준 60까지). [공식]
- **따라서 "720p / 30fps가 최대"는 사실이 아니다.** 720p는 최대가 아니라 1080p까지 올라가고, 30fps도 최대가 아니라 60fps 옵션이 있다. 720p·30fps는 상한이 아니라 중간 선택지에 가깝다.
- 단, GIF 포맷 본질 제약(256색 팔레트, 1/100초 단위 프레임 지연)으로 "숫자상 60fps"가 화면에서 그대로 재현되지 않을 수 있음은 별개 이슈다(아래 (c)).

## (a) 해상도(resolution) 옵션과 상한

**결론: GIF 최대 1080p(HD). 720p는 최대가 아님. 4K는 GIF로 직접 안 됨(MP4 경유 필요).**

- 공식 export 가이드는 해상도가 export 시간·파일 크기에 영향을 주는 요소라고 설명하며 해상도 예시로 **"4K"와 "HD"**를 언급한다. 다만 전체 해상도 드롭다운 목록(720p/1080p/원본/배율 등)을 완전히 열거하지는 않는다. [공식]
- 공식 피드백 허브의 "PLEASE Support 4K Gif Export Size" 요청(Pro 사용자, In Review, 약 1년 전)에 다음 원문: *"My gifs are all 1080p and look fuzzy. Currently, if I want a 4K gif I have to download it as an MP4, then use an external tool to convert the MP4 to a GIF."* → **현재 GIF export는 1080p가 상한이고 4K GIF는 미지원**임을 사용자 관점에서 방증. 공식 스태프의 명시적 "상한 확정" 답변은 스레드에 없음(추정 보강). [피드백]
- 720p가 최대라는 근거는 어디에도 없음 → **720p 최대설은 오답**. 1080p까지 확인, 그 이상(4K)은 GIF 경로에서 미확인/사실상 불가. [공식][피드백]

## (b) 프레임레이트(fps) 옵션과 상한

**결론: export fps 옵션은 24 / 30 / 60. 30fps는 최대가 아니라 중간값. 50fps 옵션은 문서상 확인 안 됨.**

- 공식 export 가이드가 fps 옵션으로 **24, 30, 60 FPS**를 명시. 원문 취지: *"a higher frame rate, such as 60 FPS, gives your video a smoother"*, *"a lower frame rate, like 24 or 30 FPS, is the standard for most online videos."* [공식]
- 이 24/30/60은 export 일반(주로 MP4 맥락) 옵션으로 서술됨. **GIF 선택 시 60fps가 별도로 잠기는지 여부는 공식 문서에 명시 없음** → 문서 기준으로는 GIF도 60까지 선택 가능하다고 보는 것이 자연스럽다(단, GIF 포맷 재현 한계는 (c) 참고). [공식][미확인=GIF 전용 fps 캡]
- **50fps 옵션**: Screen Studio에서는 확인되지 않음. 검색에 걸린 "1~50fps 슬라이더"는 별개 앱 *Screenify Studio*, "1~60fps"는 *ScreenToGif* 얘기로, Screen Studio와 혼동 주의. [보조]

## (c) GIF 포맷 본질 제약을 Screen Studio가 다루는 방식

**결론: Screen Studio는 GIF export 시 팔레트 최적화 알고리즘을 돌리며, 그래서 MP4보다 export가 느리다. 색/디더 세부 노출은 문서상 미확인.**

- 공식 가이드 원문: *"Exporting a project as a GIF can take much longer than exporting it as an MP4. This is due to the optimization algorithm GIFs use during export."* → GIF의 256색 팔레트 양자화/최적화를 내부적으로 수행함을 시사. 사용자가 색 개수·디더링 방식을 직접 고르는 UI가 있는지는 문서에 명시 없음(미확인). [공식]
- 압축(compression) 설정은 존재하나 **"compression level does not affect export time"**이라고 명시 — 압축은 크기/화질 트레이드오프용이고 시간엔 영향 없음. 반면 **해상도·fps·포맷은 시간과 크기에 영향**. [공식]
- 길이 권고: *"We do not recommend creating GIFs that are longer than 1 minute due to the significantly longer export times and large file sizes."* GIF은 짧은 클립·간단 애니메이션·짧은 튜토리얼용으로 권장. [공식]
- GIF 포맷 자체 제약(참고, 일반 사실): 팔레트는 프레임당 **최대 256색**, 프레임 지연은 **1/100초(centisecond) 단위**만 표현 가능 → 30fps(3.33cs)·60fps(1.67cs)는 정수 centisecond로 안 떨어져 재생기에서 반올림/뭉개짐이 발생할 수 있음. 즉 "60fps GIF"를 골라도 실제 체감 fps는 포맷·뷰어에 종속. Screen Studio가 이 반올림을 어떻게 처리하는지는 미확인. [보조][미확인]

## (d) GIF vs 다른 포맷(MP4/WebM) export 차이

**결론: 공식 문서상 export 포맷은 MP4와 GIF 둘뿐(WebM/투명 미언급). GIF에만 걸리는 제약이 해상도(1080p 캡)와 느린 export.**

- 공식 가이드가 명시하는 포맷은 **MP4와 GIF 2종**. 원문 권고: *"it's predominantly best to use MP4—especially for longer or more complex videos."* [공식]
- **WebM·투명 배경 GIF·APNG 등은 이 페이지에 언급 없음** → 공식 지원 여부 미확인. [미확인]
- GIF에만 있는 제한: (1) **해상도 상한 1080p**(MP4는 4K 가능, (a) 참고), (2) **export 속도 느림**(팔레트 최적화), (3) 긴 길이 비권장(1분 초과 지양). MP4엔 이런 제약이 없음. [공식][피드백]

## (e) 유사 도구 GIF 상한 비교 (업계 통상 감)

**결론: "업계 통상 GIF 상한"은 대체로 fps 30~60 / 해상도는 도구에 따라 원본~4K. Screen Studio의 1080p·60fps는 상한 관점에선 평균~약간 보수적(특히 해상도).**

- **CleanShot X**: GIF 전용 설정 탭에서 **frame rate·quality·resolution**을 직접 조절. 영상 녹화는 480p~4K 지원. GIF export 해상도 상한을 4K로 못박은 공식 수치는 확인 못 했으나 해상도가 사용자 설정값이라는 점은 확인. → 조절 자유도는 Screen Studio보다 넓음. [보조]
- **Gifox**: 품질/크기 밸런스 권장값이 **10~15fps, 100~200색, Bayer×3 또는 Sierra/Lite 디더**, 최고화질은 256색+Bayer×2~3. 즉 실무 권장 fps는 오히려 낮음(10~15). 해상도 상한 명시는 없음. [보조]
- **ScreenToGif**(Windows): **1~60fps** 범위 지원. [보조]
- 일반 GIF fps 권장(플랫폼 관점): Giphy 등은 **15~24fps, 총 200프레임 미만** 권장. GIF는 12~24fps가 실용역이며 30 이상은 크기 급증 대비 체감 이득이 작다는 게 통설. [보조]
- 종합: **Screen Studio의 60fps 선택지는 상한으로는 넉넉한 편(경쟁 도구 최대치와 동급)**, 반면 **1080p 해상도 캡은 CleanShot X 대비 다소 보수적**. 다만 GIF 실무 화질은 fps·해상도보다 팔레트/디더 튜닝이 더 지배적이라, 1080p·중간 fps + 좋은 팔레트가 현실적 최적점이라는 게 도구 전반의 공통된 방향이다. [보조]

## recap 관점 시사

- recap의 GIF export UI에서 "720p·30fps 최대" 같은 전제는 근거 없음 — Screen Studio 기준으로도 1080p·60fps까지가 상한 프레임. 우리 상한 설정 시 이 정도가 업계 정합 범위.
- 다만 상한을 올리는 것보다 **팔레트(색수/디더)·해상도 다운스케일이 화질·크기의 실지배 변수**라는 점은 우리 기존 조사(`gif-quality-techniques.md`, `gif-quality-profile-matrix.md`)와 일치. 고fps GIF의 centisecond 반올림 문제는 `high-fps-gif-playback.md` 논점과 연결.

## 참고: 출처 목록

- [공식] Screen Studio Guide · Explanation of export settings — https://screen.studio/guide/explanation-of-export-settings (원문: fps "24, 30, 60 FPS"; 해상도 예시 "4K"/"HD"; "optimization algorithm GIFs use during export"; "compression level does not affect export time"; "do not recommend creating GIFs that are longer than 1 minute"; 포맷 MP4·GIF)
- [피드백] Screen Studio Hub · "PLEASE Support 4K Gif Export Size" — https://hub.screen.studio/p/please-support-4k-gif-export-size (원문: "My gifs are all 1080p and look fuzzy. Currently, if I want a 4K gif I have to download it as an MP4, then use an external tool to convert the MP4 to a GIF." / 상태 In Review)
- [보조] CleanShot X — All Features — https://cleanshot.com/features (GIF 전용 frame rate·quality·resolution 설정, 녹화 480p~4K)
- [보조] Mastering High Quality GIFs with Gifox (Medium) — https://medium.com/gifox/mastering-high-quality-gifs-with-gifox-e08647cd5b3b (권장 10~15fps, 100~200색, Bayer/Sierra 디더)
- [보조] ScreenToGif Wiki · Help — https://github.com/NickeManarin/ScreenToGif/wiki/Help (1~60fps)
- [보조] Animated GIF Best Practices (SVGator) — https://www.svgator.com/blog/animated-gif-best-practices-to-optimize-gifs-like-pros/ (256색·centisecond 타이밍·fps 권장역)
- [보조] GIF Frame Rate & Duration Best Practices — https://fastmakergif.com/blog/gif-frame-rate-duration-best-practices (Giphy 15~24fps / 200프레임 권장)
