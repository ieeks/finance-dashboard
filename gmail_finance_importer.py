#!/usr/bin/env python3
"""
gmail_finance_importer.py — PDF-Rechnungen aus Gmail → Firestore (finance-dashboard)

Ablauf:
  1. IMAP: UNSEEN-Mails im Label "Finance" abholen, PDF-Anhänge speichern
     (IMAP-Logik direkt aus gmail_invoices.py übernommen)
  2. pdfplumber: Text aus PDF extrahieren
  3. AI: OpenAI gpt-4o-mini (primär) → Claude Haiku (Fallback)
  4. Firestore: Transaktion unter household/main/transactions/{id} speichern
     (get_firestore_db() direkt aus extract_verbund.py übernommen)

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

# Firestore-Pfad: household/main/transactions/{id}  ← gleich wie Browser-Parser
FIRESTORE_HH_DOC    = ("household", "main")
FIRESTORE_TX_SUBCOL = "transactions"

MONTH_NAMES = {
    1: "01_Januar",   2: "02_Februar", 3: "03_März",      4: "04_April",
    5: "05_Mai",      6: "06_Juni",    7: "07_Juli",       8: "08_August",
    9: "09_September",10: "10_Oktober",11: "11_November",  12: "12_Dezember",
}

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


def download_pdfs(mail: imaplib.IMAP4_SSL, msg_id: bytes) -> list[Path]:
    """
    Alle PDF-Anhänge einer E-Mail in PDF_TEMP_DIR speichern.
    Dateiname: {datum}_{absender}_{original}.pdf
    Gibt Liste der gespeicherten Pfade zurück (bereits vorhandene inklusive).
    """
    _, msg_data = mail.fetch(msg_id, "(RFC822)")
    raw = msg_data[0][1]
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

        is_pdf = (
            content_type == "application/pdf"
            or (content_type == "application/octet-stream" and "pdf" in disposition.lower())
            or ("attachment" in disposition.lower() and disposition.lower().endswith(".pdf"))
        )
        if not is_pdf:
            filename = part.get_filename()
            if filename and filename.lower().endswith(".pdf"):
                is_pdf = True
        if not is_pdf:
            continue

        raw_filename = part.get_filename() or "attachment.pdf"
        orig_name    = safe_filename(decode_str(raw_filename))
        new_name     = f"{date_prefix}_{sender}_{orig_name}"
        dest         = target_dir / new_name

        if dest.exists():
            print(f"  Bereits vorhanden, übersprungen: {dest.name}")
            saved_paths.append(dest)
            continue

        payload = part.get_payload(decode=True)
        if not payload:
            continue

        dest.write_bytes(payload)
        print(f"  PDF gespeichert: {dest.name}")
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

# ── AI-Extraktion (OpenAI primär → Anthropic Fallback) ────────────────────────

def _build_prompt(pdf_text: str, filename: str) -> str:
    return f"""Du bist ein Kassenbon- und Rechnungs-Extraktor. Analysiere diesen PDF-Text
und extrahiere alle relevanten Felder als JSON.

PDF-Dateiname: {filename}
PDF-Text:
{pdf_text[:8000]}

Antworte NUR mit einem JSON-Objekt (kein Markdown, kein Text davor/danach):
{{
  "rechnungsnummer": "...",
  "rechnungsdatum": "YYYY-MM-DD",
  "absender": "...",
  "betrag_brutto": 0.00,
  "beschreibung": "...",
  "kategorie": "...",
  "positionen": [
    {{"name": "...", "menge": 1, "einzelpreis": 0.00, "gesamt": 0.00, "subkategorie": "..."}}
  ]
}}

Regeln:
- "absender": NUR der Firmenname, KEINE Adresse, PLZ oder Stadt.
  Richtig: "Billa" — Falsch: "Billa AG, 1030 Wien, Musterstraße 1"
- "positionen": alle Einzelpositionen aus dem Kassenbon/Rechnung extrahieren.
  Falls keine Einzelpositionen erkennbar sind → leeres Array [].
- "positionen[].subkategorie" aus dieser Liste wählen:
  Milchprodukte, Süßwaren / Naschen, Getränke, Brot & Backwaren,
  Fleisch & Wurst, Obst & Gemüse, Tiefkühl, Hygiene, Putzmittel, Sonstiges

