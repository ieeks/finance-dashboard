#!/usr/bin/env python3
"""
gmail_invoices.py — Verbund-Stromrechnungen aus Gmail herunterladen

Verbindet sich per IMAP mit Gmail, sucht UNSEEN E-Mails im Label "Rechnungen",
lädt PDF-Anhänge in iCloud Drive herunter und ruft extract_verbund.py auf.
"""

import imaplib
import email
import os
import subprocess
import sys
import tempfile
from datetime import datetime
from email.header import decode_header
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent

# ── Konfiguration ──────────────────────────────────────────────────────────────
GMAIL_USER         = "manuel.rechnungen@gmail.com"
GMAIL_APP_PASSWORD = os.getenv("GMAIL_APP_PASSWORD", "")
GMAIL_LABEL        = "Rechnungen"              # exakter Label-Name in Gmail
PDF_TEMP_DIR       = Path(tempfile.mkdtemp())

EXTRACT_SCRIPT     = SCRIPT_DIR / "extract_verbund.py"
# ───────────────────────────────────────────────────────────────────────────────

MONTH_NAMES = {
    1: "01_Januar", 2: "02_Februar", 3: "03_März",    4: "04_April",
    5: "05_Mai",    6: "06_Juni",    7: "07_Juli",     8: "08_August",
    9: "09_September", 10: "10_Oktober", 11: "11_November", 12: "12_Dezember",
}


def decode_str(value: str) -> str:
    """E-Mail-Header dekodieren (z. B. encoded UTF-8 oder Latin-1)."""
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
    """Alle PDF-Anhänge einer E-Mail herunterladen. Gibt Liste der Pfade zurück."""
    _, msg_data = mail.fetch(msg_id, "(RFC822)")
    raw = msg_data[0][1]
    msg = email.message_from_bytes(raw)

    # Datum und Absender aus Header
    date_str = msg.get("Date", "")
    try:
        date_obj = email.utils.parsedate_to_datetime(date_str)
    except Exception:
        date_obj = datetime.now()

    sender_full = decode_str(msg.get("From", "unknown"))
    # Nur den Namen / die Domain verwenden, keine E-Mail-Adresse
    sender = sender_full.split("<")[0].strip() or sender_full.split("@")[0].strip("\"'")
    sender = safe_filename(sender)[:40]

    year  = date_obj.year
    month = date_obj.month
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

        # Duplikat-Check
        if dest.exists():
            print(f"  Bereits vorhanden, übersprungen: {dest.name}")
            saved_paths.append(dest)
            continue

        payload = part.get_payload(decode=True)
        if not payload:
            continue

        dest.write_bytes(payload)
        print(f"  Gespeichert: {dest}")
        saved_paths.append(dest)

    return saved_paths


def run_extract(pdf_path: Path) -> None:
    """extract_verbund.py für ein PDF aufrufen."""
    if not EXTRACT_SCRIPT.exists():
        print(f"  WARNUNG: {EXTRACT_SCRIPT} nicht gefunden, Extraktion übersprungen.")
        return
    print(f"  Extrahiere Daten aus: {pdf_path.name}")
    result = subprocess.run(
        [sys.executable, str(EXTRACT_SCRIPT), str(pdf_path)],
        capture_output=True,
        text=True,
    )
    if result.stdout:
        print(result.stdout.rstrip())
    if result.returncode != 0 and result.stderr:
        print(f"  FEHLER bei Extraktion: {result.stderr.rstrip()}")


def main() -> None:
    print(f"[{datetime.now():%Y-%m-%d %H:%M:%S}] gmail_invoices.py gestartet")

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
        print("Verfügbare Labels:")
        list_labels(mail)
        mail.logout()
        sys.exit(1)

    # Ungelesene E-Mails suchen
    _, msg_ids_raw = mail.search(None, "UNSEEN")
    msg_ids = msg_ids_raw[0].split()

    if not msg_ids:
        print("Keine neuen E-Mails gefunden.")
        mail.logout()
        return

    print(f"{len(msg_ids)} neue E-Mail(s) gefunden.")
    total_pdfs = 0

    for msg_id in msg_ids:
        print(f"\nVerarbeite E-Mail ID {msg_id.decode()} ...")
        saved = download_pdfs(mail, msg_id)

        # E-Mail als gelesen markieren
        mail.store(msg_id, "+FLAGS", "\\Seen")

        # Extraktion für jedes neue PDF
        for pdf_path in saved:
            run_extract(pdf_path)
            total_pdfs += 1

    mail.logout()
    print(f"\nFertig. {total_pdfs} PDF(s) verarbeitet.")


if __name__ == "__main__":
    main()
