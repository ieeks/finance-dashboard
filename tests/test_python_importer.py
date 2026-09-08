"""Tests für gmail_finance_importer.py.

Nutzt AST-Extraktion um Helper + Konstanten ohne die externen Imports
(pdfplumber, anthropic, firebase-admin, dotenv) zu laden. Reine stdlib.

Aufruf: python3 -m unittest tests/test_python_importer.py
"""

import ast
import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
IMPORTER  = REPO_ROOT / "gmail_finance_importer.py"


def _load_helpers():
    """Extrahiert Module-Level-Konstanten + Helper-Funktionen via AST,
    ohne die schweren Imports anzustoßen. Pre-seedt nur das was die
    Helper brauchen (Path, re)."""
    src  = IMPORTER.read_text(encoding="utf-8")
    tree = ast.parse(src)
    ns   = {
        "__file__": str(IMPORTER),
        "Path":     Path,
        "re":       re,
    }
    for node in tree.body:
        if isinstance(node, (ast.Assign, ast.AnnAssign, ast.FunctionDef)):
            try:
                exec(compile(ast.Module([node], []), "<ast>", "exec"), ns)
            except (ImportError, NameError, AttributeError):
                pass
    return ns


H = _load_helpers()


class TestConstants(unittest.TestCase):
    def test_main_categories_count(self):
        self.assertEqual(len(H["MAIN_CATEGORIES"]), 13)

    def test_main_categories_has_wohnen_miete(self):
        self.assertIn("Wohnen / Miete", H["MAIN_CATEGORIES"])

    def test_subcategories_count(self):
        self.assertEqual(len(H["SUBCATEGORIES"]), 20)

    def test_subcategories_has_pfand(self):
        self.assertIn("Pfand", H["SUBCATEGORIES"])

    def test_subcategories_has_restaurant(self):
        self.assertIn("Restaurant", H["SUBCATEGORIES"])
        self.assertNotIn("Restaurant / Gericht", H["SUBCATEGORIES"])

    def test_subcategories_canonical_names(self):
        # v1.3.2 dedup: keine Aliase mehr
        self.assertIn("Backwaren", H["SUBCATEGORIES"])
        self.assertNotIn("Brot & Backwaren", H["SUBCATEGORIES"])
        self.assertIn("Hygiene & Drogerie", H["SUBCATEGORIES"])
        self.assertNotIn("Hygiene", H["SUBCATEGORIES"])

    def test_recurring_rules_count(self):
        self.assertEqual(len(H["RECURRING_RULES"]), 9)

    def test_card_merchants_count(self):
        # parser.js hat 52 Patterns. Schwelle locker: > 40
        self.assertGreater(len(H["CARD_MERCHANTS"]), 40)


class TestNormalizeSubcategory(unittest.TestCase):
    def setUp(self):
        self.fn = H["_normalize_subcategory"]

    def test_canonical_passthrough(self):
        self.assertEqual(self.fn("Pfand"), "Pfand")
        self.assertEqual(self.fn("Milchprodukte"), "Milchprodukte")
        self.assertEqual(self.fn("Hygiene & Drogerie"), "Hygiene & Drogerie")

    def test_alias_brot_backwaren(self):
        self.assertEqual(self.fn("Brot & Backwaren"), "Backwaren")

    def test_alias_hygiene(self):
        self.assertEqual(self.fn("Hygiene"), "Hygiene & Drogerie")

    def test_alias_fleisch(self):
        self.assertEqual(self.fn("Fleisch"), "Fleisch & Wurst")

    def test_alias_suesswaren(self):
        self.assertEqual(self.fn("Süßwaren"), "Süßwaren / Naschen")

    def test_unknown_to_sonstiges(self):
        self.assertEqual(self.fn("Unbekannt"), "Sonstiges")

    def test_empty_to_sonstiges(self):
        self.assertEqual(self.fn(""), "Sonstiges")


