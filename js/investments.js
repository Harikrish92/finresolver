/* ============================================================
   investments.js — Investment Tracker
   FinResolver · finresolver.in

   Uses Yahoo Finance via allorigins CORS proxy for live quotes.
   News via RSS-to-JSON proxy (rss2json.com free tier).
   Financials via Yahoo Finance query2 API.
   ============================================================ */

/* ══════════════════════════════════════════════════════════
   STATE
══════════════════════════════════════════════════════════ */
var investmentsData   = [];       // persisted holdings
var invQuoteCache     = {};       // { ticker: { price, change, changePct, name, ts } }
var invSelectedId     = null;     // currently highlighted row
var invActiveCat      = 'ALL';    // tab filter
var invDetailTab      = 'chart';  // chart | financials | news
var invSortCol        = 'value';
var invSortAsc        = false;
var invPriceChartInst = null;
var invAllocChartInst = null;
var invRefreshTimer   = null;
var invLiveEnabled    = true;   // persisted in localStorage
var invEditId         = null;     // null = new, string = editing

/* ══════════════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════════════ */
function fmtI(n)      { return '₹' + Math.round(Number(n)).toLocaleString('en-IN'); }
function fmtI2(n)     { return '₹' + Number(n).toLocaleString('en-IN', {minimumFractionDigits:2,maximumFractionDigits:2}); }
function fmtIPct(n)   { return (n >= 0 ? '+' : '') + Number(n).toFixed(2) + '%'; }
/* Safe accessors for live quote fields — guard against undefined/NaN */
function qPrice(q)    { var v = q && q.price;     return (v != null && isFinite(v)) ? v : 0; }
function qChgPct(q)   { var v = q && q.changePct; return (v != null && isFinite(v)) ? v : 0; }
function fmtICr(n)    {
  var abs = Math.abs(n);
  if (abs >= 1e7)  return (n/1e7).toFixed(2) + ' Cr';
  if (abs >= 1e5)  return (n/1e5).toFixed(2) + ' L';
  return Math.round(n).toLocaleString('en-IN');
}
function invEsc(s)    { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function invId()      { return 'inv_' + Date.now() + '_' + Math.random().toString(36).slice(2,7); }
function invNow()     { return Date.now(); }

var CAT_META = {
  Stock:       { label:'Stock',       class:'cat-stock',      color:'#00e5a0', icon:'📈' },
  MF:          { label:'Mutual Fund', class:'cat-mf',         color:'#4dabf7', icon:'🏦' },
  Bond:        { label:'Bond/FD',     class:'cat-bond',       color:'#ffd166', icon:'📄' },
  FD:          { label:'FD',          class:'cat-bond',       color:'#ffd166', icon:'🏧' },
  RealEstate:  { label:'Real Estate', class:'cat-realestate', color:'#a78bfa', icon:'🏠' },
  Others:      { label:'Others',      class:'cat-others',     color:'#ff6b6b', icon:'💼' },
};

/* ══════════════════════════════════════════════════════════
   STORAGE
══════════════════════════════════════════════════════════ */
function getInvKey() {
  var uid = (typeof fbAuth !== 'undefined' && fbAuth && fbAuth.currentUser && fbAuth.currentUser.uid)
    ? fbAuth.currentUser.uid
    : (typeof currentUser !== 'undefined' && currentUser && currentUser.uid ? currentUser.uid : 'guest');
  return 'fr_investments_' + uid;
}

function loadInvestments() {
  var raw = localStorage.getItem(getInvKey());
  investmentsData = raw ? JSON.parse(raw) : [];
}

function saveInvestments() {
  localStorage.setItem(getInvKey(), JSON.stringify(investmentsData));
  invSyncSave();
}

function invSyncSave() {
  if (typeof syncReady === 'undefined' || !syncReady || typeof db === 'undefined' || !db) return;
  var uid = (typeof fbAuth !== 'undefined' && fbAuth && fbAuth.currentUser)
    ? fbAuth.currentUser.uid : null;
  if (!uid) return;
  db.collection('users').doc(uid).collection('config').doc('investments')
    .set({ investments: investmentsData })
    .catch(function(e){ console.warn('[Inv] Firestore save failed:', e.message); });
}

function invSyncLoad() {
  if (typeof syncReady === 'undefined' || !syncReady || typeof db === 'undefined' || !db) return Promise.resolve();
  var uid = (typeof fbAuth !== 'undefined' && fbAuth && fbAuth.currentUser)
    ? fbAuth.currentUser.uid : null;
  if (!uid) return Promise.resolve();
  return db.collection('users').doc(uid).collection('config').doc('investments').get()
    .then(function(snap) {
      if (snap.exists && Array.isArray(snap.data().investments)) {
        investmentsData = snap.data().investments;
        localStorage.setItem(getInvKey(), JSON.stringify(investmentsData));
        console.info('[Inv] ✅ Loaded from Firestore:', investmentsData.length, 'holdings');
      }
    })
    .catch(function(e) { console.warn('[Inv] Firestore load failed:', e.message); });
}

/* ══════════════════════════════════════════════════════════
   NAVIGATION
══════════════════════════════════════════════════════════ */
function goToInvestments() {
  document.getElementById('homeScreen').style.display        = 'none';
  document.getElementById('appMain').style.display           = 'none';
  document.getElementById('loanScreen').style.display        = 'none';
  document.getElementById('loanDetailScreen').style.display  = 'none';
  document.getElementById('investmentScreen').style.display  = 'block';
  document.getElementById('btnBackHome').style.display       = 'flex';
  var tc = document.getElementById('headerTrackerControls');
  if (tc) tc.style.display = 'none';

  loadInvestments();
  invLoadLivePref();
  _updateLiveToggleUI();
  renderInvSummary();
  renderInvTabs();
  renderInvTable();
  renderInvAlloc();
  renderInvLivePanel();
  invHideDetail();
  invStartAutoRefresh();
}

function invGoHome() {
  invStopAutoRefresh();
  document.getElementById('investmentScreen').style.display = 'none';
  if (typeof goToHome === 'function') goToHome();
}

/* ══════════════════════════════════════════════════════════
   PROXY FETCH — tries multiple CORS proxies in sequence
   Each proxy has a 6s timeout; on failure the next is tried.
   Proxies are tried in priority order — fastest/most reliable first.
══════════════════════════════════════════════════════════ */

/* Each wrapper function takes a target URL and returns the
   parsed JSON contents (the actual Yahoo Finance response). */
var INV_PROXIES = [
  /* 1. corsproxy.io — reliable, no rate limit on free tier */
  function(url) {
    var proxyUrl = 'https://corsproxy.io/?' + encodeURIComponent(url);
    return invTimedFetch(proxyUrl, 6000)
      .then(function(r) { return r.json(); });
    /* corsproxy.io returns the raw response directly — no wrapper */
  },
  /* 2. api.codetabs.com — solid fallback */
  function(url) {
    var proxyUrl = 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(url);
    return invTimedFetch(proxyUrl, 6000)
      .then(function(r) { return r.json(); });
  },
  /* 3. allorigins.win — original, kept as last resort */
  function(url) {
    var proxyUrl = 'https://api.allorigins.win/get?url=' + encodeURIComponent(url);
    return invTimedFetch(proxyUrl, 8000)
      .then(function(r) { return r.json(); })
      .then(function(wrapper) { return JSON.parse(wrapper.contents); });
  },
];

/* Fetch with a hard timeout */
function invTimedFetch(url, ms) {
  return new Promise(function(resolve, reject) {
    var timer = setTimeout(function() { reject(new Error('timeout')); }, ms);
    fetch(url)
      .then(function(r) { clearTimeout(timer); resolve(r); })
      .catch(function(e) { clearTimeout(timer); reject(e); });
  });
}

/* Try each proxy in order; resolve with first success */
function invProxyFetch(yahooUrl) {
  var proxies = INV_PROXIES.slice(); // copy so we can shift off

  function tryNext(remaining) {
    if (!remaining.length) return Promise.reject(new Error('All proxies failed'));
    var proxy = remaining[0];
    var rest  = remaining.slice(1);
    return proxy(yahooUrl).then(function(data) {
      /* Validate: Yahoo Finance responses always have chart or quoteSummary */
      if (!data || (typeof data === 'object' && data.error)) throw new Error('bad response');
      return data;
    }).catch(function(err) {
      console.warn('[InvProxy] failed, trying next:', err.message);
      return tryNext(rest);
    });
  }

  return tryNext(proxies);
}

/* ══════════════════════════════════════════════════════════
   LIVE QUOTE — Yahoo Finance with proxy fallback chain
══════════════════════════════════════════════════════════ */
function invFetchQuote(ticker) {
  var url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(ticker)
            + '?interval=1d&range=1d';
  return invProxyFetch(url)
    .then(function(data) {
      var result = data && data.chart && data.chart.result && data.chart.result[0];
      if (!result) throw new Error('no result for ' + ticker);
      var meta      = result.meta;
      var price     = parseFloat(meta.regularMarketPrice || meta.previousClose || 0);
      var prevClose = parseFloat(meta.chartPreviousClose  || meta.previousClose || price);
      if (!isFinite(price) || price <= 0) throw new Error('bad price for ' + ticker);
      var change    = price - prevClose;
      var changePct = prevClose ? (change / prevClose) * 100 : 0;
      return {
        ticker:    ticker,
        name:      meta.shortName || meta.longName || meta.symbol || ticker,
        price:     price,
        change:    isFinite(change)    ? change    : 0,
        changePct: isFinite(changePct) ? changePct : 0,
        currency:  meta.currency || 'INR',
        ts:        Date.now(),
      };
    });
}

function invFetchAllQuotes() {
  var tickers = [];
  investmentsData.forEach(function(h) {
    if ((h.category === 'Stock' || h.category === 'MF') && h.ticker) {
      if (tickers.indexOf(h.ticker) === -1) tickers.push(h.ticker);
    }
  });
  if (!tickers.length) return Promise.resolve();

  /* Fetch in batches of 5 with 400ms between batches to avoid proxy
     rate-limiting when the portfolio has many tickers (e.g. 34 stocks) */
  var BATCH = 5, DELAY = 400;
  var batches = [];
  for (var i = 0; i < tickers.length; i += BATCH) {
    batches.push(tickers.slice(i, i + BATCH));
  }

  function runBatch(idx) {
    if (idx >= batches.length) return Promise.resolve();
    var batch = batches[idx];
    return Promise.allSettled(batch.map(function(t) {
      return invFetchQuote(t).then(function(q) { invQuoteCache[t] = q; });
    })).then(function() {
      /* Render after each batch so prices appear progressively */
      renderInvTable();
      renderInvSummary();
      renderInvLivePanel();
      if (idx + 1 < batches.length) {
        return new Promise(function(resolve) {
          setTimeout(function() { runBatch(idx + 1).then(resolve); }, DELAY);
        });
      }
    });
  }

  return runBatch(0);
}

function invRefreshQuotes() {
  var btn = document.getElementById('invRefreshBtn');
  if (btn) { btn.textContent = '⟳ Refreshing…'; btn.disabled = true; }
  invFetchAllQuotes().then(function(){
    renderInvTable();
    renderInvSummary();
    renderInvLivePanel();
    if (invSelectedId) {
      var h = investmentsData.find(function(x){ return x.id === invSelectedId; });
      if (h) invSetDetailTab(invDetailTab, h);
    }
    if (btn) { btn.textContent = '⟳ Refresh Live Prices'; btn.disabled = false; }
  }).catch(function(){
    if (btn) { btn.textContent = '⟳ Refresh Live Prices'; btn.disabled = false; }
  });
}

function invStartAutoRefresh() {
  invStopAutoRefresh();
  if (!invLiveEnabled) return;
  invFetchAllQuotes().then(function(){ renderInvTable(); renderInvSummary(); renderInvLivePanel(); });
  invRefreshTimer = setInterval(function(){
    if (!invLiveEnabled) { invStopAutoRefresh(); return; }
    invFetchAllQuotes().then(function(){ renderInvTable(); renderInvSummary(); renderInvLivePanel(); });
  }, 60000);
}
function invStopAutoRefresh() {
  if (invRefreshTimer) { clearInterval(invRefreshTimer); invRefreshTimer = null; }
}

/* Toggle live tracking on/off — persisted across sessions */
function invToggleLive() {
  invLiveEnabled = !invLiveEnabled;
  localStorage.setItem('fr_inv_live', invLiveEnabled ? '1' : '0');
  _updateLiveToggleUI();
  if (invLiveEnabled) {
    invStartAutoRefresh();
    showInvToast('Live tracking enabled — refreshing prices', 'success');
  } else {
    invStopAutoRefresh();
    showInvToast('Live tracking paused', 'success');
  }
}

function _updateLiveToggleUI() {
  var btn   = document.getElementById('invLiveToggleBtn');
  var dot   = document.getElementById('invLiveDot');
  var label = document.getElementById('invLiveLabel');
  var card  = document.getElementById('invSumLiveStatus');

  if (invLiveEnabled) {
    if (btn)   { btn.style.borderColor = 'rgba(0,229,160,.4)'; btn.style.color = 'var(--accent)'; btn.title = 'Pause live tracking'; }
    if (dot)   dot.style.display = 'inline-block';
    if (label) label.textContent = 'Live';
    if (card)  card.innerHTML = '<span class="inv-live-dot"></span> Active';
  } else {
    if (btn)   { btn.style.borderColor = 'var(--border)'; btn.style.color = 'var(--muted)'; btn.title = 'Enable live tracking'; }
    if (dot)   dot.style.display = 'none';
    if (label) label.textContent = 'Paused';
    if (card)  card.innerHTML = '⏸ Paused';
  }
}

function invLoadLivePref() {
  var stored = localStorage.getItem('fr_inv_live');
  invLiveEnabled = stored !== '0'; /* default ON */
}

/* ══════════════════════════════════════════════════════════
   SUMMARY STRIP
══════════════════════════════════════════════════════════ */
function calcInvTotals() {
  var invested = 0, currentVal = 0;
  investmentsData.forEach(function(h){
    var qty      = h.qty      || 0;
    var avgPrice = h.avgPrice || 0;
    var costBasis = qty * avgPrice;
    invested += costBasis;
    var q = (h.category === 'Stock' || h.category === 'MF') && h.ticker && invQuoteCache[h.ticker];
    currentVal += q ? qPrice(q) * qty : (costBasis || 0);
  });
  var pnl    = currentVal - invested;
  var pnlPct = invested > 0 ? (pnl / invested) * 100 : 0;
  return { invested: invested, currentVal: currentVal, pnl: pnl, pnlPct: pnlPct };
}

function renderInvSummary() {
  var t = calcInvTotals();
  var pos = t.pnl >= 0;

  var holdings = investmentsData.length;
  var liveCount = investmentsData.filter(function(h){
    return (h.category === 'Stock' || h.category === 'MF') && h.ticker;
  }).length;

  function setEl(id, val) { var el = document.getElementById(id); if (el) el.innerHTML = val; }

  setEl('invSumInvested',    fmtI(t.invested));
  setEl('invSumCurrent',     fmtI(t.currentVal));
  setEl('invSumPnL',         (pos?'<span class="inv-change-pos">':' <span class="inv-change-neg">') + fmtI(Math.abs(t.pnl)) + '</span>');
  setEl('invSumPnLPct',      (pos?'<span class="inv-change-pos">':'<span class="inv-change-neg">') + fmtIPct(t.pnlPct) + '</span>');
  setEl('invSumHoldings',    holdings + ' holding' + (holdings !== 1 ? 's' : '') + (liveCount ? ' · <span style="color:var(--accent)">' + liveCount + ' live</span>' : ''));
}

/* ══════════════════════════════════════════════════════════
   TABS
══════════════════════════════════════════════════════════ */
function renderInvTabs() {
  var bar = document.getElementById('invTabBar');
  if (!bar) return;
  var cats   = ['ALL', 'Stock', 'MF', 'Bond', 'FD', 'RealEstate', 'Others'];
  var labels = { ALL:'All', Stock:'Stocks', MF:'Mutual Funds', Bond:'Bond', FD:'FD', RealEstate:'Real Estate', Others:'Others' };
  bar.innerHTML = cats.map(function(c){
    var count = c === 'ALL' ? investmentsData.length : investmentsData.filter(function(h){ return h.category === c; }).length;
    return '<button class="inv-tab' + (invActiveCat === c ? ' active' : '') + '" onclick="invSetCat(\'' + c + '\')">'
           + labels[c]
           + '<span class="inv-tab-count">' + count + '</span>'
           + '</button>';
  }).join('');
}

function invSetCat(cat) {
  invActiveCat = cat;
  invSelectedId = null;
  renderInvTabs();
  renderInvTable();
  invHideDetail();
}

/* ══════════════════════════════════════════════════════════
   HOLDINGS TABLE
══════════════════════════════════════════════════════════ */
function getFilteredHoldings() {
  var list = investmentsData.slice();
  if (invActiveCat !== 'ALL') list = list.filter(function(h){ return h.category === invActiveCat; });
  var q = (document.getElementById('invSearch') || {}).value || '';
  if (q.trim()) {
    var lq = q.toLowerCase();
    list = list.filter(function(h){
      return h.name.toLowerCase().includes(lq) || (h.ticker || '').toLowerCase().includes(lq);
    });
  }
  list.sort(function(a, b){
    var av, bv;
    switch(invSortCol) {
      case 'name':   av = a.name.toLowerCase(); bv = b.name.toLowerCase(); break;
      case 'cat':    av = a.category; bv = b.category; break;
      case 'invested': av = getCostBasis(a); bv = getCostBasis(b); break;
      case 'value':
        av = getLiveValue(a); bv = getLiveValue(b); break;
      case 'pnl':
        av = getLiveValue(a) - getCostBasis(a); bv = getLiveValue(b) - getCostBasis(b); break;
      case 'pnlpct':
        var ai = getCostBasis(a), bi = getCostBasis(b);
        av = ai ? (getLiveValue(a)-ai)/ai : 0;
        bv = bi ? (getLiveValue(b)-bi)/bi : 0;
        break;
      default: av = 0; bv = 0;
    }
    if (av < bv) return invSortAsc ? -1 : 1;
    if (av > bv) return invSortAsc ? 1 : -1;
    return 0;
  });
  return list;
}

function getLiveValue(h) {
  /* Real Estate: uses explicit curPrice field */
  if (h.category === 'RealEstate') {
    return h.curPrice || h.avgPrice || 0;
  }
  var qty = h.qty || 0;
  var q   = (h.category === 'Stock' || h.category === 'MF') && h.ticker && invQuoteCache[h.ticker];
  if (q && qty) return qPrice(q) * qty;
  return (h.avgPrice || 0) * qty;
}

function getCostBasis(h) {
  return (h.avgPrice || 0) * (h.qty || 0);
}

function renderInvTable() {
  var tbody = document.getElementById('invTbody');
  if (!tbody) return;
  var list  = getFilteredHoldings();

  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="8"><div class="inv-empty-state"><div class="inv-empty-icon">📭</div>'
      + '<div class="inv-empty-title">' + (investmentsData.length ? 'No results for this filter' : 'No investments yet') + '</div>'
      + '<div class="inv-empty-sub">' + (investmentsData.length ? 'Try a different category or search' : 'Add your first holding with the + button') + '</div></div></td></tr>';
    return;
  }

  tbody.innerHTML = list.map(function(h){
    var meta  = CAT_META[h.category] || CAT_META.Others;
    var q     = (h.category === 'Stock' || h.category === 'MF') && h.ticker && invQuoteCache[h.ticker];
    var liveVal = getLiveValue(h);
    var pnl   = liveVal - getCostBasis(h);
    var pnlPct = getCostBasis(h) ? (pnl / getCostBasis(h)) * 100 : 0;
    var isPos  = pnl >= 0;
    var isLive = !!(q && h.ticker);
    var isSelected = h.id === invSelectedId;

    var priceCell = '';
    if (isLive) {
      var _qCur = (q.currency && q.currency !== 'INR') ? q.currency + ' ' : '₹';
      priceCell = '<span class="inv-live-dot"></span>'
        + _qCur + qPrice(q).toFixed(2)
        + '<br><span class="' + (qChgPct(q) >= 0 ? 'inv-change-pos' : 'inv-change-neg') + '" style="font-size:.6rem">'
        + fmtIPct(qChgPct(q)) + '</span>';
    } else if (h.ticker) {
      priceCell = '<span style="color:var(--muted);font-size:.65rem">Fetching…</span>';
    } else {
      priceCell = '<span style="color:var(--muted);font-size:.65rem">—</span>';
    }

    var bg = isSelected ? '' : '';
    var initials = h.name.split(' ').slice(0,2).map(function(w){ return w[0]; }).join('').toUpperCase().slice(0,2);

    return '<tr class="' + (isSelected ? 'selected' : '') + '" onclick="invSelectRow(\'' + h.id + '\')" '
           + 'ondblclick="openInvModal(\'' + h.id + '\')">'
           + '<td><div class="inv-ticker-cell">'
           + '<div class="inv-ticker-icon" style="background:' + meta.color + '18;color:' + meta.color + '">'
           + (h.ticker ? h.ticker.slice(0,3) : initials) + '</div>'
           + '<div><div class="inv-ticker-name">' + invEsc(h.name) + '</div>'
           + (h.ticker ? '<div class="inv-ticker-sub">' + invEsc(h.ticker) + (h.qty && h.category !== 'RealEstate' ? ' · ' + h.qty + ' units' : '') + '</div>' : '')
           + '</div></div></td>'
           + '<td><span class="cat-badge ' + meta.class + '">' + meta.label + '</span></td>'
           + '<td style="text-align:right">' + priceCell + '</td>'
           + '<td style="text-align:right">'
           + (h.category === 'RealEstate'
               ? '<div style="font-weight:600">Buy: ₹' + (h.buyPrice||h.avgPrice||0).toLocaleString('en-IN',{maximumFractionDigits:0}) + '</div>'
                 + (h.curPrice ? '<div style="font-size:.62rem;color:var(--muted)">Now: ₹' + h.curPrice.toLocaleString('en-IN',{maximumFractionDigits:0}) + '</div>' : '')
               : (h.qty ? '<div style="font-weight:600">' + h.qty + ' units</div><div style="font-size:.62rem;color:var(--muted)">@ ₹' + (h.avgPrice||0).toLocaleString('en-IN',{maximumFractionDigits:2}) + '</div>' : '—')
             )
           + '</td>'
           + '<td style="text-align:right">' + fmtI(getCostBasis(h)) + '</td>'
           + '<td style="text-align:right;font-weight:600">' + fmtI(liveVal) + '</td>'
           + '<td style="text-align:right" class="' + (isPos ? 'inv-change-pos' : 'inv-change-neg') + '">' + fmtI(pnl) + '</td>'
           + '<td style="text-align:right" class="' + (isPos ? 'inv-change-pos' : 'inv-change-neg') + '">' + fmtIPct(pnlPct) + '</td>'
           + '<td style="text-align:right">'
           + '<button onclick="event.stopPropagation();openInvModal(\'' + h.id + '\')" style="background:var(--surface2);border:1px solid var(--border);color:var(--muted);border-radius:6px;padding:.25rem .5rem;font-size:.65rem;cursor:pointer;margin-right:.3rem">✏️</button>'
           + '<button onclick="event.stopPropagation();invDeleteHolding(\'' + h.id + '\')" style="background:rgba(255,107,107,.08);border:1px solid rgba(255,107,107,.2);color:var(--accent2);border-radius:6px;padding:.25rem .5rem;font-size:.65rem;cursor:pointer">🗑</button>'
           + '</td>'
           + '</tr>';
  }).join('');
}

