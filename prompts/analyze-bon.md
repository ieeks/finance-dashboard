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
      "subcategory": "Milchprodukte"
    }
  ]
}

Erlaubte subcategory-Werte:
Milchprodukte | Süßwaren / Naschen | Backwaren | Getränke |
Fleisch & Wurst | Obst & Gemüse | Tiefkühl | Hygiene & Drogerie |
Putzmittel | Elektronik | Mobilität / Auto | Dienstleistung | Sonstiges

Hinweise:
- Tesla Supercharger, Tanken, Parken → "Mobilität / Auto"
- Apotheke, Drogerie → "Hygiene & Drogerie"
- Wenn keine Einzelpositionen erkennbar: items: [], Gesamtbetrag unter "Sonstiges"
- subcategory immer auf Englisch (kein "subkategorie")
