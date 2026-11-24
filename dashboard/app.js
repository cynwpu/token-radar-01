/* Token Radar dashboard: renders the ranked board from window.RADAR (written by main.ts as data.js).
 *
 * The value model lives here too, on purpose: impliedValue() below is the same arithmetic the
 * board was ranked by (lib/model.ts, radar-2), recomputed in the browser from the raw snapshot
 * fields every row carries, so the page can show the work behind each number instead of asking
 * the reader to trust a list. A row whose recomputed value differs from the board's is marked.
 */
(function () {
  'use strict';

  var RADAR = window.RADAR;
  var MODEL = RADAR.model;
  var DAY_MS = 86400000;

  /* ---------- the model, mirrored ---------- */

  function median(xs) {
    if (!xs.length) return null;
    var s = xs.slice().sort(function (a, b) { return a - b; });
    var mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  /* The market's own price of TVL: median market cap per dollar of TVL, overall and by category. */
  function buildComparables(market) {
    var globalRatios = [];
    var byCat = {};
    market.forEach(function (m) {
      if (!(m.tvl_usd > 0 && m.mcap_usd > 0)) return;
      var ratio = m.mcap_usd / m.tvl_usd;
      if (!(ratio >= 0.005 && ratio <= 50)) return; // drop noise
      globalRatios.push(ratio);
      var key = m.category || '(uncategorised)';
      (byCat[key] = byCat[key] || []).push(ratio);
    });
    var cats = {};
    Object.keys(byCat).forEach(function (k) {
      cats[k] = { ratio: median(byCat[k]), count: byCat[k].length };
    });
    return { ratio_global: median(globalRatios) || 0.3, byCategory: cats };
  }

  function ageDays(asOf, listedAt) {
    if (!listedAt) return null;
    var a = Date.parse(asOf + 'T00:00:00Z');
    var b = Date.parse(listedAt + 'T00:00:00Z');
    if (!isFinite(a) || !isFinite(b)) return null;
    return Math.max(0, Math.floor((a - b) / DAY_MS));
  }

  /* implied = tvl x category ratio (shrunk to the market) x growth multiplier x maturity multiplier */
  function impliedValue(row, comps) {
    var cat = comps.byCategory[row.category || '(uncategorised)'];
    var n = cat ? cat.count : 0;
    var catRatio = cat ? cat.ratio : comps.ratio_global;
    var ratio = (catRatio * n + comps.ratio_global * MODEL.ratio_shrink) / (n + MODEL.ratio_shrink);
    var raw = typeof row.change_7d === 'number' ? row.change_7d : 0;
    var growthPct = Math.min(MODEL.growth_cap, Math.max(MODEL.growth_floor, raw));
    var growthMult = 1 + (growthPct / 100) * MODEL.growth_weight;
    var age = ageDays(RADAR.as_of, row.listed_at);
    var ageForModel = age === null ? MODEL.unknown_age_days : age;
    var maturityMult = MODEL.maturity_floor +
      (Math.min(Math.max(ageForModel, 0), MODEL.maturity_days) / MODEL.maturity_days) * MODEL.maturity_range;
    var base = row.tvl_usd * ratio;
    return {
      implied: Math.max(1, Math.round(base * growthMult * maturityMult)),
      ratio: ratio, comparables: n, base: base,
      growthPct: growthPct, growthMult: growthMult, maturityMult: maturityMult, age: age,
    };
  }

  /* ---------- formatting ---------- */

  function money(v) {
    if (v == null) return '—';
    var abs = Math.abs(v);
    if (abs >= 1e12) return '$' + (v / 1e12).toFixed(2) + 'T';
    if (abs >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(v);
  }
  function pct(v) {
    if (v == null) return '<span class="flat">—</span>';
    var cls = v > 0.0001 ? 'up' : v < -0.0001 ? 'down' : 'flat';
    var sign = v > 0 ? '+' : '';
    return '<span class="' + cls + '">' + sign + v.toFixed(1) + '%</span>';
  }
  function ageText(days) {
    if (days == null) return '—';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    if (days >= 30) return Math.round(days / 30) + 'mo';
    return days + 'd';
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function el(html) {
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  var COMPS = buildComparables(RADAR.market);

  /* ---------- state ---------- */

  var state = {
    view: 'radar',       // 'radar' | 'live'
    search: '',
    category: '',
    chain: '',
    watchOnly: false,
    sortKey: 'rank',
    sortDir: 1,
  };

  function categories() {
    var set = {};
    RADAR.rows.forEach(function (r) { set[r.category || '(uncategorised)'] = 1; });
    return Object.keys(set).sort();
  }
  function chains() {
    var set = {};
    RADAR.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { set[c] = 1; }); });
    return Object.keys(set).sort();
  }

  var WATCHLIST = {};
  RADAR.rows.forEach(function (r) { if (r.watchlist) WATCHLIST[r.slug] = 1; });

  /* ---------- header ---------- */

  function renderStats() {
    var box = document.getElementById('stats');
    box.innerHTML =
      '<span class="chip"><b>' + RADAR.rows.length + '</b>ranked</span>' +
      '<span class="chip watch"><b>' + RADAR.watchlist_size + '</b>watchlist</span>' +
      '<span class="chip"><b>' + RADAR.early_size + '</b>early finds</span>' +
      '<span class="chip"><b>' + RADAR.live_size + '</b>live tokens</span>' +
      '<span class="chip"><b>' + esc(RADAR.as_of) + '</b>snapshot</span>' +
      '<span class="chip"><b>' + esc(RADAR.model_version) + '</b>model</span>';
  }

  /* ---------- toolbar ---------- */

  function renderToolbar() {
    var bar = document.getElementById('toolbar');
    bar.innerHTML =
      '<div class="tabs">' +
      '  <button data-view="radar" class="' + (state.view === 'radar' ? 'on' : '') + '">Radar board</button>' +
      '  <button data-view="live" class="' + (state.view === 'live' ? 'on' : '') + '">Live tokens</button>' +
      '  <button data-view="model" class="' + (state.view === 'model' ? 'on' : '') + '">The model</button>' +
      '</div>' +
      '<input type="search" id="q" placeholder="Search name or slug…" value="' + esc(state.search) + '" aria-label="search">' +
      '<select id="fcat" aria-label="category"><option value="">All categories</option>' +
      categories().map(function (c) { return '<option' + (state.category === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') +
      '</select>' +
      '<select id="fchain" aria-label="chain"><option value="">All chains</option>' +
      chains().map(function (c) { return '<option' + (state.chain === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') +
      '</select>' +
      '<label class="check"><input type="checkbox" id="fwatch"' + (state.watchOnly ? ' checked' : '') + '> watchlist only</label>' +
      '<span class="count" id="count"></span>';
    bar.querySelectorAll('.tabs button').forEach(function (b) {
      b.addEventListener('click', function () { state.view = b.dataset.view; render(); });
    });
    bar.querySelector('#q').addEventListener('input', function (e) { state.search = e.target.value; renderBoard(); });
    bar.querySelector('#fcat').addEventListener('change', function (e) { state.category = e.target.value; renderBoard(); });
    bar.querySelector('#fchain').addEventListener('change', function (e) { state.chain = e.target.value; renderBoard(); });
    bar.querySelector('#fwatch').addEventListener('change', function (e) { state.watchOnly = e.target.checked; renderBoard(); });
  }

  /* ---------- filtering and sorting ---------- */

  function filteredRows() {
    var q = state.search.trim().toLowerCase();
    return RADAR.rows.filter(function (r) {
      if (state.watchOnly && !WATCHLIST[r.slug]) return false;
      if (state.category && (r.category || '(uncategorised)') !== state.category) return false;
      if (state.chain && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }

  var SORTS = {
    rank: function (a, b) { return a.rank - b.rank; },
    name: function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; },
    category: function (a, b) { return ('' + a.category).localeCompare('' + b.category); },
    tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
    change: function (a, b) { return (b.change_7d || 0) - (a.change_7d || 0); },
    age: function (a, b) { return (b.age_days || 0) - (a.age_days || 0); },
    implied: function (a, b) { return b.implied_value_usd - a.implied_value_usd; },
  };

  function sortedRows(rows) {
    var fn = SORTS[state.sortKey] || SORTS.rank;
    var out = rows.slice().sort(fn);
    if (state.sortDir < 0) out.reverse();
    return out;
  }

  /* ---------- the board ---------- */

  var COLUMNS = [
    ['rank', '#'],
    ['name', 'Protocol'],
    ['category', 'Category'],
    ['tvl', 'TVL'],
    ['change', '7d Δ'],
    ['age', 'Age'],
    ['implied', 'Implied value'],
  ];

  function renderBoard() {
    var main = document.getElementById('board');
    if (state.view === 'model') { renderModel(main); document.getElementById('count').textContent = ''; return; }
    if (state.view === 'live') { renderLive(main); return; }
    var rows = sortedRows(filteredRows());
    document.getElementById('count').textContent = rows.length + ' of ' + RADAR.rows.length + ' rows';
    if (!rows.length) { main.innerHTML = '<p class="empty">No protocol matches the current filters.</p>'; return; }
    var maxImplied = rows[0] ? rows.reduce(function (m, r) { return Math.max(m, r.implied_value_usd); }, 1) : 1;
    var head = COLUMNS.map(function (c) {
      var arrow = state.sortKey === c[0] ? '<span class="arrow">' + (state.sortDir > 0 ? '▲' : '▼') + '</span>' : '';
      var cls = c[0] === 'name' || c[0] === 'category' ? ' class="' + c[0] + '"' : '';
      return '<th data-key="' + c[0] + '"' + cls + '>' + c[1] + arrow + '</th>';
    }).join('');
    var body = rows.map(function (r) {
      var w = WATCHLIST[r.slug] ? '<span class="watchflag" title="on the snapshot watchlist">◆</span>' : '';
      var bar = Math.max(2, Math.round((r.implied_value_usd / maxImplied) * 100));
      return '<tr data-slug="' + esc(r.slug) + '"' + (r.rank <= 3 ? ' class="top3"' : '') + '>' +
        '<td class="rank">' + r.rank + '</td>' +
        '<td class="name">' + esc(r.name) + w + '<span class="slug">' + esc(r.slug) + ' · ' + esc((r.chains || []).join(', ') || '—') + '</span></td>' +
        '<td class="cat">' + esc(r.category || '—') + '</td>' +
        '<td>' + money(r.tvl_usd) + '</td>' +
        '<td>' + pct(r.change_7d) + '</td>' +
        '<td>' + ageText(r.age_days) + '</td>' +
        '<td><span class="mix" title="share of the board\'s top implied value"><i style="width:' + bar + '%"></i></span> ' + money(r.implied_value_usd) + '</td>' +
        '</tr>';
    }).join('');
    main.innerHTML = '<table class="board"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table>';
    main.querySelectorAll('th').forEach(function (th) {
      th.addEventListener('click', function () {
        var k = th.dataset.key;
        if (state.sortKey === k) state.sortDir = -state.sortDir;
        else { state.sortKey = k; state.sortDir = k === 'name' || k === 'category' || k === 'rank' ? 1 : -1; }
        if (state.sortKey === 'rank' && state.sortDir === 1) state.sortDir = 1;
        renderBoard();
      });
    });
    main.querySelectorAll('tbody tr').forEach(function (tr) {
      tr.addEventListener('click', function () { openDetail(tr.dataset.slug); });
    });
  }

  /* ---------- live tokens ---------- */

  function renderLive(main) {
    var rows = RADAR.live;
    document.getElementById('count').textContent = rows.length + ' token-listed protocols';
    var body = rows.map(function (r, i) {
      var ratio = r.tvl_usd > 0 ? (r.mcap_usd / r.tvl_usd) : null;
      return '<tr>' +
        '<td class="rank">' + (i + 1) + '</td>' +
        '<td class="name">' + esc(r.name) + '<span class="slug">' + esc(r.slug) + ' · ' + esc((r.chains || []).join(', ') || '—') + '</span></td>' +
        '<td class="cat">' + esc(r.category || '—') + '</td>' +
        '<td>' + money(r.tvl_usd) + '</td>' +
        '<td>' + pct(r.change_7d) + '</td>' +
        '<td>' + money(r.mcap_usd) + '</td>' +
        '<td>' + (ratio === null ? '—' : ratio.toFixed(2) + '×') + '</td>' +
        '</tr>';
    }).join('');
    main.innerHTML =
      '<div class="modelcard"><p>These protocols already trade, so no model prices them: the board shows the market\'s own ' +
      'capitalisation, and the last column is the market cap per dollar of TVL — the same ratio the radar\'s implied values are anchored to.</p></div>' +
      '<table class="board"><thead><tr><th>#</th><th class="name">Protocol</th><th class="cat">Category</th><th>TVL</th><th>7d Δ</th><th>Market cap</th><th>mcap / TVL</th></tr></thead><tbody>' +
      body + '</tbody></table>';
  }

  /* ---------- the model card ---------- */

  function renderModel(main) {
    var m = MODEL;
    var catRows = Object.keys(COMPS.byCategory).sort(function (a, b) {
      return COMPS.byCategory[b].count - COMPS.byCategory[a].count;
    }).slice(0, 12).map(function (k) {
      var c = COMPS.byCategory[k];
      return '<tr><td>' + esc(k) + '</td><td>' + c.count + '</td><td>' + c.ratio.toFixed(3) + '×</td></tr>';
    }).join('');
    main.innerHTML =
      '<div class="modelcard">' +
      '<h2>radar-2: implied value anchored to the market itself</h2>' +
      '<p>The snapshot\'s token-listed protocols are the comparables. Within each category their market caps trade at some ' +
      'ratio of TVL; a pre-token protocol inherits that ratio, shrunk toward the whole market\'s median (' + RADAR.ratio_global.toFixed(3) + '×) ' +
      'when the category has few comparables, then adjusted for momentum and maturity:</p>' +
      '<div class="formula">implied = TVL × ratio(category, shrink ' + m.ratio_shrink + ') ' +
      '× (1 + clamp(Δ7d, ' + m.growth_floor + '%, ' + m.growth_cap + '%) × ' + m.growth_weight + ') ' +
      '× (' + m.maturity_floor + ' + min(age, ' + m.maturity_days + 'd) / ' + m.maturity_days + ' × ' + m.maturity_range + ')</div>' +
      '<p>Every figure comes from the snapshot\'s own rows; no protocol name is special-cased anywhere. ' +
      'The same arithmetic ranks board.json (lib/model.ts) and recomputes every row live in this page (app.js, impliedValue).</p>' +
      '<table class="board" style="max-width:560px"><thead><tr><th class="name">Category</th><th>comparables</th><th>median mcap / TVL</th></tr></thead>' +
      '<tbody>' + catRows + '</tbody></table>' +
      '</div>';
  }

  /* ---------- the detail drawer ---------- */

  function openDetail(slug) {
    var r = RADAR.rows.find(function (x) { return x.slug === slug; });
    if (!r) return;
    var v = impliedValue(r, COMPS);
    var agree = v.implied === r.implied_value_usd;
    var steps = (r.farm_steps || []).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    var drawer = document.getElementById('detail');
    drawer.innerHTML =
      '<button class="close" aria-label="close">×</button>' +
      '<h2>' + esc(r.name) + (WATCHLIST[r.slug] ? ' <span class="watchflag">◆ watchlist</span>' : '') + '</h2>' +
      '<p class="sub">' + esc(r.slug) + ' · rank #' + r.rank + ' · ' + esc((r.chains || []).join(', ') || 'no chain listed') + '</p>' +
      '<div class="kv">' +
      '  <div><dt>implied value</dt><dd class="bigval">' + money(r.implied_value_usd) + '</dd></div>' +
      '  <div><dt>TVL</dt><dd>' + money(r.tvl_usd) + '</dd></div>' +
      '  <div><dt>7-day TVL change</dt><dd>' + pct(r.change_7d) + '</dd></div>' +
      '  <div><dt>tracked without a token</dt><dd>' + ageText(r.age_days) + '</dd></div>' +
      '  <div><dt>category</dt><dd>' + esc(r.category || '—') + '</dd></div>' +
      '  <div><dt>listed on DefiLlama since</dt><dd>' + esc(r.listed_at || '—') + '</dd></div>' +
      '</div>' +
      '<div class="breakdown"><h3>How the implied value is computed</h3><table>' +
      '<tr><td>TVL (snapshot)</td><td>' + money(r.tvl_usd) + '</td></tr>' +
      '<tr><td>× comparable ratio (' + v.comparables + ' listed in category, shrunk to ' + COMPS.ratio_global.toFixed(3) + '× market median)</td><td>' + v.ratio.toFixed(4) + '</td></tr>' +
      '<tr><td>= base value</td><td>' + money(v.base) + '</td></tr>' +
      '<tr><td>× momentum (Δ7d ' + (r.change_7d == null ? 'unreported, treated as 0' : r.change_7d.toFixed(1) + '%') + ')</td><td>' + v.growthMult.toFixed(4) + '</td></tr>' +
      '<tr><td>× maturity (' + (v.age === null ? 'unknown, assumed ' + MODEL.unknown_age_days + 'd' : v.age + ' days') + ')</td><td>' + v.maturityMult.toFixed(4) + '</td></tr>' +
      '<tr class="total"><td>implied value' + (agree ? ' (recomputed in this page, agrees with the board)' : ' (board: ' + money(r.implied_value_usd) + ')') + '</td><td>' + money(v.implied) + '</td></tr>' +
      '</table></div>' +
      '<div class="plan"><h3>Farm plan — concrete steps, costs and time</h3><ol>' + steps + '</ol></div>';
    drawer.hidden = false;
    document.getElementById('scrim').hidden = false;
    drawer.querySelector('.close').addEventListener('click', closeDetail);
  }

  function closeDetail() {
    document.getElementById('detail').hidden = true;
    document.getElementById('scrim').hidden = true;
  }

  /* ---------- footer ---------- */

  function renderFoot() {
    document.getElementById('foot').textContent =
      'Data: ' + RADAR.source + ', snapshot of ' + RADAR.as_of + '. ' +
      'Implied values are this entry\'s own model claim (radar-2), never a prediction that a token launches or advice to buy one. ' +
      'Built by an AI agent for make.fun\'s token launch radar bounty.';
  }

  /* ---------- boot ---------- */

  /* Deep links: #slug=<slug> opens a protocol's detail, #q/#cat/#chain/#watch preset the filters. */
  function applyHash() {
    var h = window.location.hash.replace(/^#/, '');
    if (!h) return;
    var params = {};
    h.split('&').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i > 0) params[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1));
    });
    if (params.q) state.search = params.q;
    if (params.cat) state.category = params.cat;
    if (params.chain) state.chain = params.chain;
    if (params.watch === '1') state.watchOnly = true;
    if (params.view === 'live' || params.view === 'model') state.view = params.view;
    if (params.slug) {
      var slug = params.slug;
      setTimeout(function () { openDetail(slug); }, 0);
    }
  }

  function render() {
    renderToolbar();
    renderBoard();
  }

  document.getElementById('scrim').addEventListener('click', closeDetail);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDetail(); });

  renderStats();
  applyHash();
  render();
  renderFoot();
  document.getElementById('board').setAttribute('aria-busy', 'false');
})();
