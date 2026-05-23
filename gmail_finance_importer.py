#!/usr/bin/env python3
"""
gmail_finance_importer.py — PDF- & Bild-Rechnungen aus Gmail → Firestore (finance-dashboard)

Ablauf:
  1. IMAP: Mails im Label "Rechnungen" abholen, PDF- und Bild-Anhänge speichern
  2a. PDF: pdfplumber → Text extrahieren
  2b. Bild (PNG/JPG): Base64 → GPT-4o Vision → strukturierte Daten
  3. AI: OpenAI gpt-4o-mini/gpt-4o (primär) → Claude Haiku (Fallback)
  4. Firestore: Transaktion unter household/main/transactions/{id} speichern

Felder werden auf das Format des Browser-Parsers gemappt:
  date, amount (negativ), description, category, account, aiCategorized

Ausführen:
  pip install pdfplumber anthropic firebase-admin python-dotenv
  python3 gmail_finance_importer.py
"""

import email
import email.utils
import hashlib
import imaplib
import json
import os
import re
import sys
import tempfile
import urllib.request
from datetime import datetime, timedelta
from email.header import decode_header
from pathlib import Path

import base64

import pdfplumber
from dotenv import load_dotenv

load_dotenv()

# ── Konfiguration ──────────────────────────────────────────────────────────────

GMAIL_USER               = "manuel.rechnungen@gmail.com"
GMAIL_APP_PASSWORD       = os.getenv("GMAIL_APP_PASSWORD", "")
GMAIL_LABEL              = "Rechnungen"
PDF_TEMP_DIR             = Path(tempfile.mkdtemp())
OPENAI_API_KEY           = os.getenv("OPENAI_API_KEY", "").strip()
ANTHROPIC_API_KEY        = os.getenv("ANTHROPIC_API_KEY", "").strip()
FIREBASE_SERVICE_ACCOUNT = os.getenv("FIREBASE_SERVICE_ACCOUNT", "")

# Letzte 4 Stellen → Konto-ID (muss mit state.js CARD_CONFIG übereinstimmen)
CARD_ACCOUNT_MAP: dict[str, str] = {
    "5676": "haushalt",       # Olga physische Karte (Easybank Haushalt)
    "6562": "haushalt",       # Manuel physische Karte (Easybank Haushalt)
    "0522": "haushalt",       # Manuel Apple Watch (Easybank Haushalt)
    "6351": "privat_olga",    # Olga Privatkonto (Easybank)
    "4575": "privat_manuel",  # Manuel iPhone (Erste Bank Privat)
}

# Firestore-Pfad: household/main/transactions/{id}  ← gleich wie Browser-Parser
FIRESTORE_HH_DOC    = ("household", "main")
FIRESTORE_TX_SUBCOL = "transactions"

MONTH_NAMES = {
    1: "01_Januar",   2: "02_Februar", 3: "03_März",      4: "04_April",
    5: "05_Mai",      6: "06_Juni",    7: "07_Juli",       8: "08_August",
    9: "09_September",10: "10_Oktober",11: "11_November",  12: "12_Dezember",
}

# ── Kategorie-Listen (Single Source: prompts/analyze-bon.md + js/categories.js) ──
# Bei Änderungen IMMER auch in JS-Side aktualisieren.

MAIN_CATEGORIES = [
    "Supermarkt", "Restaurant / Café", "Drogerie", "Energie / Strom",
    "Telekommunikation", "Versicherung", "Online Shopping",
    "Mobilität / Auto", "Wohnen / Miete", "Gesundheit", "Gebühren / Bank",
    "Freizeit", "Sonstiges",
]

# Kanonische Subkategorien-Liste (analog SUBCAT_ICONS in js/categories.js)
SUBCATEGORIES = [
    "Milchprodukte", "Süßwaren / Naschen", "Backwaren", "Getränke",
    "Fleisch & Wurst", "Fisch / Meeresfrüchte", "Obst & Gemüse",
    "Nudeln & Reis", "Öl", "Aufstriche & Butter", "Gewürze & Saucen",
    "Konserven", "Tiefkühl", "Hygiene & Drogerie", "Putzmittel", "Pfand",
    "Elektronik", "Dienstleistung", "Sonstiges",
]

# Persönliche Konfiguration — sync mit js/personalConfig.js.
# Vermieter-Name und Miete-Keywords; verhindert dass Helvetia/Rennweg
# durch den Code verstreut sind. Bei Änderungen IMMER beide Seiten anfassen.
LANDLORD = {
    "vendor_pattern": re.compile(r"Helvetia", re.I),
    "miete_keywords": re.compile(
        r"Vorschreibung|Miete|Betriebskosten|Hausverwaltung|Rennweg", re.I
    ),
}

