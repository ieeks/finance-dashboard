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
    label:    'Manuel',
    patterns: [/Manuel/i, /Koblischek/i],
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

// Regex-Snippet für headerRe: alle Owner-Namen als OR — wird im Parser
// genutzt um Zeilen wie "Manuel Koblischek AT12 …" als Header zu erkennen.
export const OWNER_HEADER_RE = new RegExp(
  '^(?:' +
  OWNERS.flatMap(o => o.patterns.map(p => p.source)).join('|') +
  ')\\s+AT\\d',
);
