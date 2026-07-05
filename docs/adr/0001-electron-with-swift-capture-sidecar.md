# Electron + TypeScript 본체, 캡처만 Swift 사이드카

macOS 화면 녹화 앱을 만들면서 Tauri(Rust)와 Electron(TypeScript)을 비교했다. 이 앱의 핵심 반복 지점은 효과 렌더링(줌 이징, 커서 스무딩, 배경 합성)인데, 개발자(웹 프론트엔드)가 직접 읽고 실험할 수 있도록 Canvas + WebCodecs 기반 TypeScript로 두기로 했다. 이 파이프라인은 Chromium에서만 안정적이므로 Electron을 선택했고, ScreenCaptureKit 접근이 필요한 캡처 층만 작은 Swift CLI 사이드카로 분리한다. Screen Studio가 동일 구조(TS + Electron + Swift 녹화 엔진)로 프로덕션 품질을 증명했다.

## Considered Options

- **Tauri + Rust 미디어 파이프라인** (Cap의 구조) — 앱은 가볍지만(~15MB vs ~200MB) 효과 코드가 Rust/wgpu로 가서 개발자의 전문 영역을 벗어남. 탈락.
- **Tauri + WebView(WKWebView)에서 처리** — 미디어 파이프라인이 Safari 엔진 위에 서게 되는데 WebCodecs 지원이 Chromium 대비 불완전. 탈락.
- **순수 Swift/SwiftUI** — 캡처 품질 최상이나 UI부터 렌더러까지 전부 전문 영역 밖. 탈락.

## Consequences

- 앱 용량(~200MB)과 상시 메모리 점유는 개인 도구로서 감수한다.
- 캡처 사이드카는 "한 번 만들면 안 건드리는" 층으로 유지한다 — 원본 영상 기록과 마우스 이벤트 스트리밍만 담당하고, 효과 관련 로직을 Swift 쪽에 넣지 않는다.