class TestMatchRecurring(unittest.TestCase):
    def setUp(self):
        self.fn = H["_match_recurring"]

    def test_netflix(self):
        self.assertEqual(self.fn("Netflix")["label"], "Netflix")
        self.assertEqual(self.fn("Netflix International B.V.")["label"], "Netflix")

    def test_spotify(self):
        self.assertEqual(self.fn("Spotify AB")["label"], "Spotify")

    def test_allianz_kfz_before_generic(self):
        # Spezifischere Pattern muss vor generischem Allianz greifen
        r = self.fn("Allianz Elementarschäden AG")
        self.assertEqual(r["label"], "Allianz KFZ")
        self.assertEqual(r["category"], "Mobilität / Auto")

    def test_aev_prefix(self):
        r = self.fn("AEV12345 Allianz")
        self.assertEqual(r["label"], "Allianz KFZ")

    def test_allianz_generic(self):
        r = self.fn("Allianz Versicherung")
        self.assertEqual(r["label"], "Allianz Versicherung")
        self.assertEqual(r["category"], "Versicherung")

    def test_magenta(self):
        r = self.fn("Magenta Mobil")
        self.assertEqual(r["label"], "Magenta Mobil")
        self.assertEqual(r["category"], "Telekommunikation")

    def test_helvetia_to_miete(self):
        # Label "Miete", aber Kategorie kommt vom Helvetia-Override
        r = self.fn("Helvetia Versicherungen AG")
        self.assertEqual(r["label"], "Miete")

    def test_raiffeisen_leasing(self):
        self.assertEqual(self.fn("Raiffeisen-Leasing GmbH")["label"], "BYD Leasing")

    def test_unknown_returns_none(self):
        self.assertIsNone(self.fn("Random Vendor"))

    def test_empty_returns_none(self):
        self.assertIsNone(self.fn(""))


class TestNormalizeStore(unittest.TestCase):
    def setUp(self):
        self.fn = H["_normalize_store"]

    def test_billa_plus_before_billa(self):
        self.assertEqual(self.fn("BILLA PLUS"), "Billa Plus")
        self.assertEqual(self.fn("BILLA"), "Billa")

    def test_billa_plus_with_branch(self):
        self.assertEqual(self.fn("Billa Plus Wien 5577"), "Billa Plus")

    def test_interspar_not_spar(self):
        # \bSPAR\b matched dank Word-Boundary NICHT INTERSPAR
        self.assertEqual(self.fn("INTERSPAR Wien"), "Interspar")
        self.assertEqual(self.fn("EUROSPAR Filiale"), "Eurospar")
        self.assertEqual(self.fn("Spar Express"), "Spar")

    def test_common_brands(self):
        self.assertEqual(self.fn("Lidl Österreich GmbH"), "Lidl")
        self.assertEqual(self.fn("HOFER KG"), "Hofer")
        self.assertEqual(self.fn("DM-FIL 5566 Wien"), "dm")
        self.assertEqual(self.fn("BIPA Parfumerien"), "Bipa")

    def test_muller_umlaut_alternation(self):
        self.assertEqual(self.fn("Müller Handel GmbH"), "Müller")
        self.assertEqual(self.fn("MUELLER"), "Müller")

    def test_mcdonalds_variants(self):
        self.assertEqual(self.fn("McDonald's Restaurants"), "McDonald's")
        self.assertEqual(self.fn("MCDONALDS WIEN"), "McDonald's")
        self.assertEqual(self.fn("MC DONALDS"), "McDonald's")

    def test_gas_stations_word_boundary(self):
        self.assertEqual(self.fn("OMV Tankstelle Wien"), "OMV")
        self.assertEqual(self.fn("Shell Service Station"), "Shell")
        self.assertEqual(self.fn("JET-Tankstelle"), "JET")

    def test_eni_or_agip(self):
        self.assertEqual(self.fn("ENI Tankstelle"), "ENI")
        self.assertEqual(self.fn("AGIP"), "ENI")

    def test_electronics(self):
        self.assertEqual(self.fn("MEDIA MARKT Vösendorf"), "MediaMarkt")
        self.assertEqual(self.fn("MediaMarkt"), "MediaMarkt")
        self.assertEqual(self.fn("Saturn Electronics"), "Saturn")

    def test_unknown_brand_unchanged(self):
        self.assertEqual(self.fn("Random Bäckerei GmbH"), "Random Bäckerei GmbH")
        self.assertEqual(self.fn("Acme Corp"), "Acme Corp")

    def test_empty(self):
        self.assertEqual(self.fn(""), "")


