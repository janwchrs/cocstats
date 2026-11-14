#!/usr/bin/env python3
"""Ruft alle Daten der konfigurierten Spieler und Clans ab und legt sie unter data/ ab.

Es wird nur geschrieben, was sich geändert hat, damit die Git-Historie schlank bleibt.
"""
import json
import os
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from coc import (DATA, ROOT, ApiError, append_if_changed, enc, get, norm_tag, now_iso, read_json, read_jsonl,
                 tag_dir, upsert_daily, write_json)

SUPER_TROOPS = {"Sneaky Goblin", "Rocket Balloon", "Inferno Dragon", "Ice Hound"}
PETS = {"L.A.S.S.I", "Electro Owl", "Mighty Yak", "Unicorn", "Frosty", "Diggy", "Poison Lizard",
        "Phoenix", "Spirit Fox", "Angry Jelly", "Sneezy", "Greedy Raven"}

changed = []
errors = []
lock = threading.Lock()


def today():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def note(path, did_change):
    if did_change:
        with lock:
            changed.append(str(path.relative_to(ROOT)))


def describe(err):
    if isinstance(err, ApiError):
        if err.status == 404:
            return "nicht gefunden (Tag prüfen)"
        if err.status == 403:
            return "Zugriff verweigert (API-Key oder dessen IP-Freigabe prüfen)"
        return f"Fehler {err.status} ({err.reason})"
    return str(err)


def fail(what, err):
    with lock:
        errors.append((what, err))
    print(f"FEHLER {what}: {err}", file=sys.stderr)


def is_super(unit):
    return unit["name"].startswith("Super ") or unit["name"] in SUPER_TROOPS


def categories(p):
    """Teilt alle Einheiten eines Spielers in Kategorien auf (wird auch vom Dashboard genutzt)."""
    home = lambda u: u.get("village") == "home"
    troops = [u for u in p.get("troops", []) if home(u) and not is_super(u)]
    return {
        "troops": [u for u in troops if u["name"] not in PETS],
        "pets": [u for u in troops if u["name"] in PETS],
        "spells": [u for u in p.get("spells", []) if home(u)],
        "heroes": [u for u in p.get("heroes", []) if home(u)],
        "equipment": p.get("heroEquipment", []),
        "builder": [u for u in p.get("troops", []) + p.get("heroes", []) if u.get("village") == "builderBase"],
    }


def progress(units):
    total = sum(u["maxLevel"] for u in units)
    return round(100 * sum(u["level"] for u in units) / total, 1) if total else None


def player_metrics(p):
    cats = categories(p)
    return {
        "t": now_iso(),
        "th": p.get("townHallLevel"),
        "xp": p.get("expLevel"),
        "trophies": p.get("trophies"),
        "bestTrophies": p.get("bestTrophies"),
        "warStars": p.get("warStars"),
        "attackWins": p.get("attackWins"),
        "defenseWins": p.get("defenseWins"),
        "donations": p.get("donations"),
        "received": p.get("donationsReceived"),
        "bbTrophies": p.get("builderBaseTrophies"),
        "capital": p.get("clanCapitalContributions"),
        "league": (p.get("leagueTier") or p.get("league") or {}).get("name"),
        "bbLeague": (p.get("builderBaseLeague") or {}).get("name"),
        "legendTrophies": (p.get("legendStatistics") or {}).get("legendTrophies"),
        "warPref": p.get("warPreference"),
        "heroes": {h["name"]: h["level"] for h in cats["heroes"]},
        "progress": {k: progress(v) for k, v in cats.items()},
    }


def unit_levels(p):
    """Level aller Einheiten. Builder-Base-Einheiten bekommen ein Präfix, weil Namen doppelt vorkommen."""
    levels = {}
    for kind in ("troops", "spells", "heroes", "heroEquipment"):
        for u in p.get(kind, []):
            if kind == "troops" and is_super(u):
                continue
            levels[("BB " if u.get("village") == "builderBase" else "") + u["name"]] = u["level"]
    return levels


def achievement_values(p):
    values = {}
    for a in p.get("achievements", []):
        key = a["name"] if a["name"] not in values else f"{a['name']} ({a.get('village')})"
        values[key] = a.get("value")
    return values


def append_level_changes(path, levels):
    """levels.jsonl enthält nur Änderungen; die erste Zeile ist der Ausgangsstand."""
    current = {}
    for row in read_jsonl(path):
        current.update(row["u"])
    diff = {k: v for k, v in levels.items() if current.get(k) != v}
    if not diff:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps({"t": now_iso(), "u": diff}, ensure_ascii=False, separators=(",", ":")) + "\n")
    return True


