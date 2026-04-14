# 💶 Finance Dashboard

Persönliches Finance Dashboard für österreichische Kontoauszüge (BAWAG / easybank).  
Läuft vollständig im Browser – keine Server, kein Tracking, kein Backend.

## Features

- **PDF-Import** — BAWAG / easybank Kontoauszüge direkt hochladen
- **KI-Kategorisierung** — Claude (Haiku) erkennt automatisch Buchungskategorien
- **Kategorien-Übersicht** — Supermarkt, Wohnen, Energie, Auto, Freizeit, …
- **Monatsfilter** — Navigation zwischen importierten Monaten
- **Einnahmen / Ausgaben / Saldo** — Kompakte Übersichtskarten
- **Mobile First** — Optimiert für iPhone / Android

## Geplante Features

- [ ] Firebase Firestore (Datenpersistenz)
- [ ] Rechnungs-Upload (PDF/Bild → OCR → Matching mit Buchung)
- [ ] Finanzguru CSV-Import
- [ ] Mehrere Konten / Karten
- [ ] Jahresübersicht & Trendcharts
- [ ] Exportfunktion (CSV, PDF-Report)

## Tech Stack

| Schicht | Technologie |
|---------|-------------|
| Frontend | Vanilla JS, HTML, CSS |
| PDF-Parsing | PDF.js |
| KI-Kategorisierung | Claude Haiku (Anthropic API) |
| Datenspeicher | Firebase Firestore (geplant) |
| Hosting | GitHub Pages |

## Setup

1. Repo klonen / Fork erstellen
2. `index.html` in GitHub Pages aktivieren (Settings → Pages → main / root)
3. Anthropic API Key bereitstellen (wird nur lokal im Browser gespeichert)

## Datenschutz

- PDF-Inhalt wird direkt an die Anthropic API gesendet (nur zur Kategorisierung)
- Kein eigener Server, keine Logs
- API Key wird nur in `localStorage` des eigenen Browsers gespeichert
- Firestore: eigene Firebase-Instanz, vollständige Datenkontrolle

## Lizenz

MIT
