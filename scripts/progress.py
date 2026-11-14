"""Fortschritt eines Spielers gemessen am Maximum seines Rathauses (nicht am Maximum im ganzen Spiel)."""
import json
from pathlib import Path

GAMEDATA = json.loads((Path(__file__).resolve().parent / "gamedata.json").read_text(encoding="utf-8"))
UNITS = GAMEDATA["units"]
SUPER_TROOPS = {"Sneaky Goblin", "Rocket Balloon", "Inferno Dragon", "Ice Hound"}
# Reihenfolge im Dashboard; "builder" wird nur am Spielmaximum gemessen (keine Builder-Hall-Daten).
CATEGORIES = ["heroes", "equipment", "pets", "troops", "siege", "spells", "builder"]
HOME = CATEGORIES[:-1]
# Was in welchem Gebäude nacheinander läuft.
QUEUES = {"lab": ("troops", "siege", "spells"), "heroes": ("heroes",), "pets": ("pets",)}


def is_super(name):
    return name.startswith("Super ") or name in SUPER_TROOPS


def cap_at(levels, th):
    return max((i + 1 for i, (req, _, _) in enumerate(levels) if req <= th), default=0)


def add_cost(total, cost):
    if isinstance(cost, list):
        return [a + b for a, b in zip(total or [0, 0, 0], cost)]
    return (total or 0) + cost


def unit_entry(name, village, kind, level, max_level, th, equipped, heroes_of):
    data = UNITS.get(f"{village}:{name}")
    if village == "builderBase":
        cat = "builder"
    elif data:
        cat = data["cat"]
    else:
        cat = {"heroEquipment": "equipment", "spells": "spells", "heroes": "heroes"}.get(kind, "troops")
    entry = {"n": name, "c": cat, "l": level, "max": max_level}

    if cat == "builder":
        # Für die Builder Base fehlen Builder-Hall-Daten: Hier zählt das Spielmaximum.
        entry.update(cap=max_level, prev=None, known=True)
    elif not data:
        # Neuer als die Spieldaten: kein Rathaus-Maximum bekannt, zählt nicht in den Fortschritt.
        entry.update(cap=None, prev=None, known=False)
    else:
        levels = data["levels"]
        # Spieldaten können älter sein als das Spiel: Ein höheres Level als erwartet gilt als erreicht.
        cap = min(max(cap_at(levels, th), level), max_level)
        # Ausrüstung hängt am Erz, nicht am Rathaus: Sie zählt nicht als Rückstand.
        prev = None if cat == "equipment" else min(cap_at(levels, th - 1), cap)
        cost, time = None, 0
        for n in range(level, cap):
            if n - 1 < len(levels):
                cost = add_cost(cost, levels[n - 1][1])
                time += levels[n - 1][2]
        entry.update(cap=cap, prev=prev, cost=cost, time=time, res=data["res"], known=True)
        if level < cap and level - 1 < len(levels):
            entry.update(nextCost=levels[level - 1][1], nextTime=levels[level - 1][2])

    if cat == "equipment":
        entry["hero"] = (data or {}).get("hero") or heroes_of.get(name)
        entry["rarity"] = (data or {}).get("rarity")
        entry["eq"] = name in equipped
    return entry


def plan(p):
    th = p.get("townHallLevel") or 1
    equipped, heroes_of = set(), {}
    for h in p.get("heroes", []):
        for e in h.get("equipment", []):
            equipped.add(e["name"])
            heroes_of[e["name"]] = h["name"]

    units = []
    for kind in ("heroes", "heroEquipment", "troops", "spells"):
        for u in p.get(kind, []):
            if kind == "troops" and is_super(u["name"]):
                continue
            village = u.get("village", "home")
            units.append(unit_entry(u["name"], village, kind, u["level"], u["maxLevel"], th, equipped, heroes_of))

    summary = {}
    for cat in CATEGORIES:
        items = [u for u in units if u["c"] == cat and u["cap"] is not None]
        if not items:
            continue
        s = {"units": len(items), "maxed": sum(u["l"] >= u["cap"] for u in items),
             "done": sum(min(u["l"], u["cap"]) for u in items), "total": sum(u["cap"] for u in items),
             "rush": sum(1 for u in items if u.get("prev") and u["l"] < u["prev"]), "time": 0, "cost": {}}
        for u in items:
            s["time"] += u.get("time") or 0
            if u.get("cost"):
                s["cost"][u["res"]] = add_cost(s["cost"].get(u["res"]), u["cost"])
        summary[cat] = s

    home = [summary[c] for c in HOME if c in summary]
    done, total = sum(s["done"] for s in home), sum(s["total"] for s in home)
    return {
        "th": th,
        "stand": GAMEDATA["stand"],
        "units": units,
        "summary": summary,
        "overall": round(100 * done / total, 1) if total else None,
        "rush": sum(s["rush"] for s in home),
        "queues": {q: sum(summary.get(c, {}).get("time", 0) for c in cats) for q, cats in QUEUES.items()},
    }
