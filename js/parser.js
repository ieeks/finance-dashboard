// parser.js — BAWAG/easybank PDF-Extraktion, lokaler Parser, KI-Kategorisierung

import { loadKeys } from './ui.js';

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

  // Extract year from "vom DD.MM.YYYY"
  const yearMatch = text.match(/vom\s+\d{2}\.\d{2}\.(\d{4})/);
  const year = yearMatch ? yearMatch[1] : String(new Date().getFullYear());

  const lines    = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const headerRe = /^KONTOAUSZUG|^IBAN\s|^Buch\.-Tag|^Währung|^Manuel Koblischek\s+AT\d|^D04MMK|^Bei Rückfragen|^Reklamationen|^BIC:|^Dieses Konto|^Ihre aktuelle|^Summe Ein|^Summe Aus|^Neuer Kontostand|^Beilagen/;

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
        const bookingDate = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
        const rawDesc     = m[3];
        const isExpense   = m[6] === '-';
        const amount      = _parseEasyAmount(m[5]) * (isExpense ? -1 : 1);

        // ── Bezahlung Karte: immer 3-Zeilen-Struktur ──
        // Zeile 1: DD.MM Bezahlung Karte ... DD.MM AMOUNT  (booking date + amount)
        // Zeile 2: POS XXXX DYYY DD.MM. HH:MM              (terminal + echtes Kaufdatum)
        // Zeile 3: MERCHANT DANKT XXXX\ORT\PLZ             (Händlername)
        if (/bezahlung karte/i.test(rawDesc)) {
          // Genau 2 Folgezeilen sammeln — KEIN Stop bei DD.MM
          const bzLines = [];
          let bj = i + 1;
          while (bj < lines.length && bzLines.length < 2) {
            const cl = lines[bj];
            if (headerRe.test(cl)) break;
            bzLines.push(cl);
            bj++;
          }

          // Kaufdatum aus Zeile 2 (POS-Zeile): "POS 4350 D001 27.03. 18:05" → 27.03
          const posLine     = bzLines[0] || '';
          const posDateMatch = posLine.match(/(\d{2})\.(\d{2})\./);
          const txDate      = posDateMatch
            ? `${year}-${posDateMatch[2].padStart(2,'0')}-${posDateMatch[1].padStart(2,'0')}`
            : bookingDate;

          // Händlername aus Zeile 3
          const line3       = bzLines[1] || '';
          const description = _merchantFromLine3(line3) || _merchantFromLine3(posLine) || 'Kartenzahlung';

          if (Math.abs(amount) >= 0.01) {
            transactions.push(_makeTx(txDate, description, amount, 'easybank'));
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

        const description = extractEasybankDescription(rawDesc, contLines);
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

// Händlername aus Zeile 3 einer Bezahlung-Karte-Buchung extrahieren
// Eingabe: "BILLA DANKT 0000138\WIEN\1030" → "Billa"
function _merchantFromLine3(line) {
  if (!line) return '';
  // Bekannte Händler zuerst
  for (const [pat, name] of CARD_MERCHANTS) {
    if (pat.test(line)) return name;
  }
  // Generisch: erstes Wort vor DANKT / Zahl / Backslash
  const match = line.match(/^([A-ZÄÖÜ][A-Za-zÄÖÜäöü\s&\-]+?)(?:\s+DANKT|\s*[\d\\\/]|$)/i);
  if (match && match[1].trim().length > 2) return match[1].trim();
  // Fallback: erstes Wort
  const word = line.split(/[\s\\\/]/)[0];
  return word.length > 2 ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : '';
}

// Known Austrian card merchants (pattern → display name)
const CARD_MERCHANTS = [
  [/\bBILLA\b/i,      'Billa'],
  [/\bSPAR\b/i,       'Spar'],
  [/\bHOFER\b/i,      'Hofer'],
  [/\bLIDL\b/i,       'Lidl'],
  [/DM-?FIL/i,        'DM'],
  [/\bBIPA\b/i,       'Bipa'],
  [/\bHARTLAUER\b/i,  'Hartlauer'],
  [/MUELLER|MÜLLER/i, 'Müller'],
  [/\bMERKUR\b/i,     'Merkur'],
  [/\bPENNY\b/i,      'Penny'],
  [/\bEDEKA\b/i,      'Edeka'],
  [/DER\s+MANN/i,     'Der Mann'],
  [/COCA-COLA/i,      'Coca-Cola'],
  [/\bOMV\b/i,        'OMV'],
  [/\bSHELL\b/i,      'Shell'],
  [/\bJET\b/i,        'JET Tankstelle'],
];

export function extractEasybankDescription(rawDesc, contLines) {
  const raw     = rawDesc.trim();
  const allText = [raw, ...contLines].join(' ');

  // 1a. rawDesc direkt gegen bekannte Händler prüfen
  for (const [pat, name] of CARD_MERCHANTS) {
    if (pat.test(raw)) return name;
  }

  // 1b. POS terminal ID als rawDesc
  const isPosLine = /^POS\s+\d+/i.test(raw);

  // 1c. Bezahlung Karte oder POS-Zeile
  if (/bezahlung karte/i.test(raw) || isPosLine) {
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
      if (/^Manuel Koblischek$|^Koblischek/i.test(cl)) continue;
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

  // 2. Bekannte Gegenstellen
  if (/Tesla/i.test(allText))                    return 'Tesla Supercharger';
  if (/T-Mobile|Magenta/i.test(allText))         return 'T-Mobile / Magenta';
  if (/WE Vertrieb|Wien Energie/i.test(allText)) return 'Wien Energie';
  if (/\bAMAZON\b/i.test(allText))              return 'Amazon';
  if (/PAYPAL|PPLX/i.test(allText))             return 'PayPal';
  if (/Helvetia/i.test(allText))                 return 'Helvetia Versicherung';
  if (/Raiffeisen.Leasing/i.test(allText))       return 'Raiffeisen Leasing';
  if (/Allianz/i.test(allText))                  return 'Allianz Versicherung';

  // 3. Benannte Vorgänge
  if (/Gutschrift Onlinebanking/i.test(raw)) {
    for (const cl of contLines) {
      if (/^(BAWAATWW|OG\/|BG\/)/i.test(cl)) continue;
      const name = cl.replace(/AT\d{18,}/g, '').trim();
      if (name.length > 2) return `Gutschrift (${name.slice(0, 30)})`;
    }
    return 'Gutschrift';
  }
  if (/^Miete/i.test(raw))      return 'Miete';
  if (/^Sollzinsen/i.test(raw)) return 'Sollzinsen';

  // 4. SEPA mit BIC → Gegenpartei aus Folgezeilen
  if (/^[A-Z]{6}[A-Z0-9]{2}/i.test(raw)) {
    for (const cl of contLines) {
      if (/^[A-Z]{6}[A-Z0-9]{2}|^(OG|BG|MC)\/|^Manuel Koblischek$|^\d{8,}$/i.test(cl)) continue;
      if (/^(Koblischek|KOBLISCHEK)/i.test(cl)) continue;
      const name = cl.split('/')[0].replace(/^\d+\s*/, '').trim();
      if (name.length > 3 && !/^\d+$/.test(name)) return name.slice(0, 50);
    }
  }

  // 5. Fallback
  return raw.replace(/\b[A-Z0-9]{10,}\b/g, '').replace(/\s+/g, ' ').trim().slice(0, 50) || 'Buchung';
}

// ── Generic Statement Parser ──
function parseGenericStatement(text) {
  const transactions = [];
  const linePattern  = /(\d{2}\.\d{2}\.\d{4})\s+(.+?)\s+([-+]?\d{1,3}(?:\.\d{3})*,\d{2})\s*(?:EUR)?/g;
  let match;
  while ((match = linePattern.exec(text)) !== null) {
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

export function makeTx(date, description, amount, account) {
  return {
    id:            `tx_${date}_${Math.random().toString(36).slice(2,8)}`,
    date,
    description,
    amount,
    category:      'Sonstiges',
    aiCategorized: false,
    account:       account || 'bawag',
  };
}

function _makeTx(date, description, amount, account) {
  return makeTx(date, description, amount, account);
}

function _dedup(txs) {
  const seen = new Set();
  return txs.filter(t => {
    const key = `${t.date}|${t.amount}|${t.description.slice(0,20)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── AI Kategorisierung ──
export async function categorizeWithAI(transactions, provider = 'anthropic') {
  const keys = loadKeys();
  const key  = provider === 'anthropic' ? keys.anthropic : keys.openai;

  if (!key) {
    return transactions.map(t => ({ ...t, category: guessCategory(t.description), aiCategorized: false }));
  }

  const categories = [
    'Supermarkt','Restaurant / Café','Mobilität / Auto','Wohnen / Miete',
    'Energie / Strom','Versicherung','Gesundheit','Online Shopping',
    'Freizeit','Gehalt / Einnahmen','Gebühren / Bank','Sonstiges',
  ].join(', ');

  const list = transactions
    .map((t,i) => `${i}: ${t.description} (${t.amount > 0 ? '+' : ''}${t.amount}€)`)
    .join('\n');

  const prompt = `Du bist ein österreichischer Finanz-Assistent. Kategorisiere diese Bankbuchungen.

Verfügbare Kategorien: ${categories}

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
    return transactions.map(t => ({ ...t, category: guessCategory(t.description), aiCategorized: false }));
  }

  return transactions.map((t, i) => {
    const found = result.find(r => r.index === i);
    const validCats = ['Supermarkt','Restaurant / Café','Mobilität / Auto','Wohnen / Miete',
      'Energie / Strom','Versicherung','Gesundheit','Online Shopping',
      'Freizeit','Gehalt / Einnahmen','Gebühren / Bank','Sonstiges'];
    const cat = found && validCats.includes(found.category) ? found.category : guessCategory(t.description);
    return { ...t, category: cat, aiCategorized: !!found };
  });
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
  const data = await resp.json();
  const text = data.content[0].text;
  return JSON.parse(text.match(/\[[\s\S]*\]/)[0]);
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
  const data   = await resp.json();
  const text   = data.choices[0].message.content;
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : (parsed.categories || parsed.transactions || []);
}

// ── Regelbasierter Fallback ──
export function guessCategory(desc) {
  const d = desc.toLowerCase();
  if (/billa|spar|hofer|lidl|edeka|aldi|merkur|penny|rewe|interspar|netto|kaufland/.test(d))       return 'Supermarkt';
  if (/restaurant|café|cafe|mcdonalds|burger|pizza|kebab|starbucks|gasthaus|wirtshaus|beisl|der mann|coca-cola/.test(d)) return 'Restaurant / Café';
  if (/^miete|wohnung|immobilien|hausverwaltung|betriebskosten/.test(d))                            return 'Wohnen / Miete';
  if (/tesla|tankstelle|omv|bp|shell|eni|jet|avanti|esso|öamtc|parken|parking|wiener linien|bim|bahn|öbb|uber|taxi|leasing/.test(d)) return 'Mobilität / Auto';
  if (/wien energie|we vertrieb|energie|strom|gas|verbund|e-control/.test(d))                      return 'Energie / Strom';
  if (/versicherung|helvetia|generali|allianz|uniqa|wiener städtische/.test(d))                    return 'Versicherung';
  if (/apotheke|arzt|krankenhaus|dm-fil|dm fil|\bdm\b|bipa|rossmann|müller|mueller/.test(d))       return 'Gesundheit';
  if (/amazon|zalando|ebay|otto|shein|aliexpress|paypal|hartlauer/.test(d))                        return 'Online Shopping';
  if (/gehalt|lohn|salary|gutschrift/.test(d))                                                     return 'Gehalt / Einnahmen';
  if (/kino|theater|concert|museum|netflix|spotify|disney|gaming|steam/.test(d))                   return 'Freizeit';
  if (/t-mobile|magenta|a1|drei|telekom|sollzinsen|gebühr|kontoführung|provision|zinsen|bawag|easybank/.test(d)) return 'Gebühren / Bank';
  return 'Sonstiges';
}
