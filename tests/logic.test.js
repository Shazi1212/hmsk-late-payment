'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../public/logic.js');
const R = require('../public/rates.js');

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.005, `${msg || ''} expected ${b}, got ${a}`);

test('simple interest matches the GOV.UK worked example (8.5%, £1,000, 50 days)', () => {
  // GOV.UK: £85 a year, about 23p a day, 50 days. Exact: 85 / 365 * 50 = 11.6438...
  near(L.simpleInterest(1000, 8.5, 365), 85);
  near(L.round2(L.simpleInterest(1000, 8.5, 1)), 0.23);
  near(L.round2(L.simpleInterest(1000, 8.5, 50)), 11.64);
});

test('UK reference rate: fixed by the day interest starts, from 30 June / 31 December', () => {
  assert.deepEqual(L.ukRate('2026-10-01'), { base: 3.75, refDate: '2026-06-30', rate: 11.75, provisional: false });
  assert.equal(L.ukRate('2026-01-01').base, 3.75); // 18 Dec 2025 cut to 3.75 counts for 31 Dec 2025
  assert.equal(L.ukRate('2025-12-31').base, 4.25); // 30 Jun 2025
  assert.equal(L.ukRate('2025-07-01').base, 4.25);
  assert.equal(L.ukRate('2025-06-30').base, 4.75); // 31 Dec 2024
  assert.equal(L.ukRate('2024-03-01').base, 5.25);
  assert.equal(L.ukRate('2023-03-01').rate, 11.5);
  assert.equal(L.ukRate('2027-01-01').provisional, true);
});

test('UK fixed compensation bands: £40 / £70 / £100', () => {
  assert.equal(L.ukCompensation(1), 40);
  assert.equal(L.ukCompensation(999.99), 40);
  assert.equal(L.ukCompensation(1000), 70);
  assert.equal(L.ukCompensation(9999.99), 70);
  assert.equal(L.ukCompensation(10000), 100);
  assert.equal(L.ukCompensation(250000), 100);
});

test('UK B2B: £1,000 due 1 Sep 2026, checked 1 Oct 2026', () => {
  const r = L.calculate({ country: 'uk', party: 'b2b', amount: 1000, due: '2026-09-01', asOf: '2026-10-01' });
  assert.equal(r.ok, true);
  assert.equal(r.currency, 'GBP');
  assert.equal(r.daysOverdue, 30);
  assert.equal(r.start, '2026-09-02');
  assert.equal(r.segments.length, 1);
  assert.equal(r.segments[0].rate, 11.75);
  near(r.interest, 9.66); // 1000 * 0.1175 * 30 / 365 = 9.6575
  assert.equal(r.fixed, 70);
  near(r.total, 1079.66);
  near(r.perDay, 0.32);
  assert.equal(r.provisional, false);
});

test('UK B2C: no statutory interest or compensation (1998 Act covers businesses only)', () => {
  const r = L.calculate({ country: 'uk', party: 'b2c', amount: 500, due: '2026-09-01', asOf: '2026-10-01' });
  assert.equal(r.statutory, false);
  assert.equal(r.daysOverdue, 30);
  assert.equal(r.interest, 0);
  assert.equal(r.fixed, 0);
  assert.equal(r.total, 500);
});

test('DE B2B: interest follows the Basiszinssatz change on 1 July 2026, plus €40', () => {
  const r = L.calculate({ country: 'de', party: 'b2b', amount: 1000, due: '2026-06-15', asOf: '2026-07-15' });
  assert.equal(r.currency, 'EUR');
  assert.equal(r.daysOverdue, 30);
  assert.equal(r.segments.length, 2);
  assert.deepEqual(r.segments.map((s) => [s.from, s.to, s.days, s.rate]),
    [['2026-06-16', '2026-06-30', 15, 10.27], ['2026-07-01', '2026-07-15', 15, 10.52]]);
  // 1000 * (0.1027 * 15 + 0.1052 * 15) / 365 = 8.5438
  near(r.interest, 8.54);
  assert.equal(r.fixed, 40);
  near(r.total, 1048.54);
});

