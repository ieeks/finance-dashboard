// state.js — Zentraler App-State

const STORAGE_KEY = 'finance_v2_data';

// Karten → Konto-Mapping (last4 → { accountId, owner })
// Karten sind Zugriffswege auf ein Konto, keine eigenen Konten.
export const CARD_CONFIG = {
  '5676': { accountId: 'haushalt',      owner: 'Olga',               },
  '6562': { accountId: 'haushalt',      owner: 'Manuel',             },
  '0522': { accountId: 'haushalt',      owner: 'Manuel (Apple Watch)'},
  '0678': { accountId: 'haushalt',      owner: 'Olga',               },
  '6351': { accountId: 'privat_olga',   owner: 'Olga',               },
  '4575': { accountId: 'privat_manuel', owner: 'Manuel (iPhone)',     },
};

const DEFAULT_ACCOUNTS = [
  {
    id:         'haushalt',
    name:       'Haushaltskonto',
    bank:       'Easybank',
    iban:       'AT98 1420 0200 1299 7630',
    balance:    null,
    lastImport: null,
    color:      '#41051F',
    initial:    'H',
  },
  {
    id:         'privat_olga',
    name:       'Privatkonto Olga',
    bank:       'Easybank',
    iban:       'AT11 1420 0200 1220 1177',
    balance:    null,
    lastImport: null,
    color:      '#7B5723',
    initial:    'O',
  },
  {
    id:         'privat_olga_erste',
    name:       'Privatkonto Olga',
    bank:       'Erste Bank',
    iban:       'AT77 2011 1840 2138 1900',
    balance:    null,
    lastImport: null,
    color:      '#5D6B3A',
    initial:    'O',
  },
  {
    id:         'privat_manuel',
    name:       'Privatkonto Manuel',
    bank:       'Erste Bank',
    iban:       'AT79 2011 1841 7364 1600',
    balance:    null,
    lastImport: null,
    color:      '#172213',
    initial:    'M',
  },
];

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
    pendingBons: [],
    categoryOverrides: {},
    subcategoryOverrides: {},
    accounts: DEFAULT_ACCOUNTS,
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
