#!/usr/bin/env python3
"""
Incruste un filigrane « OLDA » dans les images SERVIES (grille + lightbox),
pour qu'un client ne puisse pas récupérer un logo propre.

- Les originaux propres sont préservés une seule fois dans assets/_masters/logos/
  (jamais servis : server.js refuse les chemins commençant par « _ »).
- assets/logos/*.png  (lightbox)  ← filigranés depuis les masters
- assets/thumbs/*.webp (grille)   ← regénérés depuis les masters, puis filigranés

Filigrane = texte répété en diagonale, semi-transparent avec liseré,
visible aussi bien sur fond clair que sur logo sombre. Impossible à recadrer.

Relance : idempotent. Les masters ne sont copiés que s'ils n'existent pas déjà,
donc on filigrane toujours à partir du propre (jamais un filigrane sur filigrane).
"""
from PIL import Image, ImageDraw, ImageFont, ImageChops
import os, glob, shutil, math

ROOT    = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOGOS   = os.path.join(ROOT, "assets", "logos")     # servi (lightbox)
THUMBS  = os.path.join(ROOT, "assets", "thumbs")    # servi (grille)
MASTERS = os.path.join(ROOT, "assets", "_masters", "logos")  # propre, non servi

TEXT  = "S P É C I M E N"   # filigrane discret, ton épreuve / haut de gamme
ANGLE = -30
SIZE  = 640      # canvas vignette (identique à thumbs.py)
PAD   = 0.14

def load_font(px):
    for p in ("/System/Library/Fonts/Supplemental/Arial Bold.ttf",
              "/System/Library/Fonts/Helvetica.ttc",
              "/Library/Fonts/Arial.ttf"):
        try:
            return ImageFont.truetype(p, px)
        except Exception:
            pass
    try:
        return ImageFont.load_default(size=px)   # Pillow >= 10.1 : DejaVu scalable
    except TypeError:
        return ImageFont.load_default()

def watermark(base):
    """Renvoie une copie RGBA de `base` avec le filigrane diagonal incrusté."""
    base = base.convert("RGBA")
    W, H = base.size
    fs = max(11, int(min(W, H) * 0.085))
    font = load_font(fs)

    meas = ImageDraw.Draw(Image.new("RGBA", (4, 4)))
    l, t, r, b = meas.textbbox((0, 0), TEXT, font=font, stroke_width=1)
    tw, th = r - l, b - t
    gx = int(tw * 2.6)        # espacement horizontal (clairsemé = discret)
    gy = int(th * 4.2)        # espacement vertical

    diag = int(math.hypot(W, H)) + gy
    layer = Image.new("RGBA", (diag, diag), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    row = 0
    for y in range(0, diag, gy):
        dx = (row % 2) * (gx // 2)        # rangées décalées
        for x in range(-gx, diag, gx):
            ld.text((x + dx, y), TEXT, font=font,
                    fill=(255, 255, 255, 42),
                    stroke_width=1, stroke_fill=(0, 0, 0, 26))
        row += 1

    layer = layer.rotate(ANGLE, resample=Image.BICUBIC, expand=False)
    left, top = (diag - W) // 2, (diag - H) // 2
    layer = layer.crop((left, top, left + W, top + H))
    return Image.alpha_composite(base, layer)

def trim(im):
    bbox = im.split()[3].getbbox() if im.mode == "RGBA" else \
        ImageChops.difference(im.convert("RGB"),
                              Image.new("RGB", im.size, (255, 255, 255))).getbbox()
    return im.crop(bbox) if bbox else im

def to_thumb_canvas(master):
    im = trim(Image.open(master).convert("RGBA"))
    inner = int(SIZE * (1 - 2 * PAD))
    w, h = im.size
    s = min(inner / w, inner / h)
    nw, nh = max(1, int(w * s)), max(1, int(h * s))
    im = im.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    canvas.paste(im, ((SIZE - nw) // 2, (SIZE - nh) // 2), im)
    return canvas

def main():
    # 1) Préserver les originaux propres (une seule fois)
    if not os.path.isdir(MASTERS):
        os.makedirs(MASTERS)
        for p in glob.glob(os.path.join(LOGOS, "*.png")):
            shutil.copy2(p, os.path.join(MASTERS, os.path.basename(p)))
        print(f"Masters propres sauvegardés : {len(os.listdir(MASTERS))} → assets/_masters/logos/")
    else:
        print(f"Masters déjà présents ({len(os.listdir(MASTERS))}), filigrane depuis le propre.")

    os.makedirs(THUMBS, exist_ok=True)
    n = 0
    for p in sorted(glob.glob(os.path.join(MASTERS, "*.png"))):
        name = os.path.splitext(os.path.basename(p))[0]
        # lightbox : PNG plein filigrané
        watermark(Image.open(p)).save(os.path.join(LOGOS, name + ".png"), "PNG", optimize=True)
        # grille : vignette webp filigranée
        watermark(to_thumb_canvas(p)).save(
            os.path.join(THUMBS, name + ".webp"), "WEBP", quality=84, method=6)
        n += 1
    print(f"Filigrane « {TEXT} » incrusté sur {n} logos (PNG + WebP).")

if __name__ == "__main__":
    main()
