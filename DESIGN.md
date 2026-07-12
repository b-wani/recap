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
    selection: "#f5f5f7" # 선택/활성 외곽선(순백 2px — 아래 선택/활성 신호 규칙 참조)
    scrim: "rgba(10,10,11,0.55)" # 오버레이 딤 (hover 완화 시 알파 0.3)
  shadow:
    selection-glow: "0 0 0 1px rgba(255,255,255,0.35), 0 0 12px rgba(255,255,255,0.18)" # 선택 글로우
    "1": "0 4px 16px rgba(0,0,0,0.35)" # 팝오버·카드 hover
    "2": "0 8px 32px rgba(0,0,0,0.5)" # 플로팅 툴바·REC 알약
  font:
    ui: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif"
    mono: "'SF Mono', ui-monospace, SFMono-Regular, Menlo, monospace"
  radius:
    s: "6px"
    m: "10px"
    l: "12px"
    pill: "999px" # 플로팅 요소 한정(아래 pill 규칙 참조)
  motion:
    fast: "120ms" # hover·미세 상태 전환
    base: "200ms" # 팝오버·패널 전환
    easing: "ease-out"
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

1. **녹화 시작·녹화 중 상태** — `.btn-record`, `.btn-stop`, `.rec-dot`, `.rec-time` 등 `.rec-*`. 녹화 카운트다운 숫자(`.countdown-num`)도 녹화 시작 상태의 일부로 성역 내다.
2. **파괴적 액션** — 삭제 버튼(`.btn-danger`)·삭제 메뉴 항목(`.library-card-menu-item.is-destructive`)

그 외 어디에도 레드를 쓰지 않는다. 주요 액션(익스포트·선택 상태)은 레드가 아니라 **고대비 화이트**로 강조한다. 과거의 파랑(`#0a84ff`)은 전면 폐지됐다 — 대체 색은 파랑이 아니라 뉴트럴/화이트다.

## 버튼 위계

- **Primary (화이트)**: 화면에서 가장 밀고 싶은 액션. 흰 배경 + 검은 글자(`--primary` / `--primary-ink`). 예: 익스포트, 활성 선택 상태(`.btn-scale.is-active`).
- **Neutral (기본 `.btn`)**: 보조 액션. `--surface-3` 배경 + `--text-1`.
- **Record (레드)**: 녹화 시작/정지 전용. `--rec` 배경 + 흰 글자.
- **Destructive (레드)**: 삭제. 레드를 신호로만 쓰고 면적은 작게.

한 화면에 화이트 primary는 하나의 맥락(익스포트 그룹 등)으로 제한한다. 레드 버튼과 화이트 primary를 나란히 두지 않는다.

## 선택/활성 신호

선택·활성 상태는 일반 테두리(흰 알파 1px)와 **두 단계 분리**된 별도 신호를 쓴다:

- **선택 외곽선**: 순백(`--selection`) 2px + 은은한 흰 글로우(`--shadow-selection-glow` = `0 0 0 1px rgba(255,255,255,0.35), 0 0 12px rgba(255,255,255,0.18)`).
- **캡처 하이라이트**(영역 선택 등): 선택 글로우에 `0 0 24px rgba(255,255,255,0.25)`를 더하고, 면은 `rgba(255,255,255,0.06)`.
- **진행 표시**: 화이트 fill 바. permission granted 류의 완료 상태는 체크 아이콘 + `--text-1`.

## pill 규칙

`--radius-pill`(999px)은 **플로팅 요소 한정**이다 — 캡처 툴바, REC 알약, 모드 세그먼트, 태그류. 카드·패널·입력 등 면에 붙는 요소는 각진 radius(`s`/`m`/`l`)를 유지한다.

## 모션

hover·팝오버·패널 전환은 토큰화된 2단계로 통일한다:

- `--motion-fast`(120ms): hover·미세 상태 전환
- `--motion-base`(200ms): 팝오버·패널 전환
- easing은 `ease-out` 하나. spring·wiggle 류는 쓰지 않는다.
- `prefers-reduced-motion` 대응은 필수 — 모션을 끄거나 즉시 전환으로 대체한다.

## 엘리베이션

그림자는 두 단계만 허용한다: `--shadow-1`(팝오버·카드 hover), `--shadow-2`(플로팅 툴바·REC 알약). 그 외 그림자는 금지. 선택 글로우는 엘리베이션이 아니라 선택 신호다(위 참조).

## 단일 서체

서체는 `--font-ui` 하나다(+ 기술 정보용 `--font-mono`). 별도 디스플레이 서체(SF Pro Rounded 등)는 쓰지 않는다 — 타이포 위계는 굵기·크기·letter-spacing으로만 만든다.

## 콘텐츠 레이어

합성 결과물(익스포트 영상)도 브랜드 톤을 따른다. 클릭 리플 등 콘텐츠 위 오버레이 효과는 반투명 화이트를 쓴다(과거 스카이 블루 폐지).

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
- 그라디언트·테두리를 화려하게 쌓지 말 것. 테두리는 미세한 흰색 알파 한 겹, 그림자는 엘리베이션 2단계(위 참조) 외 금지.
- 마스코트·일러스트 캐릭터를 쓰지 말 것. 빈 상태·완료 상태는 타이포와 아이콘으로 처리.
- 디스플레이 서체(SF Pro Rounded 등)를 되살리지 말 것 — 단일 서체 규칙(위 참조).
