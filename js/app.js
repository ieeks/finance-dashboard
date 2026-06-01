// app.js — Entry Point
import { state, saveState, getCurrentMonth, getMonthLabel, getAvailableMonths, getTransactionsForMonth } from './state.js';
import { CAT_CONFIG, SUBCAT_ICONS, BON_EXCLUDED_COMPANIES, normalizeSubcategory, SUBCAT_ALIASES } from './categories.js';
import { formatEur, formatDate, escHtml, loadKeys, setInMemoryKeys, showToast, showLoading, hideLoading } from './ui.js';
import { extractPdfText, parseBankStatement, categorizeWithAI } from './parser.js';
import { analyzeBonImage, analyzeBonPdf, analyzeBonOpenAI, analyzeBonPdfOpenAI } from './bonAnalyzer.js';
import { login, logout, onAuthChange, currentEmail,
         loadAllData, saveTxBatch, updateTx, checkImportExists, saveImport,
         fsAddPendingBon, fsDeletePendingBon, fsSaveCategoryOverrides,
         fsSaveSubcategoryOverrides, fsSaveApiKeys } from './firebaseService.js';
import { findMatch, matchLabel, analyzeBonLinks } from './matcher.js';

function _addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── Navigation ──
window.showScreen = function(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('screen-' + name)?.classList.add('active');
  document.getElementById('nav-' + name)?.classList.add('active');
  window.scrollTo(0, 0);
  if (name === 'dashboard')   renderDashboard();
  if (name === 'buchungen')   renderBuchungen();
  if (name === 'konten')      renderKonten();
  if (name === 'concierge')   renderPendingBons();
  if (name === 'rechnungen')  renderRechnungen();
};

// ── Month Trigger ──
const MONTH_NAMES_LONG = ['Jänner','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];

function updateMonthTriggers() {
  const [y, m] = state.currentMonth.split('-').map(Number);
  const label = `${MONTH_NAMES_LONG[m-1]} ${y}`;
  ['monthTriggerLabel', 'buchMonthLabel', 'fsMonthLabel', 'rechnMonthLabel'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = label;
  });
}

// ── Dashboard ──
function renderDashboard() {
  updateMonthTriggers();
  const allTxs  = getTransactionsForMonth(state.currentMonth);
  // Gmail-Rechnungen sind Duplikate der Bank-Txs (nach _autoLinkGmailBons hängt
  // ihr bon an der Bank-Tx). Für alle Summations-Renderings rausfiltern, sonst
  // wird die Ausgabe doppelt gezählt. Nur renderRechnungenTeaser will sie sehen.
  const txs     = allTxs.filter(t => t.source !== 'gmail_import');
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
  renderMonthlyComparison(txs);
  renderBonBreakdown(txs);
  renderFixkosten(txs);
  renderInsight(txs);
  renderBelegStatus(txs);
  renderRechnungenTeaser(allTxs);

  const pendingCount = (state.pendingBons || []).length;
  const badgeEl = document.getElementById('concierge-badge');
  if (badgeEl) {
    badgeEl.textContent = `${pendingCount} offen`;
    badgeEl.style.display = pendingCount > 0 ? 'inline-block' : 'none';
  }
  updateConciergeNavBadge();
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
    return `<div class="cat-row" onclick="filterByCategory('${escHtml(cat)}')" style="cursor:pointer;">
      <div class="cat-icon-wrap">${cfg.icon}</div>
      <div style="flex:1;">
        <div class="cat-label">${cat}</div>
        <div class="cat-bar-wrap"><div class="cat-bar" style="width:${pct}%;background:${DONUT_COLORS[i]||'var(--outline)'}"></div></div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;">
        <div class="cat-amount">${formatEur(amt)}</div>
        <span style="font-size:0.65rem;color:var(--text-muted);">›</span>
      </div>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid var(--outline-soft);">
      ${renderDonut(sorted, total)}
      <div style="flex:1;min-width:0;">${legend}</div>
    </div>
    ${bars}`;
}

function _prevMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function _spendByCat(txs) {
  const bycat = {};
  txs.filter(t => t.amount < 0).forEach(t => {
    const c = t.category || 'Sonstiges';
    bycat[c] = (bycat[c] || 0) + Math.abs(t.amount);
  });
  return bycat;
}

function renderMonthlyComparison(txs) {
  const el = document.getElementById('db-monthly-compare');
  if (!el) return;

  const prev = _prevMonth(state.currentMonth);
  const prevTxs = getTransactionsForMonth(prev).filter(t => t.source !== 'gmail_import');
  if (!prevTxs.length || !txs.length) { el.style.display = 'none'; return; }

  const cur  = _spendByCat(txs);
  const last = _spendByCat(prevTxs);
  const topCats = Object.entries(cur).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (!topCats.length) { el.style.display = 'none'; return; }

  const prevLabel = getMonthLabel(prev);

  const rows = topCats.map(([cat, amt]) => {
    const cfg     = CAT_CONFIG[cat] || CAT_CONFIG['Sonstiges'];
    const lastAmt = last[cat] || 0;
    let chip;
    if (lastAmt === 0) {
      chip = `<span class="chip" style="background:var(--surface-container-high);color:var(--text-muted);">neu</span>`;
    } else {
      const pct = Math.round(((amt - lastAmt) / lastAmt) * 100);
      const up  = pct > 0;
      const cls = up ? 'chip-red' : (pct < 0 ? 'chip-green' : '');
      const arrow = up ? '▲' : (pct < 0 ? '▼' : '·');
      chip = `<span class="chip ${cls}">${arrow} ${Math.abs(pct)}%</span>`;
    }
    return `<div class="cat-row" onclick="filterByCategory('${escHtml(cat)}')" style="cursor:pointer;">
      <div class="cat-icon-wrap">${cfg.icon}</div>
      <div style="flex:1;min-width:0;">
        <div class="cat-label">${escHtml(cat)}</div>
        <div style="font-size:0.68rem;color:var(--text-muted);">${formatEur(lastAmt)} im ${escHtml(prevLabel)}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px;">
        <div class="cat-amount">${formatEur(amt)}</div>
        ${chip}
      </div>
    </div>`;
  }).join('');

  el.style.display = 'block';
  el.innerHTML = `
    <div class="section-label" style="margin-top:16px;">Monatsvergleich</div>
    <div class="card" style="padding:16px 20px;">${rows}</div>`;
}

// Nur Kategorien, in denen Bons strukturell mehrere Items haben.
// Miete/Versicherung/Strom/Telekom sind Einzeilen-Rechnungen — die Items
// dort sind keine echten Subkategorien und würden "Sonstiges" aufblähen.
const BON_BREAKDOWN_CATS = new Set([
  'Supermarkt', 'Restaurant / Café', 'Drogerie',
  'Online Shopping', 'Freizeit', 'Gesundheit',
]);

