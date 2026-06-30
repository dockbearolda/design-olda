#!/usr/bin/env python3
"""Extrait les logos + références du fichier Excel OLDA vers un catalogue JSON
   et un dossier d'images dédupliquées."""
import openpyxl, hashlib, json, re, os, sys

# Chemin du classeur source : 1er argument CLI, sinon $OLDA_XLSX, sinon défaut local.
SRC = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("OLDA_XLSX", "DESIGN OLDA 2025.xlsx")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG_DIR = os.path.join(ROOT, "assets", "logos")
DATA = os.path.join(ROOT, "data", "catalog.json")
os.makedirs(IMG_DIR, exist_ok=True)

# Métadonnées éditoriales par feuille : titre propre + sous-titre + famille
SHEETS = {
    "ensemble logos négatif":  ("Logos monochromes",   "La collection complète en aplat une couleur", "Logos"),
    "Logos négatifs":          ("Logos monochromes",   "La collection complète en aplat une couleur", "Logos"),
    "Ensemble logos couleur":  ("Logos couleur",       "Nos visuels signature en pleine couleur",     "Logos"),
    "Logo Pochette":           ("Logos pochette",      "Petit format pour poitrine et pochette",      "Logos"),
    "AV logos Textile":        ("Textile — avant",     "Placement poitrine / cœur",                   "Textile"),
    "LOGO TEXTILE AV":         ("Textile — avant",     "Placement poitrine / cœur",                   "Textile"),
    "AR logos textile":        ("Textile — dos",       "Grand format dos",                            "Textile"),
    "ARAV logos -1H":          ("Textile express",     "Avant + arrière, prêt en moins d'une heure",  "Textile"),
    "Textile Femme":           ("Textile femme",       "Coupes et visuels féminins",                  "Textile"),
    "Porte-clés T49":          ("Porte-clés",          "Porte-clés personnalisés",                    "Objets"),
    "Porte-Clés":              ("Porte-clés",          "Porte-clés personnalisés",                    "Objets"),
    "Stock Porte-clés PLEXI":  ("Porte-clés plexi",    "Porte-clés plexiglas en stock",               "Objets"),
    "Magnet T49":              ("Magnets",             "Magnets souvenirs",                           "Objets"),
    "Magnet couleurs":         ("Magnets couleur",     "Magnets en pleine couleur",                   "Objets"),
    "Stock MAGNETS PLEXI":     ("Magnets plexi",       "Magnets plexiglas en stock",                  "Objets"),
    "Stickers":                ("Stickers",            "Autocollants découpés",                       "Objets"),
    "Tasses Céramique":        ("Tasses céramique",    "Mugs personnalisés",                          "Objets"),
    "Dessous de plat ":        ("Dessous de plat",     "Dessous de plat décorés",                     "Objets"),
    "Ardoise logos":           ("Ardoises",            "Ardoises gravées",                            "Objets"),
}

def slug(s):
    s = s.strip().lower()
    s = re.sub(r"[àâä]", "a", s); s = re.sub(r"[éèêë]", "e", s)
    s = re.sub(r"[ïî]", "i", s); s = re.sub(r"[ôö]", "o", s); s = re.sub(r"[ùûü]", "u", s)
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s

def is_title(v):
    v = v.strip().upper()
    return v.startswith("LOGOS ") or v in ("ARRIERE", "AVANT SUR COEUR", "POITRINE") \
        or v.startswith("COULEURS") or len(v) > 45

wb = openpyxl.load_workbook(SRC)
seen = {}            # hash -> filename
unique = 0

# Regroupe par catégorie éditoriale (plusieurs feuilles -> même catégorie)
cats = {}            # cat_id -> {title, subtitle, family, items:[]}
order = []

for ws in wb.worksheets:
    meta = SHEETS.get(ws.title)
    if not meta:
        continue
    title, subtitle, family = meta
    cid = slug(title)
    if cid not in cats:
        cats[cid] = {"id": cid, "title": title, "subtitle": subtitle,
                     "family": family, "items": []}
        order.append(cid)

    # cellules texte
    labels = []
    for r in ws.iter_rows():
        for c in r:
            if c.value is not None and str(c.value).strip():
                v = str(c.value).strip()
                if not is_title(v):
                    labels.append((c.row - 1, c.column - 1, v))

    used_label = set()
    for im in ws._images:
        fr = im.anchor._from
        ir, ic = fr.row, fr.col
        # meilleure étiquette : même colonne, ligne juste au-dessus de préférence
        best, bestscore = None, 1e9
        for idx, (tr, tc, v) in enumerate(labels):
            dcol = abs(tc - ic)
            if dcol > 2:
                continue
            drow = ir - tr
            if drow == 1:   rowpen = 0
            elif drow == 0: rowpen = 1
            elif drow == 2: rowpen = 2
            elif drow > 0:  rowpen = 3 + drow
            else:           rowpen = 6 + abs(drow)
            score = dcol * 50 + rowpen + (3 if idx in used_label else 0)
            if score < bestscore:
                bestscore, best = score, idx
        ref = labels[best][2] if best is not None else None
        if best is not None:
            used_label.add(best)

        data = im._data()
        h = hashlib.md5(data).hexdigest()[:12]
        if h not in seen:
            fname = f"{h}.png"
            with open(os.path.join(IMG_DIR, fname), "wb") as f:
                f.write(data)
            seen[h] = fname
            unique += 1
        cats[cid]["items"].append({"ref": ref or "—", "img": seen[h]})

# Dédup par (ref,img) au sein d'une catégorie + tri
families_order = ["Logos", "Textile", "Objets"]
out_cats = []
for cid in order:
    c = cats[cid]
    seen_pair = set()
    items = []
    for it in c["items"]:
        key = (it["ref"], it["img"])
        if key in seen_pair:
            continue
        seen_pair.add(key)
        items.append(it)
    c["items"] = items
    out_cats.append(c)

out_cats.sort(key=lambda c: (families_order.index(c["family"]) if c["family"] in families_order else 9, c["title"]))

catalog = {
    "brand": "OLDA",
    "families": families_order,
    "categories": out_cats,
    "stats": {
        "unique_images": unique,
        "categories": len(out_cats),
        "total_items": sum(len(c["items"]) for c in out_cats),
    },
}
with open(DATA, "w") as f:
    json.dump(catalog, f, ensure_ascii=False, indent=1)

print(f"Images uniques : {unique}")
print(f"Catégories     : {len(out_cats)}")
for c in out_cats:
    noref = sum(1 for i in c['items'] if i['ref'] == '—')
    print(f"  [{c['family']:7}] {c['title']:22} {len(c['items']):3} items  ({noref} sans réf)")
print(f"Total items    : {catalog['stats']['total_items']}")