function invSetSort(col) {
  if (invSortCol === col) invSortAsc = !invSortAsc;
  else { invSortCol = col; invSortAsc = false; }
  renderInvTable();
}

function invSelectRow(id) {
  if (invSelectedId === id) {
    invSelectedId = null;
    renderInvTable();
    invHideDetail();
    return;
  }
  invSelectedId = id;
  invDetailTab  = 'overview';
  renderInvTable();
  var h = investmentsData.find(function(x){ return x.id === id; });
  if (h) {
    invShowDetail(h);
    /* Scroll the detail panel into view smoothly after a brief render tick */
    setTimeout(function() {
      var panel = document.getElementById('invDetailPanel');
      if (panel) {
        panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, 50);
  }
}

/* ══════════════════════════════════════════════════════════
   ALLOCATION DONUT
══════════════════════════════════════════════════════════ */
function renderInvAlloc() {
  var totals = {};
  Object.keys(CAT_META).forEach(function(c){ totals[c] = 0; });
  investmentsData.forEach(function(h){ totals[h.category] = (totals[h.category]||0) + getLiveValue(h); });
  var total = Object.values(totals).reduce(function(a,b){ return a+b; }, 0);

  var ctx = document.getElementById('invDonutChart');
  if (!ctx) return;

  var catKeys = Object.keys(CAT_META).filter(function(c){ return totals[c] > 0; });
  var colors  = catKeys.map(function(c){ return CAT_META[c].color; });
  var values  = catKeys.map(function(c){ return totals[c]; });

  if (invAllocChartInst) { invAllocChartInst.destroy(); invAllocChartInst = null; }

  invAllocChartInst = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels:   catKeys.map(function(c){ return CAT_META[c].label; }),
      datasets: [{ data: values, backgroundColor: colors.map(function(c){ return c + 'cc'; }),
                   borderColor: colors, borderWidth: 2, hoverOffset: 4 }]
    },
    options: {
      cutout: '70%', responsive: true, maintainAspectRatio: true,
      plugins: { legend: { display: false }, tooltip: {
        callbacks: {
          label: function(ctx){
            var pct = total ? ((ctx.raw / total) * 100).toFixed(1) : 0;
            return ' ' + fmtI(ctx.raw) + '  (' + pct + '%)';
          }
        }
      }}
    }
  });

  var legend = document.getElementById('invAllocLegend');
  if (legend) {
    legend.innerHTML = catKeys.map(function(c){
      var pct = total ? ((totals[c] / total) * 100).toFixed(1) : 0;
      return '<div class="inv-alloc-item">'
        + '<div class="inv-alloc-dot-label">'
        + '<div class="inv-alloc-dot" style="background:' + CAT_META[c].color + '"></div>'
        + '<span>' + CAT_META[c].label + '</span></div>'
        + '<div style="display:flex;gap:.75rem;align-items:center">'
        + '<span style="font-weight:600">' + fmtI(totals[c]) + '</span>'
        + '<span class="inv-alloc-pct">' + pct + '%</span></div></div>';
    }).join('') || '<div style="color:var(--muted);font-size:.72rem;text-align:center;padding:.75rem 0">No holdings yet</div>';
  }

  var center = document.getElementById('invDonutCenter');
  if (center) {
    center.innerHTML = '<div class="inv-donut-center-val">' + (total >= 1e5 ? (total/1e5).toFixed(1)+'L' : fmtI(total)) + '</div>'
                     + '<div class="inv-donut-center-sub">Portfolio</div>';
  }
}