# Wiederkehrende Buchungen — sync mit RECURRING_RULES in js/categories.js.
# isRecurring=True erlaubt es dem Browser-Dashboard die Tx in der
# "Fixkosten"-Karte zu zeigen (renderFixkosten in app.js).
RECURRING_RULES: list[dict] = [
    {"pattern": re.compile(
        rf"Miete / Hausverwaltung|{LANDLORD['vendor_pattern'].pattern}", re.I),
     "label": "Miete"},
    {"pattern": re.compile(r"Magenta Mobil", re.I),
     "label": "Magenta Mobil",         "category": "Telekommunikation"},
    {"pattern": re.compile(r"Magenta Festnetz", re.I),
     "label": "Magenta Festnetz",      "category": "Telekommunikation"},
    {"pattern": re.compile(r"Allianz.*Elementar|AEV\d+|Allianz KFZ", re.I),
     "label": "Allianz KFZ",           "category": "Mobilität / Auto"},
    {"pattern": re.compile(r"Allianz", re.I),
     "label": "Allianz Versicherung",  "category": "Versicherung"},
    {"pattern": re.compile(r"Raiffeisen.Leasing", re.I),
     "label": "BYD Leasing"},
    {"pattern": re.compile(r"Netflix", re.I),
     "label": "Netflix"},
    {"pattern": re.compile(r"Spotify", re.I),
     "label": "Spotify"},
]


def _match_recurring(description: str) -> dict | None:
    """Erste matching RECURRING_RULES-Regel zurückgeben (oder None)."""
    if not description:
        return None
    for rule in RECURRING_RULES:
        if rule["pattern"].search(description):
            return rule
    return None

# ── Bon-Prompt (Single Source: prompts/analyze-bon.md) ───────────────────────
# Wird beim Modul-Import einmal von der Markdown-Datei geladen. Damit kann der
# Browser-Bon-Scanner (bonAnalyzer.js) und der Python-Importer denselben Prompt
# benutzen — Drift ist strukturell unmöglich.

def _load_bon_prompt() -> str:
    path = Path(__file__).parent / "prompts" / "analyze-bon.md"
    return path.read_text(encoding="utf-8")


BON_PROMPT = _load_bon_prompt()

# Python-spezifischer Suffix: zusätzlich Top-Level-Kategorie anfordern.
# (Browser braucht das nicht — Bank-Tx liefert die Kategorie via Auto-Link.
# Python-Importer schreibt aber Stand-alone-Transaktionen.)
PYTHON_PROMPT_SUFFIX = f"""

Zusätzlich:
- "category": Hauptkategorie der Rechnung. Eine dieser Optionen wählen:
  {", ".join(MAIN_CATEGORIES)}
"""

# ── Händler-Normalisierung — sync mit CARD_MERCHANTS in js/parser.js ─────────
# Reihenfolge: spezifischere Patterns ZUERST (BILLA PLUS vor BILLA).
# Der erste Match gewinnt.

