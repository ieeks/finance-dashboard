// parser.js — BAWAG/easybank PDF-Extraktion, lokaler Parser, KI-Kategorisierung

import { loadKeys } from './ui.js';
import { SUBSCRIPTION_RULES, RECURRING_RULES } from './categories.js';
import { OWNERS, matchOwner, OWNER_HEADER_RE } from './owners.js';

// Debug-Logs via window.DEBUG_PARSER = true aktivieren.
const _DBG = typeof window !== 'undefined' && window.DEBUG_PARSER === true;
const dlog = _DBG ? console.log.bind(console) : () => {};

function _applyRecurringFlags(txs) {
  return txs.map(t => {
    const rule = RECURRING_RULES.find(r => r.pattern.test(t.description));
    if (!rule) return t;
    return {
      ...t,
      isRecurring: true,
      recurringLabel: rule.label,
      ...(rule.category ? { category: rule.category, aiCategorized: false } : {}),
    };
  });
}

function _applySubscriptionRules(txs) {
  return txs.map(t => {
    const rule = SUBSCRIPTION_RULES.find(r =>
      r.pattern.test(t.description) && Math.abs(Math.abs(t.amount) - r.amount) < 0.015
    );
    if (!rule) return t;
    return {
      ...t,
      originalDescription: t.description,
      description: rule.name,
      category: rule.category,
      aiCategorized: false,
    };
  });
}

// ── PDF.js Worker konfigurieren ──
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// ── PDF Text Extraction ──
export async function extractPdfText(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let text = '';

  for (let i = 1; i <= pdf.numPages; i++) {
    const page    = await pdf.getPage(i);
    const content = await page.getTextContent();

    // Group text items into visual lines by Y coordinate (±4px tolerance)
    const lineMap = [];
    content.items.forEach(item => {
      const y = item.transform[5];
      const x = item.transform[4];
      let line = lineMap.find(l => Math.abs(l.y - y) < 4);
      if (!line) { line = { y, items: [] }; lineMap.push(line); }
      line.items.push({ x, str: item.str });
    });

    // Sort top-to-bottom (PDF y-axis increases upward → sort descending)
    lineMap.sort((a, b) => b.y - a.y);
    lineMap.forEach(line => {
      line.items.sort((a, b) => a.x - b.x);
      const lineText = line.items.map(i => i.str).join(' ').trim();
      if (lineText) text += lineText + '\n';
    });
    text += '\n';
  }
  return text;
}

// ── Bank Statement Dispatcher ──
export function parseBankStatement(text) {
  if (/KONTOAUSZUG|easybank|BAWAATWW/.test(text)) {
    return parseEasybankStatement(text);
  }
  return parseGenericStatement(text);
}

