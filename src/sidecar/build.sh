#!/usr/bin/env bash
# Swift 캡처 사이드카 빌드. Xcode 없이 Command Line Tools만으로도 빌드되도록
# SwiftPM 대신 swiftc를 직접 쓴다 (SwiftPM은 CLT 환경에서 PlatformPath 조회에 실패).
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$DIR/.build"
mkdir -p "$OUT"

# 배포용 유니버설 바이너리는 이후 슬라이스의 과제. 스켈레톤은 현재 아키텍처로 빌드한다.
ARCH="$(uname -m)"
swiftc -O \
  -sdk "$(xcrun --show-sdk-path)" \
  -target "${ARCH}-apple-macosx13.0" \
  "$DIR"/Sources/recap-capture/*.swift \
  -o "$OUT/recap-capture"

echo "built: $OUT/recap-capture"
