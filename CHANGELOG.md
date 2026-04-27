# CHANGELOG

## v1.2.1 — 2026-04-27

### Added
- **Multi-PDF Upload** — Mehrere Kontoauszugs-PDFs auf einmal auswählen oder per Drag & Drop einwerfen. Jede Datei wird sequenziell verarbeitet (eigene Fortschrittsanzeige "Datei X/N"). Fehlerhafte PDFs werden übersprungen, valide weiterverarbeitet. Abschluss-Toast zeigt Gesamtzahl: "✓ 127 Buchungen importiert aus 3 Dateien". Upload-Hinweis aktualisiert auf "Mehrere PDFs möglich".

## v1.2.0 — 2026-04-27

### Added
- **Firebase Auth + Firestore Integration** — Vollständige Cloud-Synchronisation ersetzt localStorage als primären Datenspeicher. Google Sign-In mit E-Mail-Whitelist (manuel.koblischek@gmail.com, zolguita@gmail.com). Login-Screen mit Google-Button.
- **Automatische localStorage-Migration** — Beim ersten Login werden vorhandene localStorage-Daten einmalig zu Firestore hochgeladen und lokal gelöscht.
- **API Keys aus Firestore** — Anthropic- und OpenAI-Keys werden nach Login automatisch aus `config/apiKeys` geladen; manuelle Eingabe-Felder entfernt.
- **Firestore Persistence** — Alle Mutationen (neue Transaktionen, Bon-Links, Kategorien-Overrides, pendingBons) werden automatisch in Firestore gespiegelt.
- **Import-History** — Jeder PDF-Import legt ein `imports/{id}`-Dokument in Firestore an (Duplikat-Schutz über Dateiname + Monat).
- **Logout** — LOGOUT-Button in der Dashboard-Topbar; löscht In-Memory-State vollständig.

## v1.1.2 — 2026-04-26

### Added
- **Kategorie-Lernfunktion (Override-Map)** — Beim manuellen Ändern einer Kategorie erscheint die Checkbox "Für nächstes Mal merken" (Standard: aktiv). Gespeicherte Händler landen in `state.categoryOverrides` und überschreiben beim nächsten Import KI- und Regex-Kategorisierung. Override lässt sich im Modal per "Vergessen"-Button entfernen.

### Fixed
- **Parser: Jahres-Rollover bei Jänner-Auszügen** — Kontoauszüge datiert auf z.B. `02.01.2026` enthielten Dezember-Buchungen, die als `2026-12-xx` statt `2025-12-xx` gespeichert wurden. `_resolveDate()` prüft jetzt: liegt `DD.MM.Jahr` nach dem Statement-Datum? → Vorjahr verwenden. Funktioniert für alle Monatsübergänge korrekt.

## v1.1.0 — 2026-04-26

### Added
- **Concierge: Pending-Queue für Bons ohne passende Buchung** — Scannt man einen Bon bevor der Kontoauszug importiert wurde, kann er jetzt als "offen" gespeichert werden (`state.pendingBons[]`, localStorage). Beim nächsten PDF-Import werden alle offenen Bons automatisch gegen neue Buchungen gematcht (60-Tage-Fenster, ±0,015 € Toleranz) und verknüpft.
- **Concierge: "Als offen speichern"-Button** — Erscheint wenn kein Match gefunden wird, statt nur "Keine passende Buchung gefunden"
- **Concierge: Liste offener Bons** — Im Upload-Bereich erscheint eine Liste aller pendingBons mit Datum, Betrag und Lösch-Button
- **Dashboard: Badge "X offen"** — Concierge-Teaser auf dem Dashboard zeigt goldenes Badge wenn Bons ausstehend sind
- **Import: Auto-Match Toast** — Nach PDF-Import erscheint "✓ 47 Buchungen importiert · 🧾 3 Bons automatisch verknüpft"

### Fixed
- **Concierge: Kamera-Upload TypeError** — Auf Android-Geräten liefert die Kamera manchmal `file.type = ""` (leerer String); führte zu "Dateiformat nicht unterstützt". Leerer MIME-Type wird jetzt als `image/jpeg` behandelt.
- **Concierge: HEIC-Format (iOS)** — HEIC/HEIF-Dateien werden jetzt mit klarer Fehlermeldung abgelehnt (Claude API unterstützt kein HEIC) inkl. Anleitung zur Kamera-Umstellung

