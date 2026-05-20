# Code Review — `matcher.js` & `parser.js`

*Stand: 2026-05-20 · Branch: `claude/review-matching-parser-dsJwC`*

Auslöser: Bons werden teils komplett falsch gematcht. Review des Score-Systems
und der PDF-Extraktion mit konkreten Patch-Vorschlägen und priorisiertem Plan.

---

## TL;DR — Was die Fehlmatches verursacht

1. **Score 100 / 85 ignorieren den Händlernamen.** Bei gleichem Betrag + Datum
   wird ein "100% Match" vergeben — egal ob Billa oder OMV.
2. **`nameSimilarity` ist Substring-Match ohne Wortgrenze** und nimmt nur das
   erste Wort des Store-Namens. False Positives bei kurzen Brands ("DM", "BP",
   "JET") und Wortreihenfolge-Vertauschungen.
3. **Datumsabstand ist absolut** — ein Bon kann auf eine Buchung **vor** dem
   Kaufdatum matchen.
4. **`CARD_MERCHANTS`-Reihenfolge:** `\bBILLA\b` steht vor `BILLA PLUS` →
   "Billa Plus" wird nie erkannt.

---

## 1 · `matcher.js` — Findings

### 🔴 M-1  Score 100 & 85 ohne Namensprüfung

`js/matcher.js:30-33`

```js
if (amountDiff === 0 && days <= 3)      score = 100;
else if (amountDiff === 0 && days <= 7) score = 85;
```

Konsequenz: gleicher Betrag, gleicher Tag → Top-Match auf den falschen Händler.
**Vermutete Hauptursache der Fehlmatches.**

### 🔴 M-2  `nameSimilarity` ist fragil

`js/matcher.js:3-7`

```js
const bon = bonStore.toUpperCase().split(' ')[0];   // nur 1. Wort
return tx.includes(bon) || bon.includes(tx.split(' ')[0]);
```

- "Joseph Bäckerei" → nur "JOSEPH" wird gegen TX gehalten.
- `tx.includes("DM")` matcht "ADMIRAL", "MEDMARKT".
- Keine Akzent/Umlaut-Normalisierung — "Café" ≠ "Cafe", "Müller" ≠ "Mueller".

### 🟠 M-3  `amountDiff === 0` ist Float-Vergleich

In `parser.js:17` wird `< 0.015` benutzt, im Matcher nicht. Inkonsistent.

### 🟠 M-4  Datumsabstand absolut statt gerichtet

`daysDiff = Math.abs(...)` erlaubt Match auf Buchungen **vor** dem Bondatum.
Realistisch: Karte bucht 0–7 Tage **nach** Kauf.

### 🟠 M-5  Keine Exklusivität

`findMatch` wird in `app.js` mehrfach aufgerufen (Z. 314, 372, 1229, 1745) ohne
verbrauchte Tx-IDs zu tracken. Caller-Verhalten ist inkonsistent — Z. 948
filtert `!t.bon`, Z. 314 nicht.

### 🟡 M-6  Score-Stufen ohne Tiebreaker

Zwei Kandidaten mit Score 85 → Reihenfolge in `txList` entscheidet. Kein
Tiebreaker auf kleineren `amountDiff` oder `days`.

### 🟡 M-7  Kein Schutz gegen `bon.total = 0`

`bonAnalyzer._safeParseObject` setzt `total: 0` bei Parse-Fehler — Matcher
behandelt das wie einen gültigen Betrag.

---

## 2 · `parser.js` — Findings

### 🔴 P-1  `CARD_MERCHANTS` Reihenfolge: `BILLA` vor `BILLA PLUS`

`js/parser.js:282-283`. Längeres Pattern muss zuerst stehen — `for-of` bricht
beim ersten Treffer.

### 🟠 P-2  Hardcodierte Personennamen

`js/parser.js:100, 223-224, 232-233, 410-411, 437-439` — "Olga / Zelenina /
Manuel / Koblischek" über mehrere Funktionen verteilt. Sollte in eine Config.

### 🟠 P-3  Debug-Logs im Production-Build

`js/parser.js:159, 181, 186-190, 262, 267, 344` — `[DBG-KARTE]`, `[DBG-SEPA]`,
`[DBG-MERCHANT]`. Kommentar Z. 185 sagt selbst *"bitte nach Bugfix entfernen"*.

