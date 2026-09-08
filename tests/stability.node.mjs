// Regressionen der App-Datenflüsse, ohne Firebase/API-Zugriff und ohne neue Dependencies.
// Originalfunktionen aus app.js laufen mit kleinen DOM-/Speicher-Doubles.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { parseBankStatement, newBankTransactions } from '../js/parser.js';
import { findMatch, bonNeedsReview } from '../js/matcher.js';
import { formatEur, formatMoney, formatDate, escHtml } from '../js/ui.js';
const source = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const section = (start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `App-Funktion fehlt: ${start}`);
  return source.slice(a, b);
};
const tx = (id, extra = {}) => ({ id, date: '2026-08-15', description: 'Billa', amount: -100,
  account: 'haushalt', category: 'Supermarkt', ...extra });
const invoice = (id, extra = {}) => tx(id, { source: 'gmail_import',
  bon: { source: 'gmail_import', date: '2026-08-15', vendor: 'Billa', total: 100,
    items: [{ name: 'Produkt', price: 100, subcategory: 'Sonstiges' }] }, ...extra });
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log(`  ✓ ${name}`); }
function app() {
  const elements = new Map(), logs = [], writes = [], imports = [];
  const element = id => {
    if (!elements.has(id)) elements.set(id, { textContent: '', innerHTML: '', value: '', style: {},
      classList: { add() {}, remove() {}, toggle() {} }, querySelectorAll() { return []; },
      addEventListener(event, fn) { this[event] = fn; } });
    return elements.get(id);
  };
  const c = { console, Blob, crypto: webcrypto, findMatch, bonNeedsReview, newBankTransactions,
    formatEur, formatMoney, formatDate, escHtml,
    state: { transactions: [], pendingBons: [], accounts: [{ id: 'haushalt', name: 'Test', initial: 'T' }],
      currentMonth: '2026-08', categoryOverrides: {}, subcategoryOverrides: {} },
    selectedPdfFiles: [{ name: 'test.pdf', arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }],
    document: { getElementById: element, querySelector: () => ({ dataset: { accId: 'haushalt' } }),
      createElement: () => ({ click() {} }) },
    URL: { createObjectURL(blob) { c.blob = blob; return 'blob:test'; }, revokeObjectURL() {} },
    todayIso: () => '2026-09-08', saveState() {}, showLoading() {}, hideLoading() {}, setStep() {},
    showToast: s => logs.push(s), updateImportStatus: (...s) => { c.status = s; },
    renderDashboard() {}, renderKonten() {}, _renderDatenpflege() {}, renderBuchungen() {},
    _autoLinkGmailBons: async () => {}, extractPdfText: async () => '',
    parseBankStatement: () => [tx('parsed')], categorizeWithAI: async rows => rows,
    checkImportExists: async () => false, saveTxBatch: async rows => writes.push(rows),
    saveImport: async (id, meta) => imports.push({ id, ...meta }), updateTx: async () => {},
    fsDeletePendingBon: async () => {}, applySubcatOverrides: items => items.map(i => ({ ...i,
      subcategory: c.state.subcategoryOverrides[i.name.toLowerCase()] || i.subcategory })),
    getAvailableMonths: () => ['2026-08'], CAT_CONFIG: { Supermarkt: { icon: 'x' } },
    _buchFilter: { konto: 'alle', beleg: 'alle', typ: 'alle', cats: [], quelle: 'alle' }, closeClearModal() {},
  };
  c.window = c; vm.createContext(c);
  const load = (a, b) => vm.runInContext(section(a, b), c);
  const loadImport = () => load('let _importRunning =', '\nfunction setStep');
  const loadLink = () => { load('async function _autoLinkGmailBons()', '\nfunction _initApp');
    load('function findRechnungMatch(', '\nwindow.deleteRechnung'); };
  return { c, element, logs, writes, imports, load, loadImport, loadLink };
}
console.log('\nStabilität — Import, Belege und Auswertung');
await check('Zwei gleichlautende Bankzeilen bleiben zwei Zahlungen', () => {
  const rows = parseBankStatement('15.08.2026 Billa -10,00\n15.08.2026 Billa -10,00');
  assert.equal(rows.length, 2); assert.equal(rows.reduce((s, t) => s + t.amount, 0), -20);
});
await check('Dublettenprüfung trennt Quellen und Konten und erhält Häufigkeiten', () => {
  assert.equal(newBankTransactions([tx('n')], [invoice('g'), tx('other', { account: 'privat' })], 'haushalt').length, 1);
  assert.equal(newBankTransactions([tx('n1'), tx('n2')], [tx('old')], 'haushalt').length, 1);
});
await check('Gmail-Rechnung verdrängt keine spätere Bankbuchung', async () => {
  const a = app(); a.c.state.transactions = [invoice('gmail')]; a.loadImport(); await a.c.runImport();
  assert.equal(a.writes[0].length, 1); assert.equal(a.imports[0].txCount, 1);
});
await check('Fehlgeschlagener Write erzeugt weder Importmarker noch Erfolg', async () => {
  const a = app(); a.c.saveTxBatch = async () => { throw Error('Speichern fehlgeschlagen'); };
  a.loadImport(); await a.c.runImport();
  assert.equal(a.imports.length, 0); assert.equal(a.c.state.transactions.length, 0);
  assert.equal(a.c.selectedPdfFiles.length, 1); assert.ok(a.logs.some(s => s.includes('fehlgeschlagen')));
  assert.ok(!a.logs.some(s => s.startsWith('✓')));
});
await check('Wiederholung nach Teilabbruch verwendet dieselben Buchungs-IDs', async () => {
  const a = app(), ids = []; let fail = true;
  a.c.saveTxBatch = async rows => { ids.push(rows.map(t => t.id)); if (fail) { fail = false; throw Error('offline'); } };
  a.loadImport(); await a.c.runImport(); await a.c.runImport();
  assert.deepEqual(ids[0], ids[1]); assert.equal(a.c.state.transactions.length, 1);
});
await check('Fehlender Importmarker kann ohne doppelte Buchungen nachgeholt werden', async () => {
  const a = app(); let fail = true;
  a.c.saveImport = async (...args) => { if (fail) { fail = false; throw Error('offline'); } a.imports.push(args); };
  a.loadImport(); await a.c.runImport(); await a.c.runImport();
  assert.equal(a.c.state.transactions.length, 1); assert.equal(a.imports.length, 1);
});
await check('Offener Bon ohne Kaufdatum und mit Firestore-Timestamp blockiert keinen Import', async () => {
  const a = app(); a.c.state.pendingBons = [{ id: 'bon', date: null, savedAt: { seconds: 1 }, total: 100 }];
  a.loadImport(); await a.c.runImport(); assert.equal(a.imports.length, 1);
  assert.equal(a.c.state.pendingBons.length, 1);
});
await check('Kontensumme zählt nur Bankbuchungen, CSV hat Semikolon und keine Gmail-Duplikate', async () => {
  const a = app(); a.c.state.transactions = [tx('bank'), invoice('gmail')];
  a.load('function renderKonten()', '\nfunction _renderDatenpflege'); a.c.renderKonten();
  assert.equal(a.element('gesamtvermoegen').textContent, formatEur(-100));
  a.load('window.exportCSV =', '\n// ── API Keys'); a.c.exportCSV();
  const lines = (await a.c.blob.text()).split('\n'); assert.equal(lines.length, 2);
  assert.equal(lines[1].split(';').length, 5); assert.ok(lines[1].includes('"-100,00"'));
});
await check('Bekanntes Konto begrenzt das Matching', () => {
  const match = findMatch({ date: '2026-08-15', total: 100, store: 'Billa', account: 'privat' },
    [tx('wrong'), tx('right', { account: 'privat' })]);
  assert.equal(match.transaction.id, 'right');
});
await check('Gmail, Fremdwährung und Prüfbelege werden nicht automatisch gematcht', () => {
  const bon = { date: '2026-08-15', total: 100, store: 'Billa' };
  assert.equal(findMatch(bon, [invoice('gmail')]), null);
  assert.equal(findMatch({ ...bon, currency: 'USD' }, [tx('bank')]), null);
  assert.equal(findMatch({ ...bon, needsReview: true }, [tx('bank')]), null);

});
await check('Unvollständige Positionen erlauben nur eindeutiges Matching mit Händlerbezug', () => {
  const bon = { date: '2026-08-15', total: 100, store: 'Billa', items: [{ gesamt: 80 }] };
  assert.equal(findMatch(bon, [tx('bank')]).transaction.id, 'bank');
  assert.equal(findMatch(bon, [tx('bank', { description: 'OMV' })]), null);
  assert.equal(findMatch(bon, [tx('a'), tx('b')]), null);
  assert.equal(findMatch({ ...bon, items: [], itemsReview: true }, [tx('bank')]).transaction.id, 'bank');
  assert.equal(findMatch({ ...bon, needsReview: true }, [tx('bank')]), null);
});
await check('Gmail-Bon ohne Positionen wird gespeichertem Bankbeleg mit Prüfhinweis zugeordnet', async () => {
  const a = app(), g = invoice('gmail');
  g.itemsReview = true;
  g.bon.items = [];
  g.bon.itemsReview = true;
  a.c.state.transactions = [tx('bank'), g];
  a.loadLink(); await a.c._autoLinkGmailBons();
  assert.equal(a.c.state.transactions[0].bon.invoiceId, 'gmail');
  assert.equal(a.c.state.transactions[0].bon.itemsReview, true);
});
await check('Schon ein Cent Bankabweichung blockiert trotz passendem Händler und Datum', () => {
  const bon = { date: '2026-08-15', total: 100, store: 'Billa' };
  for (const amount of [-99.99, -100.01, -98, -102]) {
    assert.equal(findMatch(bon, [tx('bank', { amount })]), null);
  }
});
await check('Rechnungsstatus zeigt nur wirklich verknüpfte Belege', async () => {
  const a = app(); a.c.state.transactions = [tx('bank'), invoice('g1'), invoice('g2')];
  a.loadLink(); await a.c._autoLinkGmailBons();
  assert.equal(a.c.state.transactions.filter(t => t.source === 'gmail_import' && a.c.findRechnungMatch(t)).length, 1);
});
await check('Manuelle Bon-Korrektur bleibt bei erneutem Verknüpfen erhalten', async () => {
  const a = app(), g = invoice('gmail');
  a.c.state.transactions = [tx('bank', { bon: { ...structuredClone(g.bon), invoiceId: g.id,
    items: [{ name: 'Produkt', price: 100, subcategory: 'Milchprodukte' }] } }), g];
  a.loadLink(); await a.c._autoLinkGmailBons();
  assert.equal(a.c.state.transactions[0].bon.items[0].subcategory, 'Milchprodukte');
});
await check('Trinkgeld im Gmail-Bon matcht den gesamten Kartenbetrag', async () => {
  const a = app(), g = invoice('gmail'); g.bon.tip = 5; g.amount = -105;
  a.c.state.transactions = [tx('bank', { amount: -105 }), g];
  a.loadLink(); await a.c._autoLinkGmailBons();
  assert.equal(a.c.state.transactions[0].bon.invoiceId, 'gmail');
  assert.ok(a.c.findRechnungMatch(g));
});
await check('Nach fehlgeschlagenem Queue-Löschen wird ein Bon nicht zweimal zugeordnet', async () => {
  const a = app(), bon = { id: 'pending', date: '2026-08-15', total: 100, store: 'Billa' };
  a.c.state.transactions = [tx('linked', { bon }), tx('other')]; a.c.state.pendingBons = [bon];
  let removed = false; a.c.fsDeletePendingBon = async () => { removed = true; };
  a.loadImport(); await a.c.runImport();
  assert.ok(removed); assert.equal(a.c.state.pendingBons.length, 0);
  assert.equal(a.c.state.transactions.filter(t => t.bon?.id === 'pending').length, 1);
});
await check('Prüfbedürftiger Alt-Link wird nicht gelöscht', async () => {
  // Der gespeicherte Bon scheitert am Zahlbetrag-Gate — findMatch() würde ihn nie
  // wieder zuordnen. Genau deshalb darf die bestehende Verknüpfung nicht wegfallen.
  const a = app(), g = invoice('gmail');
  g.bon.needsReview = true;
  a.c.state.transactions = [tx('bank', { bon: { ...structuredClone(g.bon), invoiceId: g.id } }), g];
  const cleared = []; a.c.updateTx = async (id, patch) => { cleared.push([id, patch]); };
  a.loadLink(); await a.c._autoLinkGmailBons();
  assert.equal(a.c.state.transactions[0].bon.invoiceId, 'gmail');
  assert.equal(cleared.filter(([, patch]) => patch.bon === null).length, 0);
  // Gegenprobe: ein sauberer Bon ohne Match wird weiterhin gelöst.
  const b = app(), g2 = invoice('gmail');
  b.c.state.transactions = [tx('bank', { date: '2026-01-01',
    bon: { ...structuredClone(g2.bon), invoiceId: g2.id } }), g2];
  const cleared2 = []; b.c.updateTx = async (id, patch) => { cleared2.push([id, patch]); };
  b.loadLink(); await b.c._autoLinkGmailBons();
  assert.equal(cleared2.length, 1);
  assert.equal(cleared2[0][0], 'bank');
  assert.equal(cleared2[0][1].bon, null);
});
await check('Geschützte Alt-Links sind vor konkurrierenden Rechnungen reserviert', async () => {
  for (const onCurrent of [false, true]) {
    const a = app(), g = invoice('old');
    const prev = { ...structuredClone(g.bon), invoiceId: g.id };
    if (onCurrent) { g.needsReview = true; g.bon.needsReview = true; }
    else prev.needsReview = true;
    const writes = []; a.c.updateTx = async (id, patch) => writes.push({ id, patch });
    a.c.state.transactions = [tx('bank', { bon: prev }), invoice('other'), g];
    a.loadLink(); await a.c._autoLinkGmailBons();
    assert.equal(a.c.state.transactions[0].bon.invoiceId, 'old');
    assert.equal(writes.length, 0);
    assert.equal(a.c.findRechnungMatch(g).transaction.id, 'bank');
    assert.equal(a.c.findRechnungMatch(a.c.state.transactions[1]), null);
  }
});
await check('Reservierte Rechnung wird nicht zusätzlich an freie Bankbuchung gehängt', async () => {
  const a = app(), g = invoice('old');
  const prev = { ...structuredClone(g.bon), invoiceId: g.id, needsReview: true };
  a.c.state.transactions = [tx('bank', { bon: prev }), tx('free'), g];
  a.loadLink(); await a.c._autoLinkGmailBons();
  assert.equal(a.c.state.transactions.filter(t => t.bon?.invoiceId === g.id).length, 1);
});
await check('Gelöschte letzte Gmail-Rechnung löst auch einen Prüf-Link', async () => {
  const a = app(), g = invoice('gone'), writes = [];
  a.c.state.transactions = [tx('bank', { bon: { ...g.bon, invoiceId: g.id, needsReview: true } })];
  a.c.updateTx = async (id, patch) => writes.push(patch);
  a.loadLink(); await a.c._autoLinkGmailBons();
  assert.equal(a.c.state.transactions[0].bon, null);
  assert.equal(writes[0].bon, null);
});
await check('Fehlende Kontoauswahl blockiert Import vor jedem Schreibzugriff', async () => {
  const a = app(); a.c.state.accounts.push({ id: 'privat', name: 'Privat' });
  a.c.document.querySelector = () => null;
  a.loadImport(); await a.c.runImport();
  assert.equal(a.writes.length, 0); assert.equal(a.imports.length, 0);
  assert.ok(a.logs.some(s => s.includes('Konto')));
});
await check('Einzelnes Privatkonto wird verwendet, Konto bleibt während Import stabil', async () => {
  const a = app(); a.c.state.accounts = [{ id: 'privat', name: 'Privat' }];
  a.c.document.querySelector = () => null;
  a.loadImport(); await a.c.runImport();
  assert.equal(a.c.state.transactions[0].account, 'privat');
  const b = app(); b.c.state.accounts.push({ id: 'privat', name: 'Privat' });
  let selected = 'privat'; b.c.document.querySelector = () => ({ dataset: { accId: selected } });
  b.c.selectedPdfFiles.push({ name: 'second.pdf', arrayBuffer: async () => new Uint8Array([4]).buffer });
  const originalSave = b.c.saveTxBatch;
  b.c.saveTxBatch = async rows => { selected = 'haushalt'; await originalSave(rows); };
  b.loadImport(); await b.c.runImport();
  assert.ok(b.c.state.transactions.every(t => t.account === 'privat'));
  assert.ok(b.imports.every(i => i.id.startsWith('privat_')));
});
await check('Filter anwenden behält den gewählten Monat', () => {
  const a = app(); a.load('function initBuchFilters()', '\n// ── Month Picker Bottom Sheet');
  a.c.initBuchFilters(); a.c.openBuchFilterSheet(); a.element('buchFilterApply').click();
  assert.equal(a.c.state.currentMonth, '2026-08');
});
console.log(`✅ ${passed}/${passed} Stabilitätstests bestanden`);