CARD_MERCHANTS: list[tuple[re.Pattern, str]] = [
    # ── Supermärkte (Österreich) ──
    (re.compile(r"BILLA\s*PLUS", re.I),                    "Billa Plus"),
    (re.compile(r"\bBILLA\b", re.I),                       "Billa"),
    (re.compile(r"INTERSPAR", re.I),                       "Interspar"),
    (re.compile(r"EUROSPAR", re.I),                        "Eurospar"),
    (re.compile(r"\bSPAR\b", re.I),                        "Spar"),
    (re.compile(r"\bHOFER\b", re.I),                       "Hofer"),
    (re.compile(r"\bLIDL\b", re.I),                        "Lidl"),
    (re.compile(r"\bPENNY\b", re.I),                       "Penny"),
    (re.compile(r"NAH.{0,3}FRISCH", re.I),                 "Nah & Frisch"),
    (re.compile(r"\bMPREIS\b", re.I),                      "M-Preis"),
    (re.compile(r"UNIMARKT", re.I),                        "Unimarkt"),
    (re.compile(r"MAXIMARKT", re.I),                       "Maximarkt"),
    (re.compile(r"\bADEG\b", re.I),                        "Adeg"),
    (re.compile(r"JULIUS\s*MEINL", re.I),                  "Julius Meinl"),
    # ── Drogerie ──
    (re.compile(r"DM-?FIL", re.I),                         "dm"),
    (re.compile(r"\bBIPA\b", re.I),                        "Bipa"),
    (re.compile(r"MUELLER|MÜLLER", re.I),                  "Müller"),
    # ── Gastronomie ──
    (re.compile(r"MCDONALD|MC\s*DON", re.I),               "McDonald's"),
    (re.compile(r"BURGER\s*KING", re.I),                   "Burger King"),
    (re.compile(r"\bKFC\b", re.I),                         "KFC"),
    (re.compile(r"\bSUBWAY\b", re.I),                      "Subway"),
    (re.compile(r"STARBUCKS", re.I),                       "Starbucks"),
    (re.compile(r"\bPRONTO\b", re.I),                      "Pronto"),
    (re.compile(r"JOSEPH\s*BAC", re.I),                    "Joseph Bäckerei"),
    (re.compile(r"ANKER", re.I),                           "Anker"),
    (re.compile(r"\bFELBER\b", re.I),                      "Felber"),
    (re.compile(r"DER\s+MANN", re.I),                      "Der Mann"),
    (re.compile(r"COCA.COLA\s*HBC", re.I),                 "Coca-Cola Automat"),
    # ── Tankstellen (Österreich) ──
    (re.compile(r"\bOMV\b", re.I),                         "OMV"),
    (re.compile(r"\bAVANTI\b", re.I),                      "Avanti"),
    (re.compile(r"TURMOEL|TURM.L", re.I),                  "Turmöl"),
    (re.compile(r"\bSHELL\b", re.I),                       "Shell"),
    (re.compile(r"\bJET\b", re.I),                         "JET"),
    (re.compile(r"\bBP\b", re.I),                          "BP"),
    (re.compile(r"\bENI\b|\bAGIP\b", re.I),                "ENI"),
    (re.compile(r"CIRCLE\s*K", re.I),                      "Circle K"),
    # ── Elektronik ──
    (re.compile(r"MEDIA\s*MARKT|MEDIAMARKT", re.I),        "MediaMarkt"),
    (re.compile(r"\bSATURN\b", re.I),                      "Saturn"),
    (re.compile(r"\bHARTLAUER\b", re.I),                   "Hartlauer"),
    (re.compile(r"\bCONRAD\b", re.I),                      "Conrad"),
    # ── Einrichtung & Baumarkt ──
    (re.compile(r"\bIKEA\b", re.I),                        "IKEA"),
    (re.compile(r"\bOBI\b", re.I),                         "OBI"),
    (re.compile(r"HORNBACH", re.I),                        "Hornbach"),
    (re.compile(r"\bBAUHAUS\b", re.I),                     "Bauhaus"),
    # ── Mode & Sport ──
    (re.compile(r"\bZARA\b", re.I),                        "Zara"),
    (re.compile(r"\bH&M\b", re.I),                         "H&M"),
    (re.compile(r"\bC&A\b", re.I),                         "C&A"),
    (re.compile(r"DEICHMANN", re.I),                       "Deichmann"),
    (re.compile(r"\bHUMANIC\b", re.I),                     "Humanic"),
    (re.compile(r"INTERSPORT", re.I),                      "Intersport"),
    (re.compile(r"DECATHLON", re.I),                       "Decathlon"),
    (re.compile(r"\bLIBRO\b", re.I),                       "Libro"),
]


def _normalize_store(text: str) -> str:
    """Normalisiert einen Händlernamen auf den kanonischen Display-Namen aus
    CARD_MERCHANTS. Liefert den Eingabe-Text unverändert zurück wenn keine
    bekannte Marke erkannt wird."""
    if not text:
        return text
    for pattern, name in CARD_MERCHANTS:
        if pattern.search(text):
            return name
    return text

# ── IMAP Helpers (aus gmail_invoices.py) ───────────────────────────────────────

def decode_str(value: str) -> str:
    """E-Mail-Header dekodieren (z.B. encoded UTF-8 oder Latin-1)."""
    parts = decode_header(value)
    result = []
    for part, charset in parts:
        if isinstance(part, bytes):
            result.append(part.decode(charset or "utf-8", errors="replace"))
        else:
            result.append(part)
    return "".join(result)


def safe_filename(name: str) -> str:
    """Sonderzeichen aus Dateinamen entfernen."""
    keep = " ._-"
    return "".join(c if (c.isalnum() or c in keep) else "_" for c in name).strip()


