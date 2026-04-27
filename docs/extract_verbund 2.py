#!/usr/bin/env python3
"""
extract_verbund.py — Verbund-Stromrechnung (PDF) parsen und Zahlen in JSON speichern

Verwendung:
    python3 extract_verbund.py /pfad/zur/rechnung.pdf
"""

import json
import os
import re
import sys
from pathlib import Path

try:
    import pdfplumber
except ImportError:
    print("FEHLER: pdfplumber nicht installiert.")
    print("  pip3 install pdfplumber --break-system-packages")
    sys.exit(1)

# Firebase Admin SDK (optional — nur wenn FIREBASE_SERVICE_ACCOUNT gesetzt)
_firestore_db = None

def get_firestore_db():
    global _firestore_db
    if _firestore_db is not None:
        return _firestore_db
    sa_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "")
    if not sa_json:
        return None
    try:
        import firebase_admin
        from firebase_admin import credentials, firestore as fs
        sa_dict = json.loads(sa_json)
        cred = credentials.Certificate(sa_dict)
        if not firebase_admin._apps:
            firebase_admin.initialize_app(cred)
        _firestore_db = fs.client()
        return _firestore_db
    except Exception as exc:
        print(f"  Firebase Admin init fehlgeschlagen: {exc}")
        return None

# ── Konfiguration ──────────────────────────────────────────────────────────────
ZAEHLPUNKTE = {
    "AT0010000000000000001000015277856": "rennweg",
    "AT0010000000000000001000015183029": "aspangstrasse",
}

SCRIPT_DIR = Path(__file__).parent
DATA_DIR   = SCRIPT_DIR / "data"
# ───────────────────────────────────────────────────────────────────────────────

# Regex-Muster (Seite 1)
RE_RECHNUNGSDATUM   = re.compile(r"Rechnungsdatum:\s*(\d{2}\.\d{2}\.\d{4})")
RE_ZEITRAUM         = re.compile(r"Abrechnungszeitraum:\s*(\d{2}\.\d{2}\.\d{4})\s*[-–]\s*(\d{2}\.\d{2}\.\d{4})")
RE_STROMVERBRAUCH   = re.compile(r"Stromverbrauch:\s*([\d.,]+)\s*kWh")
RE_ENERGIEKOSTEN    = re.compile(r"Energiekosten\s+([\d.,]+)")
RE_NETZGEBUEHREN    = re.compile(r"Netzgeb[üu]hren.*?\s+([\d.,]+)")
RE_STEUERN          = re.compile(r"Steuern und Abgaben\s+([\d.,]+)")
RE_GESAMT           = re.compile(r"Ihre Gesamtkosten inkl\. USt\.\s+([\d.,]+)")
RE_RECHNUNGSNUMMER  = re.compile(r"Rechnungsnummer:\s*(\S+)")

# Regex-Muster (Seite 2)
RE_ZAEHLPUNKT       = re.compile(r"Zählpunkt:\s*(AT\w+)")


def parse_num(s: str) -> float:
    """Deutsches Zahlenformat (1.890,50) → float."""
    return float(s.replace(".", "").replace(",", "."))


def parse_date(s: str) -> str:
    """TT.MM.JJJJ → JJJJ-MM-TT."""
    day, month, year = s.split(".")
    return f"{year}-{month}-{day}"


def extract_text(pdf_path: Path) -> tuple[str, str]:
    """Text von Seite 1 und Seite 2 extrahieren. Gibt (seite1, seite2) zurück."""
    with pdfplumber.open(pdf_path) as pdf:
        seite1 = pdf.pages[0].extract_text() or "" if len(pdf.pages) >= 1 else ""
        seite2 = pdf.pages[1].extract_text() or "" if len(pdf.pages) >= 2 else ""
    return seite1, seite2


def find_zaehlpunkt(text: str) -> str | None:
    """Zählpunktnummer aus Text extrahieren."""
    match = RE_ZAEHLPUNKT.search(text)
    return match.group(1) if match else None


def find_haushalt(zaehlpunkt: str) -> str | None:
    """Haushalt anhand der Zählpunktnummer bestimmen."""
    return ZAEHLPUNKTE.get(zaehlpunkt)


