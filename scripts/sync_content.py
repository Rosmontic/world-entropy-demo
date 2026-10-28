"""Synchronize the independent card and artwork repositories into the DEMO.

Place world-entropy-demo, world-entropy-cards and world-entropy-assets in the
same parent directory, then run: python scripts/sync_content.py
"""
from pathlib import Path
import argparse
import shutil

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--cards", type=Path, help="Path to world-entropy-cards")
parser.add_argument("--assets", type=Path, help="Path to world-entropy-assets")
args = parser.parse_args()

root = Path(__file__).resolve().parents[1]
cards_repo = args.cards or root.parent / "world-entropy-cards"
assets_repo = args.assets or root.parent / "world-entropy-assets"

cards_source = cards_repo / "cards.json"
art_source = assets_repo / "cards"
if not cards_source.is_file():
    raise SystemExit(f"Card database not found: {cards_source}")
if not art_source.is_dir():
    raise SystemExit(f"Artwork directory not found: {art_source}")

card_target = root / "src" / "data" / "cards.json"
art_target = root / "public" / "art"
card_target.parent.mkdir(parents=True, exist_ok=True)
art_target.mkdir(parents=True, exist_ok=True)
shutil.copy2(cards_source, card_target)

source_images = {path.name for path in art_source.glob("*.svg")}
for old_file in art_target.glob("*.svg"):
    if old_file.name not in source_images:
        old_file.unlink()
for source in art_source.glob("*.svg"):
    shutil.copy2(source, art_target / source.name)

print(f"Synchronized {cards_source} -> {card_target}")
print(f"Synchronized {len(source_images)} SVG files -> {art_target}")