## v1.0.1 — 2026-04-18

### Fixed
- **Parser: Jahresangabe bei alten Auszügen** — Fallback `new Date().getFullYear()` lieferte 2026 für Dezember-2025-PDFs; Extraktion sucht jetzt zusätzlich nach beliebigem `20XX`-Jahr in den ersten 500 Zeichen und clippt zukunftsdaten
- **UI: Zahnrad-Icon als SVG** — ⚙️ Emoji in der Buchungen-Topbar durch stroke-basiertes SVG-Icon (gleicher Stil wie Nav-Icons) ersetzt

## v1.0.0 — 2026-04-18

### Fixed
- **Parser: Gutschrift Olga Forward-Lookup** — BAWAATWWXXX + Name-Zeile verschmilzt durch Y-Koordinaten-Merge mit der nächsten Transaktion (z.B. PayPal) und verschwindet aus contLines; Forward-Lookup scannt `lines[j..j+3]` nach dem contLines-Abbruch und findet den Namen dort (löst BG/000004339 €200 + BG/000004367 €1600)

## v0.9.9 — 2026-04-18

### Added
- **Notiz / Kommentar**: Jede Buchung kann jetzt einen Kommentar erhalten (Textarea im Detail-Modal, auto-gespeichert bei Blur). In der Buchungsliste erscheint 💬 wenn ein Kommentar vorhanden ist.

## v0.9.8 — 2026-04-18

### Fixed
- **Parser: Helvetia AG → Miete / Hausverwaltung** — Zelenina-Check feuerte auf Adresszeile "Koblischek _ Zelenina, Rennweg 90" bevor Helvetia erkannt wurde; Firmen-Checks werden jetzt vor Personennamen geprüft
- **Parser: Miete-Eingang (+€2200)** — rawDesc "Miete" mit positivem Betrag wird jetzt korrekt als Familientransfer (Manuel Koblischek) erkannt statt als "Miete / Hausverwaltung"
- **Parser: Gutschrift → Familientransfer** — "gutschrift" aus guessCategory Gehalt/Einnahmen Pattern entfernt; "Gutschrift" ohne Firmennamen fällt jetzt auf "Sonstiges" (statt fälschlich "Gehalt / Einnahmen")
- **Parser: Gutschrift Onlinebanking BIC-Filter** — Zeilen mit BAWAATWW-BIC wurden komplett übersprungen, auch wenn der Absendername dahinter stand; BIC/IBAN werden jetzt entfernt und der verbleibende Name extrahiert
- **AI-Prompt: Familientransfer** — Kategorie fehlte im AI-Kategorisierungsprompt; jetzt inkl. Drogerie, Telekommunikation + Hinweis für Privatpersonen-Erkennung

### Added
- **Dashboard: Donut-Chart** — SVG-Kreisdiagramm für Top-5 Ausgabenkategorien im Dashboard (kein Canvas, keine externe Library)
- **Buchungen: Gesamtsumme bei M/O-Filter** — Summary-Bar (Buchungen / Einnahmen / Ausgaben) erscheint jetzt auch beim Filtern nach Manuel oder Olga

## v0.9.7 — 2026-04-17

### Fixed
- PDF Parser: Kartenzahlungen ohne DANKT-Zeile im PDF (z.B. -19,49€, -19,44€, -10,55€, -15,35€) werden jetzt korrekt erkannt
- **Backward Lookup**: DANKT-Zeile die durch Y-Sortierung als Orphan-Zeile *vor* dem "Bezahlung Karte" Header landet wird rückwärts in `lines[i-1..i-4]` gefunden (löst -10,55€ und -15,35€)
- **Terminal Cache**: POS-Terminal-ID → Händlername wird während des Parsens gecacht. Wenn DANKT-Zeile komplett fehlt (PDF-Extraktion verliert sie), wird der Cache als Fallback genutzt (löst -19,49€ und -19,44€: POS 4350 war bereits als "Billa" bekannt)

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
