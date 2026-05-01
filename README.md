# Finance Dashboard

Persönliches Finance Dashboard für österreichische Kontoauszüge.  
Läuft vollständig im Browser — kein eigener Server, kein Tracking.

## Features

**Import & Konten**
- PDF-Import — BAWAG / easybank Kontoauszüge per Drag & Drop oder Dateiauswahl
- Mehrere Konten — beliebig viele Konten anlegen (Name, IBAN, Farbe); Account-Selektor beim Import
- Multi-PDF — mehrere Kontoauszugs-PDFs auf einmal importieren
- Gmail Invoice Matcher — Rechnungs-PDFs aus Gmail werden täglich automatisch importiert (GitHub Actions)

**Auswertung**
- KI-Kategorisierung — Claude Haiku oder GPT-4o-mini erkennt Buchungskategorien automatisch
- Kategorie-Lernfunktion — manuelle Korrekturen werden gemerkt und beim nächsten Import angewendet
- Donut-Chart — Top-5 Ausgabenkategorien auf einen Blick
- Monatsfilter — Navigation zwischen allen importierten Monaten
- Einnahmen / Ausgaben / Saldo — kompakte Übersichtskarten
- Beleg-Status — Dashboard zeigt offene Bons und Buchungen ohne Beleg direkt an
- Rechnungen-Screen — alle Gmail-Rechnungen des Monats mit Match-Status (✅ verknüpft / ⚠️ offen)

**Bon-Scan (Concierge)**
- Kassenbon per Foto oder PDF hochladen; KI extrahiert Einzelpositionen + Händler + Gesamtbetrag
- Score-basiertes Matching — bester Treffer mit Konfidenz-Chip (`100% Match` · `Starker Match` · `Möglicher Match`) und Begründung
- Pending-Queue — Bon vor dem Kontoauszug scannen: automatische Verknüpfung beim nächsten Import
- Subkategorie-Drill-Down — Tap auf Subkategorie zeigt alle Einzelpositionen

**Sonstiges**
- Beleg-Status pro Buchung — `✅ Bon` / `⚠️ kein Bon` direkt in der Buchungsliste
- Kommentare — Freitextnotiz pro Buchung
- CSV-Export — alle Buchungen exportieren
- Quick-Filter — „Ohne Bon" / „Mit Bon" direkt in der Buchungsliste
- Mobile First — optimiert für iPhone / Android

## Tech Stack

| Schicht | Technologie |
|---------|-------------|
| Frontend | Vanilla JS ES-Module, HTML, CSS |
| PDF-Parsing | PDF.js (CDN) |
| KI-Kategorisierung | Claude Haiku · GPT-4o-mini |
| Bon-Analyse | Claude Vision · GPT-4o |
| Auth & Daten | Firebase Auth + Firestore |
| Gmail-Import | Python · IMAP · GitHub Actions |
| Hosting | GitHub Pages |

## Setup

1. Repo forken
2. Firebase-Projekt anlegen, `firebase-config.js` befüllen (nicht committen)
3. Firestore: `config/apiKeys` mit `anthropic` und `openai` Key anlegen
4. Firestore: `config/allowed_emails` mit erlaubten E-Mail-Adressen befüllen
5. GitHub Pages aktivieren (Settings → Pages → main / root)

Für den Gmail-Import zusätzlich:
- GitHub Secrets setzen: `GMAIL_APP_PASSWORD`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `FIREBASE_SERVICE_ACCOUNT`
- GitHub Actions Workflow (`.github/workflows/gmail_finance_sync.yml`) läuft täglich 07:00 UTC

## Datenschutz

- PDF-Inhalt und Bon-Bilder werden nur zur Analyse an die gewählte KI-API gesendet
- API Keys liegen in der eigenen Firestore-Instanz (nicht im Browser-localStorage)
- Kein eigener Server, keine Logs außerhalb von Firebase

## Lizenz

MIT
