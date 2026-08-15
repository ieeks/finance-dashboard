// bonAnalyzer.js — Bon/Rechnung Analyse (Bild + PDF) via Claude Vision

import { loadKeys } from './ui.js?v=1.11.0';

const _promptUrl = new URL('../prompts/analyze-bon.md?v=1.11.0', import.meta.url).href;

// Modell für die Bon-Analyse (Anthropic). Sonnet statt Haiku: dichte
// Thermobons mit zwei Preisspalten (EINZEL/GESAMT), vielen Zeilen und
// schräg fotografiert werden von Haiku zu oft falsch ausgelesen — Sonnet
// ist bei der visuellen Zahlen-Zuordnung deutlich zuverlässiger.
const _ANTHROPIC_BON_MODEL = 'claude-sonnet-5';

// Output-Budget für die Bon-Analyse. Lange Bons (18+ Positionen) plus der
// thinking-Block, den Sonnet oft voranstellt (zählt ins Budget), sprengten die
// alten 2000 Tokens — das JSON brach mittendrin ab („kein gültiges JSON").
// max_tokens ist nur eine Obergrenze; abgerechnet wird, was wirklich erzeugt wird.
const _BON_MAX_TOKENS = 8000;

async function _loadPrompt() {
  const resp = await fetch(_promptUrl);
  if (!resp.ok) throw new Error('Prompt-Datei nicht gefunden');
  return resp.text();
}

// Heutiges Datum in LOKALER Zeit als "YYYY-MM-DD".
// Bewusst nicht `toISOString().slice(0,10)`: das rechnet nach UTC um und
// liefert in Österreich (UTC+2) ab 22:00 schon den Vortag — genau der
// Off-by-one, den wir hier eigentlich abfangen wollen.
export function todayIso(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Referenzdatum für die KI. Ohne diesen Anker kann das Modell nicht merken,
// dass es ein Datum in der Zukunft gelesen hat — ein Kassenbon von morgen ist
// immer ein Lesefehler, aber „morgen" ist ohne Heute-Bezug nicht erkennbar.
function _dateAnchor(today = todayIso()) {
  return `\n\nHeutiges Datum (Referenz): ${today}\n`
       + `Das Kaufdatum (\`date\`) liegt IMMER an oder vor diesem Tag — niemals danach.\n`
       + `(Nur \`debit_date\` darf in der Zukunft liegen.)`;
}

// Prüft das von der KI gelieferte `date`.
//   - kein/ungültiges Datum          → { date: null,  suspect: false }
//   - Datum nach heute               → { date: <wie geliefert>, suspect: true }
//   - plausibles Datum               → { date: <normalisiert>, suspect: false }
// Bewusst KEINE stille Korrektur: welcher Tag wirklich auf dem Bon steht,
// wissen wir hier nicht. Das Datum wird markiert und in der UI editierbar
// angeboten, statt es zu raten.
export function normalizeBonDate(raw, today = todayIso()) {
  const s = String(raw ?? '').trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return { date: null, suspect: false };

  const [, y, mo, d] = m;
  const probe = new Date(Date.UTC(+y, +mo - 1, +d));
  // Fängt „2026-02-31" & Co. ab — Date rollt sonst stillschweigend weiter.
  const roundTrips = probe.getUTCFullYear() === +y
                  && probe.getUTCMonth() === +mo - 1
                  && probe.getUTCDate() === +d;
  if (!roundTrips) return { date: null, suspect: false };

  return { date: s, suspect: s > today };
}

// Holt den Text aus einer Anthropic-Messages-Antwort. Neuere Modelle
// (Claude-5-Familie / Sonnet) stellen oft einen `thinking`-Block VOR den
// Text-Block — dann ist content[0] kein Text und content[0].text undefined.
// Deshalb gezielt den ersten echten Text-Block suchen statt content[0].
function _anthropicText(data) {
  const blocks = Array.isArray(data?.content) ? data.content : [];
  const textBlock = blocks.find(b => b?.type === 'text' && typeof b.text === 'string');
  return textBlock ? textBlock.text : '';
}

function _safeParseObject(raw, today = todayIso()) {
  const clean = String(raw ?? '').replace(/```json|```/g, '').trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('KI hat kein JSON zurückgegeben — bitte nochmal versuchen');
  let obj;
  try {
    obj = JSON.parse(match[0]);
  } catch {
    throw new Error('KI-Antwort ist kein gültiges JSON — bitte nochmal versuchen');
  }
  const tipRaw = obj.tip ?? obj.trinkgeld ?? obj.gratuity ?? 0;
  // vat = USt., die auf die Positionen aufgeschlagen wird (Netto-Rechnungen wie
  // Ladestrom/Handwerker). Bei Kassenbons 0 — dort sind die Preise brutto.
  const vatRaw = obj.vat ?? obj.ust ?? obj.mwst ?? 0;
  // Datums-Plausibilität. Nur `date` wird geprüft — ein `debit_date` in der
  // Zukunft ist bei Lastschrift-Rechnungen der Normalfall.
  const checked = normalizeBonDate(obj.date ?? obj.datum, today);
  return {
    store:   obj.store   || obj.händler || obj.shop || 'Unbekannt',
    date:    checked.date,
    // true → Datum liegt in der Zukunft, die KI hat sich beim Ablesen vertan.
    // Die UI zeigt dann eine Warnung und ein editierbares Datumsfeld.
    dateSuspect: checked.suspect,
    // Abbuchungsdatum bei Lastschrift — der Matcher prüft beide Daten
    debitDate: obj.debit_date || obj.debitDate || obj.abbuchungsdatum || null,
    total:   typeof obj.total === 'number' ? obj.total : parseFloat(obj.total || obj.gesamt || 0) || 0,
    vat:     typeof vatRaw === 'number' ? vatRaw : parseFloat(vatRaw) || 0,
    tip:     typeof tipRaw === 'number' ? tipRaw : parseFloat(tipRaw) || 0,
    items:   Array.isArray(obj.items)   ? obj.items   : [],
    category: obj.category || obj.kategorie || null,
  };
}

// Anthropic akzeptiert nur exakt diese media_types. Viele Handys liefern
// 'image/jpg' (ohne 'e') oder leeren Typ → Anthropic antwortet sonst mit 400.
const _ALLOWED_MEDIA = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
function _normalizeMediaType(mimeType) {
  let mt = (mimeType || '').toLowerCase().trim();
  if (mt === 'image/jpg') mt = 'image/jpeg';
  return _ALLOWED_MEDIA.includes(mt) ? mt : 'image/jpeg';
}

// Liest den Fehler-Body aus und baut eine sprechende Error-Message.
async function _apiError(resp, provider) {
  let detail = '';
  try {
    const body = await resp.text();
    try {
      const j = JSON.parse(body);
      detail = j?.error?.message || j?.message || body;
    } catch { detail = body; }
  } catch { /* Body nicht lesbar */ }
  return new Error(`${provider} ${resp.status}${detail ? ': ' + String(detail).slice(0, 240) : ''}`);
}

// ── Bild-Bon via Claude Vision ──
export async function analyzeBonImage(base64, mimeType) {
  const keys       = loadKeys();
  const promptText = await _loadPrompt();

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key':    keys.anthropic,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model:      _ANTHROPIC_BON_MODEL,
      max_tokens: _BON_MAX_TOKENS,
      messages:   [{
        role:    'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: _normalizeMediaType(mimeType), data: base64 } },
          { type: 'text',  text: promptText + _dateAnchor() },
        ],
      }],
    }),
  });
  if (!resp.ok) throw await _apiError(resp, 'Anthropic');
  const data = await resp.json();
  return _safeParseObject(_anthropicText(data));
}

