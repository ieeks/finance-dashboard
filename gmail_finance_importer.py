#!/usr/bin/env python3
"""
gmail_finance_importer.py — PDF- & Bild-Rechnungen aus Gmail → Firestore (finance-dashboard)

Ablauf:
  1. IMAP: Mails im Label "Rechnungen" abholen, PDF- und Bild-Anhänge speichern
  2a. PDF: pdfplumber → Text extrahieren
  2b. Bild (PNG/JPG): Base64 → Claude Haiku 5.5 Vision → strukturierte Daten
  3. AI: Claude Haiku 5.5 (primär) → OpenAI gpt-4o-mini/gpt-4o (Fallback)
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
import math
import unicodedata
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
    "0678": "haushalt",       # Olga Debit Mastercard (Easybank Haushalt)
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
    "Nudeln & Reis", "Restaurant", "Öl", "Aufstriche & Butter",
    "Gewürze & Saucen", "Konserven", "Tiefkühl", "Hygiene & Drogerie",
    "Putzmittel", "Pfand", "Elektronik", "Dienstleistung", "Sonstiges",
    "Spielzeug & Freizeitartikel",
    "Haushalt & Garten",
    "Knabberartikel, Nüsse & Kerne",
    "Eier",
    "Frühstück & Backzutaten",
    "Blumen & Pflanzen",
    "Sportnahrung & Nahrungsergänzung",

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

# E-Auto laden → "Mobilität / Auto", nicht "Energie / Strom".
# Die AI hat Ladestrom-Rechnungen mal als "Energie / Strom", mal als
# "Sonstiges" einsortiert (drei Tesla-Rechnungen, zwei Kategorien). Laden ist
# aber das Pendant zum Tanken; "Energie / Strom" ist der Haushaltsstrom.
# Die Marker sind bewusst ladespezifisch — "kWh" allein würde jede
# Stromrechnung (VERBUND) mitnehmen.
CHARGING_KEYWORDS_RE = re.compile(
    r"supercharger|ladestation|ladepunkt|ladevorgang|ladestrom|ladeentgelt|"
    r"charging|charge\s*point|wallbox|ionity|smatrics",
    re.I,
)

# Wiederkehrende Buchungen — sync mit RECURRING_RULES in js/categories.js.
# isRecurring=True erlaubt es dem Browser-Dashboard die Tx in der
# "Fixkosten"-Karte zu zeigen (renderFixkosten in app.js).
RECURRING_RULES: list[dict] = [
    {"pattern": re.compile(
        rf"Miete / Hausverwaltung|{LANDLORD['vendor_pattern'].pattern}", re.I),
     "label": "Miete"},
    {"pattern": re.compile(r"T-Mobile Austria", re.I),
     "label": "T-Mobile",              "category": "Telekommunikation",
     "account": "haushalt"},
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
  Hinweis: Das Laden eines E-Autos (Supercharger, Ladestation, Ladestrom)
  gehört zu "Mobilität / Auto" — es ist das Pendant zum Tanken.
  "Energie / Strom" ist ausschließlich der Haushaltsstrom.
"""


def _date_anchor(today: str | None = None) -> str:
    """Referenzdatum für die AI — ohne Heute-Bezug kann das Modell nicht merken,
    dass es ein Kaufdatum in der Zukunft gelesen hat (siehe analyze-bon.md)."""
    today = today or datetime.now().strftime("%Y-%m-%d")
    return (
        f"\n\nHeutiges Datum (Referenz): {today}\n"
        "Das Rechnungs-/Kaufdatum (`date`) liegt IMMER an oder vor diesem Tag.\n"
        "(Nur `debit_date` darf in der Zukunft liegen.)"
    )

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

# Never truncate invoice text. Large documents take the native PDF route.
PDF_TEXT_MAX_CHARS = 100_000
PDF_MAX_OUTPUT_TOKENS = 12_000
HAIKU_MODEL = "claude-haiku-5-5"
HAIKU_MAX_OUTPUT_TOKENS = 20_000  # newer tokenizer + adaptive thinking need extra room
PDF_VISUAL_MAX_BYTES = 20 * 1024 * 1024  # leaves room for base64 in Claude's 32 MB request


def _pdf_page_needs_visual(text: str, has_images: bool = False) -> bool:
    meaningful = sum(char.isalnum() for char in text)
    return meaningful < 40 or (has_images and meaningful < 200) or "\ufffd" in text


def inspect_pdf_text(pdf_path: Path) -> tuple[str, list[str]]:
    """Read every page; detect empty/low-text pages in otherwise readable PDFs."""
    pages, issues = [], []
    with pdfplumber.open(pdf_path) as pdf:
        for index, page in enumerate(pdf.pages, 1):
            text = page.extract_text() or ""
            pages.append(text)
            if _pdf_page_needs_visual(text, bool(page.images)):
                issues.append(f"Seite {index}: Text fehlt oder ist möglicherweise unvollständig")
    return "\n".join(pages), issues