def list_labels(mail: imaplib.IMAP4_SSL) -> None:
    """Alle Gmail-Labels ausgeben (zum Debuggen)."""
    _, labels = mail.list()
    print("Verfügbare Labels:")
    for label in labels:
        print(" ", label.decode())


IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
IMAGE_MIME_TYPES = {"image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"}


def download_attachments(mail: imaplib.IMAP4_SSL, msg_id: bytes) -> list[Path]:
    """
    Alle PDF- und Bild-Anhänge einer E-Mail in PDF_TEMP_DIR speichern.
    Dateiname: {datum}_{absender}_{original}.{ext}
    Gibt Liste der gespeicherten Pfade zurück (bereits vorhandene inklusive).
    """
    _, msg_data = mail.fetch(msg_id, "(RFC822)")
    # IMAP responses mix tuples and bare bytes; find the first tuple part
    raw = next((part[1] for part in msg_data if isinstance(part, tuple)), None)
    if not isinstance(raw, bytes):
        raise ValueError(f"Konnte RFC822-Bytes nicht aus IMAP-Response lesen: {msg_data!r}")
    msg = email.message_from_bytes(raw)

    # Datum + Absender aus Header
    date_str = msg.get("Date", "")
    try:
        date_obj = email.utils.parsedate_to_datetime(date_str)
    except Exception:
        date_obj = datetime.now()

    sender_full = decode_str(msg.get("From", "unknown"))
    sender = sender_full.split("<")[0].strip() or sender_full.split("@")[0].strip("\"'")
    sender = safe_filename(sender)[:40]

    year        = date_obj.year
    month       = date_obj.month
    date_prefix = date_obj.strftime("%Y-%m-%d")

    target_dir = PDF_TEMP_DIR / str(year) / MONTH_NAMES[month]
    target_dir.mkdir(parents=True, exist_ok=True)

    saved_paths: list[Path] = []

    for part in msg.walk():
        content_type = part.get_content_type()
        disposition  = str(part.get("Content-Disposition", ""))
        raw_filename = part.get_filename()
        fname_decoded = decode_str(raw_filename).lower() if raw_filename else ""

        # PDF erkennen
        is_pdf = (
            content_type == "application/pdf"
            or (content_type == "application/octet-stream" and "pdf" in disposition.lower())
            or fname_decoded.endswith(".pdf")
        )

        # Bild erkennen (PNG, JPG, WEBP — typisch für Lidl, REWE, etc.)
        is_image = (
            content_type in IMAGE_MIME_TYPES
            or any(fname_decoded.endswith(ext) for ext in IMAGE_EXTENSIONS)
        )

        if not (is_pdf or is_image):
            continue

        default_ext = ".pdf" if is_pdf else Path(fname_decoded).suffix or ".png"
        orig_name   = safe_filename(decode_str(raw_filename or f"attachment{default_ext}"))
        new_name    = f"{date_prefix}_{sender}_{orig_name}"
        dest        = target_dir / new_name

        if dest.exists():
            print(f"  Bereits vorhanden, übersprungen: {dest.name}")
            saved_paths.append(dest)
            continue

        payload = part.get_payload(decode=True)
        if not payload:
            continue

        dest.write_bytes(payload)
        kind = "Bild" if is_image else "PDF"
        print(f"  {kind} gespeichert: {dest.name}")
        saved_paths.append(dest)

    return saved_paths

# ── PDF Text-Extraktion ────────────────────────────────────────────────────────

def extract_pdf_text(pdf_path: Path) -> str:
    """Gesamten Text aus PDF extrahieren (alle Seiten)."""
    text = ""
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text += (page.extract_text() or "") + "\n"
    return text

# ── Bild-Extraktion via Vision ────────────────────────────────────────────────

def _image_to_base64(image_path: Path) -> tuple[str, str]:
    """Bild → (base64-String, MIME-Type)."""
    suffix = image_path.suffix.lower()
    mime_map = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                ".webp": "image/webp", ".gif": "image/gif"}
    mime = mime_map.get(suffix, "image/png")
    b64 = base64.b64encode(image_path.read_bytes()).decode("utf-8")
    return b64, mime


VISION_SYSTEM = """Du bist ein Kassenbon-Extraktor. Du bekommst ein Foto oder einen
Screenshot eines Kassenbons und extrahierst alle relevanten Felder als JSON.
Antworte NUR mit einem JSON-Objekt (kein Markdown, kein Text davor/danach)."""

VISION_PROMPT = BON_PROMPT + PYTHON_PROMPT_SUFFIX


