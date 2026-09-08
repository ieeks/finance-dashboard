// match_rate_report.mjs — Wie viele Gmail-Rechnungen werden automatisch
// verknüpft: alter Matcher (v1.11.0, ±2 €) vs. der Stand dieses Branches.
//
// NUR LESEND. Schreibt nichts nach Firestore; updateTx() ist gestubbt.
//
// Aufruf:
//   GOOGLE_APPLICATION_CREDENTIALS_JSON="$(cat sa.json)" node scripts/match_rate_report.mjs
//   node scripts/match_rate_report.mjs --input export.json
//
// Optionen:
//   --input <datei>  Transaktionen aus JSON lesen statt aus Firestore
//                    (Array von Dokumenten oder { transactions: [...] })
//   --dump <datei>   gelesene Firestore-Dokumente als JSON sichern
//   --samples <n>    n Beispiele je Ursache ausgeben (Default 0 —
//                    Beispiele enthalten Händlernamen und Beträge)
//   --json           Ergebnis als JSON statt als Text
//
// Der neue Stand wird nicht nachgebaut, sondern aus js/app.js ausgeführt:
// _autoLinkGmailBons() läuft im vm gegen einen State-Doppelgänger. Ändert sich
// der Funktionsname, bricht das Skript hörbar ab statt still Falsches zu messen.

import fs from 'node:fs';
import vm from 'node:vm';
import { findMatch, bonNeedsReview, bonItemsNeedReview } from '../js/matcher.js';
import { findMatch as legacyFindMatch } from './legacy/matcher-v1.11.0.mjs';

const COLLECTION_PATH = 'household/main/transactions';

// ── Argumente ──
const argv = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const flag = name => argv.includes(`--${name}`);
const sampleCount = Number(opt('samples', 0)) || 0;

// ── Daten laden ──
async function loadTransactions() {
  const input = opt('input');
  if (input) {
    const raw = JSON.parse(fs.readFileSync(input, 'utf8'));
    const rows = Array.isArray(raw) ? raw : raw.transactions;
    if (!Array.isArray(rows)) throw new Error(`${input}: kein Array und kein { transactions: [...] }`);
    return { rows, source: input };
  }
  const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!credsJson) {
    console.error('GOOGLE_APPLICATION_CREDENTIALS_JSON fehlt — oder --input <datei> angeben.');
    process.exit(1);
  }
  const { default: admin } = await import('firebase-admin').catch(() => {
    console.error('firebase-admin fehlt — "npm install firebase-admin" oder --input <datei> nutzen.');
    process.exit(1);
  });
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(credsJson)) });
  const snap = await admin.firestore().collection(COLLECTION_PATH).get();
  const rows = snap.docs.map(d => ({ ...d.data(), id: d.id }));
  const dump = opt('dump');
  if (dump) fs.writeFileSync(dump, JSON.stringify(rows, null, 2));
  return { rows, source: `Firestore ${COLLECTION_PATH}` };
}

// Firestore-Timestamps und andere Nicht-JSON-Werte flach machen.
const plain = rows => JSON.parse(JSON.stringify(rows, (k, v) =>
  v && typeof v === 'object' && typeof v.toDate === 'function' ? v.toDate().toISOString() : v));

// ── Alter Lauf: _autoLinkGmailBons() aus v1.11.0, gegen den alten Matcher ──
function legacyPass(txs) {
  const gmailWithBon = txs.filter(t => t.source === 'gmail_import' && t.bon);
  const bank = txs.filter(t => t.source !== 'gmail_import' && t.amount < 0);
  bank.forEach(t => { if (t.bon?.source === 'gmail_import') t.bon = null; });
  const free = bank.filter(t => !t.bon);
  const usedTxIds = new Set();
  const linked = new Map();
  gmailWithBon.forEach(gmail => {
    const bonObj = {
      date:      gmail.date,
      debitDate: gmail.debitDate || gmail.bon?.debitDate || null,
      total:     Math.abs(gmail.amount),
      store:     gmail.description,
    };
    const result = legacyFindMatch(bonObj, free, { excludeIds: usedTxIds });
    if (result?.transaction) {
      usedTxIds.add(result.transaction.id);
      linked.set(gmail.id, result.transaction);
    }
  });
  return { linked, invoices: gmailWithBon };
}