/* ══════════════════════════════════════════════════════════
   LIVE TICKER PANEL
══════════════════════════════════════════════════════════ */
function renderInvLivePanel() {
  var list = document.getElementById('invLiveList');
  if (!list) return;

  var trackedHoldings = investmentsData.filter(function(h){
    return (h.category === 'Stock' || h.category === 'MF') && h.ticker;
  });

  if (!trackedHoldings.length) {
    list.innerHTML = '<div style="color:var(--muted);font-size:.72rem;text-align:center;padding:.75rem 0">Add stocks/MFs with tickers to see live prices</div>';
    return;
  }

  list.innerHTML = trackedHoldings.map(function(h){
    var q   = invQuoteCache[h.ticker];
    var pos = q ? qChgPct(q) >= 0 : true;
    return '<div class="inv-live-item">'
      + '<div><div class="inv-live-ticker">' + invEsc(h.ticker) + '</div>'
      + '<div class="inv-live-name">' + invEsc(h.name.slice(0,22)) + (h.name.length > 22 ? '…' : '') + '</div></div>'
      + '<div class="inv-live-right">'
      + '<div class="inv-live-price">' + (q ? '₹' + qPrice(q).toFixed(2) : '…') + '</div>'
      + '<div class="inv-live-chg ' + (q ? (pos ? 'inv-change-pos' : 'inv-change-neg') : 'inv-change-neu') + '">'
      + (q ? fmtIPct(qChgPct(q)) : '—') + '</div></div></div>';
  }).join('');
}

/* ══════════════════════════════════════════════════════════
   DETAIL PANEL
══════════════════════════════════════════════════════════ */
function invShowDetail(h) {
  var panel = document.getElementById('invDetailPanel');
  if (panel) panel.classList.remove('hidden');
  invSetDetailTab(invDetailTab, h);
}

function invHideDetail() {
  var panel = document.getElementById('invDetailPanel');
  if (panel) panel.classList.add('hidden');
}

function invSetDetailTab(tab, holding) {
  invDetailTab = tab;
  ['overview','chart','financials','news'].forEach(function(t){
    var el = document.getElementById('invDTab_' + t);
    if (el) el.classList.toggle('active', t === tab);
  });
  var h = holding || investmentsData.find(function(x){ return x.id === invSelectedId; });
  if (!h) return;
  var body = document.getElementById('invDetailBody');
  if (!body) return;

  var canLive = (h.category === 'Stock' || h.category === 'MF') && h.ticker;

  if (tab === 'overview') {
    var lv   = getLiveValue(h);
    var cost = getCostBasis(h);
    var pnl  = lv - cost;
    var pct  = cost ? (pnl / cost * 100) : 0;
    var pos = pnl >= 0;
    var q   = canLive && invQuoteCache[h.ticker];
    var meta = CAT_META[h.category] || CAT_META.Others;

    body.innerHTML =
      '<div style="display:flex;align-items:center;gap:.75rem;margin-bottom:1rem;flex-wrap:wrap">'
      + '<div class="inv-ticker-icon" style="width:42px;height:42px;font-size:.85rem;background:' + meta.color + '18;color:' + meta.color + '">'
      + (h.ticker ? h.ticker.slice(0,3) : h.name.slice(0,2).toUpperCase()) + '</div>'
      + '<div><div style="font-family:var(--font-head);font-size:1rem;font-weight:800">' + invEsc(h.name) + '</div>'
      + '<div style="color:var(--muted);font-size:.68rem">' + (h.date ? 'Purchased ' + h.date : '') + (h.notes ? (h.date ? ' · ' : '') + invEsc(h.notes) : '') + '</div></div>'
      + (q ? '<div style="margin-left:auto;text-align:right"><div style="font-family:var(--font-head);font-size:1.1rem;font-weight:800">₹' + qPrice(q).toFixed(2)
            + '</div><div class="' + (qChgPct(q) >= 0 ? 'inv-change-pos' : 'inv-change-neg') + '" style="font-size:.7rem">'
            + fmtIPct(qChgPct(q)) + ' today</div></div>' : '')
      + '</div>'
      + invHoldingStats(h)
      + (h.notes ? '<div style="margin-top:.85rem;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:.65rem .85rem;font-size:.73rem;color:var(--muted)">📝 ' + invEsc(h.notes) + '</div>' : '');
  }
  else if (tab === 'chart') {
    body.innerHTML = '<div style="margin-bottom:.75rem;font-family:var(--font-head);font-size:.9rem;font-weight:700">'
      + invEsc(h.name) + (h.ticker ? ' <span style="color:var(--muted);font-size:.75rem;font-weight:400">(' + invEsc(h.ticker) + ')</span>' : '')
      + '</div>'
      + (canLive
        ? '<div class="inv-price-chart-wrap"><canvas id="invPriceChart"></canvas></div>'
        : '<div class="inv-loading">No ticker assigned — chart requires a ticker symbol</div>')
      + invHoldingStats(h);
    if (canLive) invLoadPriceChart(h);
  }
  else if (tab === 'financials') {
    if (canLive) {
      body.innerHTML = '<div class="inv-loading"><div class="inv-spinner"></div>Loading financials…</div>';
      invLoadFinancials(h);
    } else {
      body.innerHTML = '<div class="inv-loading">Financials are available only for tracked stocks/MFs with ticker symbols.</div>';
    }
  }
  else if (tab === 'news') {
    if (canLive) {
      body.innerHTML = '<div class="inv-loading"><div class="inv-spinner"></div>Loading news…</div>';
      invLoadNews(h);
    } else {
      body.innerHTML = '<div class="inv-loading">News is available only for tracked stocks/MFs with ticker symbols.</div>';
    }
  }
}

