# CHANGELOG

## v0.5 — 2026-04-16

### Fixed
- Concierge: Match-Toleranz cent-genau (< 0,015 € statt ± 2 €)
- Concierge: Subkategorie "UNDEFINED" behoben — Code liest jetzt `subcategory` UND `subkategorie` (Fallback: "Sonstiges")
- Bon-Prompt: Feldname auf `subcategory` (EN) vereinheitlicht, "Mobilität / Auto" ergänzt (Tesla-Rechnungen)
- Import: KI-Konfiguration Card entfernt (API Key jetzt im Bon-Screen)
- State: Demo-IBANs entfernt (kein "BAWAG Girokonto AT45 •••••••••• 8821" mehr als Default)
- Cache: `?v=N` durch `Date.now()` ersetzt — kein manuelles Versionieren mehr nötig

### Added
- OpenAI PDF-Support im Bon-Screen (Text-Extraktion via PDF.js → GPT-4o-mini)
- Bon-Screen: API Key Eingabe für Anthropic + OpenAI mit Provider-Toggle

## v0.4 — 2026-04-15 (Modul-Refactor)

### Changed
- Monolithisches index.html (~2000 Zeilen) in ES-Module aufgeteilt
- Neue Dateistruktur: js/ (app, state, parser, bonAnalyzer, matcher, categories, ui)
- Prompts ausgelagert nach prompts/ (parse-transactions.md, analyze-bon.md)
- mockup-v2.html nach docs/ verschoben
- .gitignore um node_modules/ ergänzt
- Version Badge v0.2 → v0.4

## v0.3 — 2026-04-14 (PDF Parser + Concierge PDF)

### Fixed
- Card payment merchant extraction: rawDesc now checked directly against CARD_MERCHANTS
  (easybank writes "SPAR 2361 K002 30.03. 11:25" directly as description, not behind "Bezahlung Karte")
- POS terminal ID as rawDesc (e.g. "POS 4350 D001 27.03. 18:05") now detected as card payment
- Concierge screen: PDFs now processed via PDF.js text extraction + Claude text prompt
  (previously PDFs fell through to hardcoded demo BILLA data)
- Added `analyzeBonPdfWithClaude()` for text-based invoice analysis (PDF invoices like Tesla)

### Known Remaining Bug
- "POS 4350 D001 28.03. 15:47" (15,79 EUR) still shows POS ID instead of "Billa"
  → Billa terminal POS 4350 not in CARD_MERCHANTS; merchant name not found in contLines either
  → Fix: add POS terminal ID → merchant lookup table, OR improve contLines extraction for this pattern

## v0.2 — 2026-04-14 (Redesign v2)

### Added
- Komplett neues UI nach Mockup v2 (Quiet Luxury Design System)
- 5 Screens: Dashboard · Buchungen · Import · Konten · Concierge
- Bottom Navigation (sticky, blur)
- Month-Strip zur Monatsnavigation
- Kategorie-Schnellansicht auf Dashboard mit Insight-Karte
- Transaktionsliste mit Grouping nach Datum + Suche
- Kategorie per Tap ändern (Modal)
- Import-Screen mit Progress-Steps
- Dual AI Provider: Anthropic Claude Haiku + OpenAI GPT-4o-mini
- Regex-Fallback-Kategorisierung ohne API Key
- Konten-Screen mit Gesamtvermögen
- Concierge-Screen (Bon-Upload + AI Vision Analyse)
- CSV-Export
- Demo-Daten ohne PDF-Import
- Drag & Drop PDF-Upload
- Duplikat-Erkennung beim Import
- iOS Dark Mode Fix (color-scheme: light only)

## v0.1 — 2025-04 (Prototyp)

### Added
- BAWAG / easybank PDF-Upload via PDF.js
- Claude Haiku Kategorisierung (12 Kategorien)
- Drag & Drop PDF-Upload
- Zusammenfassungskarten: Einnahmen / Ausgaben / Saldo
- Kategorien-Übersicht mit Balkendarstellung
- Transaktionsliste mit Kategorie-Chips
- Monatsfilter-Navigation
- Demo-Daten (kein PDF nötig)
- API Key Persistenz via localStorage
- Mobile-First Dark Mode UI