def _call_openai_vision(image_path: Path) -> dict | None:
    b64, mime = _image_to_base64(image_path)
    body = json.dumps({
        "model": "gpt-4o",
        "messages": [{
            "role": "user",
            "content": [
                {"type": "image_url",
                 "image_url": {"url": f"data:{mime};base64,{b64}", "detail": "high"}},
                {"type": "text", "text": VISION_PROMPT},
            ],
        }],
        "max_tokens": 1500,
    }).encode()
    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {OPENAI_API_KEY}",
        }
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read())
    return _parse_ai_response(data["choices"][0]["message"]["content"])


def _call_anthropic_vision(image_path: Path) -> dict | None:
    import anthropic
    b64, mime = _image_to_base64(image_path)
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    message = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=1500,
        system=VISION_SYSTEM,
        messages=[{
            "role": "user",
            "content": [
                {"type": "image",
                 "source": {"type": "base64", "media_type": mime, "data": b64}},
                {"type": "text", "text": VISION_PROMPT},
            ],
        }],
    )
    return _parse_ai_response(message.content[0].text)


def extract_image_with_ai(image_path: Path) -> dict | None:
    """Vision-Extraktion: GPT-4o Vision primär → Claude Haiku Vision Fallback."""
    if OPENAI_API_KEY:
        try:
            result = _call_openai_vision(image_path)
            if result:
                print("  Vision: GPT-4o erfolgreich.")
                return result
            print("  Vision: GPT-4o — kein valides JSON, versuche Claude...")
        except Exception as exc:
            print(f"  Vision: GPT-4o fehlgeschlagen ({exc}), versuche Claude...")

    if ANTHROPIC_API_KEY:
        try:
            result = _call_anthropic_vision(image_path)
            if result:
                print("  Vision: Claude Haiku (Fallback) erfolgreich.")
                return result
        except Exception as exc:
            print(f"  Vision: Claude fehlgeschlagen ({exc}).")

    print("  FEHLER: Beide Vision-Provider fehlgeschlagen.")
    return None


# ── AI-Extraktion (OpenAI primär → Anthropic Fallback) ────────────────────────

def _build_prompt(pdf_text: str, filename: str) -> str:
    """PDF-Text-Prompt: shared Bon-Prompt + Python-Suffix + Rechnungstext."""
    return (
        BON_PROMPT
        + PYTHON_PROMPT_SUFFIX
        + f"\n\nDateiname: {filename}\nRechnungstext:\n{pdf_text[:8000]}"
    )


def _parse_ai_response(text: str) -> dict | None:
    match = re.search(r'\{[\s\S]*\}', text)
    if not match:
        return None
    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError:
        return None


def _call_openai(prompt: str) -> dict | None:
    body = json.dumps({
        "model": "gpt-4o-mini",
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 1024,
    }).encode()
    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {OPENAI_API_KEY}",
        }
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read())
    return _parse_ai_response(data["choices"][0]["message"]["content"])


def _call_anthropic(prompt: str) -> dict | None:
    import anthropic
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    message = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    )
    return _parse_ai_response(message.content[0].text)


def extract_with_ai(pdf_text: str, filename: str) -> dict | None:
    """OpenAI zuerst, Anthropic als Fallback. None wenn beide fehlschlagen."""
    prompt = _build_prompt(pdf_text, filename)

    if OPENAI_API_KEY:
        try:
            result = _call_openai(prompt)
            if result:
                print("  AI: OpenAI erfolgreich.")
                return result
            print("  AI: OpenAI — kein valides JSON, versuche Anthropic...")
        except Exception as exc:
            print(f"  AI: OpenAI fehlgeschlagen ({exc}), versuche Anthropic...")

    if ANTHROPIC_API_KEY:
        try:
            result = _call_anthropic(prompt)
            if result:
                print("  AI: Anthropic (Fallback) erfolgreich.")
                return result
        except Exception as exc:
            print(f"  AI: Anthropic fehlgeschlagen ({exc}).")

    print("  FEHLER: Beide AI-Provider fehlgeschlagen.")
    return None

# ── Firestore (get_firestore_db aus extract_verbund.py) ───────────────────────

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


def _tx_collection():
    """Gibt household/main/transactions zurück."""
    db = get_firestore_db()
    if not db:
        return None
    return (db.collection(FIRESTORE_HH_DOC[0])
              .document(FIRESTORE_HH_DOC[1])
              .collection(FIRESTORE_TX_SUBCOL))