class TestAiGet(unittest.TestCase):
    def setUp(self):
        self.fn = H["_ai_get"]

    def test_js_schema_first(self):
        self.assertEqual(self.fn({"store": "Billa"}, "store", "absender"), "Billa")

    def test_german_fallback(self):
        self.assertEqual(self.fn({"absender": "Spar"}, "store", "absender"), "Spar")

    def test_default_when_missing(self):
        self.assertEqual(self.fn({}, "store", "absender", default="X"), "X")

    def test_empty_string_skipped(self):
        # leerer String soll als "fehlend" behandelt werden
        self.assertEqual(
            self.fn({"store": "", "absender": "Hofer"}, "store", "absender"),
            "Hofer",
        )


class TestSemanticDuplicate(unittest.TestCase):
    """Fallback-Dedup für re-gesendete digitale Kassenbons (unterschiedliche
    PDF-Bytes, gleicher Kauf) — siehe _is_semantic_duplicate."""

    def setUp(self):
        self.fn = H["_is_semantic_duplicate"]
        self.existing = [
            {"description": "Billa", "date": "2026-05-08", "amount": -13.63, "account": "unbekannt"},
            {"description": "T-Mobile Austria GmbH", "date": "2026-05-07", "amount": -24.44, "account": "haushalt"},
        ]

    def test_exact_match_is_duplicate(self):
        self.assertTrue(self.fn(self.existing, "Billa", "2026-05-08", 13.63, "unbekannt"))

    def test_different_amount_not_duplicate(self):
        self.assertFalse(self.fn(self.existing, "Billa", "2026-05-08", 22.15, "unbekannt"))

    def test_different_date_not_duplicate(self):
        self.assertFalse(self.fn(self.existing, "Billa", "2026-05-09", 13.63, "unbekannt"))

    def test_different_store_not_duplicate(self):
        self.assertFalse(self.fn(self.existing, "Spar", "2026-05-08", 13.63, "unbekannt"))

    def test_different_account_not_duplicate(self):
        self.assertFalse(self.fn(self.existing, "Billa", "2026-05-08", 13.63, "haushalt"))

    def test_empty_existing_not_duplicate(self):
        self.assertFalse(self.fn([], "Billa", "2026-05-08", 13.63, "unbekannt"))

    def test_amount_rounding_tolerance(self):
        self.assertTrue(self.fn(self.existing, "Billa", "2026-05-08", 13.630001, "unbekannt"))

    def test_tip_legacy_amount_is_recognized(self):
        self.assertTrue(self.fn(self.existing, "Billa", "2026-05-08", 15.63,
                                "unbekannt", receipt_total=13.63))
        modern = [{**self.existing[0], "bon": {"tip": 0}}]
        self.assertFalse(self.fn(modern, "Billa", "2026-05-08", 15.63,
                                 "unbekannt", receipt_total=13.63))

    def test_refund_is_not_duplicate_of_expense(self):
        self.assertFalse(self.fn(self.existing, "Billa", "2026-05-08", -13.63, "unbekannt"))


class TestParseAmount(unittest.TestCase):
    def setUp(self):
        self.fn = H["_parse_amount"]

    def test_german_decimal(self):
        self.assertEqual(self.fn("46,09"), 46.09)

    def test_german_thousands(self):
        self.assertEqual(self.fn("1.234,56"), 1234.56)

    def test_space_thousands(self):
        self.assertEqual(self.fn("1 234,56"), 1234.56)

    def test_dot_decimal(self):
        self.assertEqual(self.fn("46.09"), 46.09)

    def test_invalid(self):
        self.assertIsNone(self.fn("abc"))


class TestExtractDateCandidates(unittest.TestCase):
    def setUp(self):
        self.fn = H["_extract_date_candidates"]

    def test_dmy_dotted(self):
        self.assertIn("2026-05-21", self.fn("Rechnungsdatum: 21.05.2026"))

    def test_iso_passthrough(self):
        self.assertIn("2026-05-21", self.fn("Datum 2026-05-21"))

    def test_slash_and_dash_formats(self):
        self.assertIn("2026-06-24", self.fn("24/06/2026"))
        self.assertIn("2026-06-24", self.fn("24-06-2026"))

    def test_invalid_month_ignored(self):
        self.assertEqual(self.fn("32.13.2026"), [])

    def test_empty(self):
        self.assertEqual(self.fn(""), [])


