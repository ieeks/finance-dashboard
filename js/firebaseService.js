// firebaseService.js — Firebase Auth + Firestore
import { initializeApp }                                    from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getFirestore, collection, doc, setDoc, getDoc,
         getDocs, writeBatch, deleteDoc, updateDoc, runTransaction,
         query, orderBy, serverTimestamp }                  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getAuth, signInWithPopup, GoogleAuthProvider,
         onAuthStateChanged, signOut }                      from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { firebaseConfig, ALLOWED_EMAILS }                   from '../firebase-config.js';

import { bonSnapshot, withLearnedCategory } from './bonCategories.js?v=1.13.1';

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
  const [txSnap, bonSnap, keysSnap, overridesSnap, subcatSnap] = await Promise.all([
    getDocs(query(collection(db, `${HH}/transactions`), orderBy('date', 'desc'))),
    getDocs(collection(db, `${HH}/pendingBons`)),
    getDoc(doc(db, `${HH}/config`, 'apiKeys')),
    getDoc(doc(db, `${HH}/config`, 'categoryOverrides')),
    getDoc(doc(db, `${HH}/config`, 'subcategoryOverrides')),
  ]);

  return {
    transactions:          txSnap.docs.map(d => ({ ...d.data(), id: d.id })),
    pendingBons:           bonSnap.docs.map(d => ({ ...d.data(), id: d.id })),
    apiKeys:               keysSnap.exists()      ? keysSnap.data()                       : {},
    categoryOverrides:     overridesSnap.exists() ? (overridesSnap.data().overrides || {}) : {},
    subcategoryOverrides:  subcatSnap.exists()    ? (subcatSnap.data().overrides    || {}) : {},
  };
}

// ── Transaktionen ─────────────────────────────────────────────────────────

// Schreibt mehrere Transaktionen als Batch (max 500 pro Batch)
export async function saveTxBatch(txs) {
  const CHUNK = 400;
  const gespeichert = [];
  for (let i = 0; i < txs.length; i += CHUNK) {
    const chunk = txs.slice(i, i + CHUNK);
    const batch = writeBatch(db);
    chunk.forEach(tx => {
      batch.set(doc(db, `${HH}/transactions`, tx.id), {
        ...tx,
        savedAt:   serverTimestamp(),
        savedBy:   currentEmail(),
      });
    });
    try {
      await batch.commit();
    } catch(e) {
      // Frühere Blöcke sind bereits geschrieben. Ohne diese Liste nimmt der
      // Aufrufer auch gespeicherte Buchungen lokal zurück — der zweite
      // Versuch legt sie dann unter neuen IDs ein zweites Mal an.
      e.savedTxIds = gespeichert.map(t => t.id);
      throw e;
    }
    gespeichert.push(...chunk);
  }
}

// Aktualisiert einzelne Felder einer Transaktion
export async function updateTx(txId, patch) {
  try {
    await updateDoc(doc(db, `${HH}/transactions`, txId), patch);
  } catch(e) {
    // Dokument existiert noch nicht (z.B. aus Migration) → setDoc.
    // Alles andere (offline, Rechte, Netz) muss durchschlagen statt zu
    // verschwinden, sonst sieht der Aufrufer einen Erfolg, den es nicht gab.
    if (e.code !== 'not-found') throw e;
    await setDoc(doc(db, `${HH}/transactions`, txId), patch, { merge: true });
  }
}

export async function deleteTx(txId) {
  await deleteDoc(doc(db, `${HH}/transactions`, txId));
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

export async function fsSaveSubcategoryOverrides(overrides) {
  await setDoc(doc(db, `${HH}/config`, 'subcategoryOverrides'), { overrides });
}

// ── API Keys ──────────────────────────────────────────────────────────────

// Speichert API-Keys (Anthropic / OpenAI) in Firestore. patch wird gemerged,
// d.h. nur die übergebenen Felder werden überschrieben.
export async function fsSaveApiKeys(patch) {
  await setDoc(doc(db, `${HH}/config`, 'apiKeys'), patch, { merge: true });
}


// Atomic category-only updates. Refuse stale previews rather than overwriting
// changes made on another device. All reads precede all transaction writes.
export async function commitBonCategoryChanges(changes, learning = null, onProgress = () => {}) {
  if (changes.length > 300) throw new Error('Bitte die Bereinigung auf weniger als 300 Belege aufteilen.');
  if (globalThis.navigator?.onLine === false) throw new Error('Keine Internetverbindung. Bitte Verbindung herstellen und erneut speichern.');
  return runTransaction(db, async transaction => {
    let checked = 0;
    onProgress({ phase: 'checking', completed: 0, total: changes.length });
    const refs = changes.map(change => {
      if (!['transactions', 'pendingBons'].includes(change.collection)) throw new Error('Ungültiger Belegtyp');
      return doc(db, `${HH}/${change.collection}`, change.id);
    });
    const overrideRef = doc(db, `${HH}/config`, 'subcategoryOverrides');
    // Each get is a server round trip. Start them together; serial reads made
    // all-month repairs appear stuck on mobile networks. All reads still finish
    // before the first write, including the optional learning document.
    const [snapshots, overrideSnap] = await Promise.all([
      Promise.all(refs.map(async ref => {
        const snapshot = await transaction.get(ref);
        onProgress({ phase: 'checking', completed: ++checked, total: refs.length });
        return snapshot;
      })),
      learning ? transaction.get(overrideRef) : Promise.resolve(null),
    ]);
    for (let i = 0; i < changes.length; i++) {
      const saved = snapshots[i];
      const current = changes[i].collection === 'pendingBons'
        ? (saved.exists() ? { ...saved.data(), id: changes[i].id } : undefined) : saved.data()?.bon;
      if (!saved.exists() || bonSnapshot(current) !== bonSnapshot(changes[i].before)) {
        throw new Error('Ein Beleg wurde inzwischen geändert. Bitte App neu laden und Vorschau erneut öffnen.');
      }
    }
    const overrides = learning ? withLearnedCategory(
      overrideSnap.exists() ? overrideSnap.data().overrides || {} : {}, learning.name, learning.category) : null;
    onProgress({ phase: 'saving', completed: changes.length, total: changes.length });
    changes.forEach((change, i) => {
      // Change only items; retain monetary fields, dates, links and metadata.
      transaction.update(refs[i], change.collection === 'pendingBons'
        ? { items: change.after.items } : { 'bon.items': change.after.items });
    });
    if (learning) transaction.set(overrideRef, { overrides }, { merge: true });
    return overrides;
  });
}
