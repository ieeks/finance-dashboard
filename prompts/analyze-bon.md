Analysiere diesen Kassenbon / diese Rechnung und extrahiere alle Daten.
Gib NUR reines JSON zurück — kein Text, keine Markdown-Backticks, keine Erklärung.

{
  "store": "Händlername",
  "date": "YYYY-MM-DD",
  "total": 43.20,
  "currency": "EUR",
  "items": [
    {
      "name": "Produktname max 40 Zeichen",
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
    "Elektronik": 0,
    "Dienstleistung": 0,
    "Sonstiges": 0
  }
}

Erlaubte subkategorie-Werte:
Milchprodukte | Süßwaren / Naschen | Backwaren | Getränke |
Fleisch & Wurst | Obst & Gemüse | Tiefkühl | Hygiene & Drogerie |
Putzmittel | Elektronik | Dienstleistung | Sonstiges

Wenn keine Einzelpositionen erkennbar: items: [], Gesamtbetrag unter "Sonstiges".
