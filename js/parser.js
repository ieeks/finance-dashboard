// parser.js — BAWAG/easybank PDF-Extraktion, lokaler Parser, KI-Kategorisierung

import { loadKeys } from './ui.js';
import { SUBSCRIPTION_RULES, RECURRING_RULES } from './categories.js';

function _applyRecurringFlags(txs) {
  return txs.map(t => {
    const rule = RECURRING_RULES.find(r => r.pattern.test(t.description));
    if (!rule) return t;
    return { ...t, isRecurring: true, recurringLabel: rule.label };
  });
}

function _applySubscriptionRules(txs) {
  return txs.map(t => {
    const rule = SUBSCRIPTION_RULES.find(r =>
      r.pattern.test(t.description) && Math.abs(Math.abs(t.amount) - r.amount) < 0.015
    );
    if (!rule) return t;
    return { ...t, description: rule.name, category: rule.category, aiCategorized: false };
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
          const merchantLine = bzLines.find(l => /DANKT/i.test(l)) ||
                               bzLines.find(l => /BILLA|SPAR|HOFER|LIDL|DM-FIL/i.test(l)) ||
                               bzLines.find(l => !/\d{2}:\d{2}/.test(l) && !/^POS\b/i.test(l)) || '';

          // Kaufdatum aus Terminalzeile: "POS 4350 D001 27.03. 18:05" → 27.03
          const posDateMatch = terminalLine.match(/(\d{2})\.(\d{2})\./);
          const txDate = posDateMatch
            ? `${year}-${posDateMatch[2].padStart(2,'0')}-${posDateMatch[1].padStart(2,'0')}`
            : bookingDate;

          const description = _extractMerchant(merchantLine, terminalLine, rawDesc);

          // ── DEBUG (bitte nach Bugfix entfernen) ──
          console.log('[DBG-KARTE]', bookingDate, amount + '€ →', description);
          console.log('[DBG-KARTE] bzLines     :', bzLines);
          console.log('[DBG-KARTE] terminalLine:', terminalLine || '(leer)');
          console.log('[DBG-KARTE] merchantLine:', merchantLine || '(leer)');
          console.log('[DBG-KARTE] txDate      :', txDate);

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

        const description = extractEasybankDescription(rawDesc, contLines, amount);
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
        console.log('[DBG-MERCHANT] Match:', line, '→', name);
        return name;
      }
    }
  }
  console.log(`[DBG-MERCHANT] Kein CARD_MERCHANTS Match. merchantLine="${merchantLine}" terminalLine="${terminalLine}" rawDesc="${rawDesc}"`);
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
  [/\bBILLA\b/i,            'Billa'],
  [/BILLA\s*PLUS/i,         'Billa Plus'],
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
  console.log(`[DBG-SEPA] "${rawDesc.trim()}" (${amount}€) → "${result}"`);
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

  // 2. Benannte Vorgänge auf rawDesc — VOR allText-Checks damit Miete/Gutschrift nicht überschrieben werden
  if (/Gutschrift\s+Onlinebanking/i.test(raw)) {
    for (const cl of contLines) {
      if (/^(BAWAATWW|OG\/|BG\/)/i.test(cl)) continue;
      const name = cl.replace(/AT\d{18,}/g, '').trim();
      if (name.length > 2) return `Gutschrift (${name.slice(0, 30)})`;
    }
    return 'Gutschrift';
  }
  if (/^Miete/i.test(raw))      return 'Miete / Hausverwaltung';
  if (/^Sollzinsen/i.test(raw)) return 'Sollzinsen';

  // 3. Bekannte Gegenstellen (allText-basiert)
  if (/Tesla/i.test(allText))                          return 'Tesla Supercharger';
  if (/T-Mobile|Magenta/i.test(allText))               return 'T-Mobile / Magenta';
  if (/WE\s+Vertrieb|Wien\s+Energie/i.test(allText))  return 'Wien Energie';
  if (/\bAMAZON\b/i.test(allText))                    return 'Amazon';
  if (/Olga\s*Zelenina|Zelenina/i.test(allText))
    return amount > 0 ? 'Gutschrift (Olga Zelenina)' : 'Olga Zelenina';
  if (/Manuel\s*Koblischek/i.test(allText) && amount > 0) return 'Gutschrift (Manuel Koblischek)';
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

  // 4. SEPA mit BIC → Gegenpartei aus Folgezeilen (kein i-Flag: BICs sind immer Großbuchstaben)
  if (/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}/.test(raw)) {
    for (const cl of contLines) {
      if (/^[A-Z]{6}[A-Z0-9]{2}|^(OG|BG|MC)\/|^Manuel Koblischek$|^\d{8,}$/.test(cl)) continue;
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

export function makeTx(date, description, amount, account, cardHolder = null) {
  return {
    id:            `tx_${date}_${Math.random().toString(36).slice(2,8)}`,
    date,
    description,
    amount,
    category:      'Sonstiges',
    aiCategorized: false,
    account:       account || 'easybank',
    cardHolder,
  };
}

function _makeTx(date, description, amount, account, cardHolder = null) {
  return makeTx(date, description, amount, account, cardHolder);
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
    return _applyRecurringFlags(_applySubscriptionRules(transactions.map(t => ({ ...t, category: guessCategory(t.description), aiCategorized: false }))));
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
    return _applyRecurringFlags(_applySubscriptionRules(transactions.map(t => ({ ...t, category: guessCategory(t.description), aiCategorized: false }))));
  }

  return _applyRecurringFlags(_applySubscriptionRules(transactions.map((t, i) => {
    const found = result.find(r => r.index === i);
    const validCats = ['Supermarkt','Restaurant / Café','Mobilität / Auto','Wohnen / Miete',
      'Energie / Strom','Versicherung','Drogerie','Gesundheit','Online Shopping',
      'Freizeit','Gehalt / Einnahmen','Familientransfer','Gebühren / Bank','Telekommunikation','Sonstiges'];
    const cat = found && validCats.includes(found.category) ? found.category : guessCategory(t.description);
    return { ...t, category: cat, aiCategorized: !!found };
  })));
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
  if (/billa|interspar|eurospar|\bspar\b|hofer|lidl|penny|nah.frisch|mpreis|unimarkt|maximarkt|\badeg\b|julius meinl/.test(d)) return 'Supermarkt';
  if (/restaurant|café|cafe|mcdonald|burger king|\bkfc\b|subway|starbucks|pronto|anker|felber|gasthaus|wirtshaus|beisl|der mann|pizza|kebab|coca.cola hbc/.test(d)) return 'Restaurant / Café';
  if (/^miete|wohnung|immobilien|hausverwaltung|betriebskosten|vorschreibung|miete \/ hausverwaltung/.test(d)) return 'Wohnen / Miete';
  if (/tesla|tankstelle|omv|avanti|turmöl|turmoel|circle k|\bbp\b|shell|\beni\b|agip|\bjet\b|öamtc|parken|parking|wiener linien|bim|bahn|öbb|uber|taxi|leasing/.test(d)) return 'Mobilität / Auto';
  if (/wien energie|we vertrieb|energie|strom|gas|verbund|e-control/.test(d))                      return 'Energie / Strom';
  if (/allianz kfz/i.test(d))                                                                       return 'Mobilität / Auto';
  if (/versicherung|helvetia|generali|allianz|uniqa|wiener städtische/.test(d))                    return 'Versicherung';
  if (/dm-fil|dm fil|\bdm\b|bipa|müller|mueller|rossmann|schlecker/.test(d))                       return 'Drogerie';
  if (/apotheke|arzt|krankenhaus/.test(d))                                                          return 'Gesundheit';
  if (/amazon|zalando|ebay|shein|aliexpress|paypal|hartlauer|mediamarkt|saturn|\bikea\b|zara|\bh&m\b|deichmann|humanic|intersport|decathlon|\bobi\b|hornbach|libro/.test(d)) return 'Online Shopping';
  if (/olga zelenina|zelenina|manuel koblischek|familientransfer/.test(d))                          return 'Familientransfer';
  if (/gehalt|lohn|salary|gutschrift/.test(d))                                                     return 'Gehalt / Einnahmen';
  if (/kino|theater|concert|museum|netflix|spotify|disney|gaming|steam/.test(d))                   return 'Freizeit';
  if (/t-mobile|magenta|\ba1\b|\bdrei\b|telekom|hutchison/.test(d))                                return 'Telekommunikation';
  if (/sollzinsen|gebühr|kontoführung|provision|zinsen|bawag|easybank/.test(d))                    return 'Gebühren / Bank';
  return 'Sonstiges';
}