def fetch_player(tag):
    try:
        p = get(f"/players/{enc(tag)}")
    except ApiError as e:
        fail(f"Spieler {tag}", e)
        return None
    base = DATA / "players" / tag_dir(tag)
    note(base / "player.json", write_json(base / "player.json", p))
    note(base / "history.jsonl", append_if_changed(base / "history.jsonl", player_metrics(p)))
    note(base / "levels.jsonl", append_level_changes(base / "levels.jsonl", unit_levels(p)))
    # Erfolge sind fortlaufende Zähler (Beute, Spenden, Clanspiele …): einmal pro Tag festhalten.
    note(base / "achievements.jsonl",
         upsert_daily(base / "achievements.jsonl", {"d": today(), "a": achievement_values(p)}))
    return p


def fetch_clan(tag):
    try:
        c = get(f"/clans/{enc(tag)}")
    except ApiError as e:
        fail(f"Clan {tag}", e)
        return None
    base = DATA / "clans" / tag_dir(tag)
    note(base / "clan.json", write_json(base / "clan.json", c))

    metrics = {
        "t": now_iso(),
        "level": c.get("clanLevel"),
        "points": c.get("clanPoints"),
        "bbPoints": c.get("clanBuilderBasePoints"),
        "capitalPoints": c.get("clanCapitalPoints"),
        "members": c.get("members"),
        "warWins": c.get("warWins"),
        "warLosses": c.get("warLosses"),
        "warTies": c.get("warTies"),
        "warWinStreak": c.get("warWinStreak"),
        "warLeague": (c.get("warLeague") or {}).get("name"),
        "capitalLeague": (c.get("capitalLeague") or {}).get("name"),
        "capitalHall": (c.get("clanCapital") or {}).get("capitalHallLevel"),
        "requiredTrophies": c.get("requiredTrophies"),
    }
    note(base / "history.jsonl", append_if_changed(base / "history.jsonl", metrics))

    # Ein Mitglieder-Schnappschuss pro Tag (Spenden werden monatlich zurückgesetzt).
    members = [[m["tag"], m["name"], m.get("role"), m.get("townHallLevel"), m.get("expLevel"), m.get("trophies"),
                m.get("donations"), m.get("donationsReceived"), m.get("builderBaseTrophies")]
               for m in c.get("memberList", [])]
    note(base / "members.jsonl", upsert_daily(base / "members.jsonl", {"d": today(), "m": members}))

    if c.get("isWarLogPublic"):
        fetch_warlog(tag, base)
        fetch_current_war(tag, base)
    fetch_cwl(tag, base)
    fetch_raids(tag, base)
    return c


def fetch_warlog(tag, base):
    try:
        items = get(f"/clans/{enc(tag)}/warlog", {"limit": 50}).get("items", [])
    except ApiError as e:
        if e.status != 403:
            fail(f"Kriegslog {tag}", e)
        return
    path = base / "warlog.json"
    merged = {w["endTime"]: w for w in read_json(path, [])}
    merged.update({w["endTime"]: w for w in items})
    note(path, write_json(path, sorted(merged.values(), key=lambda w: w["endTime"], reverse=True)))


def fetch_current_war(tag, base):
    try:
        war = get(f"/clans/{enc(tag)}/currentwar")
    except ApiError as e:
        if e.status not in (403, 404):
            fail(f"Aktueller Krieg {tag}", e)
        return
    if war.get("state") in ("preparation", "inWar", "warEnded") and war.get("preparationStartTime"):
        path = base / "wars" / f"{war['preparationStartTime'][:15]}.json"
        note(path, write_json(path, war))


def fetch_cwl(tag, base):
    try:
        group = get(f"/clans/{enc(tag)}/currentwar/leaguegroup")
    except ApiError as e:
        if e.status not in (403, 404):
            fail(f"CWL-Gruppe {tag}", e)
        return
    if not group.get("season"):
        return
    season_dir = base / "cwl" / group["season"]
    note(season_dir / "group.json", write_json(season_dir / "group.json", group))

    todo = []
    for rnd in group.get("rounds", []):
        for war_tag in rnd.get("warTags", []):
            if war_tag == "#0":
                continue
            path = season_dir / f"{tag_dir(war_tag)}.json"
            if (read_json(path) or {}).get("state") != "warEnded":
                todo.append((war_tag, path))

    def load(item):
        war_tag, path = item
        try:
            war = get(f"/clanwarleagues/wars/{enc(war_tag)}")
            war["warTag"] = war_tag
            note(path, write_json(path, war))
        except ApiError as e:
            fail(f"CWL-Krieg {war_tag}", e)

    with ThreadPoolExecutor(6) as ex:
        list(ex.map(load, todo))