Für "kategorie" eine dieser Optionen wählen:
Supermarkt, Restaurant / Café, Drogerie, Energie / Strom, Telekommunikation,
Versicherung, Online Shopping, Mobilität / Auto, Wohnen / Miete, Gesundheit,
Gebühren / Bank, Freizeit, Sonstiges"""


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


def save_to_firestore(ai_data: dict, filename: str, doc_id: str) -> bool:
    """
    Transaktion unter household/main/transactions/{doc_id} speichern.
    Feldnamen auf Browser-App-Format gemappt:
      date, amount (negativ = Ausgabe), description, category, account, aiCategorized
    """
    col = _tx_collection()
    if not col:
        print("  Firestore nicht verfügbar (FIREBASE_SERVICE_ACCOUNT fehlt).")
        return False

    # Nur Firmennamen, keine Adresse (Fallback-Cleanup falls AI es ignoriert)
    raw_absender = ai_data.get("absender", filename) or filename
    description  = raw_absender.split(",")[0].split("\n")[0].strip()

    # Einzelposten → bon.items (gleiche Struktur wie Bon-Analyzer im Browser)
    positionen = ai_data.get("positionen") or []
    bon = None
    if positionen:
        bon = {
            "source": "gmail_import",
            "total":  abs(ai_data.get("betrag_brutto", 0)),
            "date":   ai_data.get("rechnungsdatum", ""),
            "vendor": description,
            "items":  [
                {
                    "name":        p.get("name", ""),
                    "menge":       p.get("menge", 1),
                    "price":       float(p.get("gesamt") or p.get("einzelpreis") or 0),
                    "subcategory": p.get("subkategorie", "Sonstiges"),
                }
                for p in positionen if p.get("name")
            ],
        }

    tx = {
        "id":            doc_id,
        "date":          ai_data.get("rechnungsdatum", ""),
        "amount":        -abs(ai_data.get("betrag_brutto", 0)),
        "description":   description,
        "category":      ai_data.get("kategorie", "Sonstiges"),
        "account":       "easybank",
        "aiCategorized": True,
        "source":        "gmail_import",
        "note":          ai_data.get("beschreibung", ""),
        "savedAt":       datetime.now().isoformat(),
        "savedBy":       "gmail_importer",
        "filename":      filename,
    }
    if bon and bon["items"]:
        tx["bon"] = bon

    try:
        col.document(doc_id).set(tx)
        print(f"  Firestore: household/main/transactions/{doc_id} geschrieben.")
        return True
    except Exception as exc:
        print(f"  Firestore-Fehler: {exc}")
        return False

# ── Haupt-Orchestrierung ───────────────────────────────────────────────────────

def process_pdf(pdf_path: Path) -> bool:
    """PDF verarbeiten: Text → AI → Duplikat-Check → Firestore."""
    print(f"  Verarbeite: {pdf_path.name}")

    text = extract_pdf_text(pdf_path)
    if not text.strip():
        print("  FEHLER: Kein Text im PDF gefunden.")
        return False

    ai_data = extract_with_ai(text, pdf_path.name)
    if not ai_data:
        print("  FEHLER: AI-Extraktion fehlgeschlagen.")
        return False

    n_items = len(ai_data.get("positionen") or [])
    items_info = f" · {n_items} Positionen" if n_items else ""
    print(f"  Erkannt: {ai_data.get('absender','?')} — "
          f"{ai_data.get('betrag_brutto','?')} EUR — {ai_data.get('rechnungsdatum','?')}{items_info}")

    doc_id = _pdf_doc_id(pdf_path)

    if is_duplicate(doc_id):
        print("  Bereits vorhanden (PDF-Hash), übersprungen.")
        return False

    return save_to_firestore(ai_data, pdf_path.name, doc_id)


def main() -> None:
    print(f"[{datetime.now():%Y-%m-%d %H:%M:%S}] gmail_finance_importer.py gestartet")

    if not GMAIL_APP_PASSWORD:
        print("FEHLER: GMAIL_APP_PASSWORD nicht gesetzt.")
        sys.exit(1)

    # IMAP-Verbindung
    try:
        mail = imaplib.IMAP4_SSL("imap.gmail.com")
        mail.login(GMAIL_USER, GMAIL_APP_PASSWORD)
    except imaplib.IMAP4.error as exc:
        print(f"FEHLER: Anmeldung fehlgeschlagen — {exc}")
        print("Tipp: App-Passwort prüfen und IMAP in Gmail aktivieren.")
        sys.exit(1)

    # Label auswählen
    status, _ = mail.select(f'"{GMAIL_LABEL}"')
    if status != "OK":
        print(f"FEHLER: Label '{GMAIL_LABEL}' nicht gefunden.")
        list_labels(mail)
        mail.logout()
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
        pdfs = download_pdfs(mail, msg_id)

        if not pdfs:
            print("  Keine PDF-Anhänge.")
        else:
            for pdf_path in pdfs:
                processed += 1
                if process_pdf(pdf_path):
                    saved += 1

        # Seen-Flag absichtlich NICHT setzen — gmail-pdf-sync verwaltet das

    mail.logout()
    print(f"\nFertig: {processed} PDF(s) verarbeitet, {saved} in Firestore gespeichert.")
    print(f"Temp-Verzeichnis: {PDF_TEMP_DIR}  (für Debugging behalten)")


if __name__ == "__main__":
    main()
