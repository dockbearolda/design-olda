#!/usr/bin/env python3
"""Déduplique le catalogue : une catégorie ne doit JAMAIS afficher deux fois la
même image (même fichier `img`). On garde la 1re occurrence (réf d'origine) et on
retire les suivantes.

Portée : familles gérées par CETTE app (Logos, Objets). La famille « Textile » est
gérée sur une autre app → on n'y touche pas.

Idempotent : relancer ne retire plus rien. Réversible : `git checkout data/catalog.json`.

Usage :
  python3 scripts/dedupe_catalog.py            # applique + rapport
  python3 scripts/dedupe_catalog.py --dry-run  # rapport seulement
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / "data" / "catalog.json"
SKIP_FAMILIES = {"Textile"}  # géré ailleurs — hors périmètre


def main():
    dry = "--dry-run" in sys.argv
    data = json.loads(CATALOG.read_text(encoding="utf-8"))

    total_removed = 0
    for cat in data["categories"]:
        if cat.get("family") in SKIP_FAMILIES:
            continue
        seen = set()
        kept = []
        removed = []
        for item in cat["items"]:
            if item["img"] in seen:
                removed.append(item)
            else:
                seen.add(item["img"])
                kept.append(item)
        if removed:
            before = len(cat["items"])
            cat["items"] = kept
            total_removed += len(removed)
            print(f"[{cat['id']}] {before} -> {len(kept)} (retiré {len(removed)})")
            for r in removed:
                print(f"     - {r['ref']} ({r['img']})")

    print(f"\nTotal retiré : {total_removed}")
    if dry:
        print("(dry-run — aucun fichier écrit)")
        return
    if total_removed:
        # indent=0 + ensure_ascii=False : conserve le format d'origine (accents lisibles)
        CATALOG.write_text(
            json.dumps(data, indent=0, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        print(f"écrit : {CATALOG}")
    else:
        print("rien à faire (déjà propre)")


if __name__ == "__main__":
    main()
