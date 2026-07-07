---
brand: Recap
mood: developer-tool # Linear / Vercel 계열, 깊은 모노크롬 뉴트럴
tokens:
  color:
    bg: "#0a0a0b" # 앱 바탕 — 가장 깊은 뉴트럴
    surface: "#141415" # 기본 면(카드·트랙)
    surface-2: "#1a1a1c" # 한 단계 밝은 면(입력·중첩 면)
    surface-3: "#232326" # hover / 강조 면
    border: "rgba(255,255,255,0.08)" # 미세한 흰색 알파 테두리
    border-strong: "rgba(255,255,255,0.14)" # 포커스·강조 테두리
    text-1: "#f5f5f7" # 본문·주요 텍스트
    text-2: "#a1a1a6" # 보조 텍스트
    text-3: "#6e6e73" # 캡션·비활성
    rec: "#ff453a" # REC 레드 — 성역(아래 규칙 참조)
    rec-hover: "#ff5a4f"
    primary: "#f5f5f7" # 주요 액션 버튼 배경(화이트)
    primary-ink: "#0a0a0b" # 화이트 버튼 위 텍스트(검정)
    primary-hover: "#e4e4e7"
    zoom: "#55555a" # 타임라인 줌 구간 — 뉴트럴 회색(파랑 폐지)
    zoom-hover: "#6a6a70"
    warn: "#ff9f0a" # 경고 텍스트·트림 핸들(앰버, 레드 아님)
  font:
    ui: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif"
    mono: "'SF Mono', ui-monospace, SFMono-Regular, Menlo, monospace"
  radius:
    s: "6px"
    m: "10px"
    l: "12px"
  space:
    "1": "4px"
    "2": "8px"
    "3": "12px"
    "4": "16px"
    "5": "24px"
    "6": "32px"
---

# Recap 디자인 시스템

Recap은 개발 화면을 녹화해 GitHub PR용 짧은 데모 영상을 만드는 macOS 앱이다. UI는 개발자 도구(Linear·Vercel)의 문법을 따른다 — 깊은 모노크롬 뉴트럴 위에서 콘텐츠(녹화·영상)가 주인공이고, 크롬은 조용히 물러난다. 브랜드 심벌은 닫힌 흰 링과 그 중심의 빨간 REC 점이며, 이 레드는 UI 전체에서 엄격히 통제된다.

## 레드 성역 원칙

REC 레드(`--rec`)는 **녹화라는 행위 하나만을 가리키는 색**이다. 남용하면 신호가 죽는다. 따라서 레드는 오직 다음에만 쓴다:

1. **녹화 시작·녹화 중 상태** — `.btn-record`, `.btn-stop`, `.rec-dot`, `.rec-time` 등 `.rec-*`
2. **파괴적 액션** — 삭제 버튼(`.tl-seg-del`)

그 외 어디에도 레드를 쓰지 않는다. 주요 액션(익스포트·선택 상태)은 레드가 아니라 **고대비 화이트**로 강조한다. 과거의 파랑(`#0a84ff`)은 전면 폐지됐다 — 대체 색은 파랑이 아니라 뉴트럴/화이트다.

## 버튼 위계

- **Primary (화이트)**: 화면에서 가장 밀고 싶은 액션. 흰 배경 + 검은 글자(`--primary` / `--primary-ink`). 예: 익스포트, 활성 선택 상태(`.btn-scale.is-active`).
- **Neutral (기본 `.btn`)**: 보조 액션. `--surface-3` 배경 + `--text-1`.
- **Record (레드)**: 녹화 시작/정지 전용. `--rec` 배경 + 흰 글자.
- **Destructive (레드)**: 삭제. 레드를 신호로만 쓰고 면적은 작게.

한 화면에 화이트 primary는 하나의 맥락(익스포트 그룹 등)으로 제한한다. 레드 버튼과 화이트 primary를 나란히 두지 않는다.

## 모노스페이스 규칙

모든 **숫자·기술 정보**는 `--font-mono` + `font-variant-numeric: tabular-nums`로 표시해 자리가 흔들리지 않게 한다:

- 녹화 타이머·타임코드 (`.rec-time`)
- 파일 경로 (`.meta .path`)
- 용량·해상도·길이·이벤트 수 같은 기술 readout
- 타임라인의 초 라벨 (`.tl-seg-label`)

UI 카피(버튼 라벨, 안내 문구, 설명)는 시스템 폰트(`--font-ui`)를 쓴다. 한국어 본문 문장은 모노로 만들지 않는다 — 숫자가 섞인 라벨은 `tabular-nums`만 얹어 정렬을 맞추는 선에서 그친다.

## 하지 말 것

- 파랑(`#0a84ff`) 등 과거 iOS 액센트 색을 되살리지 말 것.
- REC 레드를 강조·링크·정보 표시 등 녹화/삭제 외 용도로 쓰지 말 것.
- 하드코딩 색·간격·라운드 값을 새로 넣지 말 것 — 반드시 위 토큰(`var(--…)`)을 참조.
- 순수 검정(`#000`)·순수 흰색(`#fff`) 큰 면을 피하고 뉴트럴 토큰을 쓸 것.
- React 컴포넌트 추상화를 새로 만들지 말 것 — 기존 클래스 구조를 유지하고 값만 토큰화.
- 그라디언트·그림자·테두리를 화려하게 쌓지 말 것. 테두리는 미세한 흰색 알파 한 겹.