### 🟡 P-4  `_dedup` Key trunkiert nach 20 Zeichen

`js/parser.js:503`. Zwei "Bezahlung Karte …"-Buchungen am selben Tag mit
gleichem Betrag werden fälschlich zu einer zusammengefasst.

### 🟡 P-5  `SUBSCRIPTION_RULES` überschreibt Description hart

`js/parser.js:14-22`. Jede PayPal-Buchung über exakt 19,99 € wird zu "Netflix".
Original-Text geht verloren → Bon-Match später unmöglich.

### 🟡 P-6  `RECURRING_RULES.category` ist Dead Code

`js/categories.js:50-52` setzt `category`, `_applyRecurringFlags`
(`parser.js:6-12`) liest es nicht aus.

### 🟡 P-7  `parseGenericStatement` regex zu permissiv

`js/parser.js:459` schluckt jede "Datum Text Betrag"-Folge — auch
Adress-/Saldo-Zeilen.

---

## 3 · Konkrete Patches

Jeder Patch ist atomar und kann einzeln gemergt werden. Reihenfolge optimiert
auf "größter Effekt zuerst".

### Patch A — Score-System mit gewichteten Punkten *(behebt M-1, M-3, M-4, M-6)*

`js/matcher.js` komplett umbauen: statt vier diskreter Stufen drei Faktoren,
die unabhängig Punkte beitragen. Name wird Pflicht-Faktor.

```js
const AMOUNT_EXACT_EUR = 0.005;
const DATE_MAX_DAYS    = 7;
const DATE_MIN_DAYS    = -1;   // Bon-Datum darf max. 1 Tag NACH der Buchung sein

export function findMatch(bon, txList) {
  const candidates = txList
    .filter(tx => tx.amount < 0)
    .map(tx => {
      const amountDiff  = Math.abs(Math.abs(tx.amount) - bon.total);
      const signedDays  = (new Date(tx.date) - new Date(bon.date)) / 86400000;
      const days        = Math.abs(signedDays);
      const nameScore   = nameSimilarity(tx.description, bon.store); // 0..1

      // Hartes Out: Bon-Datum weit nach Buchung → kein Match
      if (signedDays < DATE_MIN_DAYS - 0.5) return null;

      let score = 0;
      if (amountDiff < AMOUNT_EXACT_EUR)    score += 50;
      else if (amountDiff <= 2)             score += 25;
      else                                  return null;

      if (days <= 1)                        score += 30;
      else if (days <= 3)                   score += 20;
      else if (days <= DATE_MAX_DAYS)       score += 10;
      else                                  return null;

      score += Math.round(nameScore * 20);  // 0..20 Punkte

      const reason = _reason(amountDiff, days, nameScore);
      return { transaction: tx, score, reason, amountDiff, days, nameScore };
    })
    .filter(Boolean)
    .filter(c => c.score >= 60)
    .sort((a, b) =>
      b.score - a.score
      || a.amountDiff - b.amountDiff
      || a.days - b.days
    );

  return candidates[0] ?? null;
}
```

`matchLabel` analog auf neue Schwellen anpassen (≥90 grün, ≥75 gold, sonst rot).

### Patch B — Robustes `nameSimilarity` *(behebt M-2)*

Token-basiert mit Normalisierung, Wortgrenze und Mindest-Tokenlänge.

```js
function _normalizeTokens(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 3);   // killt "DM", "BP" False-Positives
}

// Liefert 0..1 statt boolean
function nameSimilarity(txDesc, bonStore) {
  const txTokens  = new Set(_normalizeTokens(txDesc));
  const bonTokens = _normalizeTokens(bonStore);
  if (!bonTokens.length || !txTokens.size) return 0;
  const hits = bonTokens.filter(t => txTokens.has(t)).length;
  return hits / bonTokens.length;
}
```

Folge: "BILLA PLUS WIEN" matcht "Billa Plus" sauber, "DM" verliert seine
False-Positive-Power (Token zu kurz → wird verworfen, fällt auf
CARD_MERCHANTS-Mapping zurück).

### Patch C — Exklusivität in `app.js` *(behebt M-5)*

Alle vier `findMatch`-Aufrufstellen vereinheitlichen — verbrauchte Tx-IDs
tracken. Einfachster Weg: schon im Caller `txList.filter(t => !usedTxIds.has(t.id))`
oder direkt im Matcher ein optionales `excludeIds`-Set.