test('DE B2C: 5 points over the Basiszinssatz, no Pauschale', () => {
  const r = L.calculate({ country: 'de', party: 'b2c', amount: 2000, due: '2026-08-31', asOf: '2026-10-30' });
  assert.equal(r.daysOverdue, 60);
  assert.equal(r.segments.length, 1);
  assert.equal(r.segments[0].rate, 6.52);
  near(r.interest, 2000 * 0.0652 * 60 / 365); // 21.4356
  assert.equal(r.fixed, 0);
});

test('DE: negative Basiszinssatz in 2022 is used as is (-0.88 + 9 = 8.12)', () => {
  const r = L.calculate({ country: 'de', party: 'b2b', amount: 365, due: '2022-03-01', asOf: '2022-03-11' });
  assert.equal(r.segments[0].rate, 8.12);
  near(r.interest, 365 * 0.0812 * 10 / 365);
});

test('DE: segment interest adds up to the total over several half-years', () => {
  const r = L.calculate({ country: 'de', party: 'b2b', amount: 12345.67, due: '2023-11-30', asOf: '2026-10-19' });
  assert.equal(r.segments.length, 6);
  assert.equal(r.segments.reduce((n, s) => n + s.days, 0), r.daysOverdue);
  assert.equal(L.round2(r.segments.reduce((n, s) => n + s.interest, 0)), r.interest, 'total = sum of rounded rows');
  near(r.interest, 4026.65);
  for (const s of r.segments) assert.equal(s.rate, L.round2(s.base + 9));
});

test('provisional flag when the date runs past the published rates', () => {
  const r = L.calculate({ country: 'de', party: 'b2b', amount: 1000, due: '2026-12-01', asOf: '2027-01-10' });
  assert.equal(r.provisional, true);
  assert.equal(L.calculate({ country: 'de', party: 'b2b', amount: 1000, due: '2026-09-01', asOf: '2026-10-19' }).provisional, false);
});

test('not overdue: due today or in the future', () => {
  for (const due of ['2026-10-19', '2026-11-30']) {
    const r = L.calculate({ country: 'de', party: 'b2b', amount: 100, due, asOf: '2026-10-19' });
    assert.equal(r.overdue, false);
    assert.equal(r.daysOverdue, 0);
    assert.equal(r.interest, 0);
    assert.equal(r.fixed, 0);
    assert.equal(r.total, 100);
  }
});

test('invalid input is rejected with the field name', () => {
  const base = { country: 'uk', party: 'b2b', amount: 100, due: '2026-09-01', asOf: '2026-10-01' };
  assert.equal(L.calculate({ ...base, country: 'fr' }).error, 'country');
  assert.equal(L.calculate({ ...base, party: 'x' }).error, 'party');
  assert.equal(L.calculate({ ...base, amount: 0 }).error, 'amount');
  assert.equal(L.calculate({ ...base, amount: 'abc' }).error, 'amount');
  assert.equal(L.calculate({ ...base, due: '2026-02-30' }).ok, true); // Date.UTC rolls over; isISO accepts shape only
  assert.equal(L.calculate({ ...base, due: '01.09.2026' }).error, 'due');
  assert.equal(L.calculate({ ...base, asOf: '' }).error, 'asOf');
  assert.equal(L.calculate({ ...base, due: '2021-12-31' }).error, 'tooOld');
});

test('rate tables are sorted and complete half-years', () => {
  for (const list of [R.uk.periods, R.de.periods]) {
    for (let i = 1; i < list.length; i++) assert.ok(list[i - 1].from < list[i].from);
  }
  for (const p of R.uk.periods) assert.ok(/-(01-01|07-01)$/.test(p.from) && /-(12-31|06-30)$/.test(p.refDate));
  assert.equal(R.uk.periods.at(-1).base, R.uk.currentBase);
  assert.ok(R.checked.match(/^\d{4}-\d{2}-\d{2}$/));
});