function invHoldingStats(h) {
  var lv   = getLiveValue(h);
  var cost = getCostBasis(h);
  var pnl  = lv - cost;
  var pct  = cost ? (pnl / cost * 100) : 0;
  var pos  = pnl >= 0;
  var q    = (h.category === 'Stock' || h.category === 'MF') && h.ticker && invQuoteCache[h.ticker];
  var today = q ? ((qChgPct(q) >= 0 ? '+' : '') + qChgPct(q).toFixed(2) + '%') : '—';

  if (h.category === 'RealEstate') {
    return '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:.65rem;margin-top:.85rem">'
      + invStatBox('Buy Price',    fmtI(h.buyPrice || h.avgPrice || 0),  'var(--muted)')
      + invStatBox('Current Value',fmtI(h.curPrice || h.avgPrice || 0),  'var(--accent4)')
      + invStatBox('Unrealised P&L',(pos?'+':'') + fmtI(pnl),            pos ? 'var(--accent)' : 'var(--accent2)')
      + invStatBox('Return %',     fmtIPct(pct),                         pos ? 'var(--accent)' : 'var(--accent2)')
      + '</div>';
  }

  return '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:.65rem;margin-top:.85rem">'
    + invStatBox('Units',        h.qty ? h.qty.toLocaleString('en-IN') : '—',   'var(--purple)')
    + invStatBox('Avg Buy Price','₹' + (h.avgPrice||0).toLocaleString('en-IN',{maximumFractionDigits:2}), 'var(--muted)')
    + invStatBox('Cost Basis',   fmtI(cost),                                    'var(--accent4)')
    + invStatBox('Current Val',  fmtI(lv),                                      'var(--text)')
    + invStatBox('P&L',          (pos?'+':'') + fmtI(pnl),                      pos ? 'var(--accent)' : 'var(--accent2)')
    + invStatBox('Return %',     fmtIPct(pct),                                  pos ? 'var(--accent)' : 'var(--accent2)')
    + invStatBox("Today's Chg",  today, q && qChgPct(q) >= 0 ? 'var(--accent)' : 'var(--accent2)')
    + '</div>';
}
function invStatBox(label, val, color) {
  return '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:.65rem .8rem">'
    + '<div style="font-size:.58rem;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:.2rem">' + label + '</div>'
    + '<div style="font-family:var(--font-head);font-size:.88rem;font-weight:700;color:' + color + '">' + val + '</div>'
    + '</div>';
}

/* ── Price History Chart ─────────────────────────────────────── */
function invLoadPriceChart(h) {
  var url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(h.ticker)
            + '?interval=1d&range=3mo';
  invProxyFetch(url)
    .then(function(data){
      var result = data.chart.result[0];
      var timestamps = result.timestamp;
      var closes = result.indicators.quote[0].close;
      var labels = timestamps.map(function(ts){
        var d = new Date(ts * 1000);
        return d.toLocaleDateString('en-IN',{day:'numeric',month:'short'});
      });
      renderInvPriceChart(labels, closes, h);
    })
    .catch(function(e){
      var body = document.getElementById('invDetailBody');
      if (body) {
        var wrap = body.querySelector('.inv-price-chart-wrap');
        if (wrap) wrap.innerHTML = '<div class="inv-loading" style="color:var(--accent2)">⚠ Could not load chart — check ticker symbol</div>';
      }
    });
}

function renderInvPriceChart(labels, prices, h) {
  var ctx = document.getElementById('invPriceChart');
  if (!ctx) return;
  if (invPriceChartInst) { invPriceChartInst.destroy(); invPriceChartInst = null; }

  var first = prices[0] || 0;
  var last  = prices[prices.length - 1] || 0;
  var isUp  = last >= first;
  var lineColor = isUp ? '#00e5a0' : '#ff6b6b';

  invPriceChartInst = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        data: prices,
        borderColor: lineColor,
        borderWidth: 2,
        pointRadius: 0,
        fill: true,
        backgroundColor: function(context){
          var g = context.chart.ctx.createLinearGradient(0,0,0,200);
          g.addColorStop(0, lineColor + '40');
          g.addColorStop(1, lineColor + '00');
          return g;
        },
        tension: 0.3,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false },
        tooltip: { callbacks: { label: function(c){ return '₹' + Number(c.raw).toFixed(2); } } }
      },
      scales: {
        x: { ticks: { color: '#6b7a99', font: { size: 10 }, maxTicksLimit: 8 },
             grid: { color: 'rgba(35,45,63,.5)' } },
        y: { ticks: { color: '#6b7a99', font: { size: 10 },
                      callback: function(v){ return '₹' + v.toFixed(0); } },
             grid: { color: 'rgba(35,45,63,.5)' } }
      }
    }
  });
}

/* ── Financials (Last 4 Quarters) ────────────────────────────── */
/*
   Strategy:
   1. Indian stocks (.NS / .BO) → Screener.in API (no auth required)
   2. Other tickers              → Yahoo Finance chart for basic key stats
   3. Both fall back gracefully with direct links if APIs fail
*/

/* ── Financials ──────────────────────────────────────────────── */
/*
   Strategy (two parallel requests, both crumb-free):
   1. Yahoo Finance v7/finance/quote  → key stats (PE, EPS, 52W, mkt cap…)
   2. Yahoo Finance v8/finance/chart  → quarterly revenue/earnings from the
      `earnings` event stream (quarterly=true, range=2y, events=earnings)
   Both go through our proxy chain. Falls back to links if both fail.
*/

function invStripExchange(ticker) {
  return (ticker || '').replace(/\.(NS|BO|BSE|NSE)$/i, '').trim().toUpperCase();
}

/* ── Financials ──────────────────────────────────────────────────
   Waterfall of 3 strategies — first success wins:

   1. quoteSummary via codetabs proxy (doesn't forward auth headers,
      so Yahoo treats it as anonymous browser → often returns data)
   2. v8/chart events=earnings  (works for US stocks)
   3. v8/chart meta only        (always works — 52W, currency, exchange)

   Never shows price-trend table as "financials".
   If nothing meaningful loads → shows direct links to Screener / YF.
─────────────────────────────────────────────────────────────────*/
function invLoadFinancials(h) {
  var body   = document.getElementById('invDetailBody');
  var ticker = (h.ticker || '').toUpperCase();
  body.innerHTML = '<div class="inv-loading"><div class="inv-spinner"></div> Loading financials…</div>';

  /* ── Strategy 1: quoteSummary via codetabs (no auth forwarded) ── */
  var modules = 'incomeStatementHistoryQuarterly,balanceSheetHistoryQuarterly'
              + ',cashflowStatementHistoryQuarterly,defaultKeyStatistics,summaryDetail';
  var qsUrl   = 'https://query2.finance.yahoo.com/v10/finance/quoteSummary/'
              + encodeURIComponent(ticker) + '?modules=' + encodeURIComponent(modules);
  var qsProxy = 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(qsUrl);

  fetch(qsProxy)
    .then(function(r) {
      if (!r.ok) throw new Error('codetabs ' + r.status);
      return r.json();
    })
    .then(function(data) {
      var qs = data.quoteSummary && data.quoteSummary.result && data.quoteSummary.result[0];
      if (!qs) throw new Error('empty quoteSummary');
      _renderQuoteSummary(qs, h, body);
    })
    .catch(function(e1) {
      console.warn('[Fin] Strategy 1 failed:', e1.message, '— trying v8/chart');

      /* ── Strategy 2: v8/chart events=earnings ── */
      var chartUrl = 'https://query1.finance.yahoo.com/v8/finance/chart/'
                   + encodeURIComponent(ticker)
                   + '?interval=1d&range=1y&events=earnings';
      invProxyFetch(chartUrl)
        .then(function(d) {
          var result   = d.chart.result[0];
          var meta     = result.meta;
          var events   = result.events || {};
          var earnsMap = events.earnings || {};
          var quarters = Object.values(earnsMap)
            .filter(function(e) { return e.epsactual !== undefined || e.actual !== undefined; })
            .sort(function(a, b) { return (a.date||0) - (b.date||0) })
            .slice(-4);

          if (quarters.length > 0) {
            _renderChartEarnings(meta, quarters, h, body);
          } else {
            /* Has meta but no earnings — show meta + links */
            _renderMetaOnly(meta, h, body);
          }
        })
        .catch(function(e2) {
          console.warn('[Fin] Strategy 2 failed:', e2.message, '— showing fallback');
          _renderFallbackLinks(h, body);
        });
    });
}

