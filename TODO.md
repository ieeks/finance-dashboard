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
- [ ] Fehlerfall: Was wenn KI kein valid JSON zurückgibt? bessere Fallback-Meldung statt crash

---

## Phase 2 — Firebase Integration

> **Voraussetzung:** Parser ist stabil + Transaktions-Datenstruktur ändert sich nicht mehr wesentlich.
> Firebase erst integrieren wenn Phase 1 (Bugs/Parser) abgeschlossen ist — sonst drohen Firestore-Migrationen.

### Entscheidungen (bereits getroffen)

- **Auth:** Google Login (`signInWithPopup`) mit E-Mail-Whitelist
  - Zugelassene Accounts: `manuel.koblischek@gmail.com`, `zolguita@gmail.com`
  - Doppelte Absicherung: JS-seitig (UX) + Firestore Security Rules (tatsächliche Sicherheit)
- **Datensilo:** Gemeinsamer Haushalt-Pool — beide sehen alle Transaktionen
- **Firebase-Projekt:** Eigenes Projekt `finance-dashboard` (getrennt vom LEGO-Tracker)
- **Config:** `firebase-config.js` in `.gitignore` + API Keys als GitHub Secret für GH Actions

---

### Datenmodell (Firestore)

```
household/main/
  transactions/{txId}
    date:         "2026-03-15"          ← ISO-String
    amount:       -84.30                ← negativ = Ausgabe, positiv = Einnahme
    rawDesc:      "BILLA DANKT 1020 WIEN"
    description:  "Billa"              ← bereinigter Name
    category:     "Lebensmittel"
    subcategory:  null                  ← Phase 3: gefüllt durch Bon-Matching
    account:      "AT12BAWAG...8821"   ← IBAN aus PDF-Header (maskiert für Anzeige)
    source:       "bawag-pdf"          ← später: "finanzguru-csv", "easybank-pdf" etc.
    importId:     "8821_2026_04"       ← Referenz auf imports-Dokument (Duplikat-Check)
    bonId:        null                  ← Referenz auf verknüpften Bon (Phase 3)
    createdAt:    Timestamp
    createdBy:    "manuel.koblischek@gmail.com"

  imports/{importId}                   ← importId = {IBAN_last4}_{year}_{month}
    filename:     "Kontoauszug_2026_04.pdf"
    importedAt:   Timestamp
    importedBy:   "manuel.koblischek@gmail.com"
    txCount:      47
    account:      "AT12BAWAG...8821"
    dateRange:    { from: "2026-04-01", to: "2026-04-30" }

  bons/{bonId}                         ← Phase 3
    matchedTxId:  "..."
    vendor:       "Billa"
    total:        84.30
    date:         "2026-03-15"
    items:        [ { name, qty, price, subcategory } ]
    source:       "photo" | "pdf"
    createdAt:    Timestamp
    createdBy:    "zolguita@gmail.com"
```

---

### Auth — Implementierung

```javascript
// auth.js
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut } from "firebase/auth";

const ALLOWED_EMAILS = [
  "manuel.koblischek@gmail.com",
  "zolguita@gmail.com"
];

export async function login() {
  const auth = getAuth();
  const result = await signInWithPopup(auth, new GoogleAuthProvider());
  if (!ALLOWED_EMAILS.includes(result.user.email)) {
    await signOut(auth);
    throw new Error("Kein Zugang für dieses Konto.");
  }
  return result.user;
}
```

---

### Firestore Security Rules

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /household/{document=**} {
      allow read, write: if request.auth != null
        && request.auth.token.email in [
          "manuel.koblischek@gmail.com",
          "zolguita@gmail.com"
        ];
    }
  }
}
```

---

### Duplikat-Erkennung

**Strategie: Composite Key** `importId = {IBAN_last4}_{year}_{month}`
Beispiel: `8821_2026_04`

Import-Flow:
1. IBAN + Zeitraum aus PDF-Header extrahieren → `importId` bauen
2. `imports/{importId}` in Firestore prüfen — existiert bereits? → Abbruch mit Toast "Bereits importiert (April 2026 · BAWAG ••8821)"
3. Wenn neu: alle Transaktionen als Batch in `transactions/` schreiben + `imports/{importId}` anlegen

Optional für feineres Deduplizieren (z.B. Teilimporte):
`txId = hash(date + amount + rawDesc)` → jede TX einzeln prüfbar, unabhängig vom Import-Dokument.

---

### Implementierungs-Reihenfolge

1. **Firebase-Projekt anlegen** — Console, Firestore aktivieren, Auth (Google Provider) aktivieren
2. **`firebase-config.js`** erstellen (gitignored), Werte als GH Secret für Actions hinterlegen
3. **`firebaseService.js`** Modul bauen:
   - `login()` / `logout()` / `onAuthChange(callback)`
   - `checkImportExists(importId)` → boolean
   - `saveImport(importId, meta)` → schreibt Import-Dokument
   - `saveTxBatch(transactions)` → Firestore `writeBatch`
   - `loadTxs()` → alle Transaktionen laden, nach Datum sortiert
4. **Login-Screen** einbauen — minimales UI, Google-Button, Fehlermeldung bei unerlaubtem Account
5. **Import-Flow erweitern** — nach erfolgreichem Parse: `checkImportExists` → `saveTxBatch` → `saveImport`
6. **App-Start** — `loadTxs()` statt leerem State; Spinner während Laden
7. **Import-History Screen** — Liste aller `imports/`-Dokumente (Datum, Dateiname, Anzahl TX)

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
- [ ] Abstraktions-Layer `aiProvider.js` für saubere Trennung
- [ ] Fallback: wenn Provider A fehlschlägt → Hinweis, nicht automatischer Wechsel

---

## Bugs / Verbesserungen
- [ ] Kategorie manuell ändern (Tap auf Transaktion → Dropdown)
- [ ] Lernfunktion: geänderte Kategorien für zukünftige Importe merken
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