def extract_fields(text_p1: str) -> dict:
    """Alle relevanten Felder aus dem Text von Seite 1 extrahieren."""
    data = {}

    m = RE_RECHNUNGSDATUM.search(text_p1)
    if m:
        data["rechnungsdatum"] = parse_date(m.group(1))

    m = RE_ZEITRAUM.search(text_p1)
    if m:
        data["zeitraum_von"] = parse_date(m.group(1))
        data["zeitraum_bis"] = parse_date(m.group(2))

    m = RE_STROMVERBRAUCH.search(text_p1)
    if m:
        data["kwh"] = parse_num(m.group(1))

    m = RE_ENERGIEKOSTEN.search(text_p1)
    if m:
        data["energiekosten"] = parse_num(m.group(1))

    # Netzgebühren: letzter Match auf Seite 1
    matches = RE_NETZGEBUEHREN.findall(text_p1)
    if matches:
        data["netzgebuehren"] = parse_num(matches[-1])

    m = RE_STEUERN.search(text_p1)
    if m:
        data["steuern"] = parse_num(m.group(1))

    m = RE_GESAMT.search(text_p1)
    if m:
        data["gesamt_inkl_ust"] = parse_num(m.group(1))

    m = RE_RECHNUNGSNUMMER.search(text_p1)
    if m:
        data["rechnungsnummer"] = m.group(1)

    return data


def load_json(path: Path) -> list:
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return []


def save_json(path: Path, data: list) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def process_pdf(pdf_path: Path) -> bool:
    """
    PDF verarbeiten und Daten in die entsprechende JSON-Datei schreiben.
    Gibt True zurück wenn erfolgreich, False wenn übersprungen oder fehlerhaft.
    """
    print(f"Verarbeite: {pdf_path.name}")

    try:
        text_p1, text_p2 = extract_text(pdf_path)
    except Exception as exc:
        print(f"  FEHLER beim Lesen des PDFs: {exc}")
        return False

    # Zählpunkt und Haushalt bestimmen
    zaehlpunkt = find_zaehlpunkt(text_p2)
    if not zaehlpunkt:
        # Fallback: auch auf Seite 1 suchen
        zaehlpunkt = find_zaehlpunkt(text_p1)

    if not zaehlpunkt:
        print("  FEHLER: Kein Zählpunkt gefunden. Seite 2 prüfen.")
        return False

    haushalt = find_haushalt(zaehlpunkt)
    if not haushalt:
        print(f"  FEHLER: Unbekannter Zählpunkt '{zaehlpunkt}'.")
        print(f"  Bitte in ZAEHLPUNKTE in extract_verbund.py eintragen.")
        return False

    # Felder extrahieren
    data = extract_fields(text_p1)

    required = ["rechnungsdatum", "kwh", "gesamt_inkl_ust", "rechnungsnummer"]
    missing  = [f for f in required if f not in data]
    if missing:
        print(f"  WARNUNG: Fehlende Felder: {', '.join(missing)}")

    if "rechnungsnummer" not in data:
        print("  FEHLER: Rechnungsnummer nicht gefunden, Eintrag wird übersprungen.")
        return False

    rechnungsnummer = data["rechnungsnummer"]

    # JSON laden und Duplikat-Check
    json_path = DATA_DIR / f"{haushalt}.json"
    entries   = load_json(json_path)

    existing = [e.get("rechnungsnummer") for e in entries]
    if rechnungsnummer in existing:
        print(f"  Bereits verarbeitet (Rechnungsnummer {rechnungsnummer}), übersprungen.")
        return False

    # Eintrag anhängen
    entries.append(data)
    save_json(json_path, entries)

    # Firestore: Dokument schreiben (wenn Service Account verfügbar)
    db = get_firestore_db()
    if db:
        try:
            doc = {**data, "location": haushalt}
            db.collection("invoices").document(rechnungsnummer).set(doc)
            print(f"  Firestore: invoices/{rechnungsnummer} geschrieben.")
        except Exception as exc:
            print(f"  Firestore-Fehler (nicht kritisch): {exc}")

    print(f"  Haushalt:  {haushalt}")
    print(f"  Rechnung:  {rechnungsnummer}  ({data.get('rechnungsdatum', '?')})")
    print(f"  Verbrauch: {data.get('kwh', '?')} kWh")
    print(f"  Gesamt:    {data.get('gesamt_inkl_ust', '?')} €")
    print(f"  Gespeichert in: {json_path}")
    return True


def main() -> None:
    if len(sys.argv) < 2:
        print("Verwendung: python3 extract_verbund.py /pfad/zur/rechnung.pdf")
        sys.exit(1)

    pdf_path = Path(sys.argv[1])

    if not pdf_path.exists():
        print(f"FEHLER: Datei nicht gefunden: {pdf_path}")
        sys.exit(1)

    if not pdf_path.suffix.lower() == ".pdf":
        print(f"FEHLER: Keine PDF-Datei: {pdf_path}")
        sys.exit(1)

    success = process_pdf(pdf_path)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