test('German letters: Zahlungserinnerung has no claims, Mahnung lists Zinsen and Pauschale', () => {
  const r = L.calculate({ country: 'de', party: 'b2b', amount: 1000, due: '2026-06-15', asOf: '2026-07-15' });
  const d = { invoiceNo: 'RE-2026-017', invoiceDate: '2026-05-16' };
  const z = L.letter(r, d, 'reminder');
  assert.equal(z.lang, 'de');
  assert.match(z.subject, /^Zahlungserinnerung: Rechnung RE-2026-017 vom 16\.05\.2026$/);
  assert.equal(z.claim, false);
  assert.ok(!z.paras.join(' ').includes('Verzugszinsen'));
  assert.equal(z.payBy, '2026-07-25');
  const m = L.letter(r, d, 'demand');
  assert.match(m.subject, /^Mahnung/);
  assert.equal(m.claim, true);
  const txt = m.paras.join(' ');
  assert.ok(txt.includes('§ 288 Abs. 2 BGB') && txt.includes('neun Prozentpunkten'));
  assert.ok(txt.includes('10,27 % bzw. 10,52 %'));
  assert.deepEqual(m.table.map((x) => x[1].replace(/\s/g, ' ')), ['1.000,00 €', '8,54 €', '40,00 €', '1.048,54 €']);
  assert.equal(m.payBy, '2026-07-22');
});

test('German Mahnung to a consumer cites § 288 Abs. 1 and has no Pauschale', () => {
  const r = L.calculate({ country: 'de', party: 'b2c', amount: 2000, due: '2026-08-31', asOf: '2026-10-30' });
  const m = L.letter(r, { recipientName: 'Erika Mustermann' }, 'demand');
  assert.equal(m.salutation, 'Guten Tag Erika Mustermann,');
  const txt = m.paras.join(' ');
  assert.ok(txt.includes('§ 288 Abs. 1 BGB') && !txt.includes('Pauschale'));
  assert.equal(m.table.length, 3);
});

test('UK letters: reminder, statutory demand for B2B, plain demand for B2C', () => {
  const r = L.calculate({ country: 'uk', party: 'b2b', amount: 1000, due: '2026-09-01', asOf: '2026-10-01' });
  const rem = L.letter(r, { invoiceNo: 'INV-9' }, 'reminder');
  assert.equal(rem.lang, 'en');
  assert.match(rem.subject, /^Payment reminder: invoice INV-9$/);
  assert.equal(rem.closing, 'Kind regards,');
  const dem = L.letter(r, { invoiceNo: 'INV-9', recipientName: 'Ms Smith' }, 'demand');
  assert.equal(dem.claim, true);
  assert.ok(dem.paras.join(' ').includes('Late Payment of Commercial Debts (Interest) Act 1998'));
  assert.ok(dem.paras.join(' ').includes('3.75% on 30 June 2026'));
  assert.deepEqual(dem.table.map((x) => x[1]), ['£1,000.00', '£9.66', '£70.00', '£1,079.66']);
  assert.equal(dem.closing, 'Yours sincerely,');
  const c = L.calculate({ country: 'uk', party: 'b2c', amount: 1000, due: '2026-09-01', asOf: '2026-10-01' });
  const cd = L.letter(c, {}, 'demand');
  assert.equal(cd.claim, false);
  assert.ok(!cd.paras.join(' ').includes('1998'));
  assert.equal(cd.closing, 'Yours faithfully,');
  assert.match(cd.subject, /\[invoice number\]/);
});

test('plain-text letter has subject, table, bank details and sender', () => {
  const r = L.calculate({ country: 'de', party: 'b2b', amount: 1000, due: '2026-06-15', asOf: '2026-07-15' });
  const d = { invoiceNo: 'RE-1', bank: 'DE00 0000\nMusterbank', senderName: 'Max Muster' };
  const t = L.letterText(L.letter(r, d, 'demand'), d);
  assert.ok(t.startsWith('Mahnung: Rechnung RE-1\n'));
  assert.ok(t.includes('Gesamtbetrag'));
  assert.ok(t.includes('Bankverbindung: DE00 0000, Musterbank'));
  assert.ok(t.trimEnd().endsWith('Max Muster'));
});
