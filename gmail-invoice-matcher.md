# Claude Code Prompt — Gmail Invoice Matcher

## Kontext

Projekt: `~/Developer/finance-dashboard` (ieeks/finance-dashboard)
Postfach: `manuel.rechnungen@gmail.com`
Stack: Vanilla JS · Firebase Firestore · Firebase Auth · Claude Haiku API · GitHub Pages

Der User schickt alle seine Rechnungen (Billa, Amazon, Zalando, etc.) als PDF
an `manuel.rechnungen@gmail.com`. Diese sollen automatisch:
1. Per Gmail API abgeholt werden
2. Per Claude Vision analysiert werden (Händler, Datum, Betrag, Einzelpositionen)
3. Mit einer bestehenden Kontoauszug-Buchung in Firestore gematcht werden
4. Inklusive Sub-Kategorien gespeichert werden (🍫 Süßwaren, 🥛 Milchprodukte, etc.)

Referenz-Code existiert bereits: `gmail_invoices.py` + `extract_verbund.py`
(IMAP-basiert, soll auf Gmail API OAuth2 umgebaut werden)

---

## Was zu bauen ist

### 1. Gmail API Setup (`/docs/gmail-setup.md`)

Erstelle eine Schritt-für-Schritt Anleitung:
- Google Cloud Console: Projekt anlegen, Gmail API aktivieren
- OAuth2 Credentials (Web App), Redirect URI für localhost + GitHub Pages
- Scopes: `gmail.readonly` + `gmail.modify` (für "gelesen" markieren)
- `client_id` und `client_secret` → in `firebase-config.js` eintragen (nie committen)

---

### 2. Gmail Service Modul (`/js/gmailService.js`)

Vanilla JS Modul mit folgenden Funktionen:

```js
// OAuth2 Login Flow (Redirect, kein Popup)
async function gmailLogin()

// Neue E-Mails mit PDF-Anhängen holen
// Sucht nach: has:attachment filename:pdf newer_than:30d
// Oder optional: label:Rechnungen
async function fetchInvoiceEmails(accessToken)

// PDF-Attachment als ArrayBuffer herunterladen
async function downloadAttachment(accessToken, messageId, attachmentId)

// E-Mail als gelesen markieren
async function markAsRead(accessToken, messageId)

// Token in localStorage speichern/lesen
function saveToken(token) / function loadToken()
```

Wichtig:
- Kein Backend — alles direkt im Browser via `fetch()` gegen `https://gmail.googleapis.com`
- Token-Refresh via `https://oauth2.googleapis.com/token` mit Refresh Token
- Fehler sauber abfangen (401 = re-auth, 429 = rate limit)

---

### 3. Invoice Analyzer Modul (`/js/invoiceAnalyzer.js`)

Claude Haiku Vision API aufrufen um PDF-Rechnungen zu analysieren.

Input: PDF als Base64
Output: strukturiertes JSON

```js
async function analyzeInvoice(pdfBase64, apiKey, provider = 'anthropic')
```

Prompt für Claude:
```
Analysiere diese Rechnung und extrahiere alle Daten als JSON.
Gib NUR JSON zurück, kein Text drumherum.

{
  "haendler": "Billa Plus Wien Mariahilf",
  "datum": "YYYY-MM-DD",
  "betrag_gesamt": 43.20,
  "waehrung": "EUR",
  "rechnungsnummer": "...",   // falls vorhanden
  "positionen": [
    {
      "name": "Clever Joghurt Natur 500g",
      "menge": 1,
      "einzelpreis": 1.29,
      "gesamt": 1.29,
      "subkategorie": "Milchprodukte"
    }
  ],
  "subkategorien_summen": {
    "Milchprodukte": 2.88,
    "Süßwaren / Naschen": 3.68,
    "Backwaren": 2.80,
    "Getränke": 0,
    "Fleisch & Wurst": 0,
    "Obst & Gemüse": 0,
    "Tiefkühl": 0,
    "Hygiene & Drogerie": 0,
    "Putzmittel": 0,
    "Sonstiges": 33.84
  }
}
```

Auch OpenAI gpt-4o als Provider unterstützen (gleicher Input, gleicher Output).

---

### 4. Invoice Matcher Modul (`/js/invoiceMatcher.js`)

Matching-Logik: Rechnung ↔ Kontoauszug-Buchung in Firestore

```js
async function findMatchingTransaction(invoice)
```

Match-Algorithmus (in dieser Priorität):
1. **100% Match**: Betrag exakt + Datum ±3 Tage → Score 100
2. **Starker Match**: Betrag exakt + Datum ±7 Tage → Score 85
3. **Schwacher Match**: Betrag ±2€ + Datum ±5 Tage + Händlername ähnlich → Score 60
4. **Kein Match**: Score < 60 → manuell zuweisen