def _pdf_doc_id(pdf_path: Path) -> str:
    """SHA256 der PDF-Bytes als Firestore-Dokument-ID (AI-unabhängig, deterministisch)."""
    return "pdf_" + hashlib.sha256(pdf_path.read_bytes()).hexdigest()[:20]


def is_duplicate(doc_id: str) -> bool:
    """Prüft ob Transaktion bereits in household/main/transactions existiert."""
    col = _tx_collection()
    if not col:
        return False
    return col.document(doc_id).get().exists


# Aliase aus alten AI-Outputs/Prompts → kanonische Subkategorie.
# JS-Seite hat diese in v1.3.2 dedup'd, Python hatte sie noch.
_SUBCAT_ALIASES = {
    "Brot & Backwaren": "Backwaren",
    "Hygiene":          "Hygiene & Drogerie",
    "Fleisch":          "Fleisch & Wurst",
    "Reis":             "Nudeln & Reis",
    "Süßwaren":         "Süßwaren / Naschen",
    "Fisch":            "Fisch / Meeresfrüchte",
}


def _normalize_subcategory(value: str) -> str:
    """Mappt Aliase auf kanonische Subkategorie. Fällt zurück auf 'Sonstiges'
    wenn der Wert weder kanonisch noch ein bekannter Alias ist."""
    v = (value or "").strip()
    if v in SUBCATEGORIES:
        return v
    if v in _SUBCAT_ALIASES:
        return _SUBCAT_ALIASES[v]
    return "Sonstiges"


def _ai_get(ai_data: dict, *keys: str, default=None):
    """Liest das erste vorhandene Feld in ai_data — für JS-Schema mit deutscher
    Fallback-Compat. Beispiel: _ai_get(d, 'store', 'absender')."""
    for k in keys:
        v = ai_data.get(k)
        if v not in (None, ""):
            return v
    return default


def save_to_firestore(ai_data: dict, filename: str, doc_id: str, is_new: bool = True) -> bool:
    """
    Transaktion unter household/main/transactions/{doc_id} speichern.

    Akzeptiert JS-Schema aus prompts/analyze-bon.md (store, date, total, items,
    subcategory) mit Fallback auf die alten deutschen Namen (absender,
    rechnungsdatum, betrag_brutto, positionen, kategorie). Damit auch
    historische AI-Outputs lesbar bleiben.
    """
    col = _tx_collection()
    if not col:
        print("  Firestore nicht verfügbar (FIREBASE_SERVICE_ACCOUNT fehlt).")
        return False

    # Nur Firmennamen, keine Adresse (Fallback-Cleanup falls AI es ignoriert)
    raw_store   = str(_ai_get(ai_data, "store", "absender", default=filename))
    # 1) Adresse abschneiden ("Billa AG, 1030 Wien" → "Billa AG")
    # 2) Auf bekannten Brand normalisieren ("Billa AG" → "Billa")
    description = _normalize_store(raw_store.split(",")[0].split("\n")[0].strip())

    date_val    = str(_ai_get(ai_data, "date", "rechnungsdatum", default=""))
    total_raw   = _ai_get(ai_data, "total", "betrag_brutto", default=0)
    try:
        total_val = abs(float(total_raw))
    except (TypeError, ValueError):
        total_val = 0.0

    items_list  = _ai_get(ai_data, "items", "positionen", default=[]) or []

    # Kategorie-Override: Vermieter (in unserem Fall Helvetia Versicherungen
    # AG als Hausverwalter, NICHT als Versicherer). Same Logik wie parser.js.
    # JS-Markdown-Prompt liefert kein "beschreibung"-Feld mehr — stattdessen
    # nutzen wir Store + ggf. rohen PDF-Text (via _raw_text vom Caller).
    landlord_text = " ".join([
        raw_store,
        str(ai_data.get("_raw_text") or ""),
        " ".join(str(p.get("name") or "") for p in items_list if isinstance(p, dict)),
    ])
    category = str(_ai_get(ai_data, "category", "kategorie", default="Sonstiges"))
    if (LANDLORD["vendor_pattern"].search(landlord_text)
            and LANDLORD["miete_keywords"].search(landlord_text)):
        category = "Wohnen / Miete"

    # Wiederkehrende Buchung erkennen (Netflix, Spotify, Allianz, Miete, ...).
    # Setzt isRecurring/recurringLabel — Browser-Dashboard zeigt sie dann in
    # der Fixkosten-Karte. Optional auch Kategorie-Override (siehe RECURRING_RULES).
    recurring = _match_recurring(description)
    if recurring and "category" in recurring:
        category = recurring["category"]

    # Konto aus Kartennummer auflösen
    card_last4 = str(ai_data.get("card_last4") or "").strip().lstrip("0") or None
    # Normalisieren: nur die letzten 4 Ziffern, führende Nullen behalten
    if card_last4:
        card_last4 = card_last4[-4:].zfill(4)
    account = CARD_ACCOUNT_MAP.get(card_last4, "unbekannt") if card_last4 else "unbekannt"
    if card_last4:
        print(f"  Karte: …{card_last4} → {account}")
    else:
        print("  Karte: nicht erkannt → account=unbekannt")

    # Einzelposten → bon.items (gleiche Struktur wie Bon-Analyzer im Browser)
    bon = None
    if items_list:
        bon = {
            "source": "gmail_import",
            "total":  total_val,
            "date":   date_val,
            "vendor": description,
            "items":  [
                {
                    "name":        p.get("name", ""),
                    "menge":       p.get("menge", 1),
                    "price":       float(p.get("gesamt") or p.get("einzelpreis") or 0),
                    "subcategory": _normalize_subcategory(
                        p.get("subcategory") or p.get("subkategorie") or "Sonstiges"
                    ),
                }
                for p in items_list if p.get("name")
            ],
        }

    tx = {
        "id":            doc_id,
        "date":          date_val,
        "amount":        -total_val,
        "description":   description,
        "category":      category,
        "account":       account,
        "card_last4":    card_last4,
        "aiCategorized": True,
        "source":        "gmail_import",
        "savedAt":       datetime.now().isoformat(),
        "savedBy":       "gmail_importer",
        "filename":      filename,
    }
    if recurring:
        tx["isRecurring"]    = True
        tx["recurringLabel"] = recurring["label"]
    if bon and bon["items"]:
        tx["bon"] = bon

    try:
        col.document(doc_id).set(tx)
        action = "geschrieben" if is_new else "aktualisiert"
        print(f"  Firestore: household/main/transactions/{doc_id} {action}.")
        return is_new
    except Exception as exc:
        print(f"  Firestore-Fehler: {exc}")
        return False

