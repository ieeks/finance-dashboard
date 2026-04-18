// app.js — Entry Point
import { state, saveState, getCurrentMonth, getMonthLabel, getAvailableMonths, getTransactionsForMonth } from './state.js';
import { CAT_CONFIG, SUBCAT_ICONS } from './categories.js';
import { formatEur, formatDate, escHtml, loadKeys, saveKey, showToast, showLoading, hideLoading } from './ui.js';
import { extractPdfText, parseBankStatement, categorizeWithAI } from './parser.js';
import { analyzeBonImage, analyzeBonPdf, analyzeBonOpenAI, analyzeBonPdfOpenAI } from './bonAnalyzer.js';

// ── Navigation ──
window.showScreen = function(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('screen-' + name)?.classList.add('active');
  document.getElementById('nav-' + name)?.classList.add('active');
  window.scrollTo(0, 0);
  if (name === 'dashboard') renderDashboard();
  if (name === 'buchungen') renderBuchungen();
  if (name === 'konten')    renderKonten();
};

// ── Month Strip ──
function renderMonthStrip(containerId, onSelectName) {
  const months = getAvailableMonths();
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = months.map(m => `
    <div class="month-pill ${m === state.currentMonth ? 'active' : ''}"
         onclick="${onSelectName}('${m}')">
      ${getMonthLabel(m)}
    </div>`).join('');
}

window.setMonth = function(ym) {
  state.currentMonth = ym;
  saveState();
  renderDashboard();
};

window.setMonthBuch = function(ym) {
  state.currentMonth = ym;
  saveState();
  renderBuchungen();
};

// ── Dashboard ──
function renderDashboard() {
  renderMonthStrip('month-strip', 'setMonth');
  const txs     = getTransactionsForMonth(state.currentMonth);
  const income  = txs.filter(t => t.amount > 0).reduce((s,t) => s + t.amount, 0);
  const expense = txs.filter(t => t.amount < 0).reduce((s,t) => s + Math.abs(t.amount), 0);
  const saldo   = income - expense;

  document.getElementById('db-saldo').textContent    = txs.length ? formatEur(saldo)   : '—';
  document.getElementById('db-income').textContent   = txs.length ? formatEur(income)  : '—';
  document.getElementById('db-expense').textContent  = txs.length ? formatEur(expense) : '—';

  const changeEl = document.getElementById('db-saldo-change');
  if (txs.length) {
    changeEl.innerHTML = `<span class="chip ${saldo >= 0 ? 'chip-green' : 'chip-red'}">${saldo >= 0 ? '▲' : '▼'} ${formatEur(Math.abs(saldo))}</span>
      <span style="font-size:0.7rem;color:var(--text-muted);">Netto ${getMonthLabel(state.currentMonth)}</span>`;
  } else {
    changeEl.innerHTML = '';
  }

  document.getElementById('db-cta').style.display = txs.length ? 'none' : 'block';
  renderDashboardCategories(txs);
  renderFixkosten(txs);
  renderInsight(txs);
}

const DONUT_COLORS = ['#5D1C34','#7B5723','#A0714A','#C49A6C','#D7C1C5'];

