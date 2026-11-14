#!/usr/bin/env python3
"""Erzeugt scripts/gamedata.json aus der static_data.json von coc.py (MIT-Lizenz).

Die CoC-API liefert nur das höchste Level im ganzen Spiel. Welches Level auf welchem Rathaus möglich ist und was
ein Upgrade kostet, steht nur in den Spieldaten. Aufruf:

    python3 scripts/update_gamedata.py <coc/static/static_data.json> <coc/static/translations.json> <stand, z. B. 2025-12-01>

Bedeutung pro Level-Eintrag N: Rathaus, das für Level N nötig ist, sowie Kosten und Dauer für das Upgrade N -> N+1.
"""
import json
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent / "gamedata.json"
ORES = ("shiny_ore", "glowy_ore", "starry_ore")


def category(kind, item):
    if item.get("village") == "builderBase":
        return "builder"
    if kind == "troops":
        return "siege" if item.get("production_building") == "Workshop" else "troops"
    return kind


def main(src, translations, stand):
    data = json.loads(Path(src).read_text(encoding="utf-8"))
    tr = json.loads(Path(translations).read_text(encoding="utf-8"))
    de = lambda item: (tr.get((item.get("TID") or {}).get("name")) or {}).get("DE")
    units = {}
    for kind in ("troops", "spells", "heroes", "pets", "equipment"):
        for item in data[kind]:
            cat = category(kind, item)
            levels = []
            for lvl in item["levels"]:
                cost = lvl.get("upgrade_cost") or 0
                if isinstance(cost, dict):
                    cost = [cost.get(o, 0) for o in ORES]
                levels.append([lvl.get("required_townhall") or 0, cost, lvl.get("upgrade_time") or 0])
            village = "builderBase" if cat == "builder" else "home"
            entry = {"cat": cat, "de": de(item), "res": item.get("upgrade_resource"), "levels": levels}
            if kind == "equipment":
                entry.update(hero=item.get("hero"), rarity=item.get("rarity"), res="Ore")
            units[f"{village}:{item['name']}"] = entry
    # Deutsche Namen für Anzeigen, die die API nur auf Englisch liefert.
    names = {item["name"]: de(item) for key in ("achievements", "league_tiers", "war_leagues")
             for item in data[key] if de(item)}
    OUT.write_text(json.dumps({"source": "coc.py static_data.json (MIT)", "stand": stand, "units": units,
                               "names": names},
                              ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(units)} Einheiten -> {OUT.name} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main(*sys.argv[1:4])