def fetch_raids(tag, base):
    try:
        items = get(f"/clans/{enc(tag)}/capitalraidseasons", {"limit": 10}).get("items", [])
    except ApiError as e:
        if e.status not in (403, 404):
            fail(f"Raids {tag}", e)
        return
    for season in items:
        path = base / "raids" / f"{season['startTime'][:8]}.json"
        note(path, write_json(path, season))


RANKINGS = ["players", "players-builder-base", "clans", "clans-builder-base", "capitals"]


def fetch_rankings(players, clans):
    """Einmal pro Tag: Platzierungen in den Top-200-Ranglisten (weltweit und im Land der Clans)."""
    path = DATA / "rankings.jsonl"
    rows = read_jsonl(path)
    if rows and rows[-1]["d"] == today():
        return
    locations = {"global": "Global"}
    for c in clans:
        loc = c.get("location") or {}
        if loc.get("isCountry"):
            locations[str(loc["id"])] = loc["name"]
    ours = set(players) | {c["tag"] for c in clans}
    jobs = [(loc, kind) for loc in locations for kind in RANKINGS]

    def load(job):
        loc, kind = job
        try:
            items = get(f"/locations/{loc}/rankings/{kind}", {"limit": 200}).get("items", [])
        except ApiError as e:
            fail(f"Rangliste {loc}/{kind}", e)
            return job, None
        return job, {i["tag"]: i.get("rank") for i in items if i["tag"] in ours}

    found = {}
    with ThreadPoolExecutor(6) as ex:
        for (loc, kind), hits in ex.map(load, jobs):
            for tag, rank in (hits or {}).items():
                found.setdefault(tag, {}).setdefault(kind, {})[locations[loc]] = rank
    note(path, upsert_daily(path, {"d": today(), "r": found}))


def fetch_goldpass():
    try:
        gp = get("/goldpass/seasons/current")
    except ApiError as e:
        fail("Gold Pass", e)
        return
    note(DATA / "goldpass.json", write_json(DATA / "goldpass.json", gp))


def main():
    cfg = read_json(ROOT / "config.json", {})
    players = list(dict.fromkeys(norm_tag(t) for t in cfg.get("players", [])))
    clans = [norm_tag(t) for t in cfg.get("clans", [])]
    if not players and not clans:
        write_json(DATA / "meta.json", {"updated": None, "players": [], "clans": []})
        print("Noch keine Accounts eingetragen. Sie werden im Dashboard unter 'Verwalten' hinzugefügt.")
        return
    if not os.environ.get("COC_API_TOKEN"):
        problem = "Das Secret COC_API_TOKEN fehlt (GitHub → Settings → Secrets and variables → Actions)."
        write_json(DATA / "meta.json", {**read_json(DATA / "meta.json", {}), "players": players, "clans": clans,
                                        "errors": [problem]})
        sys.exit(problem)

    with ThreadPoolExecutor(8) as ex:
        gp = ex.submit(fetch_goldpass)
        results = list(ex.map(fetch_player, players))
        gp.result()

    if cfg.get("includePlayerClans", True):
        clans += [p["clan"]["tag"] for p in results if p and p.get("clan")]
    clans = list(dict.fromkeys(clans))

    with ThreadPoolExecutor(8) as ex:
        clan_data = [c for c in ex.map(fetch_clan, clans) if c]

    fetch_rankings(players, clan_data)

    # Die Listen immer aktuell halten, damit entfernte Accounts sofort aus dem Dashboard verschwinden.
    old = read_json(DATA / "meta.json", {})
    problems = [f"{what}: {describe(e)}" for what, e in errors]
    write_json(DATA / "meta.json", {"updated": now_iso() if changed else old.get("updated"),
                                    "players": players, "clans": clans, "errors": problems})

    print(f"{len(players)} Spieler, {len(clans)} Clans, {len(changed)} geänderte Dateien, {len(errors)} Fehler")
    for path in sorted(changed):
        print("  ~", path)

    # Zugriffsfehler (falscher Key, falsche IP) sollen den Lauf rot färben.
    if any(isinstance(e, ApiError) and e.status == 403 for what, e in errors if what.startswith("Spieler")):
        sys.exit(1)


if __name__ == "__main__":
    main()
