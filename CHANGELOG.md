# CHANGELOG

## v1.8.7 — 2026-07-01

### Fixed
- **Karte …0678 (Olga, Haushaltskonto) ergänzt** — Neue Debit-Mastercard
  fehlte in `CARD_ACCOUNT_MAP` (gmail_finance_importer.py) und
  `CARD_CONFIG` (js/state.js), wodurch Rechnungen dieser Karte als
  Konto „unbekannt" importiert wurden.

## v1.8.6 — 2026-07-01

### Fixed
- **Doppelte Gmail-Rechnungen bei erneut verschickten Kassenbons** —
  `_pdf_doc_id()` dedupliziert nur über den SHA256-Hash der PDF-Bytes.
  Manche Händler (z.B. Billa) verschicken denselben Kauf gelegentlich
  als zwei technisch unterschiedliche PDFs (abweichende
  Erzeugungs-Metadaten), wodurch der Hash-Dedup sie nicht erkennt und
  die Rechnung doppelt in Firestore landet. Neuer Fallback
  `_is_semantic_duplicate()` prüft zusätzlich auf
  Store+Datum+Betrag+Konto-Übereinstimmung gegen bereits importierte
  Gmail-Rechnungen und überspringt inhaltliche Duplikate. Betrifft nur
  künftige Importe — bereits doppelt importierte Rechnungen müssen
  manuell bereinigt werden.

## v1.8.5 — 2026-07-01

### Added
- **Konto-Filter im Rechnungen-Screen** — Chip-Reihe zum Filtern der
  E-Mail-Rechnungen nach Konto (Haushalt/Privatkonto Olga/Privatkonto
  Manuel), analog zum Quick-Filter in Buchungen. Chips erscheinen nur,
  wenn Rechnungen aus mehr als einem Konto vorliegen.

## v1.8.4 — 2026-07-01

### Added
- **„Offene Rechnungen"-Tabelle im Rechnungen-Screen** — Zeigt die noch
  nicht mit einer Buchung verknüpften E-Mail-Rechnungen (Gmail-Import)
  als kompakte Tabelle (Händler, Rechnungsdatum, Brutto) oberhalb der
  bestehenden Detail-Liste, analog zur „Offene Belege"-Tabelle im
  Concierge-Screen.

## v1.8.3 — 2026-07-01

### Changed
- **„Offene Belege" als Tabelle** — Die Liste unverknüpfter Belege im
  Concierge-Screen zeigt jetzt Händler, Rechnungsdatum und Bruttobetrag
  in klar ausgerichteten Spalten (statt Freitext-Card), sortiert nach
  Rechnungsdatum absteigend.

## v1.8.2 — 2026-06-01

### Changed
- **Subkategorie „Restaurant / Gericht" → „Restaurant"** umbenannt (kürzer,
  passt besser). Aktualisiert in `js/categories.js`, `prompts/analyze-bon.md`
  und `gmail_finance_importer.py`. Alias `Restaurant / Gericht → Restaurant`
  in beiden Seiten ergänzt, damit bereits gespeicherte Posten automatisch
  mitwandern.

## v1.8.1 — 2026-06-01

### Fixed
- **Trinkgeld (unbar) → Bon matchte nie** — Bei Restaurant-Bons wird das
  Trinkgeld separat von der Karte abgebucht (z.B. Summe 59,20 + Trinkgeld
  5,80 = Belastung 65,00), stand aber nicht im Bon-Total. Der Matcher
  verglich nur gegen 59,20 → Abstand 5,80 € → Hard-Out, kein Match möglich.
  Jetzt:
  - **Trinkgeld-Erkennung** — neues `tip`-Feld im Bon-Prompt
    (`prompts/analyze-bon.md`) + Parsing in `js/bonAnalyzer.js`
    (`tip`/`trinkgeld`/`gratuity`).
  - **Matcher** — `findMatch`/`analyzeBonLinks` matchen gegen `total` UND
    `total + tip` (kleinerer Abstand gewinnt). 3 neue Tests.
  - **Anzeige** — Concierge-Ergebnis und Buchungs-Detail zeigen
    „Summe · 💝 Trinkgeld · Bezahlt" wenn ein Trinkgeld erkannt wurde.

## v1.8.0 — 2026-06-01

### Added
- **Subkategorie „Restaurant / Gericht" 🍽️** — Die Subkat-Taxonomie war rein
  supermarkt-orientiert; zubereitete Gastro-Gerichte (Tempura, Bulgogi,
  Bibimbap …) landeten zwangsläufig in „Sonstiges". Neue Subkategorie in
  `js/categories.js` (`SUBCAT_ICONS`), `prompts/analyze-bon.md` und der
  Python-Spiegelliste `SUBCATEGORIES` in `gmail_finance_importer.py`.
