# Screen Studio 구조 조사 — 웹사이트·앱 실사

- 이슈: #98 (맵: #97)
- 조사일: 2026-07-11
- 조사 대상: screen.studio 웹사이트(메인·가이드·체인지로그) + 로컬 설치본 실사(`/Applications/Screen Studio.app`, v3.7.3-4475)
- 방법: WebFetch/WebSearch + 앱 번들(app.asar) 추출 후 정적 분석. 앱 GUI 스크린샷 자동화는 이 환경에서 불가하여 번들 리소스 분석으로 대체.

## 요약

Screen Studio는 macOS 전용 Electron(React) 앱으로, "녹화 → 자동 편집 → 내보내기/공유" 3단계 플로우를 최소한의 UI로 감싼 제품이다. 에디터는 **좌측(또는 우측) 설정 사이드바 + 중앙 캔버스 프리뷰 + 하단 타임라인** 구성이며, 편집의 대부분(배경·커서·카메라·줌·캡션)이 사이드바 패널 전환으로 이뤄진다. 렌더링 프리뷰는 Pixi.js(WebGL) 기반, 상태 관리는 MobX, 스타일은 styled-components다.

## 1. 캡처 진입 플로우

- 앱 실행 시 **녹화 모달(recording modal)** 이 바로 뜬다. 닫혀 있으면 메뉴바 아이콘 또는 `⌥⌘⏎` 단축키로 다시 연다. [guide/new-recording]
- 모드 선택은 모달 안에서: **Display(전체 화면) / Window(단일 창) / Area(영역) / iPhone·iPad(기기)**. Display 모드는 모달에서 옵션을 고른 뒤 **원하는 디스플레이 위로 마우스를 옮겨 클릭해 확정**하는 방식(오버레이 픽커). [guide/recording-entire-display]
- 웹캠·마이크·시스템 오디오 토글도 같은 모달에서 켠다. iOS 기기는 연결 시 기기 모델·색상을 자동 감지해 프레임을 입힌다. [screen.studio 메인]
- 녹화 중에는 별도의 **녹화 위젯**(표시 여부 옵션 있음)이 뜨고, 3.x부터 녹화 종료 직후 **빠른 공유 위젯**으로 즉시 내보내기/공유가 가능. 3.1.0부터 자동 프로젝트 저장 후 위젯 활성화. [changelog]

## 2. 에디터 레이아웃

- **사이드바 내비게이션**(3.0.0에서 도입): 배경, 커서, 카메라, 줌, 캡션, 오디오 등 **기능별 패널을 전환**하는 구조. `Esc`로 커스텀 패널을 닫고, 한 번 더 누르면 기본(배경 설정) 패널로 복귀 — 즉 "배경 설정"이 홈 패널이다. [changelog 3.0.0]
- **중앙 프리뷰 캔버스**: Pixi.js(WebGL) 기반 실시간 렌더 (번들에 @pixi 모듈·셰이더 코드 다수). 카메라 오버레이·마스크·하이라이트를 캔버스 위에서 직접 드래그/리사이즈.
- **하단 타임라인 + 스크러버**: 스크러버는 타임라인 위에 있고 드래그 속도에 비례해 재생(오디오 스크럽 포함). 타임라인에는 줌 블록(auto/manual), 클립(슬라이스), 오디오 파형, 카메라 요소가 놓인다. 핀치 제스처 줌, 줌 변경 시 타임 마크 페이드 인, 편집 시 항목 흔들림(wiggle) 피드백. 3.1.0부터 슬라이스 편집도 사이드바에서 관리. [guide/scrubber, changelog]
- **커맨드 메뉴 `⌘K`**: 대부분의 에디터 동작을 키보드로 실행. [changelog]
- 반응형: 좁은 창에서 컨트롤 축소, 사이드바 스크롤바 동적 표시. [changelog 2.25.x]

## 3. 시각 언어

앱 번들 정적 분석(styled-components 문자열) + 웹사이트 인상:

