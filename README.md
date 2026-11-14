# CoC Stats

Eigenes Clash-of-Clans-Dashboard. Ein GitHub-Actions-Workflow ruft alle 30 Minuten die offizielle API ab, speichert
die Daten versioniert unter `data/` und veröffentlicht das Dashboard auf GitHub Pages.

## Einrichtung

1. **API-Key anlegen:** auf https://developer.clashofclans.com einloggen → *My Account* → *Create New Key*.
   Als erlaubte IP `45.79.218.79` eintragen (das ist der RoyaleAPI-Proxy, über den alle Abfragen laufen).
2. **Tags eintragen:** in `config.json` unter `players` deine Spieler-Tags, optional unter `clans` weitere Clans.
   Die Clans deiner Accounts werden automatisch mit erfasst (`includePlayerClans`).
3. **Repo auf GitHub anlegen und pushen.**
4. **Secret setzen:** *Settings → Secrets and variables → Actions → New repository secret*,
   Name `COC_API_TOKEN`, Wert = der API-Key.
5. **Pages aktivieren:** *Settings → Pages → Source: GitHub Actions*.
6. **Ersten Lauf starten:** *Actions → Daten aktualisieren → Run workflow*.

Danach läuft alles automatisch. Das Dashboard liegt unter `https://<nutzer>.github.io/<repo>/`.

## Lokal ausführen

```sh
COC_API_TOKEN=... python3 scripts/fetch.py   # Daten abrufen
python3 scripts/build_site.py                # Dashboard-Daten erzeugen
python3 -m http.server -d site 8000          # http://localhost:8000
```

Lokal muss der Key entweder ebenfalls über den Proxy laufen (Standard) oder du setzt
`COC_API_BASE=https://api.clashofclans.com/v1` und trägst deine eigene IP im Key ein.

## Was gespeichert wird

| Datei | Inhalt |
|---|---|
| `data/players/<TAG>/player.json` | vollständiges aktuelles Profil |
| `data/players/<TAG>/history.jsonl` | Verlauf der Kennzahlen (eine Zeile pro Änderung) |
| `data/clans/<TAG>/clan.json` | Clan inkl. Mitgliederliste |
| `data/clans/<TAG>/history.jsonl` | Verlauf der Clan-Kennzahlen |
| `data/clans/<TAG>/members.jsonl` | ein Mitglieder-Schnappschuss pro Tag |
| `data/clans/<TAG>/warlog.json` | Kriegslog (wird über die Zeit zusammengeführt) |
| `data/clans/<TAG>/wars/*.json` | jeder Krieg vollständig mit allen Angriffen |
| `data/clans/<TAG>/cwl/<Saison>/` | CWL-Gruppe und alle Kriege der Saison |
| `data/clans/<TAG>/raids/*.json` | Raid-Wochenenden inkl. Angriffs- und Verteidigungslog |
| `data/goldpass.json` | aktuelle Gold-Pass-Saison |

Geschrieben wird nur bei Änderungen, ältere Stände stecken zusätzlich in der Git-Historie.
Der Kriegslog und laufende Kriege sind nur abrufbar, wenn der Kriegslog des Clans öffentlich ist.