# ── Haupt-Orchestrierung ───────────────────────────────────────────────────────

def process_pdf(pdf_path: Path) -> bool:
    """PDF verarbeiten: Duplikat-Check → Text → AI → Firestore."""
    print(f"  Verarbeite PDF: {pdf_path.name}")

    # Dedup zuerst — doc_id ist deterministisch aus den PDF-Bytes, kein AI-Call
    # nötig um zu wissen ob wir das Dokument schon haben.
    doc_id = _pdf_doc_id(pdf_path)
    if is_duplicate(doc_id):
        print(f"  Übersprungen (Firestore-Duplikat): {doc_id}")
        return False

    text = extract_pdf_text(pdf_path)
    if not text.strip():
        print("  FEHLER: Kein Text im PDF gefunden.")
        return False

    ai_data = extract_with_ai(text, pdf_path.name)
    if not ai_data:
        print("  FEHLER: AI-Extraktion fehlgeschlagen.")
        return False

    # PDF-Rohtext für Kategorie-Override (Helvetia-Miete-Detection) durchreichen
    ai_data["_raw_text"] = text

    items_list = ai_data.get("items") or ai_data.get("positionen") or []
    items_info = f" · {len(items_list)} Positionen" if items_list else ""
    store      = ai_data.get("store") or ai_data.get("absender") or "?"
    total      = ai_data.get("total") or ai_data.get("betrag_brutto") or "?"
    date       = ai_data.get("date") or ai_data.get("rechnungsdatum") or "?"
    print(f"  Erkannt: {store} — {total} EUR — {date}{items_info}")

    return save_to_firestore(ai_data, pdf_path.name, doc_id)


def process_image(image_path: Path) -> bool:
    """Bild-Bon verarbeiten: Duplikat-Check → Vision-AI → Firestore."""
    print(f"  Verarbeite Bild: {image_path.name}")

    # Dedup zuerst — doc_id aus Bild-Bytes, gleiche Logik wie PDF.
    doc_id = "img_" + hashlib.sha256(image_path.read_bytes()).hexdigest()[:20]
    if is_duplicate(doc_id):
        print(f"  Übersprungen (Firestore-Duplikat): {doc_id}")
        return False

    ai_data = extract_image_with_ai(image_path)
    if not ai_data:
        print("  FEHLER: Vision-Extraktion fehlgeschlagen.")
        return False

    items_list = ai_data.get("items") or ai_data.get("positionen") or []
    items_info = f" · {len(items_list)} Positionen" if items_list else ""
    store      = ai_data.get("store") or ai_data.get("absender") or "?"
    total      = ai_data.get("total") or ai_data.get("betrag_brutto") or "?"
    date       = ai_data.get("date") or ai_data.get("rechnungsdatum") or "?"
    print(f"  Erkannt: {store} — {total} EUR — {date}{items_info}")

    return save_to_firestore(ai_data, image_path.name, doc_id)


