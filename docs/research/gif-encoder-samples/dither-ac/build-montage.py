#!/usr/bin/env python3
"""frame30 PNG 4종에서 밴딩이 드러나는 두 영역을 크롭·3x 확대(nearest)해 라벨 붙은 2행 몽타주 생성.
산출: ../dither-ac-montage.png (git 트래킹 대상).

행1 = 어두운 배경 그라디언트 + 드롭섀도 가장자리 (창 좌하단 코너, 320x360 crop)
행2 = 밝은 창 UI 세로 그라디언트 (창 우측 내부, 320x180 crop)
(ffmpeg drawtext가 이 빌드에 없어 PIL로 동등 처리 — crop/scale=neighbor/label.)
"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONT_PATH = "/System/Library/Fonts/Supplemental/Arial.ttf"
SCALE = 3
DARK = (10, 360, 320, 360)    # x, y, w, h  (창 좌하단: 섀도 falloff + 다크 그라디언트)
LIGHT = (820, 380, 320, 180)  # x, y, w, h  (창 내부 밝은 세로 그라디언트)

variants = [
    ("f30-A.png", "A · no dither"),
    ("f30-C-low.png", "C-low · Bayer s8"),
    ("f30-C-med.png", "C-med · Bayer s16"),
    ("f30-C-high.png", "C-high · Bayer s28"),
]

font = ImageFont.truetype(FONT_PATH, 34)
banner_font = ImageFont.truetype(FONT_PATH, 30)


def crop_scale_label(img, box, label):
    x, y, w, h = box
    tile = img.crop((x, y, x + w, y + h)).resize((w * SCALE, h * SCALE), Image.NEAREST)
    d = ImageDraw.Draw(tile)
    tb = d.textbbox((0, 0), label, font=font)
    tw, th = tb[2] - tb[0], tb[3] - tb[1]
    d.rectangle((8, 8, 8 + tw + 16, 8 + th + 16), fill=(0, 0, 0, 220))
    d.text((16, 12), label, fill="white", font=font)
    return tile


def build_row(imgs, box):
    tiles = [crop_scale_label(im, box, lab) for im, (_, lab) in zip(imgs, variants)]
    w = sum(t.width for t in tiles)
    h = tiles[0].height
    row = Image.new("RGB", (w, h))
    ox = 0
    for t in tiles:
        row.paste(t, (ox, 0))
        ox += t.width
    return row


imgs = [Image.open(os.path.join(HERE, f)).convert("RGB") for f, _ in variants]
row1 = build_row(imgs, DARK)
row2 = build_row(imgs, LIGHT)

BANNER = 44
W = max(row1.width, row2.width)
H = BANNER + row1.height + BANNER + row2.height
canvas = Image.new("RGB", (W, H), (30, 30, 34))
d = ImageDraw.Draw(canvas)


def banner(text, y):
    d.rectangle((0, y, W, y + BANNER), fill=(45, 45, 52))
    d.text((16, y + 7), text, fill="white", font=banner_font)


banner("DARK background gradient + drop-shadow edge  (crop 320x360 @3x nearest)", 0)
canvas.paste(row1, (0, BANNER))
y2 = BANNER + row1.height
banner("LIGHT window UI gradient  (crop 320x180 @3x nearest)", y2)
canvas.paste(row2, (0, y2 + BANNER))

out = os.path.join(HERE, "..", "dither-ac-montage.png")
canvas.save(out)
print("wrote", os.path.normpath(out), canvas.size)
