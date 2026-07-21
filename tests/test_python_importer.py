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


if __name__ == "__main__":
    unittest.main()
