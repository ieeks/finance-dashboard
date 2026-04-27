# TODO — Finance Dashboard

## Sofort (nächste Session)

- [x] **Modul-Refactor**: index.html → js/ Module (app, state, parser, bonAnalyzer, matcher, categories, ui)

### PDF Parser — offene Bugs
- [x] **POS 4350 → Billa**: Gelöst via Backward Lookup + Terminal Cache (v=28/29, 2026-04-17)
- [x] **Helvetia AG → Miete** fälschlich als Familientransfer (Zelenina in Adresszeile) — Firmen vor Personennamen prüfen (2026-04-18)
- [x] **Miete-Eingang → Familientransfer**: rawDesc "Miete" + positiver Betrag → Manuel Koblischek erkannt (2026-04-18)
- [x] **Gutschrift → Gehalt/Einnahmen**: "gutschrift" aus guessCategory-Pattern entfernt (2026-04-18)
- [x] **Familientransfer fehlt im AI-Prompt**: Kategorie + Hinweise hinzugefügt (2026-04-18)
      → DANKT-Zeile erscheint durch Y-Sortierung teils als Orphan-Zeile vor dem Header → Backward Lookup
      → Wenn DANKT komplett fehlt (PDF verliert die Zeile bei Seitenumbruch) → Terminal Cache Fallback
- [x] **Gutschrift Olga Forward-Lookup**: BAWAATWWXXX + Name durch Y-Merge mit nächster TX verloren → lines[j..j+3] als Fallback (2026-04-18)
- [x] **Dezember 2025 → 2026**: Jahres-Fallback auf getFullYear() lieferte falsches Jahr; erweiterte Extraktion aus PDF-Header (2026-04-18)

### Concierge / PDF-Rechnungen
- [x] Tesla-Rechnung: subcategory-Feldname-Bug behoben + "Mobilität / Auto" als Subkategorie ergänzt
- [x] Match cent-genau (< 0,015 € Toleranz)
- [x] OpenAI PDF-Support (Text-Extraktion → GPT-4o-mini)
- [x] API Key von Import → Bon-Screen verschoben
- [x] Kamera-Upload TypeError (leerer MIME-Type Android + HEIC iOS) behoben (2026-04-26)
- [x] Pending-Queue: Bons ohne passende Buchung speichern + Auto-Match beim Import (2026-04-26)
- [ ] Fehlerfall: Was wenn KI kein valid JSON zurückgibt? bessere Fallback-Meldung statt crash

---

## Phase 2 — Firebase Integration ✅ (v1.2.0, 2026-04-27)

- [x] Google Auth + E-Mail-Whitelist (`firebaseService.js`)
- [x] Firestore als primärer Datenspeicher (Transaktionen, pendingBons, categoryOverrides)
- [x] localStorage-Migration beim ersten Login
- [x] API Keys (Anthropic/OpenAI) aus Firestore `config/apiKeys` — Eingabe-Felder entfernt
- [x] Import-History in Firestore (`imports/{id}`)
- [x] Login-Screen + Logout-Button
- [x] `firebase-config.js` im Repo (öffentlich safe — Security via Firestore Rules + Auth)
- [x] **API Keys in `firebase-config.js`** — Keys laden automatisch nach Login

---

## Phase 3 — Rechnungs-Matching & Einzelpositionen

### 3a — Bon-Upload & Extraktion
- [ ] Kassenbon-Foto (iPhone) oder PDF-Rechnung hochladen
- [ ] Claude Vision extrahiert alle Einzelpositionen (Produkt, Menge, Einzelpreis, Gesamtpreis)
- [ ] Claude weist jeder Position eine Sub-Kategorie zu:
      Milchprodukte · Süßwaren / Naschen · Getränke · Brot & Backwaren ·
      Fleisch & Wurst · Obst & Gemüse · Tiefkühl · Hygiene · Putzmittel · Sonstiges
- [ ] Gesamtbetrag + Datum + Händler aus Bon extrahieren

### 3b — Matching Bon ↔ Buchung
- [x] Auto-Matching bei sofort vorhandener Buchung (Betrag ±0,015 €) — lokal in localStorage
- [x] Pending-Queue: Bon speichern wenn keine Buchung → Auto-Match beim nächsten Import (60-Tage-Fenster)
- [x] Manuelle Zuweisung wenn kein Auto-Match möglich ("Als offen speichern" + manuell verknüpfen)
- [ ] Status-Anzeige pro Buchung: matched ✅ / unmatched ⚠️ / kein Bon ❓ (in Buchungsliste)
- [ ] Matching via matcher.js (Score Betrag + Datum + Händlername) statt nur Betragsvergleich
- [ ] Basis: receipt-scanner Code aus bestehendem Repo wiederverwenden

### 3c — Sub-Kategorie Dashboard
- [ ] Drill-Down: Buchung → Bon → Einzelpositionen
- [ ] Auswertung nach Sub-Kategorien über Monate
      Beispiel: "Joghurt & Milch: Ø 18,40 € / Monat"
                "Süßwaren / Naschen: 34,20 € im März"
- [ ] Top-Produkte Ranking (was kaufe ich am häufigsten?)
- [ ] Filter: nur Buchungen mit / ohne Bon anzeigen

---

## Phase 4 — Visualisierung
- [ ] Monatsvergleich-Chart (Balken: Einnahmen vs. Ausgaben)
- [ ] Kategorien-Trend über Monate
- [ ] Jahresübersicht

---

## Phase 5 — Datenquellen & Multi-Konto
- [ ] Finanzguru CSV-Export Import
- [ ] Mehrere Konten / Kreditkarten (BAWAG Girokonto + easybank Sparkonto etc.)
      → IBAN maskiert anzeigen (AT45 ••••••••• 8821)
      → Bank-Logo je Konto
      → AKTIV-Badge = letzter Import-Zeitstempel
      → Gesamtvermögens-Karte mit Trend-Kurve (alle Konten summiert)
- [ ] "Neues Konto verknüpfen" Flow (PDF-Upload einem Konto zuordnen)
- [ ] YNAB-Export-Format (optional)

---

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

---

## AI Provider — Dual Support
- [x] Anthropic: Claude Haiku (PDF-Parsing) + Claude Vision (Bon-Extraktion)
- [x] OpenAI: gpt-4o-mini (PDF-Parsing + Bon-PDF) + gpt-4o Vision (Bon-Bild)
- [x] Beide API Keys separat in localStorage (im Bon-Screen eingebbar)
- [x] **API Keys aus Firestore** — Input-Felder entfernt, Keys laden automatisch nach Login (v1.2.0)
- [ ] Abstraktions-Layer `aiProvider.js` für saubere Trennung
- [ ] Fallback: wenn Provider A fehlschlägt → Hinweis, nicht automatischer Wechsel

---

## Bugs / Verbesserungen
- [x] Kategorie manuell ändern (Tap auf Transaktion → Dropdown)
- [x] Lernfunktion: geänderte Kategorien für zukünftige Importe merken — Override-Map in state (2026-04-26)
- [x] Multi-PDF Upload — mehrere Kontoauszüge gleichzeitig importieren (v1.2.1, 2026-04-27)
- [ ] Bessere Fehlerbehandlung für passwortgeschützte PDFs
- [ ] Ladeindikator beim Demo-Button

---

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