class TestExtractTotalCandidates(unittest.TestCase):
    def setUp(self):
        self.fn = H["_extract_total_candidates"]

    def test_summe_line(self):
        text = "Pos 1 12,00\nPos 2 34,09\nSUMME EUR 46,09"
        self.assertIn(46.09, self.fn(text))

    def test_max_amount_included(self):
        # größter Betrag wird auch ohne Summen-Keyword als Kandidat geführt
        text = "Artikel A 3,50\nArtikel B 50,05\nMwSt 8,34"
        self.assertIn(50.05, self.fn(text))

    def test_rechnungsbetrag_keyword(self):
        self.assertIn(50.05, self.fn("Rechnungsbetrag: 50,05 EUR"))

    def test_empty(self):
        self.assertEqual(self.fn(""), [])


class TestChargingCategory(unittest.TestCase):
    """Ladestrom fürs Auto → Mobilität / Auto, nicht Energie / Strom."""

    def setUp(self):
        self.re_ = H["CHARGING_KEYWORDS_RE"]

    def test_tesla_ladestation(self):
        self.assertTrue(self.re_.search("Ladestation Völkermarkt, Austria"))

    def test_supercharger(self):
        self.assertTrue(self.re_.search("Tesla Supercharger"))

    def test_englisch(self):
        self.assertTrue(self.re_.search("Charging session"))
        self.assertTrue(self.re_.search("Charge Point Operator"))

    def test_weitere_anbieter(self):
        self.assertTrue(self.re_.search("IONITY GmbH"))
        self.assertTrue(self.re_.search("SMATRICS EnBW"))

    def test_haushaltsstrom_trifft_nicht(self):
        # VERBUND-Stromrechnung darf NICHT als Ladestrom gelten — sonst
        # landet der Haushaltsstrom unter Mobilität / Auto
        verbund = (
            "VERBUND Energy4Customers GmbH\nAbrechnung - Strom\n"
            "Stromverbrauch: 261,01 kWh\nEnergiekosten 36,62\n"
            "Netzgebühren (inkl. Entgelt für Messpreis) 26,09\n"
            "Arbeitspreis 261,01 kWh 0,125000 32,63\n"
        )
        self.assertIsNone(self.re_.search(verbund))


class TestItemsSum(unittest.TestCase):
    def setUp(self):
        self.fn = H["_items_sum"]

    def test_gesamt_preferred(self):
        items = [{"gesamt": 4.08, "einzelpreis": 4.30}, {"gesamt": 1.42}]
        self.assertEqual(self.fn(items), 5.50)

    def test_falls_back_to_einzelpreis(self):
        self.assertEqual(self.fn([{"einzelpreis": 2.50}]), 2.50)

    def test_ignores_garbage(self):
        self.assertEqual(self.fn([{"gesamt": "keine Zahl"}, "kein dict", {"gesamt": 3.0}]), 3.0)

    def test_empty(self):
        self.assertEqual(self.fn([]), 0.0)


