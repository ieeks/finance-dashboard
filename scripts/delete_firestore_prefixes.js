import admin from 'firebase-admin';

const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
if (!credsJson) {
  console.error('GOOGLE_APPLICATION_CREDENTIALS_JSON env var is missing');
  process.exit(1);
}

const serviceAccount = JSON.parse(credsJson);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const COLLECTION_PATH = 'household/main/transactions';
const PREFIXES = ['pdf_', 'img_'];
const BATCH_SIZE = 500;

async function main() {
  const snapshot = await db.collection(COLLECTION_PATH).get();
  const toDelete = snapshot.docs.filter((doc) =>
    PREFIXES.some((prefix) => doc.id.startsWith(prefix))
  );

  console.log(`Gefunden: ${toDelete.length} Dokumente mit Präfix pdf_ oder img_`);

  let deleted = 0;
  for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
    const chunk = toDelete.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    chunk.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    deleted += chunk.length;
    console.log(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${chunk.length} gelöscht (gesamt: ${deleted})`);
  }

  console.log(`Gelöscht: ${deleted} Dokumente`);
  console.log('Fertig');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
