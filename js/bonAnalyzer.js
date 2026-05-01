// bonAnalyzer.js — Bon/Rechnung Analyse (Bild + PDF) via Claude Vision

import { loadKeys } from './ui.js';

const _promptUrl = new URL('../prompts/analyze-bon.md', import.meta.url).href;

async function _loadPrompt() {
  const resp = await fetch(_promptUrl);
  if (!resp.ok) throw new Error('Prompt-Datei nicht gefunden');
  return resp.text();
}

function _safeParseObject(raw) {
  const clean = raw.replace(/```json|```/g, '').trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('KI hat kein JSON zurückgegeben — bitte nochmal versuchen');
  let obj;
  try {
    obj = JSON.parse(match[0]);
  } catch {
    throw new Error('KI-Antwort ist kein gültiges JSON — bitte nochmal versuchen');
  }
  return {
    store:   obj.store   || obj.händler || obj.shop || 'Unbekannt',
    date:    obj.date    || obj.datum   || null,
    total:   typeof obj.total === 'number' ? obj.total : parseFloat(obj.total || obj.gesamt || 0) || 0,
    items:   Array.isArray(obj.items)   ? obj.items   : [],
    category: obj.category || obj.kategorie || null,
  };
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
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      messages:   [{
        role:    'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
          { type: 'text',  text: promptText },
        ],
      }],
    }),
  });
  if (!resp.ok) throw new Error(`API ${resp.status}`);
  const data = await resp.json();
  return _safeParseObject(data.content[0].text);
}

// ── PDF-Bon via Text-Extraktion ──
export async function analyzeBonPdf(pdfText) {
  const keys         = loadKeys();
  const promptText   = await _loadPrompt();
  const fullPrompt   = `${promptText}\n\nRechnungstext:\n${pdfText.slice(0, 8000)}`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key':    keys.anthropic,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      messages:   [{ role: 'user', content: fullPrompt }],
    }),
  });
  if (!resp.ok) throw new Error(`API ${resp.status}`);
  const data = await resp.json();
  return _safeParseObject(data.content[0].text);
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
          { type: 'text',      text: promptText },
        ],
      }],
    }),
  });
  if (!resp.ok) throw new Error(`OpenAI ${resp.status}`);
  const data = await resp.json();
  return _safeParseObject(data.choices[0].message.content);
}

// ── OpenAI GPT-4o — PDF (Text-Extraktion) ──
export async function analyzeBonPdfOpenAI(pdfText) {
  const keys       = loadKeys();
  const promptText = await _loadPrompt();
  const fullPrompt = `${promptText}\n\nRechnungstext:\n${pdfText.slice(0, 8000)}`;

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
  if (!resp.ok) throw new Error(`OpenAI ${resp.status}`);
  const data = await resp.json();
  return _safeParseObject(data.choices[0].message.content);
}
