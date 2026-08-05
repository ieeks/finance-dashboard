// Löscht einzelne Transaktions-Dokumente aus household/main/transactions.
//
// Anwendungsfall: Eine Rechnung wurde vom Gmail-Importer falsch extrahiert
// (z.B. Netto- statt Bruttobetrag, siehe _gross_total_correction). Der
// Byte-Hash-Dedup (_pdf_doc_id) verhindert ein Neu-Einlesen, solange das Doc
// existiert. Doc löschen → nächster Gmail-Sync importiert die Mail neu, dann
// mit korrigiertem Prompt/Korrektur.
//
// ACHTUNG: Die Mail muss dafür noch im 30-Tage-IMAP-Fenster des Importers
// liegen (main(): SINCE heute-30d), sonst ist die Buchung danach weg.
//
// Aufruf:
//   DOC_IDS="pdf_abc,pdf_def" node scripts/delete_firestore_docs.js
//   node scripts/delete_firestore_docs.js pdf_abc pdf_def
//   DRY_RUN=true ...   → zeigt nur an, löscht nicht

import admin from 'firebase-admin';

const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
if (!credsJson) {
  console.error('GOOGLE_APPLICATION_CREDENTIALS_JSON env var is missing');
  process.exit(1);
}

const docIds = [...(process.env.DOC_IDS || '').split(/[\s,]+/), ...process.argv.slice(2)]
  .map((id) => id.trim())
  .filter(Boolean);

if (!docIds.length) {
  console.error('Keine Doc-IDs übergeben (DOC_IDS env oder Argumente).');
  process.exit(1);
}

const dryRun = String(process.env.DRY_RUN || '').toLowerCase() === 'true';

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(credsJson)) });

const db = admin.firestore();
const COLLECTION_PATH = 'household/main/transactions';

async function main() {
  console.log(`${docIds.length} Doc-ID(s)${dryRun ? ' — DRY RUN, es wird nichts gelöscht' : ''}`);

  let deleted = 0;
  let missing = 0;

  for (const id of docIds) {
    const ref  = db.collection(COLLECTION_PATH).doc(id);
    const snap = await ref.get();

    if (!snap.exists) {
      console.log(`  ${id}: nicht vorhanden — übersprungen`);
      missing += 1;
      continue;
    }

    // Vor dem Löschen zeigen was verschwindet — die IDs sind Hashes, ohne
    // diese Zeile ist im Log nicht nachvollziehbar was getroffen wurde.
    const d = snap.data() || {};
    console.log(`  ${id}: ${d.description || '?'} · ${d.date || '?'} · ${d.amount ?? '?'} EUR`);

    if (!dryRun) {
      await ref.delete();
      deleted += 1;
    }
  }

  console.log(dryRun
    ? `Fertig (DRY RUN): ${docIds.length - missing} würden gelöscht, ${missing} nicht gefunden`
    : `Fertig: ${deleted} gelöscht, ${missing} nicht gefunden`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
