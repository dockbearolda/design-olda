# OLDA · Catalogue Design 2025

Catalogue virtuel haut de gamme des logos OLDA — **217 visuels** Saint-Martin / French
West Indies, répartis en **16 collections** et **3 univers** (Logos, Textile, Objets).

Site **statique, sans dépendance, sans build** : un `index.html`, du CSS, du JS vanilla
et des images. Façon Apple : papier chaud, accent océan, typo Fraunces + Geist,
révélations au scroll, recherche live, lightbox avec copie de référence.

## Lancer en local

```bash
python3 -m http.server 8753
# puis ouvrir http://127.0.0.1:8753
```

(Un simple serveur statique suffit — `npx serve`, nginx, ou n'importe quel hébergeur
de fichiers statiques : GitHub Pages, Netlify, Vercel, Railway…)

## Structure

```
index.html              Page unique
assets/css/style.css    Thème + mise en page
assets/js/app.js        Rendu du catalogue, filtres, recherche, lightbox
data/catalog.json       Données générées (catégories → {ref, image})
assets/logos/*.png      Logos pleine résolution (lightbox)
assets/thumbs/*.webp    Vignettes carrées optimisées (grille)
scripts/extract.py      Excel → catalog.json + logos PNG dédupliqués
scripts/thumbs.py       PNG → vignettes WebP rognées/centrées
```

## Régénérer depuis un nouvel Excel

Le catalogue est entièrement reconstruit depuis le fichier source
`DESIGN OLDA 2025.xlsx` (logos = images intégrées, références = libellé de la cellule
juste au-dessus de chaque image).

```bash
# 1. ajuster le chemin SRC en tête de scripts/extract.py si besoin
python3 scripts/extract.py    # -> data/catalog.json + assets/logos/
python3 scripts/thumbs.py     # -> assets/thumbs/
```

Dépendances Python : `openpyxl`, `Pillow`.

## Ajouter une catégorie

Les feuilles Excel sont mappées vers des collections éditoriales (titre, sous-titre,
univers) dans le dictionnaire `SHEETS` en tête de `scripts/extract.py`. Ajouter une
entrée pour intégrer une nouvelle feuille.