```js
export function findMatch(bon, txList, { excludeIds } = {}) {
  const base = excludeIds
    ? txList.filter(t => !excludeIds.has(t.id))
    : txList;
  // ... wie Patch A
}
```

In `app.js` für `_autoLinkGmailBons` und `findRechnungMatch` ein gemeinsames
Set verwenden statt jeweils eigene Filter.

### Patch D — `CARD_MERCHANTS` Reihenfolge fixen *(behebt P-1)*

`js/parser.js:282-283` — Spezifischeres Pattern zuerst:

```js
[/BILLA\s*PLUS/i,         'Billa Plus'],
[/\bBILLA\b/i,            'Billa'],
```

Audit-Lauf über alle CARD_MERCHANTS-Einträge: für jeden Eintrag prüfen ob ein
spezifischerer (= längerer/präziserer) Pattern danach kommt. Bekannt:
- `BILLA` / `BILLA PLUS`
- `SPAR` / `INTERSPAR` / `EUROSPAR` (durch `\b` aktuell ok, aber besser explizit)
- `ENI` / `AGIP` (gemeinsam — ok)

### Patch E — Personen-Config auslagern *(behebt P-2)*

Neue Datei `js/owners.js` (oder Section in `firebase-config.js`, die nicht
committed wird):

```js
export const OWNERS = [
  { patterns: [/Olga/i, /Zelenina/i],     label: 'Olga',   isOwner: true },
  { patterns: [/Manuel/i, /Koblischek/i], label: 'Manuel', isOwner: true },
];
```

`parser.js` greift überall auf `OWNERS` zu statt hardcodierter Regexes.
Vorteile: einmal pflegen, Tests möglich, Open-Source-tauglich.

### Patch F — Debug-Logs hinter Flag *(behebt P-3)*

```js
// js/parser.js, oben
const DEBUG = (typeof window !== 'undefined') && window.DEBUG_PARSER === true;
const dlog  = DEBUG ? console.log.bind(console) : () => {};
```

Dann alle `console.log('[DBG-...')` durch `dlog('[DBG-...')` ersetzen. Aktivieren
via `window.DEBUG_PARSER = true` in DevTools — kein Spam im Default-Run.

### Patch G — `_dedup` mit voller Description *(behebt P-4)*

```js
const key = `${t.date}|${t.amount}|${t.description}`;
```

Falls Performance ein Thema wird (Tausende von Tx): Hash der Description statt
Slice — aber für realistische Statement-Größen unnötig.

### Patch H — `SUBSCRIPTION_RULES` schützen *(behebt P-5)*

`originalDescription` bewahren bevor `description` überschrieben wird:

```js
function _applySubscriptionRules(txs) {
  return txs.map(t => {
    const rule = SUBSCRIPTION_RULES.find(r =>
      r.pattern.test(t.description) && Math.abs(Math.abs(t.amount) - r.amount) < 0.015
    );
    if (!rule) return t;
    return {
      ...t,
      originalDescription: t.description,
      description: rule.name,
      category: rule.category,
      aiCategorized: false,
    };
  });
}
```

Matcher kann dann optional `originalDescription` als Fallback nutzen.

### Patch I — `RECURRING_RULES.category` anwenden *(behebt P-6)*

Entweder Feld aus `categories.js:50-52` entfernen ODER in
`_applyRecurringFlags` anwenden:

```js
function _applyRecurringFlags(txs) {
  return txs.map(t => {
    const rule = RECURRING_RULES.find(r => r.pattern.test(t.description));
    if (!rule) return t;
    return {
      ...t,
      isRecurring: true,
      recurringLabel: rule.label,
      ...(rule.category ? { category: rule.category, aiCategorized: false } : {}),
    };
  });
}
```

### Patch J — Generic Parser strenger *(behebt P-7)*

Statement-Body markieren (zwischen Header- und Footer-Marker) und Regex nur
darauf anwenden — sonst werden Adresszeilen geschluckt.

---

## 4 · Plan — priorisiert

### Phase A · Bugfix-Sprint *(diese Woche, ~3–4 h)*

Ziel: Falsch-Matches eliminieren. Reihenfolge gibt sofortigen Effekt mit
minimalem Risiko.

