# CoC Stats

Eigenes Clash-of-Clans-Dashboard. Ein GitHub-Actions-Workflow ruft alle 30 Minuten die offizielle API ab, speichert
die Daten versioniert unter `data/` und veröffentlicht das Dashboard auf GitHub Pages.

## Einrichtung

1. **API-Key anlegen:** auf https://developer.clashofclans.com einloggen → *My Account* → *Create New Key*.
   Als erlaubte IP `45.79.218.79` eintragen (das ist der RoyaleAPI-Proxy, über den alle Abfragen laufen).
   Das ist **nicht** das API-Token aus dem Spielprofil. Der Key gehört zum Developer-Konto und kann jeden Spieler und Clan abfragen.
2. **Secret setzen:** *Settings → Secrets and variables → Actions → New repository secret*,
   Name `COC_API_TOKEN`, Wert = der API-Key.
3. **Pages aktivieren:** *Settings → Pages → Source: GitHub Actions*.
4. **Ersten Lauf starten:** *Actions → Daten aktualisieren → Run workflow*. Danach ist das Dashboard unter
   `https://<nutzer>.github.io/<repo>/` erreichbar.
5. **Accounts eintragen:** im Dashboard unter *⚙ Verwalten*. Dort einmal mit einem GitHub-Token anmelden
   (Fine-grained, nur dieses Repo, Berechtigungen *Contents* und *Actions* auf „Read and write“).

Die Oberfläche speichert Änderungen als Commit in `config.json`. Jeder Commit startet sofort einen Abruf.
Probleme beim Abruf (falscher Tag, ungültiger Key) werden ebenfalls unter *Verwalten* angezeigt.

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
| `data/players/<TAG>/levels.jsonl` | Level aller Einheiten; erste Zeile Ausgangsstand, danach nur Upgrades |
| `data/players/<TAG>/achievements.jsonl` | täglicher Stand aller Erfolgszähler (Beute, Spenden, Clanspiele …) |
| `data/clans/<TAG>/clan.json` | Clan inkl. Mitgliederliste |
| `data/clans/<TAG>/history.jsonl` | Verlauf der Clan-Kennzahlen |
| `data/clans/<TAG>/members.jsonl` | ein Mitglieder-Schnappschuss pro Tag |
| `data/clans/<TAG>/warlog.json` | Kriegslog (wird über die Zeit zusammengeführt) |
| `data/clans/<TAG>/wars/*.json` | jeder Krieg vollständig mit allen Angriffen |
| `data/clans/<TAG>/cwl/<Saison>/` | CWL-Gruppe und alle Kriege der Saison |
| `data/clans/<TAG>/raids/*.json` | Raid-Wochenenden inkl. Angriffs- und Verteidigungslog |
| `data/rankings.jsonl` | tägliche Platzierungen in den Top-200-Ranglisten (weltweit und im Land des Clans) |
| `data/goldpass.json` | aktuelle Gold-Pass-Saison |

Geschrieben wird nur bei Änderungen, ältere Stände stecken zusätzlich in der Git-Historie.
Der Kriegslog und laufende Kriege sind nur abrufbar, wenn der Kriegslog des Clans öffentlich ist.

## Spieldaten

Die API liefert nur das höchste Level im ganzen Spiel. Rathaus-Maximum, Kosten, Bauzeiten und deutsche Namen kommen
aus `scripts/gamedata.json`. Die Datei wird aus den Spieldaten der Bibliothek
[coc.py](https://github.com/mathsman5133/coc.py) (MIT) erzeugt und ist so aktuell wie deren letzter Stand.
Ist ein Level im Spiel höher als in den Daten, gilt es als erreicht. Einheiten ohne Daten erscheinen ohne
Rathaus-Maximum. Auffrischen, sobald coc.py neue Daten veröffentlicht:

```sh
pip download coc.py --no-deps -d /tmp/cocpy && unzip -o /tmp/cocpy/*.whl 'coc/static/*' -d /tmp/cocpy
python3 scripts/update_gamedata.py /tmp/cocpy/coc/static/static_data.json /tmp/cocpy/coc/static/translations.json <stand>
```