// ── Neuer Lauf: die echte Funktion aus js/app.js ──
function currentPass(txs) {
  const source = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function _autoLinkGmailBons()');
  const end   = source.indexOf('\nfunction _initApp', start);
  if (start < 0 || end < 0) throw new Error('_autoLinkGmailBons() in js/app.js nicht gefunden');

  const cleared = [];
  const ctx = {
    console,
    state: { transactions: txs, subcategoryOverrides: {} },
    findMatch, bonNeedsReview, bonItemsNeedReview,
    // Nur protokollieren — dieses Skript schreibt nichts.
    updateTx: async (id, patch) => { cleared.push({ id, patch }); },
    applySubcatOverrides: items => items,
  };
  vm.createContext(ctx);
  vm.runInContext(source.slice(start, end), ctx);
  return ctx._autoLinkGmailBons().then(() => {
    const linked = new Map();
    txs.forEach(t => {
      if (t.source !== 'gmail_import' && t.bon?.invoiceId) linked.set(t.bon.invoiceId, t);
    });
    return { linked, cleared };
  });
}

// ── Ursachen: warum findet der neue Matcher diese Rechnung nicht mehr? ──
// Jede Sonde hebt genau ein Gate auf und fragt den neuen Matcher erneut.
function diagnose(gmail, oldMatch, pool, excludeIds) {
  const base = {
    ...gmail.bon,
    date:      gmail.date,
    debitDate: gmail.debitDate || gmail.bon?.debitDate || null,
    total:     gmail.bon.total ?? Math.abs(gmail.amount),
    store:     gmail.description,
    account:   gmail.account,
    needsReview: gmail.needsReview || gmail.bon.needsReview,
  };
  const hits = bon => !!findMatch(bon, pool, { excludeIds });
  const reasons = [];

  if (hits({ ...base, account: undefined })) reasons.push('Kontofilter');
  if (hits({ ...base, needsReview: false, currency: 'EUR' })) reasons.push('Prüfhinweis / Fremdwährung');
  if (hits({ ...base, items: undefined, itemsReview: false })) reasons.push('unvollständige Positionen');
  if (oldMatch) {
    const exact = Math.abs(oldMatch.amount) - (Number(base.tip) || 0);
    if (hits({ ...base, total: exact })) reasons.push('Betrag nicht centgenau');
  }
  if (!base.date || base.dateSuspect) reasons.push('kein / verdächtiges Bon-Datum');

  if (!reasons.length) {
    // Kein einzelnes Gate erklärt es — meist mehrere gleichzeitig oder ein
    // Kandidat, den eine andere Rechnung zuerst belegt hat.
    reasons.push(bonNeedsReview(base) ? 'Zahlbetrag unplausibel' : 'mehrere Gates / Kandidat vergeben');
  }
  return reasons;
}

// ── Bericht ──
function pct(n, total) { return total ? `${(n / total * 100).toFixed(1)} %` : '—';}