class TestGrossTotalCorrection(unittest.TestCase):
    """Netto-Falle: `total` wurde auf die Positionssumme gezogen (Tesla-Layout)."""

    def setUp(self):
        self.fn = H["_gross_total_correction"]

    # Rohtext wie ihn pdfplumber aus der Tesla-Ladestrom-Rechnung zieht.
    TESLA = (
        "Event-Datum Beschreibung Preis/Einheit Anzahl Steuern (%) Total (EUR)\n"
        "2026/07/10 Stromgebuehr 0.275069 / kWh 64.2622 kWh 20 17.67\n"
        "Teilsumme 17.67\n"
        "Gesamtsumme Steuern 3.53\n"
        "Gesamtbetrag (EUR) 21.20\n"
    )

    def test_tesla_net_total_corrected(self):
        self.assertEqual(self.fn(self.TESLA, 17.67, 17.67), (21.20, 3.53))

    def test_teilsumme_alone_does_not_trigger(self):
        # Ohne "Gesamtbetrag"-Zeile gibt es keinen belastbaren Bruttobetrag
        text = "Stromgebuehr 17.67\nTeilsumme 17.67\nGesamtsumme Steuern 3.53\n"
        self.assertIsNone(self.fn(text, 17.67, 17.67))

    def test_zu_zahlen_keyword(self):
        text = "Leistung 100,00\nZu zahlen 120,00\n"
        self.assertEqual(self.fn(text, 100.00, 100.00), (120.00, 20.00))

    def test_verbund_gesamtsumme(self):
        # Stromrechnung: Energie/Netz/Abgaben netto, USt. auf die Zwischensumme
        text = (
            "Energie 41,20\nNetz 28,90\nAbgaben 4,08\n"
            "Zwischensumme 74,18\n"
            "Umsatzsteuer 20 % 14,84\n"
            "Gesamtsumme 89,02\n"
        )
        self.assertEqual(self.fn(text, 74.18, 74.18), (89.02, 14.84))

    def test_gesamtsumme_steuern_still_excluded(self):
        # "Gesamtsumme Steuern" darf trotz des neuen gesamtsumme-Keywords
        # nicht als Endbetrag durchgehen (steht so auf der Tesla-Rechnung)
        text = "Position 17.67\nTeilsumme 17.67\nGesamtsumme Steuern 3.53\n"
        self.assertIsNone(self.fn(text, 17.67, 17.67))

    def test_weitere_endbetrag_marker(self):
        for line in ("Zu bezahlen 120,00", "Zahlungsbetrag 120,00",
                     "Rechnungssumme 120,00", "Summe brutto 120,00",
                     "Einzugsbetrag 120,00"):
            with self.subTest(line=line):
                self.assertEqual(
                    self.fn(f"Leistung 100,00\n{line}\n", 100.00, 100.00),
                    (120.00, 20.00),
                )

    def test_german_vat_rate(self):
        text = "Position 100,00\nRechnungsbetrag 119,00\n"
        self.assertEqual(self.fn(text, 100.00, 100.00), (119.00, 19.00))

    def test_no_trigger_when_items_already_gross(self):
        # Kassenbon: Positionen brutto, Summe == total → nichts zu korrigieren.
        # (Die 46,09 stehen auf der Summenzeile, nicht darüber.)
        text = "Milch 1,29\nBrot 2,80\nSUMME EUR 46,09\n"
        self.assertIsNone(self.fn(text, 46.09, 46.09))

    def test_no_trigger_on_inconsistent_items(self):
        # Positionen passen ohnehin nicht zum total → hier wird nicht geraten
        self.assertIsNone(self.fn(self.TESLA, 17.67, 12.00))

    def test_no_trigger_on_implausible_difference(self):
        # Differenz entspricht keinem USt.-Satz (17.67 → 25.00 wären 41 %)
        text = "Position 17.67\nGesamtbetrag (EUR) 25.00\n"
        self.assertIsNone(self.fn(text, 17.67, 17.67))

    def test_empty_text(self):
        self.assertIsNone(self.fn("", 17.67, 17.67))

    def test_zero_total(self):
        self.assertIsNone(self.fn(self.TESLA, 0, 0))