// ── PDF-Bon via Text-Extraktion ──
export async function analyzeBonPdf(pdfText) {
  const keys         = loadKeys();
  const promptText   = await _loadPrompt();
  const fullPrompt   = `${promptText}${_dateAnchor()}\n\nRechnungstext:\n${pdfText.slice(0, 8000)}`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key':    keys.anthropic,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model:      _ANTHROPIC_BON_MODEL,
      max_tokens: _BON_MAX_TOKENS,
      messages:   [{ role: 'user', content: fullPrompt }],
    }),
  });
  if (!resp.ok) throw await _apiError(resp, 'Anthropic');
  const data = await resp.json();
  return _safeParseObject(_anthropicText(data));
}

// ── OpenAI GPT-4o Vision — Bild ──
export async function analyzeBonOpenAI(base64, mimeType) {
  const keys       = loadKeys();
  const promptText = await _loadPrompt();

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${keys.openai}`,
    },
    body: JSON.stringify({
      model:      'gpt-4o',
      max_tokens: 2000,
      messages:   [{
        role:    'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
          { type: 'text',      text: promptText + _dateAnchor() },
        ],
      }],
    }),
  });
  if (!resp.ok) throw await _apiError(resp, 'OpenAI');
  const data = await resp.json();
  return _safeParseObject(data.choices[0].message.content);
}

// ── OpenAI GPT-4o — PDF (Text-Extraktion) ──
export async function analyzeBonPdfOpenAI(pdfText) {
  const keys       = loadKeys();
  const promptText = await _loadPrompt();
  const fullPrompt = `${promptText}${_dateAnchor()}\n\nRechnungstext:\n${pdfText.slice(0, 8000)}`;

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${keys.openai}`,
    },
    body: JSON.stringify({
      model:      'gpt-4o-mini',
      max_tokens: 2000,
      messages:   [{ role: 'user', content: fullPrompt }],
    }),
  });
  if (!resp.ok) throw await _apiError(resp, 'OpenAI');
  const data = await resp.json();
  return _safeParseObject(data.choices[0].message.content);
}