// ── easybank / BAWAG Format Parser ──
// Format: DD.MM DESCRIPTION VALUE_DATE AMOUNT[-]
function parseEasybankStatement(text) {
  const transactions = [];
  // Terminal-ID → Merchant-Name cache (POS 4350 → 'Billa' usw.)
  // Wird bei jedem erfolgreichen Match befüllt und als Fallback genutzt.
  const terminalCache = new Map();

  // Extract the "vom DD.MM.YYYY" statement date from the header.
  // This is the upper bound for all transactions — any transaction date that
  // falls after this date belongs to the previous year (year-rollover statements,
  // e.g. statement dated 02.01.2026 containing December 2025 transactions).
  const headerText  = text.slice(0, 500);
  const vomMatch    = headerText.match(/vom\s+(\d{2})\.(\d{2})\.(\d{4})/);
  let year          = vomMatch ? vomMatch[3] : String(new Date().getFullYear());
  // statementDate as YYYY-MM-DD upper bound; fallback: today
  const statementDate = vomMatch
    ? `${vomMatch[3]}-${vomMatch[2]}-${vomMatch[1]}`
    : new Date().toISOString().slice(0, 10);

  // Helper: assign correct year to a DD.MM transaction — if DD.MM.year > statementDate
  // the transaction belongs to the previous year (e.g. Dec in a Jan statement).
  function _resolveDate(day, month) {
    const mm = String(month).padStart(2,'0');
    const dd = String(day).padStart(2,'0');
    const d  = `${year}-${mm}-${dd}`;
    return d > statementDate ? `${parseInt(year) - 1}-${mm}-${dd}` : d;
  }

  const lines    = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const headerRe = new RegExp(
    [
      /^KONTOAUSZUG/, /^IBAN\s/, /^Buch\.-Tag/, /^Währung/,
      OWNER_HEADER_RE,
      /^D04MMK/, /^Bei Rückfragen/, /^Reklamationen/, /^BIC:/,
      /^Dieses Konto/, /^Ihre aktuelle/, /^Summe Ein/, /^Summe Aus/,
      /^Neuer Kontostand/, /^Beilagen/,
    ].map(r => r.source).join('|')
  );

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (headerRe.test(line)) { i++; continue; }

    // Match: DD.MM DESCRIPTION VALUE_DATE AMOUNT[-]
    const m = line.match(/^(\d{2})\.(\d{2})\s+(.*?)\s+(\d{2}\.\d{2})\s+(\d{1,3}(?:\.\d{3})*,\d{2})(-?)$/);

    if (m) {
      const day   = parseInt(m[1]);
      const month = parseInt(m[2]);
      if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
        const bookingDate = _resolveDate(day, month);
        const rawDesc     = m[3];
        const isExpense   = m[6] === '-';
        const amount      = _parseEasyAmount(m[5]) * (isExpense ? -1 : 1);

        // ── Bezahlung Karte ──
        if (/bezahlung\s+karte/i.test(rawDesc)) {
          // Alle Folgezeilen bis nächste Transaktion sammeln
          const bzLines = [];
          let bj = i + 1;
          while (bj < lines.length) {
            const cl = lines[bj];
            if (/^\d{2}\.\d{2}\s/.test(cl) && /\d{1,3}(?:\.\d{3})*,\d{2}-?$/.test(cl)) break;
            if (headerRe.test(cl)) { bj++; continue; }
            bzLines.push(cl);
            bj++;
          }

          // Terminalzeile hat HH:MM; Händlerzeile hat DANKT oder bekannten Händlernamen
          const terminalLine = bzLines.find(l => /\d{2}:\d{2}/.test(l)) || '';
          let merchantLine = bzLines.find(l => /DANKT/i.test(l)) ||
                             bzLines.find(l => /BILLA|SPAR|HOFER|LIDL|DM-FIL/i.test(l)) ||
                             bzLines.find(l => !/\d{2}:\d{2}/.test(l) && !/^POS\b/i.test(l)) || '';

          // Fallback: BILLA DANKT kann durch Y-Grouping (±4px) mit der Kopfzeile
          // der nächsten Buchung zusammengefasst werden und landet dann in deren rawDesc.
          // Wenn merchantLine leer: break-Line (= nächste Tx) auf DANKT prüfen.
          if (!merchantLine) {
            const breakLine = lines[bj] || '';
            const nm = breakLine.match(/^(\d{2})\.(\d{2})\s+(.*?)\s+(\d{2}\.\d{2})\s+(\d{1,3}(?:\.\d{3})*,\d{2})-?$/);
            if (nm && /bezahlung\s+karte/i.test(nm[3]) && /DANKT|BILLA|SPAR|HOFER|LIDL|DM-FIL|BIPA/i.test(nm[3])) {
              merchantLine = nm[3]; // rawDesc der nächsten Tx enthält den Y-gemergten DANKT-Text
            }
          }

          // Fallback: DANKT-Zeile erscheint als Orphan-Line VOR dem aktuellen Header
          // (Y-sortiert auf Seitenumbruch: nächste Seite beginnt mit hohem Y → landet früher)
          // Outer while-loop überspringt sie via i++ → rückwärts in lines suchen
          if (!merchantLine && i > 0) {
            for (let back = i - 1; back >= Math.max(0, i - 4); back--) {
              const prevLine = lines[back] || '';
              if (/^\d{2}\.\d{2}\s/.test(prevLine)) break; // Transaktion → nicht weiter zurück
              if (headerRe.test(prevLine)) continue;
              if (/DANKT/i.test(prevLine)) {
                merchantLine = prevLine;
                dlog('[DBG-KARTE] Backward fallback hit:', prevLine);
                break;
              }
            }
          }

          // Kaufdatum aus Terminalzeile: "POS 4350 D001 27.03. 18:05" → 27.03
          const posDateMatch = terminalLine.match(/(\d{2})\.(\d{2})\./);
          const txDate = posDateMatch
            ? _resolveDate(parseInt(posDateMatch[1]), parseInt(posDateMatch[2]))
            : bookingDate;

          let description = _extractMerchant(merchantLine, terminalLine, rawDesc);

          // Terminal-Cache: erfolgreiche Matches speichern, fehlgeschlagene nachschlagen.
          // Deckt den Fall ab, wo BILLA DANKT komplett aus dem PDF fehlt (Y-merge auf Seite).
          const termId = terminalLine.match(/^POS\s+([A-Z0-9]+)/i)?.[1];
          if (termId) {
            if (description !== 'Kartenzahlung') {
              terminalCache.set(termId, description);
            } else if (terminalCache.has(termId)) {
              description = terminalCache.get(termId);
              dlog('[DBG-KARTE] Terminal cache hit:', termId, '→', description);
            }
          }

          dlog('[DBG-KARTE]', bookingDate, amount + '€ →', description);
          dlog('[DBG-KARTE] bzLines     :', bzLines);
          dlog('[DBG-KARTE] terminalLine:', terminalLine || '(leer)');
          dlog('[DBG-KARTE] merchantLine:', merchantLine || '(leer)');
          dlog('[DBG-KARTE] txDate      :', txDate);

          const cardCode   = terminalLine.match(/\b([DK]\d{3})\b/)?.[1] ?? null;
          const cardHolder = cardCode?.startsWith('D') ? 'manuel'
                           : cardCode?.startsWith('K') ? 'olga'
                           : null;

          if (Math.abs(amount) >= 0.01) {
            transactions.push(_makeTx(txDate, description, amount, 'easybank', cardHolder));
          }
          i = bj;
          continue;
        }

        // ── Standard-Buchung: contLines bis nächste DD.MM ──
        const contLines = [];
        let j = i + 1;
        while (j < lines.length) {
          const cl = lines[j];
          if (/^\d{2}\.\d{2}\s/.test(cl)) break;
          if (headerRe.test(cl)) break;
          contLines.push(cl);
          j++;
        }

        let description = extractEasybankDescription(rawDesc, contLines, amount);
        // Backward-Lookup: BAWAATWWXXX + Name landet durch Y-Sortierung auf Seitenumbruch
        // manchmal VOR dem Transaktionsheader → contLines leer → Name nicht gefunden
        if (description === 'Gutschrift') {
          for (let back = i - 1; back >= Math.max(0, i - 6); back--) {
            const prevLine = lines[back];
            if (/^\d{2}\.\d{2}\s/.test(prevLine)) break;
            if (headerRe.test(prevLine)) continue;
            const owner = matchOwner(prevLine);
            if (owner) { description = `Gutschrift ${owner}`; break; }
          }
        }
        // Forward-Lookup: BAWAATWWXXX + Name kann durch Y-Koordinaten-Merge mit der nächsten
        // Transaktion verschmelzen → taucht als contLine der nächsten TX auf, nicht als eigene Zeile
        if (description === 'Gutschrift') {
          for (let fwd = j; fwd < Math.min(j + 4, lines.length); fwd++) {
            const owner = matchOwner(lines[fwd]);
            if (owner) { description = `Gutschrift ${owner}`; break; }
          }
        }
        if (Math.abs(amount) >= 0.01 && description.length > 0) {
          transactions.push(_makeTx(bookingDate, description, amount, 'easybank'));
        }
        i = j;
        continue;
      }
    }
    i++;
  }

  return _dedup(transactions);
}

