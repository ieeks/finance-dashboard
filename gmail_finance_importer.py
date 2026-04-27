"""
gmail_finance_importer.py — PDF-Rechnungen aus Gmail → Firestore (finance-dashboard)

Ablauf:
  1. IMAP: UNSEEN-Mails im Label "Finance" abholen, PDF-Anhänge speichern
  2. pdfplumber: Text aus PDF extrahieren
  3. AI: OpenAI gpt-4o-mini (primär) → Claude Haiku (Fallback)
  4. Firestore: Transaktion unter household/main/transactions/{id} speichern

Felder werden auf das Format des Browser-Parsers gemappt, damit das
Dashboard die Transaktionen ohne Änderungen anzeigen kann.

Ausführen:
  pip install pdfplumber anthropic firebase-admin python-dotenv
  python3 gmail_finance_importer.py
"""

import email
import hashlib
import imaplib
import json
import os
import re
import tempfile
import urllib.request
from datetime import datetime
from email.header import decode_header
from pathlib import Path

import pdfplumber
from dotenv import load_dotenv

load_dotenv()

# ── Konfiguration ──────────────────────────────────────────────────────────────

GMAIL_USER              = "manuel.rechnungen@gmail.com"
GMAIL_APP_PASSWORD      = os.getenv("GMAIL_APP_PASSWORD", "")
GMAIL_LABEL             = "Finance"
OPENAI_API_KEY          = os.getenv("OPENAI_API_KEY", "")
ANTHROPIC_API_KEY       = os.getenv("ANTHROPIC_API_KEY", "")
FIREBASE_SERVICE_ACCOUNT = os.getenv("FIREBASE_SERVICE_ACCOUNT", "")

# Firestore-Pfad: household/main/transactions/{id}  ← muss mit Browser-App übereinstimmen
FIRESTORE_HH_DOC    = ("household", "main")
FIRESTORE_TX_SUBCOL = "transactions"

# ── IMAP Helpers ───────────────────────────────────────────────────────────────

def decode_str(value) -> str:
    """E-Mail-Header dekodieren (UTF-8, latin-1, etc.)."""
    parts = decode_header(value or "")
    result = []
    for part, enc in parts:
        if isinstance(part, bytes):
            result.append(part.decode(enc or "utf-8", errors="replace"))
        else:
            result.append(part)
    return "".join(result)


def safe_filename(name: str) -> str:
    """Sonderzeichen aus Dateinamen entfernen."""
    return re.sub(r'[^\w\-.]', '_', name)


def download_pdfs(mail: imaplib.IMAP4_SSL, msg_id: bytes, dest_dir: Path) -> list[Path]:
    """PDF-Anhänge einer Mail in dest_dir speichern. Gibt Pfade zurück."""
    _, data = mail.fetch(msg_id, "(RFC822)")
    msg = email.message_from_bytes(data[0][1])
    paths = []
    for part in msg.walk():
        if part.get_content_maintype() == "multipart":
            continue
        filename = part.get_filename()
        if not filename:
            continue
        filename = decode_str(filename)
        if not filename.lower().endswith(".pdf"):
            continue
        safe_name = safe_filename(filename)
        dest = dest_dir / safe_name
        dest.write_bytes(part.get_payload(decode=True))
        print(f"  PDF gespeichert: {safe_name}")
        paths.append(dest)
    return paths

# ── PDF Text-Extraktion ────────────────────────────────────────────────────────

def extract_pdf_text(pdf_path: Path) -> str:
    """Gesamten Text aus PDF extrahieren (alle Seiten)."""
    text = ""
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text += (page.extract_text() or "") + "\n"
    return text

# ── AI-Extraktion ──────────────────────────────────────────────────────────────

def _build_prompt(pdf_text: str, filename: str) -> str:
    return f"""Du bist ein Rechnungs-Extraktor. Analysiere diesen PDF-Text einer Rechnung
und extrahiere die wichtigsten Felder als JSON.

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
  "kategorie": "..."
}}

Für "kategorie" eine dieser Optionen wählen:
Energie / Strom, Telekommunikation, Versicherung, Online Shopping,
Mobilität / Auto, Wohnen / Miete, Gesundheit, Gebühren / Bank, Sonstiges"""


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

# ── Firestore ──────────────────────────────────────────────────────────────────

_db = None

def get_firestore_db():
    """Firebase Admin initialisieren (einmalig, danach gecacht)."""
    global _db
    if _db is not None:
        return _db
    if not FIREBASE_SERVICE_ACCOUNT:
        return None
    try:
        import firebase_admin
        from firebase_admin import credentials, firestore
        sa = json.loads(FIREBASE_SERVICE_ACCOUNT)
        cred = credentials.Certificate(sa)
        if not firebase_admin._apps:
            firebase_admin.initialize_app(cred)
        _db = firestore.client()
        return _db
    except Exception as exc:
        print(f"  Firebase-Init fehlgeschlagen: {exc}")
        return None


