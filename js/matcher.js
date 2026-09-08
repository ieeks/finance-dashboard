// matcher.js — Score-basiertes Bon ↔ Buchung Matching
//
// Score-System (max 100):
//   amountDiff < 0.005 €  → 50   |  ≤ 2 €  → 25   |  sonst Hard-Out
//   days = 0              → 30   |  ≤ 3    → 20   |  ≤ 7   → 10  |  sonst Hard-Out
//   nameScore (0..1)              → × 20   (max 20)
//
// `days` ist der kleinste Abstand zwischen Buchung und einem der bekannten
// Bon-Daten (Rechnungsdatum + optionales Abbuchungsdatum) — siehe
// _bestDateDistance().
//
// Hard-Out Regeln:
//   - signedDays < -1   (Bon-Datum mehr als 1 Tag NACH Buchung) → kein Match
//   - nameScore === 0 UND amountDiff > 0.005 → kein Match
//     (verhindert Cross-Matches bei ähnlichen Beträgen ohne Händler-Bezug)

const AMOUNT_EXACT_EUR = 0.005;
const AMOUNT_NEAR_EUR  = 2;
const DATE_MAX_DAYS    = 7;
const MIN_SCORE        = 60;

// Unklare Belege offen lassen; keine Zahlungs-/Währungslogik erraten.
export function bonNeedsReview(bon) {
  if (!bon || bon.needsReview || !Number.isFinite(bon.total) || bon.total <= 0) return true;
  if (bon.currency && bon.currency !== 'EUR') return true;
  const vat = Number(bon.vat ?? 0), tip = Number(bon.tip ?? 0);
  if (!Number.isFinite(vat) || !Number.isFinite(tip) || vat < 0 || tip < 0) return true;
  if (bon.items?.length) {
    const amounts = bon.items.map(i => Number(i.price ?? i.gesamt));
    if (amounts.some(n => !Number.isFinite(n))) return true;
    if (Math.abs(Math.round(amounts.reduce((a, b) => a + b, 0) * 100)
        - Math.round((bon.total - vat) * 100)) > 1) return true;
  }
  return false;
}

function _normalizeTokens(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 3);
}

// 0..1 — Anteil der Bon-Tokens die in der TX-Description vorkommen
function nameSimilarity(txDescription, bonStore) {
  const txTokens  = new Set(_normalizeTokens(txDescription));
  const bonTokens = _normalizeTokens(bonStore);
  if (!bonTokens.length || !txTokens.size) return 0;
  const hits = bonTokens.filter(t => txTokens.has(t)).length;
  return hits / bonTokens.length;
}

function _reason(amountDiff, days, nameScore) {
  const parts = [];
  if (amountDiff < AMOUNT_EXACT_EUR) parts.push('Betrag exakt');
  else                                parts.push(`Betrag ±${amountDiff.toFixed(2)} €`);
  if (days === 0)      parts.push('selber Tag');
  else if (days <= 3)  parts.push(`±${Math.round(days)} Tage`);
  else                 parts.push(`±${Math.round(days)} Tage`);
  if (nameScore >= 0.5)      parts.push('Händler erkannt');
  else if (nameScore > 0)    parts.push('Händler teilweise');
  return parts.join(', ');
}

/**
 * Bester Datums-Abstand zwischen Buchung und den bekannten Bon-Daten.
 *
 * Rechnungen mit Lastschrift (VERBUND, T-Mobile, Versicherungen) tragen ein
 * Rechnungsdatum UND ein Abbuchungsdatum, die weit auseinanderliegen können —
 * VERBUND stellt am 07.07. aus und zieht am 02.08. ein (26 Tage). Gegen das
 * Rechnungsdatum gemessen fällt so eine Buchung immer aus DATE_MAX_DAYS.
 * Deshalb gegen BEIDE Daten prüfen und das nähere gewinnen lassen — gleiches
 * Muster wie `total` / `total + tip` beim Betrag.
 *
 * @returns {number|null} Tages-Abstand, oder null wenn kein Datum zulässig ist
 */
function _bestDateDistance(txDate, bonDates) {
  let best = null;
  for (const bonDate of bonDates) {
    const signedDays = (new Date(txDate) - new Date(bonDate)) / 86400000;
    if (Number.isNaN(signedDays)) continue;
    const days = Math.abs(signedDays);
    // Bon-Datum mehr als 1 Tag NACH der Buchung → kann nicht dazugehören
    if (signedDays < -1.5)    continue;
    if (days > DATE_MAX_DAYS) continue;
    if (best === null || days < best) best = days;
  }
  return best;
}