function _parseEasyAmount(str) {
  return parseFloat(str.replace(/\./g, '').replace(',', '.'));
}

// Händlername aus merchant-, terminal- und rawDesc-Zeile extrahieren
// rawDesc wird als Fallback geprüft — BILLA DANKT kann durch Y-Grouping
// in PDF.js mit der Hauptzeile zusammengefasst werden und landet dann
// in rawDesc statt in bzLines.
function _extractMerchant(merchantLine, terminalLine, rawDesc = '') {
  for (const line of [merchantLine, terminalLine, rawDesc]) {
    if (!line) continue;
    for (const [pat, name] of CARD_MERCHANTS) {
      if (pat.test(line)) {
        dlog('[DBG-MERCHANT] Match:', line, '→', name);
        return name;
      }
    }
  }
  dlog(`[DBG-MERCHANT] Kein CARD_MERCHANTS Match. merchantLine="${merchantLine}" terminalLine="${terminalLine}" rawDesc="${rawDesc}"`);
  // Generisch: Händlerzeile, alles vor DANKT / Zahl / Backslash
  const src = merchantLine || terminalLine;
  if (!src) return 'Kartenzahlung';
  // Überspringe reine POS/Terminal-Zeilen
  if (/^POS\s+\d/i.test(src)) return 'Kartenzahlung';
  const match = src.match(/^([A-ZÄÖÜ][A-Za-zÄÖÜäöü\s&.\-]+?)(?:\s+DANKT|\s+\d|\s*[\\\/]|$)/i);
  if (match && match[1].trim().length > 2) return match[1].trim();
  const word = src.split(/[\s\\\/]/)[0];
  return word.length > 2 ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : 'Kartenzahlung';
}

