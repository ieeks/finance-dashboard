# Tests

Schlanker Test-Runner ohne Build-System / Framework. Reine ES-Modules + stdlib Python.

## CI

Läuft automatisch bei jedem PR und Push auf `main` —
siehe `.github/workflows/ci.yml`.

- Python: `python -m unittest tests.test_python_importer`
- JS:     `node tests/run.node.mjs`

## Lokal ausführen

### JS — Browser
```bash
# Beliebigen statischen Server starten
python3 -m http.server 8000
# Öffnen:
# http://localhost:8000/tests/run.html
```

Ergebnis erscheint direkt auf der Seite (grün/rot).

### JS — Node (gleicher Output wie CI)
```bash
node tests/run.node.mjs
# oder
npm test
```

### Python
```bash
python3 -m unittest tests.test_python_importer -v
```

## Struktur

- `harness.js` — Test-DSL (`suite`/`test`/`eq`/`ok`/`isNull`/`approx`),
  läuft im Browser UND in node (Auto-Detect)
- `*.test.js` — JS-Tests pro Modul
- `test_python_importer.py` — Python-Tests (unittest, AST-basiert ohne
  externe Deps)
- `run.html` — Browser-Entry mit DOM-Output
- `run.node.mjs` — Node-Entry mit Console-Output + exit-Code

## Tests hinzufügen

**JS:**
1. `tests/MODUL.test.js` anlegen, Pattern aus `matcher.test.js` kopieren
2. In `run.html` UND `run.node.mjs` per `import './MODUL.test.js'` einbinden

**Python:**
- Neue `TestCase`-Klasse in `test_python_importer.py` ergänzen.
  Helper über `H["name"]` zugreifen (AST-extrahiert).

## Bekannte Lücken

- **Parser-Tests fehlen** — brauchen anonymisierte echte PDF-Texte als
  Fixtures. Solange die fehlen, sind Parser-Änderungen nur im Browser
  manuell verifizierbar. TODO unter "Phase C / C1" im
  [Code Review](../docs/code-review-2026-05-20.md).
