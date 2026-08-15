// bonDate.test.js — Datums-Plausibilität der Bon-Analyse
//
// Hintergrund: Auf einem EDEKA-Bon vom 15.08.2026 (Fußzeile
// "Datum Uhrzeit Filiale Pos Bed Bon / 15.08.26 15:11 0042778 102 001 7437")
// hat die KI den 16.08.2026 zurückgegeben — einen Tag in der Zukunft.
// Ungeprüft landete das im Bon und riss ihn aus dem 7-Tage-Fenster von
// findMatch(). normalizeBonDate() markiert solche Daten jetzt.

import { normalizeBonDate, todayIso } from '../js/bonAnalyzer.js';
import { suite, test, eq, ok } from './harness.js';

const TODAY = '2026-08-15';

suite('normalizeBonDate — gültige Daten', () => {
  test('Datum von heute ist ok', () => {
    eq(normalizeBonDate('2026-08-15', TODAY), { date: '2026-08-15', suspect: false });
  });

  test('Datum aus der Vergangenheit ist ok', () => {
    eq(normalizeBonDate('2026-05-03', TODAY), { date: '2026-05-03', suspect: false });
  });

  test('Whitespace wird getrimmt', () => {
    eq(normalizeBonDate('  2026-05-03 ', TODAY), { date: '2026-05-03', suspect: false });
  });
});

suite('normalizeBonDate — Zukunft (der eigentliche Bug)', () => {
  test('EDEKA-Bon: 16.08. statt 15.08. → suspect', () => {
    eq(normalizeBonDate('2026-08-16', TODAY), { date: '2026-08-16', suspect: true });
  });

  test('Datum bleibt erhalten, wird nicht stillschweigend korrigiert', () => {
    // Welcher Tag wirklich auf dem Bon steht, weiß der Client nicht —
    // deshalb Flag statt Rateversuch. Korrigiert wird in der UI.
    eq(normalizeBonDate('2027-01-01', TODAY).date, '2027-01-01');
  });

  test('Jahr in der Zukunft → suspect', () => {
    ok(normalizeBonDate('2030-03-03', TODAY).suspect);
  });

  test('Vortag ist NICHT suspect (Grenzfall)', () => {
    eq(normalizeBonDate('2026-08-14', TODAY).suspect, false);
  });
});

suite('normalizeBonDate — Schrott-Eingaben', () => {
  test('null → date null, kein Verdacht', () => {
    eq(normalizeBonDate(null, TODAY), { date: null, suspect: false });
  });

  test('leerer String → null', () => {
    eq(normalizeBonDate('', TODAY), { date: null, suspect: false });
  });

  test('deutsches Format wird nicht als ISO durchgewinkt', () => {
    eq(normalizeBonDate('15.08.2026', TODAY), { date: null, suspect: false });
  });

  test('nicht existierender Tag (31. Februar) → null', () => {
    eq(normalizeBonDate('2026-02-31', TODAY), { date: null, suspect: false });
  });

  test('Monat 13 → null', () => {
    eq(normalizeBonDate('2026-13-01', TODAY), { date: null, suspect: false });
  });

  test('ISO-Timestamp statt Datum → null', () => {
    eq(normalizeBonDate('2026-08-15T15:11:00Z', TODAY), { date: null, suspect: false });
  });
});

suite('todayIso — lokale Zeit, nicht UTC', () => {
  test('formatiert als YYYY-MM-DD', () => {
    eq(todayIso(new Date(2026, 7, 5, 23, 30)), '2026-08-05');
  });

  test('spätabends bleibt es der lokale Tag', () => {
    // toISOString() hätte in UTC+2 hier schon den 06. geliefert — genau der
    // Off-by-one, den die Prüfung sonst selbst produziert.
    eq(todayIso(new Date(2026, 7, 5, 23, 59)), '2026-08-05');
  });

  test('einstellige Monate/Tage werden gepadded', () => {
    eq(todayIso(new Date(2026, 0, 9, 12, 0)), '2026-01-09');
  });
});