// Known Austrian card merchants (pattern → display name)
const CARD_MERCHANTS = [
  // ── Supermärkte (Österreich) ──
  [/BILLA\s*PLUS/i,         'Billa Plus'],
  [/\bBILLA\b/i,            'Billa'],
  [/INTERSPAR/i,            'Interspar'],
  [/EUROSPAR/i,             'Eurospar'],
  [/\bSPAR\b/i,             'Spar'],
  [/\bHOFER\b/i,            'Hofer'],
  [/\bLIDL\b/i,             'Lidl'],
  [/\bPENNY\b/i,            'Penny'],
  [/NAH.{0,3}FRISCH/i,      'Nah & Frisch'],
  [/\bMPREIS\b/i,           'M-Preis'],
  [/UNIMARKT/i,             'Unimarkt'],
  [/MAXIMARKT/i,            'Maximarkt'],
  [/\bADEG\b/i,             'Adeg'],
  [/JULIUS\s*MEINL/i,       'Julius Meinl'],
  // ── Drogerie ──
  [/DM-?FIL/i,              'dm'],
  [/\bBIPA\b/i,             'Bipa'],
  [/MUELLER|MÜLLER/i,       'Müller'],
  // ── Gastronomie ──
  [/MCDONALD|MC\s*DON/i,    "McDonald's"],
  [/BURGER\s*KING/i,        'Burger King'],
  [/\bKFC\b/i,              'KFC'],
  [/\bSUBWAY\b/i,           'Subway'],
  [/STARBUCKS/i,            'Starbucks'],
  [/\bPRONTO\b/i,           'Pronto'],
  [/JOSEPH\s*BAC/i,         'Joseph Bäckerei'],
  [/ANKER/i,                'Anker'],
  [/\bFELBER\b/i,           'Felber'],
  [/DER\s+MANN/i,           'Der Mann'],
  [/COCA.COLA\s*HBC/i,      'Coca-Cola Automat'],
  // ── Tankstellen (Österreich) ──
  [/\bOMV\b/i,              'OMV'],
  [/\bAVANTI\b/i,           'Avanti'],
  [/TURMOEL|TURM.L/i,       'Turmöl'],
  [/\bSHELL\b/i,            'Shell'],
  [/\bJET\b/i,              'JET'],
  [/\bBP\b/i,               'BP'],
  [/\bENI\b|\bAGIP\b/i,     'ENI'],
  [/CIRCLE\s*K/i,           'Circle K'],
  // ── Elektronik ──
  [/MEDIA\s*MARKT|MEDIAMARKT/i, 'MediaMarkt'],
  [/\bSATURN\b/i,           'Saturn'],
  [/\bHARTLAUER\b/i,        'Hartlauer'],
  [/\bCONRAD\b/i,           'Conrad'],
  // ── Einrichtung & Baumarkt ──
  [/\bIKEA\b/i,             'IKEA'],
  [/\bOBI\b/i,              'OBI'],
  [/HORNBACH/i,             'Hornbach'],
  [/\bBAUHAUS\b/i,          'Bauhaus'],
  // ── Mode & Sport ──
  [/\bZARA\b/i,             'Zara'],
  [/\bH&M\b/i,              'H&M'],
  [/\bC&A\b/i,              'C&A'],
  [/DEICHMANN/i,            'Deichmann'],
  [/\bHUMANIC\b/i,          'Humanic'],
  [/INTERSPORT/i,           'Intersport'],
  [/DECATHLON/i,            'Decathlon'],
  [/\bLIBRO\b/i,            'Libro'],
];