def extract_pdf_text(pdf_path: Path) -> str:
    """Compatibility helper: full text from every page."""
    return inspect_pdf_text(pdf_path)[0]


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
                {"type": "text", "text": VISION_PROMPT + _date_anchor()},
            ],
        }],
        "max_tokens": 4096,
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
    return _parse_ai_response(data["choices"][0]["message"]["content"], provider="OpenAI Vision")


def _call_anthropic_vision(image_path: Path) -> dict | None:
    import anthropic
    b64, mime = _image_to_base64(image_path)
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    message = client.messages.create(
        model=HAIKU_MODEL,
        max_tokens=HAIKU_MAX_OUTPUT_TOKENS,
        thinking={"type": "adaptive"},
        output_config={"effort": "low"},
        system=VISION_SYSTEM,
        messages=[{
            "role": "user",
            "content": [
                {"type": "image",
                 "source": {"type": "base64", "media_type": mime, "data": b64}},
                {"type": "text", "text": VISION_PROMPT + _date_anchor()},
            ],
        }],
    )
    return _anthropic_pdf_response(message)


def extract_image_with_ai(image_path: Path) -> dict | None:
    """Claude Haiku 5.5 first; GPT-4o fallback when unavailable or incomplete."""
    for provider, key, call in [
        ("Claude Haiku 5.5 Vision", ANTHROPIC_API_KEY, _call_anthropic_vision),
        ("OpenAI Vision", OPENAI_API_KEY, _call_openai_vision),
    ]:
        if not key:
            continue
        try:
            result = call(image_path)
            if result:
                print(f"  Vision: {provider} erfolgreich.")
                return result
        except Exception as exc:
            print(f"  Vision: {provider} fehlgeschlagen ({exc}).")
    print("  FEHLER: Beide Vision-Provider fehlgeschlagen.")
    return None


# ── AI-Extraktion (Haiku 5.5 primär → OpenAI Fallback) ────────────────────────

def _build_prompt(pdf_text: str, filename: str) -> str:
    """PDF-Text-Prompt: shared Bon-Prompt + Python-Suffix + Rechnungstext."""
    if len(pdf_text) > PDF_TEXT_MAX_CHARS:
        raise ValueError("PDF-Text zu lang für den Textweg; Original-PDF verwenden")
    return (
        BON_PROMPT
        + PYTHON_PROMPT_SUFFIX
        + _date_anchor()
        + f"\n\nDateiname: {filename}\nRechnungstext:\n{pdf_text}"
    )


def _parse_ai_response(text: str, provider: str = "") -> dict | None:
    match = re.search(r'\{[\s\S]*\}', text)
    if not match:
        snippet = (text or "")[:200].replace("\n", " ")
        print(f"  AI {provider}: keine '{{...}}' in Antwort — Snippet: {snippet}")
        return None
    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError as exc:
        snippet = match.group(0)[:200].replace("\n", " ")
        print(f"  AI {provider}: JSON-Decode-Fehler ({exc}) — Snippet: {snippet}")
        return None


def _openai_pdf_response(data: dict) -> dict | None:
    choice = data["choices"][0]
    if choice.get("finish_reason") != "stop":
        print("  PDF: OpenAI-Antwort unvollständig oder abgelehnt")
        return None
    return _parse_ai_response(choice["message"].get("content") or "", provider="OpenAI PDF")


def _anthropic_pdf_response(message) -> dict | None:
    if message.stop_reason != "end_turn":
        print("  PDF: Claude-Antwort unvollständig oder abgelehnt")
        return None
    text = "\n".join(block.text for block in message.content if block.type == "text")
    return _parse_ai_response(text, provider="Claude PDF")


