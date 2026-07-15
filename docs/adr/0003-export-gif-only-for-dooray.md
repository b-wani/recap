# 익스포트 출력은 GIF 단일로 좁힌다 (Dooray 첨부용)

프로젝트 목적이 "NHN Dooray 업무에 첨부할 짧은 데모"로 좁혀지면서, export 출력 포맷을 재검토했다. 기존 v1은 GitHub 첨부 제한(영상 100MB / 이미지·GIF 10MB)을 타겟으로 MP4·GIF 두 포맷을 골라 내보냈고, 코드·용어(`GITHUB_PRESET`, `ExportFormat = 'mp4' | 'gif'`)가 GitHub·MP4에 묶여 있었다.

Dooray 업무 본문은 GIF를 인라인으로 자동재생하고, 사용자가 호환성 때문에 GIF를 명시했다(WebP/APNG 배제). MP4는 본문 인라인 재생이 아니라 다운로드 첨부로만 성립해 "붙여넣으면 바로 움직이는 데모"라는 목적에 맞지 않는다. 그래서 **export 출력을 GIF 단일로 확정**하고, MP4 export 경로와 GitHub 명명을 코드·`CONTEXT.md`·온보딩 문구까지 전면 제거했다.

## Considered Options

- **MP4·GIF 공존 유지** — 용량이 크면 MP4로 폴백한다는 탈출구는 있지만, MP4는 Dooray 본문에 인라인 재생되지 않아 목적(붙여넣기 즉시 재생)과 어긋난다. 두 포맷을 유지하려고 `ExportFormat` 분기·`GITHUB_PRESET`의 MP4 필드(코덱·비트레이트 등)를 계속 안고 가야 해 탈락.
- **애니메이션 WebP/APNG 채택** — GIF보다 화질·용량이 유리하지만, 사용자가 호환성 때문에 GIF를 명시했고 Dooray 인라인 재생 성립이 GIF로 이미 확인됐다(#118). 목적지를 흐리는 선택이라 탈락(맵 #117 Out of scope).

## Consequences

- `ExportFormat` 타입과 포맷 분기(`saveExport(format)`·`notifyExportDone`·`ExportStatus.format`)를 제거했다. GIF가 유일 출력이라 포맷을 값으로 넘길 이유가 없다. 저장 확장자는 `export.gif`로 고정.
- `GITHUB_PRESET` → `DOORAY_GIF_PRESET`으로 재명명하고 MP4 전용 필드(`container`/`codec`/`maxHeight`/`fps`/`maxSizeBytes`/`maxBitrate`)·`resolveEncodeConfig`·`EncodeConfig`를 삭제했다. MP4 인코딩을 담당하던 `mediabunny` 의존성도 함께 제거.
- 용량 경고는 GitHub 하드 제한이 아니라 Dooray 본문 인라인 렌더 부담·뷰어 UX 기준으로 판단한다(#118).
- **녹화 소스 캡처(raw.mp4)는 그대로 MP4**다 — 이 결정은 export **출력**만 GIF로 한정한다.
- 최적 인코더·품질 설정(R1)과 선택 가능한 해상도·fps(#121)·최종 프리셋/UI 스펙(#122)은 이 결정과 별개로 이어서 정한다.