function renderDonut(sorted, total) {
  const cx = 80, cy = 80, r = 54, sw = 22;
  const circ = 2 * Math.PI * r;
  let deg = -90;
  const slices = sorted.map(([, amt], i) => {
    const frac = amt / total;
    const dash = frac * circ;
    const slice = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
      stroke="${DONUT_COLORS[i] || '#ccc'}" stroke-width="${sw}"
      stroke-dasharray="${dash.toFixed(2)} ${(circ - dash).toFixed(2)}"
      transform="rotate(${deg} ${cx} ${cy})"/>`;
    deg += frac * 360;
    return slice;
  }).join('');
  return `<svg viewBox="0 0 160 160" width="120" height="120" style="display:block;flex-shrink:0;">
    ${slices}
  </svg>`;
}

function renderDashboardCategories(txs) {
  const el       = document.getElementById('db-categories');
  const expenses = txs.filter(t => t.amount < 0);
  if (!expenses.length) {
    el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:0.82rem;">Noch keine Daten — PDF importieren</div>';
    return;
  }
  const bycat  = {};
  expenses.forEach(t => { const c = t.category||'Sonstiges'; bycat[c]=(bycat[c]||0)+Math.abs(t.amount); });
  const sorted = Object.entries(bycat).sort((a,b) => b[1]-a[1]).slice(0,5);
  const total  = sorted.reduce((s,[,v]) => s+v, 0);
  const max    = sorted[0][1];

  const legend = sorted.map(([cat, amt], i) => {
    const pct = Math.round((amt / total) * 100);
    return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:5px;">
      <div style="width:8px;height:8px;border-radius:50%;background:${DONUT_COLORS[i]||'#ccc'};flex-shrink:0;"></div>
      <div style="font-size:0.68rem;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${cat}</div>
      <div style="font-size:0.68rem;font-weight:700;color:var(--text);margin-left:auto;white-space:nowrap;">${pct}%</div>
    </div>`;
  }).join('');

  const bars = sorted.map(([cat, amt], i) => {
    const cfg = CAT_CONFIG[cat] || CAT_CONFIG['Sonstiges'];
    const pct = Math.round((amt / max) * 100);
    return `<div class="cat-row">
      <div class="cat-icon-wrap">${cfg.icon}</div>
      <div style="flex:1;">
        <div class="cat-label">${cat}</div>
        <div class="cat-bar-wrap"><div class="cat-bar" style="width:${pct}%;background:${DONUT_COLORS[i]||'var(--outline)'}"></div></div>
      </div>
      <div class="cat-amount">${formatEur(amt)}</div>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid var(--outline-soft);">
      ${renderDonut(sorted, total)}
      <div style="flex:1;min-width:0;">${legend}</div>
    </div>
    ${bars}`;
}

function renderFixkosten(txs) {
  const el = document.getElementById('db-fixkosten');
  if (!el) return;
  const fixed = txs.filter(t => t.isRecurring && t.amount < 0);
  if (!fixed.length) { el.style.display = 'none'; return; }
  const total = fixed.reduce((s, t) => s + Math.abs(t.amount), 0);
  el.style.display = 'block';
  el.innerHTML = `
    <div class="section-label">Fixkosten</div>
    <div class="card" style="padding:0;">
      ${fixed.map(t => `
        <div class="cat-row" style="padding:12px 16px;border-bottom:1px solid var(--outline-soft);">
          <div class="cat-icon-wrap">${CAT_CONFIG[t.category]?.icon || '📌'}</div>
          <div style="flex:1;"><div class="cat-label">${escHtml(t.recurringLabel || t.description)}</div></div>
          <div style="font-family:var(--serif);font-weight:700;">${formatEur(Math.abs(t.amount))}</div>
        </div>`).join('')}
      <div class="cat-row" style="padding:12px 16px;background:var(--surface-variant);border-radius:0 0 16px 16px;">
        <div style="flex:1;font-size:0.75rem;font-weight:700;color:var(--text-muted);">GESAMT FIXKOSTEN</div>
        <div style="font-family:var(--serif);font-weight:700;">${formatEur(total)}</div>
      </div>
    </div>`;
}

function renderInsight(txs) {
  const el       = document.getElementById('db-insight');
  const expenses = txs.filter(t => t.amount < 0);
  const total    = expenses.reduce((s,t) => s + Math.abs(t.amount), 0);
  if (!total) { el.style.display = 'none'; return; }
  const bycat = {};
  expenses.forEach(t => { const c = t.category||'Sonstiges'; bycat[c]=(bycat[c]||0)+Math.abs(t.amount); });
  const top = Object.entries(bycat).sort((a,b) => b[1]-a[1])[0];
  const pct = Math.round((top[1]/total)*100);
  document.getElementById('db-insight-title').textContent = 'Ausgaben-Analyse';
  document.getElementById('db-insight-text').textContent  =
    `Ihre größte Ausgabenkategorie ist "${top[0]}" mit ${formatEur(top[1])} (${pct}% der Gesamtausgaben von ${formatEur(total)}). ${expenses.length} Buchungen diesen Monat.`;
  el.style.display = 'block';
}

// ── Buchungen ──
let _filterCat  = null;
let _filterCard = null;
let _filterBon  = null;

window.setCardFilter = function(who) {
  _filterCard = who;
  renderBuchungen();
  _updateClearBtn();
};

window.setBonFilter = function(val) {
  _filterBon = val;
  renderBuchungen();
  _updateClearBtn();
};

window.clearAllFilters = function() {
  _filterCat = null; _filterCard = null; _filterBon = null;
  const searchEl = document.getElementById('search-input');
  if (searchEl) searchEl.value = '';
  renderBuchungen();
};

function _updateClearBtn() {
  const hasFilter = _filterCat || _filterCard || _filterBon ||
                    (document.getElementById('search-input')?.value || '');
  const btn = document.getElementById('clear-filters-btn');
  if (btn) btn.style.display = hasFilter ? 'flex' : 'none';
}

function renderBuchungen() {
  _updateClearBtn();
  renderMonthStrip('month-strip-buch', 'setMonthBuch');
  const search = (document.getElementById('search-input')?.value || '').toLowerCase();

  // when searching, span all months; otherwise only current month
  let txs = search
    ? state.transactions.slice()
    : getTransactionsForMonth(state.currentMonth);

  if (search) {
    txs = txs.filter(t =>
      t.description.toLowerCase().includes(search) ||
      (t.category||'').toLowerCase().includes(search)
    );
  }
  if (_filterCat)             txs = txs.filter(t => t.category === _filterCat);
  if (_filterCard)            txs = txs.filter(t => t.cardHolder === _filterCard);
  if (_filterBon === 'linked') txs = txs.filter(t => !!t.bon);
  if (_filterBon === 'open')   txs = txs.filter(t => !t.bon && t.amount < 0);

  // update filter active states
  document.querySelectorAll('.filter-cat-chip').forEach(el => {
    el.classList.toggle('active', el.dataset.cat === (_filterCat || ''));
  });
  document.querySelectorAll('.filter-card-chip').forEach(el => {
    el.classList.toggle('active', el.dataset.card === (_filterCard || ''));
  });
  document.querySelectorAll('.filter-bon-chip').forEach(el => {
    el.classList.toggle('active', el.dataset.bon === (_filterBon || ''));
  });

  // summary bar when filter or search active
  const summaryEl = document.getElementById('buchungen-summary');
  if (summaryEl && (search || _filterCat || _filterCard)) {
    const total   = txs.reduce((s,t) => s + t.amount, 0);
    const expense = txs.filter(t=>t.amount<0).reduce((s,t)=>s+t.amount,0);
    const income  = txs.filter(t=>t.amount>0).reduce((s,t)=>s+t.amount,0);
    summaryEl.style.display = 'flex';
    summaryEl.innerHTML = `
      <div style="flex:1;text-align:center;">
        <div style="font-size:0.6rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:2px;">${txs.length} Buchungen</div>
        <div style="font-family:var(--serif);font-size:0.95rem;font-weight:700;color:${total>=0?'var(--green)':'var(--red)'};">${total>=0?'+':''}${formatEur(total)}</div>
      </div>
      ${income ? `<div style="flex:1;text-align:center;border-left:1px solid var(--outline-soft);">
        <div style="font-size:0.6rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:2px;">Einnahmen</div>
        <div style="font-family:var(--serif);font-size:0.95rem;font-weight:700;color:var(--green);">+${formatEur(income)}</div>
      </div>` : ''}
      ${expense ? `<div style="flex:1;text-align:center;border-left:1px solid var(--outline-soft);">
        <div style="font-size:0.6rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:2px;">Ausgaben</div>
        <div style="font-family:var(--serif);font-size:0.95rem;font-weight:700;color:var(--red);">${formatEur(Math.abs(expense))}</div>
      </div>` : ''}`;
  } else if (summaryEl) {
    summaryEl.style.display = 'none';
  }
  const el = document.getElementById('buchungen-list');
  if (!txs.length) {
    el.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">📭</div>
      <div class="empty-state-title">${search ? 'Keine Treffer' : 'Keine Buchungen'}</div>
      <div class="empty-state-text">${search ? 'Suche anpassen oder anderen Monat wählen.' : 'PDF importieren oder Demo-Daten laden.'}</div>
      ${!search ? '<button class="btn-primary" style="max-width:240px;margin:0 auto;" onclick="showScreen(\'import\')">📤 Importieren</button>' : ''}
    </div>`;
    return;
  }
  const groups = {};
  txs.forEach(t => { if (!groups[t.date]) groups[t.date]=[]; groups[t.date].push(t); });
  const sortedDates = Object.keys(groups).sort().reverse();
  const today     = new Date().toISOString().slice(0,10);
  const yesterday = new Date(Date.now()-86400000).toISOString().slice(0,10);
  el.innerHTML = sortedDates.map(date => {
    let label;
    if (date === today) label = 'Heute';
    else if (date === yesterday) label = 'Gestern';
    else label = formatDate(date);
    const items = groups[date].map(t => renderTxItem(t)).join('');
    return `<div class="tx-group-label">${label}</div>
      <div class="card" style="padding:0 16px;">${items}</div>`;
  }).join('');
}

function renderTxItem(tx) {
  const cfg      = CAT_CONFIG[tx.category] || CAT_CONFIG['Sonstiges'];
  const isIn     = tx.amount > 0;
  const chipClass = tx.category === 'Gehalt / Einnahmen' ? 'chip-green' : 'chip-gold';
  const aiTag    = tx.aiCategorized ? '<span class="chip chip-ai" style="padding:2px 6px;font-size:0.55rem;">✦ AI</span>' : '';
  const bonTag   = tx.bon  ? '<span style="font-size:0.7rem;">🧾</span>' : '';
  const noteTag  = tx.note ? '<span style="font-size:0.7rem;">💬</span>' : '';
  const avatar   = tx.cardHolder === 'manuel' ? '<span class="avatar-chip avatar-m">M</span>'
                 : tx.cardHolder === 'olga'   ? '<span class="avatar-chip avatar-o">O</span>'
                 : '';
  return `<div class="tx-item" onclick="openTxModal('${tx.id}')">
    <div class="tx-icon-wrap">${cfg.icon}</div>
    <div style="flex:1;min-width:0;">
      <div class="tx-name">${escHtml(tx.description)}</div>
      <div class="tx-meta">
        ${aiTag}${bonTag}${noteTag}
        <span class="chip ${chipClass}" style="padding:2px 8px;font-size:0.55rem;">${escHtml(tx.category||'Sonstiges')}</span>
        ${avatar}
        <span>${formatDate(tx.date)}</span>
      </div>
    </div>
    <div class="tx-amount ${isIn ? 'in' : 'out'}">${isIn ? '+' : '−'}${formatEur(Math.abs(tx.amount))}</div>
  </div>`;
}

window.toggleFilterPanel = function() {
  const panel = document.getElementById('filter-panel');
  if (!panel) return;
  const open = panel.style.display !== 'none';
  panel.style.display = open ? 'none' : 'block';
  if (!open) {
    const cats = ['Alle', ...Object.keys(CAT_CONFIG)];
    panel.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:8px;padding:12px 0 4px;">` +
      cats.map(c => `<button class="filter-cat-chip${(_filterCat === null && c === 'Alle') || _filterCat === c ? ' active' : ''}"
        data-cat="${c === 'Alle' ? '' : c}"
        onclick="setFilterCat('${c === 'Alle' ? '' : c}')"
        style="padding:6px 14px;border-radius:100px;border:1.5px solid var(--outline-soft);background:var(--surface-low);
               font-size:0.72rem;font-weight:600;cursor:pointer;font-family:var(--sans);color:var(--text-muted);
               transition:all 0.15s;">
        ${c === 'Alle' ? '✕ Alle' : (CAT_CONFIG[c]?.icon || '') + ' ' + c}
      </button>`).join('') +
    `</div>`;
  }
};

window.setFilterCat = function(cat) {
  _filterCat = cat || null;
  renderBuchungen();
  _updateClearBtn();
  document.querySelectorAll('.filter-cat-chip').forEach(el => {
    const isActive = (cat === '' && el.dataset.cat === '') || el.dataset.cat === cat;
    el.style.background    = isActive ? 'var(--primary-container)' : 'var(--surface-low)';
    el.style.color         = isActive ? 'var(--on-primary)' : 'var(--text-muted)';
    el.style.borderColor   = isActive ? 'var(--primary-container)' : 'var(--outline-soft)';
  });
};

// ── TX Modal ──
window.openTxModal = function(id) {
  const tx = state.transactions.find(t => t.id === id);
  if (!tx) return;
  const cfg   = CAT_CONFIG[tx.category] || CAT_CONFIG['Sonstiges'];
  const isIn  = tx.amount > 0;
  const catOptions = Object.keys(CAT_CONFIG).map(k =>
    `<option value="${k}" ${k === tx.category ? 'selected' : ''}>${CAT_CONFIG[k].icon} ${k}</option>`
  ).join('');
  document.getElementById('tx-modal-content').innerHTML = `
    <div style="display:flex;align-items:center;gap:16px;margin-bottom:20px;">
      <div style="width:52px;height:52px;border-radius:16px;background:var(--surface-mid);display:flex;align-items:center;justify-content:center;font-size:1.5rem;flex-shrink:0;">${cfg.icon}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:700;font-size:0.95rem;margin-bottom:4px;">${escHtml(tx.description)}</div>
        <div style="font-size:0.72rem;color:var(--text-muted);">${formatDate(tx.date)} · ${tx.account || 'Konto'}</div>
      </div>
    </div>
    <div style="font-family:var(--serif);font-size:2rem;font-weight:700;color:${isIn ? 'var(--green)' : 'var(--primary-container)'};margin-bottom:20px;">
      ${isIn ? '+' : '−'}${formatEur(Math.abs(tx.amount))}
    </div>
    <div style="margin-bottom:16px;">
      <div class="api-label" style="margin-bottom:8px;">Kategorie</div>
      <select class="cat-select" id="cat-edit-${id}" onchange="updateCategory('${id}', this.value)">${catOptions}</select>
    </div>
    ${tx.aiCategorized ? '<div style="display:flex;align-items:center;gap:6px;font-size:0.72rem;color:var(--text-muted);margin-bottom:16px;"><span class="chip chip-ai" style="padding:2px 8px;">✦ KI kategorisiert</span></div>' : ''}
    ${tx.bon ? `
    <div style="margin-bottom:16px;border-top:1px solid var(--outline-soft);padding-top:16px;">
      <div class="section-label" style="margin-bottom:10px;">🧾 ${escHtml(tx.bon.store || 'Kassenbon')}</div>
      ${(tx.bon.items||[]).map(item => {
        const sc = item.subcategory || item.subkategorie || '';
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--outline-soft);">
          <div style="flex:1;min-width:0;">
            <div style="font-size:0.82rem;font-weight:600;">${escHtml(item.name)}</div>
            ${sc ? `<div style="font-size:0.65rem;color:var(--text-muted);margin-top:2px;">${SUBCAT_ICONS[sc]||'📦'} ${escHtml(sc)}</div>` : ''}
          </div>
          <div style="font-family:var(--serif);font-size:0.88rem;font-weight:700;margin-left:12px;">${formatEur(item.gesamt ?? item.price ?? 0)}</div>
        </div>`;
      }).join('')}
      <div style="display:flex;justify-content:space-between;padding-top:10px;font-family:var(--serif);font-size:0.95rem;font-weight:700;">
        <span>Gesamt</span><span>${formatEur(tx.bon.total)}</span>
      </div>
    </div>` : ''}
    <div style="margin-bottom:16px;border-top:1px solid var(--outline-soft);padding-top:16px;">
      <div class="api-label" style="margin-bottom:8px;">Notiz</div>
      <textarea
        id="note-edit-${id}"
        onblur="saveNote('${id}', this.value)"
        placeholder="Kommentar hinzufügen…"
        style="width:100%;min-height:72px;background:var(--surface-high);border:1.5px solid var(--outline-soft);
               border-radius:var(--radius-sm);padding:10px 14px;font-family:var(--sans);font-size:0.85rem;
               color:var(--text);outline:none;resize:none;box-sizing:border-box;transition:border-color 0.15s;"
        onfocus="this.style.borderColor='var(--primary-container)'"
        onblur="this.style.borderColor='var(--outline-soft)';saveNote('${id}', this.value)"
      >${escHtml(tx.note || '')}</textarea>
    </div>
    <button class="btn-ghost" style="margin-top:4px;" onclick="closeTxModal()">Schließen</button>`;
  document.getElementById('tx-modal').classList.add('open');
};

window.closeTxModal = function() { document.getElementById('tx-modal').classList.remove('open'); };

window.updateCategory = function(id, newCat) {
  const tx = state.transactions.find(t => t.id === id);
  if (tx) { tx.category = newCat; tx.aiCategorized = false; saveState(); }
  showToast('Kategorie gespeichert');
  window.closeTxModal();
  renderBuchungen();
  renderDashboard();
};

window.saveNote = function(id, value) {
  const tx = state.transactions.find(t => t.id === id);
  if (!tx) return;
  const trimmed = value.trim();
  if (tx.note === trimmed) return;
  tx.note = trimmed;
  saveState();
  renderBuchungen();
};

// ── Clear / Settings Modal ──
window.openClearModal  = function() { document.getElementById('clear-modal').classList.add('open'); };
window.closeClearModal = function() { document.getElementById('clear-modal').classList.remove('open'); };
window.clearTransactions = function() {
  state.transactions = [];
  saveState();
  showToast('Alle Buchungen gelöscht');
  renderDashboard();
  renderBuchungen();
  renderKonten();
};

// ── Konten ──
function renderKonten() {
  const list        = document.getElementById('account-list');
  const accountData = state.accounts.map(acc => {
    const accTxs = state.transactions.filter(t => t.account === acc.id || t.account === acc.name);
    const balance = accTxs.reduce((s,t) => s + t.amount, 0);
    return { ...acc, computedBalance: balance, txCount: accTxs.length,
      lastDate: accTxs.length ? accTxs.map(t=>t.date).sort().reverse()[0] : null };
  });
  list.innerHTML = accountData.map(acc => {
    const hasData       = acc.txCount > 0;
    const lastImportTxt = acc.lastDate ? `Letzter Import: ${formatDate(acc.lastDate)} ›` : 'Noch keine Daten';
    const statusChip    = hasData
      ? '<span class="chip chip-green">● Aktiv</span>'
      : '<span class="chip chip-gold">Kein Import</span>';
    return `<div class="account-card">
      <div class="account-header">
        <div class="account-logo" style="background:${acc.color};font-size:0.9rem;">${acc.initial}</div>
        <div style="flex:1;">
          <div class="account-name">${escHtml(acc.name)}</div>
          <div class="account-iban">${escHtml(acc.iban)}</div>
        </div>
        ${statusChip}
      </div>
      <div>
        <div class="account-balance-label">Verfügbarer Saldo</div>
        <div class="account-balance">${hasData ? formatEur(acc.computedBalance) : '—'}</div>
      </div>
      <div style="text-align:right;font-size:0.75rem;color:var(--text-muted);">${lastImportTxt}</div>
    </div>`;
  }).join('');
  const total = accountData.filter(a=>a.txCount>0).reduce((s,a)=>s+a.computedBalance, 0);
  document.getElementById('gesamtvermoegen').textContent = state.transactions.length ? formatEur(total) : '—';
}

// ── PDF Upload ──
let selectedPdfFile = null;

window.handlePdfUpload = function(input) {
  const file = input.files[0];
  if (!file) return;
  selectedPdfFile = file;
  document.getElementById('upload-icon').textContent  = '✅';
  document.getElementById('upload-title').textContent = file.name;
  document.getElementById('upload-sub').textContent   = `${(file.size/1024).toFixed(1)} KB — bereit zum Import`;
  document.getElementById('import-btn').style.display = 'flex';
};

window.runImport = async function() {
  if (!selectedPdfFile) return;
  setStep(1,0,false); setStep(2,0,false); setStep(3,0,false);
  showLoading('PDF wird gelesen…');

  let rawText = '';
  try {
    rawText = await extractPdfText(selectedPdfFile);
  } catch(e) {
    hideLoading(); showToast('PDF konnte nicht gelesen werden'); return;
  }

  setStep(1, 100, true);
  showLoading('Buchungen werden erkannt…');
  const parsed = parseBankStatement(rawText);
  if (!parsed.length) {
    hideLoading(); setStep(1,100,false);
    updateImportStatus('Keine Buchungen gefunden', 'Das PDF scheint kein unterstütztes BAWAG/easybank-Format zu haben.');
    showToast('Keine Buchungen erkannt'); return;
  }

  updateImportStatus(`${parsed.length} Buchungen erkannt`, 'KI-Kategorisierung läuft…');
  showLoading(`${parsed.length} Buchungen werden kategorisiert…`);
  setStep(2, 50, false);

  let categorized;
  try {
    categorized = await categorizeWithAI(parsed, state.aiProvider);
    setStep(2, 100, true);
  } catch(e) {
    categorized = parsed.map(t => ({ ...t, category: 'Sonstiges', aiCategorized: false }));
    setStep(2, 100, false);
    showToast('KI-Kategorisierung fehlgeschlagen — "Sonstiges" zugewiesen');
  }

  const existing = new Set(state.transactions.map(t => `${t.date}|${t.amount}|${t.description}`));
  let added = 0;
  categorized.forEach(t => {
    const key = `${t.date}|${t.amount}|${t.description}`;
    if (!existing.has(key)) { state.transactions.push(t); existing.add(key); added++; }
  });

  const fileName  = selectedPdfFile.name.toLowerCase();
  const accountId = fileName.includes('easy') ? 'easybank' : 'bawag';
  const acc       = state.accounts.find(a => a.id === accountId);
  if (acc) acc.lastImport = new Date().toISOString().slice(0,10);

  state.currentMonth = categorized.map(t=>t.date.slice(0,7)).sort().reverse()[0] || state.currentMonth;
  saveState();
  setStep(3, 100, true);
  hideLoading();
  updateImportStatus('Import abgeschlossen', `${added} neue Buchungen importiert (${categorized.length - added} Duplikate übersprungen).`);
  showToast(`✓ ${added} Buchungen importiert`);

  selectedPdfFile = null;
  document.getElementById('pdf-input').value = '';
  document.getElementById('import-btn').style.display = 'none';
  document.getElementById('upload-icon').textContent  = '📄';
  document.getElementById('upload-title').textContent = 'BAWAG / easybank PDF';
  document.getElementById('upload-sub').innerHTML     = 'Per Klick oder Drag &amp; Drop<br><br><span style="display:inline-block;background:var(--surface-high);border-radius:100px;padding:4px 12px;font-size:0.6rem;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:var(--text-muted);">PDF · BAWAG · EASYBANK</span>';
  renderDashboard(); renderKonten();
};

function setStep(n, pct, done) {
  const step = document.getElementById(`step-${n}`);
  if (!step) return;
  document.getElementById(`step-${n}-fill`).style.width = pct + '%';
  if (done) { step.classList.add('done'); document.getElementById(`step-${n}-label`).textContent = `0${n}. ${['PDF','KI','Fertig'][n-1]} ✓`; }
}

function updateImportStatus(title, text) {
  document.getElementById('import-status-title').textContent = title;
  document.getElementById('import-status-text').textContent  = text;
}

// ── Provider Toggle ──
window.setProvider = function(p) {
  state.aiProvider = p; saveState(); setProviderUI(p);
};

function setProviderUI(p) {
  document.getElementById('btn-anthropic').className = 'provider-btn ' + (p === 'anthropic' ? 'active' : '');
  document.getElementById('btn-openai').className    = 'provider-btn ' + (p === 'openai'    ? 'active' : '');
  document.getElementById('anthropic-key-wrap').style.display = p === 'anthropic' ? 'block' : 'none';
  document.getElementById('openai-key-wrap').style.display    = p === 'openai'    ? 'block' : 'none';
}

// ── Demo Data ──
window.loadDemoData = function() {
  const today  = new Date();
  const mkDate = daysAgo => { const d = new Date(today); d.setDate(d.getDate()-daysAgo); return d.toISOString().slice(0,10); };
  const demos  = [
    { date:mkDate(0),  desc:'Billa Plus Wien',              amount:-43.20,   cat:'Supermarkt' },
    { date:mkDate(0),  desc:'Miete Oktober',                amount:-1150.00, cat:'Wohnen / Miete' },
    { date:mkDate(1),  desc:'Gehalt Europapier GmbH',       amount:+4200.00, cat:'Gehalt / Einnahmen' },
    { date:mkDate(1),  desc:'OMV Tankstelle Wien',          amount:-71.30,   cat:'Mobilität / Auto' },
    { date:mkDate(1),  desc:'Figl Restaurant',              amount:-89.50,   cat:'Restaurant / Café' },
    { date:mkDate(3),  desc:'Amazon.de',                    amount:-34.99,   cat:'Online Shopping' },
    { date:mkDate(3),  desc:'Hofer Lenti',                  amount:-58.40,   cat:'Supermarkt' },
    { date:mkDate(5),  desc:'Wien Energie Abrechnung',      amount:-89.00,   cat:'Energie / Strom' },
    { date:mkDate(5),  desc:'Wiener Linien Jahreskarte',    amount:-365.00,  cat:'Mobilität / Auto' },
    { date:mkDate(7),  desc:'Spotify Premium',              amount:-9.99,    cat:'Freizeit' },
    { date:mkDate(7),  desc:'Netflix',                      amount:-12.99,   cat:'Freizeit' },
    { date:mkDate(8),  desc:'BAWAG Kontoführungsgebühr',    amount:-4.90,    cat:'Gebühren / Bank' },
    { date:mkDate(10), desc:'Apotheke Zur Stadt Gottes',    amount:-22.80,   cat:'Gesundheit' },
    { date:mkDate(10), desc:'Edeka Wien Feinkostabteilung', amount:-142.50,  cat:'Supermarkt' },
    { date:mkDate(12), desc:'Uniqa Versicherung',           amount:-145.00,  cat:'Versicherung' },
    { date:mkDate(14), desc:'Café Landtmann',               amount:-28.60,   cat:'Restaurant / Café' },
    { date:mkDate(15), desc:'Zalando SE',                   amount:-67.90,   cat:'Online Shopping' },
    { date:mkDate(18), desc:'Interspar Mariahilfer Straße', amount:-94.30,   cat:'Supermarkt' },
    { date:mkDate(20), desc:'Steam Games Purchase',         amount:-29.99,   cat:'Freizeit' },
    { date:mkDate(22), desc:'Shell Tankstelle Gürtel',      amount:-55.00,   cat:'Mobilität / Auto' },
  ];
  const existing = new Set(state.transactions.map(t => `${t.date}|${t.amount}|${t.description}`));
  let added = 0;
  demos.forEach(d => {
    const key = `${d.date}|${d.amount}|${d.desc}`;
    if (!existing.has(key)) {
      state.transactions.push({ id:`demo_${d.date}_${Math.random().toString(36).slice(2,8)}`, date:d.date, description:d.desc, amount:d.amount, category:d.cat, aiCategorized:true, account:'bawag' });
      existing.add(key); added++;
    }
  });
  state.currentMonth = getCurrentMonth();
  saveState();
  showToast(`✓ ${added} Demo-Buchungen geladen`);
  renderDashboard(); renderBuchungen(); renderKonten();
};

// ── CSV Export ──
window.exportCSV = function() {
  if (!state.transactions.length) { showToast('Keine Buchungen zum Exportieren'); return; }
  const header = 'Datum,Beschreibung,Betrag,Kategorie,Konto';
  const rows   = state.transactions.sort((a,b)=>b.date.localeCompare(a.date)).map(t =>
    [t.date, `"${t.description.replace(/"/g,'""')}"`, t.amount.toFixed(2).replace('.',','), t.category, t.account||''].join(',')
  );
  const csv  = [header,...rows].join('\n');
  const blob = new Blob(['\uFEFF'+csv], { type:'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `buchungen_${state.currentMonth}.csv`; a.click();
  URL.revokeObjectURL(url);
  window.closeClearModal();
  showToast('CSV exportiert');
};

// ── API Keys ──
window.saveKeys = function() {
  const ak = document.getElementById('anthropic-key-input').value.trim();
  const ok = document.getElementById('openai-key-input').value.trim();
  saveKey('anthropic', ak);
  saveKey('openai', ok);
};

// ── Concierge / Bon ──
let _bonProvider = 'anthropic';

window.setBonProvider = function(p) {
  _bonProvider = p;
  document.getElementById('bon-btn-anthropic').style.background  = p === 'anthropic' ? 'var(--primary)' : 'transparent';
  document.getElementById('bon-btn-anthropic').style.color       = p === 'anthropic' ? '#fff' : 'var(--on-surface)';
  document.getElementById('bon-btn-anthropic').style.borderColor = p === 'anthropic' ? 'var(--primary)' : 'var(--outline-variant)';
  document.getElementById('bon-btn-openai').style.background     = p === 'openai'    ? 'var(--primary)' : 'transparent';
  document.getElementById('bon-btn-openai').style.color          = p === 'openai'    ? '#fff' : 'var(--on-surface)';
  document.getElementById('bon-btn-openai').style.borderColor    = p === 'openai'    ? 'var(--primary)' : 'var(--outline-variant)';
  document.getElementById('bon-anthropic-key').style.display     = p === 'anthropic' ? 'block' : 'none';
  document.getElementById('bon-openai-key').style.display        = p === 'openai'    ? 'block' : 'none';
};

window.saveBonKey = function() {
  const ak = document.getElementById('bon-anthropic-key').value;
  const ok = document.getElementById('bon-openai-key').value;
  if (ak) saveKey('anthropic', ak);
  if (ok) saveKey('openai', ok);
};

window.resetConcierge = function() {
  document.getElementById('concierge-upload').style.display = 'block';
  document.getElementById('concierge-result').style.display = 'none';
  document.getElementById('bon-input').value = '';
};

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}


window.handleBonUpload = async function(input) {
  const file = input.files[0];
  if (!file) return;
  const keys = loadKeys();
  const key  = _bonProvider === 'anthropic' ? keys.anthropic : keys.openai;
  if (!key) { showToast('Bitte zuerst API Key eingeben'); return; }

  showLoading('Bon wird analysiert…');
  try {
    let bonData;
    if (_bonProvider === 'anthropic') {
      if (file.type.startsWith('image/')) {
        const base64 = await fileToBase64(file);
        bonData = await analyzeBonImage(base64, file.type);
      } else if (file.type === 'application/pdf') {
        const pdfText = await extractPdfText(file);
        bonData = await analyzeBonPdf(pdfText);
      } else {
        hideLoading();
        showToast('Dateiformat nicht unterstützt — bitte JPG, PNG oder PDF');
        return;
      }
    } else {
      if (file.type.startsWith('image/')) {
        const base64 = await fileToBase64(file);
        bonData = await analyzeBonOpenAI(base64, file.type);
      } else if (file.type === 'application/pdf') {
        const pdfText = await extractPdfText(file);
        bonData = await analyzeBonPdfOpenAI(pdfText);
      } else {
        hideLoading();
        showToast('Dateiformat nicht unterstützt — bitte JPG, PNG oder PDF');
        return;
      }
    }
    hideLoading();
    renderConciergeResult(bonData);
  } catch(e) {
    hideLoading();
    showToast('Bon-Analyse fehlgeschlagen: ' + (e.message || 'Unbekannter Fehler'));
  }
};

function renderConciergeResult(bon) {
  _currentBon = bon;
  document.getElementById('concierge-upload').style.display = 'none';
  document.getElementById('concierge-result').style.display = 'block';

  const preview  = document.getElementById('bon-preview-content');
  const dateStr  = bon.date ? formatDate(bon.date) : '';
  preview.innerHTML = `
    <div style="font-size:0.6rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:6px;">📄 ${escHtml(bon.store)} — ${dateStr}</div>
    ${(bon.items||[]).map(item => {
      const sc = item.subcategory || item.subkategorie || 'Sonstiges';
      return `
      <div class="bon-row">
        <div>
          <div class="bon-item">${escHtml(item.name)}</div>
          <div><span class="sub-cat-chip">${SUBCAT_ICONS[sc]||'📦'} ${escHtml(sc)}</span></div>
        </div>
        <div class="bon-price">${formatEur(item.price ?? item.gesamt ?? 0)}</div>
      </div>`;
    }).join('')}
    <div class="bon-divider"></div>
    <div class="bon-row">
      <div class="bon-total">Gesamt</div>
      <div class="bon-total">${formatEur(bon.total)}</div>
    </div>`;

  const breakdown = document.getElementById('bon-breakdown');
  const bySubcat  = {};
  (bon.items||[]).forEach(i => {
    const sc = i.subcategory || i.subkategorie || 'Sonstiges';
    const price = i.price ?? i.gesamt ?? 0;
    bySubcat[sc] = (bySubcat[sc]||0) + price;
  });
  const sorted = Object.entries(bySubcat).sort((a,b) => b[1]-a[1]);
  breakdown.innerHTML = `<div class="section-label">Aufschlüsselung</div>` +
    sorted.map(([sc, amt]) => `
      <div class="cat-row" style="padding:10px 0;">
        <div class="cat-icon-wrap" style="width:34px;height:34px;border-radius:8px;font-size:0.9rem;">${SUBCAT_ICONS[sc]||'📦'}</div>
        <div style="flex:1;"><div class="cat-label" style="font-size:0.82rem;">${escHtml(sc)}</div></div>
        <div style="font-family:var(--serif);font-size:0.88rem;font-weight:700;">${formatEur(amt)}</div>
      </div>`).join('');

  const matchSection = document.getElementById('bon-match-section');
  const matches      = state.transactions.filter(t => t.amount < 0 && Math.abs(Math.abs(t.amount) - bon.total) < 0.015).slice(0,3);
  if (matches.length) {
    matchSection.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <div class="section-label" style="margin:0;">Passende Buchung</div>
        <span class="chip chip-green">${matches.length} Treffer</span>
      </div>
      ${matches.map(m => `
        <div class="match-card" id="match-${m.id}">
          <div class="tx-icon-wrap" style="width:40px;height:40px;">${m.bon ? '🔗' : (CAT_CONFIG[m.category]?.icon||'📌')}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:0.85rem;font-weight:700;">${escHtml(m.description)}</div>
            <div style="font-size:0.65rem;color:var(--text-muted);margin-top:2px;">${formatDate(m.date)}</div>
            ${m.bon
              ? `<div style="font-size:0.65rem;color:var(--green);margin-top:4px;">✅ Bereits verknüpft</div>`
              : `<div style="font-size:0.65rem;color:var(--green);margin-top:4px;">Betrag stimmt überein</div>`}
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;">
            <div style="font-family:var(--serif);font-size:0.95rem;font-weight:700;">${formatEur(Math.abs(m.amount))}</div>
            ${m.bon
              ? `<span class="chip chip-green" style="padding:2px 8px;font-size:0.6rem;">Verknüpft</span>`
              : `<button onclick="linkBon('${m.id}')" style="padding:5px 12px;border-radius:8px;border:none;background:var(--primary-container);color:var(--on-primary);font-size:0.68rem;font-weight:700;cursor:pointer;font-family:var(--sans);">🔗 Verknüpfen</button>`}
          </div>
        </div>`).join('')}`;
  } else {
    matchSection.innerHTML = `<div style="font-size:0.82rem;color:var(--text-muted);text-align:center;padding:12px;">Keine passende Buchung gefunden.</div>`;
  }

  document.getElementById('bon-link-btn').style.display = 'none';
}

let _currentBon = null;

window.linkBon = function(txId) {
  if (!_currentBon) return;
  const tx = state.transactions.find(t => t.id === txId);
  if (!tx) return;
  tx.bon = _currentBon;
  saveState();
  showToast(`✅ Verknüpft mit "${tx.description}"`);
  renderConciergeResult(_currentBon);
};

// ── DOMContentLoaded ──
document.addEventListener('DOMContentLoaded', () => {
  // Drag & drop
  const zone = document.getElementById('upload-zone');
  if (zone) {
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file && file.type === 'application/pdf') {
        selectedPdfFile = file;
        document.getElementById('upload-icon').textContent  = '✅';
        document.getElementById('upload-title').textContent = file.name;
        document.getElementById('upload-sub').textContent   = `${(file.size/1024).toFixed(1)} KB — bereit zum Import`;
        document.getElementById('import-btn').style.display = 'flex';
      }
    });
  }

  // Search input (not global in ES module, so register via JS)
  document.getElementById('search-input')?.addEventListener('input', renderBuchungen);

  // Modal close on overlay click
  document.getElementById('tx-modal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('tx-modal')) window.closeTxModal();
  });
  document.getElementById('clear-modal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('clear-modal')) window.closeClearModal();
  });

  // Load saved keys into inputs
  const keys = loadKeys();
  const akEl = document.getElementById('anthropic-key-input');
  const okEl = document.getElementById('openai-key-input');
  if (akEl) akEl.value = keys.anthropic;
  if (okEl) okEl.value = keys.openai;
  // Bon screen keys
  const bak = document.getElementById('bon-anthropic-key');
  const bok = document.getElementById('bon-openai-key');
  if (bak) bak.value = keys.anthropic;
  if (bok) bok.value = keys.openai;

  setProviderUI(state.aiProvider);
  renderDashboard();
  renderKonten();
  window.showScreen('dashboard');
});