def _call_openai(prompt: str) -> dict | None:
    body = json.dumps({
        "model": "gpt-4o-mini",
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": PDF_MAX_OUTPUT_TOKENS,
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
    return _openai_pdf_response(data)


def _call_anthropic(prompt: str) -> dict | None:
    import anthropic
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    message = client.messages.create(
        model=HAIKU_MODEL,
        max_tokens=HAIKU_MAX_OUTPUT_TOKENS,
        thinking={"type": "adaptive"},
        output_config={"effort": "low"},
        messages=[{"role": "user", "content": prompt}],
    )
    return _anthropic_pdf_response(message)


def extract_with_ai(pdf_text: str, filename: str) -> dict | None:
    """Haiku 5.5 first, OpenAI as fallback. PDF validation follows separately."""
    prompt = _build_prompt(pdf_text, filename)
    for provider, key, call in [
        ("Claude Haiku 5.5", ANTHROPIC_API_KEY, _call_anthropic),
        ("OpenAI", OPENAI_API_KEY, _call_openai),
    ]:
        if not key:
            continue
        try:
            result = call(prompt)
            if result:
                print(f"  AI: {provider} erfolgreich.")
                return result
        except Exception as exc:
            print(f"  AI: {provider} fehlgeschlagen ({exc}).")
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


def _is_semantic_duplicate(
    existing: list[dict], description: str, date_val: str, total_val: float, account: str
) -> bool:
    """Fallback-Dedup für erneut verschickte digitale Kassenbons.

    Manche Händler (z.B. Billa) senden denselben Kauf gelegentlich als zwei
    technisch unterschiedliche PDFs (abweichende Erzeugungs-Metadaten) —
    der Byte-Hash in _pdf_doc_id()/is_duplicate() erkennt das dann nicht.
    Prüft stattdessen auf Store+Datum+Betrag+Konto-Übereinstimmung gegen
    bereits importierte Gmail-Rechnungen.
    """
    for doc in existing:
        if (doc.get("description") == description
                and doc.get("date") == date_val
                and doc.get("account") == account
                and abs(abs(doc.get("amount", 0)) - total_val) < 0.005):
            return True
    return False


# ── Vorab-Dedup (VOR dem AI-Call) ─────────────────────────────────────────────
# Der Byte-Hash-Dedup (_pdf_doc_id/is_duplicate) fängt nur identische PDF-Bytes.
# Re-gesendete Bons (Billa/Spar) kommen aber als byte-verschiedene PDFs → jeder
# Lauf würde erneut einen (teuren) AI-Call zahlen, nur um das Ergebnis danach in
# _is_semantic_duplicate() wieder zu verwerfen. Um das zu vermeiden, ziehen wir
# Datum + Summe direkt aus dem PDF-Rohtext (Regex, kein AI) und prüfen gegen
# bereits importierte Gmail-Buchungen. Trifft nichts → regulärer AI-Pfad läuft
# inkl. Post-AI-Semantik-Dedup als Sicherheitsnetz.

# Beträge wie "46,09", "1.234,56", "1 234,56" oder "46.09" (2 Nachkommastellen).
_AMOUNT_RE = re.compile(r"\d{1,3}(?:[.\s]\d{3})*[.,]\d{2}|\d+[.,]\d{2}")

# Zeilen-Marker die eine Rechnungssumme einleiten (bewusst spezifisch, kein
# nacktes "Betrag" → sonst würden MwSt-/Zwischenbeträge zu Kandidaten).
_TOTAL_KEYWORDS_RE = re.compile(
    r"summe|gesamt|zu\s*zahlen|zahlbetrag|rechnungsbetrag|endbetrag|total",
    re.IGNORECASE,
)

_DATE_DMY_RE = re.compile(r"\b(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})\b")
_DATE_ISO_RE = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")


def _parse_amount(raw: str) -> float | None:
    """'1.234,56' → 1234.56 · '46,09' → 46.09 · '46.09' → 46.09."""
    s = raw.strip().replace(" ", "")
    if "." in s and "," in s:        # deutsches Format: Punkt=Tausender, Komma=Dezimal
        s = s.replace(".", "").replace(",", ".")
    elif "," in s:
        s = s.replace(",", ".")
    try:
        return round(float(s), 2)
    except ValueError:
        return None


def _extract_total_candidates(text: str) -> list[float]:
    """Mögliche Rechnungssummen aus PDF-Text: Beträge auf Summen-Zeilen plus der
    größte Betrag im Dokument (bei Kassenbons fast immer die Endsumme)."""
    if not text:
        return []
    cands: set[float] = set()
    all_amounts: list[float] = []
    for line in text.splitlines():
        amounts = [a for a in (_parse_amount(m) for m in _AMOUNT_RE.findall(line))
                   if a is not None]
        all_amounts.extend(amounts)
        if _TOTAL_KEYWORDS_RE.search(line):
            cands.update(amounts)
    if all_amounts:
        cands.add(max(all_amounts))
    return sorted(cands)


def _extract_date_candidates(text: str) -> list[str]:
    """Datums-Kandidaten als ISO-Strings (yyyy-mm-dd) — deckt dd.mm.yyyy,
    dd/mm/yyyy, dd-mm-yyyy und bereits-ISO ab. So wie die AI 'date' liefert."""
    if not text:
        return []
    out: set[str] = set()
    for d, m, y in _DATE_DMY_RE.findall(text):
        di, mi = int(d), int(m)
        if 1 <= mi <= 12 and 1 <= di <= 31:
            out.add(f"{int(y):04d}-{mi:02d}-{di:02d}")
    for y, m, d in _DATE_ISO_RE.findall(text):
        mi, di = int(m), int(d)
        if 1 <= mi <= 12 and 1 <= di <= 31:
            out.add(f"{int(y):04d}-{mi:02d}-{di:02d}")
    return sorted(out)


# ── Netto-Falle: Endbetrag statt Positionssumme ──────────────────────────────
# Rechnungen im Firmen-Layout (Tesla-Ladestrom, Handwerker, Hosting) weisen die
# Positionen NETTO aus und schlagen die USt. erst darunter auf. Die Summen-
# Konsistenzregel im Bon-Prompt ("Σ items == total") zieht `total` dann auf die
# Nettosumme — bei Tesla 17,67 statt 21,20. Die Bank-Buchung lautet aber auf den
# Bruttobetrag, und der Matcher (js/matcher.js) wirft alles über 2 € Differenz
# hart raus → der Bon wird nie verknüpft.
# Der Prompt kennt den Fall inzwischen, ist aber probabilistisch (gpt-4o-mini).
# Deshalb hier zusätzlich eine deterministische Korrektur aus dem PDF-Rohtext.

# Zeilen, die den tatsächlich zu zahlenden Endbetrag tragen. Bewusst enger als
# _TOTAL_KEYWORDS_RE: "Teilsumme"/"Zwischensumme" (netto) und "Gesamtsumme
# Steuern" (nur die Steuer) dürfen hier NICHT treffen — beide stehen auf der
# Tesla-Rechnung direkt neben dem echten "Gesamtbetrag". Deshalb trägt
# "gesamtsumme" einen Negative-Lookahead statt zu fehlen: Energieversorger
# (VERBUND) beschriften ihre Endsumme genau so.
_GROSS_TOTAL_RE = re.compile(
    r"gesamtbetrag|gesamtsumme(?!\s*steuern)|zu\s*(?:zahlen|bezahlen)|"
    r"zahlbetrag|zahlungsbetrag|rechnungsbetrag|rechnungssumme|endbetrag|"
    r"bruttobetrag|bruttosumme|summe\s+(?:inkl|brutto)|"
    r"einzugsbetrag|abbuchungsbetrag",
    re.IGNORECASE,
)

# USt.-Sätze AT (20/13/10) + DE (19/7). Der Aufschlag muss exakt einem davon
# entsprechen — das macht einen Zufallstreffer praktisch unmöglich.
_VAT_RATES = (0.20, 0.19, 0.13, 0.10, 0.07)


def _finite_amount(value) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (TypeError, ValueError, OverflowError):
        return None


def _item_amount(item: dict) -> float | None:
    for key in ("gesamt", "price", "einzelpreis"):
        if item.get(key) is not None:
            return _finite_amount(item[key])
    return None


def _items_sum(items_list: list) -> float:
    return round(sum(_item_amount(p) or 0 for p in items_list if isinstance(p, dict)), 2)


def _gross_total_correction(
    text: str, total: float, items_sum: float
) -> tuple[float, float] | None:
    """Korrigiert ein auf die Nettosumme gezogenes `total` auf den Bruttobetrag.

    Greift nur bei einem in sich konsistenten Netto-Ergebnis (Positionen == total)
    und nur wenn im Rohtext eine explizit als Endbetrag markierte Zeile einen
    größeren Betrag trägt, dessen Differenz exakt einem USt.-Satz entspricht.

    Returns (brutto, vat) oder None wenn nichts sicher korrigierbar ist.
    """
    if not text or not (total > 0) or not (items_sum > 0):
        return None
    # Nur wenn die AI ein konsistentes Netto-Paar geliefert hat. Weichen
    # Positionen und total ohnehin ab, ist die Extraktion anders kaputt —
    # dann raten wir hier nichts dazu.
    if abs(items_sum - total) >= 0.01:
        return None
    for line in text.splitlines():
        if not _GROSS_TOTAL_RE.search(line):
            continue
        for raw in _AMOUNT_RE.findall(line):
            cand = _parse_amount(raw)
            if cand is None or cand <= total:
                continue
            vat = round(cand - total, 2)
            if any(abs(vat - round(total * r, 2)) <= 0.02 for r in _VAT_RATES):
                return cand, vat
    return None


def _future_date_correction(
    text: str, date_val: str, today: str
) -> str | None:
    """Korrigiert ein `date`, das nach heute liegt — ein Kauf-/Rechnungsdatum
    kann das nie sein (nur `debit_date` darf in der Zukunft liegen).

    Gegenstück zu `_gross_total_correction`: der Prompt kennt die Regel, ist aber
    probabilistisch. Aus dem Rohtext wird das jüngste Datum genommen, das nicht
    in der Zukunft liegt — auf einem Beleg ist das praktisch immer das
    Rechnungsdatum (ältere Daten wären Liefer-/Leistungszeitraum).

    Returns das korrigierte ISO-Datum oder None, wenn nichts sicher belegt ist.
    """
    if not text or not date_val or date_val <= today:
        return None
    past = [d for d in _extract_date_candidates(text) if d <= today]
    return max(past) if past else None


def _prefilter_semantic_hit(
    existing: list[dict], text: str,
    date_candidates: list[str], total_candidates: list[float],
) -> dict | None:
    """Sucht in bereits importierten Gmail-Buchungen einen Treffer, der zum
    PDF-Text passt: Datum ∈ Kandidaten, Betrag ∈ Kandidaten (±0,5 ct) UND der
    gespeicherte Händlername steht als Substring im Rohtext. Die drei Signale
    zusammen machen einen falschen Treffer praktisch aus (Hinweis: Konto wird
    hier — anders als _is_semantic_duplicate — nicht geprüft, da es erst aus dem
    AI-Ergebnis kommt; identischer Cent-Betrag beim selben Händler am selben Tag
    über zwei Karten wäre nötig, um daneben zu greifen)."""
    if not existing or not date_candidates or not total_candidates:
        return None
    tl    = (text or "").lower()
    dates = set(date_candidates)
    for doc in existing:
        if doc.get("date") not in dates:
            continue
        desc = str(doc.get("description") or "").strip()
        if not desc or desc.lower() not in tl:
            continue
        amt = abs(doc.get("amount", 0) or 0)
        if any(abs(amt - t) < 0.005 for t in total_candidates):
            return doc
    return None


# Aliase aus alten AI-Outputs/Prompts → kanonische Subkategorie.
# JS-Seite hat diese in v1.3.2 dedup'd, Python hatte sie noch.
_SUBCAT_ALIASES = {
    "Brot & Backwaren": "Backwaren",
    "Hygiene":          "Hygiene & Drogerie",
    "Fleisch":          "Fleisch & Wurst",
    "Reis":             "Nudeln & Reis",
    "Süßwaren":         "Süßwaren / Naschen",
    "Fisch":            "Fisch / Meeresfrüchte",
    "Restaurant / Gericht": "Restaurant",
    "Milchprodukte / Käse": "Milchprodukte",
    "Käse": "Milchprodukte",
    "Waschmittel": "Putzmittel",
    "Reinigungsmittel": "Putzmittel",
    "Tiefkühlprodukte": "Tiefkühl",
    "Tiefkühlkost": "Tiefkühl",
    "Süßigkeiten": "Süßwaren / Naschen",
    "Körperpflege": "Hygiene & Drogerie",
    "Spielzeug": "Spielzeug & Freizeitartikel",
    "Haushalt": "Haushalt & Garten",
    "Salzige Snacks & Nüsse": "Knabberartikel, Nüsse & Kerne",
    "Frühstück & Cerealien": "Frühstück & Backzutaten",
    "Backzutaten": "Frühstück & Backzutaten",
    "Blumen": "Blumen & Pflanzen",
    "Sportnahrung": "Sportnahrung & Nahrungsergänzung",

}


# Keep these rules in sync with SUBCAT_ITEM_RULES in js/categories.js.
_SUBCAT_ITEM_RULES = [['(^| )(wasserpistole|water blaster|.*x-shot water blaster)( |$)', 'Spielzeug & Freizeitartikel'],
 ['(^| )(intex aufblasbares krokodil|pool lizenz 3-ringe)( |$)', 'Spielzeug & Freizeitartikel'],
 ['(kissenbox|aufbewahrbox|aufbewahrungsbox|kühlschrankbox|outdoor-matte)', 'Haushalt & Garten'],
 ['(^| )(soletti|lays|lay.s chips|sonnenblumenkerne|maiswaffel)( |$)',
  'Knabberartikel, Nüsse & Kerne'],
 ['(^| )(eier)( |$)', 'Eier'],
 ['(krispies chocos|feinkristallzucker|haferflocken|backpulver)', 'Frühstück & Backzutaten'],
 ['(^| )(pfingstrosen|schnittblumen)( |$)', 'Blumen & Pflanzen'],
 ['(^| )(esn isoclear|whey protein|proteinpulver)( |$)', 'Sportnahrung & Nahrungsergänzung'],
 ['(^| )(gouda|burrata|burra)( |$)', 'Milchprodukte'],
 ['(guacamole|argeta thunfisch|rama mit butter|phil\\. natur|everything bagel dip|everthing bagel '
  'dip)',
  'Aufstriche & Butter'],
 ['(^| )(cornetto|eskimo cornetto|magnum mini|magnum mandel|magnum sandwich|iglo rösti|milka choc '
  'topped cone)( |$)',
  'Tiefkühl'],
 ['(bahlsen leibniz|bahl\\.pick up|kinder choco fresh|götterspeise|goetterspeise|kidsworld '
  'dessert|protein mousse|gefüllte frischeiwaffeln)',
  'Süßwaren / Naschen'],
 ['(persil waschmittel|dr\\. beckmann frischeduft)', 'Putzmittel'],
 ['(^| )(axe dusche)( |$)', 'Hygiene & Drogerie'],
 ['(maggi fix|dress\\. prem)', 'Gewürze & Saucen'],
 ['(^| )(barilla mini rigate)( |$)', 'Nudeln & Reis'],
 ['(genusswelt shi?itake|dkih erdbeeren)', 'Obst & Gemüse'],
 ['(^| )(riesenbohnen in tomatensauce)( |$)', 'Konserven'],
 ['(ölz italian sandwich|laugencroissant mit schin)', 'Backwaren']]


def _category_key(value):
    v = unicodedata.normalize("NFKC", str(value or "")).lower().strip()
    return re.sub(r"\s+", " ", re.sub(r"\s*([/&])\s*", r"\1", v))


def _normalize_subcategory(value: str) -> str:
    """Normalize known labels; never discard an unknown AI label."""
    v = str(value or "").strip()
    key = _category_key(v)
    for category in SUBCATEGORIES:
        if _category_key(category) == key:
            return category
    for alias, category in _SUBCAT_ALIASES.items():
        if _category_key(alias) == key:
            return category
    return v or "Sonstiges"


def _item_category_fields(item):
    raw = item.get("subcategory") or item.get("subkategorie") or "Sonstiges"
    category = _normalize_subcategory(raw)
    source = "ai"
    if category == "Sonstiges" or category not in SUBCATEGORIES:
        name = unicodedata.normalize("NFKC", str(item.get("name") or "")).lower().strip()
        name = re.sub(r"^[\s@*]+", "", name)
        name = re.sub(r"\s+", " ", name)
        for pattern, target in _SUBCAT_ITEM_RULES:
            if re.search(pattern, name):
                category, source = target, "rule"
                break
    return {"subcategory": category, "subcategoryRaw": raw,
            "subcategorySource": source,
            "subcategoryNeedsReview": category == "Sonstiges" or category not in SUBCATEGORIES}


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
    # Abbuchungsdatum bei Lastschrift (VERBUND zieht ~4 Wochen nach Rechnungs-
    # datum ein). Der Matcher prüft beide Daten — ohne das fällt die Buchung
    # aus dem 7-Tage-Fenster in js/matcher.js und wird nie verknüpft.
    debit_val   = str(_ai_get(ai_data, "debit_date", "abbuchungsdatum",
                              "faelligkeit", default="") or "")
    if not _DATE_ISO_RE.fullmatch(debit_val):
        debit_val = ""
    total_raw   = _ai_get(ai_data, "total", "betrag_brutto", default=0)
    try:
        total_val = abs(float(total_raw))
    except (TypeError, ValueError):
        total_val = 0.0

    # USt., die auf die Positionen aufgeschlagen wird (Netto-Layout, siehe
    # _gross_total_correction). Bei Kassenbons 0 — dort sind die Preise brutto.
    try:
        vat_val = abs(float(_ai_get(ai_data, "vat", "ust", "mwst", default=0) or 0))
    except (TypeError, ValueError):
        vat_val = 0.0

    items_list  = _ai_get(ai_data, "items", "positionen", default=[]) or []

    # Kategorie-Override: Vermieter (in unserem Fall Helvetia Versicherungen
    # AG als Hausverwalter, NICHT als Versicherer). Same Logik wie parser.js.
    # JS-Markdown-Prompt liefert kein "beschreibung"-Feld mehr — stattdessen
    # nutzen wir Store + ggf. rohen PDF-Text (via _raw_text vom Caller).
    doc_text = " ".join([
        raw_store,
        str(ai_data.get("_raw_text") or ""),
        " ".join(str(p.get("name") or "") for p in items_list if isinstance(p, dict)),
    ])
    category = str(_ai_get(ai_data, "category", "kategorie", default="Sonstiges"))
    if (LANDLORD["vendor_pattern"].search(doc_text)
            and LANDLORD["miete_keywords"].search(doc_text)):
        category = "Wohnen / Miete"

    # Ladestrom fürs Auto → Mobilität / Auto (siehe CHARGING_KEYWORDS_RE).
    # Steht nach dem Vermieter-Override, weil sich beide nie überschneiden.
    if CHARGING_KEYWORDS_RE.search(doc_text):
        category = "Mobilität / Auto"

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

    # Fallback: IBAN aus Rechnung (Lastschrift-Rechnungen wie T-Mobile)
    if account == "unbekannt":
        iban_raw = str(ai_data.get("iban") or "").strip().replace(" ", "").upper()
        if iban_raw:
            iban_suffix = iban_raw[-4:]
            account = CARD_ACCOUNT_MAP.get(iban_suffix, "unbekannt")
            if account != "unbekannt":
                print(f"  IBAN: …{iban_suffix} → {account}")

    # Fallback: Konto aus RECURRING_RULES (z.B. T-Mobile → haushalt)
    if account == "unbekannt" and recurring and "account" in recurring:
        account = recurring["account"]
        print(f"  Konto aus Recurring-Regel: {recurring['label']} → {account}")

    if card_last4:
        print(f"  Karte: …{card_last4} → {account}")
    elif account == "unbekannt":
        print("  Karte: nicht erkannt → account=unbekannt")

    # Fallback-Dedup gegen erneut verschickte digitale Kassenbons (siehe
    # _is_semantic_duplicate) — Byte-Hash-Dedup oben greift nur bei
    # identischen PDF-Bytes, nicht bei inhaltlich gleichen Re-Sends.
    try:
        existing = [d.to_dict() for d in col.where("source", "==", "gmail_import")
                                             .where("date", "==", date_val)
                                             .stream()]
    except Exception as exc:
        print(f"  Semantik-Dedup-Check fehlgeschlagen: {exc}")
        existing = []
    if _is_semantic_duplicate(existing, description, date_val, total_val, account):
        print(f"  Übersprungen (inhaltliches Duplikat): {description} · {date_val} · {total_val} EUR · {account}")
        return False

    # Einzelposten → bon.items (gleiche Struktur wie Bon-Analyzer im Browser)
    bon = None
    if items_list:
        bon = {
            "source":    "gmail_import",
            "total":     total_val,
            "vat":       vat_val,
            "date":      date_val,
            "debitDate": debit_val or None,
            "vendor":    description,
            "items":  [
                {
                    "name":        p.get("name", ""),
                    "menge":       p.get("menge", 1),
                    "price":       _item_amount(p) or 0.0,
                    **_item_category_fields(p),
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
    if debit_val:
        tx["debitDate"] = debit_val
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

# ── PDF-OCR Fallback via Claude native PDF-Support ────────────────────────────

def extract_pdf_with_claude_ocr(pdf_path: Path) -> dict | None:
    """Send all PDF pages (including images) to Claude, without local text truncation."""
    import anthropic
    b64 = base64.b64encode(pdf_path.read_bytes()).decode("utf-8")
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    message = client.messages.create(
        model=HAIKU_MODEL,
        max_tokens=HAIKU_MAX_OUTPUT_TOKENS,
        thinking={"type": "adaptive"},
        output_config={"effort": "low"},
        system=VISION_SYSTEM,
        messages=[{"role": "user", "content": [
            {"type": "document", "source": {"type": "base64",
                "media_type": "application/pdf", "data": b64}},
            {"type": "text", "text": BON_PROMPT + PYTHON_PROMPT_SUFFIX + _date_anchor()},
        ]}],
    )
    return _anthropic_pdf_response(message)


def extract_pdf_with_openai(pdf_path: Path) -> dict | None:
    """Native PDF input also works when only the OpenAI key is configured."""
    b64 = base64.b64encode(pdf_path.read_bytes()).decode("utf-8")
    body = json.dumps({
        "model": "gpt-4o",
        "max_tokens": PDF_MAX_OUTPUT_TOKENS,
        "messages": [{"role": "user", "content": [
            {"type": "file", "file": {"filename": pdf_path.name,
                "file_data": f"data:application/pdf;base64,{b64}"}},
            {"type": "text", "text": BON_PROMPT + PYTHON_PROMPT_SUFFIX + _date_anchor()},
        ]}],
    }).encode()
    req = urllib.request.Request("https://api.openai.com/v1/chat/completions", data=body,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {OPENAI_API_KEY}"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.loads(resp.read())
    return _openai_pdf_response(data)


def _prepare_pdf_result(data, text: str):
    """Apply existing evidence-based corrections BEFORE consistency validation."""
    if not isinstance(data, dict):
        return data
    result = dict(data)
    items = _ai_get(result, "items", "positionen", default=[])
    total = _finite_amount(_ai_get(result, "total", "betrag_brutto"))
    if total is not None and isinstance(items, list):
        correction = _gross_total_correction(text, total, _items_sum(items))
        if correction:
            result["total"], result["vat"] = correction
    date = str(_ai_get(result, "date", "rechnungsdatum", default=""))
    fixed = _future_date_correction(text, date, datetime.now().strftime("%Y-%m-%d"))
    if fixed:
        result["date"] = fixed
    return result


def _pdf_validation_issues(data, text: str = "") -> list[str]:
    """Validate fields and the prompt's arithmetic contract; never repair by guessing."""
    if not isinstance(data, dict):
        return ["Kein gültiges Rechnungsobjekt"]
    issues = []
    store = _ai_get(data, "store", "absender")
    if not isinstance(store, str) or not store.strip():
        issues.append("Händler fehlt")
    date = _ai_get(data, "date", "rechnungsdatum")
    try:
        if not isinstance(date, str) or not _DATE_ISO_RE.fullmatch(date):
            raise ValueError()
        parsed = datetime.strptime(date, "%Y-%m-%d")
        if parsed.date() > datetime.now().date():
            raise ValueError()
    except ValueError:
        issues.append("Rechnungsdatum fehlt, ist ungültig oder liegt in der Zukunft")
    total = _finite_amount(_ai_get(data, "total", "betrag_brutto"))
    vat = _finite_amount(_ai_get(data, "vat", "ust", "mwst", default=0))
    tip = _finite_amount(data.get("tip", 0))
    if total is None or total < 0:
        issues.append("Endbetrag fehlt oder ist ungültig")
    if vat is None or vat < 0 or (total is not None and vat > total):
        issues.append("Steueraufschlag ist ungültig")
    if tip is None or tip < 0:
        issues.append("Trinkgeld ist ungültig")
    if data.get("currency", "EUR") != "EUR":
        issues.append("Währung ist nicht EUR; keine automatische Umrechnung")
    # Only compare unambiguous, explicitly labelled gross totals. Never infer
    # a final amount from a subtotal, VAT table or several competing amounts.
    evidence = set()
    for line in text.splitlines():
        if _GROSS_TOTAL_RE.search(line) and not re.search(r"netto|teilsumme|zwischensumme", line, re.I):
            evidence.update(round(amount, 2) for raw in _AMOUNT_RE.findall(line)
                            if (amount := _parse_amount(raw)) is not None)
    if len(evidence) == 1 and total is not None and tip is not None:
        observed = next(iter(evidence))
        if round(min(abs(observed - total), abs(observed - total - tip)), 2) > 0.02:
            issues.append("Endbetrag widerspricht dem ausdrücklich ausgewiesenen PDF-Betrag")
    items = _ai_get(data, "items", "positionen")
    if not isinstance(items, list):
        issues.append("Positionsliste fehlt oder ist ungültig")
    elif not items:
        # No invented items: a simple bill may legitimately show only a total.
        if _ai_get(data, "category", "kategorie") in (
                "Supermarkt", "Restaurant / Café", "Drogerie", "Online Shopping"):
            issues.append("Artikelpositionen fehlen")
    else:
        for item in items:
            if not isinstance(item, dict) or not isinstance(item.get("name"), str) or not item["name"].strip():
                issues.append("Ungültige Artikelposition")
                break
            if _item_amount(item) is None:
                issues.append("Positionsbetrag fehlt oder ist ungültig")
                break
        else:
            if total is not None and vat is not None and round(abs(_items_sum(items) + vat - total), 2) > 0.02:
                issues.append("Positionssumme plus Steueraufschlag stimmt nicht mit Endbetrag überein")
    return issues


def _validated_pdf_result(data, text: str, route: str) -> dict | None:
    result = _prepare_pdf_result(data, text)
    issues = _pdf_validation_issues(result, text)
    if issues:
        print(f"  PDF-Prüfung ({route}): " + "; ".join(issues))
        return None
    print(f"  PDF-Prüfung ({route}): erfolgreich")
    return result


def extract_validated_pdf(pdf_path: Path, text: str, text_issues: list[str]) -> dict | None:
    if not text_issues and text.strip() and len(text) <= PDF_TEXT_MAX_CHARS:
        result = _validated_pdf_result(extract_with_ai(text, pdf_path.name), text, "Text")
        if result is not None:
            return result
    print("  PDF: Original wird visuell nachgeprüft (Text unvollständig oder Ergebnis unplausibel).")
    if pdf_path.stat().st_size > PDF_VISUAL_MAX_BYTES:
        print("  PDF: Original größer als 20 MiB; bitte für die Prüfung aufteilen. Keine Teilinhalte importiert.")
        return None
    providers = [
        ("Claude PDF", ANTHROPIC_API_KEY, extract_pdf_with_claude_ocr),
        ("OpenAI PDF", OPENAI_API_KEY, extract_pdf_with_openai),
    ]
    for route, key, call in providers:
        if not key:
            continue
        try:
            result = _validated_pdf_result(call(pdf_path), text, route)
            if result is not None:
                return result
        except Exception as exc:
            print(f"  PDF: {route} fehlgeschlagen ({exc}).")
    print("  PDF: Manuelle Prüfung erforderlich; keine unplausiblen Daten gespeichert.")
    return None


# ── Haupt-Orchestrierung ───────────────────────────────────────────────────────

def _prefilter_pdf_duplicate(text: str) -> bool:
    """Best-effort Dedup VOR dem AI-Call (siehe Block bei _prefilter_semantic_hit).
    Extrahiert Datum + Summe aus dem PDF-Text und prüft gegen bereits importierte
    Gmail-Buchungen. True → Kauf schon vorhanden, AI-Call kann entfallen. Bei
    fehlenden Kandidaten oder Query-Fehler → False (regulärer AI-Pfad läuft, der
    Post-AI-Semantik-Dedup fängt den Re-Send dann trotzdem)."""
    date_candidates  = _extract_date_candidates(text)
    total_candidates = _extract_total_candidates(text)
    if not date_candidates or not total_candidates:
        return False
    col = _tx_collection()
    if not col:
        return False
    try:
        existing: list[dict] = []
        # Firestore 'in' erlaubt max. 10 Werte → in Blöcken abfragen. Nutzt den
        # gleichen (source, date) Composite-Index wie der Post-AI-Check.
        for i in range(0, len(date_candidates), 10):
            chunk = date_candidates[i:i + 10]
            existing.extend(
                d.to_dict() for d in col.where("source", "==", "gmail_import")
                                        .where("date", "in", chunk)
                                        .stream()
            )
    except Exception as exc:
        print(f"  Vorab-Dedup-Check fehlgeschlagen: {exc}")
        return False
    hit = _prefilter_semantic_hit(existing, text, date_candidates, total_candidates)
    if hit:
        print(f"  Übersprungen (Vorab-Duplikat, kein AI-Call): "
              f"{hit.get('description')} · {hit.get('date')} · "
              f"{abs(hit.get('amount', 0) or 0):.2f} EUR")
        return True
    return False


def process_pdf(pdf_path: Path) -> bool:
    """PDF verarbeiten: Duplikat-Check → Text → Vorab-Dedup → AI → Firestore."""
    print(f"  Verarbeite PDF: {pdf_path.name}")

    # Dedup zuerst — doc_id ist deterministisch aus den PDF-Bytes, kein AI-Call
    # nötig um zu wissen ob wir das Dokument schon haben.
    doc_id = _pdf_doc_id(pdf_path)
    if is_duplicate(doc_id):
        print(f"  Übersprungen (Firestore-Duplikat): {doc_id}")
        return False

    try:
        text, text_issues = inspect_pdf_text(pdf_path)
    except Exception as exc:
        print(f"  PDF-Text nicht lesbar ({exc}); Original-PDF prüfen.")
        text, text_issues = "", ["Textextraktion fehlgeschlagen"]
    if text and not text_issues and _prefilter_pdf_duplicate(text):
        return False
    ai_data = extract_validated_pdf(pdf_path, text, text_issues)
    if ai_data is None:
        return False
    ai_data["_raw_text"] = text
    items_list = _ai_get(ai_data, "items", "positionen", default=[])

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