/* ── Render: full quoteSummary (income stmt + balance sheet + CF + key stats) ── */
function _renderQuoteSummary(qs, h, body) {
  var iStmts = (qs.incomeStatementHistoryQuarterly  || {}).incomeStatementHistory  || [];
  var bStmts = (qs.balanceSheetHistoryQuarterly     || {}).balanceSheetStatements  || [];
  var cStmts = (qs.cashflowStatementHistoryQuarterly|| {}).cashflowStatements      || [];
  var ks     = qs.defaultKeyStatistics || {};
  var sd     = qs.summaryDetail        || {};

  if (!iStmts.length) { _renderFallbackLinks(h, body); return; }

  function fv(obj, key) {
    if (!obj || obj[key] === undefined || obj[key] === null) return '—';
    var v = obj[key].raw !== undefined ? obj[key].raw : obj[key];
    if (isNaN(Number(v))) return String(v);
    var n = Number(v), abs = Math.abs(n), s = n < 0 ? '-' : '';
    if (abs >= 1e9)  return s + (abs/1e9).toFixed(2) + 'B';
    if (abs >= 1e7)  return s + (abs/1e7).toFixed(2) + ' Cr';
    if (abs >= 1e5)  return s + (abs/1e5).toFixed(2) + ' L';
    if (abs >= 1000) return s + Math.round(abs).toLocaleString('en-IN');
    return s + abs.toFixed(2);
  }
  function fraw(obj, key, dec) {
    if (!obj || obj[key] === undefined) return '—';
    var v = obj[key].raw !== undefined ? obj[key].raw : obj[key];
    return isNaN(v) ? '—' : Number(v).toFixed(dec !== undefined ? dec : 2);
  }
  function fpct(obj, key) {
    if (!obj || obj[key] === undefined) return '—';
    var v = obj[key].raw !== undefined ? obj[key].raw : obj[key];
    return isNaN(v) ? '—' : (Number(v)*100).toFixed(2) + '%';
  }
  function qDate(stmt) {
    if (!stmt || !stmt.endDate) return '—';
    return new Date((stmt.endDate.raw || stmt.endDate) * 1000)
      .toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
  }

  var q4 = iStmts.slice(0, 4).reverse();
  var b4 = bStmts.slice(0, 4).reverse();
  var c4 = cStmts.slice(0, 4).reverse();

  /* Key stats */
  var liveQ = invQuoteCache[h.ticker] || {};
  var statItems = [
    ['Market Cap',    fv(ks,'marketCap')],
    ['P/E (TTM)',     fraw(ks,'trailingPE')],
    ['Forward P/E',   fraw(ks,'forwardPE')],
    ['EPS (TTM)',     fraw(ks,'trailingEps')],
    ['Price/Book',    fraw(ks,'priceToBook')],
    ['52W High',      fraw(sd,'fiftyTwoWeekHigh')],
    ['52W Low',       fraw(sd,'fiftyTwoWeekLow')],
    ['Div Yield',     fpct(sd,'dividendYield')],
    ['Beta',          fraw(ks,'beta')],
    ['ROE',           fpct(ks,'returnOnEquity')],
    ['ROA',           fpct(ks,'returnOnAssets')],
    ['Profit Margin', fpct(ks,'profitMargins')],
  ];

  var statsHtml = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));'
    + 'gap:.45rem;margin-bottom:1.3rem">'
    + statItems.map(function(s) {
        return '<div style="background:var(--surface2);border:1px solid var(--border);'
          + 'border-radius:8px;padding:.5rem .65rem">'
          + '<div style="font-size:.52rem;color:var(--muted);text-transform:uppercase;'
          + 'letter-spacing:.5px;margin-bottom:.1rem">' + s[0] + '</div>'
          + '<div style="font-weight:700;font-size:.78rem">' + (s[1] || '—') + '</div></div>';
      }).join('')
    + '</div>';

  /* Income Statement table */
  function makeTable(title, hdrs, rows) {
    return '<div style="margin-bottom:1.2rem">'
      + '<div style="font-family:var(--font-head);font-size:.75rem;font-weight:700;'
      + 'color:var(--accent4);margin-bottom:.5rem">' + title + '</div>'
      + '<div style="overflow-x:auto"><table class="inv-fin-table">'
      + '<thead><tr><th style="text-align:left">Metric</th>'
      + hdrs.map(function(h){ return '<th>' + invEsc(h) + '</th>'; }).join('')
      + '</tr></thead><tbody>'
      + rows.map(function(r) {
          return '<tr><td style="font-weight:600">' + invEsc(r[0]) + '</td>'
            + r.slice(1).map(function(v){ return '<td>' + invEsc(String(v)) + '</td>'; }).join('')
            + '</tr>';
        }).join('')
      + '</tbody></table></div></div>';
  }

  var qHdrs = q4.map(qDate);

  var incomeRows = [
    ['Revenue',      ...q4.map(function(s){ return fv(s,'totalRevenue'); })],
    ['Gross Profit', ...q4.map(function(s){ return fv(s,'grossProfit'); })],
    ['EBIT',         ...q4.map(function(s){ return fv(s,'ebit'); })],
    ['Net Income',   ...q4.map(function(s){ return fv(s,'netIncome'); })],
    ['EPS (Diluted)',...q4.map(function(s){ return fraw(s,'dilutedEps'); })],
  ];

  var bsRows = [
    ['Total Assets',     ...b4.map(function(s,i){ return fv(bStmts[3-i],'totalAssets'); }).reverse()],
    ['Total Liabilities',...b4.map(function(s,i){ return fv(bStmts[3-i],'totalLiab'); }).reverse()],
    ['Shareholder Eq.',  ...b4.map(function(s,i){ return fv(bStmts[3-i],'totalStockholderEquity'); }).reverse()],
    ['Cash',             ...b4.map(function(s,i){ return fv(bStmts[3-i],'cash'); }).reverse()],
  ];

  var cfRows = [
    ['Operating CF',  ...c4.map(function(s,i){ return fv(cStmts[3-i],'totalCashFromOperatingActivities'); }).reverse()],
    ['Capex',         ...c4.map(function(s,i){ return fv(cStmts[3-i],'capitalExpenditures'); }).reverse()],
    ['Free Cash Flow',...c4.map(function(s,i){ return fv(cStmts[3-i],'freeCashflow'); }).reverse()],
  ];

  var base = invStripExchange(h.ticker);
  body.innerHTML = statsHtml
    + makeTable('📋 Income Statement — Last 4 Quarters', qHdrs, incomeRows)
    + makeTable('🏛 Balance Sheet', qHdrs, bsRows)
    + makeTable('💵 Cash Flow', qHdrs, cfRows)
    + '<div style="font-size:.62rem;color:var(--muted);text-align:right;margin-top:.5rem">'
    + 'Source: Yahoo Finance &nbsp;·&nbsp;'
    + '<a href="https://finance.yahoo.com/quote/' + encodeURIComponent(h.ticker) + '/financials" '
    + 'target="_blank" rel="noopener" style="color:var(--accent4)">Full report →</a>'
    + (base ? ' &nbsp;·&nbsp; <a href="https://www.screener.in/company/' + invEsc(base) + '/" '
      + 'target="_blank" rel="noopener" style="color:var(--accent4)">Screener.in →</a>' : '')
    + '</div>';
}

/* ── Render: earnings events from v8/chart (US stocks mostly) ── */
function _renderChartEarnings(meta, quarters, h, body) {
  function fr(v, d) {
    if (v === null || v === undefined || isNaN(Number(v))) return '—';
    return Number(v).toFixed(d !== undefined ? d : 2);
  }
  var liveQ = invQuoteCache[h.ticker] || {};

  var statItems = [
    ['52W High',   meta.fiftyTwoWeekHigh   ? '₹' + fr(meta.fiftyTwoWeekHigh)   : '—'],
    ['52W Low',    meta.fiftyTwoWeekLow    ? '₹' + fr(meta.fiftyTwoWeekLow)    : '—'],
    ['Prev Close', meta.chartPreviousClose ? '₹' + fr(meta.chartPreviousClose) : '—'],
    ['Currency',   meta.currency || '—'],
    ['Exchange',   meta.exchangeName || meta.fullExchangeName || '—'],
    ['Today Chg',  liveQ.changePct !== undefined
                     ? (liveQ.changePct >= 0 ? '+':'') + liveQ.changePct.toFixed(2) + '%' : '—'],
  ];
  var statsHtml = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));'
    + 'gap:.5rem;margin-bottom:1.25rem">'
    + statItems.map(function(s) {
        return '<div style="background:var(--surface2);border:1px solid var(--border);'
          + 'border-radius:8px;padding:.55rem .7rem">'
          + '<div style="font-size:.55rem;color:var(--muted);text-transform:uppercase;'
          + 'letter-spacing:.5px;margin-bottom:.15rem">' + s[0] + '</div>'
          + '<div style="font-weight:700;font-size:.8rem">' + s[1] + '</div></div>';
      }).join('')
    + '</div>';

  var epsHtml = '<div style="margin-bottom:1.25rem">'
    + '<div style="font-family:var(--font-head);font-size:.75rem;font-weight:700;'
    + 'color:var(--accent4);margin-bottom:.5rem">📋 Quarterly EPS (Last '
    + quarters.length + ' Quarters)</div>'
    + '<div style="overflow-x:auto"><table class="inv-fin-table">'
    + '<thead><tr><th style="text-align:left">Period</th>'
    + '<th>EPS Estimate</th><th>EPS Actual</th><th>Surprise</th>'
    + '</tr></thead><tbody>'
    + quarters.map(function(q) {
        var period = q.period
          || (q.date ? new Date(q.date*1000).toLocaleDateString('en-IN',{month:'short',year:'numeric'}) : '—');
        var est    = q.epsestimate !== undefined ? fr(q.epsestimate) : q.estimate !== undefined ? fr(q.estimate) : '—';
        var actual = q.epsactual  !== undefined ? fr(q.epsactual)   : q.actual   !== undefined ? fr(q.actual)   : '—';
        var surp   = (q.epsactual !== undefined && q.epsestimate && q.epsestimate !== 0)
          ? (q.epsactual - q.epsestimate) / Math.abs(q.epsestimate) * 100 : null;
        var surpStr = surp !== null ? (surp>=0?'+':'') + surp.toFixed(1)+'%' : '—';
        var surpCol = surp !== null ? (surp>=0?'color:var(--accent)':'color:var(--accent2)') : '';
        return '<tr><td style="font-weight:600">' + invEsc(String(period)) + '</td>'
          + '<td>' + est + '</td><td>' + actual + '</td>'
          + '<td style="' + surpCol + '">' + surpStr + '</td></tr>';
      }).join('')
    + '</tbody></table></div></div>';

  var base = invStripExchange(h.ticker);
  body.innerHTML = statsHtml + epsHtml
    + '<div style="font-size:.62rem;color:var(--muted);text-align:right;margin-top:.5rem">'
    + 'Source: Yahoo Finance &nbsp;·&nbsp;'
    + '<a href="https://finance.yahoo.com/quote/' + encodeURIComponent(h.ticker) + '/financials" '
    + 'target="_blank" rel="noopener" style="color:var(--accent4)">Full report →</a>'
    + (base ? ' &nbsp;·&nbsp; <a href="https://www.screener.in/company/' + invEsc(base) + '/" '
      + 'target="_blank" rel="noopener" style="color:var(--accent4)">Screener.in →</a>' : '')
    + '</div>';
}

/* ── Render: meta only (key stats + direct links) ── */
function _renderMetaOnly(meta, h, body) {
  function fr(v, d) {
    if (v === null || v === undefined || isNaN(Number(v))) return '—';
    return Number(v).toFixed(d !== undefined ? d : 2);
  }
  var liveQ = invQuoteCache[h.ticker] || {};
  var statItems = [
    ['52W High',   meta.fiftyTwoWeekHigh   ? '₹' + fr(meta.fiftyTwoWeekHigh)   : '—'],
    ['52W Low',    meta.fiftyTwoWeekLow    ? '₹' + fr(meta.fiftyTwoWeekLow)    : '—'],
    ['Prev Close', meta.chartPreviousClose ? '₹' + fr(meta.chartPreviousClose) : '—'],
    ['Currency',   meta.currency || '—'],
    ['Exchange',   meta.exchangeName || meta.fullExchangeName || '—'],
    ['Today Chg',  liveQ.changePct !== undefined
                     ? (liveQ.changePct >= 0 ? '+':'') + liveQ.changePct.toFixed(2)+'%' : '—'],
  ];
  var statsHtml = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));'
    + 'gap:.5rem;margin-bottom:1.25rem">'
    + statItems.map(function(s) {
        return '<div style="background:var(--surface2);border:1px solid var(--border);'
          + 'border-radius:8px;padding:.55rem .7rem">'
          + '<div style="font-size:.55rem;color:var(--muted);text-transform:uppercase;'
          + 'letter-spacing:.5px;margin-bottom:.15rem">' + s[0] + '</div>'
          + '<div style="font-weight:700;font-size:.8rem">' + s[1] + '</div></div>';
      }).join('')
    + '</div>';
  var base = invStripExchange(h.ticker);
  body.innerHTML = statsHtml
    + '<div style="font-size:.72rem;color:var(--muted);background:var(--surface2);'
    + 'border:1px solid var(--border);border-radius:8px;padding:.75rem 1rem;'
    + 'margin-bottom:1rem;line-height:1.7">'
    + 'Detailed quarterly financials are not available for this ticker via the API. '
    + 'View them directly:</div>'
    + _linkCard('📊', 'Screener.in', 'Quarterly P&L, Balance Sheet, Cash Flow (Indian stocks)',
        'https://www.screener.in/company/' + base + '/')
    + '<div style="margin-top:.5rem">'
    + _linkCard('📈', 'Yahoo Finance', 'Income Statement, Key Statistics',
        'https://finance.yahoo.com/quote/' + encodeURIComponent(h.ticker) + '/financials')
    + '</div>';
}