function renderBonBreakdown(txs) {
  const el = document.getElementById('db-bon-breakdown');
  if (!el) return;

  const bonTxs = txs.filter(t => {
    if (!t.bon?.items?.length) return false;
    if (!BON_BREAKDOWN_CATS.has(t.category)) return false;
    const haystacks = [t.description, t.bon.vendor, t.bon.store].filter(Boolean);
    return !BON_EXCLUDED_COMPANIES.some(exc => haystacks.some(h => h.includes(exc)));
  });
  if (!bonTxs.length) { el.style.display = 'none'; return; }

  const bySubcat = {};
  const itemsBySubcat = {};
  bonTxs.forEach(t => {
    (t.bon.items).forEach(item => {
      const raw   = item.subcategory || item.subkategorie || 'Sonstiges';
      const sc    = normalizeSubcategory(raw);
      const price = item.price ?? item.gesamt ?? 0;
      bySubcat[sc] = (bySubcat[sc] || 0) + price;
      if (!itemsBySubcat[sc]) itemsBySubcat[sc] = [];
      itemsBySubcat[sc].push({ name: item.name || '—', price, vendor: t.description || '' });
    });
  });

  const sorted = Object.entries(bySubcat).sort((a, b) => b[1] - a[1]);
  if (!sorted.length) { el.style.display = 'none'; return; }

  const max      = sorted[0][1];
  const bonCount = bonTxs.length;

  el.style.display = 'block';
  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
      <div class="section-label">Bon-Aufschlüsselung</div>
      <span style="font-size:0.65rem;color:var(--text-muted);">${bonCount} Bon${bonCount !== 1 ? 's' : ''} verknüpft</span>
    </div>
    <div class="card" style="padding:16px 20px;">
      ${sorted.map(([sc, amt]) => {
        const pct = Math.round((amt / max) * 100);
        return `<div class="cat-row" onclick="openSubkatModal('${escHtml(sc)}')" style="cursor:pointer;">
          <div class="cat-icon-wrap" style="font-size:1rem;">${SUBCAT_ICONS[sc] || '📦'}</div>
          <div style="flex:1;">
            <div class="cat-label" style="font-size:0.82rem;">${escHtml(sc)}</div>
            <div class="cat-bar-wrap"><div class="cat-bar" style="width:${pct}%;background:var(--secondary);"></div></div>
          </div>
          <div style="display:flex;align-items:center;gap:6px;">
            <div class="cat-amount">${formatEur(amt)}</div>
            <span style="font-size:0.65rem;color:var(--text-muted);">›</span>
          </div>
        </div>`;
      }).join('')}
    </div>`;

  window._bonItemsBySubcat = itemsBySubcat;
}

window.openSubkatModal = function(sc) {
  const items = (window._bonItemsBySubcat || {})[sc];
  if (!items?.length) return;
  const total = items.reduce((s, i) => s + i.price, 0);
  const icon  = SUBCAT_ICONS[sc] || '📦';
  const sorted = [...items].sort((a, b) => b.price - a.price);
  document.getElementById('subkat-modal-content').innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;">
      <span style="font-size:1.4rem;">${icon}</span>
      <div>
        <div style="font-family:var(--serif);font-size:1.1rem;font-weight:700;">${escHtml(sc)}</div>
        <div style="font-size:0.72rem;color:var(--text-muted);">${items.length} Position${items.length !== 1 ? 'en' : ''} · ${formatEur(total)}</div>
      </div>
    </div>
    <div style="margin-top:16px;display:flex;flex-direction:column;gap:2px;">
      ${sorted.map(it => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--outline-variant);">
          <div style="flex:1;min-width:0;">
            <div style="font-size:0.85rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(it.name)}</div>
            <div style="font-size:0.68rem;color:var(--text-muted);">${escHtml(it.vendor)}</div>
          </div>
          <div style="font-size:0.9rem;font-weight:700;margin-left:12px;">${formatEur(it.price)}</div>
        </div>`).join('')}
    </div>`;
  document.getElementById('subkat-modal').classList.add('open');
};

window.closeSubkatModal = function() {
  document.getElementById('subkat-modal').classList.remove('open');
};

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

function renderBelegStatus(txs) {
  const el = document.getElementById('db-beleg-status');
  if (!el) return;
  const pendingCount = (state.pendingBons || []).length;
  const ohneBeleg = txs.filter(needsBon).length;
  if (!pendingCount && !ohneBeleg) { el.style.display = 'none'; return; }
  el.style.display = '';
  const rows = [];
  if (pendingCount > 0) {
    rows.push(`<div onclick="showScreen('concierge')" style="display:flex;align-items:center;gap:12px;padding:14px 0;${ohneBeleg ? 'border-bottom:1px solid var(--outline-soft);' : ''}cursor:pointer;">
      <div style="width:36px;height:36px;border-radius:10px;background:var(--surface-high);display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0;">🧾</div>
      <div style="flex:1;">
        <div style="font-size:0.82rem;font-weight:700;">${pendingCount} Bon${pendingCount !== 1 ? 's' : ''} ohne Buchung</div>
        <div style="font-size:0.68rem;color:var(--text-muted);margin-top:2px;">Gescannt — noch keiner Buchung zugeordnet</div>
      </div>
      <span style="color:var(--text-muted);">›</span>
    </div>`);
  }
  if (ohneBeleg > 0) {
    rows.push(`<div onclick="goToOhneBeleg()" style="display:flex;align-items:center;gap:12px;padding:14px 0;cursor:pointer;">
      <div style="width:36px;height:36px;border-radius:10px;background:var(--surface-high);display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0;">📋</div>
      <div style="flex:1;">
        <div style="font-size:0.82rem;font-weight:700;">${ohneBeleg} Buchung${ohneBeleg !== 1 ? 'en' : ''} ohne Bon</div>
        <div style="font-size:0.68rem;color:var(--text-muted);margin-top:2px;">Ausgaben ${getMonthLabel(state.currentMonth)} ohne Beleg</div>
      </div>
      <span style="color:var(--text-muted);">›</span>
    </div>`);
  }
  el.innerHTML = `
    <div style="display:flex;align-items:center;margin-bottom:4px;">
      <div class="section-label">Beleg-Status</div>
    </div>
    <div class="card" style="padding:0 16px;">${rows.join('')}</div>
  `;
}

window.goToOhneBeleg = function() {
  _buchFilter.beleg = 'open';
  showScreen('buchungen');
  window._refreshBuchUI?.();
};

// ── Rechnungen (Gmail-Import) ──
function findRechnungMatch(rechnung) {
  const bon = { date: rechnung.date, total: Math.abs(rechnung.amount), store: rechnung.description };
  return findMatch(bon, state.transactions.filter(t => t.source !== 'gmail_import')) || null;
}

function renderRechnungenTeaser(txs) {
  const el = document.getElementById('db-rechnungen-teaser');
  if (!el) return;
  const rechnungen = txs.filter(t => t.source === 'gmail_import');
  if (!rechnungen.length) { el.style.display = 'none'; return; }
  const unmatched = rechnungen.filter(t => !findRechnungMatch(t)).length;
  el.style.display = '';
  el.innerHTML = `
    <div class="section-label">E-Mail Rechnungen</div>
    <div class="card" style="padding:16px 20px;display:flex;align-items:center;gap:14px;cursor:pointer;" onclick="showScreen('rechnungen')">
      <div style="font-size:1.8rem;">✉️</div>
      <div style="flex:1;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <div style="font-family:var(--serif);font-size:0.95rem;font-weight:700;">${rechnungen.length} Rechnungen</div>
          ${unmatched > 0
            ? `<span class="chip chip-gold" style="font-size:0.6rem;padding:2px 8px;">${unmatched} offen</span>`
            : `<span class="chip chip-green" style="font-size:0.6rem;padding:2px 8px;">✅ alle verknüpft</span>`}
        </div>
        <div style="font-size:0.72rem;color:var(--text-muted);">Automatisch aus Gmail importiert</div>
      </div>
      <span style="color:var(--text-muted);">›</span>
    </div>
  `;
}

function renderRechnungen() {
  updateMonthTriggers();
  const listEl    = document.getElementById('rechnungen-list');
  const summaryEl = document.getElementById('rechnungen-summary');
  if (!listEl) return;

  const month = getTransactionsForMonth(state.currentMonth).filter(t => t.source === 'gmail_import');
  const matched   = month.filter(t => findRechnungMatch(t)).length;
  const unmatched = month.length - matched;

  if (summaryEl) {
    summaryEl.innerHTML = month.length
      ? `<span style="color:var(--text-muted);">${month.length} Rechnungen</span>
         <span style="color:var(--green);font-weight:700;">✅ ${matched} verknüpft</span>
         ${unmatched ? `<span style="color:var(--secondary);font-weight:700;">⚠️ ${unmatched} offen</span>` : ''}`
      : '';
  }

  if (!month.length) {
    listEl.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">✉️</div>
      <div class="empty-state-title">Keine Rechnungen</div>
      <p class="empty-state-text">In ${getMonthLabel(state.currentMonth)} wurden keine E-Mail-Rechnungen importiert.</p>
    </div>`;
    return;
  }

  listEl.innerHTML = [...month].sort((a,b) => b.date.localeCompare(a.date)).map(t => {
    const match = findRechnungMatch(t);
    const cfg   = CAT_CONFIG[t.category] || CAT_CONFIG['Sonstiges'];
    const ml = match ? matchLabel(match.score) : null;
    const statusHtml = match
      ? `<div style="display:flex;align-items:center;gap:6px;font-size:0.68rem;margin-top:8px;padding-top:8px;border-top:1px solid var(--outline-soft);">
           <span style="color:var(--green);">✅</span>
           <span style="color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">${escHtml(match.transaction.description.slice(0,35))} · ${formatDate(match.transaction.date)}</span>
           <span class="chip ${ml.chip}" style="font-size:0.55rem;padding:1px 6px;flex-shrink:0;">${ml.label}</span>
         </div>`
      : `<div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px;padding-top:8px;border-top:1px solid var(--outline-soft);">
           <span style="font-size:0.68rem;color:var(--secondary);font-weight:600;">⚠️ Kein Match</span>
           <button onclick="searchRechnungInBuchungen('${Math.abs(t.amount).toFixed(2).replace('.',',')}')"
             style="font-size:0.65rem;padding:3px 10px;border-radius:99px;border:1px solid var(--outline-soft);background:var(--surface-mid);color:var(--text-muted);cursor:pointer;font-family:var(--sans);">
             In Buchungen suchen →
           </button>
         </div>`;
    return `<div class="card" style="padding:14px 16px;margin-bottom:10px;">
      <div style="display:flex;align-items:center;gap:12px;">
        <div style="width:40px;height:40px;border-radius:12px;background:var(--surface-mid);display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0;">${cfg.icon}</div>
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;">
            <div style="font-size:0.88rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(t.description)}</div>
            <div style="font-family:var(--serif);font-weight:700;white-space:nowrap;">${formatEur(t.amount)}</div>
          </div>
          <div style="font-size:0.65rem;color:var(--text-muted);margin-top:2px;">${formatDate(t.date)} · ${escHtml(t.category)}</div>
        </div>
      </div>
      ${statusHtml}
    </div>`;
  }).join('');
}

window.searchRechnungInBuchungen = function(amountStr) {
  const search = document.getElementById('search-input');
  if (search) search.value = amountStr;
  showScreen('buchungen');
};

window.applyQuickFilter = function(key, val) {
  _buchFilter[key] = _buchFilter[key] === val ? 'alle' : val;
  renderBuchungen();
  window._refreshBuchUI?.();
};

// ── Buchungen ──
let _buchFilter = {
  konto: 'alle', beleg: 'alle', typ: 'alle', cats: [], quelle: 'alle'
};

window.filterByCategory = function(cat) {
  _buchFilter = { konto: 'alle', beleg: 'alle', typ: 'aus', cats: [cat], quelle: 'alle' };
  const searchInput = document.getElementById('search-input');
  if (searchInput) searchInput.value = '';
  window.showScreen('buchungen');
};

function renderBuchQuickChips() {
  const el = document.getElementById('buch-quick-chips');
  if (!el) return;
  el.innerHTML = [
    { label: '◻ Ohne Bon', key: 'beleg', val: 'open'   },
    { label: '✅ Mit Bon',  key: 'beleg', val: 'linked' },
  ].map(c => `<button class="bs-chip${_buchFilter[c.key] === c.val ? ' active' : ''}" onclick="applyQuickFilter('${c.key}','${c.val}')">${c.label}</button>`).join('');
}