class TestPrefilterSemanticHit(unittest.TestCase):
    """Vorab-Dedup vor dem AI-Call — Datum + Betrag + Händler-Substring."""

    def setUp(self):
        self.fn = H["_prefilter_semantic_hit"]
        self.existing = [
            {"description": "Eurospar", "date": "2026-05-21", "amount": -46.09},
            {"description": "Billa", "date": "2026-05-08", "amount": -13.63},
        ]

    def test_hit_all_signals_match(self):
        text = "EUROSPAR Filiale 1030\nSUMME EUR 46,09\nDatum 21.05.2026"
        hit = self.fn(self.existing, text, ["2026-05-21"], [46.09])
        self.assertIsNotNone(hit)
        self.assertEqual(hit["description"], "Eurospar")

    def test_no_hit_store_absent_from_text(self):
        # gleicher Betrag + Datum, aber Händlername steht nicht im Text
        text = "Random Bäckerei\nSUMME 46,09\n21.05.2026"
        self.assertIsNone(self.fn(self.existing, text, ["2026-05-21"], [46.09]))

    def test_no_hit_amount_differs(self):
        text = "EUROSPAR\nSUMME 99,99\n21.05.2026"
        self.assertIsNone(self.fn(self.existing, text, ["2026-05-21"], [99.99]))

    def test_no_hit_date_differs(self):
        text = "EUROSPAR\nSUMME 46,09\n22.05.2026"
        self.assertIsNone(self.fn(self.existing, text, ["2026-05-22"], [46.09]))

    def test_amount_tolerance(self):
        text = "EUROSPAR\nSUMME 46,09"
        self.assertIsNotNone(self.fn(self.existing, text, ["2026-05-21"], [46.090001]))

    def test_empty_existing(self):
        self.assertIsNone(self.fn([], "EUROSPAR 46,09", ["2026-05-21"], [46.09]))


class TestLandlord(unittest.TestCase):
    """Vermieter-Erkennung (sync mit js/personalConfig.js)."""

    def setUp(self):
        self.landlord = H["LANDLORD"]

    def test_structure(self):
        self.assertIn("vendor_pattern", self.landlord)
        self.assertIn("miete_keywords", self.landlord)

    def test_vendor_matches(self):
        self.assertTrue(self.landlord["vendor_pattern"].search("Helvetia Versicherungen AG"))
        self.assertTrue(self.landlord["vendor_pattern"].search("helvetia"))

    def test_vendor_doesnt_match_random(self):
        self.assertFalse(self.landlord["vendor_pattern"].search("Wiener Städtische"))

    def test_miete_keywords(self):
        for kw in ("Vorschreibung", "Miete", "Betriebskosten", "Hausverwaltung", "Rennweg"):
            self.assertTrue(self.landlord["miete_keywords"].search(kw),
                            f"miete_keywords sollte '{kw}' matchen")

    def test_miete_keywords_dont_match_random(self):
        self.assertFalse(self.landlord["miete_keywords"].search("Unfallversicherung"))


class TestBonPrompt(unittest.TestCase):
    def test_loaded(self):
        self.assertIn("BON_PROMPT", H)
        self.assertGreater(len(H["BON_PROMPT"]), 100)

    def test_contains_pfand(self):
        self.assertIn("Pfand", H["BON_PROMPT"])

    def test_contains_canonical_subcategories(self):
        bp = H["BON_PROMPT"]
        self.assertIn("Hygiene & Drogerie", bp)
        self.assertIn("Backwaren", bp)

    def test_js_schema_field_names(self):
        bp = H["BON_PROMPT"]
        self.assertIn('"store"', bp)
        self.assertIn("subcategory", bp)

    def test_python_suffix_has_category(self):
        suffix = H["PYTHON_PROMPT_SUFFIX"]
        self.assertIn("category", suffix)
        self.assertIn("Wohnen / Miete", suffix)

    def test_prompt_warns_about_future_dates(self):
        # Ohne diese Regel liest die AI das Kassenbon-Datum aus der Fußzeile
        # gern um einen Tag daneben — und niemand merkt es.
        self.assertIn("Zukunft", H["BON_PROMPT"])

    def test_prompt_explains_kassenbon_footer(self):
        bp = H["BON_PROMPT"]
        self.assertIn("Datum Uhrzeit Filiale", bp)

    def test_date_anchor_contains_reference_date(self):
        anchor = H["_date_anchor"]("2026-08-15")
        self.assertIn("2026-08-15", anchor)
        self.assertIn("debit_date", anchor)