function _renderFallbackLinks(h, body) {
  var base = invStripExchange(h.ticker || '');
  body.innerHTML = '<div style="display:flex;flex-direction:column;gap:.65rem">'
    + '<div style="font-size:.72rem;color:var(--accent2);margin-bottom:.1rem">'
    + '⚠ Could not load financials automatically.</div>'
    + _linkCard('📊', 'Screener.in', 'Quarterly P&L, Balance Sheet, Cash Flow',
        'https://www.screener.in/company/' + base + '/')
    + _linkCard('📈', 'Yahoo Finance', 'Income Statement, Key Statistics',
        'https://finance.yahoo.com/quote/' + encodeURIComponent(h.ticker) + '/financials')
    + _linkCard('🏛', 'MoneyControl', 'NSE/BSE Fundamentals & Filings',
        'https://www.moneycontrol.com/stocks/cptmarket/compsearchnew.php?search_data=' + encodeURIComponent(base))
    + '</div>';
}

function _linkCard(icon, title, sub, href) {
  return '<a href="' + invEsc(href) + '" target="_blank" rel="noopener" '
    + 'style="display:flex;align-items:center;gap:.7rem;padding:.7rem .9rem;'
    + 'background:var(--surface2);border:1px solid var(--border);border-radius:8px;'
    + 'text-decoration:none;color:var(--text);font-size:.74rem;transition:border-color .2s"'
    + ' onmouseover="this.style.borderColor=\'var(--accent4)\'"'
    + ' onmouseout="this.style.borderColor=\'var(--border)\'">'
    + '<span style="font-size:1.2rem">' + icon + '</span>'
    + '<div><div style="font-weight:600">' + invEsc(title) + '</div>'
    + '<div style="color:var(--muted);font-size:.63rem">' + invEsc(sub) + '</div></div></a>';
}

function invLoadNews(h) {
  var body = document.getElementById('invDetailBody');
  // Use Yahoo Finance news RSS via rss2json
  var rssUrl = 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=' + encodeURIComponent(h.ticker) + '&region=IN&lang=en-IN';
  var apiUrl = 'https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent(rssUrl) + '&count=10';
  fetch(apiUrl)
    .then(function(r){ return r.json(); })
    .then(function(data){
      if (!data.items || !data.items.length) throw new Error('no items');
      if (body) body.innerHTML = '<div class="inv-news-list">' + data.items.map(function(item){
        var pub = new Date(item.pubDate);
        var ago = invTimeAgo(pub);
        return '<a class="inv-news-item" href="' + invEsc(item.link) + '" target="_blank" rel="noopener">'
          + '<div class="inv-news-badge">📰</div>'
          + '<div style="flex:1;min-width:0">'
          + '<div class="inv-news-source">' + invEsc(item.author || data.feed.title || h.ticker) + '</div>'
          + '<div class="inv-news-title">' + invEsc(item.title) + '</div>'
          + '<div class="inv-news-time">🕐 ' + ago + '</div>'
          + '</div></a>';
      }).join('') + '</div>';
    })
    .catch(function(){
      // Fallback: show generic financial news search link
      if (body) body.innerHTML = '<div class="inv-loading" style="flex-direction:column;gap:.75rem">'
        + '<div>Live news not available via API for this ticker.</div>'
        + '<a href="https://finance.yahoo.com/quote/' + encodeURIComponent(h.ticker) + '/news" target="_blank" rel="noopener" '
        + 'style="color:var(--accent4);font-size:.75rem">📰 View on Yahoo Finance →</a>'
        + '<a href="https://economictimes.indiatimes.com/markets/stocks/news" target="_blank" rel="noopener" '
        + 'style="color:var(--accent4);font-size:.75rem">📰 Economic Times Markets →</a>'
        + '</div>';
    });
}

function invTimeAgo(date) {
  var diff = (Date.now() - date) / 1000;
  if (diff < 60)   return 'Just now';
  if (diff < 3600) return Math.floor(diff/60) + 'm ago';
  if (diff < 86400)return Math.floor(diff/3600) + 'h ago';
  return Math.floor(diff/86400) + 'd ago';
}

/* ══════════════════════════════════════════════════════════
   ADD / EDIT MODAL
══════════════════════════════════════════════════════════ */
function openInvModal(id) {
  invEditId = id || null;
  var h = id ? investmentsData.find(function(x){ return x.id === id; }) : null;
  var modal = document.getElementById('invModal');
  if (!modal) return;

  document.getElementById('invModalTitle').textContent = h ? '✏️ Edit Holding' : '➕ Add Investment';
  document.getElementById('invFormName').value         = h ? h.name         : '';
  document.getElementById('invFormTicker').value       = h ? (h.ticker||'') : '';
  document.getElementById('invFormDate').value         = h ? (h.date||'')   : new Date().toISOString().slice(0,10);
  document.getElementById('invFormNotes').value        = h ? (h.notes||'')  : '';

  var isRE = h ? (h.category === 'RealEstate') : false;

  if (isRE) {
    document.getElementById('invFormBuyPrice').value  = h ? (h.buyPrice||'')  : '';
    document.getElementById('invFormCurPrice').value  = h ? (h.curPrice||'')  : '';
    document.getElementById('invFormQty').value       = '';
    document.getElementById('invFormAvgPrice').value  = '';
  } else {
    document.getElementById('invFormQty').value       = h ? (h.qty||'')       : '';
    document.getElementById('invFormAvgPrice').value  = h ? (h.avgPrice||'')  : '';
    document.getElementById('invFormBuyPrice').value  = '';
    document.getElementById('invFormCurPrice').value  = '';
  }

  invCalcInvestedPreview();
  invCalcREPreview();
  invSetCatPill(h ? h.category : 'Stock');
  invHideQuotePreview();
  modal.classList.remove('hidden');
}

/* RE live preview: gain + return % */
function invCalcREPreview() {
  var buy = parseFloat(document.getElementById('invFormBuyPrice').value)  || 0;
  var cur = parseFloat(document.getElementById('invFormCurPrice').value)  || 0;
  var row = document.getElementById('invREPreviewRow');
  var gainEl   = document.getElementById('invREGainVal');
  var returnEl = document.getElementById('invREReturnVal');
  if (!row) return;

  if (buy > 0 && cur > 0) {
    var gain   = cur - buy;
    var retPct = (gain / buy) * 100;
    var pos    = gain >= 0;
    var color  = pos ? 'var(--accent)' : 'var(--accent2)';
    if (gainEl)   { gainEl.textContent   = (pos?'+':'') + '₹' + Math.round(Math.abs(gain)).toLocaleString('en-IN'); gainEl.style.color = color; }
    if (returnEl) { returnEl.textContent = (pos?'+':'') + retPct.toFixed(2) + '%'; returnEl.style.color = color; }
    row.style.display = '';
  } else {
    row.style.display = 'none';
  }
}

function closeInvModal() {
  var modal = document.getElementById('invModal');
  if (modal) modal.classList.add('hidden');
  invEditId = null;
}

var invSelectedCat = 'Stock';
function invSetCatPill(cat) {
  invSelectedCat = cat;
  document.querySelectorAll('.inv-cat-pill').forEach(function(p){
    p.className = 'inv-cat-pill';
    if (p.dataset.cat === cat) {
      p.classList.add('active-' + cat.toLowerCase().replace(' ',''));
    }
  });

  var isRE      = (cat === 'RealEstate');
  var isLive    = (cat === 'Stock' || cat === 'MF');

  // Ticker row: only Stock / MF
  var tickerRow = document.getElementById('invTickerRow');
  if (tickerRow) tickerRow.style.display = isLive ? '' : 'none';

  // Standard qty + avgPrice rows: hide for Real Estate
  var qtyRow      = document.getElementById('invQtyRow');
  var avgPriceRow = document.getElementById('invAvgPriceRow');
  var previewRow  = document.getElementById('invInvestedPreviewRow');
  if (qtyRow)      qtyRow.style.display      = isRE ? 'none' : '';
  if (avgPriceRow) avgPriceRow.style.display  = isRE ? 'none' : '';
  if (previewRow)  previewRow.style.display   = 'none'; // reset; recalc on input

  // RE-specific rows: show only for Real Estate
  var buyPriceRow = document.getElementById('invBuyPriceRow');
  var curPriceRow = document.getElementById('invCurPriceRow');
  var rePreview   = document.getElementById('invREPreviewRow');
  if (buyPriceRow) buyPriceRow.style.display = isRE ? '' : 'none';
  if (curPriceRow) curPriceRow.style.display = isRE ? '' : 'none';
  if (rePreview)   rePreview.style.display   = 'none'; // reset; recalc on input
}

/* Live quote preview inside modal */
var invQuoteDebounce = null;
function invTickerInput() {
  clearTimeout(invQuoteDebounce);
  var ticker = document.getElementById('invFormTicker').value.trim().toUpperCase();
  if (!ticker) { invHideQuotePreview(); return; }
  invQuoteDebounce = setTimeout(function(){ invFetchModalQuote(ticker); }, 700);
}

