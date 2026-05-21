// owners.test.js — Owner-Erkennung
import { OWNERS, matchOwner, OWNER_HEADER_RE } from '../js/owners.js';
import { suite, test, eq, ok, isNull } from './harness.js';

suite('owners — matchOwner', () => {
  test('Olga erkannt', () => eq(matchOwner('Olga Zelenina'), 'Olga'));
  test('Zelenina allein erkannt', () => eq(matchOwner('Frau Zelenina'), 'Olga'));
  test('Manuel erkannt', () => eq(matchOwner('Manuel Koblischek AT12'), 'Manuel'));
  test('Koblischek allein erkannt', () => eq(matchOwner('KOBLISCHEK'), 'Manuel'));
  test('Unbekannter Name → null', () => isNull(matchOwner('Hans Wurst')));
  test('Leerer String → null', () => isNull(matchOwner('')));
  test('null Input → null', () => isNull(matchOwner(null)));
});

suite('owners — OWNER_HEADER_RE', () => {
  test('matcht Konto-Header mit Manuel + AT', () => {
    ok(OWNER_HEADER_RE.test('Manuel Koblischek AT12 3456 7890 1234'));
  });
  test('matcht nicht ohne AT-IBAN', () => {
    eq(OWNER_HEADER_RE.test('Manuel hat einen Brief geschrieben'), false);
  });
});

suite('owners — Struktur', () => {
  test('OWNERS Array nicht leer', () => ok(OWNERS.length > 0));
  test('Jeder Owner hat label + patterns', () => {
    for (const o of OWNERS) {
      ok(o.label, 'label fehlt');
      ok(Array.isArray(o.patterns) && o.patterns.length > 0, 'patterns leer');
    }
  });
});