- **타이포**: 앱 전반 **Inter** 단일 서체(번들 내 75회 참조, `.woff2` 내장). 웹사이트도 명확한 위계의 미니멀 타이포.
- **테마**: `color-scheme: light dark` 선언이 있으나 실사용 UI는 다크 기조(#000/#111 계열 다수). 브랜드 액센트로 **보라-파랑 #4d2ff5** 계열 확인.
- **radius 스케일**: 2/4/5/6/8/10px + pill(100px/1000px/9999px) + 원형(50%). **10px가 최빈값**(카드·패널), 버튼·태그류는 pill을 적극 사용.
- **모션**: spring 기반 이징(`spring`, `linear(0,1)` 참조), `reducedMotion` 대응, 타임라인 페이드/흔들림 등 **마이크로 피드백 중심**. 출력물 쪽 모션(스무스 커서, 자동 줌, 모션 블러)이 곧 브랜드 아이덴티티.
- **여백/구성(웹)**: 밝은 배경·큰 대비·섹션 스크롤 애니메이션, 제품 스크린샷을 크게 배치하는 쇼케이스형 레이아웃. [screen.studio 메인]

## 4. 라이브러리 / 프로젝트 관리

- **전용 라이브러리 화면은 없다.** 프로젝트는 파일(문서) 단위: 기본 저장 폴더(Settings > General에서 변경 가능)에 저장, `⌘S`/`⌘⇧S`, 미저장 종료 시 확인 모달(자동 저장은 3.1.0의 "녹화 직후 자동 프로젝트 저장"이 전부). [guide/saving-your-project]
- 과거 프로젝트 접근은 **Open recent(최근 목록)** 와 **Show previous projects(저장 폴더 열기)** 두 가지. 3.0.0에서 여러 프로젝트 일괄 내보내기 추가. [guide, changelog]
- **프리셋**: `.screenstudiopreset` 파일 포맷, 저장 위치 커스터마이징, 기본 프리셋 자동 적용 옵션 — 스타일 재사용의 단위가 프로젝트가 아니라 프리셋. [changelog 2.12/2.22/2.25]
- **공유**: 공유 링크(업로드 호스팅, `preview.screen.studio`), 클립보드 복사, 플랫폼별 내보내기 프리셋. 웹 대시보드(`/dashboard`)는 라이선스·세션 관리용이지 프로젝트 라이브러리가 아니다. [screen.studio 메인, changelog 2.26.0]

## 5. 기술 스택 관찰 (앱 번들)

- Electron + React + **MobX** + **styled-components**, 프리뷰 렌더는 **Pixi.js/WebGL**, 비디오 처리에 mp4box/AVC 디먹서 계열 코드. 빌드는 Vite(`dist/` 해시 청크 77개), Nx 모노레포 흔적. 코드 상당 부분 난독화.

## Recap(Hoppy)에의 시사점

1. "설정 사이드바 = 패널 스택(홈: 배경)" 구조는 우리 에디터 설정 패널 방향과 정합 — Esc 내비게이션 규칙이 참고할 만하다.
2. 라이브러리를 별도 화면으로 두는 우리 구조는 Screen Studio 대비 **차별점**(그들은 파일 기반 + Open recent뿐).
3. 스타일 재사용 단위를 프리셋 파일로 분리한 점은 우리 스타일 프리셋 v1(#93)과 같은 방향.
4. 시각 언어 벤치마크: Inter, radius 10px 기본 + pill 강조, 다크 기조 + 단일 보라 액센트, spring 마이크로모션.

## 출처

- https://screen.studio (메인)
- https://screen.studio/guide, /guide/new-recording, /guide/recording-entire-display, /guide/scrubber, /guide/saving-your-project
- https://screen.studio/changelog
- https://dockshare.io/apps/screen-studio (리뷰)
- 로컬 앱 실사: `/Applications/Screen Studio.app` v3.7.3-4475, `app.asar` 추출 정적 분석