/**
 * Findet die beste passende Buchung für einen Bon.
 * @param {object} bon                  - { date, total, store, debitDate? }
 * @param {array}  txList               - Transaktionen { date, amount, description, id? }
 * @param {object} [opts]
 * @param {Set}    [opts.excludeIds]    - bereits verknüpfte Tx-IDs überspringen
 * @returns {{ transaction, score, reason } | null}
 */
export function findMatch(bon, txList, { excludeIds } = {}) {
  if (bonNeedsReview(bon) || !bon.date || bon.dateSuspect) return null;

  const bonDates = [bon.date, bon.debitDate].filter(Boolean);

  const candidates = txList
    .filter(tx => tx.amount < 0)
    .filter(tx => tx.source !== 'gmail_import')
    .filter(tx => !bon.account || bon.account === 'unbekannt' || !tx.account || tx.account === bon.account)
    .filter(tx => !excludeIds || !excludeIds.has(tx.id))
    .map(tx => {
      // Trinkgeld (unbar) wird oft zusätzlich von der Karte abgebucht, steht
      // aber nicht im Bon-Total. Daher gegen total UND total+tip matchen.
      const tip        = Number(bon.tip) || 0;
      const txAbs      = Math.abs(tx.amount);
      const amountDiff = Math.min(
        Math.abs(txAbs - bon.total),
        tip ? Math.abs(txAbs - (bon.total + tip)) : Infinity
      );
      const days       = _bestDateDistance(tx.date, bonDates);
      const nameScore  = nameSimilarity(tx.description, bon.store);

      // Hard-Outs — days === null: kein Bon-Datum liegt im zulässigen Fenster
      if (days === null)                               return null;
      if (amountDiff > AMOUNT_NEAR_EUR)                return null;
      if (nameScore === 0 && amountDiff > AMOUNT_EXACT_EUR) return null;

      let score = 0;
      if (amountDiff < AMOUNT_EXACT_EUR) score += 50;
      else                                score += 25;
      if (days === 0)                    score += 30;
      else if (days <= 3)                score += 20;
      else                                score += 10;
      score += Math.round(nameScore * 20);

      return {
        transaction: tx,
        score,
        reason: _reason(amountDiff, days, nameScore),
        amountDiff,
        days,
        nameScore,
      };
    })
    .filter(Boolean)
    .filter(c => c.score >= MIN_SCORE)
    .sort((a, b) =>
      b.score - a.score
      || a.amountDiff - b.amountDiff
      || a.days - b.days
      || b.nameScore - a.nameScore
    );

  return candidates[0] ?? null;
}

export function matchLabel(score) {
  if (score >= 95) return { label: '100% Match',      chip: 'chip-green' };
  if (score >= 80) return { label: 'Starker Match',   chip: 'chip-green' };
  if (score >= 65) return { label: 'Möglicher Match', chip: 'chip-gold'  };
  return             { label: 'Schwacher Match',  chip: 'chip-red'   };
}

/**
 * Re-evaluiert alle bestehenden Bon-↔-Bank-Tx-Verknüpfungen gegen den
 * aktuellen Matcher. Pure Funktion ohne Side-Effects — der Caller
 * entscheidet ob er die stale-Liste löschen will.
 *
 * @param {Array} transactions  - state.transactions
 * @returns {{ total, ok, stale }} — `ok`/`stale` enthalten { tx, score }
 */
export function analyzeBonLinks(transactions) {
  const bonded = transactions.filter(t => t.bon && t.amount < 0);
  const ok    = [];
  const stale = [];
  for (const tx of bonded) {
    const bon = tx.bon;
    const bonObj = {
      date:      bon.date || tx.date,
      debitDate: bon.debitDate || null,
      total:     Math.abs(Number(bon.total ?? bon.gesamt) || Math.abs(tx.amount)),
      tip:       Number(bon.tip) || 0,
      store:     bon.vendor || bon.store || tx.description,
      account:   bon.account,
      currency:  bon.currency,
      needsReview: bon.needsReview,
    };
    // Single-Candidate-Match: liefert null wenn die aktuelle Verknüpfung
    // den MIN_SCORE-Threshold (60) nicht mehr erreichen würde.
    const result = findMatch(bonObj, [tx]);
    if (result) {
      ok.push({ tx, score: result.score });
    } else {
      stale.push({ tx, bonStore: bonObj.store, bonTotal: bonObj.total, bonDate: bonObj.date });
    }
  }
  return { total: bonded.length, ok, stale };
}
