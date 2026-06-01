// matcher.test.js — Score-Logik gegen reale Match-Szenarien
import { findMatch, matchLabel, analyzeBonLinks } from '../js/matcher.js';
import { suite, test, eq, ok, isNull } from './harness.js';

const tx = (date, amount, description, id = `tx_${Math.random()}`) =>
  ({ id, date, amount, description });

const bon = (date, total, store) => ({ date, total, store });

suite('matcher — perfekte Matches', () => {
  test('exakter Betrag + selber Tag + Name → ≥95', () => {
    const result = findMatch(
      bon('2026-05-03', 15.99, 'Billa'),
      [tx('2026-05-03', -15.99, 'Billa')]
    );
    ok(result, 'sollte matchen');
    ok(result.score >= 95, `score ${result.score} < 95`);
    eq(matchLabel(result.score).label, '100% Match');
  });

  test('exakter Betrag + 2 Tage + Name → ≥80 (Starker Match)', () => {
    const result = findMatch(
      bon('2026-05-01', 15.99, 'Billa Plus'),
      [tx('2026-05-03', -15.99, 'Billa Plus')]
    );
    ok(result);
    ok(result.score >= 80, `score ${result.score} < 80`);
  });
});

suite('matcher — der McDonalds/Billa-Bug aus dem Review', () => {
  test('Billa-Bon 19,78 € matcht NICHT McDonalds-Tx 19,00 €', () => {
    const result = findMatch(
      bon('2026-05-03', 19.78, 'Billa'),
      [tx('2026-05-03', -19.00, "McDonald's")]
    );
    isNull(result, 'darf nicht matchen — Betrag ungleich und Name fehlt');
  });

  test('Bei ähnlichem Betrag muss der Name passen', () => {
    const result = findMatch(
      bon('2026-05-03', 19.50, 'Billa'),
      [tx('2026-05-03', -19.99, 'OMV Tankstelle')]
    );
    isNull(result);
  });
});

suite('matcher — Hard-Outs', () => {
  test('Bon-Datum 5 Tage NACH Buchung → kein Match', () => {
    const result = findMatch(
      bon('2026-05-08', 15.99, 'Billa'),
      [tx('2026-05-03', -15.99, 'Billa')]
    );
    isNull(result, 'Bon kann nicht nach der Buchung sein');
  });

  test('Buchung 10 Tage NACH Bon → kein Match', () => {
    const result = findMatch(
      bon('2026-05-03', 15.99, 'Billa'),
      [tx('2026-05-13', -15.99, 'Billa')]
    );
    isNull(result, 'außerhalb DATE_MAX_DAYS');
  });

  test('Betrag > 2 € Differenz → kein Match', () => {
    const result = findMatch(
      bon('2026-05-03', 15.99, 'Billa'),
      [tx('2026-05-03', -25.00, 'Billa')]
    );
    isNull(result);
  });

  test('Eingang (positives amount) wird ignoriert', () => {
    const result = findMatch(
      bon('2026-05-03', 15.99, 'Billa'),
      [tx('2026-05-03', 15.99, 'Gutschrift Billa')]
    );
    isNull(result, 'nur Ausgaben sind Match-Kandidaten');
  });
});

suite('matcher — Token-Similarity (Patch B)', () => {
  test('"DM" allein matcht NICHT "ADMIRAL" bei Betragsabstand (Tokenlänge < 3)', () => {
    const result = findMatch(
      bon('2026-05-03', 25.50, 'DM'),  // 0.50 € Diff → kein exakter Match
      [tx('2026-05-03', -25.00, 'Admiral Sportwetten')]
    );
    isNull(result, 'DM ist zu kurz, fällt aus Token-Set raus → Hard-Out greift');
  });

  test('Diacritic-Normalisierung: "Café Müller" matcht "Cafe Mueller"', () => {
    const result = findMatch(
      bon('2026-05-03', 12.50, 'Café Müller'),
      [tx('2026-05-03', -12.50, 'Cafe Mueller')]
    );
    ok(result, 'sollte matchen trotz Akzent/Umlaut-Unterschied');
  });

  test('"Joseph Bäckerei" matcht "Bäckerei Joseph" (Token-Order egal)', () => {
    const result = findMatch(
      bon('2026-05-03', 4.20, 'Joseph Bäckerei'),
      [tx('2026-05-03', -4.20, 'Bäckerei Joseph Filiale 12')]
    );
    ok(result, 'Token-Order darf egal sein');
  });
});

