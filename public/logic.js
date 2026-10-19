/* Late-payment interest calculator and reminder letters (UK and Germany).
   No DOM access here, so the same file runs in the browser (window.LatePayment)
   and in Node for the tests (module.exports). Rates and sources: rates.js. */
(function (root) {
  'use strict';

  var RATES = (typeof module !== 'undefined' && module.exports) ? require('./rates.js') : root.LP_RATES;

  // ---------- dates (ISO strings, UTC, no time zones) ----------
  function isISO(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(toDays(s)); }
  function toDays(iso) { var p = iso.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000; }
  function fromDays(n) { return new Date(n * 86400000).toISOString().slice(0, 10); }
  function addDays(iso, n) { return fromDays(toDays(iso) + n); }
  function daysBetween(a, b) { return toDays(b) - toDays(a); }
  function todayISO(now) {
    var d = now || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function round2(x) { return Math.round((x + Number.EPSILON) * 100) / 100; }

  // Simple interest for `days` days at `ratePct` % a year, 365-day year (as in the GOV.UK example).
  function simpleInterest(amount, ratePct, days) { return amount * ratePct / 100 * days / 365; }

  // ---------- rate lookups ----------
  function lastPeriod(periods, iso) {
    var hit = null;
    for (var i = 0; i < periods.length; i++) if (periods[i].from <= iso) hit = periods[i];
    return hit;
  }

  // UK: the reference rate is fixed by the day interest starts running.
  function ukRate(startISO) {
    var p = lastPeriod(RATES.uk.periods, startISO);
    if (!p) return null;
    return { base: p.base, refDate: p.refDate, rate: round2(p.base + RATES.uk.margin), provisional: startISO > RATES.uk.knownUntil };
  }

  function ukCompensation(amount) {
    var c = RATES.uk.compensation;
    for (var i = 0; i < c.length; i++) if (amount < c[i][0]) return c[i][1];
    return c[c.length - 1][1];
  }

  // DE: the Basiszinssatz changes every half-year; interest follows it.
  function deBase(iso) {
    var p = lastPeriod(RATES.de.periods, iso);
    return p ? { rate: p.rate, from: p.from, provisional: iso > RATES.de.knownUntil } : null;
  }

  /* calculate(input) -> result
     input: { country: 'uk'|'de', party: 'b2b'|'b2c', amount: number, due: 'YYYY-MM-DD', asOf: 'YYYY-MM-DD' }
     due   = last day the debtor could pay on time; interest runs from the next day.
     asOf  = date of the calculation / letter; interest counted up to and including this day.
     result: {
       ok, error,
       currency: 'GBP'|'EUR', daysOverdue, overdue,
       start: first interest day or null,
       segments: [{ from, to, days, rate, base, interest }],   one row per rate period
       interest, fixed, fixedLabel, total, perDay,
       statutory: bool,        false for UK B2C (the 1998 Act covers businesses only)
       provisional: bool,      true if a period beyond the published rates was used
     } */
  function calculate(input) {
    var i = input || {};
    var country = i.country === 'uk' ? 'uk' : i.country === 'de' ? 'de' : null;
    var party = i.party === 'b2c' ? 'b2c' : i.party === 'b2b' ? 'b2b' : null;
    var amount = Number(i.amount);
    if (!country) return fail('country');
    if (!party) return fail('party');
    if (!isFinite(amount) || amount <= 0) return fail('amount');
    if (amount > 1e12) return fail('amount');
    if (!isISO(i.due)) return fail('due');
    if (!isISO(i.asOf)) return fail('asOf');
    if (i.due < RATES.minDue) return fail('tooOld');

    amount = round2(amount);
    var r = {
      ok: true, error: null, country: country, party: party, amount: amount,
      currency: country === 'uk' ? 'GBP' : 'EUR',
      due: i.due, asOf: i.asOf,
      daysOverdue: Math.max(0, daysBetween(i.due, i.asOf)),
      start: null, segments: [], interest: 0, fixed: 0, total: amount, perDay: 0,
      statutory: !(country === 'uk' && party === 'b2c'), provisional: false,
    };
    r.overdue = r.daysOverdue > 0;
    if (!r.overdue) return r;
    r.start = addDays(i.due, 1);

    if (country === 'uk') {
      if (r.statutory) {
        var u = ukRate(r.start);
        var it = simpleInterest(amount, u.rate, r.daysOverdue);
        r.segments.push({ from: r.start, to: i.asOf, days: r.daysOverdue, rate: u.rate, base: u.base, refDate: u.refDate, interest: round2(it) });
        r.interest = round2(it);
        r.perDay = round2(simpleInterest(amount, u.rate, 1));
        r.fixed = party === 'b2b' ? ukCompensation(amount) : 0;
        r.provisional = u.provisional;
      }
    } else {
      var margin = party === 'b2b' ? RATES.de.marginB2B : RATES.de.marginB2C;
      var total = 0, d = r.start, seg = null;
      // walk day by day (debts are at most a few thousand days), grouping days with the same rate
      while (d <= i.asOf) {
        var b = deBase(d);
        if (b.provisional) r.provisional = true;
        var rate = round2(b.rate + margin);
        if (!seg || seg.rate !== rate) {
          if (seg) r.segments.push(seg);
          seg = { from: d, to: d, days: 0, rate: rate, base: b.rate, interest: 0 };
        }
        seg.to = d; seg.days++;
        seg.interest += simpleInterest(amount, rate, 1);
        d = addDays(d, 1);
      }
      if (seg) r.segments.push(seg);
      // each period is rounded to cents, and the total is the sum of the rounded rows, so the letter adds up
      r.segments.forEach(function (s) { s.interest = round2(s.interest); total += s.interest; });
      r.interest = round2(total);
      var last = r.segments[r.segments.length - 1];
      r.perDay = round2(simpleInterest(amount, last.rate, 1));
      r.fixed = party === 'b2b' ? RATES.de.pauschale : 0;
    }
    r.total = round2(amount + r.interest + r.fixed);
    return r;

    function fail(field) { return { ok: false, error: field }; }
  }

  // ---------- money and date formatting for the letters ----------
  function money(x, currency) {
    return new Intl.NumberFormat(currency === 'GBP' ? 'en-GB' : 'de-DE', { style: 'currency', currency: currency }).format(x);
  }
  function pct(x, country) {
    var s = x.toFixed(2);
    return (country === 'de' ? s.replace('.', ',') : s) + (country === 'de' ? ' %' : '%');
  }
  function longDate(iso, country) {
    var p = iso.split('-');
    return new Intl.DateTimeFormat(country === 'de' ? 'de-DE' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])));
  }
  function shortDate(iso, country) {
    var p = iso.split('-');
    return country === 'de' ? p[2] + '.' + p[1] + '.' + p[0] : p[2] + '/' + p[1] + '/' + p[0];
  }

  /* letter(result, details, kind) -> { lang, subject, salutation, paras: [..], table: [[label, value]..], closing, sign }
     kind: 'reminder' (friendly, no claims) | 'demand' (claims statutory interest and fixed sums)
     details: { invoiceNo, invoiceDate, payBy, recipientName, senderName, bank } (all optional strings)
     The letter language follows the law: German for Germany, English for the UK. */
  function letter(res, details, kind) {
    var dt = details || {};
    var c = res.country, cur = res.currency;
    var inv = dt.invoiceNo ? String(dt.invoiceNo) : (c === 'de' ? '[Rechnungsnummer]' : '[invoice number]');
    var invDate = isISO(dt.invoiceDate) ? shortDate(dt.invoiceDate, c) : null;
    var payBy = isISO(dt.payBy) ? dt.payBy : addDays(res.asOf, kind === 'demand' ? 7 : 10);
    var claim = kind === 'demand' && res.overdue && res.statutory;
    var out = { lang: c === 'de' ? 'de' : 'en', kind: kind, table: [], paras: [] };
    var who = dt.recipientName ? String(dt.recipientName) : '';

    if (c === 'de') {
      var mahnung = kind === 'demand';
      out.subject = (mahnung ? 'Mahnung' : 'Zahlungserinnerung') + ': Rechnung ' + inv + (invDate ? ' vom ' + invDate : '');
      out.salutation = who ? 'Guten Tag ' + who + ',' : 'Sehr geehrte Damen und Herren,';
      if (!mahnung) {
        out.paras.push('sicher ist es Ihrer Aufmerksamkeit entgangen: Unsere Rechnung ' + inv + (invDate ? ' vom ' + invDate : '') +
          ' über ' + money(res.amount, cur) + ' war am ' + shortDate(res.due, c) + ' fällig. Bis heute konnten wir keinen Zahlungseingang feststellen.');
        out.paras.push('Bitte überweisen Sie den Betrag bis zum ' + shortDate(payBy, c) + ' auf das unten genannte Konto. Sollten Sie die Zahlung in den letzten Tagen bereits veranlasst haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.');
        out.table.push(['Offener Betrag', money(res.amount, cur)]);
      } else {
        out.paras.push('unsere Rechnung ' + inv + (invDate ? ' vom ' + invDate : '') + ' über ' + money(res.amount, cur) +
          ' war am ' + shortDate(res.due, c) + ' fällig. Trotz Fälligkeit ist bis heute keine Zahlung eingegangen' +
          (res.overdue ? '; Sie befinden sich seit dem ' + shortDate(res.start, c) + ' im Zahlungsverzug.' : '.'));
        if (claim) {
          var rateTxt = res.segments.length === 1 ? pct(res.segments[0].rate, c)
            : res.segments.map(function (s) { return pct(s.rate, c); }).join(' bzw. ');
          out.paras.push('Gemäß § 288 Abs. ' + (res.party === 'b2b' ? '2' : '1') + ' BGB berechnen wir Verzugszinsen in Höhe von ' +
            (res.party === 'b2b' ? 'neun' : 'fünf') + ' Prozentpunkten über dem jeweiligen Basiszinssatz (' + rateTxt + ' p. a.)' +
            (res.party === 'b2b' ? ' sowie die Verzugspauschale von ' + money(res.fixed, cur) + ' nach § 288 Abs. 5 BGB.' : '.'));
        }
        out.table.push(['Rechnungsbetrag', money(res.amount, cur)]);
        if (claim) {
          out.table.push(['Verzugszinsen ' + shortDate(res.start, c) + ' bis ' + shortDate(res.asOf, c) + ' (' + res.daysOverdue + ' Tage)', money(res.interest, cur)]);
          if (res.fixed) out.table.push(['Verzugspauschale (§ 288 Abs. 5 BGB)', money(res.fixed, cur)]);
        }
        out.table.push(['Gesamtbetrag', money(claim ? res.total : res.amount, cur)]);
        out.paras.push('Bitte überweisen Sie den Gesamtbetrag bis spätestens ' + shortDate(payBy, c) + ' auf das unten genannte Konto.' +
          (claim ? ' Ab dem ' + shortDate(addDays(res.asOf, 1), c) + ' laufen die Zinsen mit ' + money(res.perDay, cur) + ' pro Tag weiter.' : '') +
          ' Sollte die Zahlung bis dahin nicht eingehen, behalten wir uns weitere Schritte vor, etwa ein gerichtliches Mahnverfahren.');
      }
      out.closing = 'Mit freundlichen Grüßen';
      out.bankLabel = 'Bankverbindung';
    } else {
      var demand = kind === 'demand';
      out.subject = (demand ? (claim ? 'Overdue invoice and statutory interest: ' : 'Overdue invoice: ') : 'Payment reminder: ') + 'invoice ' + inv + (invDate ? ' dated ' + invDate : '');
      out.salutation = who ? 'Dear ' + who + ',' : 'Dear Sir or Madam,';
      if (!demand) {
        out.paras.push('This is a friendly reminder that invoice ' + inv + (invDate ? ' dated ' + invDate : '') + ' for ' + money(res.amount, cur) +
          ' was due for payment on ' + longDate(res.due, c) + '. We have not yet received payment.');
        out.paras.push('Please arrange payment by ' + longDate(payBy, c) + ' using the details below. If you have already paid, please ignore this letter, and thank you.');
        out.table.push(['Amount outstanding', money(res.amount, cur)]);
      } else {
        out.paras.push('Invoice ' + inv + (invDate ? ' dated ' + invDate : '') + ' for ' + money(res.amount, cur) + ' was due for payment on ' +
          longDate(res.due, c) + (res.overdue ? ' and is now ' + res.daysOverdue + ' days overdue.' : '.'));
        if (claim) {
          var s0 = res.segments[0];
          out.paras.push('Under the Late Payment of Commercial Debts (Interest) Act 1998 we are entitled to statutory interest at 8% over the Bank of England reference rate (' +
            pct(s0.base, c) + ' on ' + longDate(s0.refDate, c) + '), which is ' + pct(s0.rate, c) + ' a year, and to fixed compensation of ' + money(res.fixed, cur) + '.');
        }
        out.table.push(['Invoice amount', money(res.amount, cur)]);
        if (claim) {
          out.table.push(['Statutory interest ' + shortDate(res.start, c) + ' to ' + shortDate(res.asOf, c) + ' (' + res.daysOverdue + ' days)', money(res.interest, cur)]);
          out.table.push(['Fixed compensation (s. 5A of the Act)', money(res.fixed, cur)]);
        }
        out.table.push(['Total now due', money(claim ? res.total : res.amount, cur)]);
        out.paras.push('Please pay the total by ' + longDate(payBy, c) + '.' +
          (claim ? ' Interest continues to accrue at ' + money(res.perDay, cur) + ' per day until payment.' : '') +
          ' If payment is not received by then, we may take further steps to recover the debt without further notice.');
      }
      out.closing = !demand ? 'Kind regards,' : who ? 'Yours sincerely,' : 'Yours faithfully,';
      out.bankLabel = 'Payment details';
    }
    out.payBy = payBy;
    out.claim = claim;
    return out;
  }

  // Plain-text version of a letter (for copying into an email). The table goes before the last paragraph.
  function letterText(L, details) {
    var dt = details || {};
    var lines = [L.subject, '', L.salutation, ''];
    L.paras.forEach(function (p, idx) {
      lines.push(p, '');
      if (idx === Math.max(0, L.paras.length - 2) && L.table.length) {
        var w = Math.max.apply(null, L.table.map(function (r) { return r[0].length; }));
        L.table.forEach(function (r) { lines.push('  ' + r[0] + ' '.repeat(w - r[0].length + 2) + r[1]); });
        lines.push('');
      }
    });
    if (dt.bank) lines.push(L.bankLabel + ': ' + String(dt.bank).replace(/\s*\n\s*/g, ', '), '');
    lines.push(L.closing, '', dt.senderName || '');
    return lines.join('\n').replace(/\n+$/, '\n');
  }

  var API = {
    RATES: RATES, calculate: calculate, letter: letter, letterText: letterText,
    ukRate: ukRate, ukCompensation: ukCompensation, deBase: deBase, simpleInterest: simpleInterest,
    addDays: addDays, daysBetween: daysBetween, todayISO: todayISO, isISO: isISO, round2: round2,
    money: money, pct: pct, shortDate: shortDate, longDate: longDate,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.LatePayment = API;
})(this);