class TestFutureDateCorrection(unittest.TestCase):
    """Deterministische Absicherung gegen ein Datum in der Zukunft."""

    def setUp(self):
        self.fix   = H["_future_date_correction"]
        self.today = "2026-08-15"

    def test_edeka_bon_off_by_one(self):
        # AI liest 16.08., im Rohtext steht 15.08.
        text = "EDEKA Sulger\nDatum Uhrzeit Filiale\n15.08.2026 15:11 0042778\n"
        self.assertEqual(self.fix(text, "2026-08-16", self.today), "2026-08-15")

    def test_plausible_date_untouched(self):
        text = "Rechnungsdatum: 07.07.2026\n"
        self.assertIsNone(self.fix(text, "2026-07-07", self.today))

    def test_today_is_not_future(self):
        text = "15.08.2026\n"
        self.assertIsNone(self.fix(text, self.today, self.today))

    def test_picks_newest_past_date(self):
        # Leistungszeitraum + Rechnungsdatum → das jüngste gewinnt.
        text = "Leistungszeitraum 01.06.2026 - 30.06.2026\nRechnungsdatum: 05.07.2026\n"
        self.assertEqual(self.fix(text, "2026-09-01", self.today), "2026-07-05")

    def test_no_past_candidate_leaves_it_alone(self):
        # Nur Zukunftsdaten im Text (z.B. reines Abbuchungsdatum) → nicht raten.
        text = "Einzug erfolgt am 02.09.2026\n"
        self.assertIsNone(self.fix(text, "2026-09-05", self.today))

    def test_iso_dates_in_text_also_count(self):
        text = "Event-Datum 2026-07-10 Stromgebuehr\n"
        self.assertEqual(self.fix(text, "2026-08-20", self.today), "2026-07-10")

    def test_empty_text_no_correction(self):
        self.assertIsNone(self.fix("", "2026-08-16", self.today))

    def test_empty_date_no_correction(self):
        self.assertIsNone(self.fix("15.08.2026", "", self.today))


if __name__ == "__main__":
    unittest.main()



class TestReceiptStorage(unittest.TestCase):
    """Datenvertrag vom KI-Ergebnis bis zum gespeicherten Dokument."""
    def setUp(self):
        from unittest.mock import MagicMock, patch
        from datetime import datetime
        self.col = MagicMock()
        self.col.where.return_value = self.col
        self.col.stream.return_value = []
        self.patch = patch.dict(H, {"_tx_collection": lambda: self.col, "datetime": datetime})
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def save(self, **changes):
        import contextlib
        import io
        data = {"store": "Test", "date": "2026-08-15", "total": 10, "vat": 0,
                "items": [{"name": "Produkt", "gesamt": 10}]}
        data.update(changes)
        with contextlib.redirect_stdout(io.StringIO()):
            H["save_to_firestore"](data, "synthetic.pdf", "test")
        return self.col.document.return_value.set.call_args.args[0]

    def test_tip_survives_storage(self):
        d = self.save(tip=2)
        self.assertEqual(d["amount"], -12)
        self.assertEqual(d["bon"]["tip"], 2)
        self.assertEqual(d["bon"]["total"], 10)

    def test_zero_line_stays_zero(self):
        d = self.save(items=[{"name": "Produkt", "gesamt": 10},
                             {"name": "Gratis", "gesamt": 0, "einzelpreis": 4.3}])
        self.assertEqual(d["bon"]["items"][1]["price"], 0)
        self.assertFalse(d["needsReview"])

    def test_foreign_currency_stays_visible_and_open(self):
        d = self.save(currency="USD")
        self.assertEqual(d["currency"], "USD")
        self.assertEqual(d["bon"]["currency"], "USD")
        self.assertTrue(d["needsReview"])

    def test_uncertain_invoice_stays_open(self):
        self.assertTrue(self.save(needs_review=True)["needsReview"])
        self.assertTrue(self.save(total=None, date=None)["needsReview"])

    def test_incomplete_items_do_not_block_clear_total(self):
        for changes in ({"total": 12}, {"items": []}, {"items_review": True}):
            d = self.save(**changes)
            self.assertFalse(d["needsReview"])
            self.assertTrue(d["itemsReview"])
            self.assertTrue(d["bon"]["itemsReview"])
            self.assertEqual(d["bon"]["total"], changes.get("total", 10))

    def test_refund_not_turned_into_expense(self):
        d = self.save(total=-10, items=[{"name": "Retoure", "gesamt": -10}])
        self.assertEqual(d["amount"], 10)
        self.assertTrue(d["needsReview"])