function renderBuchungen() {
  renderBuchQuickChips();
  updateMonthTriggers();
  const search = (document.getElementById('search-input')?.value || '').toLowerCase();

  let txs = search ? state.transactions.slice() : getTransactionsForMonth(state.currentMonth);

  if (search) {
    txs = txs.filter(t =>
      t.description.toLowerCase().includes(search) ||
      (t.category||'').toLowerCase().includes(search)
    );
  }
  if (_buchFilter.konto !== 'alle') txs = txs.filter(t => t.cardHolder === _buchFilter.konto);
  if (_buchFilter.beleg === 'linked') txs = txs.filter(t => !!t.bon);
  if (_buchFilter.beleg === 'open')   txs = txs.filter(needsBon);
  if (_buchFilter.typ === 'aus')      txs = txs.filter(t => t.amount < 0);
  if (_buchFilter.typ === 'ein')      txs = txs.filter(t => t.amount > 0);
  if (_buchFilter.cats.length)        txs = txs.filter(t => _buchFilter.cats.includes(t.category));
  if (_buchFilter.quelle === 'gmail') txs = txs.filter(t => t.source === 'gmail_import');
  if (_buchFilter.quelle !== 'gmail') txs = txs.filter(t => t.source !== 'gmail_import');

  // summary bar when filter or search active
  const hasFilter = search || _buchFilter.konto !== 'alle' || _buchFilter.beleg !== 'alle' ||
                    _buchFilter.typ !== 'alle' || _buchFilter.cats.length > 0 || _buchFilter.quelle !== 'alle';
  const summaryEl = document.getElementById('buchungen-summary');
  if (summaryEl && hasFilter) {
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

const BON_RELEVANT_CATS = new Set([
  'Supermarkt', 'Restaurant / Café', 'Online Shopping', 'Drogerie',
  'Freizeit', 'Mobilität / Auto', 'Gesundheit', 'Telekommunikation', 'Energie / Strom'
]);

function needsBon(tx) {
  return tx.amount < 0 && !tx.bon && !tx.isRecurring && BON_RELEVANT_CATS.has(tx.category);
}

function belegStatusTag(tx) {
  if (tx.amount >= 0) return '';
  if (tx.bon)
    return '<div style="font-size:0.58rem;color:var(--green);font-weight:700;text-align:right;margin-top:3px;white-space:nowrap;">✅ Bon</div>';
  if (needsBon(tx))
    return '<div style="font-size:0.58rem;color:var(--secondary);font-weight:700;text-align:right;margin-top:3px;white-space:nowrap;">⚠️ kein Bon</div>';
  return '';
}

function renderTxItem(tx) {
  const cfg      = CAT_CONFIG[tx.category] || CAT_CONFIG['Sonstiges'];
  const isIn     = tx.amount > 0;
  const chipClass = tx.category === 'Gehalt / Einnahmen' ? 'chip-green' : 'chip-gold';
  const aiTag    = tx.aiCategorized ? '<span class="chip chip-ai" style="padding:2px 6px;font-size:0.55rem;">✦ AI</span>' : '';
  const noteTag  = tx.note ? '<span style="font-size:0.7rem;">💬</span>' : '';
  const gmailTag = tx.source === 'gmail_import' ? '<span class="chip" style="padding:2px 6px;font-size:0.55rem;background:var(--surface-container);color:var(--secondary);">✉ Rechnung</span>' : '';
  const avatar   = tx.cardHolder === 'manuel' ? '<span class="avatar-chip avatar-m">M</span>'
                 : tx.cardHolder === 'olga'   ? '<span class="avatar-chip avatar-o">O</span>'
                 : '';
  return `<div class="tx-item" onclick="openTxModal('${tx.id}')">
    <div class="tx-icon-wrap">${cfg.icon}</div>
    <div style="flex:1;min-width:0;">
      <div class="tx-name">${escHtml(tx.description)}</div>
      <div class="tx-meta">
        ${gmailTag}${aiTag}${noteTag}
        <span class="chip ${chipClass}" style="padding:2px 8px;font-size:0.55rem;">${escHtml(tx.category||'Sonstiges')}</span>
        ${avatar}
        <span>${formatDate(tx.date)}</span>
      </div>
    </div>
    <div style="text-align:right;flex-shrink:0;">
      <div class="tx-amount ${isIn ? 'in' : 'out'}">${isIn ? '+' : '−'}${formatEur(Math.abs(tx.amount))}</div>
      ${belegStatusTag(tx)}
    </div>
  </div>`;
}

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
      ${(function() {
        const key = tx.description.toLowerCase().trim();
        const overrides = state.categoryOverrides || {};
        if (overrides[key]) {
          return `<div style="display:flex;align-items:center;justify-content:space-between;margin-top:10px;">
            <span style="font-size:0.68rem;color:var(--green);">✅ Wird für diesen Händler gemerkt</span>
            <button onclick="deleteOverride('${escHtml(key)}')" style="font-size:0.65rem;background:none;border:none;color:var(--text-muted);cursor:pointer;padding:2px 6px;text-decoration:underline;">Vergessen</button>
          </div>`;
        }
        return `<label style="display:flex;align-items:center;gap:8px;margin-top:10px;cursor:pointer;">
          <input type="checkbox" id="remember-cat-${id}" checked style="width:15px;height:15px;cursor:pointer;accent-color:var(--primary);flex-shrink:0;">
          <span style="font-size:0.7rem;color:var(--text-muted);">Für nächstes Mal merken</span>
        </label>`;
      })()}
    </div>
    ${tx.aiCategorized ? '<div style="display:flex;align-items:center;gap:6px;font-size:0.72rem;color:var(--text-muted);margin-bottom:16px;"><span class="chip chip-ai" style="padding:2px 8px;">✦ KI kategorisiert</span></div>' : ''}
    ${tx.bon ? `
    <div style="margin-bottom:16px;border-top:1px solid var(--outline-soft);padding-top:16px;">
      <div class="section-label" style="margin-bottom:10px;">🧾 ${escHtml(tx.bon.store || 'Kassenbon')}</div>
      ${(tx.bon.items||[]).map((item, idx) => {
        const sc = item.subcategory || item.subkategorie || 'Sonstiges';
        const opts = Object.keys(SUBCAT_ICONS).map(s =>
          `<option value="${escHtml(s)}"${s === sc ? ' selected' : ''}>${SUBCAT_ICONS[s]} ${escHtml(s)}</option>`
        ).join('');
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--outline-soft);">
          <div style="flex:1;min-width:0;">
            <div style="font-size:0.82rem;font-weight:600;">${escHtml(item.name)}</div>
            <select onchange="updateBonItemSubcat('${id}', ${idx}, this.value)"
              style="font-size:0.65rem;color:var(--text-muted);background:transparent;border:none;outline:none;cursor:pointer;padding:2px 0;margin-top:2px;max-width:180px;-webkit-appearance:auto;">
              ${opts}
            </select>
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
  if (!tx) return;
  tx.category = newCat;
  tx.aiCategorized = false;

  const rememberCb = document.getElementById(`remember-cat-${id}`);
  const key = tx.description.toLowerCase().trim();
  if (rememberCb?.checked) {
    if (!state.categoryOverrides) state.categoryOverrides = {};
    state.categoryOverrides[key] = newCat;
    fsSaveCategoryOverrides(state.categoryOverrides).catch(() => {});
    showToast(`✅ "${tx.description}" wird künftig als "${newCat}" erkannt`);
  } else {
    showToast('Kategorie gespeichert');
  }

  saveState();
  updateTx(id, { category: newCat, aiCategorized: false }).catch(() => {});
  window.closeTxModal();
  renderBuchungen();
  renderDashboard();
};

window.deleteOverride = function(key) {
  if (state.categoryOverrides) delete state.categoryOverrides[key];
  saveState();
  fsSaveCategoryOverrides(state.categoryOverrides || {}).catch(() => {});
  showToast('Gespeicherte Kategorie entfernt');
  window.closeTxModal();
};

window.saveNote = function(id, value) {
  const tx = state.transactions.find(t => t.id === id);
  if (!tx) return;
  const trimmed = value.trim();
  if (tx.note === trimmed) return;
  tx.note = trimmed;
  saveState();
  updateTx(id, { note: trimmed }).catch(() => {});
  renderBuchungen();
};

window.updateBonItemSubcat = function(txId, itemIdx, newSubcat) {
  const tx = state.transactions.find(t => t.id === txId);
  if (!tx?.bon?.items?.[itemIdx]) return;
  const item = tx.bon.items[itemIdx];
  item.subcategory = newSubcat;
  if ('subkategorie' in item) item.subkategorie = newSubcat;
  saveState();
  updateTx(txId, { bon: tx.bon }).catch(() => {});

  const key = (item.name || '').toLowerCase().trim();
  if (key) {
    const ov = { ...(state.subcategoryOverrides || {}), [key]: newSubcat };
    state.subcategoryOverrides = ov;
    fsSaveSubcategoryOverrides(ov).catch(() => {});
  }

  renderDashboard();
  showToast('Subkategorie geändert & gemerkt');
};

// ── Clear / Settings Modal ──
window.openClearModal  = function() { document.getElementById('clear-modal').classList.add('open'); };
window.closeClearModal = function() { document.getElementById('clear-modal').classList.remove('open'); };

// ── Onboarding Modal ──
let _obStep = 1;
const _OB_TOTAL = 4;
function _obShow(step) {
  _obStep = step;
  const slides = document.getElementById('ob-slides');
  if (slides) slides.style.transform = `translateX(-${(step - 1) * 25}%)`;
  document.querySelectorAll('[data-ob-dot]').forEach(d => {
    d.classList.toggle('active', parseInt(d.dataset.obDot) === step);
  });
  const back = document.getElementById('ob-back');
  const next = document.getElementById('ob-next');
  if (back) back.style.visibility = step === 1 ? 'hidden' : 'visible';
  if (next) next.textContent = step === _OB_TOTAL ? "Los geht's" : 'Weiter';
}
window.openOnboarding  = function() {
  document.getElementById('onboarding-modal')?.classList.add('open');
  _obShow(1);
  document.getElementById('onboarding-btn')?.classList.remove('topbar-icon--pulse');
  localStorage.setItem('onboarding_seen', '1');
};
if (localStorage.getItem('onboarding_seen')) {
  document.getElementById('onboarding-btn')?.classList.remove('topbar-icon--pulse');
}
window.closeOnboarding = function() { document.getElementById('onboarding-modal')?.classList.remove('open'); };
window.obNext = function() { if (_obStep < _OB_TOTAL) _obShow(_obStep + 1); else window.closeOnboarding(); };
window.obBack = function() { if (_obStep > 1) _obShow(_obStep - 1); };
window.clearTransactions = function() {
  state.transactions = [];
  saveState();
  showToast('Alle Buchungen gelöscht');
  renderDashboard();
  renderBuchungen();
  renderKonten();
};

// ── Konten ──
window.showAddAccountSheet = function() {
  const modal = document.getElementById('add-account-modal');
  if (!modal) return;
  ['acc-name-input','acc-iban-input','acc-initial-input'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.querySelectorAll('.acc-swatch').forEach((s, i) => {
    s.style.outline = i === 0 ? '2.5px solid var(--text)' : 'none';
    s.style.outlineOffset = '2px';
    s.onclick = () => {
      document.querySelectorAll('.acc-swatch').forEach(x => x.style.outline = 'none');
      s.style.outline = '2.5px solid var(--text)';
      s.style.outlineOffset = '2px';
    };
  });
  modal.classList.add('open');
};

window.closeAddAccountSheet = function() {
  document.getElementById('add-account-modal')?.classList.remove('open');
};

window.addNewAccount = function() {
  const name    = (document.getElementById('acc-name-input')?.value || '').trim();
  const iban    = (document.getElementById('acc-iban-input')?.value || '').trim();
  const initial = (document.getElementById('acc-initial-input')?.value || '').trim().slice(0,2) || name.slice(0,1).toLowerCase();
  const activeEl = document.querySelector('.acc-swatch[style*="solid"]') || document.querySelector('.acc-swatch');
  const color   = activeEl?.dataset.color || '#41051F';
  if (!name) { showToast('Bitte Kontoname eingeben'); return; }
  if (state.accounts.some(a => a.name.toLowerCase() === name.toLowerCase())) {
    showToast('Konto mit diesem Namen existiert bereits'); return;
  }
  const id = name.toLowerCase().replace(/[^a-z0-9]/g,'_') + '_' + Date.now().toString(36);
  state.accounts.push({ id, name, iban, balance: null, lastImport: null, color, initial });
  saveState();
  closeAddAccountSheet();
  renderKonten();
  showToast(`✓ "${name}" hinzugefügt`);
};

window.deleteAccount = function(id) {
  const acc = state.accounts.find(a => a.id === id);
  if (!acc) return;
  if (!confirm(`Konto "${acc.name}" wirklich entfernen? Buchungen bleiben erhalten.`)) return;
  state.accounts = state.accounts.filter(a => a.id !== id);
  saveState();
  renderKonten();
  showToast(`"${acc.name}" entfernt`);
};

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
    const isDefault = ['haushalt','privat_olga','privat_olga_erste','privat_manuel'].includes(acc.id);
    return `<div class="account-card">
      <div class="account-header">
        <div class="account-logo" style="background:${acc.color};font-size:0.9rem;">${acc.initial}</div>
        <div style="flex:1;">
          <div class="account-name">${escHtml(acc.name)}</div>
          <div class="account-iban">${escHtml(acc.iban || '—')}</div>
        </div>
        ${statusChip}
        ${!isDefault ? `<button onclick="deleteAccount('${acc.id}')" style="padding:4px 8px;border-radius:8px;border:none;background:none;color:var(--text-muted);font-size:0.75rem;cursor:pointer;margin-left:6px;">✕</button>` : ''}
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

  _renderDatenpflege();
}

function _renderDatenpflege() {
  const chip      = document.getElementById('datenpflege-chip');
  const subtitle  = document.getElementById('datenpflege-subtitle');
  if (!chip || !subtitle) return;
  const report = analyzeBonLinks(state.transactions);
  if (report.total === 0) {
    chip.style.display = 'none';
    subtitle.textContent = 'Noch keine Bon-Verknüpfungen vorhanden';
    return;
  }
  if (report.stale.length === 0) {
    chip.className = 'chip chip-green';
    chip.textContent = `${report.ok.length} ✓`;
    chip.style.display = 'inline-block';
    subtitle.textContent = `Alle ${report.ok.length} Verknüpfungen sind gültig`;
  } else {
    chip.className = 'chip chip-gold';
    chip.textContent = `${report.stale.length} verdächtig`;
    chip.style.display = 'inline-block';
    subtitle.textContent = `${report.stale.length} von ${report.total} Verknüpfungen würden vom aktuellen Matcher nicht akzeptiert`;
  }
}

window.openRematchDialog = function() {
  const report      = analyzeBonLinks(state.transactions);
  const modal       = document.getElementById('rematch-modal');
  const summary     = document.getElementById('rematch-summary');
  const list        = document.getElementById('rematch-stale-list');
  const commitBtn   = document.getElementById('rematch-commit-btn');
  if (!modal || !summary || !list || !commitBtn) return;

  summary.textContent = report.total === 0
    ? 'Keine Bon-Verknüpfungen vorhanden.'
    : report.stale.length === 0
      ? `Alle ${report.ok.length} Verknüpfungen sind gültig — kein Cleanup nötig.`
      : `${report.stale.length} von ${report.total} Verknüpfungen würden vom aktuellen Matcher nicht mehr akzeptiert. Du kannst sie hier lösen — die Bank-Buchungen selbst bleiben unverändert.`;

  list.innerHTML = report.stale.map(s => {
    const tx = s.tx;
    return `<div class="card" style="padding:12px 14px;">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:4px;">
        <div style="font-size:0.85rem;font-weight:700;">${escHtml(tx.description)}</div>
        <div style="font-family:var(--serif);font-weight:700;font-size:0.85rem;">${formatEur(tx.amount)}</div>
      </div>
      <div style="font-size:0.68rem;color:var(--text-muted);margin-bottom:6px;">${formatDate(tx.date)}</div>
      <div style="font-size:0.7rem;color:var(--secondary);">
        ✗ Bon: ${escHtml(s.bonStore || '?')} · ${formatEur(-Math.abs(s.bonTotal || 0))}
      </div>
    </div>`;
  }).join('');

  commitBtn.style.display = report.stale.length > 0 ? 'block' : 'none';
  modal.classList.add('open');
};

window.closeRematchDialog = function() {
  document.getElementById('rematch-modal')?.classList.remove('open');
};

window.commitRematch = async function() {
  const report = analyzeBonLinks(state.transactions);
  if (!report.stale.length) { window.closeRematchDialog(); return; }
  for (const s of report.stale) {
    s.tx.bon = null;
    updateTx(s.tx.id, { bon: null }).catch(() => {});
  }
  saveState();
  window.closeRematchDialog();
  showToast(`✅ ${report.stale.length} Verknüpfung${report.stale.length === 1 ? '' : 'en'} gelöst`);
  renderDashboard();
  renderKonten();
  if (typeof window._refreshBuchUI === 'function') window._refreshBuchUI();
};

// ── PDF Upload ──
let selectedPdfFiles = [];

function _setUploadUI(files) {
  document.getElementById('upload-icon').textContent = '✅';
  if (files.length === 1) {
    document.getElementById('upload-title').textContent = files[0].name;
    document.getElementById('upload-sub').textContent   = `${(files[0].size/1024).toFixed(1)} KB — bereit zum Import`;
  } else {
    document.getElementById('upload-title').textContent = `${files.length} PDFs ausgewählt`;
    const totalKB = files.reduce((s, f) => s + f.size, 0) / 1024;
    document.getElementById('upload-sub').textContent   = `${totalKB.toFixed(1)} KB gesamt — bereit zum Import`;
  }
  _renderAccountSelector(files);
  document.getElementById('import-btn').style.display = 'flex';
}

function _renderAccountSelector(files) {
  const wrap  = document.getElementById('account-selector-wrap');
  const chips = document.getElementById('account-selector-chips');
  if (!wrap || !chips) return;
  if (state.accounts.length <= 1) { wrap.style.display = 'none'; return; }
  const firstName = (files[0]?.name || '').toLowerCase();
  const autoId = (firstName.includes('easy') || firstName.includes('bawag')) ? 'haushalt' :
                 state.accounts.find(a => firstName.includes(a.name.toLowerCase()))?.id ||
                 state.accounts[0].id;
  wrap.style.display = 'block';
  chips.innerHTML = state.accounts.map(a =>
    `<button class="bs-chip${a.id === autoId ? ' active' : ''}" data-acc-id="${escHtml(a.id)}" onclick="selectImportAccount('${escHtml(a.id)}')">${escHtml(a.initial)} ${escHtml(a.name)}</button>`
  ).join('');
}

window.selectImportAccount = function(id) {
  document.querySelectorAll('#account-selector-chips .bs-chip').forEach(c =>
    c.classList.toggle('active', c.dataset.accId === id)
  );
};

window.handlePdfUpload = function(input) {
  const files = Array.from(input.files);
  if (!files.length) return;
  selectedPdfFiles = files;
  _setUploadUI(files);
};

window.runImport = async function() {
  if (!selectedPdfFiles.length) return;

  let totalAdded = 0;
  let totalAutoLinked = 0;
  let latestMonth = state.currentMonth;
  const fileCount = selectedPdfFiles.length;

  for (let fileIdx = 0; fileIdx < fileCount; fileIdx++) {
    const file = selectedPdfFiles[fileIdx];
    const fileLabel = fileCount > 1 ? ` (${fileIdx + 1}/${fileCount})` : '';

    setStep(1,0,false); setStep(2,0,false); setStep(3,0,false);
    showLoading(`PDF wird gelesen…${fileLabel}`);

    let rawText = '';
    try {
      rawText = await extractPdfText(file);
    } catch(e) {
      showToast(`${file.name}: PDF konnte nicht gelesen werden`);
      continue;
    }

    setStep(1, 100, true);
    showLoading(`Buchungen werden erkannt…${fileLabel}`);
    const parsed = parseBankStatement(rawText);
    if (!parsed.length) {
      updateImportStatus(`Keine Buchungen in ${file.name}`, 'Das PDF scheint kein unterstütztes BAWAG/easybank-Format zu haben.');
      showToast(`${file.name}: Keine Buchungen erkannt`);
      continue;
    }

    updateImportStatus(`${parsed.length} Buchungen erkannt`, `KI-Kategorisierung läuft…${fileLabel}`);
    showLoading(`${parsed.length} Buchungen werden kategorisiert…${fileLabel}`);
    setStep(2, 50, false);

    let categorized;
    try {
      categorized = await categorizeWithAI(parsed, state.aiProvider, state.categoryOverrides || {});
      setStep(2, 100, true);
    } catch(e) {
      categorized = parsed.map(t => ({ ...t, category: 'Sonstiges', aiCategorized: false }));
      setStep(2, 100, false);
      showToast('KI-Kategorisierung fehlgeschlagen — "Sonstiges" zugewiesen');
    }

    const selectedChip = document.querySelector('#account-selector-chips .bs-chip.active');
    const fileName     = file.name.toLowerCase();
    const accountSlug  = selectedChip?.dataset.accId ||
                         (fileName.includes('erste') ? 'privat_manuel' : 'haushalt');
    const fileMonth  = categorized.map(t=>t.date.slice(0,7)).sort().reverse()[0];
    const importMonth = (fileMonth || state.currentMonth).replace('-','_');
    const importId    = `${accountSlug}_${importMonth}`;

    // Dedup: selbe Konto+Monat-Kombi bereits importiert?
    const alreadyImported = await checkImportExists(importId);
    if (alreadyImported) {
      showToast(`${file.name}: Bereits importiert — übersprungen`);
      continue;
    }

    const existing = new Set(state.transactions.map(t => `${t.date}|${t.amount}|${t.description}`));
    let added = 0;
    categorized.forEach(t => {
      const key = `${t.date}|${t.amount}|${t.description}`;
      if (!existing.has(key)) {
        t.account = accountSlug;
        state.transactions.push(t);
        existing.add(key);
        added++;
      }
    });
    totalAdded += added;

    const acc = state.accounts.find(a => a.id === accountSlug);
    if (acc) acc.lastImport = new Date().toISOString().slice(0,10);

    if (fileMonth && fileMonth > latestMonth) latestMonth = fileMonth;

    // Auto-match pending bons against newly imported transactions
    if ((state.pendingBons || []).length) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 60);
      const linked = [];
      const usedTxIds = new Set();
      (state.pendingBons).forEach(bon => {
        const bonDate = new Date(bon.date || bon.savedAt?.slice(0,10));
        if (bonDate < cutoffDate) return;
        const bonForMatch = { ...bon, date: bon.date || bon.savedAt?.slice(0,10) };
        const result = findMatch(bonForMatch, state.transactions.filter(t => !t.bon), { excludeIds: usedTxIds });
        const match = result?.transaction || null;
        if (match) { match.bon = bon; usedTxIds.add(match.id); linked.push(bon.id); totalAutoLinked++; }
      });
      if (linked.length) {
        state.pendingBons = state.pendingBons.filter(b => !linked.includes(b.id));
        linked.forEach(bonId => fsDeletePendingBon(bonId).catch(() => {}));
        state.transactions
          .filter(t => linked.some(bid => t.bon?.id === bid))
          .forEach(t => updateTx(t.id, { bon: t.bon }).catch(() => {}));
      }
    }

    _autoLinkGmailBons();

    // Firestore: neue Buchungen speichern + Import-Dokument anlegen
    saveTxBatch(state.transactions.filter(t =>
      categorized.some(c => c.id === t.id)
    )).catch(() => {});

    saveImport(importId, {
      filename:  file.name,
      txCount:   added,
      account:   accountSlug,
      dateRange: {
        from: categorized.map(t=>t.date).sort()[0],
        to:   categorized.map(t=>t.date).sort().reverse()[0],
      },
    }).catch(() => {});
  }

  state.currentMonth = latestMonth;
  saveState();

  setStep(3, 100, true);
  hideLoading();
  const multiLabel = fileCount > 1 ? ` aus ${fileCount} Dateien` : '';
  updateImportStatus('Import abgeschlossen', `${totalAdded} neue Buchungen importiert${multiLabel}.`);
  showToast(`✓ ${totalAdded} Buchungen importiert${totalAutoLinked ? ` · 🧾 ${totalAutoLinked} Bon${totalAutoLinked > 1 ? 's' : ''} automatisch verknüpft` : ''}`);

  selectedPdfFiles = [];
  document.getElementById('pdf-input').value = '';
  document.getElementById('import-btn').style.display = 'none';
  document.getElementById('account-selector-wrap').style.display = 'none';
  document.getElementById('upload-icon').textContent  = '📄';
  document.getElementById('upload-title').textContent = 'BAWAG / easybank PDF';
  document.getElementById('upload-sub').innerHTML     = 'Per Klick oder Drag &amp; Drop · Mehrere PDFs möglich<br><br><span style="display:inline-block;background:var(--surface-high);border-radius:100px;padding:4px 12px;font-size:0.6rem;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:var(--text-muted);">PDF · BAWAG · EASYBANK</span>';
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
  const antBtn  = document.getElementById('btn-anthropic');
  const oaiBtn  = document.getElementById('btn-openai');
  const antWrap = document.getElementById('anthropic-key-wrap');
  const oaiWrap = document.getElementById('openai-key-wrap');
  if (antBtn)  antBtn.className  = 'provider-btn ' + (p === 'anthropic' ? 'active' : '');
  if (oaiBtn)  oaiBtn.className  = 'provider-btn ' + (p === 'openai'    ? 'active' : '');
  if (antWrap) antWrap.style.display = p === 'anthropic' ? 'block' : 'none';
  if (oaiWrap) oaiWrap.style.display = p === 'openai'    ? 'block' : 'none';
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
// Schreibt einen Patch ({ anthropic?, openai? }) in den In-Memory-Store und
// persistiert ihn nach Firestore (household/main/config/apiKeys).
async function persistKeys(patch) {
  setInMemoryKeys({ ...loadKeys(), ...patch });
  await fsSaveApiKeys(patch);
}

window.saveKeys = async function() {
  const patch = {};
  const ak = document.getElementById('anthropic-key-input')?.value.trim();
  const ok = document.getElementById('openai-key-input')?.value.trim();
  if (ak != null) patch.anthropic = ak;
  if (ok != null) patch.openai    = ok;
  if (!Object.keys(patch).length) { showToast('Bitte einen API Key eingeben'); return; }
  try {
    await persistKeys(patch);
    showToast('✓ API Key gespeichert');
  } catch(e) {
    console.warn('saveKeys error:', e);
    showToast('⚠️ Key konnte nicht gespeichert werden');
  }
};

// ── Concierge / Bon ──
let _bonProvider = 'anthropic';

window.setBonProvider = function(p) {
  _bonProvider = p;
  const antBtn = document.getElementById('bon-btn-anthropic');
  const oaiBtn = document.getElementById('bon-btn-openai');
  if (antBtn) {
    antBtn.style.background  = p === 'anthropic' ? 'var(--primary)' : 'transparent';
    antBtn.style.color       = p === 'anthropic' ? '#fff' : 'var(--on-surface)';
    antBtn.style.borderColor = p === 'anthropic' ? 'var(--primary)' : 'var(--outline-variant)';
  }
  if (oaiBtn) {
    oaiBtn.style.background  = p === 'openai' ? 'var(--primary)' : 'transparent';
    oaiBtn.style.color       = p === 'openai' ? '#fff' : 'var(--on-surface)';
    oaiBtn.style.borderColor = p === 'openai' ? 'var(--primary)' : 'var(--outline-variant)';
  }
  const antWrap = document.getElementById('bon-anthropic-key-wrap');
  const oaiWrap = document.getElementById('bon-openai-key-wrap');
  if (antWrap) antWrap.style.display = p === 'anthropic' ? 'block' : 'none';
  if (oaiWrap) oaiWrap.style.display = p === 'openai'    ? 'block' : 'none';
};

window.saveBonKey = async function() {
  const patch = {};
  const ak = document.getElementById('bon-anthropic-key')?.value.trim();
  const ok = document.getElementById('bon-openai-key')?.value.trim();
  if (ak) patch.anthropic = ak;
  if (ok) patch.openai    = ok;
  if (!Object.keys(patch).length) { showToast('Bitte einen API Key eingeben'); return; }
  try {
    await persistKeys(patch);
    showToast('✓ API Key gespeichert');
  } catch(e) {
    console.warn('saveBonKey error:', e);
    showToast('⚠️ Key konnte nicht gespeichert werden');
  }
};

window.resetConcierge = function() {
  document.getElementById('concierge-upload').style.display = 'block';
  document.getElementById('concierge-result').style.display = 'none';
  document.getElementById('bon-input').value = '';
  renderPendingBons();
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

  // Normalize MIME type: empty string (Android camera) → jpeg, HEIC → unsupported
  let mimeType = file.type || 'image/jpeg';
  if (mimeType === 'image/heic' || mimeType === 'image/heif') {
    showToast('HEIC-Format nicht unterstützt — bitte Kamera auf JPEG umstellen (Einstellungen → Kamera → Format → Hohe Effizienz deaktivieren)');
    return;
  }

  const isImage = mimeType.startsWith('image/');
  const isPdf   = mimeType === 'application/pdf' || file.name?.endsWith('.pdf');

  if (!isImage && !isPdf) {
    showToast('Dateiformat nicht unterstützt — bitte JPG, PNG oder PDF');
    return;
  }

  showLoading('Bon wird analysiert…');
  try {
    let bonData;
    if (_bonProvider === 'anthropic') {
      if (isImage) {
        const base64 = await fileToBase64(file);
        bonData = await analyzeBonImage(base64, mimeType);
      } else {
        const pdfText = await extractPdfText(file);
        bonData = await analyzeBonPdf(pdfText);
      }
    } else {
      if (isImage) {
        const base64 = await fileToBase64(file);
        bonData = await analyzeBonOpenAI(base64, mimeType);
      } else {
        const pdfText = await extractPdfText(file);
        bonData = await analyzeBonPdfOpenAI(pdfText);
      }
    }
    hideLoading();
    renderConciergeResult(bonData);
  } catch(e) {
    hideLoading();
    showToast('Bon-Analyse fehlgeschlagen: ' + (e.message || 'Unbekannter Fehler'));
  }
};

function applySubcatOverrides(items) {
  const ov = state.subcategoryOverrides || {};
  return items.map(item => {
    const key = (item.name || '').toLowerCase().trim();
    return ov[key] ? { ...item, subcategory: ov[key] } : item;
  });
}

function renderConciergeResult(bon) {
  if (bon.items?.length) bon.items = applySubcatOverrides(bon.items);
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
  const bestMatch    = findMatch(bon, state.transactions);
  if (bestMatch) {
    const m  = bestMatch.transaction;
    const ml = matchLabel(bestMatch.score);
    matchSection.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <div class="section-label" style="margin:0;">Passende Buchung</div>
        <span class="chip ${ml.chip}" style="font-size:0.6rem;padding:2px 8px;">${ml.label}</span>
      </div>
      <div class="match-card" id="match-${m.id}">
        <div class="tx-icon-wrap" style="width:40px;height:40px;">${m.bon ? '🔗' : (CAT_CONFIG[m.category]?.icon||'📌')}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:0.85rem;font-weight:700;">${escHtml(m.description)}</div>
          <div style="font-size:0.65rem;color:var(--text-muted);margin-top:2px;">${formatDate(m.date)} · ${escHtml(bestMatch.reason)}</div>
          ${m.bon ? `<div style="font-size:0.65rem;color:var(--green);margin-top:4px;">✅ Bereits verknüpft</div>` : ''}
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;">
          <div style="font-family:var(--serif);font-size:0.95rem;font-weight:700;">${formatEur(Math.abs(m.amount))}</div>
          ${m.bon
            ? `<span class="chip chip-green" style="padding:2px 8px;font-size:0.6rem;">Verknüpft</span>`
            : `<button onclick="linkBon('${m.id}')" style="padding:5px 12px;border-radius:8px;border:none;background:var(--primary-container);color:var(--on-primary);font-size:0.68rem;font-weight:700;cursor:pointer;font-family:var(--sans);">🔗 Verknüpfen</button>`}
        </div>
      </div>`;
  } else {
    matchSection.innerHTML = `
      <div style="font-size:0.82rem;color:var(--text-muted);text-align:center;padding:12px 0 10px;">Keine passende Buchung gefunden.</div>
      <button onclick="savePendingBon()" style="width:100%;padding:16px;border-radius:12px;border:none;background:var(--primary-container);color:var(--on-primary);font-size:0.85rem;font-weight:700;cursor:pointer;font-family:var(--sans);line-height:1.4;">⏳ Als offen speichern<br><span style="font-weight:400;font-size:0.7rem;opacity:0.8;">Wird automatisch verknüpft sobald der Kontoauszug importiert wird</span></button>
    `;
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
  updateTx(txId, { bon: _currentBon }).catch(() => {});
  showToast(`✅ Verknüpft mit "${tx.description}"`);
  renderConciergeResult(_currentBon);
};

window.savePendingBon = function() {
  if (!_currentBon) return;
  if (!state.pendingBons) state.pendingBons = [];
  const id  = 'bon_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
  const bon = { ..._currentBon, id, savedAt: new Date().toISOString() };
  state.pendingBons.push(bon);
  saveState();
  fsAddPendingBon(bon).catch(() => {});
  showToast('⏳ Bon gespeichert — wird beim nächsten Import automatisch verknüpft');
  resetConcierge();
};

window.deletePendingBon = function(id) {
  if (!state.pendingBons) return;
  state.pendingBons = state.pendingBons.filter(b => b.id !== id);
  saveState();
  fsDeletePendingBon(id).catch(() => {});
  renderPendingBons();
};

function updateConciergeNavBadge() {
  const count = (state.pendingBons || []).length;
  const badge = document.getElementById('nav-concierge-badge');
  if (!badge) return;
  badge.textContent = count;
  badge.style.display = count > 0 ? 'flex' : 'none';
}

function renderPendingBons() {
  const list = document.getElementById('pending-bons-list');
  if (!list) return;
  updateConciergeNavBadge();
  const bons = state.pendingBons || [];
  if (!bons.length) { list.innerHTML = ''; return; }
  list.innerHTML = `
    <div style="margin-top:24px;border-top:1px solid var(--outline-soft);padding-top:20px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <div class="section-label" style="margin:0;">Offene Belege</div>
        <span class="chip chip-gold" style="font-size:0.6rem;padding:2px 8px;">${bons.length} unverknüpft</span>
      </div>
      <div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:14px;">Importiert oder gescannt — noch keiner Buchung zugeordnet.</div>
      ${bons.map(b => `
        <div class="card" style="padding:14px 16px;margin-bottom:10px;display:flex;align-items:center;gap:12px;">
          <div style="font-size:1.4rem;">🧾</div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:0.85rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(b.store || 'Unbekannt')}</div>
            <div style="font-size:0.65rem;color:var(--text-muted);margin-top:2px;">${b.date ? formatDate(b.date) : '—'} · ${formatEur(b.total)}</div>
          </div>
          <button onclick="deletePendingBon('${b.id}')" style="padding:5px 10px;border-radius:8px;border:none;background:var(--surface-container);color:var(--on-surface-variant);font-size:0.68rem;cursor:pointer;">✕</button>
        </div>
      `).join('')}
    </div>
  `;
}

// ── DOMContentLoaded ──
// ── Buchungen Filter Bottom Sheet ──
function initBuchFilters() {
  const MONTHS_S = ['Jän','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
  const MONTHS_L = ['Jänner','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
  const CATS = Object.entries(CAT_CONFIG).map(([label, cfg]) => ({ emoji: cfg.icon, label }));

  let monthSheetFromFilter = false;
  let pendingMonth = { year: 2026, month: 0 };
  let confirmedMonth = { year: 2026, month: 0 };
  let pendingFilter = { konto: 'alle', beleg: 'alle', typ: 'alle', cats: new Set(), quelle: 'alle' };

  const overlay    = document.getElementById('buchOverlay');
  const filterSheet = document.getElementById('buchFilterSheet');
  const monthSheet  = document.getElementById('buchMonthSheet');
  if (!overlay || !filterSheet || !monthSheet) return;

  // Init confirmed month from state
  function syncConfirmedFromState() {
    const [y, m] = state.currentMonth.split('-').map(Number);
    confirmedMonth = { year: y, month: m - 1 };
  }
  syncConfirmedFromState();

  function updateMonthLabels() {
    const lbl = `${MONTHS_L[confirmedMonth.month]} ${confirmedMonth.year}`;
    const el1 = document.getElementById('buchMonthLabel');
    const el2 = document.getElementById('fsMonthLabel');
    if (el1) el1.textContent = lbl;
    if (el2) el2.textContent = lbl;
  }

  function buildAvailableMonths() {
    const result = {};
    getAvailableMonths().forEach(ym => {
      const [y, m] = ym.split('-').map(Number);
      if (!result[y]) result[y] = [];
      result[y].push(m - 1);
    });
    return result;
  }

  // ── Category grid ──
  function renderCatGrid() {
    const grid = document.getElementById('buchCatGrid');
    if (!grid) return;
    grid.innerHTML = CATS.map((c, i) =>
      `<button class="cat-chip-btn${pendingFilter.cats.has(i) ? ' active' : ''}" data-ci="${i}">
        <span>${c.emoji}</span><span>${c.label}</span>
      </button>`
    ).join('');
    grid.querySelectorAll('.cat-chip-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.ci);
        if (pendingFilter.cats.has(i)) pendingFilter.cats.delete(i);
        else pendingFilter.cats.add(i);
        renderCatGrid();
      });
    });
  }

  // ── Chip group toggles ──
  filterSheet.querySelectorAll('.bs-chips').forEach(row => {
    row.querySelectorAll('.bs-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const group = row.dataset.group;
        const val   = chip.dataset.val;
        row.querySelectorAll('.bs-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        pendingFilter[group] = val;
      });
    });
  });

  // ── Filter sheet open/close ──
  function openFilterSheet() {
    pendingFilter = {
      konto: _buchFilter.konto, beleg: _buchFilter.beleg,
      typ: _buchFilter.typ, cats: new Set(_buchFilter.cats.map(l => CATS.findIndex(c => c.label === l))),
      quelle: _buchFilter.quelle
    };
    // sync chip active states
    filterSheet.querySelectorAll('.bs-chips').forEach(row => {
      const group = row.dataset.group;
      row.querySelectorAll('.bs-chip').forEach(c => {
        c.classList.toggle('active', c.dataset.val === pendingFilter[group]);
      });
    });
    renderCatGrid();
    overlay.classList.add('visible');
    filterSheet.classList.add('open');
  }

  function closeFilterSheet() {
    filterSheet.classList.remove('open');
    overlay.classList.remove('visible');
  }

  // ── Filter badge + active pills ──
  function updateFilterBadge() {
    let n = 0;
    if (_buchFilter.konto  !== 'alle') n++;
    if (_buchFilter.beleg  !== 'alle') n++;
    if (_buchFilter.typ    !== 'alle') n++;
    if (_buchFilter.quelle !== 'alle') n++;
    n += _buchFilter.cats.length;
    const badge = document.getElementById('buchFilterBadge');
    const btn   = document.getElementById('buchFilterBtn');
    if (badge) { badge.textContent = n; badge.classList.toggle('show', n > 0); }
    if (btn)   btn.classList.toggle('has-active', n > 0);
  }

  function renderActivePills() {
    const bar = document.getElementById('activePills');
    if (!bar) return;
    const items = [];
    if (_buchFilter.konto  !== 'alle') items.push({ label: _buchFilter.konto === 'manuel' ? '👤 Manuel' : '👤 Olga', key: 'konto' });
    if (_buchFilter.beleg  !== 'alle') items.push({ label: _buchFilter.beleg === 'linked' ? '✅ Verknüpft' : '◻ Offen', key: 'beleg' });
    if (_buchFilter.typ    !== 'alle') items.push({ label: _buchFilter.typ === 'aus' ? '↑ Ausgaben' : '↓ Einnahmen', key: 'typ' });
    if (_buchFilter.quelle !== 'alle') items.push({ label: _buchFilter.quelle === 'gmail' ? '✉ Rechnungen' : '📄 Kontoauszug', key: 'quelle' });
    _buchFilter.cats.forEach(l => items.push({ label: (CATS.find(c => c.label === l)?.emoji || '') + ' ' + l, key: 'cat:' + l }));
    bar.innerHTML = items.map(it =>
      `<div class="ap-pill">${it.label}<span class="px" data-key="${it.key}">✕</span></div>`
    ).join('');
    bar.querySelectorAll('.px').forEach(x => {
      x.addEventListener('click', () => removePill(x.dataset.key));
    });
  }

  function removePill(key) {
    if (key.startsWith('cat:')) {
      _buchFilter.cats = _buchFilter.cats.filter(l => l !== key.slice(4));
    } else {
      _buchFilter[key] = 'alle';
    }
    renderActivePills();
    updateFilterBadge();
    renderBuchungen();
  }

  // ── Reset & Apply ──
  document.getElementById('buchFilterReset')?.addEventListener('click', () => {
    _buchFilter = { konto: 'alle', beleg: 'alle', typ: 'alle', cats: [], quelle: 'alle' };
    syncConfirmedFromState();
    updateMonthLabels();
    closeFilterSheet();
    renderActivePills();
    updateFilterBadge();
    renderBuchungen();
  });

  document.getElementById('buchFilterApply')?.addEventListener('click', () => {
    confirmedMonth = { ...pendingMonth };
    const ym = `${confirmedMonth.year}-${String(confirmedMonth.month + 1).padStart(2,'0')}`;
    state.currentMonth = ym;
    saveState();
    _buchFilter = {
      konto: pendingFilter.konto, beleg: pendingFilter.beleg, typ: pendingFilter.typ,
      cats: [...pendingFilter.cats].map(i => CATS[i]?.label).filter(Boolean),
      quelle: pendingFilter.quelle
    };
    updateMonthLabels();
    closeFilterSheet();
    renderActivePills();
    updateFilterBadge();
    renderBuchungen();
  });

  document.getElementById('buchFilterClose')?.addEventListener('click', closeFilterSheet);
  document.getElementById('buchFilterBtn')?.addEventListener('click', openFilterSheet);

  window._refreshBuchUI = function() { renderActivePills(); updateFilterBadge(); };

  // ── Month sheet ──
  function openMonthSheet(fromFilter = false) {
    monthSheetFromFilter = fromFilter;
    syncConfirmedFromState();
    pendingMonth = { ...confirmedMonth };
    renderMonthGrid();
    monthSheet.classList.add('open');
    if (!fromFilter) overlay.classList.add('visible');
  }

  function closeMonthSheet() {
    monthSheet.classList.remove('open');
    if (!monthSheetFromFilter) overlay.classList.remove('visible');
  }

  function renderMonthGrid() {
    const available = buildAvailableMonths();
    const avail = available[pendingMonth.year] || [];
    const allYears = Object.keys(available).map(Number);
    const minY = allYears.length ? Math.min(...allYears) : pendingMonth.year;
    const maxY = allYears.length ? Math.max(...allYears) : pendingMonth.year;
    const yearLbl = document.getElementById('buchYearLabel');
    if (yearLbl) yearLbl.textContent = pendingMonth.year;
    const btnPrev = document.getElementById('buchYearPrev');
    const btnNext = document.getElementById('buchYearNext');
    if (btnPrev) btnPrev.disabled = pendingMonth.year <= minY;
    if (btnNext) btnNext.disabled = pendingMonth.year >= maxY;
    const grid = document.getElementById('buchMonthGrid');
    if (!grid) return;
    grid.innerHTML = MONTHS_S.map((name, i) => {
      const ok = avail.includes(i);
      const active = i === pendingMonth.month;
      return `<button class="mgb-btn${active ? ' active' : ''}" ${ok ? '' : 'disabled'} data-mi="${i}">${name}</button>`;
    }).join('');
    grid.querySelectorAll('.mgb-btn:not(:disabled)').forEach(btn => {
      btn.addEventListener('click', () => {
        pendingMonth.month = parseInt(btn.dataset.mi);
        renderMonthGrid();
      });
    });
  }

  document.getElementById('buchMsClose')?.addEventListener('click', closeMonthSheet);
  document.getElementById('buchMsConfirm')?.addEventListener('click', () => {
    confirmedMonth = { ...pendingMonth };
    const ym = `${confirmedMonth.year}-${String(confirmedMonth.month + 1).padStart(2,'0')}`;
    state.currentMonth = ym;
    saveState();
    updateMonthLabels();
    closeMonthSheet();
    if (!monthSheetFromFilter) renderBuchungen();
  });
  document.getElementById('buchYearPrev')?.addEventListener('click', () => {
    const minY = Math.min(...Object.keys(buildAvailableMonths()).map(Number));
    if (pendingMonth.year > minY) { pendingMonth.year--; renderMonthGrid(); }
  });
  document.getElementById('buchYearNext')?.addEventListener('click', () => {
    const maxY = Math.max(...Object.keys(buildAvailableMonths()).map(Number));
    if (pendingMonth.year < maxY) { pendingMonth.year++; renderMonthGrid(); }
  });
  document.getElementById('fsMonthBtn')?.addEventListener('click', () => openMonthSheet(true));
  document.getElementById('buchMonthTrigger')?.addEventListener('click', () => openMonthSheet(false));

  overlay.addEventListener('click', () => {
    if (monthSheet.classList.contains('open') && !monthSheetFromFilter) closeMonthSheet();
    else if (!monthSheet.classList.contains('open')) closeFilterSheet();
  });

  // Expose globally so onclick attributes and external callers can reach them
  window.openBuchFilterSheet  = openFilterSheet;
  window.closeBuchFilterSheet = closeFilterSheet;
  window.openBuchMonthSheet   = (fromFilter = false) => openMonthSheet(fromFilter);
  window.closeBuchMonthSheet  = closeMonthSheet;

  // Init labels
  updateMonthLabels();
  updateFilterBadge();
}

// ── Month Picker Bottom Sheet ──
function initMonthPicker() {
  const MONTH_NAMES_SHORT = ['Jän','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];

  let pendingYear, pendingMonth;
  let _onConfirm = null;

  const overlay      = document.getElementById('monthPickerOverlay');
  const sheet        = document.getElementById('monthPickerSheet');
  const sheetYearLbl = document.getElementById('sheetYearLabel');
  const grid         = document.getElementById('monthPickerGrid');
  const btnPrev      = document.getElementById('yearPrev');
  const btnNext      = document.getElementById('yearNext');
  const btnClose     = document.getElementById('monthPickerClose');
  const btnConfirm   = document.getElementById('monthPickerConfirm');

  if (!overlay || !sheet) return;

  function buildAvailableMonths() {
    const result = {};
    getAvailableMonths().forEach(ym => {
      const [y, m] = ym.split('-').map(Number);
      if (!result[y]) result[y] = [];
      result[y].push(m - 1);
    });
    return result;
  }

  function renderGrid() {
    const available = buildAvailableMonths();
    const availMonths = available[pendingYear] || [];
    const allYears = Object.keys(available).map(Number);
    const minYear = Math.min(...allYears);
    const maxYear = Math.max(...allYears);

    sheetYearLbl.textContent = pendingYear;
    btnPrev.disabled = pendingYear <= minYear;
    btnNext.disabled = pendingYear >= maxYear;

    grid.innerHTML = MONTH_NAMES_SHORT.map((name, i) => {
      const isAvail  = availMonths.includes(i);
      const isActive = i === pendingMonth;
      return `
        <button class="grid-month-btn${isActive ? ' active' : ''}"
          ${!isAvail ? 'disabled' : ''}
          data-month="${i}">
          ${name}
          ${isAvail ? '<div class="grid-month-dot"></div>' : ''}
        </button>`;
    }).join('');

    grid.querySelectorAll('.grid-month-btn:not(:disabled)').forEach(btn => {
      btn.addEventListener('click', () => {
        pendingMonth = parseInt(btn.dataset.month);
        renderGrid();
      });
    });
  }

  function openSheet(onConfirmCb) {
    _onConfirm = onConfirmCb;
    const [y, m] = state.currentMonth.split('-').map(Number);
    pendingYear  = y;
    pendingMonth = m - 1;
    renderGrid();
    overlay.classList.add('visible');
    sheet.classList.add('open');
  }

  function closeSheet() {
    overlay.classList.remove('visible');
    sheet.classList.remove('open');
  }

  function confirmSelection() {
    const ym = `${pendingYear}-${String(pendingMonth + 1).padStart(2,'0')}`;
    closeSheet();
    if (_onConfirm) _onConfirm(ym);
  }

  overlay.addEventListener('click', closeSheet);
  btnClose.addEventListener('click', closeSheet);
  btnConfirm.addEventListener('click', confirmSelection);
  btnPrev.addEventListener('click', () => {
    const minYear = Math.min(...Object.keys(buildAvailableMonths()).map(Number));
    if (pendingYear > minYear) { pendingYear--; renderGrid(); }
  });
  btnNext.addEventListener('click', () => {
    const maxYear = Math.max(...Object.keys(buildAvailableMonths()).map(Number));
    if (pendingYear < maxYear) { pendingYear++; renderGrid(); }
  });

  document.getElementById('monthTriggerChip')?.addEventListener('click', () =>
    openSheet(ym => { state.currentMonth = ym; saveState(); renderDashboard(); })
  );
  document.getElementById('rechnMonthTrigger')?.addEventListener('click', () =>
    openSheet(ym => { state.currentMonth = ym; saveState(); renderRechnungen(); })
  );
}

async function _bootWithFirebase() {
  showLoading('Verbinde…');

  onAuthChange(async user => {
    if (!user) {
      hideLoading();
      document.getElementById('login-screen')?.classList.add('visible');
      return;
    }

    // Eingeloggt — Daten laden
    document.getElementById('login-screen')?.classList.remove('visible');
    showLoading('Daten werden geladen…');

    // Alten localStorage-Key aus Pre-Firebase-Ära entfernen
    localStorage.removeItem('finance_v2_data');

    try {
      const data = await loadAllData();

      // State befüllen
      state.transactions         = data.transactions;
      state.pendingBons          = data.pendingBons;
      state.categoryOverrides    = data.categoryOverrides;
      state.subcategoryOverrides = data.subcategoryOverrides;
      state.currentMonth      = getCurrentMonth();
      setInMemoryKeys(data.apiKeys);

      // Einmalige Subkat-Drift-Migration: alte Aliase auf kanonische Namen
      // mappen und in Firestore persistieren. Läuft jeden Login still im
      // Hintergrund — no-op sobald die Daten clean sind.
      _migrateSubcatAliases().catch(e => console.warn('Subcat migration:', e));

    } catch(e) {
      console.warn('Firestore load error:', e);
      showToast('⚠️ Firestore nicht erreichbar — lokale Daten werden verwendet');
    }

    hideLoading();
    _initApp();
  });
}

window.firebaseLogin = async function() {
  const errEl = document.getElementById('login-error');
  if (errEl) errEl.textContent = '';
  try {
    await login();
  } catch(e) {
    if (errEl) errEl.textContent = e.message;
  }
};

window.firebaseLogout = async function() {
  await logout();
  state.transactions      = [];
  state.pendingBons       = [];
  state.categoryOverrides = {};
  setInMemoryKeys({ anthropic: '', openai: '' });
  document.getElementById('login-screen')?.classList.add('visible');
};

async function _migrateSubcatAliases() {
  const aliasKeys = Object.keys(SUBCAT_ALIASES);
  const dirty = [];
  state.transactions.forEach(tx => {
    if (!tx.bon?.items?.length) return;
    let changed = false;
    const items = tx.bon.items.map(item => {
      const raw = item.subcategory || item.subkategorie;
      if (!raw || !aliasKeys.includes(String(raw).trim())) return item;
      changed = true;
      const normalized = normalizeSubcategory(raw);
      const next = { ...item, subcategory: normalized };
      delete next.subkategorie;
      return next;
    });
    if (changed) {
      tx.bon = { ...tx.bon, items };
      dirty.push(tx);
    }
  });
  if (!dirty.length) return;
  console.log(`[subcat-migration] ${dirty.length} Tx mit Subkat-Aliasen normalisiert`);
  await Promise.all(dirty.map(tx => updateTx(tx.id, { bon: tx.bon })));
}

function _autoLinkGmailBons() {
  const gmailWithBon = state.transactions.filter(t => t.source === 'gmail_import' && t.bon);
  if (!gmailWithBon.length) return;

  // Phase 1: Self-Healing — alle bisherigen gmail-Bon-Links von Bank-Txs lösen.
  // Damit kann der (verbesserte) Matcher beim Re-Lauf falsche Altlinks korrigieren.
  // Manuell vom User gescannte Bons (source !== gmail_import) bleiben unangetastet.
  const previouslyLinked = new Map();
  state.transactions.forEach(t => {
    if (t.source !== 'gmail_import' && t.bon?.source === 'gmail_import') {
      previouslyLinked.set(t.id, t.bon);
      t.bon = null;
    }
  });

  // Phase 2: mit dem aktuellen Matcher neu verknüpfen
  const bankTxs = state.transactions.filter(t => t.source !== 'gmail_import' && !t.bon && t.amount < 0);
  const usedTxIds   = new Set();
  const newlyLinked = new Set();
  gmailWithBon.forEach(gmail => {
    const bonObj = { date: gmail.date, total: Math.abs(gmail.amount), store: gmail.description };
    const result = findMatch(bonObj, bankTxs, { excludeIds: usedTxIds });
    if (result?.transaction) {
      result.transaction.bon = gmail.bon;
      usedTxIds.add(result.transaction.id);
      newlyLinked.add(result.transaction.id);
      updateTx(result.transaction.id, { bon: gmail.bon }).catch(() => {});
    }
  });

  // Phase 3: Bank-Txs die vorher verknüpft waren aber jetzt keinen Match mehr
  // bekommen → Clear in Firestore persistieren.
  previouslyLinked.forEach((_, txId) => {
    if (!newlyLinked.has(txId)) {
      updateTx(txId, { bon: null }).catch(() => {});
    }
  });
}

function _initApp() {
  // Drag & drop
  const zone = document.getElementById('upload-zone');
  if (zone) {
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.classList.remove('dragover');
      const files = Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf' || f.name?.endsWith('.pdf'));
      if (files.length) {
        selectedPdfFiles = files;
        _setUploadUI(files);
      }
    });
  }

  initBuchFilters();
  initMonthPicker();

  // Search input (not global in ES module, so register via JS)
  document.getElementById('search-input')?.addEventListener('input', renderBuchungen);

  // Modal close on overlay click
  document.getElementById('tx-modal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('tx-modal')) window.closeTxModal();
  });
  document.getElementById('clear-modal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('clear-modal')) window.closeClearModal();
  });

  // Swipe-to-close for tx-modal bottom sheet
  (function() {
    const overlay = document.getElementById('tx-modal');
    const sheet   = overlay?.querySelector('.modal-sheet');
    if (!sheet) return;
    let startY = 0, currentY = 0, dragging = false;

    sheet.addEventListener('touchstart', e => {
      // Only start swipe if touch begins on the handle or near the top of the sheet
      const touchY = e.touches[0].clientY;
      const sheetTop = sheet.getBoundingClientRect().top;
      if (touchY - sheetTop > 60) return; // only top 60px triggers swipe
      startY = touchY;
      currentY = 0;
      dragging = true;
      sheet.style.transition = 'none';
    }, { passive: true });

    sheet.addEventListener('touchmove', e => {
      if (!dragging) return;
      const dy = e.touches[0].clientY - startY;
      if (dy < 0) return; // no upward drag
      currentY = dy;
      sheet.style.transform = `translateY(${dy}px)`;
      overlay.style.backgroundColor = `rgba(0,0,0,${Math.max(0, 0.4 - dy / 400)})`;
    }, { passive: true });

    sheet.addEventListener('touchend', () => {
      if (!dragging) return;
      dragging = false;
      sheet.style.transition = 'transform 0.3s ease';
      if (currentY > 120) {
        sheet.style.transform = 'translateY(100%)';
        setTimeout(() => {
          window.closeTxModal();
          sheet.style.transform = '';
          sheet.style.transition = '';
          overlay.style.backgroundColor = '';
        }, 280);
      } else {
        sheet.style.transform = '';
        overlay.style.backgroundColor = '';
        setTimeout(() => { sheet.style.transition = ''; }, 300);
      }
    });
  })();

  // Swipe left/right to navigate onboarding steps
  (function() {
    const container = document.getElementById('ob-steps-container');
    if (!container || container._obSwipe) return;
    container._obSwipe = true;
    let sx = 0;
    container.addEventListener('touchstart', e => { sx = e.touches[0].clientX; }, { passive: true });
    container.addEventListener('touchend',   e => {
      const dx = e.changedTouches[0].clientX - sx;
      if (Math.abs(dx) > 40) { if (dx < 0) window.obNext(); else window.obBack(); }
    }, { passive: true });
  })();

  _autoLinkGmailBons();
  setProviderUI(state.aiProvider);

  // Bon-Key-Felder mit gespeicherten Keys vorbefüllen + Provider-Toggle setzen
  const _keys = loadKeys();
  const _antKeyEl = document.getElementById('bon-anthropic-key');
  const _oaiKeyEl = document.getElementById('bon-openai-key');
  if (_antKeyEl && _keys.anthropic) _antKeyEl.value = _keys.anthropic;
  if (_oaiKeyEl && _keys.openai)    _oaiKeyEl.value = _keys.openai;
  window.setBonProvider(_bonProvider);

  renderDashboard();
  renderKonten();
  window.showScreen('dashboard');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _bootWithFirebase);
} else {
  _bootWithFirebase();
}