def imap_connect() -> imaplib.IMAP4_SSL:
    """Baut IMAP-Verbindung auf und wählt das Label aus."""
    mail = imaplib.IMAP4_SSL("imap.gmail.com")
    mail.login(GMAIL_USER, GMAIL_APP_PASSWORD)
    status, _ = mail.select(f'"{GMAIL_LABEL}"')
    if status != "OK":
        raise RuntimeError(f"Label '{GMAIL_LABEL}' nicht gefunden.")
    return mail


def ensure_imap(mail: imaplib.IMAP4_SSL) -> imaplib.IMAP4_SSL:
    """Sendet NOOP; reconnectet bei toter Verbindung (Gmail timeout nach ~30 min)."""
    try:
        mail.noop()
        return mail
    except Exception:
        print("  [IMAP] Verbindung unterbrochen — reconnecte …")
        try:
            mail.shutdown()
        except Exception:
            pass
        return imap_connect()


def main() -> None:
    print(f"[{datetime.now():%Y-%m-%d %H:%M:%S}] gmail_finance_importer.py gestartet")

    if not GMAIL_APP_PASSWORD:
        print("FEHLER: GMAIL_APP_PASSWORD nicht gesetzt.")
        sys.exit(1)

    # IMAP-Verbindung
    try:
        mail = imap_connect()
    except imaplib.IMAP4.error as exc:
        print(f"FEHLER: Anmeldung fehlgeschlagen — {exc}")
        print("Tipp: App-Passwort prüfen und IMAP in Gmail aktivieren.")
        sys.exit(1)

    # Label auswählen (bereits in imap_connect erledigt; Fehler → Abbruch)
    status, _ = mail.select(f'"{GMAIL_LABEL}"')
    if status != "OK":
        print(f"FEHLER: Label '{GMAIL_LABEL}' nicht gefunden.")
        list_labels(mail)
        try:
            mail.logout()
        except Exception:
            pass
        sys.exit(1)

    # Mails der letzten 30 Tage suchen (SEIT-Filter statt UNSEEN)
    # Damit teilen sich beide Skripte (gmail-pdf-sync + dieses) dasselbe
    # "Rechnungen"-Label ohne Konflikt — das Seen-Flag wird nicht verändert,
    # Duplikate werden über Firestore-IDs verhindert.
    since_date = (datetime.now() - timedelta(days=30)).strftime("%d-%b-%Y")
    _, msg_ids_raw = mail.search(None, f"SINCE {since_date}")
    msg_ids = msg_ids_raw[0].split()

    if not msg_ids:
        print("Keine E-Mails in den letzten 30 Tagen gefunden.")
        mail.logout()
        return

    print(f"{len(msg_ids)} E-Mail(s) im Label '{GMAIL_LABEL}' (letzte 30 Tage).")
    processed = 0
    saved = 0

    for msg_id in msg_ids:
        print(f"\nVerarbeite E-Mail ID {msg_id.decode()} …")
        mail = ensure_imap(mail)
        attachments = download_attachments(mail, msg_id)

        if not attachments:
            print("  Keine Anhänge (PDF oder Bild).")
        else:
            for path in attachments:
                processed += 1
                suffix = path.suffix.lower()
                if suffix == ".pdf":
                    if process_pdf(path):
                        saved += 1
                elif suffix in IMAGE_EXTENSIONS:
                    if process_image(path):
                        saved += 1
                else:
                    print(f"  Unbekannter Typ, übersprungen: {path.name}")

        # Seen-Flag absichtlich NICHT setzen — gmail-pdf-sync verwaltet das

    try:
        mail.logout()
    except Exception:
        pass
    print(f"\nFertig: {processed} Anhang/Anhänge verarbeitet, {saved} in Firestore gespeichert.")
    print(f"Temp-Verzeichnis: {PDF_TEMP_DIR}  (für Debugging behalten)")


if __name__ == "__main__":
    main()
