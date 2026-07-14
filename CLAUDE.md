# CLAUDE.md — Finance Dashboard

Dieses File steuert das Verhalten von Claude Code bei Änderungen am Projekt.

## Projekt-Überblick

Persönliches Finance Dashboard (ieeks/finance-dashboard).
Stack: Vanilla JS · PDF.js · Claude Haiku API · Firebase Auth · Firebase Firestore · GitHub Pages.
Lokaler Ordner: ~/Developer/finance-dashboard

## Versionierung

Format: `v MAJOR.MINOR.PATCH` — z.B. `v0.9.1`

- **Patch** (`v0.9.0 → v0.9.1`): Bugfix oder kleines Tweak (ein Commit)
- **Minor** (`v0.9.x → v0.10.0`): Neues Feature oder größerer Block
- **Major** (`v0.x → v1.0.0`): Milestone-Release (Firebase-Integration)

Aktuelle Version: `v1.8.2`

## Commit-Konventionen

Format: `feat: kurze Beschreibung` / `fix: …` / `chore: …`

Beispiele:
- `feat: Firebase Auth Login`
- `fix: BAWAG PDF Parser Datumsformat`
- `chore: Version bump v0.2`

## Dateistruktur

```
index.html            # HTML-Gerüst + CSS Design-Tokens (kein JS mehr)
firebase-config.js    # Firebase Config (nicht committen → .gitignore)
README.md
CLAUDE.md
CHANGELOG.md
TODO.md
/js
  app.js              # Bootstrap, Navigation, Render-Funktionen, Event-Handler
  state.js            # globaler App-State + Month-Helpers
  parser.js           # PDF-Extraktion, BAWAG/easybank Parser, KI-Kategorisierung
  bonAnalyzer.js      # Bon/Rechnung Analyse via Claude Vision
  matcher.js          # Bon ↔ Buchung Score-Matching
  categories.js       # CAT_CONFIG, SUBCAT_ICONS, kanonische Listen
  ui.js               # formatEur, formatDate, Toast, Loading, API Keys
/prompts
  parse-transactions.md  # Claude-Prompt für PDF-Parsing
  analyze-bon.md         # Claude-Prompt für Bon-Analyse
/scripts
  delete_firestore_prefixes.js  # Maintenance: löscht pdf_/img_ Docs aus Firestore
/.github/workflows
  gmail_finance_sync.yml          # täglich, Gmail → Firestore
  delete_firestore_prefixes.yml   # manuell, Firestore Cleanup (pdf_/img_)
  ci.yml                          # Tests bei PR/Push
/docs
  mockup-v2.html      # UI-Mockup (Referenz)
```

Maintenance-Workflow „Delete Firestore Prefixes" wird manuell via GitHub Actions ausgelöst (oder über Einstellungen → "🧹 PDF-/Bild-Buchungen aufräumen" in der App). Löscht alle Docs aus `household/main/transactions`, deren ID mit `pdf_` oder `img_` beginnt. Nutzt Secret `FIREBASE_SERVICE_ACCOUNT`.

Kategorien ändern: immer in BEIDEN Stellen:
1. `CAT_CONFIG` in `js/categories.js`
2. Prompt-Text in `prompts/parse-transactions.md`

## Login & Zugangsbeschränkung

- **Firebase Authentication** (Email/Password oder Google Sign-In)
- Nach Login: Email gegen Allowlist in Firestore prüfen (`config/allowed_emails`)
- Nicht erlaubte Email → sofort `signOut()` + Fehlermeldung
- Firestore Security Rules: nur eingeloggte + erlaubte Email kann lesen/schreiben
- **Keine eigene User-Datenbank nötig** — Firebase Auth + Allowlist reicht

## Kategorien (kanonische Liste)

Änderungen an Kategorien immer in BEIDEN Stellen updaten:
1. `CAT_CONFIG` in `js/categories.js` (Icon + Farbe)
2. Prompt-Text in `prompts/parse-transactions.md`

Aktuelle Kategorien:
- Supermarkt
- Restaurant / Café
- Mobilität / Auto
- Wohnen / Miete
- Energie / Strom
- Versicherung
- Drogerie
- Gesundheit
- Online Shopping
- Freizeit
- Gehalt / Einnahmen
- Familientransfer
- Gebühren / Bank
- Telekommunikation
- Sonstiges

## Design System

Drei Prinzipien: **Quiet Luxury · Tonal Layering · Editorial Layout**

### Typografie
- **Headlines**: `Noto Serif` (serif, elegant)
- **Body / Labels**: `Manrope` (clean, modern)

### Exakte Farb-Tokens (aus Mockup-HTML)

