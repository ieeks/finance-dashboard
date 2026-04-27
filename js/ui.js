// ui.js — Format-Helpers, Toast, Loading, API Keys

// ── Format Helpers ──
export function formatEur(amount) {
  return new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' }).format(amount);
}

export function formatDate(isoDate) {
  const d = new Date(isoDate + 'T12:00:00');
  return d.toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── API Keys — In-Memory (gesetzt nach Firebase-Login aus Firestore) ──
let _memKeys = { anthropic: '', openai: '' };

export function setInMemoryKeys(keys) {
  _memKeys = { anthropic: keys.anthropic || '', openai: keys.openai || '' };
}

export function loadKeys() {
  return { ..._memKeys };
}

// ── Toast ──
let _toastTimer = null;
export function showToast(msg, duration = 2500) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), duration);
}

// ── Loading ──
export function showLoading(msg = 'Verarbeite…') {
  const textEl = document.getElementById('loading-text');
  if (textEl) textEl.textContent = msg;
  document.getElementById('loading-overlay')?.classList.add('active');
}

export function hideLoading() {
  document.getElementById('loading-overlay')?.classList.remove('active');
}
