// categories.js — Kanonische Kategorie-Konfiguration

import { LANDLORD } from './personalConfig.js';

export const CAT_CONFIG = {
  'Supermarkt':          { icon: '🛒', color: '#7B5723' },
  'Restaurant / Café':   { icon: '🍽️', color: '#c44b28' },
  'Mobilität / Auto':    { icon: '🚗', color: '#534346' },
  'Wohnen / Miete':      { icon: '🏠', color: '#41051F' },
  'Energie / Strom':     { icon: '⚡', color: '#f59e0b' },
  'Versicherung':        { icon: '🛡️', color: '#6366f1' },
  'Gesundheit':          { icon: '❤️', color: '#e11d48' },
  'Drogerie':            { icon: '🧴', color: '#a855f7' },
  'Online Shopping':     { icon: '📦', color: '#0ea5e9' },
  'Freizeit':            { icon: '🎮', color: '#22c55e' },
  'Gehalt / Einnahmen':  { icon: '💰', color: '#2D6A4F' },
  'Familientransfer':    { icon: '👨‍👩‍👧', color: '#2D6A4F' },
  'Gebühren / Bank':     { icon: '🏦', color: '#857276' },
  'Telekommunikation':   { icon: '📱', color: '#0ea5e9' },
  'Sonstiges':           { icon: '📌', color: '#534346' },
};

export const SUBCAT_ICONS = {
  'Milchprodukte':         '🥛',
  'Süßwaren / Naschen':    '🍫',
  'Backwaren':             '🍞',
  'Getränke':              '🥤',
  'Fleisch & Wurst':       '🥩',
  'Fisch / Meeresfrüchte': '🐟',
  'Obst & Gemüse':         '🥦',
  'Nudeln & Reis':         '🍝',
  'Restaurant':            '🍽️',
  'Öl':                    '🫙',
  'Aufstriche & Butter':   '🧈',
  'Gewürze & Saucen':      '🧂',
  'Konserven':             '🥫',
  'Tiefkühl':              '🧊',
  'Hygiene & Drogerie':    '🧴',
  'Putzmittel':            '🧹',
  'Pfand':                 '♻️',
  'Elektronik':            '💻',
  'Dienstleistung':        '🔧',
  'Sonstiges':             '📦',
};

export const ALL_CATEGORIES    = Object.keys(CAT_CONFIG);
export const ALL_SUBCATEGORIES = Object.keys(SUBCAT_ICONS);

// Alte/abweichende Subkat-Namen → kanonisch.
// Mirror von `_SUBCAT_ALIASES` in gmail_finance_importer.py.
export const SUBCAT_ALIASES = {
  'Brot & Backwaren':    'Backwaren',
  'Hygiene':             'Hygiene & Drogerie',
  'Fleisch':             'Fleisch & Wurst',
  'Reis':                'Nudeln & Reis',
  'Süßwaren':            'Süßwaren / Naschen',
  'Fisch':               'Fisch / Meeresfrüchte',
  'Restaurant / Gericht':'Restaurant',
};

// Mappt Alias auf kanonisch. Unbekannte Werte bleiben unverändert
// (kein Sonstiges-Fallback — wir wollen keine echten Daten verlieren).
export function normalizeSubcategory(value) {
  const v = String(value || '').trim();
  return SUBCAT_ALIASES[v] || v;
}

// Amount-based subscription rules — applied after parsing
// amount: exact absolute value to match (±0.01 tolerance)
export const RECURRING_RULES = [
  { pattern: new RegExp(`Miete \\/ Hausverwaltung|${LANDLORD.vendorPattern.source}`, 'i'), label: 'Miete' },
  { pattern: /Magenta Mobil/i,                                        label: 'Magenta Mobil',       category: 'Telekommunikation' },
  { pattern: /Magenta Festnetz/i,                                     label: 'Magenta Festnetz',    category: 'Telekommunikation' },
  { pattern: /Allianz.*Elementar|AEV\d+|Allianz KFZ/i,               label: 'Allianz KFZ',         category: 'Mobilität / Auto' },
  { pattern: /Allianz/i,                                              label: 'Allianz Versicherung',category: 'Versicherung' },
  { pattern: /Raiffeisen.Leasing/i,                label: 'BYD Leasing' },
  { pattern: /Netflix/i,                           label: 'Netflix' },
  { pattern: /Spotify/i,                           label: 'Spotify' },
];

export const BON_EXCLUDED_COMPANIES = [
  'T-Mobile Austria GmbH',
  'Helvetia Versicherungen AG',
  'Tesla',
  'Wien Energie Vertrieb GmbH & Co KG',
  'STURM ENERGIE',
];

export const SUBSCRIPTION_RULES = [
  { pattern: /paypal/i, amount: 19.99, name: 'Netflix',          category: 'Freizeit' },
  { pattern: /paypal/i, amount: 16.99, name: 'Spotify',          category: 'Freizeit' },
  { pattern: /paypal/i, amount:  8.99, name: 'Spotify (Solo)',   category: 'Freizeit' },
  { pattern: /paypal/i, amount: 17.99, name: 'Amazon Prime',     category: 'Online Shopping' },
];
