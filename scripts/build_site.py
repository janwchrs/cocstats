#!/usr/bin/env python3
"""Fasst data/ zu kompakten JSON-Dateien für das Dashboard zusammen (site/data/)."""
import json
import os
import shutil
from datetime import datetime, timezone

from coc import DATA, ROOT, coc_time, read_json, read_jsonl, tag_dir
from fetch import categories
from progress import GAMEDATA, plan

OUT = ROOT / "site" / "data"
MAX_WARS = 60
MAX_RAIDS = 26
ACTIVITY_DAYS = 400
MAX_UPGRADES = 300


def names():
    """Englisch -> Deutsch für Einheiten, Erfolge und Ligen."""
    units = {key.split(":", 1)[1]: u["de"] for key, u in GAMEDATA["units"].items() if u.get("de")}
    return {**units, **GAMEDATA["names"]}


def write_out(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def units(cats):
    return {k: [[u["name"], u["level"], u["maxLevel"]] for u in v] for k, v in cats.items()}


def activity(path):
    """Tägliche Stände aller Erfolgszähler als Reihen: {days: [...], values: {name: [...]}}."""
    rows = read_jsonl(path / "achievements.jsonl")[-ACTIVITY_DAYS:]
    names = sorted({k for r in rows for k in r["a"]})
    return {"days": [r["d"] for r in rows], "values": {n: [r["a"].get(n) for r in rows] for n in names}}


def upgrades(path):
    """Level-Änderungen als Ereignisse. Die erste Zeile ist nur der Ausgangsstand."""
    rows = read_jsonl(path / "levels.jsonl")
    current = dict(rows[0]["u"]) if rows else {}
    events = []
    for row in rows[1:]:
        for unit, level in row["u"].items():
            events.append({"t": row["t"], "unit": unit, "from": current.get(unit), "to": level})
            current[unit] = level
    return events[::-1][:MAX_UPGRADES]


def rankings_for(tag):
    rows = read_jsonl(DATA / "rankings.jsonl")
    return {"d": rows[-1]["d"], **rows[-1]["r"].get(tag, {})} if rows else None


def build_player(path):
    p = read_json(path / "player.json")
    if not p:
        return None
    pl = plan(p)
    write_out(OUT / "p" / f"{tag_dir(p['tag'])}.json", {
        "player": p,
        "plan": pl,
        "units": units(categories(p)),
        "history": read_jsonl(path / "history.jsonl"),
        "activity": activity(path),
        "upgrades": upgrades(path),
        "rankings": rankings_for(p["tag"]),
    })
    league = p.get("leagueTier") or p.get("league") or {}
    clan = p.get("clan") or {}
    heroes = [[u["n"], u["l"], u["cap"]] for u in pl["units"] if u["c"] == "heroes"]
    return {"tag": p["tag"], "name": p["name"], "th": p.get("townHallLevel"), "xp": p.get("expLevel"),
            "trophies": p.get("trophies"), "bestTrophies": p.get("bestTrophies"), "warStars": p.get("warStars"),
            "league": league.get("name"), "leagueIcon": (league.get("iconUrls") or {}).get("small"),
            "clanTag": clan.get("tag"), "clanName": clan.get("name"), "role": p.get("role"),
            "progress": pl["overall"], "rush": pl["rush"], "queues": pl["queues"], "heroes": heroes}


def war_summary(war, our_tag, kind):
    us, them = war["clan"], war["opponent"]
    if us.get("tag") != our_tag:
        us, them = them, us
    if us.get("tag") != our_tag:
        return None
    defenders = {m["tag"]: m for m in them.get("members", [])}
    members = []
    for m in sorted(us.get("members", []), key=lambda m: m.get("mapPosition", 0)):
        attacks = []
        for a in m.get("attacks", []):
            d = defenders.get(a.get("defenderTag"), {})
            attacks.append({"s": a.get("stars"), "d": a.get("destructionPercentage"),
                            "th": d.get("townhallLevel"), "pos": d.get("mapPosition")})
        members.append({"tag": m["tag"], "name": m["name"], "th": m.get("townhallLevel"),
                        "pos": m.get("mapPosition"), "attacks": attacks})
    result = None
    if war.get("state") == "warEnded":
        a = (us.get("stars", 0), us.get("destructionPercentage", 0))
        b = (them.get("stars", 0), them.get("destructionPercentage", 0))
        result = "win" if a > b else "lose" if a < b else "tie"
    side = lambda c: {"tag": c.get("tag"), "name": c.get("name"), "stars": c.get("stars"),
                      "destruction": round(c.get("destructionPercentage", 0), 2), "attacks": c.get("attacks"),
                      "badge": (c.get("badgeUrls") or {}).get("small")}
    return {"type": kind, "state": war.get("state"), "start": war.get("preparationStartTime"),
            "end": war.get("endTime"), "teamSize": war.get("teamSize"),
            "attacksPerMember": war.get("attacksPerMember", 1 if kind == "cwl" else 2),
            "us": side(us), "them": side(them), "result": result, "members": members}


def build_clan(path):
    c = read_json(path / "clan.json")
    if not c:
        return None
    tag = c["tag"]

    wars = [war_summary(read_json(f), tag, "regular") for f in (path / "wars").glob("*.json")]
    for season in (path / "cwl").glob("*"):
        wars += [war_summary(read_json(f), tag, "cwl") for f in season.glob("*.json") if f.name != "group.json"]
    wars = sorted((w for w in wars if w), key=lambda w: w["start"] or "", reverse=True)[:MAX_WARS]

    warlog = [{"end": w.get("endTime"), "result": w.get("result"), "teamSize": w.get("teamSize"),
               "opponent": (w.get("opponent") or {}).get("name"),
               "stars": [(w.get("clan") or {}).get("stars"), (w.get("opponent") or {}).get("stars")],
               "destruction": [round((w.get("clan") or {}).get("destructionPercentage", 0), 1),
                               round((w.get("opponent") or {}).get("destructionPercentage", 0), 1)]}
              for w in read_json(path / "warlog.json", [])]

    # Wurde das Kriegsende zwischen zwei Abrufen verpasst, ergänzt der Kriegslog das Endergebnis.
    by_end = {w["end"]: w for w in warlog}
    now = datetime.now(timezone.utc)
    for w in wars:
        if w["state"] != "warEnded" and w["end"] and coc_time(w["end"]) < now:
            w["state"] = "warEnded"
            logged = by_end.get(w["end"])
            if logged:
                w["result"] = logged["result"]
                w["us"]["stars"], w["them"]["stars"] = logged["stars"]
                w["us"]["destruction"], w["them"]["destruction"] = logged["destruction"]
            else:
                a = (w["us"]["stars"] or 0, w["us"]["destruction"])
                b = (w["them"]["stars"] or 0, w["them"]["destruction"])
                w["result"] = "win" if a > b else "lose" if a < b else "tie"

    raids = []
    for f in sorted((path / "raids").glob("*.json"), reverse=True)[:MAX_RAIDS]:
        r = read_json(f)
        raids.append({"start": r.get("startTime"), "end": r.get("endTime"), "state": r.get("state"),
                      "loot": r.get("capitalTotalLoot"), "raids": r.get("raidsCompleted"),
                      "attacks": r.get("totalAttacks"), "districts": r.get("enemyDistrictsDestroyed"),
                      "offReward": r.get("offensiveReward"), "defReward": r.get("defensiveReward"),
                      "members": [{"tag": m["tag"], "name": m["name"], "attacks": m.get("attacks"),
                                   "limit": m.get("attackLimit", 0) + m.get("bonusAttackLimit", 0),
                                   "loot": m.get("capitalResourcesLooted")} for m in r.get("members", [])]})

    # Beitritte und Austritte aus den täglichen Mitglieder-Schnappschüssen ableiten.
    snapshots = read_jsonl(path / "members.jsonl")
    moves = []
    for prev, cur in zip(snapshots, snapshots[1:]):
        before = {m[0]: m[1] for m in prev["m"]}
        after = {m[0]: m[1] for m in cur["m"]}
        moves += [{"d": cur["d"], "type": "join", "tag": t, "name": n} for t, n in after.items() if t not in before]
        moves += [{"d": cur["d"], "type": "leave", "tag": t, "name": n} for t, n in before.items() if t not in after]

    write_out(OUT / "c" / f"{tag_dir(tag)}.json", {
        "clan": c,
        "history": read_jsonl(path / "history.jsonl"),
        "wars": wars,
        "warlog": warlog,
        "raids": raids,
        "moves": moves[::-1][:200],
        "rankings": rankings_for(tag),
    })
    return {"tag": tag, "name": c["name"], "level": c.get("clanLevel"), "members": c.get("members"),
            "badge": (c.get("badgeUrls") or {}).get("small")}


def main():
    if OUT.exists():
        shutil.rmtree(OUT)
    meta = read_json(DATA / "meta.json", {})
    order = lambda tags: {tag_dir(t): i for i, t in enumerate(tags)}
    p_order, c_order = order(meta.get("players", [])), order(meta.get("clans", []))

    players = [build_player(d) for d in sorted((DATA / "players").glob("*")) if d.is_dir()]
    clans = [build_clan(d) for d in sorted((DATA / "clans").glob("*")) if d.is_dir()]
    # Nur aktuell konfigurierte Accounts zeigen, in der Reihenfolge aus config.json.
    players = sorted((p for p in players if p and tag_dir(p["tag"]) in p_order), key=lambda p: p_order[tag_dir(p["tag"])])
    clans = sorted((c for c in clans if c and tag_dir(c["tag"]) in c_order), key=lambda c: c_order[tag_dir(c["tag"])])

    write_out(OUT / "index.json", {"updated": meta.get("updated"), "players": players, "clans": clans,
                                    "configured": {"players": meta.get("players", []), "clans": meta.get("clans", [])},
                                    "repo": os.environ.get("GITHUB_REPOSITORY"),
                                    "errors": meta.get("errors", []),
                                    "names": names(),
                                    "goldpass": read_json(DATA / "goldpass.json")})
    print(f"Dashboard-Daten: {len(players)} Spieler, {len(clans)} Clans -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
