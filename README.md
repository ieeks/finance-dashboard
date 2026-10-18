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

## Wartung: PDF-/Bild-Buchungen aufräumen

Buchungen, die aus einem importierten PDF (`pdf_…`) oder Bon-Bild (`img_…`) stammen, können bei Bedarf gesammelt aus Firestore entfernt werden. Der Workflow `.github/workflows/delete_firestore_prefixes.yml` löscht alle Dokumente mit diesen Präfixen aus `household/main/transactions`.

Auslösen:
- In der App: Einstellungen → "🧹 PDF-/Bild-Buchungen aufräumen (Actions)" — öffnet GitHub Actions, dort "Run workflow" klicken
- Oder direkt: Repo → Actions → "Delete Firestore Prefixes" → "Run workflow"

Benötigt das Secret `FIREBASE_SERVICE_ACCOUNT` (gleiches Secret wie der Gmail-Import).

## Datenschutz

- PDF-Inhalt und Bon-Bilder werden nur zur Analyse an die gewählte KI-API gesendet
- API Keys liegen in der eigenen Firestore-Instanz (nicht im Browser-localStorage)
- Kein eigener Server, keine Logs außerhalb von Firebase

## Lizenz

MIT


## E-Mail-Rechnungen aus PDFs

Der Importer liest mit pdfplumber alle Seiten. Vollständiger Text bis 100.000 Zeichen geht an Claude Haiku 5.5 (bei fehlendem Anthropic-Key oder API-Fehler alternativ GPT-4o mini); es werden keine Rechnungsenden mehr abgeschnitten. Seiten mit sehr wenig oder defektem Text sowie größere Texte werden direkt am Original-PDF ausgewertet.

Vor dem Speichern werden Händler, Rechnungsdatum und Beträge geprüft. Positionen inklusive Rabatten müssen zusammen mit dem Steueraufschlag zum Endbetrag passen. Trinkgeld wird separat behandelt. Eindeutige Endbeträge im PDF werden zusätzlich verglichen; mehrdeutige Beträge werden nicht geraten. Einfache Rechnungen ohne Artikelaufstellung dürfen eine leere Positionsliste haben, Einkaufsbelege benötigen Artikel.

Wenn Textergebnis oder Lesbarkeit nicht ausreichen, wird das vollständige PDF visuell geprüft: zuerst mit Claude Haiku 5.5 und dem vorhandenen Anthropic-Key, bei fehlendem Key, Fehler oder unplausiblem Ergebnis mit dem vorhandenen OpenAI-Key. Dafür ist kein zusätzlicher Dienst erforderlich. Das Original-PDF darf für diesen Weg maximal 20 MiB groß sein. Größere Dokumente bitte aufteilen; es gibt keinen stillen Teilimport. API-Antworten, die am Tokenlimit enden, werden verworfen.

Weiterhin unplausible Ergebnisse und Nicht-EUR-Rechnungen werden nicht automatisch als Ausgaben gespeichert. Der Grund erscheint im GitHub-Actions-Importprotokoll als Hinweis zur manuellen Prüfung. Bereits importierte Rechnungen bleiben durch die vorhandene Duplikaterkennung erhalten; die neue Prüfung verarbeitet sie nicht automatisch erneut. Der Browser-Upload nutzt weiterhin seinen bisherigen Ablauf.

Für den E-Mail-Import ist Haiku 5.5 auch bei Bildbelegen der primäre Anbieter; OpenAI bleibt Ausweichweg. Haiku nutzt adaptives Denken mit niedrigem Aufwand und 20.000 Tokens Budget für Denken und Antwort. Nur Textblöcke werden als Ergebnis ausgewertet; abgelehnte/abgeschnittene Antworten führen zum Fallback. Die Haiku-/Sonnet-Aufrufe im Browser sind von dieser E-Mail-Migration nicht betroffen.

Beim Gmail-Sync werden auch bereits gespeicherte E-Mail-Belege mit leerem/unbekanntem Konto anhand des bestätigten Kartenmappings nachgetragen. Das läuft über alle gespeicherten Monate ohne KI-Aufruf. Vorhandene Kontozuordnungen und Bankbuchungen werden nicht überschrieben.
