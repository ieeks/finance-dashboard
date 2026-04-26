# 💶 Finance Dashboard

Persönliches Finance Dashboard für österreichische Kontoauszüge (BAWAG / easybank).  
Läuft vollständig im Browser – keine Server, kein Tracking, kein Backend.

## Features

- **PDF-Import** — BAWAG / easybank Kontoauszüge direkt hochladen (Drag & Drop)
- **KI-Kategorisierung** — Claude Haiku oder GPT-4o-mini erkennt automatisch Buchungskategorien
- **Bon-Scan (Concierge)** — Kassenbon per Foto oder PDF hochladen, KI extrahiert Einzelpositionen und verknüpft mit Buchung
- **Pending-Queue** — Bon vor dem Kontoauszug scannen: wird automatisch verknüpft sobald der Import kommt
- **Kategorien-Übersicht** — Supermarkt, Wohnen, Energie, Auto, Freizeit, … mit Donut-Chart
- **Monatsfilter** — Navigation zwischen importierten Monaten
- **Einnahmen / Ausgaben / Saldo** — Kompakte Übersichtskarten
- **Kommentare** — Freitextnotiz pro Buchung
- **CSV-Export** — Alle Buchungen als CSV exportieren
- **Mobile First** — Optimiert für iPhone / Android (kein Dark Mode Bug)

## Geplante Features

- [ ] Firebase Auth + Firestore (Datenpersistenz + Zwei-Personen-Haushalt)
- [ ] Drill-Down: Buchung → Bon → Einzelpositionen-Auswertung
- [ ] Finanzguru CSV-Import
- [ ] Mehrere Konten / Kreditkarten
- [ ] Jahresübersicht & Trendcharts
- [ ] Gmail Invoice Matcher (automatischer Rechnungsabruf)

## Tech Stack

| Schicht | Technologie |
|---------|-------------|
| Frontend | Vanilla JS ES-Module, HTML, CSS |
| PDF-Parsing | PDF.js (CDN) |
| KI-Kategorisierung | Claude Haiku · GPT-4o-mini |
| Bon-Analyse | Claude Vision · GPT-4o |
| Datenspeicher | localStorage → Firebase Firestore (Phase 2) |
| Hosting | GitHub Pages |

## Setup

1. Repo klonen / Fork erstellen
2. `index.html` in GitHub Pages aktivieren (Settings → Pages → main / root)
3. Anthropic oder OpenAI API Key direkt im Browser eingeben (wird nur lokal in `localStorage` gespeichert)

## Datenschutz

- PDF-Inhalt und Bon-Bilder werden direkt an die gewählte KI-API gesendet (nur zur Analyse)
- Kein eigener Server, keine Logs
- API Keys werden nur in `localStorage` des eigenen Browsers gespeichert
- Firestore (Phase 2): eigene Firebase-Instanz, vollständige Datenkontrolle

## Lizenz

MIT
