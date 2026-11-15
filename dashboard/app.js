// Token Radar, radar-2. It reads window.RADAR (written beside dashboard/
// by main.ts) and renders the ranked board, a filterable table, and a
// per-protocol detail drawer with the model's own inputs and the protocol's
// farm plan. No network: every byte it shows is in data.js.
//
// The page recomputes every row from the snapshot figures with the same
// arithmetic main.ts writes to board.json, so the page's code and the
// board's data are visibly the same model. No protocol name is special-cased.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null, watchOnly: false, minTvl: 0 };
  var WATCH = {};
  (DATA.watchlist || []).forEach(function (s) { WATCH[s] = true; });

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  // The category table, identical to lib/model.ts: wrapped, staked and
  // bridged products are discounted; token-plausible categories get a premium.
  var CAT_MULT = {
    'Bridge': 0.7, 'Canonical Bridge': 0.7, 'Cross Chain Bridge': 0.7,
    'Liquid Staking': 0.75, 'Liquid Restaking': 0.75, 'Restaked BTC': 0.75,
    'Restaking': 0.8, 'Staking Pool': 0.85, 'Stablecoin Wrapper': 0.75, 'CEX': 0.7,
    'Lending': 1.08, 'Dexs': 1.08, 'RWA': 1.08, 'Yield': 1.05, 'CDP': 1.05,
    'Risk Curators': 1.05, 'Onchain Capital Allocator': 1.05, 'Yield Aggregator': 1.03,
    'Derivatives': 1.03, 'Prediction Market': 1.05, 'Launchpad': 1.05,
    'Governance Incentives': 1.05, 'Collateral Markets': 1.05
  };
  function catMult(cat) { return cat === null || cat === undefined ? 1 : (CAT_MULT[cat] || 1); }
  function chainMult(n) { if (n >= 10) return 1.15; if (n >= 4) return 1.1; if (n >= 2) return 1.05; return 1; }

  // The model in one function: base x growth x maturity x chain x category.
  function impliedOf(row, model) {
    var unknown = row.change_7d === null || row.change_7d === undefined;
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, unknown ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    if (unknown) maturity = Math.min(maturity, model.growth_unknown_maturity_cap);
    var base = row.tvl_usd * model.base_multiple;
    return Math.max(1, Math.round(base * growthMult * maturity * chainMult((row.chains || []).length) * catMult(row.category)));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json:
  // category, chains, TVL and age decide the action, the capital, the hold
  // and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    if (c.indexOf('basis') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + "'s basis vault on " + chain + ' and keep the shares.';
    if (c.indexOf('launchpad') >= 0) return 'Commit $' + capital + ' of USDC to a ' + name + ' launch on ' + chain + ' and keep the allocation.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function secondActionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    var small = Math.max(10, Math.round(capital / 5));
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Borrow $' + small + ' against the supplied collateral, then repay it within the week so the account shows both sides of the market.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Swap $' + small + ' through ' + name + "'s main pool on " + chain + ' so the wallet records a trade as well as the liquidity position.';
    if (c.indexOf('bridge') >= 0) return 'Use the bridged funds in a second app on ' + chain + ' within a day, so the bridge is a transfer you used, not a balance you parked.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Check the receipt token's peg against the staked asset before the week ends, and record the rate in the farm log.";
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Close the hedge after a few days and record the funding paid, so the account shows a completed trade.';
    if (c.indexOf('prediction') >= 0) return 'Settle the first market position and withdraw the winnings to the same wallet, keeping the receipt.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return "Compare the vault's allocation on " + name + " with last week's and note any strategy change in the farm log.";
    if (c.indexOf('stable') >= 0) return 'Redeem a small part of the stable position back to USDC to confirm the redemption path works.';
    if (c.indexOf('rwa') >= 0) return "Read the issuer's latest attestation for the yield asset and note its date in the farm log.";
    if (c.indexOf('insurance') >= 0) return "Read the cover's terms for the event it insures and note the expiry date in the farm log.";
    return 'Make a second, different action in ' + name + ' on ' + chain + ', such as a swap or a vote, so the wallet shows more than one deposit.';
  }
  function riskFor(p) {
    var c = (p.category || '').toLowerCase();
    if (c.indexOf('bridge') >= 0) return 'Bridge risk: a bridge can delay or fail on the destination chain, and the bridged asset can trade below its peg while in transit; never bridge more than you can wait a week to recover.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Liquidation risk: a leveraged position can be liquidated in a fast move; keep the position small and the margin well above the liquidation price.';
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Liquidation risk: if the collateral\u2019s price falls, the position can be liquidated; keep any loan well below the maximum the protocol allows.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Slashing and depeg risk: the receipt token can trade below the staked asset, and the validator can be slashed; check the peg before you stake.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Impermanent-loss risk: providing liquidity can lose value against simply holding the assets when their prices move apart; check the pool\u2019s range first.';
    if (c.indexOf('rwa') >= 0) return 'Issuer and custody risk: the yield asset depends on its issuer and custodian; read the issuer\u2019s attestation before you mint, and never treat it as a bank deposit.';
    if (c.indexOf('stable') >= 0) return 'Depeg risk: the stable asset can trade below its peg; check its redemption path and reserves before you hold a large amount.';
    if (c.indexOf('insurance') >= 0) return 'Cover risk: a claim can be denied if the event falls outside the policy\u2019s terms; read the terms before you pay for cover.';
    return 'Smart-contract risk: the protocol\u2019s contracts can hold a bug; never deposit more than you can afford to lose, and never share a seed phrase with any site.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: secondActionFor(p, capital, chain), cost: 'about $2 of gas, on top of the $' + capital + ' position', time: '10 minutes' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page from the link it publishes and check whether this wallet is eligible.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: riskFor(p), cost: 'nothing to read, and it can save the whole position', time: '5 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('watch') === '1') state.watchOnly = true;
    if (params.get('minTvl')) state.minTvl = Number(params.get('minTvl')) || 0;
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.watchOnly) params.set('watch', '1');
    if (state.minTvl) params.set('minTvl', String(state.minTvl));
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.watchOnly && !WATCH[r.slug]) return false;
      if (r.tvl_usd < state.minTvl) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      // Age sorts with protocols of unknown age last, whichever direction.
      if (key === 'age') {
        var aNull = a.age_days === null || a.age_days === undefined;
        var bNull = b.age_days === null || b.age_days === undefined;
        if (aNull && bNull) return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
        if (aNull) return 1;
        if (bNull) return -1;
        if (a.age_days < b.age_days) return -state.dir;
        if (a.age_days > b.age_days) return state.dir;
        return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
      }
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  // 7-Day Movers: the week's biggest gainers and decliners by TVL change,
  // computed from the same rows the board ranks. Rows with no reported
  // seven-day change are skipped; nothing here is hand-picked.
  function movers() {
    var withGrowth = DATA.rows.filter(function (r) {
      return r.change_7d !== null && r.change_7d !== undefined && isFinite(r.change_7d);
    });
    var gainers = withGrowth.slice().sort(function (a, b) { return b.change_7d - a.change_7d; }).slice(0, 5);
    var decliners = withGrowth.slice().sort(function (a, b) { return a.change_7d - b.change_7d; }).slice(0, 5);
    return { gainers: gainers, decliners: decliners };
  }
  function moverRow(r) {
    var growthClass = r.change_7d >= 0 ? 'pos' : 'neg';
    return el('li', null,
      el('button', { type: 'button', class: 'mover', onclick: function () { openDetail(r.slug); } },
        el('span', { class: 'mover-rank num', text: '#' + r.rank }),
        el('span', { class: 'mover-name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: fmtUsd(r.tvl_usd) + ' TVL - ' + fmtUsd(r.implied_value_usd) + ' implied' })
        ),
        el('span', { class: 'num ' + growthClass, text: fmtPct(r.change_7d) })
      )
    );
  }
  function moversPanel() {
    var m = movers();
    return el('section', { class: 'panel movers', 'aria-label': 'Seven-day movers' },
      el('div', { class: 'movers-col' },
        el('h2', { text: 'Biggest 7-day gainers' }),
        el('p', { class: 'sub', text: 'TVL change over seven days, largest first. A fast rise can mean a launch is nearer — or a spike that fades.' }),
        el('ol', { class: 'mover-list' }, m.gainers.map(moverRow))
      ),
      el('div', { class: 'movers-col' },
        el('h2', { text: 'Biggest 7-day decliners' }),
        el('p', { class: 'sub', text: 'TVL change over seven days, largest fall first. A falling protocol can still launch, but its record is weakening.' }),
        el('ol', { class: 'mover-list' }, m.decliners.map(moverRow))
      )
    );
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { class: 'badge', text: 'Watchlist ' + DATA.watchlist_size + ' / ' + DATA.watchlist_size }),
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL that records no token. The early radar adds ' + DATA.early_size + ' rankable pre-token protocols the watchlist leaves out: every one below that floor the snapshot holds, plus the 14 largest above it that pass the watchlist\'s own exclusion rules. Implied value is a model, not a promise: it says what a launch would be worth if the record stayed as it is, not whether or when one comes.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows beyond the watchlist' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function sourceLine() {
    return el('p', { class: 'source-line', text: 'Source: ' + DATA.source + '. "Records no token" means the snapshot carries no market cap, CoinGecko id or symbol for the protocol; it is not proof it has none.' });
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSel = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    catSel.addEventListener('change', function () { state.category = catSel.value; writeHash(); render(); });
    var chainSel = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; writeHash(); render(); });
    var tvlSel = el('select', { id: 'minTvl', 'aria-label': 'Minimum TVL' },
      [[0, 'Any TVL'], [5e6, 'TVL $5M+'], [1e7, 'TVL $10M+'], [2.5e7, 'TVL $25M+'], [5e7, 'TVL $50M+'], [1e8, 'TVL $100M+'], [5e8, 'TVL $500M+']].map(function (o) {
        return el('option', { value: String(o[0]), text: o[1], selected: state.minTvl === o[0] ? 'selected' : null });
      })
    );
    tvlSel.addEventListener('change', function () { state.minTvl = Number(tvlSel.value) || 0; writeHash(); render(); });
    var sortSel = el('select', { id: 'sortBy', 'aria-label': 'Sort the board' },
      [['implied', 'Implied value'], ['tvl', 'TVL'], ['growth', '7d growth'], ['age', 'Age (oldest first)'], ['name', 'Name (A-Z)']].map(function (o) {
        return el('option', { value: o[0], text: o[1], selected: state.sort === o[0] ? 'selected' : null });
      })
    );
    sortSel.addEventListener('change', function () {
      state.sort = sortSel.value;
      state.dir = sortSel.value === 'name' ? 1 : -1;
      render();
    });
    var watchBox = el('input', { type: 'checkbox', id: 'watchOnly', checked: state.watchOnly ? 'checked' : null });
    watchBox.addEventListener('change', function () { state.watchOnly = watchBox.checked; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSel),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSel),
      el('div', { class: 'field' }, el('label', { for: 'minTvl', text: 'Min TVL' }), tvlSel),
      el('div', { class: 'field' }, el('label', { for: 'sortBy', text: 'Sort by' }), sortSel),
      el('label', { class: 'check', for: 'watchOnly' }, watchBox, 'Watchlist only'),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchOnly = false; state.minTvl = 0; writeHash(); render(); } })
      ));
    }
    var max = 1;
    list.forEach(function (r) { if (r.implied_value_usd > max) max = r.implied_value_usd; });
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') + (WATCH[r.slug] ? ' - watchlist' : '') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x ' + m.base_multiple + ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x chain(1.00 / 1.05 / 1.10 / 1.15) x category )'
      ),
      el('p', { class: 'sub', text: 'TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. When change_7d is unreported, growth is treated as 0 and the maturity multiplier is capped at ' + m.growth_unknown_maturity_cap + '. Chain counts 1 / 2-3 / 4-9 / 10+ chains multiply by 1.00 / 1.05 / 1.10 / 1.15. Category: Bridge, Canonical Bridge and Cross Chain Bridge 0.70; Liquid Staking, Liquid Restaking and Restaked BTC 0.75; Restaking 0.80; Staking Pool 0.85; Stablecoin Wrapper 0.75; Lending, Dexs and RWA 1.08; Yield, CDP, Risk Curators, Onchain Capital Allocator, Prediction Market, Launchpad, Governance Incentives and Collateral Markets 1.05; Yield Aggregator and Derivatives 1.03; everything else 1.00.' }),
      el('p', { class: 'sub', text: 'Wrapped, staked and bridged products are discounted because a token of theirs would be a claim on a token that already trades. The early radar is every rankable pre-token protocol below the watchlist floor, by TVL, plus the 14 largest above it that pass the watchlist\'s exclusion rules, and the live-token protocols are set aside with their market caps shown.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var recomputed = impliedOf(row, DATA.model);
    var m = DATA.model;
    var chainCount = (row.chains || []).length;
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (WATCH[row.slug] ? ' - watchlist' : ' - early radar') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + ' - records no token' })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Base (TVL x ' + m.base_multiple + ')' }), el('b', { class: 'num', text: fmtUsd(row.base_value_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) + (row.growth_unknown ? ' (unreported, treated as 0)' : '') })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(row.maturity_multiplier) + (row.growth_unknown ? ' (capped)' : '') })),
        el('div', null, el('span', { text: 'Chains (' + chainCount + ')' }), el('b', { class: 'num', text: 'x ' + String(row.chain_multiplier) })),
        el('div', null, el('span', { text: 'Category (' + (row.category || 'none') + ')' }), el('b', { class: 'num', text: 'x ' + String(row.category_multiplier) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price, and it does not say whether or when a token launches.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s, i) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        var item = el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
        if (i === 6) item.className = 'risk-step';
        return item;
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(sourceLine());
    shell.appendChild(controls());
    if (state.tab === 'pre-token') shell.appendChild(moversPanel());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
