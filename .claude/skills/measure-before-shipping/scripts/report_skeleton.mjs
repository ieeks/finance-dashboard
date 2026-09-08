// report_skeleton.mjs — Gerüst für einen Wirkungs-Report.
//
// NUR LESEND. Kein Schreibpfad in die Datenquelle; Schreibfunktionen der
// gemessenen Implementierung werden gestubbt.
//
// Vier Stellen sind projektspezifisch und mit TODO markiert:
//   1. loadRecords()  — woher die echten Daten kommen
//   2. legacyRun()    — eingefrorene alte Implementierung
//   3. currentRun()   — die echte neue Implementierung (importieren, nicht nachbauen)
//   4. probes         — je Gate eine Sonde für die Ursachenanalyse
//
// Aufruf:
//   node report_skeleton.mjs                     # gegen die echte Quelle
//   node report_skeleton.mjs --input daten.json  # gegen einen Export
//   node report_skeleton.mjs --dump daten.json   # Export für spätere Läufe sichern
//   node report_skeleton.mjs --samples 5         # Beispiele (enthalten Rohdaten!)
//   node report_skeleton.mjs --json              # maschinenlesbar

import fs from 'node:fs';

const argv = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const flag = name => argv.includes(`--${name}`);
const sampleCount = Number(opt('samples', 0)) || 0;

// Ein Stand ohne die neuen Regeln kann nichts vergleichen — lieber laut
// abbrechen als still den alten Stand mit sich selbst messen.
export function requireNewImplementation(mod, names) {
  for (const name of names) {
    if (typeof mod?.[name] !== 'function') {
      console.error(`${name}() fehlt in diesem Stand — es gibt nichts zu vergleichen.`);
      console.error('Den Branch mit der Änderung auschecken bzw. im Workflow als Branch wählen.');
      process.exit(1);
    }
  }
}

// ── 1. Daten ──────────────────────────────────────────────────────────────
async function loadRecords() {
  const input = opt('input');
  if (input) return { rows: JSON.parse(fs.readFileSync(input, 'utf8')), source: input };

  // TODO: echte Quelle anbinden (DB, API, Export). Nur lesen.
  //   const rows = await db.collection('...').get();
  //   Zugangsdaten aus der Umgebung, nie im Code.
  throw new Error('loadRecords(): Datenquelle noch nicht angebunden — oder --input nutzen.');
}

// ── 2./3. Die beiden Läufe ────────────────────────────────────────────────
// Beide geben dieselbe Struktur zurück: Map<fallId, ergebnis>. Was ein „Fall"
// ist, hängt vom Projekt ab (eine Rechnung, ein Datensatz, eine Zeile).

function legacyRun(records) {
  // TODO: eingefrorene Kopie des alten Standes verwenden:
  //   git show <ref>:<pfad> > legacy/<name>-<version>.mjs
  // Nicht nachbauen — sonst misst der Report den Nachbau.
  throw new Error('legacyRun(): eingefrorene Referenz fehlt.');
}

async function currentRun(records) {
  // TODO: den echten neuen Code ausführen. Bevorzugt importieren; wenn die
  // Funktion nicht exportiert ist, aus der Quelldatei ziehen und in einem
  // Sandkasten (node:vm) laufen lassen — mit gestubbten Schreibfunktionen.
  throw new Error('currentRun(): neue Implementierung nicht angebunden.');
}

// ── 4. Ursachen ───────────────────────────────────────────────────────────
// Je Gate genau eine Sonde: hebe es einzeln auf und frage erneut. Greift es
// dann, war dieses Gate der Grund. Mehrfachnennung ist erwünscht.
function diagnose(record, hits) {
  const reasons = [];
  // TODO: eigene Gates ergänzen, z.B.
  //   if (hits({ ...record, filterFeld: undefined })) reasons.push('Filter X');
  //   if (hits({ ...record, schwelle: gelockert }))   reasons.push('Schwelle Y');
  if (!reasons.length) reasons.push('mehrere Gates / kein einzelnes erklärt es');
  return reasons;
}

// ── Bericht ───────────────────────────────────────────────────────────────
const pct = (n, total) => (total ? `${(n / total * 100).toFixed(1)} %` : '—');

async function main() {
  const { rows, source } = await loadRecords();
  const dump = opt('dump');
  if (dump) fs.writeFileSync(dump, JSON.stringify(rows, null, 2));

  const before = legacyRun(structuredClone(rows));
  const after  = await currentRun(structuredClone(rows));

  const lost = [], won = [];
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    if (before.has(id) && !after.has(id)) lost.push(id);
    if (!before.has(id) && after.has(id)) won.push(id);
  }

  const byReason = new Map();
  // TODO: hits() aus der neuen Implementierung heraus bauen und je verlorenem
  // Fall diagnose() aufrufen; Ergebnisse hier einsammeln.

  const result = {
    quelle: source,
    bestand: { faelle: rows.length },
    quote: { alt: before.size, neu: after.size, verloren: lost.length, gewonnen: won.length },
    ursachen: Object.fromEntries([...byReason].map(([r, l]) => [r, l.length])),
    // TODO: was am gespeicherten Zustand hängt — die eigentliche Entscheidungszahl.
    ersterLauf: { erhalten: null, verloren: null },
  };

  if (flag('json')) { console.log(JSON.stringify(result, null, 2)); return; }

  console.log('\nWirkung: alter vs. neuer Stand');
  console.log(`Quelle: ${source}\n`);
  console.log('Bestand');
  console.log(`  Fälle                    ${result.bestand.faelle}\n`);
  console.log('Trefferquote');
  console.log(`  alt                      ${before.size}   ${pct(before.size, rows.length)}`);
  console.log(`  neu                      ${after.size}   ${pct(after.size, rows.length)}`);
  console.log(`  verloren                 ${lost.length}`);
  console.log(`  neu gewonnen             ${won.length}\n`);

  if (byReason.size) {
    console.log('Verluste nach Ursache (Mehrfachnennung möglich)');
    [...byReason].sort((a, b) => b[1].length - a[1].length)
      .forEach(([reason, list]) => console.log(`  ${reason.padEnd(34)} ${list.length}`));
    console.log('');
  }

  console.log('Beim ersten Lauf nach dem Deploy');
  console.log(`  bleibt erhalten          ${result.ersterLauf.erhalten}`);
  console.log(`  geht verloren            ${result.ersterLauf.verloren}`);
  if (!sampleCount) console.log('\n(--samples <n> zeigt Beispiele — enthält Rohdaten.)');
  console.log('');
}

main().catch(err => { console.error(err.message); process.exit(1); });
