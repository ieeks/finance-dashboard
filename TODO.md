# TODO — Finance Dashboard

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
