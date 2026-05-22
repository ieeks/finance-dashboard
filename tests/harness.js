// harness.js — schlanker Test-Runner ohne Framework
//
// Läuft in zwei Modi:
//   - Browser:  tests/run.html — Resultat als HTML in DOM
//   - Node/CI:  tests/run.node.mjs — Resultat in stdout, exit-Code 1 bei Fehler
//
// Verwendung:
//   import { suite, test, eq, ok } from './harness.js';
//   suite('Mein Modul', () => {
//     test('macht X', () => { eq(1+1, 2); });
//   });

const _suites = [];
let _current  = null;

export function suite(name, fn) {
  _current = { name, tests: [] };
  _suites.push(_current);
  fn();
  _current = null;
}

export function test(name, fn) {
  if (!_current) throw new Error(`test('${name}') außerhalb von suite()`);
  _current.tests.push({ name, fn });
}

class AssertionError extends Error {}

export function eq(actual, expected, msg = '') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new AssertionError(`${msg ? msg + ': ' : ''}erwartet ${e}, war ${a}`);
}

export function ok(value, msg = 'value falsy') {
  if (!value) throw new AssertionError(msg);
}

export function isNull(value, msg = '') {
  if (value !== null) throw new AssertionError(`${msg ? msg + ': ' : ''}erwartet null, war ${JSON.stringify(value)}`);
}

export function approx(actual, expected, delta = 0.01, msg = '') {
  if (Math.abs(actual - expected) > delta) {
    throw new AssertionError(`${msg ? msg + ': ' : ''}|${actual} - ${expected}| > ${delta}`);
  }
}

export function runAll() {
  const isBrowser = typeof document !== 'undefined';
  return isBrowser ? _runInBrowser() : _runInNode();
}

function _runInBrowser() {
  const root      = document.getElementById('results');
  const summaryEl = document.getElementById('summary');
  let totalPass = 0, totalFail = 0;

  for (const s of _suites) {
    const suiteEl = document.createElement('div');
    suiteEl.className = 'suite';
    const head    = document.createElement('div');
    head.className = 'suite-head';
    suiteEl.appendChild(head);
    let pass = 0, fail = 0;

    for (const t of s.tests) {
      const row = document.createElement('div');
      row.className = 'test';
      try {
        t.fn();
        row.classList.add('pass');
        row.innerHTML = `<span class="test-status">✓</span><span class="test-msg">${_escape(t.name)}</span>`;
        pass++;
      } catch (e) {
        row.classList.add('fail');
        const msg = e instanceof AssertionError ? e.message : `${e.name}: ${e.message}`;
        row.innerHTML = `<span class="test-status">✗</span><span class="test-msg">${_escape(t.name)}\n   ${_escape(msg)}</span>`;
        fail++;
      }
      suiteEl.appendChild(row);
    }
    head.innerHTML = `<span>${_escape(s.name)}</span><span>${pass} ✓ ${fail ? `· ${fail} ✗` : ''}</span>`;
    root.appendChild(suiteEl);
    totalPass += pass; totalFail += fail;
  }

  summaryEl.className = `summary ${totalFail ? 'fail' : 'pass'}`;
  summaryEl.textContent = totalFail
    ? `❌ ${totalFail} Tests fehlgeschlagen (${totalPass} bestanden)`
    : `✅ Alle ${totalPass} Tests bestanden`;
}

function _runInNode() {
  let totalPass = 0, totalFail = 0;
  for (const s of _suites) {
    let pass = 0, fail = 0;
    console.log(`\n${s.name}`);
    for (const t of s.tests) {
      try {
        t.fn();
        console.log(`  ✓ ${t.name}`);
        pass++;
      } catch (e) {
        const msg = e instanceof AssertionError ? e.message : `${e.name}: ${e.message}`;
        console.log(`  ✗ ${t.name}\n    ${msg}`);
        fail++;
      }
    }
    totalPass += pass; totalFail += fail;
  }
  console.log(`\n${totalFail ? '❌' : '✅'} ${totalPass}/${totalPass + totalFail} bestanden`);
  if (typeof process !== 'undefined' && process.exit) {
    process.exit(totalFail ? 1 : 0);
  }
}

function _escape(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
