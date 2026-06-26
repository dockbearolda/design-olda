#!/usr/bin/env python3
"""Génère des vignettes WebP carrées, logos rognés + centrés, pour une grille nette."""
from PIL import Image
import os, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets", "logos")
OUT = os.path.join(ROOT, "assets", "thumbs")
os.makedirs(OUT, exist_ok=True)

SIZE = 640          # canvas carré
PAD = 0.14          # marge relative

def trim(im):
    if im.mode == "RGBA":
        bbox = im.split()[3].getbbox()
    else:
        # fond blanc -> diff avec blanc
        from PIL import ImageChops
        bg = Image.new("RGB", im.size, (255, 255, 255))
        bbox = ImageChops.difference(im.convert("RGB"), bg).getbbox()
    return im.crop(bbox) if bbox else im

n = 0
for p in sorted(glob.glob(os.path.join(SRC, "*.png"))):
    im = Image.open(p).convert("RGBA")
    im = trim(im)
    inner = int(SIZE * (1 - 2 * PAD))
    w, h = im.size
    scale = min(inner / w, inner / h)
    nw, nh = max(1, int(w * scale)), max(1, int(h * scale))
    im = im.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    canvas.paste(im, ((SIZE - nw) // 2, (SIZE - nh) // 2), im)
    name = os.path.splitext(os.path.basename(p))[0] + ".webp"
    canvas.save(os.path.join(OUT, name), "WEBP", quality=84, method=6)
    n += 1

tot = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
print(f"Vignettes : {n}  •  {tot/1024/1024:.1f} MB")
