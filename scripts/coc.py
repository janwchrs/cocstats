"""Gemeinsame Helfer: API-Zugriff und sparsames Schreiben von Dateien."""
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
API_BASE = os.environ.get("COC_API_BASE", "https://cocproxy.royaleapi.dev/v1").rstrip("/")
RETRY_STATUS = {429, 500, 502, 503, 504}


class ApiError(Exception):
    def __init__(self, status, reason, path):
        super().__init__(f"{status} {reason} ({path})")
        self.status = status
        self.reason = reason


def norm_tag(tag):
    tag = tag.strip().upper().replace("O", "0")
    return tag if tag.startswith("#") else "#" + tag


def tag_dir(tag):
    """Dateiname für einen Tag, ohne das '#'."""
    return norm_tag(tag).lstrip("#")


def enc(tag):
    return urllib.parse.quote(norm_tag(tag), safe="")


def get(path, params=None):
    token = os.environ.get("COC_API_TOKEN")
    if not token:
        raise SystemExit("COC_API_TOKEN ist nicht gesetzt.")
    url = API_BASE + path + ("?" + urllib.parse.urlencode(params) if params else "")
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}", "Accept": "application/json"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                return json.load(resp)
        except urllib.error.HTTPError as e:
            if e.code in RETRY_STATUS and attempt < 3:
                time.sleep(1.5 * 2 ** attempt)
                continue
            try:
                reason = json.load(e).get("reason", e.reason)
            except Exception:
                reason = e.reason
            raise ApiError(e.code, reason, path) from None
        except (urllib.error.URLError, TimeoutError):
            if attempt < 3:
                time.sleep(1.5 * 2 ** attempt)
                continue
            raise


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def coc_time(value):
    """'20261114T120000.000Z' -> datetime (UTC)."""
    return datetime.strptime(value, "%Y%m%dT%H%M%S.%fZ").replace(tzinfo=timezone.utc)


def dump(obj):
    return json.dumps(obj, ensure_ascii=False, indent=1) + "\n"


def write_json(path, obj):
    """Schreibt nur, wenn sich der Inhalt geändert hat. Gibt True bei Änderung zurück."""
    text = dump(obj)
    if path.exists() and path.read_text(encoding="utf-8") == text:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return True


def read_json(path, default=None):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default


def read_jsonl(path):
    try:
        with path.open(encoding="utf-8") as f:
            return [json.loads(line) for line in f if line.strip()]
    except FileNotFoundError:
        return []


def _last_line(path):
    try:
        with path.open("rb") as f:
            f.seek(0, os.SEEK_END)
            pos = f.tell()
            if pos == 0:
                return None
            # Rückwärts bis zum vorletzten Zeilenumbruch lesen.
            chunk = b""
            while pos > 0 and chunk.count(b"\n") < 2:
                step = min(4096, pos)
                pos -= step
                f.seek(pos)
                chunk = f.read(step) + chunk
            lines = [l for l in chunk.split(b"\n") if l.strip()]
            return lines[-1].decode("utf-8") if lines else None
    except FileNotFoundError:
        return None


def append_if_changed(path, entry, ignore=("t",)):
    """Hängt eine Zeile an, wenn sie sich (ohne Zeitstempel) von der letzten unterscheidet."""
    last = _last_line(path)
    if last:
        prev = json.loads(last)
        strip = lambda d: {k: v for k, v in d.items() if k not in ignore}
        if strip(prev) == strip(entry):
            return False
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False, separators=(",", ":")) + "\n")
    return True


def upsert_daily(path, entry, key="d"):
    """Eine Zeile pro Tag: ersetzt die letzte Zeile, wenn sie vom selben Tag ist."""
    rows = read_jsonl(path)
    if rows and rows[-1].get(key) == entry[key]:
        if rows[-1] == entry:
            return False
        rows[-1] = entry
    else:
        rows.append(entry)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n" for r in rows), encoding="utf-8")
    return True