async function main() {
  const { rows, source } = await loadTransactions();
  const all = plain(rows);

  const invoices  = all.filter(t => t.source === 'gmail_import');
  const withBon   = invoices.filter(t => t.bon);
  const bankTxs   = all.filter(t => t.source !== 'gmail_import');
  const storedLinks = bankTxs.filter(t => t.bon?.source === 'gmail_import');

  const legacy  = legacyPass(plain(all));
  const currentTxs = plain(all);
  const current = await currentPass(currentTxs);

  // Kandidatenpool für die Sonden: was der neue Lauf nicht vergeben hat.
  const takenIds = new Set([...current.linked.values()].map(t => t.id));
  const probePool = currentTxs.filter(t => t.source !== 'gmail_import' && t.amount < 0);

  const lost = [];
  const won  = [];
  withBon.forEach(gmail => {
    const before = legacy.linked.get(gmail.id);
    const after  = current.linked.get(gmail.id);
    if (before && !after) lost.push({ gmail, oldMatch: before, reasons: diagnose(gmail, before, probePool, takenIds) });
    if (!before && after) won.push({ gmail, newMatch: after });
  });

  const byReason = new Map();
  lost.forEach(entry => entry.reasons.forEach(r => {
    if (!byReason.has(r)) byReason.set(r, []);
    byReason.get(r).push(entry);
  }));

  const droppedLinks = current.cleared.filter(w => w.patch.bon === null).length;

  const result = {
    quelle: source,
    bestand: {
      dokumente: all.length,
      bankbuchungen: bankTxs.length,
      gmailRechnungen: invoices.length,
      davonMitBon: withBon.length,
      gespeicherteLinks: storedLinks.length,
    },
    zuordnung: {
      alt: legacy.linked.size,
      neu: current.linked.size,
      basis: withBon.length,
      verloren: lost.length,
      neuGewonnen: won.length,
    },
    ursachen: Object.fromEntries([...byReason].map(([r, list]) => [r, list.length])),
    ersterLauf: { linksGeloest: droppedLinks, linksErhalten: storedLinks.length - droppedLinks },
  };

  if (flag('json')) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const { bestand: b, zuordnung: z } = result;
  console.log(`\nBon-Matching: v1.11.0 vs. dieser Branch`);
  console.log(`Quelle: ${source}\n`);
  console.log('Bestand');
  console.log(`  Dokumente                ${b.dokumente}`);
  console.log(`  Bankbuchungen            ${b.bankbuchungen}`);
  console.log(`  Gmail-Rechnungen         ${b.gmailRechnungen}   davon mit Bon ${b.davonMitBon}`);
  console.log(`  Gespeicherte Bon-Links   ${b.gespeicherteLinks}\n`);
  console.log('Automatische Zuordnung');
  console.log(`  v1.11.0 (±2 €)           ${z.alt} / ${z.basis}   ${pct(z.alt, z.basis)}`);
  console.log(`  Branch  (centgenau)      ${z.neu} / ${z.basis}   ${pct(z.neu, z.basis)}`);
  console.log(`  Verloren                 ${z.verloren}`);
  console.log(`  Neu gewonnen             ${z.neuGewonnen}\n`);

  if (byReason.size) {
    console.log('Verlorene Zuordnungen nach Ursache (Mehrfachnennung möglich)');
    [...byReason].sort((a, b2) => b2[1].length - a[1].length).forEach(([reason, list]) => {
      console.log(`  ${reason.padEnd(32)} ${list.length}`);
      list.slice(0, sampleCount).forEach(({ gmail, oldMatch }) => {
        const bonTotal = gmail.bon.total ?? Math.abs(gmail.amount);
        console.log(`      ${gmail.date}  ${String(gmail.description).slice(0, 32).padEnd(32)}`
          + ` Bon ${Number(bonTotal).toFixed(2)}  Bank ${Math.abs(oldMatch.amount).toFixed(2)}`);
      });
    });
    console.log('');
  }

  console.log('Beim ersten Laden nach dem Deploy');
  console.log(`  Links, die erhalten bleiben  ${result.ersterLauf.linksErhalten}`);
  console.log(`  Links, die gelöst werden     ${result.ersterLauf.linksGeloest}`);
  if (!sampleCount) console.log('\n(--samples <n> zeigt Beispiele — enthält Händlernamen und Beträge.)');
  console.log('');
}

main().catch(err => { console.error(err); process.exit(1); });
