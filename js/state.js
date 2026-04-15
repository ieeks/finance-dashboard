// state.js — Zentraler App-State

const STORAGE_KEY = 'finance_v2_data';

function _getCurrentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}

function _loadFromStorage() {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s) return JSON.parse(s);
  } catch(e) {}
  return {
    transactions: [],
    accounts: [
      { id: 'bawag',    name: 'BAWAG Girokonto',    iban: 'AT45 •••••••••• 8821', balance: null, lastImport: null, color: '#41051F', initial: 'B' },
      { id: 'easybank', name: 'easybank Sparkonto',  iban: 'AT12 •••••••••• 4590', balance: null, lastImport: null, color: '#4a7c59', initial: 'e' },
    ],
    currentMonth: _getCurrentMonth(),
    aiProvider: 'anthropic',
  };
}

export const state = _loadFromStorage();

export function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch(e) {}
}

// Observer pattern
const _listeners = [];
export function subscribe(fn) { _listeners.push(fn); }
export function setState(patch) {
  Object.assign(state, patch);
  saveState();
  _listeners.forEach(fn => fn(state));
}

// Month helpers
export function getCurrentMonth() {
  return _getCurrentMonth();
}

export function getMonthLabel(ym) {
  const [y, m] = ym.split('-');
  const d = new Date(parseInt(y), parseInt(m)-1, 1);
  return d.toLocaleDateString('de-AT', { month: 'short', year: 'numeric' });
}

export function getAvailableMonths() {
  const months = new Set(state.transactions.map(t => t.date.slice(0,7)));
  months.add(_getCurrentMonth());
  return Array.from(months).sort().reverse();
}

export function getTransactionsForMonth(ym) {
  return state.transactions.filter(t => t.date.startsWith(ym));
}
