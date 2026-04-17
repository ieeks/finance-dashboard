Du bist ein Buchhalter-Assistent. Analysiere den folgenden Kontoauszugstext
einer österreichischen Bank (BAWAG/easybank) und extrahiere alle Buchungen.

Gib NUR ein JSON-Array zurück — kein Text, keine Markdown-Backticks.

Format jeder Buchung:
{
  "date": "YYYY-MM-DD",
  "description": "Buchungstext gekürzt auf max 40 Zeichen",
  "amount": -123.45,
  "category": "Eine der erlaubten Kategorien"
}

Regeln:
- amount: negativ = Ausgabe, positiv = Einnahme/Gutschrift
- Datum immer im Format YYYY-MM-DD
- Nur Buchungen extrahieren, keine Saldozeilen oder Überschriften

Erlaubte Kategorien:
Supermarkt | Restaurant / Café | Mobilität / Auto | Wohnen / Miete |
Energie / Strom | Versicherung | Drogerie | Gesundheit | Online Shopping |
Freizeit | Kommunikation | Gehalt / Einnahmen | Familientransfer | Gebühren / Bank | Sonstiges

Kontoauszugstext:
{{TEXT}}
