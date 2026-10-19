/* Statutory late-payment figures for the UK and Germany, with sources.
   Checked against the official sources on 2026-10-19. When a rate changes, add a row here,
   update `checked`, and run the tests (node --test tests/).

   UK: Late Payment of Commercial Debts (Interest) Act 1998, s. 4 and 6, and the Late Payment of
   Commercial Debts (Rate of Interest) (No. 3) Order 2002: statutory interest is 8% over the
   "reference rate", i.e. the Bank of England base rate in force at close of business on 31 December
   (for interest that starts running 1 January to 30 June) or 30 June (for 1 July to 31 December).
   The rate is fixed for the whole debt by the date interest starts running.
   Fixed compensation (s. 5A): £40 below £1,000, £70 from £1,000 to £9,999.99, £100 from £10,000.
   Only for business-to-business debts; consumers are not covered by the Act.

   Germany: § 288 BGB: Verzugszinsen 5 percentage points over the Basiszinssatz (§ 247 BGB) when a
   consumer is involved, 9 points when no consumer is involved (Entgeltforderung); the Basiszinssatz
   changes on 1 January and 1 July, so the rate follows each half-year. § 288 Abs. 5 BGB: €40
   Pauschale when the debtor is not a consumer. */
(function (root) {
  'use strict';

  var RATES = {
    checked: '2026-10-19',

    uk: {
      margin: 8,
      // `from`: interest starting on or after this day uses `base`, the Bank Rate in force on `refDate`.
      // Bank Rate changes used: 16 Dec 2021 0.25, 16 Jun 2022 1.25, 15 Dec 2022 3.50, 22 Jun 2023 5.00,
      // 3 Aug 2023 5.25, 1 Aug 2024 5.00, 7 Nov 2024 4.75, 6 Feb 2025 4.50, 8 May 2025 4.25,
      // 7 Aug 2025 4.00, 18 Dec 2025 3.75 (held at 3.75 on 18 Jun, 30 Jul and 17 Sep 2026).
      periods: [
        { from: '2022-01-01', refDate: '2021-12-31', base: 0.25 },
        { from: '2022-07-01', refDate: '2022-06-30', base: 1.25 },
        { from: '2023-01-01', refDate: '2022-12-31', base: 3.5 },
        { from: '2023-07-01', refDate: '2023-06-30', base: 5.0 },
        { from: '2024-01-01', refDate: '2023-12-31', base: 5.25 },
        { from: '2024-07-01', refDate: '2024-06-30', base: 5.25 },
        { from: '2025-01-01', refDate: '2024-12-31', base: 4.75 },
        { from: '2025-07-01', refDate: '2025-06-30', base: 4.25 },
        { from: '2026-01-01', refDate: '2025-12-31', base: 3.75 },
        { from: '2026-07-01', refDate: '2026-06-30', base: 3.75 },
      ],
      knownUntil: '2026-12-31', // last day covered by a published reference rate
      currentBase: 3.75,
      currentBaseSince: '2025-12-18',
      // [upper bound (exclusive), amount]
      compensation: [[1000, 40], [10000, 70], [Infinity, 100]],
    },

    de: {
      marginB2B: 9,
      marginB2C: 5,
      pauschale: 40,
      // Basiszinssatz (§ 247 BGB) as published by the Deutsche Bundesbank, valid from `from`.
      periods: [
        { from: '2016-07-01', rate: -0.88 },
        { from: '2023-01-01', rate: 1.62 },
        { from: '2023-07-01', rate: 3.12 },
        { from: '2024-01-01', rate: 3.62 },
        { from: '2024-07-01', rate: 3.37 },
        { from: '2025-01-01', rate: 2.27 },
        { from: '2025-07-01', rate: 1.27 },
        { from: '2026-01-01', rate: 1.27 },
        { from: '2026-07-01', rate: 1.52 },
      ],
      knownUntil: '2026-12-31',
    },

    // Earliest due date the tool handles (older debts: check the rate tables yourself).
    minDue: '2022-01-01',

    sources: {
      uk: [
        ['Bank of England: Bank Rate (current rate, decisions)', 'https://www.bankofengland.co.uk/monetary-policy/the-interest-rate-bank-rate'],
        ['Bank of England: Bank Rate history', 'https://www.bankofengland.co.uk/boeapps/database/Bank-Rate.asp'],
        ['GOV.UK: Charging interest on a commercial debt', 'https://www.gov.uk/late-commercial-payments-interest-debt-recovery/charging-interest-commercial-debt'],
        ['GOV.UK: Claiming debt recovery costs (£40 / £70 / £100)', 'https://www.gov.uk/late-commercial-payments-interest-debt-recovery/claim-debt-recovery-costs'],
        ['Late Payment of Commercial Debts (Interest) Act 1998', 'https://www.legislation.gov.uk/ukpga/1998/20/contents'],
        ['UK Parliament: Commercial Payments Bill [HL] (introduced 19 May 2026)', 'https://bills.parliament.uk/bills/4128'],
      ],
      de: [
        ['Deutsche Bundesbank: Basiszinssatz nach § 247 BGB', 'https://www.bundesbank.de/de/bundesbank/organisation/agb-und-regelungen/basiszinssatz-607820'],
        ['§ 286 BGB: Verzug des Schuldners', 'https://www.gesetze-im-internet.de/bgb/__286.html'],
        ['§ 288 BGB: Verzugszinsen und sonstiger Verzugsschaden', 'https://www.gesetze-im-internet.de/bgb/__288.html'],
        ['§ 247 BGB: Basiszinssatz', 'https://www.gesetze-im-internet.de/bgb/__247.html'],
      ],
    },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = RATES;
  else root.LP_RATES = RATES;
})(this);
