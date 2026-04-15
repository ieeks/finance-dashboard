// categories.js — Kanonische Kategorie-Konfiguration

export const CAT_CONFIG = {
  'Supermarkt':          { icon: '🛒', color: '#7B5723' },
  'Restaurant / Café':   { icon: '🍽️', color: '#c44b28' },
  'Mobilität / Auto':    { icon: '🚗', color: '#534346' },
  'Wohnen / Miete':      { icon: '🏠', color: '#41051F' },
  'Energie / Strom':     { icon: '⚡', color: '#f59e0b' },
  'Versicherung':        { icon: '🛡️', color: '#6366f1' },
  'Gesundheit':          { icon: '❤️', color: '#e11d48' },
  'Online Shopping':     { icon: '📦', color: '#0ea5e9' },
  'Freizeit':            { icon: '🎮', color: '#22c55e' },
  'Gehalt / Einnahmen':  { icon: '💰', color: '#2D6A4F' },
  'Gebühren / Bank':     { icon: '🏦', color: '#857276' },
  'Sonstiges':           { icon: '📌', color: '#534346' },
};

export const SUBCAT_ICONS = {
  'Milchprodukte':      '🥛',
  'Süßwaren':           '🍫',
  'Süßwaren / Naschen': '🍫',
  'Backwaren':          '🍞',
  'Getränke':           '🥤',
  'Fleisch':            '🥩',
  'Fleisch & Wurst':    '🥩',
  'Obst & Gemüse':      '🥦',
  'Tiefkühl':           '🧊',
  'Hygiene':            '🧴',
  'Hygiene & Drogerie': '🧴',
  'Putzmittel':         '🧹',
  'Elektronik':         '💻',
  'Dienstleistung':     '🔧',
  'Sonstiges':          '📦',
};

export const ALL_CATEGORIES    = Object.keys(CAT_CONFIG);
export const ALL_SUBCATEGORIES = Object.keys(SUBCAT_ICONS);
