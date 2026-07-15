#!/usr/bin/env bash
# GIF 인코더 비교 샘플 재현 스크립트 (티켓 #123).
# 요구: ffmpeg, gifski, node + repo의 node_modules/gifenc.
# 산출: 합성 스트레스 소스 → gifenc/ffmpeg/gifski GIF + SSIM/PSNR/크기/속도.
set -euo pipefail
OUT=${1:-./out}; mkdir -p "$OUT/frames"

# 1) 화면녹화 스트레스 소스: 애니메이션 그라디언트(밴딩) + AA 텍스트 + 줌/팬. 1280x720 / 4s.
ffmpeg -y -f lavfi -i "gradients=s=1280x720:c0=0x1a2a6c:c1=0xb21f1f:c2=0xfdbb2d:x0=0:y0=0:x1=1280:y1=720:d=8:speed=0.02" \
  -filter_complex "[0:v]trim=0:4,setpts=PTS-STARTPTS,\
drawtext=text='Recap export':fontcolor=white:fontsize=40:x=80:y=120:box=1:boxcolor=black@0.35:boxborderw=16,\
drawtext=text='gradient banding + anti-aliased text':fontcolor=0xEEEEEE:fontsize=28:x=80:y=200,\
drawbox=x=520:y=340:w=240:h=140:color=cyan@0.9:t=4,\
zoompan=z='min(zoom+0.0015,1.3)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1280x720:fps=30[v]" \
  -map "[v]" -pix_fmt yuv420p -c:v libx264 -crf 16 -t 4 "$OUT/src.mp4"

# 2) 25fps 프레임(PNG는 ffmpeg/gifski용, RGBA raw는 gifenc용).
ffmpeg -y -i "$OUT/src.mp4" -vf "fps=25" "$OUT/frames/f%03d.png"
ffmpeg -y -i "$OUT/src.mp4" -vf "fps=25" -f rawvideo -pix_fmt rgba "$OUT/frames.rgba"

# 3) 인코딩 (모두 1280x720 / 25fps / 256색 — 동일 조건).
node "$(dirname "$0")/gifenc-encode.mjs" "$OUT/frames.rgba" "$OUT/gifenc.gif"   # 앱 경로 재현(무디더)
ffmpeg -y -i "$OUT/frames/f%03d.png" -lavfi "fps=25,split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=none"                                   "$OUT/ffmpeg-none.gif"
ffmpeg -y -i "$OUT/frames/f%03d.png" -lavfi "fps=25,split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a"                             "$OUT/ffmpeg-sierra.gif"
ffmpeg -y -i "$OUT/frames/f%03d.png" -lavfi "fps=25,split[a][b];[a]palettegen=max_colors=256:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle" "$OUT/ffmpeg-bayer.gif"
ffmpeg -y -i "$OUT/frames/f%03d.png" -lavfi "fps=25,split[a][b];[a]palettegen=max_colors=256:stats_mode=single[p];[b][p]paletteuse=dither=sierra2_4a:new=1"                      "$OUT/ffmpeg-perframe.gif"
# gifski: -W/--width 는 "최대 폭" — 기본 상한으로 다운스케일하므로 원해상도 유지에 명시 필수.
gifski --fps 25 --quality 100 --width 1280 --height 720 -o "$OUT/gifski-q100.gif" "$OUT"/frames/f*.png
gifski --fps 25 --quality 80  --width 1280 --height 720 -o "$OUT/gifski-q80.gif"  "$OUT"/frames/f*.png

# 4) 객관 지표(원본 대비 SSIM/PSNR). 주의: 두 지표 모두 디더링 노이즈를 '오차'로 벌점 → 화질순위 아님.
ffmpeg -y -framerate 25 -i "$OUT/frames/f%03d.png" -c:v ffv1 "$OUT/ref.mkv"
for f in gifenc ffmpeg-none ffmpeg-sierra ffmpeg-bayer ffmpeg-perframe gifski-q100 gifski-q80; do
  ssim=$(ffmpeg -i "$OUT/$f.gif" -i "$OUT/ref.mkv" -lavfi "[0:v]fps=25,format=rgb24[a];[1:v]fps=25,format=rgb24[b];[a][b]ssim" -f null - 2>&1 | grep SSIM | sed 's/.*All://;s/ .*//')
  echo "$f SSIM=$ssim size=$(stat -f%z "$OUT/$f.gif")"
done