- [ ] **A1** Patch D — `CARD_MERCHANTS` Reihenfolge *(10 LOC, 5 min)*
- [ ] **A2** Patch A — Neues Score-System *(40 LOC, 1 h)*
- [ ] **A3** Patch B — Token-basiertes `nameSimilarity` *(20 LOC, 30 min)*
- [ ] **A4** Patch C — Exklusivität in `app.js` *(15 LOC + 4 Call-Sites, 45 min)*
- [ ] **A5** Patch G — `_dedup` voller Key *(1 LOC, 1 min)*
- [ ] **A6** Manueller Verifikationslauf mit 2–3 echten Bons gegen aktuelle
      Buchungen — Screenshots in CHANGELOG.

### Phase B · Hygiene *(nächste Woche, ~2 h)*

- [ ] **B1** Patch F — Debug-Logs hinter `window.DEBUG_PARSER`
- [ ] **B2** Patch I — `RECURRING_RULES.category` aktivieren ODER entfernen
- [ ] **B3** Patch H — `originalDescription` bewahren
- [ ] **B4** Patch E — Personen-Config nach `firebase-config.js` (gitignored)
- [ ] **B5** Patch J — `parseGenericStatement` auf Body-Range begrenzen

### Phase C · Test-Infrastruktur *(neuer Aufwand, ~4 h)*

Kein Build-System ist Projekt-Prinzip (CLAUDE.md) — aber für Matcher/Parser
brauchen wir Vertrauen. Vorschlag: schlanke Fixtures statt Framework.

- [ ] **C1** `tests/fixtures/` mit anonymisierten PDF-Texten (echte Statements
      mit Pseudonymen) + erwarteten JSON-Outputs.
- [ ] **C2** `tests/run.html` — lädt Module via ES-Modules, vergleicht
      `parseEasybankStatement(fixture) === expected`, zeigt Pass/Fail.
      Manuell im Browser laufen lassen, ein Klick.
- [ ] **C3** Matcher-Tests: 6–8 Match-Szenarien (perfekt / fast / falsche
      Filiale gleicher Tag gleicher Betrag / zu alt / etc.).

### Phase D · Strukturelle Verbesserungen *(optional, später)*

Aus dem Review aufgefallen, nicht akut, aber lohnenswert:

- [ ] **D1** `aiProvider.js`-Abstraktion (steht bereits im TODO) — `bonAnalyzer.js`
      hat 4 fast-identische Fetch-Funktionen mit Drift-Risiko.
- [ ] **D2** Karten-Code-Parsing (`D001` → Manuel, `K001` → Olga) aus
      `parser.js:192-195` nach `state.js` zur `CARD_CONFIG` ziehen — bisher
      doppelte Wahrheit.
- [ ] **D3** Erste-Bank-Parser (steht im TODO, Phase 5). Vorher A+C
      abschließen — sonst trägt der neue Parser alle Bugs gleich mit.
- [ ] **D4** Locale-Normalisierung als Util in `ui.js` — wird in Matcher,
      Parser, `guessCategory` mehrfach gebraucht.

---

## 5 · Risiken & Migration

- **Score-Schwellen ändern** (Patch A): bestehende Bon-↔-Buchung-Verknüpfungen
  in Firestore bleiben unangetastet. Neue Auto-Matches verwenden neues System.
  Falls Bestandsdaten neu evaluiert werden sollen: Migration-Script optional.
- **`originalDescription`** (Patch H): neues Feld, alte Tx haben es nicht →
  Code muss tolerant lesen (`t.originalDescription ?? t.description`).
- **Personen-Config** (Patch E): falls `firebase-config.js` ohne `OWNERS`
  geladen wird → Default leeres Array, Gutschrift bleibt "Gutschrift" statt
  "Gutschrift Olga". Nicht kritisch, aber dokumentieren.

---

## 6 · Akzeptanzkriterien

Phase A gilt als done wenn:

1. Ein Bon "Billa, 15,99 €, 04.05." matcht **nicht** mehr auf OMV mit
   identischem Betrag/Datum.
2. "Billa Plus" wird im Parser als "Billa Plus" gespeichert, nicht "Billa".
3. Kein Bon kann mehr auf eine Buchung **vor** seinem Bondatum matchen.
4. Ein Bon kann nicht mehr an zwei Buchungen gleichzeitig hängen.
5. Manuelle Stichprobe (mind. 10 Bons des letzten Monats): mindestens 8/10
   matches korrekt, 0/10 grobe Fehlmatches.
