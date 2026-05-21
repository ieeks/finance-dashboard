# Tests

Schlanker Browser-Test-Runner ohne Build-System / Framework. Reine ES-Modules.

## Ausführen

```bash
# Beliebigen statischen Server starten (z.B. python)
python3 -m http.server 8000

# Dann öffnen:
# http://localhost:8000/tests/run.html
```

Ergebnis erscheint direkt auf der Seite (grün/rot). Keine Konsole nötig.

## Struktur

- `harness.js` — Test-DSL (`suite`, `test`, `eq`, `ok`, `isNull`, `approx`)
- `*.test.js` — Tests pro Modul
- `run.html` — lädt alle Tests, rendert Resultate

## Tests hinzufügen

1. Datei `tests/MODUL.test.js` anlegen, Pattern aus `matcher.test.js` kopieren
2. In `run.html` per `import './MODUL.test.js'` einbinden
3. Browser-Tab reloaden — fertig

## Bekannte Lücken

- **Parser-Tests fehlen** — brauchen anonymisierte echte PDF-Texte als
  Fixtures. Solange die fehlen, sind Parser-Änderungen nur im Browser
  manuell verifizierbar. TODO unter "Phase C / C1" im
  [Code Review](../docs/code-review-2026-05-20.md).