```css
/* Surfaces */
--background:                #FFF8F5;
--surface:                   #FFF8F5;
--surface-container-lowest:  #FFFFFF;
--surface-container-low:     #FFF1E8;
--surface-container:         #FEEADB;
--surface-container-high:    #F8E5D6;
--surface-container-highest: #F2DFD0;
--surface-dim:               #EAD7C8;
--surface-variant:           #F2DFD0;

/* Primary — Dunkelrot */
--primary:                   #41051F;
--primary-container:         #5D1C34;
--on-primary:                #FFFFFF;
--on-primary-container:      #DA829C;
--primary-fixed:             #FFD9E1;
--primary-fixed-dim:         #FFB1C6;

/* Secondary — Gold-Braun */
--secondary:                 #7B5723;
--secondary-container:       #FDCC8C;
--secondary-fixed:           #FFDDB5;
--secondary-fixed-dim:       #EEBE80;
--on-secondary:              #FFFFFF;
--on-secondary-container:    #785520;

/* Tertiary — Dunkelgrün (Dark Cards) */
--tertiary:                  #172213;
--tertiary-container:        #2C3727;
--tertiary-fixed:            #DAE6D0;
--tertiary-fixed-dim:        #BECAB5;
--on-tertiary:               #FFFFFF;

/* Text & Borders */
--on-surface:                #231A11;
--on-surface-variant:        #534346;
--outline:                   #857276;
--outline-variant:           #D7C1C5;

/* Error */
--error:                     #BA1A1A;
--error-container:           #FFDAD6;
```

### Design-Prinzipien
- **Light Mode only**: Kein Dark Mode
- **Mobile First**: Alle UI-Änderungen zuerst auf 390px testen
- **Quiet Luxury**: Kein Overdesign — Eleganz durch Zurückhaltung
- **Tonal Layering**: Farben bauen aufeinander auf (creme → sand → gold → dunkelrot)
- **Editorial Layout**: Klare Struktur, viel Whitespace

### Screens geplant
Dashboard · Buchungen · Import · Konten (Multi-Account) · Concierge (Bon-Scan) · Export

## Wichtige Hinweise

- **Kein Build-System**: Alles bleibt Vanilla JS / CDN-Imports
- **API Keys**: In Firestore unter `household/main/config/apiKeys` (Felder `anthropic` / `openai`) gespeichert, nach Login per `setInMemoryKeys()` in den In-Memory-Store geladen. Eingabe über Concierge-Screen (Bon-Analyse). Nie in Code committen.
- **Firebase Config**: in `firebase-config.js` auslagern → in `.gitignore`
- **AI Provider**: Anthropic + OpenAI (gpt-4o-mini) — beide unterstützt.
  Transaktions-Parsing nutzt Claude Haiku; die Bon-/Rechnungs-Analyse
  (`bonAnalyzer.js`) nutzt Claude Sonnet (`_ANTHROPIC_BON_MODEL`), weil dichte
  Thermobons mit zwei Preisspalten für Haiku zu fehleranfällig sind.

## Nach jedem Dev-Session updaten

- [ ] CHANGELOG.md
- [ ] TODO.md
- [ ] Version in index.html
- [ ] **Cache-Bust**: `?v=<version>` in ALLEN lokalen Modul-Imports (`js/*.js`)
      und in der Prompt-URL (`bonAnalyzer.js`) auf die neue Version hochzählen —
      sonst liefert der Browser (v.a. iOS Safari) alte, gecachte Module aus.
      Bulk via: `sed -i -E "s/\\?v=[0-9.]+/?v=NEU/g" js/*.js`

## Cache-Busting (KRITISCH bei kein-Build)

Ohne Build-System werden ES-Module direkt geladen. Der Entry in `index.html`
lädt `app.js` mit `?t=${Date.now()}` (immer frisch), aber **statische Imports
erben diese Query NICHT** — `import … from './bonAnalyzer.js'` würde die alte
gecachte Datei ziehen. Deshalb trägt JEDER lokale Import eine Versions-Query
`?v=<version>`, die pro Release hochgezählt wird. Neue `js/*.js`-Datei →
Import ebenfalls mit `?v=` versehen.

## iOS Dark Mode Fix (KRITISCH)

Ohne diese zwei Zeilen rendert Safari/iOS die App im Dark Mode schwarz statt creme.
**Immer in jeder HTML-Datei im `<head>` einfügen:**

```html
<!-- iOS Dark Mode verhindern -->
<meta name="color-scheme" content="light">
```

**Und im CSS:**

```css
:root { color-scheme: light only; }

html, body {
  background-color: #FFF8F5 !important;
  color: #231A11 !important;
}
```

Gilt für: `index.html` und alle weiteren HTML-Seiten im Projekt.
