# TODO — Finance Dashboard

## Sofort (nächste Session)

- [x] **Modul-Refactor**: index.html → js/ Module (app, state, parser, bonAnalyzer, matcher, categories, ui)

### PDF Parser — offene Bugs
- [ ] **POS 4350 → Billa**: "POS 4350 D001 28.03. 15:47" zeigt POS-ID statt "Billa" (Betrag 15,79 EUR)
      → Billa-Terminal wird nicht erkannt weil Merchant-Name nicht in rawDesc UND nicht in contLines
      → Option A: POS-Terminal-ID Lookup-Table (4350 → Billa, etc.) — aber nicht skalierbar
      → Option B: Debug-Log einbauen, schauen was contLines für diesen Eintrag wirklich enthält
      → Wahrscheinlichste Ursache: Y-Grouping in extractPdfText fasst Merchant-Zeile mit falscher Transaktion zusammen
- [ ] **extractPdfText debuggen**: Direkt ausgeben welche Zeilen für POS 4350 Eintrag in contLines landen
      → Debug-Button im Import-Screen: "Rohdaten anzeigen" (erste 50 Zeilen des extrahierten Texts)

### Concierge / PDF-Rechnungen
- [ ] Tesla-Rechnung testen nach heutigem Fix (PDF → extractPdfText → analyzeBonPdfWithClaude)
- [ ] Fehlerfall: Was wenn Claude kein valid JSON zurückgibt? bessere Fallback-Meldung statt crash

## Phase 2 — Firebase Integration

## Phase 2 — Firebase Integration
- [ ] Firebase Firestore Setup (Config auslagern)
- [ ] Transaktionen persistent speichern (kein Re-Import nötig)
- [ ] Duplikat-Erkennung beim Import (gleiche Buchung nicht zweimal)
- [ ] Import-History: welche PDFs wurden bereits importiert?

## Phase 3 — Rechnungs-Matching & Einzelpositionen

### 3a — Bon-Upload & Extraktion
- [ ] Kassenbon-Foto (iPhone) oder PDF-Rechnung hochladen
- [ ] Claude Vision extrahiert alle Einzelpositionen (Produkt, Menge, Einzelpreis, Gesamtpreis)
- [ ] Claude weist jeder Position eine Sub-Kategorie zu:
      Milchprodukte · Süßwaren / Naschen · Getränke · Brot & Backwaren ·
      Fleisch & Wurst · Obst & Gemüse · Tiefkühl · Hygiene · Putzmittel · Sonstiges
- [ ] Gesamtbetrag + Datum + Händler aus Bon extrahieren

### 3b — Matching Bon ↔ Buchung
- [ ] Auto-Matching: Bon-Gesamtbetrag ± 2 € + Datum ± 3 Tage = Buchung
- [ ] Manuelle Zuweisung wenn kein Auto-Match möglich
- [ ] Status-Anzeige pro Buchung: matched ✅ / unmatched ⚠️ / kein Bon ❓
- [ ] Basis: receipt-scanner Code aus bestehendem Repo wiederverwenden

### 3c — Sub-Kategorie Dashboard
- [ ] Drill-Down: Buchung → Bon → Einzelpositionen
- [ ] Auswertung nach Sub-Kategorien über Monate
      Beispiel: "Joghurt & Milch: Ø 18,40 € / Monat"
                "Süßwaren / Naschen: 34,20 € im März"
- [ ] Top-Produkte Ranking (was kaufe ich am häufigsten?)
- [ ] Filter: nur Buchungen mit / ohne Bon anzeigen

## Phase 4 — Visualisierung
- [ ] Monatsvergleich-Chart (Balken: Einnahmen vs. Ausgaben)
- [ ] Kategorien-Trend über Monate
- [ ] Jahresübersicht

## Phase 5 — Datenquellen & Multi-Konto
- [ ] Finanzguru CSV-Export Import
- [ ] Mehrere Konten / Kreditkarten (BAWAG Girokonto + easybank Sparkonto etc.)
      → IBAN maskiert anzeigen (AT45 ••••••••• 8821)
      → Bank-Logo je Konto
      → AKTIV-Badge = letzter Import-Zeitstempel
      → Gesamtvermögens-Karte mit Trend-Kurve (alle Konten summiert)
- [ ] "Neues Konto verknüpfen" Flow (PDF-Upload einem Konto zuordnen)
- [ ] YNAB-Export-Format (optional)

## Phase 6 — Gmail Invoice Matcher (gmail-invoice-matcher.md)

Vollständiges Feature-Dokument existiert in `gmail-invoice-matcher.md`. Kurzübersicht:

- [ ] Gmail OAuth2 Login (kein Backend — direkt im Browser via fetch)
- [ ] PDF-Anhänge aus `manuel.rechnungen@gmail.com` abrufen (Gmail API)
- [ ] Claude Vision analysiert Rechnung → JSON mit Positionen + Sub-Kategorien
- [ ] Matching: Rechnung ↔ Kontoauszug-Buchung (Betrag ± Datum, Score 0–100)
- [ ] Neuer "Rechnungen" Screen im Dashboard
- [ ] Firestore Collection `invoices/{userId}/items/{invoiceId}`
- [ ] Dashboard Drill-Down: Supermarkt → Sub-Kategorien (🍫 Süßwaren, 🥛 Milch)

**Gedanken dazu (siehe unten im Abschnitt "Notizen")**

## AI Provider — Dual Support
- [ ] Provider-Auswahl im Settings-Screen: **Anthropic** (Claude) oder **OpenAI** (GPT-4o)
- [ ] Abstraktions-Layer `aiProvider.js`: einheitliches Interface, Provider-spezifische Implementierung dahinter
- [ ] Anthropic: Claude Haiku (PDF-Parsing) + Claude Vision (Bon-Extraktion)
- [ ] OpenAI: gpt-4o-mini (PDF-Parsing) + gpt-4o (Vision / Bon-Extraktion)
- [ ] Beide API Keys separat in localStorage speichern
- [ ] Fallback: wenn Provider A fehlschlägt → Hinweis, nicht automatischer Wechsel
- [ ] Modell-Info im UI anzeigen (welcher Provider / Modell gerade aktiv)

## Bugs / Verbesserungen
- [ ] Kategorie manuell ändern (Tap auf Transaktion → Dropdown)
- [ ] Lernfunktion: geänderte Kategorien für zukünftige Importe merken
- [ ] Bessere Fehlerbehandlung für passwortgeschützte PDFs
- [ ] Ladeindikator beim Demo-Button

## Infrastruktur
- [ ] GitHub Actions: Automatischer Deploy auf GitHub Pages
- [ ] `.env`-Konzept für Firebase Config (oder direkt in GH Secrets)

---

## Notizen: Gmail Invoice Matcher — Gedanken & Architektur-Entscheidungen

Das Feature-Dokument `gmail-invoice-matcher.md` ist gut durchdacht. Ein paar Punkte zum Nachdenken:

### Was gut gelöst ist
- **Kein Backend** — alles direkt im Browser via fetch() gegen Gmail API. Passt zum bestehenden Stack.
- **Score-basiertes Matching** (100/85/60) statt binär — sinnvoll, da Datum manchmal um 1-2 Tage abweicht (Valuta vs. Buchungsdatum).
- **Firestore als Persistenzlayer** — Duplikat-Check via `gmailMessageId` ist clever.
- **Scope klein halten** — `gmail.readonly` + `gmail.modify` (nur für "gelesen" markieren). Kein Löschen.

### Potenzielle Probleme / offene Fragen

**1. OAuth2 ohne Backend ist knifflig**
- `client_secret` im Browser = sicherheitstechnisch problematisch, auch wenn in `firebase-config.js` und `.gitignore`
- Besser: Google OAuth2 "Installed App" Flow (PKCE, kein client_secret nötig) oder Firebase Auth mit Google Provider als Wrapper
- Alternative: Ein kleiner Firebase Function als Token-Proxy (minimales Backend, nur ~20 Zeilen)

**2. Matching-Genauigkeit**
- Billa-Bon vs. Billa-Buchung: Betrag stimmt oft exakt, Datum ±1 Tag (Buchungsdatum = Tag nach Kauf)
- Amazon: Oft mehrere Buchungen pro Bestellung (Teillieferungen), Matching wird komplexer
- Beste Strategie: Zuerst exakter Betrag-Match, dann Fuzzy-Datum, dann Händler-String-Ähnlichkeit

**3. Claude Vision für PDFs**
- Haiku ist gut für einfache Kassenbons; für komplexe Rechnungen (Amazon mit 10+ Positionen) besser Sonnet
- Alternativ: PDF.js Text-Extraktion zuerst → nur wenn kein Text (gescannter Bon) → Vision API
- Das spart API-Kosten bei digitalen Rechnungen (Tesla, Amazon, Verbund etc.)

**4. Was als nächster Schritt Sinn macht**
- Zuerst Firebase + Firestore fertig bauen (Phase 2) — sonst hat der Invoice Matcher nirgendwo zum Speichern
- Dann: Manueller Upload im Concierge-Screen funktioniert bereits halb — das als Einstieg nutzen
- Gmail API erst in Phase 6 — der OAuth2-Setup ist der aufwändigste Teil

**5. `manuel.rechnungen@gmail.com`**
- Existierende Python-Skripte (`gmail_invoices.py`, `extract_verbund.py`) als Referenz nutzen
- IMAP → Gmail API Umbau: Hauptunterschied ist Auth (OAuth2 statt App-Passwort) und Base64-Decode der Attachments
