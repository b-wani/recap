#!/usr/bin/env bash
#
# build-icons.sh — assets/brand/icon.svg 에서 macOS 앱 아이콘 산출물을 생성한다.
#
# 산출물:
#   assets/brand/icon.png   1024px 래스터 (Dock/BrowserWindow 용)
#   assets/brand/icon.icns  16~1024 + @2x iconset 을 iconutil 로 변환한 것
#
# macOS 내장 도구만 사용한다 (qlmanage, sips, iconutil). 외부 의존성 없음.
# idempotent 하게 동작한다 — 여러 번 실행해도 같은 결과를 덮어쓴다.
set -euo pipefail

# 저장소 루트 기준 경로 (스크립트 위치와 무관하게 동작).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BRAND_DIR="$ROOT_DIR/assets/brand"
SVG="$BRAND_DIR/icon.svg"
PNG="$BRAND_DIR/icon.png"
ICNS="$BRAND_DIR/icon.icns"

if [[ ! -f "$SVG" ]]; then
  echo "error: source SVG not found: $SVG" >&2
  exit 1
fi

# 임시 작업 디렉터리 — 종료 시 정리.
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# --- 1. SVG → 1024px PNG 래스터화 -------------------------------------------
# 1순위: qlmanage (Quick Look). SVG 의 그라디언트/투명 라운드 코너를 정확히 렌더한다.
# 실패 시 2순위: sips 직접 변환 (그라디언트 품질은 떨어질 수 있어 최후 수단).
rasterize() {
  local out="$WORK/master.png"

  if command -v qlmanage >/dev/null 2>&1; then
    # qlmanage 는 <name>.png 로 결과를 떨군다. 조용히 실행하고 결과를 확인한다.
    if qlmanage -t -s 1024 -o "$WORK" "$SVG" >/dev/null 2>&1 \
      && [[ -f "$WORK/$(basename "$SVG").png" ]]; then
      mv "$WORK/$(basename "$SVG").png" "$out"
      # qlmanage 가 1024 미만으로 떨어뜨리는 환경을 대비해 정확히 1024 로 정규화.
      sips -z 1024 1024 "$out" >/dev/null
      echo "  rasterized via qlmanage" >&2
      echo "$out"
      return 0
    fi
  fi

  # 폴백: sips 로 SVG 를 직접 PNG 로 변환.
  if sips -s format png -z 1024 1024 "$SVG" --out "$out" >/dev/null 2>&1; then
    echo "  rasterized via sips (fallback)" >&2
    echo "$out"
    return 0
  fi

  echo "error: failed to rasterize $SVG (qlmanage and sips both failed)" >&2
  return 1
}

echo "[1/3] rasterizing $SVG → 1024px PNG" >&2
MASTER="$(rasterize)"

cp "$MASTER" "$PNG"
echo "  wrote $PNG" >&2

# --- 2. iconset 구성 ---------------------------------------------------------
# iconutil 이 요구하는 표준 파일명 규칙. 각 size 는 마스터에서 다운스케일한다.
echo "[2/3] building iconset" >&2
ICONSET="$WORK/icon.iconset"
mkdir -p "$ICONSET"

# "iconutil 파일명:픽셀크기" 매핑 (16/32/64/128/256/512/1024 + @2x 세트).
gen() {
  local name="$1" size="$2"
  sips -z "$size" "$size" "$MASTER" --out "$ICONSET/$name" >/dev/null
}

gen "icon_16x16.png"      16
gen "icon_16x16@2x.png"   32
gen "icon_32x32.png"      32
gen "icon_32x32@2x.png"   64
gen "icon_128x128.png"    128
gen "icon_128x128@2x.png" 256
gen "icon_256x256.png"    256
gen "icon_256x256@2x.png" 512
gen "icon_512x512.png"    512
gen "icon_512x512@2x.png" 1024

# --- 3. iconset → icns -------------------------------------------------------
echo "[3/3] converting to icns" >&2
iconutil -c icns "$ICONSET" -o "$ICNS"
echo "  wrote $ICNS" >&2

# --- 4. 메뉴바(Tray) 아이콘 -------------------------------------------------
# 18px(@1x) + 36px(@2x) PNG. idle 은 검정 단색 템플릿(다크/라이트 자동 대응),
# recording 은 빨간 점(템플릿 아님 — 색 유지). Electron 이 @2x 를 자동으로 집는다.
echo "[4/4] building tray icons" >&2
for tray in tray-idle tray-recording; do
  tsvg="$BRAND_DIR/$tray.svg"
  [[ -f "$tsvg" ]] || continue
  qlmanage -t -s 72 -o "$WORK" "$tsvg" >/dev/null 2>&1
  sips -z 36 36 "$WORK/$tray.svg.png" --out "$BRAND_DIR/$tray@2x.png" >/dev/null
  sips -z 18 18 "$WORK/$tray.svg.png" --out "$BRAND_DIR/$tray.png" >/dev/null
  echo "  wrote $BRAND_DIR/$tray.png (+@2x)" >&2
done

echo "done." >&2