export function extractEasybankDescription(rawDesc, contLines, amount = 0) {
  const result = _extractDesc(rawDesc, contLines, amount);
  dlog(`[DBG-SEPA] "${rawDesc.trim()}" (${amount}€) → "${result}"`);
  return result;
}

function _extractDesc(rawDesc, contLines, amount) {
  const raw     = rawDesc.trim();
  const allText = [raw, ...contLines].join(' ');

  // 1a. rawDesc direkt gegen bekannte Händler prüfen
  for (const [pat, name] of CARD_MERCHANTS) {
    if (pat.test(raw)) return name;
  }

  // 1b. POS terminal ID als rawDesc
  const isPosLine = /^POS\s+\d+/i.test(raw);

  // 1c. Bezahlung Karte oder POS-Zeile
  if (/bezahlung\s+karte/i.test(raw) || isPosLine) {
    for (const [pat, name] of CARD_MERCHANTS) {
      if (pat.test(allText)) return name;
    }
    const merchantLine = isPosLine ? (contLines[0] || '') : (contLines[1] || contLines[0] || '');
    if (merchantLine) {
      const merchant = merchantLine.split(/[\\\/]/)[0]
        .replace(/DANKT\s*/gi, '')
        .replace(/\d{4,}/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (merchant.length > 2) return merchant;
    }
    for (const cl of contLines) {
      if (/^POS[\s\d]/i.test(cl)) continue;
      if (/^(OG|MC|BG|FE|VD)\//i.test(cl)) continue;
      if (matchOwner(cl)) continue;
      if (/^[A-Z0-9]{8,}$/i.test(cl)) continue;
      if (/^\d+$/.test(cl)) continue;
      const merchant = cl.split(/[\\\/]/)[0]
        .replace(/DANKT\s*/gi, '')
        .replace(/\d{4,}/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (merchant.length > 2) return merchant;
    }
    return 'Kartenzahlung';
  }

  // 2. Benannte Vorgänge auf rawDesc — VOR allText-Checks damit Miete/Gutschrift nicht überschrieben werden
  if (/Gutschrift\s+Onlinebanking/i.test(raw)) {
    for (const cl of contLines) {
      // BIC/IBAN aus der Zeile entfernen und prüfen ob ein Name übrig bleibt
      const cleaned = cl
        .replace(/\b[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/g, '')  // BICs entfernen (8 oder 11 Zeichen)
        .replace(/\bAT\d{16,22}\b/g, '')              // IBANs entfernen
        .replace(/^(OG|BG|MC)\//i, '')
        .replace(/\s+/g, ' ').trim();
      if (cleaned.length > 2 && !/^\d+$/.test(cleaned)) {
        const owner = matchOwner(cleaned);
        if (owner) return `Gutschrift ${owner}`;
        return `Gutschrift (${cleaned.slice(0, 30)})`;
      }
    }
    return 'Gutschrift';
  }
  if (/^Miete/i.test(raw)) {
    // Eingehende Mietzahlung (positiv) → kein Wohnen/Miete, Name aus contLines prüfen
    if (amount > 0) {
      const owner = matchOwner(allText);
      if (owner) return `Gutschrift ${owner}`;
      // Unbekannter Absender — als generische Gutschrift weiter klassifizieren
    } else {
      return 'Miete / Hausverwaltung';
    }
  }
  if (/^Sollzinsen/i.test(raw)) return 'Sollzinsen';

  // 3. Bekannte Gegenstellen (allText-basiert)
  // Firmen/Institutionen VOR Personennamen prüfen — Personennamen können in Adresszeilen vorkommen
  if (/Tesla/i.test(allText))                          return 'Tesla Supercharger';
  if (/T-Mobile|Magenta/i.test(allText))               return 'T-Mobile / Magenta';
  if (/WE\s+Vertrieb|Wien\s+Energie/i.test(allText))  return 'Wien Energie';
  if (/\bAMAZON\b/i.test(allText))                    return 'Amazon';
  if (/PAYPAL|PPLX/i.test(allText))                   return 'PayPal';
  if (/Helvetia/i.test(allText)) {
    if (/Vorschreibung|Miete|Betriebskosten|Rennweg|Hausverwaltung/i.test(allText))
      return 'Miete / Hausverwaltung';
    return 'Helvetia Versicherung';
  }
  if (/Raiffeisen.Leasing/i.test(allText))             return 'Raiffeisen Leasing';
  if (/Allianz/i.test(allText)) {
    if (/Elementar|AEV\d+|Kfz|KFZ/i.test(allText)) return 'Allianz KFZ-Versicherung';
    return 'Allianz Versicherung';
  }
  // Personennamen erst nach Firmen-Checks — vermeidet False-Positives aus Adresszeilen
  const owner = matchOwner(allText);
  if (owner) {
    if (amount > 0) return `Gutschrift ${owner}`;
    // Eigener Owner als Empfänger einer Ausgabe → Name als Description
    if (owner === 'Olga') return 'Olga Zelenina';
    // Manuel als Empfänger einer Ausgabe → keine Description-Übernahme (eigene Karte)
  }

  // 4. SEPA mit BIC → Gegenpartei aus Folgezeilen (kein i-Flag: BICs sind immer Großbuchstaben)
  if (/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}/.test(raw)) {
    for (const cl of contLines) {
      if (/^[A-Z]{6}[A-Z0-9]{2}|^(OG|BG|MC)\/|^\d{8,}$/.test(cl)) continue;
      if (matchOwner(cl)) continue;
      const name = cl.split('/')[0].replace(/^\d+\s*/, '').trim();
      if (name.length > 3 && !/^\d+$/.test(name)) return name.slice(0, 50);
    }
  }

  // 5. Fallback
  return raw.replace(/\b[A-Z0-9]{10,}\b/g, '').replace(/\s+/g, ' ').trim().slice(0, 50) || 'Buchung';
}


// ── Generic Statement Parser ──
// Zeilenweise + anchored — verhindert dass Header/Footer-Zeilen mit Datumsangabe
// als Transaktion gelesen werden (z.B. "Saldo per 31.12.2025: 1.234,56").
function parseGenericStatement(text) {
  const transactions = [];
  const linePattern  = /^(\d{2}\.\d{2}\.\d{4})\s+(.+?)\s+([-+]?\d{1,3}(?:\.\d{3})*,\d{2})\s*(?:EUR)?\s*$/;
  const skipRe       = /^(Saldo|Übertrag|Summe|Stand|Konto-?Nr|IBAN|BIC|Seite\s+\d)/i;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || skipRe.test(line)) continue;
    const match = line.match(linePattern);
    if (!match) continue;
    const date   = _parseFullDate(match[1]);
    const desc   = match[2].trim().replace(/\s+/g,' ').slice(0,80);
    const amount = _parseAmount(match[3]);
    if (date && !isNaN(amount) && desc.length > 2) {
      transactions.push(_makeTx(date, desc, amount, 'bawag'));
    }
  }
  return _dedup(transactions);
}

function _parseFullDate(str) {
  const [d, m, y] = str.split('.');
  const date = new Date(`${y}-${m}-${d}`);
  if (isNaN(date)) return null;
  return `${y}-${m}-${d}`;
}

function _parseAmount(str) {
  return parseFloat(str.replace(/\./g,'').replace(',','.'));
}

export function makeTx(date, description, amount, account, cardHolder = null) {
  return {
    id:            `tx_${date}_${Math.random().toString(36).slice(2,8)}`,
    date,
    description,
    amount,
    category:      'Sonstiges',
    aiCategorized: false,
    account:       account || 'haushalt',
    cardHolder,
  };
}

function _makeTx(date, description, amount, account, cardHolder = null) {
  return makeTx(date, description, amount, account, cardHolder);
}

function _dedup(txs) {
  const seen = new Set();
  return txs.filter(t => {
    const key = `${t.date}|${t.amount}|${t.description}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── AI Kategorisierung ──
export async function categorizeWithAI(transactions, provider = 'anthropic', overrides = {}) {
  const keys = loadKeys();
  const key  = provider === 'anthropic' ? keys.anthropic : keys.openai;

  function _applyOverrides(txs) {
    return txs.map(t => {
      const cat = overrides[t.description.toLowerCase().trim()];
      return cat ? { ...t, category: cat, aiCategorized: false } : t;
    });
  }

  if (!key) {
    return _applyOverrides(_applyRecurringFlags(_applySubscriptionRules(
      transactions.map(t => ({ ...t, category: guessCategory(t.description), aiCategorized: false }))
    )));
  }

  const categories = [
    'Supermarkt','Restaurant / Café','Mobilität / Auto','Wohnen / Miete',
    'Energie / Strom','Versicherung','Drogerie','Gesundheit','Online Shopping',
    'Freizeit','Gehalt / Einnahmen','Familientransfer','Gebühren / Bank',
    'Telekommunikation','Sonstiges',
  ].join(', ');

  const list = transactions
    .map((t,i) => `${i}: ${t.description} (${t.amount > 0 ? '+' : ''}${t.amount}€)`)
    .join('\n');

  const ownerNames = OWNERS.flatMap(o => o.patterns.map(p => p.source.replace(/[\\^$.*+?()[\]{}|]/g, ''))).join(', ');
  const prompt = `Du bist ein österreichischer Finanz-Assistent. Kategorisiere diese Bankbuchungen.

Verfügbare Kategorien: ${categories}

Hinweise:
- "Familientransfer": Gutschriften oder Überweisungen von/an Privatpersonen (Familie, Partner), erkennbar an Personennamen (z.B. ${ownerNames}) oder Beschreibungen wie "Gutschrift (Name)"
- "Gehalt / Einnahmen": nur eindeutige Gehaltseingänge von Arbeitgebern (Firmen, GmbH, AG usw.)
- Reine "Gutschrift" ohne Firmennamen → eher "Familientransfer" als "Gehalt / Einnahmen"

Buchungen:
${list}

Antworte NUR mit einem JSON-Array, Format: [{"index":0,"category":"Kategorie"}, ...]
Keine anderen Texte, kein Markdown, nur reines JSON.`;

  let result;
  try {
    if (provider === 'anthropic') {
      result = await _callAnthropic(key, prompt);
    } else {
      result = await _callOpenAI(key, prompt);
    }
  } catch(e) {
    return _applyOverrides(_applyRecurringFlags(_applySubscriptionRules(
      transactions.map(t => ({ ...t, category: guessCategory(t.description), aiCategorized: false }))
    )));
  }

  const validCats = ['Supermarkt','Restaurant / Café','Mobilität / Auto','Wohnen / Miete',
    'Energie / Strom','Versicherung','Drogerie','Gesundheit','Online Shopping',
    'Freizeit','Gehalt / Einnahmen','Familientransfer','Gebühren / Bank','Telekommunikation','Sonstiges'];

  return _applyOverrides(_applyRecurringFlags(_applySubscriptionRules(transactions.map((t, i) => {
    const found = result.find(r => r.index === i);
    const cat   = found && validCats.includes(found.category) ? found.category : guessCategory(t.description);
    return { ...t, category: cat, aiCategorized: !!found };
  }))));
}

async function _callAnthropic(key, prompt) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key':    key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages:   [{ role: 'user', content: prompt }],
    }),
  });
  if (!resp.ok) throw new Error(`Anthropic API ${resp.status}`);
  const data  = await resp.json();
  const text  = data.content[0].text;
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('KI hat kein JSON-Array zurückgegeben');
  try {
    return JSON.parse(match[0]);
  } catch {
    throw new Error('KI-Antwort ist kein gültiges JSON');
  }
}

async function _callOpenAI(key, prompt) {
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify({
      model:           'gpt-4o-mini',
      messages:        [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      max_tokens:      2048,
    }),
  });
  if (!resp.ok) throw new Error(`OpenAI API ${resp.status}`);
  const data = await resp.json();
  const text = data.choices[0].message.content;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('KI-Antwort ist kein gültiges JSON');
  }
  return Array.isArray(parsed) ? parsed : (parsed.categories || parsed.transactions || []);
}

// ── Regelbasierter Fallback ──
export function guessCategory(desc) {
  const d = desc.toLowerCase();
  if (/billa|interspar|eurospar|\bspar\b|hofer|lidl|penny|nah.frisch|mpreis|unimarkt|maximarkt|\badeg\b|julius meinl|coca.cola/.test(d)) return 'Supermarkt';
  if (/restaurant|café|cafe|mcdonald|burger king|\bkfc\b|subway|starbucks|pronto|anker|felber|gasthaus|wirtshaus|beisl|der mann|pizza|kebab/.test(d)) return 'Restaurant / Café';
  if (/^miete|wohnung|immobilien|hausverwaltung|betriebskosten|vorschreibung|miete \/ hausverwaltung/.test(d)) return 'Wohnen / Miete';
  if (/tesla|tankstelle|omv|avanti|turmöl|turmoel|circle k|\bbp\b|shell|\beni\b|agip|\bjet\b|öamtc|parken|parking|wiener linien|bim|bahn|öbb|uber|taxi|leasing/.test(d)) return 'Mobilität / Auto';
  if (/wien energie|we vertrieb|energie|strom|gas|verbund|e-control/.test(d))                      return 'Energie / Strom';
  if (/allianz kfz/i.test(d))                                                                       return 'Mobilität / Auto';
  if (/versicherung|helvetia|generali|allianz|uniqa|wiener städtische/.test(d))                    return 'Versicherung';
  if (/dm-fil|dm fil|\bdm\b|bipa|müller|mueller|rossmann|schlecker/.test(d))                       return 'Drogerie';
  if (/apotheke|arzt|krankenhaus/.test(d))                                                          return 'Gesundheit';
  if (/amazon|zalando|ebay|shein|aliexpress|paypal|hartlauer|mediamarkt|saturn|\bikea\b|zara|\bh&m\b|deichmann|humanic|intersport|decathlon|\bobi\b|hornbach|libro/.test(d)) return 'Online Shopping';
  if (/olga zelenina|zelenina|\bolga\b|manuel koblischek|\bmanuel\b|familientransfer|gutschrift olga|gutschrift manuel|^gutschrift$/.test(d)) return 'Familientransfer';
  if (/gehalt|lohn|salary/.test(d))                                                                return 'Gehalt / Einnahmen';
  if (/kino|theater|concert|museum|netflix|spotify|disney|gaming|steam/.test(d))                   return 'Freizeit';
  if (/t-mobile|magenta|\ba1\b|\bdrei\b|telekom|hutchison/.test(d))                                return 'Telekommunikation';
  if (/sollzinsen|gebühr|kontoführung|provision|zinsen|bawag|easybank/.test(d))                    return 'Gebühren / Bank';
  return 'Sonstiges';
}
