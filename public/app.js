/* UI for the late-payment calculator. Logic in logic.js, rates in rates.js, texts in i18n.js. */
(function () {
  'use strict';
  var L = window.LatePayment;
  var R = window.LP_RATES;
  var I = window.LP_I18N;
  var CFG = window.LP_CONFIG || {};
  var SITE = CFG.siteBase || '';
  var KEY = 'hmsk-late-payment:v1';
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };

  var store = load();
  var lang = pickLang();
  var state = {
    country: store.country || (lang === 'de' ? 'de' : 'uk'),
    party: store.party || 'b2b',
    kind: store.kind || 'demand',
  };
  var payByTouched = false;
  var lastRes = null, lastLetter = null, lastDetails = null;

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
  }
  function save() {
    var keep = { uses: store.uses || 0, remember: !!store.remember, lang: lang };
    if (store.remember) {
      keep.country = state.country; keep.party = state.party; keep.kind = state.kind;
      keep.from = $('#dFrom').value; keep.bank = $('#dBank').value;
    }
    store = keep;
    try { localStorage.setItem(KEY, JSON.stringify(keep)); } catch (e) { /* private mode: fine */ }
  }
  function pickLang() {
    var q = new URLSearchParams(location.search).get('lang');
    if (q === 'de' || q === 'en') return q;
    if (store.lang === 'de' || store.lang === 'en') return store.lang;
    var nav = (navigator.languages && navigator.languages[0]) || navigator.language || 'en';
    return /^de\b/i.test(nav) ? 'de' : 'en';
  }
  function t(key, vars) {
    var s = I[lang][key];
    if (s === undefined) s = I.en[key];
    if (vars) Object.keys(vars).forEach(function (k) { s = s.split('{' + k + '}').join(vars[k]); });
    return s;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function fmtDate(iso) {
    var p = iso.split('-');
    return new Intl.DateTimeFormat(t('locale'), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])));
  }
  function money(x, cur) { return new Intl.NumberFormat(t('locale'), { style: 'currency', currency: cur }).format(x); }
  function pctUI(x) { return new Intl.NumberFormat(t('locale'), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x) + (lang === 'de' ? ' %' : '%'); }
  function link(href) { return SITE + href; }

  // "1.250,50", "1,250.50", "1250.5", "1250,5" -> 1250.5
  function parseAmount(s) {
    s = String(s || '').replace(/[\s£€]/g, '');
    if (!s) return NaN;
    var lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
    var dec = lastDot > lastComma ? '.' : ',';
    if (lastDot === -1 && lastComma === -1) dec = null;
    if (dec) {
      var idx = s.lastIndexOf(dec);
      var frac = s.slice(idx + 1);
      // a single separator followed by exactly three digits is a thousands separator ("1.250")
      if ((dec === '.' ? lastComma : lastDot) === -1 && frac.length === 3 && s.indexOf(dec) === idx) {
        s = s.replace(dec === '.' ? /\./g : /,/g, '');
      } else {
        s = s.slice(0, idx).replace(/[.,]/g, '') + '.' + frac;
      }
    }
    return /^\d+(\.\d+)?$/.test(s) ? parseFloat(s) : NaN;
  }

  // ---------- static texts ----------
  function applyLang() {
    document.documentElement.lang = lang;
    document.title = t('title');
    $$('[data-i18n]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
    $$('.lang button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-lang') === lang)); });
    $('#lnkHome').href = link(t('home_href'));
    $('#lnkImprint').href = link(t('imprint_href'));
    $('#lnkImprint').textContent = t('imprint');
    $('#lnkPrivacy').href = link(t('privacy_href'));
    $('#lnkPrivacy').textContent = t('privacy');
    $('#lnkInvoice').href = link(t('invoice_href'));
    var de = R.de.periods[R.de.periods.length - 1];
    $('#asOfLine').textContent = t('as_of', {
      d: fmtDate(R.checked), uk: pctUI(R.uk.currentBase), ukd: fmtDate(R.uk.currentBaseSince),
      de: pctUI(de.rate), ded: fmtDate(de.from),
    });
    $('#noteLine').textContent = t('note', { d: fmtDate(R.checked) });
  }
  function renderSources() {
    var list = state.country === 'de' ? R.sources.de.concat(R.sources.uk) : R.sources.uk.concat(R.sources.de);
    $('#sourcesList').innerHTML = list.map(function (s) {
      return '<li><a href="' + esc(s[1]) + '" rel="noopener" target="_blank">' + esc(s[0]) + '</a><span class="src-url">' + esc(s[1]) + '</span></li>';
    }).join('');
  }

  // ---------- inputs ----------
  function input() {
    return { country: state.country, party: state.party, amount: parseAmount($('#amount').value), due: $('#due').value, asOf: $('#asOf').value };
  }
  function syncRadios() {
    $$('input[name=country]').forEach(function (i) { i.checked = i.value === state.country; });
    $$('input[name=party]').forEach(function (i) { i.checked = i.value === state.party; });
    $$('input[name=kind]').forEach(function (i) { i.checked = i.value === state.kind; });
    $('#curSym').textContent = state.country === 'uk' ? '£' : '€';
    $('#amount').placeholder = lang === 'de' ? '1250,00' : '1250.00';
  }

  // ---------- result ----------
  function render() {
    var inp = input();
    var touchedAmount = $('#amount').value.trim() !== '';
    $('#errAmount').hidden = !touchedAmount || (isFinite(inp.amount) && inp.amount > 0);
    var res = L.calculate(inp);
    var body = $('#resultBody');
    var errDue = $('#errDue');
    errDue.hidden = true;
    lastRes = null;

    if (!res.ok) {
      if (res.error === 'tooOld') { errDue.textContent = t('e_tooOld'); errDue.hidden = false; }
      body.innerHTML = '<p class="dim">' + esc(t('r_empty')) + '</p>' + rulesHtml(inp.country, inp.party);
      $('#letterPanel').hidden = true;
      return;
    }
    lastRes = res;
    var cur = res.currency, h = [];
    if (!res.overdue) {
      h.push('<p class="verdict verdict--calm">' + esc(t('r_notdue', { date: fmtDate(res.due) })) + '</p>');
    } else {
      h.push('<p class="verdict">' + esc(t('r_days', { n: res.daysOverdue })) + ' <span class="dim">' + esc(t('r_since', { date: fmtDate(res.start) })) + '</span></p>');
      h.push('<dl class="sum">');
      h.push(row(t('l_amount'), money(res.amount, cur)));
      if (res.statutory) {
        h.push(row(t('l_interest'), money(res.interest, cur)));
        if (res.fixed) h.push(row(res.country === 'uk' ? t('l_fixed_uk') : t('l_fixed_de'), money(res.fixed, cur)));
        h.push(row(t('l_total'), money(res.total, cur), true));
        h.push(row(t('l_perday'), money(res.perDay, cur)));
      }
      h.push('</dl>');
      if (res.statutory) {
        h.push('<table class="segs"><thead><tr><th>' + esc(t('l_period')) + '</th><th>' + esc(t('l_days')) + '</th><th>' + esc(t('l_rate')) + '</th><th class="num">' + esc(t('l_interest')) + '</th></tr></thead><tbody>');
        res.segments.forEach(function (s) {
          var base = res.country === 'uk' ? t('l_base_uk', { b: pctUI(s.base), d: fmtDate(s.refDate) }) : t('l_base_de', { b: pctUI(s.base) });
          h.push('<tr><td>' + esc(fmtShort(s.from)) + ' &ndash; ' + esc(fmtShort(s.to)) + '</td><td>' + s.days + '</td><td>' + esc(pctUI(s.rate)) +
            '<span class="small-b">' + esc(base) + '</span></td><td class="num">' + esc(money(s.interest, cur)) + '</td></tr>');
        });
        h.push('</tbody></table>');
      }
      if (res.provisional) h.push('<p class="warn">' + esc(t('prov', { d: fmtDate(res.country === 'uk' ? R.uk.knownUntil : R.de.knownUntil) })) + '</p>');
    }
    h.push(rulesHtml(res.country, res.party));
    body.innerHTML = h.join('');
    $('#letterPanel').hidden = false;
    renderLetter();
  }
  function fmtShort(iso) {
    var p = iso.split('-');
    return lang === 'de' ? p[2] + '.' + p[1] + '.' + p[0] : p[2] + '/' + p[1] + '/' + p[0];
  }
  function row(k, v, strong) {
    return '<div class="sum__row' + (strong ? ' sum__row--total' : '') + '"><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>';
  }
  function rulesHtml(country, party) {
    var h = [];
    if (country === 'uk') {
      h.push('<p class="rule">' + esc(party === 'b2c' ? t('uk_b2c') : t('uk_rule')) + '</p>');
      h.push('<p class="rule rule--news">' + esc(t('bill')) + '</p>');
    } else if (country === 'de') {
      h.push('<p class="rule">' + esc(party === 'b2c' ? t('de_rule_b2c') : t('de_rule_b2b')) + '</p>');
      if (party === 'b2c') h.push('<p class="rule">' + esc(t('de_b2c_warn')) + '</p>');
    }
    return h.join('');
  }

  // ---------- letter ----------
  function details() {
    var to = $('#dTo').value.trim();
    return {
      invoiceNo: $('#dInv').value.trim(), invoiceDate: $('#dInvDate').value, payBy: $('#dPayBy').value,
      recipientName: $('#dAttn').value.trim(), senderName: $('#dFrom').value.trim().split('\n')[0] || '',
      bank: $('#dBank').value.trim(), from: $('#dFrom').value.trim(), to: to,
    };
  }
  function renderLetter() {
    var res = lastRes;
    if (!res) return;
    var uk = res.country === 'uk';
    $('#kindReminder').textContent = uk ? t('k_rem_uk') : t('k_rem_de');
    $('#kindDemand').textContent = uk ? (res.party === 'b2c' ? t('k_dem_uk_b2c') : t('k_dem_uk')) : t('k_dem_de');
    $('#letterLangNote').textContent = uk ? t('letter_lang_uk') : t('letter_lang_de');
    var d = details();
    if (!payByTouched) d.payBy = '';
    var lt = L.letter(res, d, state.kind);
    if (!payByTouched) $('#dPayBy').value = lt.payBy;
    lastLetter = lt; lastDetails = d;
    var c = res.country;
    var h = [];
    h.push('<div class="paper__from">' + nl(d.from || (c === 'de' ? '[Ihr Name, Ihre Anschrift]' : '[Your name and address]')) + '</div>');
    h.push('<div class="paper__to">' + nl(d.to || (c === 'de' ? '[Name und Anschrift des Kunden]' : '[Client name and address]')) + '</div>');
    h.push('<p class="paper__date">' + esc(c === 'de' ? L.shortDate(res.asOf, c) : L.longDate(res.asOf, c)) + '</p>');
    h.push('<p class="paper__subj">' + esc(lt.subject) + '</p>');
    h.push('<p>' + esc(lt.salutation) + '</p>');
    lt.paras.forEach(function (p, i) {
      h.push('<p>' + esc(p) + '</p>');
      if (i === Math.max(0, lt.paras.length - 2) && lt.table.length) {
        h.push('<table class="paper__tbl">' + lt.table.map(function (r, j) {
          return '<tr' + (j === lt.table.length - 1 && lt.table.length > 1 ? ' class="tot"' : '') + '><td>' + esc(r[0]) + '</td><td class="num">' + esc(r[1]) + '</td></tr>';
        }).join('') + '</table>');
      }
    });
    if (d.bank) h.push('<p class="paper__bank"><b>' + esc(lt.bankLabel) + ':</b><br>' + nl(d.bank) + '</p>');
    h.push('<p class="paper__close">' + esc(lt.closing) + '</p>');
    h.push('<p class="paper__sign">' + esc(d.senderName || '') + '</p>');
    var paper = $('#paper');
    paper.innerHTML = h.join('');
    paper.lang = lt.lang;
  }
  function nl(s) { return esc(s).replace(/\n/g, '<br>'); }

  function countUse() {
    store.uses = (store.uses || 0) + 1;
    save();
    // email moment from the second letter on, never before the first one
    if (store.uses >= 2) {
      $('#moment').innerHTML = '<div class="moment"><p><b>' + esc(t('m_title')) + '</b> ' + esc(t('m_text')) + '</p>' +
        '<a href="' + esc(link(t('contact_href'))) + '">' + esc(t('m_link')) + ' &rarr;</a></div>';
    }
  }

  // ---------- events ----------
  function onAny(e) {
    var el = e.target;
    if (el.name === 'country') { state.country = el.value; syncRadios(); renderSources(); }
    if (el.name === 'party') state.party = el.value;
    if (el.name === 'kind') { state.kind = el.value; payByTouched = false; }
    if (el.id === 'dPayBy') payByTouched = !!el.value;
    if (el.id === 'remember') store.remember = el.checked;
    if (el.id === 'asOf') payByTouched = false;
    render();
    save();
  }
  document.addEventListener('input', onAny);
  document.addEventListener('change', onAny);

  $$('.lang button').forEach(function (b) {
    b.addEventListener('click', function () {
      lang = b.getAttribute('data-lang');
      var u = new URL(location.href);
      u.searchParams.set('lang', lang);
      history.replaceState(null, '', u);
      applyLang(); syncRadios(); render(); save();
    });
  });
  $('#printBtn').addEventListener('click', function () { if (lastLetter) { countUse(); window.print(); } });
  $('#copyBtn').addEventListener('click', function () {
    if (!lastLetter) return;
    var txt = [lastDetails.from, '', lastDetails.to, '', lastRes.country === 'de' ? L.shortDate(lastRes.asOf, 'de') : L.longDate(lastRes.asOf, 'uk'), '', L.letterText(lastLetter, lastDetails)].join('\n');
    var msg = $('#copyMsg');
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject())
      .then(function () { msg.textContent = t('copied'); countUse(); }, function () { msg.textContent = t('copy_fail'); });
  });
  $('#forgetBtn').addEventListener('click', function () {
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    store = {};
    $('#remember').checked = false;
    ['#dFrom', '#dBank'].forEach(function (s) { $(s).value = ''; });
    $('#copyMsg').textContent = t('forgot');
    render();
  });

  // ---------- start ----------
  $('#asOf').value = L.todayISO();
  $('#remember').checked = !!store.remember;
  if (store.remember) { $('#dFrom').value = store.from || ''; $('#dBank').value = store.bank || ''; }
  applyLang();
  syncRadios();
  renderSources();
  render();
})();
