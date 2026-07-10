Analysiere diesen Kassenbon / diese Rechnung und extrahiere alle Daten.
Gib NUR reines JSON zurück — kein Text, keine Markdown-Backticks, keine Erklärung.

{
  "store": "Händlername",
  "date": "YYYY-MM-DD",
  "total": 43.20,
  "tip": 0,
  "currency": "EUR",
  "card_last4": "1234",
  "iban": null,
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

Hinweise zu Trinkgeld & Betrag:
- **tip** = Trinkgeld, falls ausgewiesen. Erkenne „Trinkgeld", „Trinkgeld
  (unbar)", „Tip", „Gratuity", „Service". Ohne Trinkgeld: `0`.
- **total** = die ausgewiesene Rechnungssumme der Positionen (z.B. „Summe
  inkl. USt."), OHNE Trinkgeld. Das Trinkgeld kommt separat in `tip`.
  Der tatsächlich von der Karte abgebuchte Betrag ist dann `total + tip`.

Erlaubte subcategory-Werte (mit typischen Beispielen):
- **Milchprodukte**: Milch, Joghurt, Käse, Topfen, Schlagobers, Sauerrahm,
  Mozzarella, Parmesan, Feta, Buttermilch, Kefir
- **Süßwaren / Naschen**: Schokolade, Kekse, Bonbons, Eis, Riegel, Donut,
  Krapfen, Götterspeise, Pudding, Sahnepudding, Mousse, Kaugummi, Gummi-
  bärchen, Müsliriegel, Schokoriegel, Bounty, Snickers, Manner, Milka
- **Backwaren**: Brot, Semmel, Gebäck, Croissant, Striezel, Brioche,
  Kornspitz, Toast, Vollkornbrot, Baguette, Laugengebäck, Weckerl, Hand-
  semmel
- **Getränke**: Mineralwasser, Saft, Limo, Bier, Wein, Sekt, Kaffee, Tee,
  Energy-Drink, Cola, Almdudler, Soda, Smoothie
- **Fleisch & Wurst**: Hendl, Hähnchen, Faschiertes, Wurst, Schinken,
  Speck, Salami, Putenfleisch, Schweinefleisch, Rindfleisch, Leberkäse,
  Kotelett, Steak, Burger-Patty (frisch)
- **Fisch / Meeresfrüchte**: Lachs, Thunfisch (frisch), Forelle, Garnelen,
  Sardinen (frisch), Hering, Kalmar
- **Obst & Gemüse**: Apfel, Banane, Tomate, Gurke, Salat, Zwiebel, Kartoffel,
  Erdäpfel, Karotte, Paprika, Zucchini, Pilze, Zitrone, Orange, Avocado
- **Nudeln & Reis**: Spaghetti, Penne, Rigatoni, Tagliatelle, Lasagne,
  Reis, Couscous, Bulgur, Gnocchi, Spätzle, Ramen, Tortellini
- **Restaurant**: zubereitete Speisen/Gerichte auf einer Gastro-
  Rechnung (Restaurant, Café, Imbiss, Lieferdienst). Beispiele: Tempura,
  Sushi, Bibimbap, Bulgogi, Ramen-Schale, Pizza (Lokal), Burger (Lokal),
  Pasta-Gericht, Schnitzel, Curry, Bowl, Suppe, Vorspeise, Dessert,
  Tagesmenü. Faustregel: Wenn der Beleg ein Restaurant/Café/Imbiss ist und
  die Position ein fertig zubereitetes Gericht/Getränk zum Verzehr ist →
  hierher, NICHT "Sonstiges". Getränke im Lokal dürfen auch "Getränke".
- **Öl**: Olivenöl, Sonnenblumenöl, Rapsöl, Kürbiskernöl, Sesamöl
- **Aufstriche & Butter**: Butter, Margarine, Marmelade, Konfitüre, Honig,
  Nutella, Liptauer, Frischkäse, Erdnussbutter, Topfenaufstrich
- **Gewürze & Saucen**: Salz, Pfeffer, Senf, Ketchup, Mayo, Vegeta, Maggi,
  Sojasauce, Essig, Currypaste, Pesto, Tabasco, Knoblauchpulver
- **Konserven**: Dosentomaten, Mais (Dose), Bohnen (Dose), Thunfisch (Dose),
  Sauerkraut, eingelegtes Gemüse, Apfelmus (Glas), Ravioli (Dose)
- **Tiefkühl**: TK-Pizza, Pommes, Wedges, TK-Gemüse, TK-Fisch, TK-Spinat,
  TK-Beeren, Speiseeis, Hühnerstreifen knusprig, Chicken Nuggets,
  Fertiglasagne (TK), Mozzarella-Sticks. Achtung Abkürzungen: "HUEHNERSTR"
  / "HUHN.STR" = Hühnerstreifen, "PIZZA TK" = Tiefkühl-Pizza
- **Hygiene & Drogerie**: Shampoo, Zahnpasta, Klopapier, Damenhygiene,
  Deo, Creme, Q-tips, Duschgel, Seife, Rasierer, Zahnbürste, Windeln,
  Make-up, Tampons, Binden
- **Putzmittel**: Spülmittel, WC-Reiniger, Bodenreiniger, Müllsäcke,
  Schwämme, Lappen, Allzweckreiniger, Geschirrspül-Tabs, Waschmittel
- **Pfand** (IMMER → "Pfand", egal wie geschrieben):
  PFAND | Pfand | pfand | PFAND EW | PFAND MW | Pfand Einweg | Pfand Mehrweg |
  DPG | DPG EINWEG | DPG Einweg | ePfand | EPFAND |
  Leergut | LEERGUT | Leergutbon | MEHRWEGPFAND | EINWEGPFAND |
  Pfandartikel | PFANDARTIKEL | Pfand Artikel |
  Pfandrückgabe | PFANDRÜCKGABE | Pfand 0,25 | Pfand 0,09 | Pfand 0,15
- **Elektronik**: Batterien, Akkus, Glühbirnen, LED-Lampen, Ladekabel,
  USB-Stick, Verlängerungskabel, Steckdosen, Kopfhörer
- **Dienstleistung**: Reinigung, Reparatur, Service, Wartung, Lieferung
- **Sonstiges**: NUR als letzte Option, wenn wirklich nichts anderes passt.
  Versuche IMMER zuerst eine konkrete Subkategorie zu finden.

Hinweise zum Datum:
- **Datumsformat ist TT.MM.JJJJ** (Tag zuerst, europäisch/österreichisch).
  "01.06.2026" = 1. Juni 2026, NICHT 6. Jänner. Gib `date` immer als
  "YYYY-MM-DD" zurück — hier also "2026-06-01".
- **Zweistellige Jahreszahlen**: "25/05/26" oder "25.05.26" bedeutet Jahr 2026,
  NICHT 2023. Regel: Jahreszahl < 50 → 2000er (26 → 2026, 25 → 2025). Nie als
  Monat oder Tag interpretieren — das dritte Element im Datum ist immer das Jahr.

Hinweise zur Summen-Konsistenz (WICHTIG):
- Die Summe aller `items[].gesamt` MUSS exakt `total` ergeben (ohne `tip`).
  Rechne am Ende nach und korrigiere die Positionen, falls sie nicht aufgehen.
- **Menü-/Kombi-Bons (McDonald's, Burger, Gastro-Sets)**: Eine Menü-Kopfzeile
  wie „1 HM 4er Nugg" oder „1 Muf Beef M2" hat KEINEN eigenen Preis in der
  GESAMT-Spalte — der Preis steht nur bei den eingerückten Einzelkomponenten
  darunter. Übernimm NUR die Zeilen mit tatsächlichem Betrag in der GESAMT-
  Spalte. Zähle die Kopfzeile NICHT zusätzlich als eigene Position — sonst wird
  das Menü doppelt gezählt.
- Nutze immer den Betrag aus der GESAMT-Spalte (Positionssumme), NICHT den
  EINZEL-/VKP-Preis (Stückpreis) — bei Menü-Komponenten weichen die stark ab.
- **Pfand vollständig erfassen**: Kommt „Pfand" mehrfach auf dem Bon vor (z.B.
  je einmal pro Menü), liste JEDE Pfand-Zeile einzeln als eigene Position. Fasse
  sie nicht zu einer zusammen und lass keine aus.
- **Zwei Preisspalten (EINZEL/VKP vs. GESAMT)**: Fast-Food-Bons drucken pro
  Zeile ZWEI Zahlen — links den EINZEL-/VKP-Stückpreis, rechts den GESAMT-
  Betrag. Verwende IMMER nur die RECHTE Zahl (GESAMT). Ein Buchstabe wie „A"
  oder „B" am Zeilenende ist ein Steuerkennzeichen, KEIN Preis.

Konkretes Beispiel (McDonald's-Menü — genau so extrahieren):

  Rohtext (Spalten: STK BEZEICHNUNG … EINZEL/VKP … GESAMT):
    1 Muff BeefEggM2
      1 Muff Beef&E   4.30   4.08 A
      1 M2-Capp       1.50   1.42 B
    1 Co Zero 05      3.90   3.90 B
    1 9er McNuggets   6.20   6.20 A
    2 Sour Cr Dip     0.00   0.00 A
    INNEN TOTAL              15.60

  RICHTIG → 5 Positionen (nur GESAMT-Spalte, Kopfzeile „Muff BeefEggM2" wird
  NICHT gezählt):
    Muff Beef&E 4.08 · M2-Capp 1.42 · Co Zero 05 3.90 · 9er McNuggets 6.20 ·
    Sour Cr Dip 0.00 → Summe 15.60 = INNEN TOTAL ✓

  FALSCH → zusätzlich „Muff BeefEggM2" mit 4.30 aufführen (das ist der EINZEL-
  Preis der Komponente, keine eigene Position) → Summe 19.90 ≠ 15.60 ✗

Hinweise zur Item-Erkennung:
- **Abgekürzte Item-Namen**: SPAR und Billa drucken Items oft stark
  abgekürzt. Versuche die Abkürzung zu dekodieren bevor du Sonstiges wählst:
  - "LANDL." / "LANDL " → Landliebe (Marke, sagt nichts über Subkat)
  - "SPAR HUEHNERSTR.KNUS" → Hühnerstreifen knusprig → Tiefkühl
  - "GOETTERSPEISE" → Götterspeise (Wackelpudding) → Süßwaren / Naschen
  - "MANNER NEAP" → Manner Neapolitaner → Süßwaren / Naschen
  - "BIO ZW" → Bio Zwiebel → Obst & Gemüse
  - "FT HALBR" → Faschiertes halb-und-halb → Fleisch & Wurst
- **Apotheke, Drogerie, Körperpflege** → "Hygiene & Drogerie"
- **Wenn keine Einzelpositionen erkennbar**: items: [], Gesamtbetrag unter "Sonstiges"
- **subcategory immer auf Englisch** (Feldname, kein "subkategorie")
- **card_last4**: letzte 4 Ziffern der Zahlungskarte, falls am Bon erkennbar.
  Erkenne beide Formate: "XXXX XXXX XXXX 1234" und "############1234"
  Falls keine Kartennummer vorhanden (Bar, PayPal, etc.): null
- **iban**: IBAN des Zahlungsempfängers oder Lastschrift-Kontos, falls auf der
  Rechnung angegeben (z.B. bei Telefonrechnungen, Versicherungen, Energieanbietern).
  Gib die IBAN ohne Leerzeichen zurück (z.B. "AT611904300234573201"). Falls keine
  IBAN erkennbar: null