function invFetchModalQuote(ticker) {
  var preview = document.getElementById('invQuotePreview');
  if (preview) { preview.className = 'inv-quote-preview show'; preview.innerHTML = '<div class="inv-spinner"></div> Fetching…'; }
  invFetchQuote(ticker)
    .then(function(q){
      invQuoteCache[ticker] = q;
      if (preview) {
        preview.innerHTML = '<div><div class="inv-quote-ticker">' + invEsc(q.ticker) + '</div>'
          + '<div class="inv-quote-name">' + invEsc(q.name) + '</div></div>'
          + '<div><div class="inv-quote-price">₹' + qPrice(q).toFixed(2) + '</div>'
          + '<div class="' + (qChgPct(q) >= 0 ? 'inv-change-pos' : 'inv-change-neg') + '" style="font-size:.7rem">'
          + fmtIPct(qChgPct(q)) + ' today</div></div>';
        // Auto-fill avg buy price if field is empty
        var avgPriceEl = document.getElementById('invFormAvgPrice');
        if (avgPriceEl && !avgPriceEl.value) {
          avgPriceEl.value = qPrice(q).toFixed(2);
          invCalcInvestedPreview();
        }
      }
    })
    .catch(function(){
      if (preview) preview.innerHTML = '<span style="color:var(--accent2)">⚠ Ticker not found — check symbol (e.g. RELIANCE.NS)</span>';
    });
}

function invHideQuotePreview() {
  var p = document.getElementById('invQuotePreview');
  if (p) { p.className = 'inv-quote-preview'; p.innerHTML = ''; }
}


function invCalcInvestedPreview() {
  var qty      = parseFloat(document.getElementById('invFormQty').value)      || 0;
  var avgPrice = parseFloat(document.getElementById('invFormAvgPrice').value) || 0;
  var row = document.getElementById('invInvestedPreviewRow');
  var val = document.getElementById('invInvestedPreviewVal');
  if (qty > 0 && avgPrice > 0) {
    var total = qty * avgPrice;
    if (val) val.textContent = '₹' + total.toLocaleString('en-IN', {maximumFractionDigits: 2});
    if (row) row.style.display = '';
  } else {
    if (row) row.style.display = 'none';
  }
}

/* Also called invQtyInput for backward compat */
function invQtyInput() { invCalcInvestedPreview(); }

function saveInvHolding() {
  var name  = document.getElementById('invFormName').value.trim();
  var date  = document.getElementById('invFormDate').value;
  var notes = document.getElementById('invFormNotes').value.trim();
  var isRE  = (invSelectedCat === 'RealEstate');

  if (!name) { alert('Please enter a name for this holding.'); return; }

  var h;
  if (isRE) {
    /* ── Real Estate: buyPrice + curPrice, qty implicit = 1 ── */
    var buyPrice = parseFloat(document.getElementById('invFormBuyPrice').value) || 0;
    var curPrice = parseFloat(document.getElementById('invFormCurPrice').value) || 0;
    if (buyPrice <= 0) { alert('Please enter the buy price for this property.'); return; }
    h = {
      id:        invEditId || invId(),
      name:      name,
      category:  'RealEstate',
      ticker:    '',
      qty:       1,
      avgPrice:  buyPrice,
      buyPrice:  buyPrice,
      curPrice:  curPrice || buyPrice,
      date:      date,
      notes:     notes,
      createdAt: invEditId
        ? ((investmentsData.find(function(x){ return x.id === invEditId; }) || {}).createdAt || Date.now())
        : Date.now(),
    };
  } else {
    /* ── Standard: qty + avgPrice ── */
    var ticker   = document.getElementById('invFormTicker').value.trim().toUpperCase();
    var qty      = parseFloat(document.getElementById('invFormQty').value)      || 0;
    var avgPrice = parseFloat(document.getElementById('invFormAvgPrice').value) || 0;
    if (qty <= 0)      { alert('Please enter the number of units / qty.'); return; }
    if (avgPrice <= 0) { alert('Please enter the average buy price per unit.'); return; }
    h = {
      id:        invEditId || invId(),
      name:      name,
      category:  invSelectedCat,
      ticker:    (invSelectedCat === 'Stock' || invSelectedCat === 'MF') ? ticker : '',
      qty:       qty,
      avgPrice:  avgPrice,
      date:      date,
      notes:     notes,
      createdAt: invEditId
        ? ((investmentsData.find(function(x){ return x.id === invEditId; }) || {}).createdAt || Date.now())
        : Date.now(),
    };
  }

  if (invEditId) {
    var idx = investmentsData.findIndex(function(x){ return x.id === invEditId; });
    if (idx >= 0) investmentsData[idx] = h;
  } else {
    investmentsData.push(h);
  }
  saveInvestments();
  closeInvModal();
  renderInvSummary(); renderInvTabs(); renderInvTable(); renderInvAlloc(); renderInvLivePanel();
  if (h.ticker) {
    invFetchQuote(h.ticker).then(function(q){
      invQuoteCache[h.ticker] = q;
      renderInvTable(); renderInvSummary(); renderInvLivePanel();
    }).catch(function(){});
  }
}

function invDeleteHolding(id) {
  var h = investmentsData.find(function(x){ return x.id === id; });
  if (!h || !confirm('Delete "' + h.name + '"?')) return;
  investmentsData = investmentsData.filter(function(x){ return x.id !== id; });
  saveInvestments();
  if (invSelectedId === id) { invSelectedId = null; invHideDetail(); }
  renderInvSummary();
  renderInvTabs();
  renderInvTable();
  renderInvAlloc();
  renderInvLivePanel();
}

/* ══════════════════════════════════════════════════════════
   INVESTMENT SHEET IMPORT
   Columns: Name | Ticker | Quantity | Avg Price | Category (opt) | Date (opt)
══════════════════════════════════════════════════════════ */

var invImportParsed  = null;   // parsed rows ready to confirm
var invImportDefCat  = 'Stock'; // default category when col E is blank

/* ── Column map — matches header keywords case-insensitively ── */
var INV_IMPORT_COLS = {
  name:     ['name', 'stock', 'company', 'fund', 'security', 'scrip'],
  ticker:   ['ticker', 'symbol', 'isin', 'code'],
  qty:      ['qty', 'quantity', 'units', 'shares', 'lot'],
  avgPrice: ['avg', 'average', 'price', 'buy price', 'cost', 'nav', 'rate'],
  category: ['category', 'type', 'asset', 'class'],
  date:     ['date', 'purchased', 'buy date'],
};

/* Valid category aliases → canonical key */
var INV_CAT_ALIASES = {
  stock: 'Stock', stocks: 'Stock', equity: 'Stock', eq: 'Stock',
  mf: 'MF', 'mutual fund': 'MF', mutualfund: 'MF', fund: 'MF', etf: 'MF',
  bond: 'Bond', bonds: 'Bond', fd: 'FD', 'fixed deposit': 'FD', 'fixed-deposit': 'FD', debt: 'Bond',
  realestate: 'RealEstate', 'real estate': 'RealEstate', property: 'RealEstate', re: 'RealEstate',
  others: 'Others', other: 'Others', misc: 'Others', commodity: 'Others', gold: 'Others',
};

function openInvImport() {
  invImportParsed = null;
  document.getElementById('invImportModal').classList.remove('hidden');
  document.getElementById('invImportPreview').style.display = 'none';
  document.getElementById('invImportConfirmBtn').disabled = true;
  document.getElementById('invImportFileInput').value = '';
  setInvImportCat('Stock');

  // Wire drag-drop (once)
  var dz = document.getElementById('invImportDropzone');
  dz.ondragover  = function(e){ e.preventDefault(); dz.classList.add('drag-over'); };
  dz.ondragleave = function(){ dz.classList.remove('drag-over'); };
  dz.ondrop      = function(e){
    e.preventDefault(); dz.classList.remove('drag-over');
    if (e.dataTransfer.files.length) processInvImportFile(e.dataTransfer.files[0]);
  };
}

function closeInvImport() {
  document.getElementById('invImportModal').classList.add('hidden');
}

function setInvImportCat(cat) {
  invImportDefCat = cat;
  document.querySelectorAll('#invImportCatPills .inv-cat-pill').forEach(function(p) {
    p.className = 'inv-cat-pill';
    if (p.dataset.cat === cat) p.classList.add('active-' + cat.toLowerCase().replace(' ',''));
  });
  // Re-run preview with updated default if already parsed
  if (invImportParsed) renderInvImportPreview(invImportParsed);
}

function handleInvImportFile(e) {
  if (e.target.files.length) processInvImportFile(e.target.files[0]);
}

function processInvImportFile(file) {
  var ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'csv') {
    var reader = new FileReader();
    reader.onload = function(ev) { parseInvImportRows(invCsvToRows(ev.target.result)); };
    reader.readAsText(file);
  } else if (ext === 'xlsx' || ext === 'xls') {
    var reader = new FileReader();
    reader.onload = function(ev) {
      try {
        var wb   = XLSX.read(ev.target.result, { type: 'array' });
        var ws   = wb.Sheets[wb.SheetNames[0]];
        var rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        parseInvImportRows(rows);
      } catch(err) {
        showInvToast('Error reading file: ' + err.message, 'error');
      }
    };
    reader.readAsArrayBuffer(file);
  } else {
    showInvToast('Unsupported format — use .xlsx, .xls or .csv', 'error');
  }
}

function invCsvToRows(text) {
  /* Handle quoted fields with commas inside them */
  return text.trim().split('\n').map(function(line) {
    var result = [], cur = '', inQ = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { result.push(cur.trim()); cur = ''; }
      else { cur += ch; }
    }
    result.push(cur.trim());
    return result;
  });
}

/* Detect which column index maps to which field */
function detectInvImportCols(headerRow) {
  var map = { name:-1, ticker:-1, qty:-1, avgPrice:-1, category:-1, date:-1 };
  headerRow.forEach(function(cell, i) {
    var h = String(cell).toLowerCase().trim();
    Object.keys(INV_IMPORT_COLS).forEach(function(field) {
      if (map[field] === -1) {
        var keywords = INV_IMPORT_COLS[field];
        if (keywords.some(function(k){ return h.includes(k); })) {
          map[field] = i;
        }
      }
    });
  });
  return map;
}

/* Positional fallback when no headers are found */
function positionalColMap() {
  return { name:0, ticker:1, qty:2, avgPrice:3, category:4, date:5 };
}

function invCleanNum(v) {
  var n = parseFloat(String(v).replace(/[₹,\s₹]/g, ''));
  return isNaN(n) ? 0 : n;
}

