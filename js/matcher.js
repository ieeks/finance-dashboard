// matcher.js — Score-basiertes Bon ↔ Buchung Matching

function nameSimilarity(txDescription, bonStore) {
  const tx  = txDescription.toUpperCase();
  const bon = bonStore.toUpperCase().split(' ')[0];
  return tx.includes(bon) || bon.includes(tx.split(' ')[0]);
}

function daysDiff(dateA, dateB) {
  return Math.abs((new Date(dateA) - new Date(dateB)) / 86400000);
}

/**
 * Findet die beste passende Buchung für einen Bon.
 * @param {object} bon    - { date, total, store }
 * @param {array}  txList - array of transactions { date, amount, description }
 * @returns {{ transaction, score, reason } | null}
 */
export function findMatch(bon, txList) {
  const candidates = txList
    .filter(tx => tx.amount < 0)
    .map(tx => {
      const amountDiff = Math.abs(Math.abs(tx.amount) - bon.total);
      const days       = daysDiff(tx.date, bon.date);
      const nameMatch  = nameSimilarity(tx.description, bon.store);

      let score = 0;
      let reason = '';

      if (amountDiff === 0 && days <= 3) {
        score = 100; reason = 'Betrag und Datum stimmen exakt überein';
      } else if (amountDiff === 0 && days <= 7) {
        score = 85;  reason = 'Betrag exakt, Datum ±7 Tage';
      } else if (amountDiff <= 2 && days <= 5 && nameMatch) {
        score = 70;  reason = 'Betrag ähnlich, Händlername erkannt';
      } else if (amountDiff <= 2 && days <= 5) {
        score = 55;  reason = 'Betrag ähnlich, Datum passt';
      }

      return { transaction: tx, score, reason };
    })
    .filter(c => c.score >= 55)
    .sort((a, b) => b.score - a.score);

  return candidates[0] ?? null;
}

export function matchLabel(score) {
  if (score === 100) return { label: '100% Match',     chip: 'chip-green' };
  if (score >= 85)   return { label: 'Starker Match',  chip: 'chip-green' };
  if (score >= 70)   return { label: 'Möglicher Match',chip: 'chip-gold'  };
  return               { label: 'Schwacher Match', chip: 'chip-red'   };
}
