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

// ── Onboarding ──
export function initOnboarding() {
  const modal   = document.getElementById('onboarding-modal');
  const closeBtn = document.getElementById('ob-close');
  const nextBtn  = document.getElementById('ob-next');
  const backBtn  = document.getElementById('ob-back');
  const dots     = document.querySelectorAll('[data-ob-dot]');
  const steps    = document.querySelectorAll('[data-ob-step]');
  const TOTAL    = 4;
  let current    = 1;

  function show(step) {
    current = step;
    steps.forEach(el => { el.hidden = parseInt(el.dataset.obStep) !== step; });
    dots.forEach(d  => { d.classList.toggle('active', parseInt(d.dataset.obDot) === step); });
    backBtn.style.visibility = step === 1 ? 'hidden' : 'visible';
    nextBtn.textContent = step === TOTAL ? 'Los geht\'s' : 'Weiter';
  }

  window.openOnboarding = function() {
    modal.classList.add('open');
    show(1);
  };

  closeBtn.addEventListener('click', () => modal.classList.remove('open'));
  modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('open'); });
  nextBtn.addEventListener('click', () => { if (current < TOTAL) show(current + 1); else modal.classList.remove('open'); });
  backBtn.addEventListener('click', () => { if (current > 1) show(current - 1); });
}