Händlername-Ähnlichkeit: einfaches `includes()` reicht (z.B. "BILLA" in "BILLA PLUS WIEN")

Gibt zurück:
```js
{
  transaction: { ...firestoreDoc },
  score: 100,
  reason: "Betrag und Datum stimmen exakt überein"
}
```

---

### 5. Firestore Datenstruktur

Neue Collection: `invoices/{userId}/items/{invoiceId}`

```js
{
  id: "uuid",
  source: "gmail",                        // oder "manual_upload"
  gmailMessageId: "...",                  // für Duplikat-Check
  haendler: "Billa Plus Wien Mariahilf",
  datum: "2025-09-14",
  betrag: 43.20,
  rechnungsnummer: "...",
  positionen: [...],
  subkategorien_summen: {...},
  matchedTransactionId: "tx_abc123",      // null wenn unmatched
  matchScore: 100,
  matchReason: "Betrag und Datum exakt",
  status: "matched" | "unmatched" | "ignored",
  createdAt: Timestamp
}
```

Bestehende Collection `transactions/{userId}/items/{txId}` erhält neues Feld:
```js
invoiceId: "inv_xyz"   // null wenn kein Bon verknüpft
```

---

### 6. UI: Rechnungs-Screen (`/screens/invoices.html` oder Section in `index.html`)

Mobile-First, exaktes Design-System aus CLAUDE.md verwenden:
- Background `#FFF8F5`, Primary `#5D1C34`, Noto Serif + Manrope
- `color-scheme: light only` + `background-color: #FFF8F5 !important` (iOS Fix!)

Sections:
- **Gmail verbinden** Button (OAuth2 Flow starten)
- **"X neue Rechnungen abrufen"** Button (nach Login)
- **Inbox-Liste**: Rechnung · Händler · Betrag · Match-Status Chip
  - ✅ Matched · ⚠️ Schwacher Match · ❓ Kein Match
- **Drill-Down**: Tippen auf Rechnung → Einzelpositionen + Sub-Kategorien
- **Manuelles Matching**: Dropdown mit offenen Buchungen wenn kein Auto-Match

---

### 7. Dashboard-Erweiterung

Im bestehenden Dashboard (Kategorien-Section) neue Zeile:
- Sub-Kategorien aufklappbar wenn Bon vorhanden
- Beispiel: Supermarkt 450,50 € → ausklappen → 🍫 Süßwaren 34,20 € / 🥛 Milch 18,40 € / ...
- Monatsvergleich: "Naschen: diese Monat +12% vs. Vormonat"

---

### 8. Unterstützte Rechnungs-Formate

Der Analyzer soll mit diesen österreichischen/deutschen Händlern umgehen können:

| Händler | Format | Besonderheit |
|---------|--------|--------------|
| Billa / Billa Plus | PDF Kassenbon | Einzelpositionen vorhanden |
| Merkur | PDF Kassenbon | wie Billa |
| Amazon | HTML/PDF | Mehrere Artikel, Versandkosten separat |
| Zalando | PDF | Oft nur Gesamtbetrag, keine Positionen |
| MediaMarkt | PDF | Seriennummern ignorieren |
| Verbund (Strom) | PDF | Referenz-Code in extract_verbund.py verwenden |
| Wien Energie | PDF | Ähnlich Verbund |
| Apotheke | PDF/Bon | MwSt-Aufschlüsselung relevant |

Wenn keine Einzelpositionen vorhanden: `positionen: []`, `subkategorien_summen` mit Gesamtbetrag unter "Sonstiges".

---

### 9. Dateien anlegen / updaten

Nach Umsetzung bitte diese Dateien updaten:

- [ ] `CHANGELOG.md` — neuen Eintrag für Gmail Invoice Matcher
- [ ] `TODO.md` — Phase 3b als erledigt markieren
- [ ] `CLAUDE.md` — gmailService.js und invoiceAnalyzer.js in Dateistruktur eintragen
- [ ] `README.md` — Gmail API Setup Abschnitt ergänzen

---

### 10. Was NICHT gebaut werden soll (yet)

- Kein Push/Webhook (Gmail watch() + Pub/Sub) — manueller "Abrufen" Button reicht
- Kein automatisches Kategorisieren ohne User-Bestätigung beim ersten Mal
- Kein Weiterleiten/Löschen von E-Mails
- Kein Zugriff auf andere Labels als "Rechnungen" (oder INBOX mit PDF-Filter)

---

## Sicherheitshinweise

- OAuth2 Token nur in `localStorage` speichern, nie in Firestore oder Code
- `client_secret` gehört in `firebase-config.js` → `.gitignore` → nie committen
- Gmail Scope so klein wie möglich: `gmail.readonly` für Lesen, `gmail.modify` nur für "gelesen markieren"
- Kein Zugriff auf E-Mail-Body — nur Attachments und Header (Von, Datum, Betreff)
