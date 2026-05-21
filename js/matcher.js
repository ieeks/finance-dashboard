// matcher.js — Score-basiertes Bon ↔ Buchung Matching
//
// Score-System (max 100):
//   amountDiff < 0.005 €  → 50   |  ≤ 2 €  → 25   |  sonst Hard-Out
//   days = 0              → 30   |  ≤ 3    → 20   |  ≤ 7   → 10  |  sonst Hard-Out
//   nameScore (0..1)              → × 20   (max 20)
//
// Hard-Out Regeln:
//   - signedDays < -1   (Bon-Datum mehr als 1 Tag NACH Buchung) → kein Match
//   - nameScore === 0 UND amountDiff > 0.005 → kein Match
//     (verhindert Cross-Matches bei ähnlichen Beträgen ohne Händler-Bezug)

const AMOUNT_EXACT_EUR = 0.005;
const AMOUNT_NEAR_EUR  = 2;
const DATE_MAX_DAYS    = 7;
const MIN_SCORE        = 60;

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
 * Findet die beste passende Buchung für einen Bon.
 * @param {object} bon                  - { date, total, store }
 * @param {array}  txList               - Transaktionen { date, amount, description, id? }
 * @param {object} [opts]
 * @param {Set}    [opts.excludeIds]    - bereits verknüpfte Tx-IDs überspringen
 * @returns {{ transaction, score, reason } | null}
 */
export function findMatch(bon, txList, { excludeIds } = {}) {
  if (!bon || !(bon.total > 0) || !bon.date) return null;

  const candidates = txList
    .filter(tx => tx.amount < 0)
    .filter(tx => !excludeIds || !excludeIds.has(tx.id))
    .map(tx => {
      const amountDiff = Math.abs(Math.abs(tx.amount) - bon.total);
      const signedDays = (new Date(tx.date) - new Date(bon.date)) / 86400000;
      const days       = Math.abs(signedDays);
      const nameScore  = nameSimilarity(tx.description, bon.store);

      // Hard-Outs
      if (signedDays < -1.5)                           return null;
      if (days > DATE_MAX_DAYS)                        return null;
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