function parseInvImportRows(rows) {
  if (!rows || !rows.length) {
    showInvToast('File is empty', 'error'); return;
  }

  /* Detect if first row is a header */
  var firstRow   = rows[0].map(function(c){ return String(c).toLowerCase().trim(); });
  var isHeader   = firstRow.some(function(c){
    return Object.values(INV_IMPORT_COLS).some(function(kws){
      return kws.some(function(k){ return c.includes(k); });
    });
  });

  var colMap  = isHeader ? detectInvImportCols(rows[0]) : positionalColMap();
  var dataRows = rows.slice(isHeader ? 1 : 0);

  /* If name col still not found, just use positional */
  if (colMap.name === -1) colMap = positionalColMap();

  var parsed   = [];
  var warnings = [];

  dataRows.forEach(function(row, idx) {
    if (!row || row.every(function(c){ return String(c).trim() === ''; })) return; // skip blank rows

    var name     = String(row[colMap.name]     || '').trim();
    var ticker   = colMap.ticker   >= 0 ? String(row[colMap.ticker]   || '').trim().toUpperCase() : '';
    var qty      = colMap.qty      >= 0 ? invCleanNum(row[colMap.qty])      : 0;
    var avgPrice = colMap.avgPrice >= 0 ? invCleanNum(row[colMap.avgPrice]) : 0;
    var catRaw   = colMap.category >= 0 ? String(row[colMap.category] || '').trim().toLowerCase() : '';
    var date     = colMap.date     >= 0 ? String(row[colMap.date]     || '').trim() : '';

    /* Resolve category */
    var category = INV_CAT_ALIASES[catRaw] || INV_CAT_ALIASES[catRaw.replace(/\s+/g,'')] || invImportDefCat;

    /* Validation */
    if (!name) { warnings.push('Row ' + (idx + (isHeader?2:1)) + ': skipped — no name'); return; }
    if (qty <= 0) {
      warnings.push('Row ' + (idx + (isHeader?2:1)) + ': "' + name + '" — qty missing/zero, defaulting to 1');
      qty = 1;
    }
    if (avgPrice <= 0) {
      warnings.push('Row ' + (idx + (isHeader?2:1)) + ': "' + name + '" — avg price missing/zero');
    }

    parsed.push({
      name:     name,
      ticker:   ticker,
      qty:      qty,
      avgPrice: avgPrice,
      category: category,
      date:     date,
    });
  });

  invImportParsed = { rows: parsed, warnings: warnings, colMap: colMap, isHeader: isHeader };
  renderInvImportPreview(invImportParsed);
}

function renderInvImportPreview(parsed) {
  var rows     = parsed.rows;
  var warnings = parsed.warnings;

  document.getElementById('invImportPreview').style.display = 'block';

  /* Table head */
  var head = document.getElementById('invImportPreviewHead');
  var thStyle = 'padding:.55rem .75rem;text-align:left;font-size:.6rem;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);border-bottom:1px solid var(--border);white-space:nowrap';
  head.innerHTML = '<tr>'
    + ['Name','Ticker','Qty','Avg Price','Cost Basis','Category','Date'].map(function(h){
        return '<th style="' + thStyle + '">' + h + '</th>';
      }).join('')
    + '</tr>';

  /* Table body */
  var tbody = document.getElementById('invImportPreviewBody');
  var tdStyle = 'padding:.55rem .75rem;border-bottom:1px solid rgba(35,45,63,.4);font-size:.72rem;white-space:nowrap';

  /* Check for duplicate tickers in import */
  var tickerCount = {};
  rows.forEach(function(r){ if(r.ticker) tickerCount[r.ticker] = (tickerCount[r.ticker]||0)+1; });

  tbody.innerHTML = rows.slice(0, 30).map(function(r) {
    var meta      = CAT_META[r.category] || CAT_META.Others;
    var costBasis = r.qty * r.avgPrice;
    var isDup     = r.ticker && tickerCount[r.ticker] > 1;
    var rowBg     = isDup ? 'background:rgba(255,209,102,.04)' : '';
    return '<tr style="' + rowBg + '">'
      + '<td style="' + tdStyle + ';font-weight:600">' + invEsc(r.name) + '</td>'
      + '<td style="' + tdStyle + ';color:var(--accent4);font-family:var(--font-mono)">' + (r.ticker || '<span style="color:var(--muted)">—</span>') + '</td>'
      + '<td style="' + tdStyle + ';text-align:right">' + r.qty.toLocaleString('en-IN') + '</td>'
      + '<td style="' + tdStyle + ';text-align:right">₹' + r.avgPrice.toLocaleString('en-IN',{maximumFractionDigits:2}) + '</td>'
      + '<td style="' + tdStyle + ';text-align:right;font-weight:600">₹' + Math.round(costBasis).toLocaleString('en-IN') + '</td>'
      + '<td style="' + tdStyle + '"><span class="cat-badge ' + meta.class + '">' + meta.label + '</span></td>'
      + '<td style="' + tdStyle + ';color:var(--muted)">' + (r.date || '—') + '</td>'
      + '</tr>';
  }).join('') + (rows.length > 30
    ? '<tr><td colspan="7" style="' + tdStyle + ';color:var(--muted);text-align:center">…and ' + (rows.length-30) + ' more rows</td></tr>'
    : '');

  /* Summary */
  var totalInvested = rows.reduce(function(s,r){ return s + r.qty*r.avgPrice; }, 0);
  var withTickers   = rows.filter(function(r){ return r.ticker; }).length;
  var dupTickers    = Object.keys(tickerCount).filter(function(t){ return tickerCount[t]>1; });

  var sumEl = document.getElementById('invImportSummary');
  sumEl.innerHTML = '<strong style="color:var(--text)">' + rows.length + ' holdings</strong>'
    + ' &nbsp;·&nbsp; Total invested: <strong style="color:var(--accent4)">₹' + Math.round(totalInvested).toLocaleString('en-IN') + '</strong>'
    + ' &nbsp;·&nbsp; ' + withTickers + ' with live ticker'
    + (dupTickers.length ? ' &nbsp;·&nbsp; <span style="color:var(--accent3)">⚠ ' + dupTickers.length + ' duplicate ticker(s) will be merged</span>' : '');

  /* Warnings */
  var warnEl = document.getElementById('invImportWarnings');
  warnEl.innerHTML = warnings.length
    ? warnings.map(function(w){ return '⚠ ' + invEsc(w); }).join('<br>')
    : '';

  /* Enable/disable confirm */
  document.getElementById('invImportConfirmBtn').disabled = rows.length === 0;
}

function confirmInvImport() {
  if (!invImportParsed || !invImportParsed.rows.length) return;

  var imported = 0, merged = 0, skipped = 0;

  invImportParsed.rows.forEach(function(r) {
    if (!r.name) { skipped++; return; }

    /* Check if a holding with same ticker already exists → merge by weighted avg */
    var existing = r.ticker
      ? investmentsData.find(function(h){ return h.ticker && h.ticker.toUpperCase() === r.ticker; })
      : null;

    if (existing) {
      /* Weighted average price, sum quantities */
      var oldCost   = existing.qty * existing.avgPrice;
      var newCost   = r.qty * r.avgPrice;
      var totalQty  = existing.qty + r.qty;
      existing.avgPrice = totalQty > 0 ? (oldCost + newCost) / totalQty : existing.avgPrice;
      existing.qty      = totalQty;
      merged++;
    } else {
      investmentsData.push({
        id:        invId(),
        name:      r.name,
        ticker:    r.ticker,
        qty:       r.qty,
        avgPrice:  r.avgPrice,
        category:  r.category,
        date:      r.date,
        notes:     '',
        createdAt: Date.now(),
      });
      imported++;
    }
  });

  saveInvestments();
  closeInvImport();

  renderInvSummary();
  renderInvTabs();
  renderInvTable();
  renderInvAlloc();
  renderInvLivePanel();

  /* Auto-fetch live prices for newly imported tickers */
  invRefreshQuotes();

  var msg = imported + ' imported';
  if (merged)  msg += ', ' + merged + ' merged';
  if (skipped) msg += ', ' + skipped + ' skipped';
  showInvToast('✓ ' + msg, 'success');
}

/* ══════════════════════════════════════════════════════════
   CLEAR HOLDINGS
══════════════════════════════════════════════════════════ */
var invClearCat = 'ALL';

function openInvClearModal() {
  invClearCat = 'ALL';
  document.getElementById('invClearModal').classList.remove('hidden');
  _updateClearPills();
  _updateClearSummary();
}

function closeInvClearModal() {
  document.getElementById('invClearModal').classList.add('hidden');
}

function setInvClearCat(cat) {
  invClearCat = cat;
  _updateClearPills();
  _updateClearSummary();
}

function _updateClearPills() {
  document.querySelectorAll('#invClearCatPills .inv-cat-pill').forEach(function(p) {
    p.className = 'inv-cat-pill';
    var cat = p.dataset.cat;
    if (cat === invClearCat) {
      if (cat === 'ALL') {
        p.setAttribute('style', 'background:rgba(77,171,247,.1);color:var(--accent4);border-color:rgba(77,171,247,.4)');
      } else {
        p.classList.add('active-' + cat.toLowerCase().replace(' ', ''));
      }
    } else {
      p.removeAttribute('style');
    }
  });
}

function _updateClearSummary() {
  var targets = invClearCat === 'ALL'
    ? investmentsData
    : investmentsData.filter(function(h) { return h.category === invClearCat; });

  var totalCost = targets.reduce(function(s, h) { return s + (h.qty || 0) * (h.avgPrice || 0); }, 0);
  var el  = document.getElementById('invClearSummary');
  var btn = document.getElementById('invClearConfirmBtn');
  if (!el) return;

  if (!targets.length) {
    el.innerHTML = '<span style="color:var(--muted)">No holdings in this category.</span>';
    if (btn) btn.disabled = true;
    return;
  }

  if (btn) btn.disabled = false;
  el.innerHTML = '⚠️ This will permanently delete '
    + '<strong style="color:var(--accent2)">' + targets.length + ' holding' + (targets.length !== 1 ? 's' : '') + '</strong>'
    + (invClearCat !== 'ALL' ? ' in <strong style="color:var(--text)">' + invClearCat + '</strong>' : ' across all categories')
    + '.<br>Total cost basis: <strong style="color:var(--text)">₹' + Math.round(totalCost).toLocaleString('en-IN') + '</strong>'
    + '<br><span style="font-size:.65rem;color:var(--accent2)">This action cannot be undone.</span>';
}

function confirmInvClear() {
  var before = investmentsData.length;
  if (invClearCat === 'ALL') {
    investmentsData = [];
  } else {
    investmentsData = investmentsData.filter(function(h) { return h.category !== invClearCat; });
  }
  var deleted = before - investmentsData.length;

  /* Clear quote cache entries for removed tickers */
  var remaining = {};
  investmentsData.forEach(function(h) { if (h.ticker) remaining[h.ticker] = true; });
  Object.keys(invQuoteCache).forEach(function(t) { if (!remaining[t]) delete invQuoteCache[t]; });

  invSelectedId = null;
  saveInvestments();
  closeInvClearModal();

  renderInvSummary();
  renderInvTabs();
  renderInvTable();
  renderInvAlloc();
  renderInvLivePanel();
  invHideDetail();

  showInvToast('Deleted ' + deleted + ' holding' + (deleted !== 1 ? 's' : ''), 'success');
}

function initInvestments() {
  // Called on page load — nothing to do until goToInvestments()
}


// Close modal on overlay click
document.addEventListener('click', function(e){
  var modal = document.getElementById('invModal');
  if (modal && !modal.classList.contains('hidden') && e.target === modal.parentElement) {
    closeInvModal();
  }
});
