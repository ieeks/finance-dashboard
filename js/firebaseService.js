// firebaseService.js — Firebase Auth + Firestore
import { initializeApp }                                    from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getFirestore, collection, doc, setDoc, getDoc,
         getDocs, writeBatch, deleteDoc, updateDoc,
         query, orderBy, serverTimestamp }                  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getAuth, signInWithPopup, GoogleAuthProvider,
         onAuthStateChanged, signOut }                      from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { firebaseConfig, ALLOWED_EMAILS }                   from '../firebase-config.js';

const app  = initializeApp(firebaseConfig);
const db   = getFirestore(app);
const auth = getAuth(app);
const HH   = 'household/main';

// ── Auth ──────────────────────────────────────────────────────────────────

export async function login() {
  const result = await signInWithPopup(auth, new GoogleAuthProvider());
  if (!ALLOWED_EMAILS.includes(result.user.email)) {
    await signOut(auth);
    throw new Error(`Kein Zugang für ${result.user.email}`);
  }
  return result.user;
}

export async function logout() {
  await signOut(auth);
}

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

export function currentUser() {
  return auth.currentUser;
}

export function currentEmail() {
  return auth.currentUser?.email || 'unknown';
}

// ── Daten laden ───────────────────────────────────────────────────────────

export async function loadAllData() {
  const [txSnap, bonSnap, keysSnap, overridesSnap] = await Promise.all([
    getDocs(query(collection(db, `${HH}/transactions`), orderBy('date', 'desc'))),
    getDocs(collection(db, `${HH}/pendingBons`)),
    getDoc(doc(db, `${HH}/config`, 'apiKeys')),
    getDoc(doc(db, `${HH}/config`, 'categoryOverrides')),
  ]);

  return {
    transactions:      txSnap.docs.map(d => ({ ...d.data(), id: d.id })),
    pendingBons:       bonSnap.docs.map(d => ({ ...d.data(), id: d.id })),
    apiKeys:           keysSnap.exists()      ? keysSnap.data()                       : {},
    categoryOverrides: overridesSnap.exists() ? (overridesSnap.data().overrides || {}) : {},
  };
}

// ── Transaktionen ─────────────────────────────────────────────────────────

// Schreibt mehrere Transaktionen als Batch (max 500 pro Batch)
export async function saveTxBatch(txs) {
  const CHUNK = 400;
  for (let i = 0; i < txs.length; i += CHUNK) {
    const batch = writeBatch(db);
    txs.slice(i, i + CHUNK).forEach(tx => {
      batch.set(doc(db, `${HH}/transactions`, tx.id), {
        ...tx,
        savedAt:   serverTimestamp(),
        savedBy:   currentEmail(),
      });
    });
    await batch.commit();
  }
}

// Aktualisiert einzelne Felder einer Transaktion
export async function updateTx(txId, patch) {
  try {
    await updateDoc(doc(db, `${HH}/transactions`, txId), patch);
  } catch(e) {
    // Dokument existiert noch nicht (z.B. aus Migration) → setDoc
    await setDoc(doc(db, `${HH}/transactions`, txId), patch, { merge: true });
  }
}

// ── Import-History ────────────────────────────────────────────────────────

export async function checkImportExists(importId) {
  const snap = await getDoc(doc(db, `${HH}/imports`, importId));
  return snap.exists();
}

export async function saveImport(importId, meta) {
  await setDoc(doc(db, `${HH}/imports`, importId), {
    ...meta,
    importedAt: serverTimestamp(),
    importedBy: currentEmail(),
  });
}

// ── Pending Bons ──────────────────────────────────────────────────────────

export async function fsAddPendingBon(bon) {
  await setDoc(doc(db, `${HH}/pendingBons`, bon.id), {
    ...bon,
    savedAt: serverTimestamp(),
    savedBy: currentEmail(),
  });
}

export async function fsDeletePendingBon(bonId) {
  await deleteDoc(doc(db, `${HH}/pendingBons`, bonId));
}

// ── Kategorie-Overrides ───────────────────────────────────────────────────

export async function fsSaveCategoryOverrides(overrides) {
  await setDoc(doc(db, `${HH}/config`, 'categoryOverrides'), { overrides });
}

// ── Migration aus localStorage ────────────────────────────────────────────

export async function migrateFromLocalStorage(localData) {
  const ops = [];

  if (localData.transactions?.length) {
    const CHUNK = 400;
    for (let i = 0; i < localData.transactions.length; i += CHUNK) {
      const batch = writeBatch(db);
      localData.transactions.slice(i, i + CHUNK).forEach(tx => {
        batch.set(doc(db, `${HH}/transactions`, tx.id), {
          ...tx,
          savedAt: serverTimestamp(),
          savedBy: 'migration',
        });
      });
      ops.push(batch.commit());
    }
  }

  if (localData.pendingBons?.length) {
    const batch = writeBatch(db);
    localData.pendingBons.forEach(bon => {
      batch.set(doc(db, `${HH}/pendingBons`, bon.id), { ...bon });
    });
    ops.push(batch.commit());
  }

  if (Object.keys(localData.categoryOverrides || {}).length) {
    ops.push(setDoc(
      doc(db, `${HH}/config`, 'categoryOverrides'),
      { overrides: localData.categoryOverrides }
    ));
  }

  await Promise.all(ops);
}