- **Subkategorie-Editor im Bon-Scan-Screen** — Im Concierge-Ergebnis
  („Kassenbon verknüpfen") lässt sich die Subkategorie jetzt pro Posten
  direkt per Dropdown ändern (`updateCurrentBonItemSubcat`), inkl. Merken als
  Override. Bisher war das nur in der Buchungs-Detailansicht möglich.

### Fixed
- **Datum falsch interpretiert (TT.MM ↔ MM.TT)** — Bei österreichischen Bons
  las das Modell „01.06.2026" teils als 6. Jänner statt 1. Juni. Der
  Bon-Prompt enthält jetzt einen expliziten Hinweis auf das `TT.MM.JJJJ`-Format.

## v1.7.1 — 2026-06-01

### Fixed
- **Anthropic „API 400" bei Bon-Bildern** — Zwei anbieter-spezifische
  Ursachen behoben, die nur Claude (nicht OpenAI) betrafen:
  1. **media_type** — Anthropic akzeptiert nur exakt
     `image/jpeg|png|gif|webp`. Handys liefern oft `image/jpg` (ohne „e")
     oder leeren Typ → 400. Neue `_normalizeMediaType()` in
     `js/bonAnalyzer.js` mappt das korrekt.
  2. **Bildgröße** — Anthropic limitiert auf 5 MB / ~1568px lange Kante;
     Handy-Fotos sprengen das. Neue `downscaleImage()` in `js/app.js`
     verkleinert & re-encodet Bilder vor dem Upload als JPEG (Fallback:
     Original-Bytes). Beschleunigt auch den OpenAI-Pfad.
- **Echte API-Fehlermeldung im Toast** — Statt „API 400" wird jetzt der
  Fehler-Body von Anthropic/OpenAI ausgelesen und angezeigt
  (`_apiError()`), z.B. „Anthropic 400: messages.0… image exceeds 5 MB".

## v1.7.0 — 2026-06-01

### Fixed
- **API-Key-Eingabe für Bon-Analyse repariert** — Die „Speichern"-Handler
  (`saveKeys`, `saveBonKey`) riefen eine nirgends definierte Funktion
  `saveKey()` auf (`ReferenceError`), und im Concierge-Screen fehlte das
  Eingabefeld komplett. Damit war Claude Vision für die Bon-Analyse faktisch
  nicht nutzbar. Jetzt funktionierend.

### Added
- **Key-Eingabefeld im Concierge-Screen** — Pro Anbieter (Anthropic / OpenAI)
  ein Passwort-Feld + „API Key speichern"-Button. Der Key wird via neuer
  `fsSaveApiKeys()` nach Firestore (`household/main/config/apiKeys`, merge)
  geschrieben und sofort in den In-Memory-Store übernommen.
- **Vorbefüllung beim Login** — Bereits gespeicherte Keys erscheinen beim
  Start in den Feldern (`_initApp`).

### Changed
- **Null-sichere Provider-Handler** — `setProviderUI` und `setBonProvider`
  greifen nicht mehr ungeprüft auf DOM-Elemente zu (verhinderte zuvor einen
  möglichen Init-Crash).

## v1.6.3 — 2026-05-25

### Changed
- **„Ohne Bon"-Filter & Dashboard-Zähler an Tag-Logik gekoppelt** — Der
  Filter „Ohne Bon" und das Dashboard-Widget „X Buchungen ohne Bon" zeigen
  jetzt exakt die Buchungen, die auch sichtbar „⚠️ kein Bon" tragen
  (Ausgabe · kein Bon · nicht wiederkehrend · bon-relevante Kategorie).
  Fixkosten/Abos sowie Familientransfer & Gebühren fallen damit aus
  Filter und Zähler — keine Drift mehr zwischen Tag und Filter. Neue
  gemeinsame `needsBon()`-Funktion in `js/app.js`.

## v1.6.2 — 2026-05-25

### Changed
- **Kein „⚠️ kein Bon" mehr bei Fixkosten** — Daueraufträge/Abos
  (`isRecurring`) zeigen das Warn-Tag nicht mehr, weil sie per Definition
  keinen Kassenbon haben. Betrifft u.a. Magenta, Allianz KFZ, BYD/Raiffeisen
  Leasing, Netflix, Spotify. `belegStatusTag` in `js/app.js`.
- **PayPal-Abos als wiederkehrend markiert** — `SUBSCRIPTION_RULES`
  (Netflix/Spotify/Amazon Prime via PayPal) setzen jetzt `isRecurring`, damit
  auch sie kein „kein Bon"-Tag bekommen und konsistent in den Fixkosten
  erscheinen. `_applySubscriptionRules` in `js/parser.js`.

## v1.6.1 — 2026-05-25

### Changed
- **„Als offen speichern" hervorgehoben** — Wenn beim Bon-Scan keine
  passende Buchung gefunden wird, ist die Aktion jetzt ein gefüllter
  Primary-Button (dunkelrot) statt eines dezenten gestrichelten Ghost-
  Buttons. Verbessert die Auffindbarkeit der Funktion in `js/app.js`
  (`renderConciergeResult`, No-Match-Fall).

## v1.6.0 — 2026-05-23

### Added
- **Maintenance-Workflow „Delete Firestore Prefixes"** — Neuer
  GitHub-Actions-Workflow `.github/workflows/delete_firestore_prefixes.yml`
  (manuell via `workflow_dispatch`) löscht alle Docs aus
  `household/main/transactions`, deren ID mit `pdf_` oder `img_` beginnt.
  Node-20 + `firebase-admin` (ESM), 500er-Batches, loggt Anzahl + „Fertig".
  Nutzt das bestehende Secret `FIREBASE_SERVICE_ACCOUNT` via env
  `GOOGLE_APPLICATION_CREDENTIALS_JSON`.
- **Aufräum-Button im Einstellungen-Modal** — Neuer Ghost-Link
  „🧹 PDF-/Bild-Buchungen aufräumen (Actions)" öffnet die Run-Workflow-Seite
  in einem neuen Tab. Kein Token im Client, Auslösung bleibt im GitHub-Auth-
  Kontext.
- **README + CLAUDE.md** dokumentieren den Maintenance-Workflow und seine
  beiden Auslöse-Wege (App-Button oder direkt Actions-Tab).
- **Diagnose-Step im Gmail-Sync-Workflow** — Printet vor dem Importer die
  Länge (nicht den Wert) von `OPENAI_API_KEY` und `ANTHROPIC_API_KEY`.
  Macht sofort sichtbar, wenn ein Secret leer ankommt.

### Changed
- **Importer-Dedup vor AI-Call** — `process_pdf` und `process_image` in
  `gmail_finance_importer.py` checken jetzt `is_duplicate(doc_id)` als
  ersten Schritt. Bei Treffer wird der AI-Call übersprungen. Da die
  `doc_id` deterministisch aus den File-Bytes (SHA-256) gebildet wird,
  ist der Check vor dem AI-Call korrekt. Im täglichen Cron-Lauf werden
  jetzt nur noch wirklich neue Mails durch die AI gejagt — bei 308
  Anhängen im 30-Tage-Fenster sind das typisch 2–3 pro Tag statt 308.
- **AI-Parse-Fehler loggen Provider + Snippet** —
  `_parse_ai_response(text, provider)` printet bei fehlgeschlagenem
  Parse die ersten 200 Zeichen der Roh-Antwort + Provider-Name (OpenAI /
  Anthropic / OpenAI Vision / Anthropic Vision). Damit klar wird, ob
  das Modell Markdown-Drumherum, eine Erklärung statt JSON oder einen
  Auth-Fehler zurückgibt.

### Fixed
- **ESM-Import im Cleanup-Script** — `scripts/delete_firestore_prefixes.js`
  scheiterte initial mit `ReferenceError: require is not defined` weil
  das Repo `"type": "module"` in `package.json` setzt. Auf
  `import admin from 'firebase-admin'` umgestellt.
- **ANTHROPIC_API_KEY-Fallback funktionierte nicht** — Secret war leer im
  Workflow-Env, daher schlug jeder Anthropic-Fallback nach OpenAI-Fail
  stumm fehl. Secret neu hinterlegt (Repository Secret); Diagnose-Step
  zeigt jetzt die Key-Länge.

---

## v1.5.6 — 2026-05-22

### Fixed
- **Subkat-Drift in Bon-Aufschlüsselung** — "Brot & Backwaren" und
  "Backwaren" tauchten beide nebeneinander auf (genauso "Hygiene"/
  "Hygiene & Drogerie" etc.), weil ältere Imports noch die alten Namen
  trugen. Neue `SUBCAT_ALIASES`-Map in `categories.js` + Mirror der
  Python-Aliasliste. `normalizeSubcategory(value)` mappt Alias →
  kanonisch (kein Sonstiges-Fallback, damit echte Daten erhalten
  bleiben). `renderBonBreakdown` normalisiert beim Rendern. Zusätzlich
  läuft `_migrateSubcatAliases` einmalig nach `loadAllData()` und
  schreibt korrigierte Subkategorien zurück nach Firestore (no-op
  sobald clean).

---

## v1.5.5 — 2026-05-22

### Fixed
- **Bon-Aufschlüsselung: zu viel in "Sonstiges"** — Rechnungs-Bons (Miete-
  Helvetia, Strom, Telekom, Versicherung) wurden als einzelnes Item mit
  dem vollen Rechnungsbetrag mitgezählt und landeten in "Sonstiges".
  Zwei Fixes: (1) Neue Allowlist `BON_BREAKDOWN_CATS` beschränkt die
  Aufschlüsselung auf Kategorien mit strukturell mehrteiligen Bons
  (Supermarkt, Restaurant, Drogerie, Online Shopping, Freizeit,
  Gesundheit). (2) `BON_EXCLUDED_COMPANIES`-Check matcht jetzt auch
  gegen `bon.vendor`/`bon.store`, nicht nur gegen die Bank-Tx-
  Description (die durch Helvetia-→-Miete-Rewrite die Original-Vendor-
  Info verliert). Bestehende Daten werden ohne Re-Import korrekt
  angezeigt.

---

## v1.5.4 — 2026-05-22

### Added
- **Dashboard → Buchungen Drill-Down** — Klick auf eine Top-Kategorie oder
  Monatsvergleich-Zeile springt zum Buchungen-Tab mit gesetztem
  Kategorie-Filter (`_buchFilter.cats = [cat]`, `typ = 'aus'`). Search-
  Input wird zurückgesetzt damit der Filter sicher greift. Chevron-Pfeil
  (›) als visueller Affordance-Hinweis.

---

## v1.5.3 — 2026-05-22

### Added
- **Monatsvergleich-Karte** (R3) — Neue Dashboard-Karte zeigt für die Top
  5 Ausgaben-Kategorien des aktuellen Monats die Veränderung gegenüber
  dem Vormonat. Chip mit ▲ (rot, mehr ausgegeben) / ▼ (grün, weniger)
  und Prozentsatz, plus Vormonats-Betrag als Sub-Label. Neue Kategorien
  ohne Vormonats-Daten erhalten einen "neu"-Chip. Karte wird ausgeblendet
  wenn der Vormonat leer ist oder noch keine Daten im aktuellen Monat
  liegen. `_prevMonth(ym)`-Helper handhabt Jahreswechsel via
  `new Date()`-Konstruktor.

---

## v1.5.2 — 2026-05-22

### Added
- **Re-Match-Maintenance** (R4) — Neue Karte "Bon-Verknüpfungen prüfen" im
  Konten-Screen. Pure Funktion `analyzeBonLinks(transactions)` in
  `matcher.js` re-evaluiert alle Bank-Tx-↔-Bon-Links gegen den aktuellen
  Matcher (Single-Candidate-`findMatch`, MIN_SCORE 60). Chip zeigt
  grün/gold + Anzahl. Modal listet verdächtige Verknüpfungen (Tx vs.
  Bon-Vendor/Betrag) und bietet "Verdächtige lösen". Bank-Buchungen
  bleiben unverändert — nur `tx.bon` wird auf `null` gesetzt.
- 6 neue Tests in `tests/matcher.test.js`: `analyzeBonLinks` — OK-Match,
  McDonald's-Bug-Stale, Tx ohne Bon ignoriert, positive Tx ignoriert,
  Mischung OK+stale, stale-Details für UI.

### Notes
- Self-Healing für Gmail-Bons (PR #4) macht das Tool für Gmail-Imports
  unnötig — aber für manuell verknüpfte und Pending-Bon-Auto-Links ist
  es der einzige Weg, ohne Firestore-Console aufzuräumen.

---

## v1.5.1 — 2026-05-22

### Refactored
- **Personal-Config zentralisiert** — `js/personalConfig.js` neu mit
  `LANDLORD = { vendorPattern, mieteKeywords }`. Helvetia-Hausverwalter-
  Logik aus `parser.js` (`_extractDesc`-Branch für Helvetia) und
  `categories.js` (`RECURRING_RULES` "Miete"-Eintrag) raus, einmal
  zentral. Python-Mirror in `gmail_finance_importer.py` (`LANDLORD`-Dict)
  mit Sync-Kommentar.
- 5 zusätzliche Tests in `TestLandlord` (Vermieter-Pattern + Miete-Keywords).

### Notes
- Bei Open-Source-Veröffentlichung kann `personalConfig.js` gitignored
  und durch `personalConfig.example.js` ersetzt werden.

---

## v1.5.0 — 2026-05-21

### Fixed (Browser)
- **Dashboard doppelt-zählte Gmail-Rechnungen** — `renderDashboard` summierte Bank-Buchungen UND die per `_autoLinkGmailBons` verknüpften Gmail-Tx. Konkret: Supermarkt €1.656,49 statt €858,01, Versicherung €1.783,95 statt €0. Fix filtert `source !== 'gmail_import'` vor allen Summationen (`renderDashboardCategories`, `renderBonBreakdown`, `renderFixkosten`, `renderInsight`, `renderBelegStatus`). `renderRechnungenTeaser` bekommt weiterhin die volle Liste.

### Fixed (Python Gmail-Importer)
- **Helvetia → Miete Override** — Python kategorisierte Helvetia-Rechnungen per AI als "Versicherung". Helvetia ist hier aber Hausverwalter (kassiert Miete). Gleiche Heuristik wie `parser.js`: Helvetia + Vorschreibung/Miete/Betriebskosten/Hausverwaltung/Rennweg → `Wohnen / Miete`.
- **Pfand-Erkennung fehlte komplett** — Subkategorie "Pfand" wurde dem AI nie als Option gegeben, Pfand-Items landeten in "Sonstiges". Jetzt mit allen österr. Varianten: DPG, ePfand, Leergut, PFAND EW/MW, Pfandartikel, Pfand 0,25/0,09/0,15.
- **9 fehlende Subkategorien** — Python kannte 10, JS 19. Ergänzt: Fisch / Meeresfrüchte, Nudeln & Reis, Öl, Aufstriche & Butter, Gewürze & Saucen, Konserven, Pfand, Elektronik, Dienstleistung.
- **Naming-Drift** — `Brot & Backwaren` → `Backwaren`, `Hygiene` → `Hygiene & Drogerie` (war in v1.3.2 nur in JS dedup't).
- **Feldname** `subkategorie` → `subcategory` (= JS-Schema). `save_to_firestore` akzeptiert weiterhin beide Namen.

### Added (Python Gmail-Importer)
- **Single Source Markdown-Prompt** — `gmail_finance_importer.py` lädt `prompts/analyze-bon.md` direkt. Browser-Bon-Scanner und Python-Importer nutzen denselben Prompt. Drift strukturell unmöglich. Plus Python-spezifischer Suffix für Top-Level `category` (Browser braucht das nicht — Bank-Tx liefert die Kategorie via Auto-Link).
- **`isRecurring`-Flag** — Gmail-Rechnungen für Netflix, Spotify, Allianz, Magenta, Helvetia/Miete, BYD Leasing bekommen jetzt `isRecurring=true` + `recurringLabel` analog zu `RECURRING_RULES` in `js/categories.js`. Plus Kategorie-Override wenn die Regel eine definiert (Magenta → Telekom, Allianz KFZ → Mobilität, Allianz → Versicherung).
- **`CARD_MERCHANTS`-Normalisierung** — 52 Patterns aus `parser.js` portiert. "BILLA AG, 1030 Wien" wird zu "Billa", "MCDONALDS WIEN" zu "McDonald's". Konsistente Display-Namen zwischen Bank-Tx und Gmail-Tx → bessere Matcher-Scores.

### Refactored (Python Gmail-Importer)
- `MAIN_CATEGORIES`, `SUBCATEGORIES`, `RECURRING_RULES`, `CARD_MERCHANTS` als Modul-Konstanten. Bei Änderungen IMMER auch in JS-Side aktualisieren.
- `save_to_firestore` akzeptiert das JS-Schema (`store`/`date`/`total`/`items`/`category`/`subcategory`) mit Fallback auf die alten deutschen Namen (für AI-Outputs aus Training-Daten).
- `_ai_get(d, *keys, default)` Helper, `_normalize_subcategory`, `_normalize_store`, `_match_recurring`, `_SUBCAT_ALIASES`.
- Trace-Logs in `process_pdf`/`process_image` auf JS-Schema umgestellt.

### Notes
- Helvetia-Gmail-Docs die bereits mit "Versicherung" in Firestore stehen werden vom Dashboard nicht mehr summiert (Browser-Fix), behalten aber kosmetisch ihre alte Kategorie im Rechnungen-Tab. Cleanup falls gewünscht: Doc löschen → GitHub Action neu laufen lassen.

---

## v1.4.0 — 2026-05-21

### Fixed (Matcher)
- **Score-System neu aufgebaut** (`matcher.js`) — vier diskrete Stufen ersetzt durch gewichtete Punkte: Betrag (max 50) + Datum (max 30) + Name (max 20). Hauptbug behoben: Bon mit ähnlichem Betrag aber falschem Händler (z.B. Billa-Bon 19,78 € auf McDonald's-Buchung 19,00 €) bekam vorher Score 55 ohne Namensprüfung.
- **`nameSimilarity` token-basiert** — Diacritic-Normalisierung (`Café` ≡ `Cafe`), Mindest-Tokenlänge 3 (kein False-Positive mehr bei `DM`/`BP`/`JET`), Wortreihenfolge egal (`Joseph Bäckerei` ≡ `Bäckerei Joseph`).
- **Hard-Outs ergänzt** — Bon-Datum mehr als ~1 Tag NACH Buchung → kein Match (Bank bucht 0–7 Tage NACH Kauf). Wenn Name komplett fehlt UND Betrag nicht exakt → kein Match.
- **`amountDiff < 0.005 €` statt `=== 0`** — Float-Safety, konsistent mit `parser.js`.
- **Tiebreaker** bei Score-Gleichstand: kleinerer Betragsabstand → wenigere Tage → höherer Name-Score.
- **`excludeIds`-Set** für Exklusivität — dieselbe Buchung hängt nicht mehr an zwei Bons gleichzeitig (`_autoLinkGmailBons` + Pending-Bon-Auto-Match in `app.js`).

### Fixed (Parser)
- **`CARD_MERCHANTS` Reihenfolge** (`parser.js`) — `BILLA PLUS` jetzt vor `BILLA`, sonst wurde Billa Plus nie als solches erkannt.
- **`_dedup` vollständige Description** als Key — keine Kollision mehr bei zwei "Bezahlung Karte …" am selben Tag mit gleichem Betrag.
- **`parseGenericStatement` zeilenweise + anchored** — Header/Footer mit Datumsangabe (`Saldo per 31.12.2025: …`) werden nicht mehr als Transaktion gelesen. Skip-Liste: Saldo/Übertrag/Summe/IBAN/Seite.
- **`SUBSCRIPTION_RULES` bewahrt `originalDescription`** — ermöglicht späteres Bon-Matching auch nach Umbenennung zu "Netflix".
- **`RECURRING_RULES.category` wird angewendet** wenn definiert (vorher Dead Code).

### Added
- **`js/owners.js`** — Familienmitglieder-Konfiguration mit `matchOwner()`-Helper. Personennamen nicht mehr über `parser.js` verstreut.
- **Debug-Flag `window.DEBUG_PARSER`** — alle `[DBG-*]`-Logs in DevTools opt-in statt Default-Spam.
- **Browser-Test-Runner** (`tests/`) — schlanker ES-Module-Runner ohne Framework. `tests/run.html` öffnen, fertig. 20 Tests für Matcher + Owners. Anleitung in `tests/README.md`.
- **`docs/code-review-2026-05-20.md`** — vollständiger Code Review mit 14 Findings, 10 atomaren Patches und 4-Phasen-Plan.

### Notes
- Parser-Fixture-Tests (Phase C1 aus Review) noch offen — brauchen anonymisierte echte PDF-Texte.
- 100%-Match jetzt bei score ≥ 95 (statt 100) — saubere Token-Matches mit kleinen Bon-Store-Suffixen wie Filialnummern landen bei 93.

---

## v1.3.2 — 2026-05-03

### Fixed
- **dm-Buchungen Duplikat** — Gmail-importierte Rechnungen (`source: gmail_import`) erschienen neben den PDF-Bankbuchungen als zweiter Eintrag am selben Tag. `renderBuchungen` filtert sie jetzt standardmäßig heraus (eigener Rechnungen-Screen). Neue Funktion `_autoLinkGmailBons()` verknüpft den `bon` der gmail-Transaktion beim App-Start und nach PDF-Import automatisch mit der passenden Bankbuchung.
- **Sub-Kategorien Duplikate** — Aliase (`Süßwaren`, `Brot & Backwaren`, `Fleisch`, `Reis`, `Hygiene`) aus `SUBCAT_ICONS` entfernt; nur noch kanonische Bezeichnungen im Dropdown.
- **Pfand-Erkennung** — Alle österreichischen Varianten im Bon-Prompt explizit aufgelistet: `DPG`, `ePfand`, `Leergut`, `Leergutbon`, `PFAND EW/MW`, `Pfandrückgabe`, `Pfandartikel`, `Pfand Artikel`. `Mobilität / Auto` aus den Hints entfernt (war nicht in erlaubter Subcategory-Liste).

### Added
- **Sub-Kategorien** `Fisch / Meeresfrüchte 🐟`, `Öl 🫙`, `Gewürze & Saucen 🧂`, `Konserven 🥫` in `categories.js` + Bon-Prompt ergänzt.

---

## v1.3.1 — 2026-05-02

### Added
- **Karten-Mapping** (`CARD_CONFIG` in `state.js`) — Letzte 4 Ziffern einer Zahlungskarte werden auf eine Konto-ID gemappt. Karten sind Zugriffswege auf ein Konto, keine eigenen Konten. Unterstützt beide Bon-Formate: `XXXX XXXX XXXX 1234` (Standard) und `############1234` (Billa).
- **4 Konten mit IBANs** (`state.js`) — Haushaltskonto Easybank, Privatkonto Olga Easybank, Privatkonto Olga Erste Bank, Privatkonto Manuel Erste Bank als Default-Konten hinterlegt (inkl. IBAN, Farbe, Kürzel).
- **`card_last4` Feld** in `prompts/analyze-bon.md` + `gmail_finance_importer.py` — KI extrahiert Kartennummer aus dem Bon; Importer löst sie via `CARD_ACCOUNT_MAP` auf den korrekten Account auf. Unbekannte Karte / Barzahlung → `account: "unbekannt"`.

### Fixed
- **Hardkodierte `'easybank'` Account-ID entfernt** — `parser.js` Fallback, PDF-Autoerkennung und Fallback-Slug in `app.js` auf `'haushalt'` / `'privat_manuel'` umgestellt. Neue PDF-Imports landen jetzt im richtigen Konto statt in einem nicht mehr existierenden `easybank`-Account.
- **`isDefault`-Schutz** (`app.js`) — Lösch-Button wird jetzt für alle 4 Default-Konten unterdrückt statt nur für `easybank`/`bawag`.

---

## v1.3.0 — 2026-05-01

### Added
- **Score-basiertes Bon-Matching** (`matcher.js` integriert) — Concierge zeigt jetzt den besten Match mit Score-Chip (`100% Match` / `Starker Match` / `Möglicher Match` / `Schwacher Match`) und Begründung (`Betrag und Datum stimmen exakt überein` etc.) statt einer einfachen Betrags-Liste.
- **Rechnungen-Screen: Match-Score-Chip** — Jede verknüpfte Gmail-Rechnung zeigt neben der Buchung den Score-Chip der Übereinstimmungsqualität.
- **Auto-Link beim Import via matcher.js** — Pending Bons werden beim PDF-Import jetzt über Betrag + Datumsnähe + Händlername gematcht (Score-System) statt einem losen 60-Tage-Betragsvergleich. Weniger False Positives.

---

## v1.2.9 — 2026-05-01

### Added
- **Beleg-Status Card (Dashboard)** — Neue Karte zeigt zwei offene Posten: „X Bons ohne Buchung" (gescannte Bons in der Pending-Queue) und „X Buchungen ohne Bon" (Ausgaben des Monats ohne verknüpften Beleg). Tap navigiert direkt in den Bon-Scanner bzw. in die gefilterte Buchungsliste. Karte blendet sich aus wenn beide Werte 0 sind.
- **Rechnungen-Screen** — Neuer Screen erreichbar über Dashboard-Karte „E-Mail Rechnungen". Zeigt alle Gmail-Rechnungen des gewählten Monats mit Match-Status: ✅ verknüpft (inkl. Buchungsname + Datum) oder ⚠️ Kein Match (mit „In Buchungen suchen →"-Button). Summary-Zeile: Anzahl gesamt / verknüpft / offen.
- **Beleg-Status pro Buchung** — Jede Ausgabe in der Buchungsliste zeigt unterhalb des Betrags `✅ Bon` (wenn verknüpft) oder `⚠️ kein Bon` (wenn Kategorie bon-relevant ist: Supermarkt, Restaurant, Online Shopping etc.).
- **Quick-Filter Chips (Buchungen)** — Chips „◻ Ohne Bon" und „✅ Mit Bon" direkt unterhalb der Suchleiste für One-Tap-Filterung; aktiver Chip wird hervorgehoben; schalten beim erneuten Tippen auf „Alle" zurück.
- **Konto hinzufügen (Konten-Screen)** — Echtes Modal statt Placeholder-Toast: Name, IBAN (optional), Kürzel (1–2 Zeichen) und Farbwahl (6 Swatches). ＋-Icon in Topbar und „Neues Konto verknüpfen"-Button öffnen das Sheet. Eigene Konten können per ✕ gelöscht werden (Standard-Konto geschützt).
- **Account-Selektor im Import-Screen** — Wenn mehr als ein Konto vorhanden ist, erscheint nach dem PDF-Upload ein Chip-Selektor „Konto zuordnen". Vorselektion per Dateinamen (easy → easybank, sonst erstes Konto). Alle importierten Buchungen erhalten die gewählte Account-ID; `acc.lastImport` wird korrekt gesetzt.

### Fixed
- **JSON-Crash (parser.js)** — `text.match(/\[[\s\S]*\]/)` kann null zurückgeben; führte zu unbehandeltem TypeError. Null-Check + try/catch um `JSON.parse` ergänzt; klare Fehlermeldung statt Crash.
- **JSON-Crash (bonAnalyzer.js)** — `_safeParseObject` crashte bei ungültigem JSON; try/catch + Struct-Normalisierung mit Defaults (`store`, `date`, `total`, `items`, `category`) verhindert Downstream-Crashes in `renderConciergeResult`.

---

## v1.2.8 — 2026-04-29

### Added
- **Subkategorie-Overrides** — manuelle Subkat-Änderung im TX-Modal wird in Firestore (`config/subcategoryOverrides`) gespeichert. Beim nächsten Scan desselben Produkts (normalisierter Name) wird die gemerkte Subkategorie automatisch angewendet. Toast-Bestätigung: "Subkategorie geändert & gemerkt".

### Fixed
- **Pfand-Erkennung** — Hinweis im Bon-Prompt ergänzt: "PFAND EINWEG / PFAND MEHRWEG / DPG → Pfand". Wurde zuvor als "Sonstiges" kategorisiert.

---

## v1.2.7 — 2026-04-29

### Added
- **Bon-Ausschluss-Liste** (`BON_EXCLUDED_COMPANIES` in `categories.js`) — T-Mobile Austria GmbH, Helvetia Versicherungen AG und Tesla werden aus der Bon-Aufschlüsselung ausgeblendet (auch wenn ein Bon verknüpft ist). Neue Firmen einfach zur Liste hinzufügen.
- **Neue Subkategorien** — Nudeln & Reis 🍝, Aufstriche & Butter 🧈, Pfand ♻️ in `categories.js` + Bon-Analyse-Prompt aktualisiert.
- **Pulse-Ring Animation** am Onboarding-ℹ-Icon — dunkelroter Halo-Ring (1.8s, `--primary`), stoppt beim ersten Öffnen via `localStorage`.

### Removed
- **PROTOTYP-Badge** aus der Dashboard-Topbar entfernt.

---

## v1.2.6 — 2026-04-27

### Added
- **Onboarding-Modal** — 4-Schritte Carousel (horizontales Swipe) erreichbar über ℹ-Icon in der Dashboard-Topbar. Erscheint nicht automatisch beim Start. Schritte: Überblick · E-Mail-Rechnungen · PDF-Import · Alles bereit. SVG-Icons (Balkendiagramm · Briefumschlag · Dokument · Checkmark) im Quiet-Luxury-Stil.

---

## v1.2.5 — 2026-04-27

### Fixed
- **localStorage-Migration entfernt** — `migrateFromLocalStorage()` überschrieb beim Login korrekte Firestore-Daten mit alten localStorage-Inhalten (`savedBy: "migration"`). Migrations-Code komplett entfernt.
- **localStorage-Cleanup beim Login** — `finance_v2_data` Key wird beim Login automatisch gelöscht, auch auf Geräten ohne DevTools-Zugang (iPhone).
- **Subkat-Drill-Down** — Tippen auf Subkategorie-Zeile im Bon-Breakdown öffnet Modal mit allen Einzelpositionen (Name · Händler · Preis).
- **Firestore immer überschreiben** — Gmail-Importer überschreibt existierende Docs statt bei Duplikat zu skippen, damit Prompt-Änderungen sofort wirken.

## v1.2.4 — 2026-04-27

### Fixed (gmail_finance_importer)
- **Beschreibung**: `absender` wird jetzt auf Firmennamen gekürzt (kein Komma/Adressteil mehr). Fallback-Cleanup auch falls AI die Regel ignoriert.
- **Kategorien**: Prompt ergänzt um Supermarkt, Restaurant / Café, Drogerie, Freizeit — Billa/Hofer/Spar werden nicht mehr als "Sonstiges" abgelegt.
- **Einzelposten**: Kassenbons mit Positionsliste werden als `bon.items` in Firestore gespeichert (gleiche Struktur wie Bon-Analyzer). Damit erscheinen die Items im Dashboard-Bon-Breakdown und im TX-Modal.

## v1.2.3 — 2026-04-27

### Added
- **"✉ Rechnung" Badge** in der Buchungsliste für alle Transaktionen mit `source: "gmail_import"` — visuell unterscheidbar von PDF-importierten Buchungen.
- **Quellen-Filter** im Filter-Sheet: "Alle" / "✉ Rechnungen" / "📄 Kontoauszug" — zeigt nur gmail-importierte oder nur PDF-importierte Transaktionen.

### Fixed
- **Import-Dedup aktiviert** — `checkImportExists()` wurde importiert aber nie aufgerufen; selbe Konto+Monat-Kombi konnte dadurch mehrfach importiert werden.
- **API-Keys strippen** — `OPENAI_API_KEY` und `ANTHROPIC_API_KEY` werden jetzt mit `.strip()` gelesen; trailing Newline aus GitHub Secrets führte zu `Invalid header value`.

## v1.2.2 — 2026-04-27

### Added
- **Gmail Finance Importer** (`gmail_finance_importer.py`) — Python-Skript liest PDF-Rechnungen aus Gmail-Label "Rechnungen" (IMAP), extrahiert Text via pdfplumber, analysiert via OpenAI gpt-4o-mini (primär) / Claude Haiku (Fallback) und speichert Transaktionen direkt in Firestore `household/main/transactions`. Feldnamen auf Browser-App-Format gemappt (date, amount negativ, description, category, aiCategorized).
- **GitHub Actions Workflow** (`.github/workflows/gmail_finance_sync.yml`) — Läuft täglich 07:00 UTC + manuell auslösbar. Secrets: GMAIL_APP_PASSWORD, OPENAI_API_KEY, ANTHROPIC_API_KEY, FIREBASE_SERVICE_ACCOUNT.
- **PDF-Hash Dedup** — Firestore-Dokument-ID basiert auf SHA256 der PDF-Bytes (erste 20 Zeichen, Prefix `pdf_`). AI-unabhängig und deterministisch — kein Duplikat-Import auch bei mehrfachen Workflow-Läufen oder AI-Nicht-Determinismus.
- **Single-Label Modus** — Importer teilt sich das Gmail-Label "Rechnungen" mit `gmail-pdf-sync` ohne Konflikt: SINCE-30-Tage-Suche statt UNSEEN, Seen-Flag wird nicht verändert.

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