def _tx_collection():
    """Gibt die Subcollection household/main/transactions zurück."""
    db = get_firestore_db()
    if not db:
        return None
    return db.collection(FIRESTORE_HH_DOC[0]).document(FIRESTORE_HH_DOC[1]).collection(FIRESTORE_TX_SUBCOL)


def is_duplicate(doc_id: str, betrag: float, datum: str) -> bool:
    """Prüft ob Transaktion bereits in household/main/transactions existiert."""
    col = _tx_collection()
    if not col:
        return False
    # Direkter Lookup über doc_id
    if col.document(doc_id).get().exists:
        return True
    # Fallback: Query auf date + amount
    results = (col
               .where("date", "==", datum)
               .where("amount", "==", -abs(betrag))
               .limit(1)
               .get())
    return len(results) > 0


def save_to_firestore(ai_data: dict, filename: str, doc_id: str) -> bool:
    """
    Transaktion unter household/main/transactions/{doc_id} speichern.
    Felder werden auf das Browser-App-Format gemappt:
      date, amount (negativ), description, category, account, aiCategorized, ...
    """
    col = _tx_collection()
    if not col:
        print("  Firestore nicht verfügbar (FIREBASE_SERVICE_ACCOUNT fehlt).")
        return False

    # Felder auf Browser-App-Format mappen
    tx = {
        "id":            doc_id,
        "date":          ai_data.get("rechnungsdatum", ""),
        "amount":        -abs(ai_data.get("betrag_brutto", 0)),   # negativ = Ausgabe
        "description":   ai_data.get("absender", filename),
        "category":      ai_data.get("kategorie", "Sonstiges"),
        "account":       "easybank",
        "aiCategorized": True,
        "source":        "gmail_import",
        "note":          ai_data.get("beschreibung", ""),
        "savedAt":       datetime.now().isoformat(),
        "savedBy":       "gmail_importer",
        "filename":      filename,
    }

    try:
        col.document(doc_id).set(tx)
        print(f"  Firestore: household/main/transactions/{doc_id} geschrieben.")
        return True
    except Exception as exc:
        print(f"  Firestore-Fehler: {exc}")
        return False

# ── Haupt-Orchestrierung ───────────────────────────────────────────────────────

def _make_doc_id(ai_data: dict, filename: str) -> str:
    """Document-ID: Rechnungsnummer wenn vorhanden, sonst Hash."""
    nr = (ai_data.get("rechnungsnummer") or "").strip()
    if nr:
        return re.sub(r'[^\w\-]', '_', nr)
    key = f"{ai_data.get('rechnungsdatum','')}-{ai_data.get('betrag_brutto','')}-{filename}"
    return "auto_" + hashlib.md5(key.encode()).hexdigest()[:12]


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

    print(f"  Erkannt: {ai_data.get('absender','?')} — "
          f"{ai_data.get('betrag_brutto','?')} EUR — {ai_data.get('rechnungsdatum','?')}")

    doc_id = _make_doc_id(ai_data, pdf_path.name)

    if is_duplicate(doc_id, ai_data.get("betrag_brutto", 0), ai_data.get("rechnungsdatum", "")):
        print("  Bereits vorhanden, übersprungen.")
        return False

    return save_to_firestore(ai_data, pdf_path.name, doc_id)


def main():
    if not GMAIL_APP_PASSWORD:
        print("FEHLER: GMAIL_APP_PASSWORD nicht gesetzt.")
        return

    print(f"Verbinde mit Gmail ({GMAIL_USER})…")
    mail = imaplib.IMAP4_SSL("imap.gmail.com")
    mail.login(GMAIL_USER, GMAIL_APP_PASSWORD)
    mail.select(f'"{GMAIL_LABEL}"')

    _, msg_ids = mail.search(None, "UNSEEN")
    ids = msg_ids[0].split()
    print(f"{len(ids)} ungelesene Mail(s) im Label '{GMAIL_LABEL}'.")

    if not ids:
        mail.logout()
        return

    pdf_temp_dir = Path(tempfile.mkdtemp())
    processed = 0
    saved = 0

    for msg_id in ids:
        print(f"\nMail {msg_id.decode()}:")
        pdfs = download_pdfs(mail, msg_id, pdf_temp_dir)

        if not pdfs:
            print("  Keine PDF-Anhänge.")
        else:
            for pdf_path in pdfs:
                processed += 1
                if process_pdf(pdf_path):
                    saved += 1

        # Mail als gelesen markieren — auch wenn AI/Firestore fehlschlägt
        mail.store(msg_id, "+FLAGS", "\\Seen")

    mail.logout()
    print(f"\nFertig: {processed} PDFs verarbeitet, {saved} in Firestore gespeichert.")
    print(f"Temp-Verzeichnis: {pdf_temp_dir}  (für Debugging behalten)")


if __name__ == "__main__":
    main()
