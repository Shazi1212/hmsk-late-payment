# Late Payment Interest + Letter

A client has not paid and you want to know what you can claim: this works out the statutory late-payment interest and fixed compensation for the UK or Germany and writes the reminder letter for you.

**Use it free:** https://hmsk.life/tools/late-payment/

## What it does

- Input: unpaid amount, due date, business or consumer client, UK or German law.
- Output: days overdue, interest per rate period, fixed sums, total you can claim and interest per day from now.
- **UK:** 8% over the Bank of England reference rate (base rate on 30 June or 31 December before interest starts), fixed for the
  whole debt, plus fixed compensation of £40 / £70 / £100 (Late Payment of Commercial Debts (Interest) Act 1998). Business debts only.
  Mentions the Commercial Payments Bill (introduced in the House of Lords on 19 May 2026, not law yet).
- **Germany:** Verzugszinsen 9 percentage points over the Basiszinssatz for businesses, 5 for consumers (§ 288 BGB), split per
  half-year when the Basiszinssatz changes, plus the €40 Verzugspauschale for businesses (§ 288 Abs. 5 BGB).
- Letter: friendly reminder or formal demand (UK, English), Zahlungserinnerung or Mahnung (Germany, German). Print, save as PDF
  (browser print dialog) or copy as text.
- English and German UI (`?lang=de`). Nothing is sent to a server; your own details are kept in localStorage only if you tick "remember".

## Quick start

Static page, no build step, no dependencies.

```sh
python3 -m http.server 8080 --directory public   # then open http://localhost:8080
```

Or copy `public/` to any web server. Site links (tool page, imprint, invoice tool, contact form) point to `https://hmsk.life`;
change `siteBase` in `public/config.js` for your own copy.

## Rates

All figures and their sources are in `public/rates.js` (checked 19 October 2026: Bank Rate 3.75% since 18 December 2025,
Basiszinssatz 1.52% since 1 July 2026). When a rate changes, add a row there, update `checked`, run the tests.
Dates past the last published rate use the latest known rate and the result says it is provisional.

## Tests

The calculation and the letters live in `public/logic.js` (no DOM) and are tested with Node's built-in test runner (Node 20+):

```sh
node --test tests/
```

They cover the GOV.UK worked example, reference-rate selection around 30 June / 31 December, the £40/£70/£100 bands,
German half-year splits (including the negative Basiszinssatz in 2022), B2C rules, not-yet-overdue and invalid input,
and the content of every letter type.

Not legal advice.

## License

MIT, see [LICENSE](LICENSE). Fonts: Martian Mono and Geist (SIL Open Font License).
