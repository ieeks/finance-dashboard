// owners.js — Kontoinhaber/Familienmitglieder
//
// Wird vom Parser benutzt um Gutschriften/Überweisungen automatisch dem
// richtigen Familienmitglied zuzuordnen. Reihenfolge ist relevant — der
// erste Match gewinnt.

export const OWNERS = [
  {
    label:    'Olga',
    patterns: [/Olga/i, /Zelenina/i],
  },
  {
    label:             'Manuel',
    patterns:          [/Manuel/i, /Koblischek/i],
    // Voller Name wie er als IBAN-Header-Zeile im PDF erscheint
    // (für OWNER_HEADER_RE — markiert den Konto-Inhaber-Header zum Überspringen)
    accountHolderName: 'Manuel Koblischek',
  },
];

// Helper: liefert das Label des ersten Owners dessen Pattern matcht, sonst null.
export function matchOwner(text) {
  if (!text) return null;
  for (const owner of OWNERS) {
    if (owner.patterns.some(p => p.test(text))) return owner.label;
  }
  return null;
}

// Regex-Snippet für headerRe: voller Konto-Inhaber-Name + AT-IBAN markiert
// die Header-Zeile des Bank-PDFs und wird vom Parser übersprungen.
export const OWNER_HEADER_RE = new RegExp(
  '^(?:' +
  OWNERS
    .filter(o => o.accountHolderName)
    .map(o => o.accountHolderName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|') +
  ')\\s+AT\\d',
);