suite('matcher — Exklusivität (Patch C)', () => {
  test('excludeIds überspringt bereits verwendete Tx', () => {
    const t1 = tx('2026-05-03', -15.99, 'Billa', 'a');
    const t2 = tx('2026-05-03', -15.99, 'Billa', 'b');
    const used = new Set(['a']);
    const result = findMatch(
      bon('2026-05-03', 15.99, 'Billa'),
      [t1, t2],
      { excludeIds: used }
    );
    eq(result?.transaction.id, 'b');
  });

  test('Bei zwei perfekten Kandidaten Tiebreaker auf kleinerer Diff', () => {
    const a = tx('2026-05-03', -16.00, 'Billa', 'a');  // diff 0.01
    const b = tx('2026-05-03', -15.99, 'Billa', 'b');  // diff 0.00
    const result = findMatch(bon('2026-05-03', 15.99, 'Billa'), [a, b]);
    eq(result?.transaction.id, 'b', 'kleinerer amountDiff gewinnt');
  });
});

suite('matcher — Input-Validation', () => {
  test('Leerer Bon → null', () => {
    isNull(findMatch(null, [tx('2026-05-03', -10, 'x')]));
  });

  test('Bon ohne Betrag → null', () => {
    isNull(findMatch(bon('2026-05-03', 0, 'x'), [tx('2026-05-03', -10, 'x')]));
  });

  test('Leere TX-Liste → null', () => {
    isNull(findMatch(bon('2026-05-03', 15.99, 'Billa'), []));
  });
});

suite('matcher — Trinkgeld (unbar)', () => {
  test('Restaurant-Bon 59,20 + Trinkgeld 5,80 matcht Karten-Tx 65,00', () => {
    const result = findMatch(
      { date: '2026-06-01', total: 59.20, tip: 5.80, store: 'David Chi Nijo' },
      [tx('2026-06-01', -65.00, 'David Chi Nijo')]
    );
    ok(result, 'sollte über total+tip matchen');
    ok(result.score >= 95, `score ${result.score} < 95`);
  });

  test('Bon mit Trinkgeld matcht auch Tx ohne Trinkgeld (nur Summe gebucht)', () => {
    const result = findMatch(
      { date: '2026-06-01', total: 59.20, tip: 5.80, store: 'David Chi Nijo' },
      [tx('2026-06-01', -59.20, 'David Chi Nijo')]
    );
    ok(result, 'min(diff) deckt auch total ohne tip ab');
  });

  test('Ohne tip-Feld unverändert: 65,00-Tx matcht 59,20-Bon NICHT', () => {
    const result = findMatch(
      bon('2026-06-01', 59.20, 'David Chi Nijo'),
      [tx('2026-06-01', -65.00, 'David Chi Nijo')]
    );
    isNull(result, 'ohne tip > 2 € Differenz → Hard-Out');
  });
});

suite('analyzeBonLinks — Re-Match Maintenance (R4)', () => {
  const bondedTx = (id, date, amount, description, bonStore, bonTotal, bonDate) => ({
    id, date, amount, description,
    bon: { vendor: bonStore, total: bonTotal, date: bonDate || date },
  });

  test('passende Verknüpfung bleibt OK', () => {
    const t = bondedTx('a', '2026-05-03', -15.99, 'Billa', 'Billa', 15.99);
    const r = analyzeBonLinks([t]);
    eq(r.total, 1);
    eq(r.ok.length, 1);
    eq(r.stale.length, 0);
  });

  test('McDonalds-Bug: Billa-Bon auf McDonalds-Tx wird als stale erkannt', () => {
    const t = bondedTx('a', '2026-05-03', -19.00, "McDonald's", 'Billa', 19.78);
    const r = analyzeBonLinks([t]);
    eq(r.stale.length, 1);
    eq(r.stale[0].tx.id, 'a');
  });

  test('Tx ohne bon wird komplett ignoriert', () => {
    const t = { id: 'a', date: '2026-05-03', amount: -15.99, description: 'Billa' };
    const r = analyzeBonLinks([t]);
    eq(r.total, 0);
    eq(r.ok.length, 0);
    eq(r.stale.length, 0);
  });

  test('Eingang (positives amount) wird ignoriert auch mit bon', () => {
    const t = bondedTx('a', '2026-05-03', 15.99, 'Gutschrift', 'Billa', 15.99);
    const r = analyzeBonLinks([t]);
    eq(r.total, 0);
  });

  test('Mischung aus OK und stale wird korrekt aufgeteilt', () => {
    const a = bondedTx('a', '2026-05-03', -15.99, 'Billa',     'Billa', 15.99);
    const b = bondedTx('b', '2026-05-04', -19.00, "McDonald's", 'Billa', 19.78);
    const c = bondedTx('c', '2026-05-05', -4.20,  'Hofer',     'Hofer',  4.20);
    const r = analyzeBonLinks([a, b, c]);
    eq(r.total, 3);
    eq(r.ok.length, 2);
    eq(r.stale.length, 1);
    eq(r.stale[0].tx.id, 'b');
  });

  test('stale-Eintrag enthält Bon-Details für UI', () => {
    const t = bondedTx('a', '2026-05-03', -19.00, "McDonald's", 'Billa', 19.78);
    const r = analyzeBonLinks([t]);
    eq(r.stale[0].bonStore, 'Billa');
    eq(r.stale[0].bonTotal, 19.78);
  });
});
