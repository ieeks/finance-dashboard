Analysiere diesen Kassenbon / diese Rechnung und extrahiere alle Daten.
Gib NUR reines JSON zurück — kein Text, keine Markdown-Backticks, keine Erklärung.

{
  "store": "Händlername",
  "date": "YYYY-MM-DD",
  "total": 43.20,
  "currency": "EUR",
  "card_last4": "1234",
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
Fleisch & Wurst | Fisch / Meeresfrüchte | Obst & Gemüse | Nudeln & Reis | Öl | Aufstriche & Butter |
Gewürze & Saucen | Konserven | Tiefkühl | Hygiene & Drogerie |
Putzmittel | Pfand | Elektronik | Dienstleistung | Sonstiges

Hinweise:
- Pfand-Erkennung (IMMER → "Pfand", egal wie geschrieben):
  PFAND | Pfand | pfand | PFAND EW | PFAND MW | Pfand Einweg | Pfand Mehrweg |
  DPG | DPG EINWEG | DPG Einweg | ePfand | EPFAND |
  Leergut | LEERGUT | Leergutbon | MEHRWEGPFAND | EINWEGPFAND | Pfandartikel | PFANDARTIKEL | Pfand Artikel |
  Pfandrückgabe | PFANDRÜCKGABE | Pfand 0,25 | Pfand 0,09 | Pfand 0,15
- Apotheke, Drogerie, Körperpflege → "Hygiene & Drogerie"
- Wenn keine Einzelpositionen erkennbar: items: [], Gesamtbetrag unter "Sonstiges"
- subcategory immer auf Englisch (kein "subkategorie")
- card_last4: letzte 4 Ziffern der Zahlungskarte, falls am Bon erkennbar.
  Erkenne beide Formate: "XXXX XXXX XXXX 1234" und "############1234"
  Falls keine Kartennummer vorhanden (Bar, PayPal, etc.): null
