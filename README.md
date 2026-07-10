<p align="center">
  <img src="assets/brand/wordmark.svg" alt="Hoppy" width="360">
</p>

<p align="center">
  웹 프론트엔드 개발 화면을 녹화하고 자동 효과를 입혀 GitHub·티켓에 첨부할 데모 영상을 만드는 macOS 앱.
</p>

---

제품 정의는 [CONTEXT.md](./CONTEXT.md)와 [docs/SPEC.md](./docs/SPEC.md), 스택 결정은 [ADR 0001](./docs/adr/0001-electron-with-swift-capture-sidecar.md) 참고.

## 아키텍처

[ADR 0001](./docs/adr/0001-electron-with-swift-capture-sidecar.md)에 따라 두 층으로 나뉜다:

- **Electron + TypeScript 본체** (`src/main`, `src/preload`, `src/renderer`) — UI, 미리보기, (이후) 효과 렌더링·익스포트.
- **Swift 캡처 사이드카** (`src/sidecar`, 바이너리 `recap-capture`) — ScreenCaptureKit으로 원본 영상을 기록하고 마우스 이벤트를 스트리밍하는 CLI. 효과 로직을 넣지 않는 불변층.

두 층의 경계는 [사이드카 프로토콜](./docs/sidecar-protocol.md)로 고정된다.

## 요구 환경

- macOS 13+, Node 20+, pnpm
- Swift 툴체인 (Xcode 또는 Command Line Tools)

## 개발

```sh
pnpm install
pnpm sidecar:build   # Swift 사이드카를 먼저 빌드해야 녹화가 동작한다
pnpm dev             # Electron 앱 실행
```

첫 녹화 시 macOS가 화면 녹화 권한을 요청한다. 거부하면 앱이 안내를 표시한다 (조용히 실패하지 않는다).

## 검증

```sh
pnpm test        # 사이드카 프로토콜 계약 테스트 (vitest)
pnpm typecheck   # 본체·렌더러 타입체크
pnpm build       # Electron 프로덕션 빌드
```

UI와 실제 화면 캡처·인코딩은 자동 테스트 대상이 아니라 수동 확인 영역이다 (SPEC의 테스트 결정).
