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
var invQuoteCache     = {};       // { ticker: { price, change, changePct, name, currency, ts } }
var goldPriceCache    = null;     // { pricePerGram, pricePerOz, ts, source }
var usdInrRate        = null;     // number — cached USD→INR rate
var usdInrTs          = 0;        // timestamp of last USD/INR fetch
var invSelectedId     = null;     // currently highlighted row
var invActiveCat      = 'ALL';    // tab filter
var invDetailTab      = 'chart';  // chart | financials | news
var invSortCol        = 'value';
var invSortAsc        = false;
var invPriceChartInst = null;
var invRefreshTimer   = null;
var invLiveEnabled    = true;   // persisted in localStorage
var invEditId         = null;     // null = new, string = editing
var invLots           = [];       // active lots while add/edit modal is open

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
function invLotId()   { return 'lot_' + Date.now() + '_' + Math.random().toString(36).slice(2,5); }
function invNow()     { return Date.now(); }
function showInvToast(msg, type) {
  if (typeof showToast === 'function') { showToast(msg, type === 'info' ? 'success' : (type || 'success')); return; }
  var t = document.createElement('div');
  t.className = 'toast ' + (type === 'info' ? 'success' : (type || 'success'));
  t.innerHTML = '<span>' + (type === 'error' ? '⚠' : '✓') + '</span><span>' + msg + '</span>';
  document.body.appendChild(t);
  setTimeout(function(){ t.classList.add('hide'); setTimeout(function(){ t.remove(); }, 350); }, 3500);
}

/* Categories that support multiple purchase records/lots */
var INV_LOTS_CATS = ['Stock', 'MF', 'ESOP', 'Bond', 'FD', 'Others'];

/* Returns the lots array for a holding; synthesises a single lot from
   legacy qty/avgPrice fields if the holding pre-dates this feature. */
function getHoldingLots(h) {
  if (h.lots && h.lots.length > 0) return h.lots;
  if ((h.qty > 0 || h.avgPrice > 0) && INV_LOTS_CATS.indexOf(h.category) >= 0) {
    return [{ id: h.id + '_l0', qty: h.qty || 0, avgPrice: h.avgPrice || 0, date: h.date || '', notes: '' }];
  }
  return [];
}
function getTotalQtyFromLots(lots) {
  return lots.reduce(function(s, l){ return s + (parseFloat(l.qty) || 0); }, 0);
}
function getWeightedAvgFromLots(lots) {
  var totalQty = getTotalQtyFromLots(lots);
  if (!totalQty) return 0;
  var totalCost = lots.reduce(function(s, l){ return s + (parseFloat(l.qty)||0) * (parseFloat(l.avgPrice)||0); }, 0);
  return totalCost / totalQty;
}

/* ── Lots UI helpers (used by modal) ──────────────────────────── */
function invRenderLots() {
  var tbody = document.getElementById('invLotsBody');
  if (!tbody) return;
  var isESOPOpt = (invSelectedCat === 'ESOP');
  tbody.innerHTML = invLots.map(function(lot, i) {
    return '<tr>'
      + '<td><input type="date" class="inv-form-input inv-lot-date" value="' + invEsc(lot.date || '') + '" oninput="invUpdateLotsSummary()" /></td>'
      + '<td><input type="number" class="inv-form-input inv-lot-qty" min="0" step="any" value="' + (lot.qty || '') + '" placeholder="10" oninput="invUpdateLotsSummary()" /></td>'
      + '<td><input type="number" class="inv-form-input inv-lot-price" min="0" step="any" value="' + (lot.avgPrice || '') + '" placeholder="' + (isESOPOpt ? 'optional' : '0.00') + '" oninput="invUpdateLotsSummary()" /></td>'
      + '<td><input type="text" class="inv-form-input inv-lot-notes" value="' + invEsc(lot.notes || '') + '" placeholder="optional" /></td>'
      + '<td><button type="button" class="inv-lot-del-btn" onclick="invRemoveLot(' + i + ')"'
      + (invLots.length <= 1 ? ' disabled' : '') + '>✕</button></td>'
      + '</tr>';
  }).join('');
  invUpdateLotsSummary();
}

function invReadLotsFromDOM() {
  var rows = document.querySelectorAll('#invLotsBody tr');
  rows.forEach(function(row, i) {
    if (!invLots[i]) return;
    var inputs = row.querySelectorAll('input');
    if (inputs[0]) invLots[i].date     = inputs[0].value;
    if (inputs[1]) invLots[i].qty      = parseFloat(inputs[1].value) || 0;
    if (inputs[2]) invLots[i].avgPrice = parseFloat(inputs[2].value) || 0;
    if (inputs[3]) invLots[i].notes    = inputs[3].value;
  });
}

function invUpdateLotsSummary() {
  invReadLotsFromDOM();
  var totalQty  = invLots.reduce(function(s, l){ return s + (l.qty || 0); }, 0);
  var totalCost = invLots.reduce(function(s, l){ return s + (l.qty || 0) * (l.avgPrice || 0); }, 0);
  var avgPrice  = totalQty ? totalCost / totalQty : 0;
  var qtyEl = document.getElementById('invLotsTotalQty');
  var avgEl = document.getElementById('invLotsAvgPrice');
  var invEl = document.getElementById('invLotsTotalInvested');
  if (qtyEl) qtyEl.textContent = totalQty ? totalQty.toLocaleString('en-IN', {maximumFractionDigits:4}) : '—';
  if (avgEl) avgEl.textContent = totalQty ? ('₹' + avgPrice.toLocaleString('en-IN', {minimumFractionDigits:2, maximumFractionDigits:2})) : '—';
  if (invEl) invEl.textContent = totalCost > 0 ? ('₹' + Math.round(totalCost).toLocaleString('en-IN')) : '—';
}

function invAddLot() {
  invReadLotsFromDOM();
  invLots.push({ id: invLotId(), qty: 0, avgPrice: 0, date: new Date().toISOString().slice(0,10), notes: '' });
  invRenderLots();
  var tbody = document.getElementById('invLotsBody');
  if (tbody) { var rows = tbody.querySelectorAll('tr'); if (rows.length) rows[rows.length-1].querySelector('input').focus(); }
}

function invRemoveLot(idx) {
  if (invLots.length <= 1) return;
  invReadLotsFromDOM();
  invLots.splice(idx, 1);
  invRenderLots();
}

var CAT_META = {
  Stock:       { label:'Stock',       class:'cat-stock',      color:'#00e5a0', icon:'📈' },
  MF:          { label:'Mutual Fund', class:'cat-mf',         color:'#4dabf7', icon:'🏦' },
  Bond:        { label:'Bond/FD',     class:'cat-bond',       color:'#ffd166', icon:'📄' },
  FD:          { label:'FD',          class:'cat-bond',       color:'#ffd166', icon:'🏧' },
  EPF:         { label:'EPF',         class:'cat-epf',        color:'#06b6d4', icon:'🏛️' },
  ESOP:        { label:'ESOP',        class:'cat-esop',       color:'#c084fc', icon:'💎' },
  RealEstate:  { label:'Real Estate', class:'cat-realestate', color:'#a78bfa', icon:'🏠' },
  Gold:        { label:'Gold',        class:'cat-gold',       color:'#f0b429', icon:'🥇' },
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

async function loadInvestments() {
  var raw   = localStorage.getItem(getInvKey());
  var email = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.email : null;
  investmentsData = raw ? ((await decryptFromStorage(raw, email)) || []) : [];
}

async function saveInvestments() {
  var email = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.email : null;
  localStorage.setItem(getInvKey(), await encryptForStorage(investmentsData, email));
  invSyncSave();
}

function invSyncSave() {
  if (typeof syncReady === 'undefined' || !syncReady || typeof db === 'undefined' || !db) return;
  var uid = (typeof fbAuth !== 'undefined' && fbAuth && fbAuth.currentUser)
    ? fbAuth.currentUser.uid : null;
  if (!uid) return;
  var email = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.email : null;
  encryptForStorage({ investments: investmentsData }, email).then(function(encStr) {
    db.collection('users').doc(uid).collection('config').doc('investments')
      .set({ _enc: encStr })
      .catch(function(e){ console.warn('[Inv] Firestore save failed:', e.message); });
  });
}

function invSyncLoad() {
  if (typeof syncReady === 'undefined' || !syncReady || typeof db === 'undefined' || !db) return Promise.resolve();
  var uid = (typeof fbAuth !== 'undefined' && fbAuth && fbAuth.currentUser)
    ? fbAuth.currentUser.uid : null;
  if (!uid) return Promise.resolve();
  var email = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.email : null;
  return db.collection('users').doc(uid).collection('config').doc('investments').get()
    .then(async function(snap) {
      if (!snap.exists) return;
      var d = snap.data();
      var holdings;
      if (d._enc) {
        var dec = await decryptFromStorage(d._enc, email);
        holdings = dec && dec.investments;
      } else {
        holdings = d.investments;
      }
      if (!Array.isArray(holdings)) return;
      investmentsData = holdings;
      localStorage.setItem(getInvKey(), await encryptForStorage(investmentsData, email));
      console.info('[Inv] ✅ Loaded from Firestore:', investmentsData.length, 'holdings');
    })
    .catch(function(e) { console.warn('[Inv] Firestore load failed:', e.message); });
}

/* ══════════════════════════════════════════════════════════
   NAVIGATION
══════════════════════════════════════════════════════════ */
function goToInvestments() {
  history.pushState({ screen: 'investments' }, '');
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

/* ── Set this to your deployed Cloudflare Worker URL ──────────────
   Deploy worker/yf-proxy.js to Cloudflare Workers (free tier).
   Worker URL format: https://yf-proxy.<subdomain>.workers.dev
   Leave as null to skip and fall through to the public proxies.
─────────────────────────────────────────────────────────────────── */
var INV_CF_WORKER_URL = 'https://yf-proxy.t-r-harikrish.workers.dev'; // e.g. 'https://yf-proxy.abc123.workers.dev'

var INV_PROXIES = [
  /* 1. Own Cloudflare Worker — fastest, most reliable, full header control.
        Skipped automatically if INV_CF_WORKER_URL is null. */
  function(url) {
    if (!INV_CF_WORKER_URL) return Promise.reject(new Error('cf-worker not configured'));
    var proxyUrl = INV_CF_WORKER_URL + '?url=' + encodeURIComponent(url);
    return invTimedFetch(proxyUrl, 8000)
      .then(function(r) {
        if (!r.ok) throw new Error('cf-worker ' + r.status);
        return r.json();
      });
  },
  /* 2. api.codetabs.com — doesn't forward auth headers, Yahoo treats it as
        anonymous browser traffic */
  function(url) {
    var proxyUrl = 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(url);
    return invTimedFetch(proxyUrl, 7000)
      .then(function(r) {
        if (!r.ok) throw new Error('codetabs ' + r.status);
        return r.json();
      });
  },
  /* 3. corsproxy.io — Yahoo sometimes 403s its IP range */
  function(url) {
    var proxyUrl = 'https://corsproxy.io/?' + encodeURIComponent(url);
    return invTimedFetch(proxyUrl, 6000)
      .then(function(r) {
        if (!r.ok) throw new Error('corsproxy ' + r.status);
        return r.json();
      });
  },
  /* 4. thingproxy.freeboard.io — different IP pool */
  function(url) {
    var proxyUrl = 'https://thingproxy.freeboard.io/fetch/' + url;
    return invTimedFetch(proxyUrl, 8000)
      .then(function(r) {
        if (!r.ok) throw new Error('thingproxy ' + r.status);
        return r.json();
      });
  },
  /* 5. allorigins.win raw — last resort */
  function(url) {
    var proxyUrl = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url);
    return invTimedFetch(proxyUrl, 8000)
      .then(function(r) {
        if (!r.ok) throw new Error('allorigins ' + r.status);
        return r.json();
      });
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
   Tries v7/quote first (lighter, less blocked), then v8/chart.
══════════════════════════════════════════════════════════ */
function invFetchQuote(ticker) {
  /* v7/quote — simpler endpoint, less aggressively rate-limited */
  var v7url = 'https://query1.finance.yahoo.com/v7/finance/quote?symbols='
            + encodeURIComponent(ticker)
            + '&fields=regularMarketPrice,regularMarketPreviousClose,shortName,longName,currency';

  /* v8/chart — heavier but carries more meta; used as fallback */
  var v8url = 'https://query2.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(ticker)
            + '?interval=1d&range=1d';

  function parseV7(data) {
    var q = data && data.quoteResponse && data.quoteResponse.result && data.quoteResponse.result[0];
    if (!q || !isFinite(q.regularMarketPrice) || q.regularMarketPrice <= 0)
      throw new Error('no v7 result for ' + ticker);
    var price     = parseFloat(q.regularMarketPrice);
    var prevClose = parseFloat(q.regularMarketPreviousClose || price);
    var change    = price - prevClose;
    var changePct = prevClose ? (change / prevClose) * 100 : 0;
    return {
      ticker:    ticker,
      name:      q.shortName || q.longName || q.symbol || ticker,
      price:     price,
      change:    isFinite(change)    ? change    : 0,
      changePct: isFinite(changePct) ? changePct : 0,
      currency:  q.currency || 'INR',
      ts:        Date.now(),
    };
  }

  function parseV8(data) {
    var result = data && data.chart && data.chart.result && data.chart.result[0];
    if (!result) throw new Error('no v8 result for ' + ticker);
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
  }

  return invProxyFetch(v7url)
    .then(parseV7)
    .catch(function(e) {
      console.warn('[InvQuote] v7 failed for', ticker, '—', e.message, '— trying v8/chart');
      return invProxyFetch(v8url).then(parseV8);
    });
}

/* ── Gold Live Price (CoinGecko → Yahoo Finance fallback) ───── */
var TROY_OZ_TO_G = 31.1035;

function fetchGoldPriceINR() {
  // Return cached value if < 30 min old
  if (goldPriceCache && (Date.now() - goldPriceCache.ts < 30 * 60 * 1000)) {
    return Promise.resolve(goldPriceCache);
  }

  // Primary: CoinGecko — PAX Gold is backed 1:1 by 1 troy oz, returns INR
  return fetch('https://api.coingecko.com/api/v3/simple/price?ids=pax-gold&vs_currencies=inr')
    .then(function(r) { if (!r.ok) throw new Error('CG HTTP ' + r.status); return r.json(); })
    .then(function(data) {
      var oz = data && data['pax-gold'] && data['pax-gold'].inr;
      if (!oz || oz <= 0) throw new Error('CG: no price');
      goldPriceCache = {
        pricePerGram: oz / TROY_OZ_TO_G,
        pricePerOz:   oz,
        ts:           Date.now(),
        source:       'CoinGecko'
      };
      return goldPriceCache;
    })
    .catch(function() {
      // Fallback: Yahoo Finance GC=F (COMEX gold, USD/troy oz) + USDINR=X
      return Promise.all([
        invFetchQuote('GC=F'),
        invFetchQuote('USDINR=X')
      ]).then(function(results) {
        var goldUSD = qPrice(results[0]);
        var usdInr  = qPrice(results[1]);
        if (!goldUSD || !usdInr) throw new Error('Yahoo gold fallback failed');
        goldPriceCache = {
          pricePerGram: (goldUSD * usdInr) / TROY_OZ_TO_G,
          pricePerOz:   goldUSD * usdInr,
          ts:           Date.now(),
          source:       'Yahoo Finance'
        };
        return goldPriceCache;
      });
    });
}

/* ── USD → INR exchange rate (cached 15 min) ────────────────── */
function fetchUsdInrRate() {
  var now = Date.now();
  if (usdInrRate && (now - usdInrTs < 15 * 60 * 1000)) return Promise.resolve(usdInrRate);
  return invFetchQuote('USDINR=X').then(function(q) {
    usdInrRate = qPrice(q);
    usdInrTs   = Date.now();
    return usdInrRate;
  });
}

/* Convert a price in any currency to INR.
   Currently handles USD; other currencies fall through unchanged. */
function toInr(price, currency) {
  if (!currency || currency === 'INR') return price;
  if (currency === 'USD' && usdInrRate) return price * usdInrRate;
  return price; // unknown currency — return raw (rare: GBP, EUR etc.)
}

function invFetchAllQuotes() {
  var tickers = [];
  investmentsData.forEach(function(h) {
    if ((h.category === 'Stock' || h.category === 'MF' || h.category === 'ESOP') && h.ticker) {
      if (tickers.indexOf(h.ticker) === -1) tickers.push(h.ticker);
    }
  });
  if (!tickers.length) return Promise.resolve();

  if (typeof setInvLiveDot === 'function') setInvLiveDot(true);

  /* Pre-fetch USD/INR rate so currency conversion is ready for the first
     batch render. Failure is silently ignored — values fall back to raw prices. */
  return fetchUsdInrRate().catch(function() {}).then(function() {
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
  });
}

function invRefreshQuotes() {
  var btn = document.getElementById('invRefreshBtn');
  if (btn) { btn.textContent = '⟳ Refreshing…'; btn.disabled = true; }
  invFetchAllQuotes().then(function(){
    if (typeof setInvLiveDot === 'function') setInvLiveDot(false);
    renderInvTable();
    renderInvSummary();
    renderInvLivePanel();
    if (invSelectedId) {
      var h = investmentsData.find(function(x){ return x.id === invSelectedId; });
      if (h) invSetDetailTab(invDetailTab, h);
    }
    if (btn) { btn.textContent = '⟳ Refresh Live Prices'; btn.disabled = false; }
  }).catch(function(){
    if (typeof setInvLiveDot === 'function') setInvLiveDot(false);
    if (btn) { btn.textContent = '⟳ Refresh Live Prices'; btn.disabled = false; }
  });
}

function invStartAutoRefresh() {
  invStopAutoRefresh();
  if (!invLiveEnabled) return;
  var hasGold = investmentsData.some(function(h){ return h.category === 'Gold'; });
  var refresh = function() {
    var jobs = [invFetchAllQuotes()];
    if (hasGold) jobs.push(fetchGoldPriceINR().catch(function(){}));
    Promise.all(jobs).then(function(){
      if (typeof setInvLiveDot === 'function') setInvLiveDot(false);
      renderInvTable(); renderInvSummary(); renderInvLivePanel();
    });
  };
  refresh();
  invRefreshTimer = setInterval(function(){
    if (!invLiveEnabled) { invStopAutoRefresh(); return; }
    refresh();
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
    var cost = getCostBasis(h);
    var live = getLiveValue(h);
    invested   += cost;
    currentVal += live > 0 ? live : cost;
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
    return (((h.category === 'Stock' || h.category === 'MF' || h.category === 'ESOP') && h.ticker) || (h.category === 'Gold'));
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
  var cats   = ['ALL', 'Stock', 'MF', 'Bond', 'FD', 'EPF', 'ESOP', 'RealEstate', 'Gold', 'Others'];
  var labels = { ALL:'All', Stock:'Stocks', MF:'Mutual Funds', Bond:'Bond', FD:'FD', EPF:'EPF', ESOP:'ESOPs', RealEstate:'Real Estate', Gold:'Gold', Others:'Others' };
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
  if (h.category === 'Gold') {
    var grams = h.grams || h.qty || 0;
    if (goldPriceCache && goldPriceCache.pricePerGram) return grams * goldPriceCache.pricePerGram;
    return grams * (h.buyPricePerGram || h.avgPrice || 0);
  }
  if (h.category === 'RealEstate' || h.category === 'EPF') {
    return h.curPrice || h.buyPrice || h.avgPrice || 0;
  }
  var lots = (h.lots && h.lots.length) ? h.lots : null;
  var qty  = lots ? getTotalQtyFromLots(lots) : (h.qty || 0);
  var q    = (h.category === 'Stock' || h.category === 'MF' || h.category === 'ESOP') && h.ticker && invQuoteCache[h.ticker];
  if (q && qty) return toInr(qPrice(q), q.currency) * qty;
  var avgP = lots ? getWeightedAvgFromLots(lots) : (h.avgPrice || 0);
  return avgP * qty;
}

function getCostBasis(h) {
  var cost = 0;
  if (h.category === 'Gold') {
    var buyPPG = h.buyPricePerGram || h.avgPrice || 0;
    cost = buyPPG > 0 ? (h.grams || h.qty || 0) * buyPPG : 0;
  } else if (h.category === 'EPF') {
    cost = h.buyPrice || 0;
  } else if (h.category === 'RealEstate') {
    cost = h.buyPrice || h.avgPrice || 0;
  } else if (h.lots && h.lots.length) {
    cost = h.lots.reduce(function(s, l){ return s + (parseFloat(l.qty)||0) * (parseFloat(l.avgPrice)||0); }, 0);
  } else {
    cost = (h.avgPrice || 0) * (h.qty || 0);
  }
  // For these categories cost basis is optional — when not provided, treat
  // invested = current value so P&L shows as 0 instead of inflating returns.
  if (cost <= 0 && (h.category === 'EPF' || h.category === 'Gold' ||
                    h.category === 'ESOP' || h.category === 'RealEstate')) {
    return getLiveValue(h);
  }
  return cost;
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
    var q     = (h.category === 'Stock' || h.category === 'MF' || h.category === 'ESOP') && h.ticker && invQuoteCache[h.ticker];
    var liveVal = getLiveValue(h);
    var pnl   = liveVal - getCostBasis(h);
    var pnlPct = getCostBasis(h) ? (pnl / getCostBasis(h)) * 100 : 0;
    var isPos  = pnl >= 0;
    var isLive = !!(q && h.ticker);
    var isSelected = h.id === invSelectedId;

    var priceCell = '';
    if (isLive) {
      var _isUSD = q.currency && q.currency !== 'INR';
      var _qCur  = _isUSD ? q.currency + ' ' : '₹';
      priceCell = '<span class="inv-live-dot"></span>'
        + _qCur + qPrice(q).toFixed(2)
        + (_isUSD && usdInrRate
            ? '<br><span style="color:var(--muted);font-size:.58rem">≈ ₹' + toInr(qPrice(q), q.currency).toFixed(2) + '</span>'
            : '')
        + '<br><span class="' + (qChgPct(q) >= 0 ? 'inv-change-pos' : 'inv-change-neg') + '" style="font-size:.6rem">'
        + fmtIPct(qChgPct(q)) + '</span>';
    } else if (h.ticker) {
      priceCell = '<span style="color:var(--muted);font-size:.65rem">Fetching…</span>';
    } else {
      priceCell = '<span style="color:var(--muted);font-size:.65rem">—</span>';
    }

    var bg = isSelected ? '' : '';
    var needsTicker = (h.category === 'Stock' || h.category === 'MF' || h.category === 'ESOP');
    var isUnidentified = needsTicker && !h.ticker;
    var initials = h.name.split(' ').slice(0,2).map(function(w){ return w[0]; }).join('').toUpperCase().slice(0,2);

    /* Mobile card body — display:none on desktop, flex on ≤700px */
    var _mobileEditFn = "openInvModal('" + h.id + "')";
    var mobileBody = '<div class="inv-mobile-card-body">'
      + '<div class="inv-mobile-stat"><span class="inv-mobile-stat-label">Category</span>'
      + '<span class="inv-mobile-stat-val"><span class="cat-badge ' + meta.class + '">' + meta.label + '</span></span></div>'
      + '<div class="inv-mobile-stat"><span class="inv-mobile-stat-label">Cur. Value</span>'
      + '<span class="inv-mobile-stat-val">' + fmtI(liveVal) + '</span></div>'
      + '<div class="inv-mobile-stat"><span class="inv-mobile-stat-label">P&amp;L</span>'
      + '<span class="inv-mobile-stat-val ' + (isPos ? 'inv-change-pos' : 'inv-change-neg') + '">'
      + (isPos ? '+' : '') + fmtI(pnl) + ' (' + fmtIPct(pnlPct) + ')</span></div>'
      + (isLive && q ? '<div class="inv-mobile-stat"><span class="inv-mobile-stat-label">Live</span>'
      + '<span class="inv-mobile-stat-val ' + (qChgPct(q) >= 0 ? 'inv-change-pos' : 'inv-change-neg') + '">'
      + '<span class="inv-live-dot"></span>' + qPrice(q).toFixed(2) + '</span></div>' : '')
      + '<button class="inv-mobile-edit-btn" onclick="event.stopPropagation();' + _mobileEditFn + '">✏️ Edit</button>'
      + '</div>';

    return '<tr class="' + (isSelected ? 'selected' : '') + (isUnidentified ? ' inv-no-ticker' : '') + '" onclick="invSelectRow(\'' + h.id + '\')" '
           + 'ondblclick="openInvModal(\'' + h.id + '\')">'
           + '<td><div class="inv-ticker-cell">'
           + '<div class="inv-ticker-icon" style="background:' + meta.color + '18;color:' + meta.color + '">'
           + (h.ticker ? h.ticker.slice(0,3) : initials) + '</div>'
           + '<div><div class="inv-ticker-name">' + invEsc(h.name) + '</div>'
           + (h.category === 'Gold'
               ? '<div class="inv-ticker-sub">' + (h.grams||h.qty||0) + ' g</div>'
               : (h.ticker ? '<div class="inv-ticker-sub">' + invEsc(h.ticker)
                    + (function(){ var _q = getTotalQtyFromLots(getHoldingLots(h)); return (_q && h.category !== 'RealEstate') ? ' · ' + _q.toLocaleString('en-IN',{maximumFractionDigits:4}) + ' units' : ''; })()
                    + (h.lots && h.lots.length > 1 ? ' · <span style="color:var(--accent4)">' + h.lots.length + ' lots</span>' : '')
                    + '</div>' : (isUnidentified ? '<div class="inv-no-ticker-badge">⚠ No ticker</div>' : '')))
           + '</div></div>' + mobileBody + '</td>'
           + '<td><span class="cat-badge ' + meta.class + '">' + meta.label + '</span></td>'
           + '<td style="text-align:right">'
           + (h.category === 'Gold' && goldPriceCache
               ? '<span class="inv-live-dot"></span>₹' + goldPriceCache.pricePerGram.toLocaleString('en-IN',{maximumFractionDigits:0}) + '/g'
               : priceCell)
           + '</td>'
           + '<td style="text-align:right">'
           + (h.category === 'Gold'
               ? ('<div style="font-weight:600">' + (h.grams||h.qty||0) + ' g</div>'
                 + (h.buyPricePerGram || h.avgPrice
                   ? '<div style="font-size:.62rem;color:var(--muted)">Buy: ₹' + (h.buyPricePerGram||h.avgPrice||0).toLocaleString('en-IN',{maximumFractionDigits:0}) + '/g</div>'
                   : ''))
               : h.category === 'RealEstate'
               ? ('<div style="font-weight:600">Buy: ₹' + (h.buyPrice||h.avgPrice||0).toLocaleString('en-IN',{maximumFractionDigits:0}) + '</div>'
                 + (h.curPrice ? '<div style="font-size:.62rem;color:var(--muted)">Now: ₹' + h.curPrice.toLocaleString('en-IN',{maximumFractionDigits:0}) + '</div>' : ''))
               : (function(){
                    var lots    = getHoldingLots(h);
                    var totalQty = getTotalQtyFromLots(lots);
                    var wavg    = getWeightedAvgFromLots(lots);
                    if (!totalQty && !wavg) return '—';
                    return '<div style="font-weight:600">' + totalQty.toLocaleString('en-IN',{maximumFractionDigits:4}) + ' units</div>'
                      + (lots.length > 1
                        ? '<div style="font-size:.62rem;color:var(--accent4)">' + lots.length + ' lots · avg ₹' + wavg.toLocaleString('en-IN',{maximumFractionDigits:2}) + '</div>'
                        : '<div style="font-size:.62rem;color:var(--muted)">@ ₹' + wavg.toLocaleString('en-IN',{maximumFractionDigits:2}) + '</div>');
                  })())
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
   ALLOCATION BAR
══════════════════════════════════════════════════════════ */
function renderInvAlloc() {
  var totals = {};
  Object.keys(CAT_META).forEach(function(c){ totals[c] = 0; });
  investmentsData.forEach(function(h){ totals[h.category] = (totals[h.category]||0) + getLiveValue(h); });
  var total = Object.values(totals).reduce(function(a,b){ return a+b; }, 0);

  var catKeys = Object.keys(CAT_META).filter(function(c){ return totals[c] > 0; });

  // Stacked horizontal bar
  var bar = document.getElementById('invAllocBar');
  if (bar) {
    if (!catKeys.length) {
      bar.innerHTML = '';
    } else {
      bar.innerHTML = catKeys.map(function(c){
        var pct = total ? ((totals[c] / total) * 100) : 0;
        var label = CAT_META[c].label;
        return '<div class="inv-alloc-seg" data-cat="' + c + '" style="width:' + pct.toFixed(2) + '%;background:' + CAT_META[c].color + '" title="' + label + ': ' + pct.toFixed(1) + '%"></div>';
      }).join('');
      bar.querySelectorAll('.inv-alloc-seg').forEach(function(seg){
        seg.addEventListener('click', function(){ invAllocSelect(seg.dataset.cat); });
      });
    }
  }

  // Legend chips
  var legend = document.getElementById('invAllocLegend');
  if (legend) {
    legend.innerHTML = catKeys.map(function(c){
      var pct = total ? ((totals[c] / total) * 100).toFixed(1) : 0;
      return '<div class="inv-alloc-item" data-cat="' + c + '">'
        + '<div class="inv-alloc-dot" style="background:' + CAT_META[c].color + '"></div>'
        + '<span class="inv-alloc-name">' + CAT_META[c].label + '</span>'
        + '<span class="inv-alloc-val">' + fmtI(totals[c]) + '</span>'
        + '<span class="inv-alloc-pct">' + pct + '%</span>'
        + '</div>';
    }).join('') || '<div style="color:var(--muted);font-size:.72rem;padding:.5rem 0">No holdings yet</div>';
    legend.querySelectorAll('.inv-alloc-item').forEach(function(chip){
      chip.addEventListener('click', function(){ invAllocSelect(chip.dataset.cat); });
    });
  }
}

function invAllocSelect(cat) {
  var segs  = document.querySelectorAll('#invAllocBar .inv-alloc-seg');
  var chips = document.querySelectorAll('#invAllocLegend .inv-alloc-item');
  var activeSeg  = document.querySelector('#invAllocBar .inv-alloc-seg[data-cat="' + cat + '"]');
  var isActive   = activeSeg && activeSeg.classList.contains('inv-alloc-active');

  segs.forEach(function(s)  { s.classList.remove('inv-alloc-active', 'inv-alloc-dim'); });
  chips.forEach(function(c) { c.classList.remove('inv-alloc-active', 'inv-alloc-dim'); });

  if (isActive) return; // clicking same → deselect

  segs.forEach(function(s){
    s.classList.add(s.dataset.cat === cat ? 'inv-alloc-active' : 'inv-alloc-dim');
  });
  chips.forEach(function(c){
    c.classList.add(c.dataset.cat === cat ? 'inv-alloc-active' : 'inv-alloc-dim');
  });
}

/* ══════════════════════════════════════════════════════════
   LIVE TICKER PANEL
══════════════════════════════════════════════════════════ */
function renderInvLivePanel() {
  var list = document.getElementById('invLiveList');
  if (!list) return;

  var trackedHoldings = investmentsData.filter(function(h){
    return (h.category === 'Stock' || h.category === 'MF' || h.category === 'ESOP') && h.ticker;
  });

  if (!trackedHoldings.length) {
    list.innerHTML = '<div style="color:var(--muted);font-size:.72rem;text-align:center;padding:.75rem 0">Add stocks/MFs/ESOPs with tickers to see live prices</div>';
    return;
  }

  list.innerHTML = trackedHoldings.map(function(h){
    var q    = invQuoteCache[h.ticker];
    var pos  = q ? qChgPct(q) >= 0 : true;
    var isUSD = q && q.currency && q.currency !== 'INR';
    var priceStr = q
      ? (isUSD
          ? q.currency + ' ' + qPrice(q).toFixed(2)
            + (usdInrRate ? '<br><span style="color:var(--muted);font-size:.58rem">≈ ₹' + toInr(qPrice(q), q.currency).toFixed(2) + '</span>' : '')
          : '₹' + qPrice(q).toFixed(2))
      : '…';
    return '<div class="inv-live-item">'
      + '<div><div class="inv-live-ticker">' + invEsc(h.ticker) + '</div>'
      + '<div class="inv-live-name">' + invEsc(h.name.slice(0,22)) + (h.name.length > 22 ? '…' : '') + '</div></div>'
      + '<div class="inv-live-right">'
      + '<div class="inv-live-price">' + priceStr + '</div>'
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

  if (h.category === 'Gold') {
    var grams    = h.grams || h.qty || 0;
    var buyPPG   = h.buyPricePerGram || h.avgPrice || 0;
    var livePPG  = goldPriceCache ? goldPriceCache.pricePerGram : 0;
    var hasCost  = buyPPG > 0;
    return '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:.65rem;margin-top:.85rem">'
      + invStatBox('Weight',        grams + ' g',                                            'var(--accent3)')
      + invStatBox('Buy Price / g', hasCost ? fmtI2(buyPPG) : '—',                          'var(--muted)')
      + invStatBox('Cost Basis',    hasCost ? fmtI(cost) : '—',                             'var(--accent4)')
      + invStatBox('Live Price / g',livePPG ? fmtI2(livePPG) + '<span style="font-size:.6rem;color:var(--muted)"> /g</span>' : '—', livePPG ? 'var(--accent3)' : 'var(--muted)')
      + invStatBox('Current Value', lv > 0 ? fmtI(lv) : '—',                               'var(--text)')
      + invStatBox('Unrealised P&L',hasCost && lv > 0 ? (pos?'+':'')+fmtI(pnl) : '—',      hasCost && lv > 0 ? (pos?'var(--accent)':'var(--accent2)') : 'var(--muted)')
      + invStatBox('Return %',      hasCost && lv > 0 ? fmtIPct(pct) : '—',                hasCost && lv > 0 ? (pos?'var(--accent)':'var(--accent2)') : 'var(--muted)')
      + (goldPriceCache ? invStatBox('Price Source', goldPriceCache.source, 'var(--muted)') : '')
      + '</div>';
  }
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
function openInvModal(id, defaultCat) {
  invEditId = id || null;
  var h = id ? investmentsData.find(function(x){ return x.id === id; }) : null;
  var modal = document.getElementById('invModal');
  if (!modal) return;

  document.getElementById('invModalTitle').textContent = h ? '✏️ Edit Holding' : '➕ Add Investment';
  document.getElementById('invFormName').value         = h ? h.name         : '';
  document.getElementById('invFormTicker').value       = h ? (h.ticker||'') : '';
  document.getElementById('invFormDate').value         = h ? (h.date||'')   : new Date().toISOString().slice(0,10);
  document.getElementById('invFormNotes').value        = h ? (h.notes||'')  : '';

  // When adding new: honour caller-supplied defaultCat (e.g. active filter tab), else 'Stock'
  var _cat   = h ? h.category : (defaultCat || 'Stock');
  var _isRE  = _cat === 'RealEstate';
  var _isEPF = _cat === 'EPF';
  var _isGold= _cat === 'Gold';

  if (_isRE || _isEPF) {
    document.getElementById('invFormBuyPrice').value   = h ? (h.buyPrice||'')  : '';
    document.getElementById('invFormCurPrice').value   = h ? (h.curPrice||'')  : '';
    document.getElementById('invFormGrams').value      = '';
    document.getElementById('invFormBuyPerGram').value = '';
    invLots = [];
  } else if (_isGold) {
    document.getElementById('invFormGrams').value      = h ? (h.grams || h.qty || '') : '';
    document.getElementById('invFormBuyPerGram').value = h ? (h.buyPricePerGram || '') : '';
    document.getElementById('invFormBuyPrice').value   = '';
    document.getElementById('invFormCurPrice').value   = '';
    invLots = [];
  } else {
    // Standard lots-based categories: initialise invLots from saved data or create a blank first lot
    document.getElementById('invFormBuyPrice').value   = '';
    document.getElementById('invFormCurPrice').value   = '';
    document.getElementById('invFormGrams').value      = '';
    document.getElementById('invFormBuyPerGram').value = '';
    if (h && h.lots && h.lots.length > 0) {
      invLots = h.lots.map(function(l){ return { id: l.id, qty: l.qty, avgPrice: l.avgPrice || 0, date: l.date || '', notes: l.notes || '' }; });
    } else if (h) {
      // Migrate legacy single qty/avgPrice entry to a lot
      invLots = [{ id: h.id + '_l0', qty: h.qty || 0, avgPrice: h.avgPrice || 0, date: h.date || '', notes: '' }];
    } else {
      invLots = [{ id: invLotId(), qty: 0, avgPrice: 0, date: new Date().toISOString().slice(0,10), notes: '' }];
    }
  }

  invCalcREPreview();
  invSetCatPill(_cat);
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

  var isRE   = (cat === 'RealEstate');
  var isEPF  = (cat === 'EPF');
  var isGold = (cat === 'Gold');
  var isLive = (cat === 'Stock' || cat === 'MF' || cat === 'ESOP');
  var isESOPOpt = (cat === 'ESOP');  // ticker is optional for ESOPs
  var isSpecial = isRE || isGold || isEPF;

  // Ticker row: Stock / MF / ESOP (optional for ESOP)
  var tickerRow = document.getElementById('invTickerRow');
  if (tickerRow) tickerRow.style.display = isLive ? '' : 'none';

  // Update ticker label/hint for ESOP vs Stock/MF
  var tickerLabel = document.getElementById('invTickerLabel');
  var tickerInput = document.getElementById('invFormTicker');
  if (tickerLabel) tickerLabel.innerHTML = isESOPOpt
    ? 'Ticker Symbol <span style="color:var(--muted);text-transform:none;font-weight:400;font-size:.62rem">(optional — enables live prices)</span>'
    : 'Ticker Symbol <span style="color:var(--muted);text-transform:none;font-weight:400;font-size:.62rem">(for live prices)</span>';
  if (tickerInput) tickerInput.placeholder = isESOPOpt
    ? 'e.g. INFY.NS (leave blank for manual value)'
    : 'e.g. RELIANCE.NS / INFY.NS / 0P0001FOP8.BO';

  // Purchase records (lots) section: show for Stock / MF / ESOP / Bond / FD / Others
  var lotsSection   = document.getElementById('invLotsSection');
  var avgPriceLabel = document.getElementById('invAvgPriceLabel');
  var thPrice       = document.getElementById('invLotsThPrice');
  if (lotsSection) lotsSection.style.display = isSpecial ? 'none' : '';
  // Section header label
  if (avgPriceLabel) {
    avgPriceLabel.innerHTML = isESOPOpt
      ? 'Purchase Records <span style="color:var(--muted);text-transform:none;font-weight:400;font-size:.62rem">(grant price optional)</span>'
      : 'Purchase Records *';
  }
  // Price column header in the lots table
  if (thPrice) thPrice.textContent = isESOPOpt ? 'Grant Price (₹/unit)' : 'Avg Price (₹/unit) *';
  // When switching to a lots category and invLots is empty, seed one blank lot
  if (!isSpecial && invLots.length === 0) {
    invLots = [{ id: invLotId(), qty: 0, avgPrice: 0, date: new Date().toISOString().slice(0,10), notes: '' }];
  }
  if (!isSpecial) invRenderLots();

  // RE / EPF shared rows (buy price + current value)
  var buyPriceRow      = document.getElementById('invBuyPriceRow');
  var curPriceRow      = document.getElementById('invCurPriceRow');
  var rePreview        = document.getElementById('invREPreviewRow');
  var buyPriceLabelEl  = document.getElementById('invBuyPriceLabelText');
  var curPriceLabelEl  = document.getElementById('invCurPriceLabelText');
  var buyPriceInput    = document.getElementById('invFormBuyPrice');
  var curPriceInput    = document.getElementById('invFormCurPrice');
  var reGainLabelEl    = document.getElementById('invREGainLabel');

  if (buyPriceRow) buyPriceRow.style.display = (isRE || isEPF) ? '' : 'none';
  if (curPriceRow) curPriceRow.style.display = (isRE || isEPF) ? '' : 'none';
  if (rePreview)   rePreview.style.display   = 'none';

  if (isEPF) {
    if (buyPriceLabelEl) buyPriceLabelEl.innerHTML = 'Total Contributed (₹) <span style="color:var(--muted);text-transform:none;font-weight:400;font-size:.62rem"> optional</span>';
    if (curPriceLabelEl) curPriceLabelEl.innerHTML = 'Current Balance (₹) <span style="color:var(--muted);text-transform:none;font-weight:400;font-size:.62rem"> optional</span>';
    if (buyPriceInput)   buyPriceInput.placeholder   = 'e.g. 250000';
    if (curPriceInput)   curPriceInput.placeholder   = 'e.g. 310000';
    if (reGainLabelEl)   reGainLabelEl.textContent   = 'Growth';
  } else if (isRE) {
    if (buyPriceLabelEl) buyPriceLabelEl.innerHTML = 'Buy Price (₹) <span style="color:var(--muted);text-transform:none;font-weight:400;font-size:.62rem"> optional</span>';
    if (curPriceLabelEl) curPriceLabelEl.innerHTML = 'Current Market Value (₹) <span style="color:var(--muted);text-transform:none;font-weight:400;font-size:.62rem"> optional</span>';
    if (buyPriceInput)   buyPriceInput.placeholder   = 'e.g. 5000000';
    if (curPriceInput)   curPriceInput.placeholder   = 'e.g. 7500000';
    if (reGainLabelEl)   reGainLabelEl.textContent   = 'Unrealised Gain';
  }

  // Gold-specific rows
  var gramsRow      = document.getElementById('invGramsRow');
  var buyPerGramRow = document.getElementById('invBuyPerGramRow');
  var goldPreview   = document.getElementById('invGoldPreviewRow');
  if (gramsRow)      gramsRow.style.display      = isGold ? '' : 'none';
  if (buyPerGramRow) buyPerGramRow.style.display  = isGold ? '' : 'none';
  if (goldPreview)   goldPreview.style.display    = isGold ? '' : 'none';

  // Kick off gold price fetch when switching to Gold
  if (isGold) invFetchGoldModalPreview();
}

/* Live quote preview inside modal */
var invQuoteDebounce = null;
function invTickerInput() {
  clearTimeout(invQuoteDebounce);
  var ticker = document.getElementById('invFormTicker').value.trim().toUpperCase();
  if (!ticker) { invHideQuotePreview(); return; }

  // Immediate duplicate check — only when adding a new holding
  if (!invEditId) {
    var dup = investmentsData.find(function(x){ return x.ticker && x.ticker.toUpperCase() === ticker; });
    if (dup) {
      var preview = document.getElementById('invQuotePreview');
      if (preview) {
        preview.className = 'inv-quote-preview show';
        preview.innerHTML =
          '<div class="inv-dup-warn">'
          + '<div><span class="inv-dup-icon">⚠</span>'
          + ' <strong>' + invEsc(dup.name) + '</strong> (' + invEsc(dup.category) + ') is already in your portfolio.</div>'
          + '<button class="inv-dup-edit-btn" onclick="openInvModal(\'' + dup.id + '\')">'
          + 'Switch to Edit →</button>'
          + '</div>';
      }
      return; // Skip the API fetch
    }
  }

  invQuoteDebounce = setTimeout(function(){ invFetchModalQuote(ticker); }, 700);
}

function invFetchModalQuote(ticker) {
  var preview = document.getElementById('invQuotePreview');
  if (preview) { preview.className = 'inv-quote-preview show'; preview.innerHTML = '<div class="inv-spinner"></div> Fetching…'; }

  // Fetch the quote and the USD/INR rate in parallel so the preview and
  // auto-fill are always currency-correct, even on the very first open.
  Promise.all([
    invFetchQuote(ticker),
    fetchUsdInrRate().catch(function() { return null; })
  ]).then(function(results) {
    var q        = results[0];
    invQuoteCache[ticker] = q;

    var isUSD    = q.currency && q.currency !== 'INR';
    var rawPrice = qPrice(q);
    var inrPrice = toInr(rawPrice, q.currency);   // same as rawPrice when INR

    if (preview) {
      // Price line: show native currency + INR equivalent for non-INR quotes
      var priceHtml = isUSD
        ? q.currency + ' ' + rawPrice.toFixed(2)
          + (usdInrRate ? ' <span style="color:var(--muted);font-size:.65rem">≈ ₹' + inrPrice.toFixed(2) + '</span>' : '')
        : '₹' + rawPrice.toFixed(2);

      preview.innerHTML = '<div><div class="inv-quote-ticker">' + invEsc(q.ticker) + '</div>'
        + '<div class="inv-quote-name">' + invEsc(q.name) + '</div></div>'
        + '<div><div class="inv-quote-price">' + priceHtml + '</div>'
        + '<div class="' + (qChgPct(q) >= 0 ? 'inv-change-pos' : 'inv-change-neg') + '" style="font-size:.7rem">'
        + fmtIPct(qChgPct(q)) + ' today</div></div>';

      // Auto-fill avg buy price with the INR-equivalent so the field (which
      // is always stored in ₹) receives the correct value regardless of the
      // stock's native currency — auto-fill first lot's price if it is blank
      var firstLotPrice = document.querySelector('#invLotsBody tr:first-child .inv-lot-price');
      if (firstLotPrice && !firstLotPrice.value) {
        firstLotPrice.value = inrPrice.toFixed(2);
        invUpdateLotsSummary();
      }
    }
  }).catch(function() {
    if (preview) preview.innerHTML = '<span style="color:var(--accent2)">⚠ Ticker not found — check symbol (e.g. RELIANCE.NS)</span>';
  });
}

function invHideQuotePreview() {
  var p = document.getElementById('invQuotePreview');
  if (p) { p.className = 'inv-quote-preview'; p.innerHTML = ''; }
}

/* ── Gold modal: live price fetch + preview calc ─────────────── */
function invFetchGoldModalPreview() {
  var priceEl  = document.getElementById('invGoldPricePerGram');
  var sourceEl = document.getElementById('invGoldPriceSource');
  var liveDot  = document.getElementById('invGoldLiveDot');
  if (priceEl) { priceEl.textContent = 'Fetching…'; priceEl.style.color = 'var(--muted)'; }

  fetchGoldPriceINR()
    .then(function(result) {
      if (priceEl) { priceEl.textContent = fmtI2(result.pricePerGram) + ' / g'; priceEl.style.color = 'var(--accent3)'; }
      if (sourceEl) sourceEl.textContent = 'via ' + result.source + ' · updated just now';
      if (liveDot) liveDot.className = 'inv-live-dot';
      invCalcGoldPreview();
    })
    .catch(function() {
      if (priceEl) { priceEl.textContent = 'Could not fetch price — enter cost manually'; priceEl.style.color = 'var(--accent2)'; }
    });
}

function invCalcGoldPreview() {
  var grams    = parseFloat(document.getElementById('invFormGrams').value)      || 0;
  var buyPPG   = parseFloat(document.getElementById('invFormBuyPerGram').value) || 0;
  var livePPG  = goldPriceCache ? goldPriceCache.pricePerGram : 0;

  var curValWrap  = document.getElementById('invGoldCurValWrap');
  var curValEl    = document.getElementById('invGoldCurVal');
  var unrealWrap  = document.getElementById('invGoldUnrealWrap');
  var unrealEl    = document.getElementById('invGoldUnrealVal');

  if (grams > 0 && livePPG > 0) {
    var curVal = grams * livePPG;
    if (curValEl)  curValEl.textContent = fmtI(curVal);
    if (curValWrap) curValWrap.style.display = '';

    if (buyPPG > 0) {
      var gain  = curVal - grams * buyPPG;
      var retPct = (gain / (grams * buyPPG)) * 100;
      var pos   = gain >= 0;
      if (unrealEl) {
        unrealEl.textContent = (pos ? '+' : '') + fmtI(gain)
          + ' (' + (pos ? '+' : '') + retPct.toFixed(2) + '%)';
        unrealEl.style.color = pos ? 'var(--accent)' : 'var(--accent2)';
      }
      if (unrealWrap) unrealWrap.style.display = '';
    } else {
      if (unrealWrap) unrealWrap.style.display = 'none';
    }
  } else {
    if (curValWrap)  curValWrap.style.display  = 'none';
    if (unrealWrap)  unrealWrap.style.display  = 'none';
  }
}


/* Kept for backward compat — now delegates to the lots summary */
function invCalcInvestedPreview() { invUpdateLotsSummary(); }
function invQtyInput() { invUpdateLotsSummary(); }

function saveInvHolding() {
  var name  = document.getElementById('invFormName').value.trim();
  var date  = document.getElementById('invFormDate').value;
  var notes = document.getElementById('invFormNotes').value.trim();
  var isGold = (invSelectedCat === 'Gold');
  var isRE   = (invSelectedCat === 'RealEstate');
  var isEPF  = (invSelectedCat === 'EPF');

  if (!name) { alert('Please enter a name for this holding.'); return; }

  var h;
  if (isGold) {
    /* ── Gold: grams + optional buy price per gram ── */
    var grams      = parseFloat(document.getElementById('invFormGrams').value)      || 0;
    var buyPerGram = parseFloat(document.getElementById('invFormBuyPerGram').value) || 0;
    if (grams <= 0) { alert('Please enter the weight in grams.'); return; }
    h = {
      id:              invEditId || invId(),
      name:            name,
      category:        'Gold',
      ticker:          '',
      grams:           grams,
      qty:             grams,            // backward compat
      buyPricePerGram: buyPerGram || 0,
      avgPrice:        buyPerGram || 0,  // backward compat
      date:            date,
      notes:           notes,
      createdAt:       invEditId
        ? ((investmentsData.find(function(x){ return x.id === invEditId; }) || {}).createdAt || Date.now())
        : Date.now(),
    };
  } else if (isRE) {
    /* ── Real Estate: buyPrice optional, curPrice optional ── */
    var buyPrice = parseFloat(document.getElementById('invFormBuyPrice').value) || 0;
    var curPrice = parseFloat(document.getElementById('invFormCurPrice').value) || 0;
    if (buyPrice <= 0 && curPrice <= 0) { alert('Please enter at least the current value for this property.'); return; }
    var effectiveBuy = buyPrice || curPrice;
    h = {
      id:        invEditId || invId(),
      name:      name,
      category:  invSelectedCat,
      ticker:    '',
      qty:       1,
      avgPrice:  effectiveBuy,
      buyPrice:  effectiveBuy,
      curPrice:  curPrice || effectiveBuy,
      date:      date,
      notes:     notes,
      createdAt: invEditId
        ? ((investmentsData.find(function(x){ return x.id === invEditId; }) || {}).createdAt || Date.now())
        : Date.now(),
    };
  } else if (isEPF) {
    /* ── EPF: total contributed optional, current balance optional ── */
    var epfContrib  = parseFloat(document.getElementById('invFormBuyPrice').value) || 0;
    var epfBalance  = parseFloat(document.getElementById('invFormCurPrice').value) || 0;
    if (epfContrib <= 0 && epfBalance <= 0) { alert('Please enter at least the current EPF balance.'); return; }
    var effectiveContrib = epfContrib || epfBalance;
    h = {
      id:        invEditId || invId(),
      name:      name,
      category:  'EPF',
      ticker:    '',
      qty:       1,
      avgPrice:  effectiveContrib,
      buyPrice:  effectiveContrib,
      curPrice:  epfBalance || effectiveContrib,
      date:      date,
      notes:     notes,
      createdAt: invEditId
        ? ((investmentsData.find(function(x){ return x.id === invEditId; }) || {}).createdAt || Date.now())
        : Date.now(),
    };
  } else {
    /* ── Standard (lots): Stock / MF / ESOP / Bond / FD / Others ── */
    var ticker = document.getElementById('invFormTicker').value.trim().toUpperCase();
    var isOptionalAvg = (invSelectedCat === 'ESOP');
    invReadLotsFromDOM();
    var validLots = invLots.filter(function(l){ return (parseFloat(l.qty) || 0) > 0; });
    if (!validLots.length) { alert('Please enter the quantity for at least one purchase record.'); return; }
    if (!isOptionalAvg && validLots.some(function(l){ return !(parseFloat(l.avgPrice) > 0); })) {
      alert('Please enter the avg buy price for all purchase records.'); return;
    }
    var saveTicker = (invSelectedCat === 'Stock' || invSelectedCat === 'MF' || invSelectedCat === 'ESOP') ? ticker : '';
    var totalQty   = validLots.reduce(function(s, l){ return s + (parseFloat(l.qty) || 0); }, 0);
    var totalCost  = validLots.reduce(function(s, l){ return s + (parseFloat(l.qty)||0) * (parseFloat(l.avgPrice)||0); }, 0);
    var weightedAvg = totalQty ? totalCost / totalQty : 0;
    h = {
      id:        invEditId || invId(),
      name:      name,
      category:  invSelectedCat,
      ticker:    saveTicker,
      lots:      validLots.map(function(l){ return { id: l.id || invLotId(), qty: parseFloat(l.qty)||0, avgPrice: parseFloat(l.avgPrice)||0, date: l.date||'', notes: l.notes||'' }; }),
      qty:       totalQty,        // kept for backward compat / aggregations
      avgPrice:  weightedAvg,     // kept for backward compat
      date:      validLots[0].date || date,
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
var invImportBroker  = 'auto';  // selected broker key or 'auto'

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
  others: 'Others', other: 'Others', misc: 'Others', commodity: 'Others', gold: 'Gold',
};

/* Broker meta — names, colors, step-by-step export instructions */
var INV_BROKER_META = {
  auto: {
    name: 'Auto-detect',
    steps: null,
    note: 'Upload any CSV or XLSX — the platform will be identified automatically from the file headers.'
  },
  zerodha: {
    name: 'Zerodha',
    steps: [
      { title: 'Holdings (current positions)',
        items: ['Go to <strong>console.zerodha.com</strong>', 'Navigate to <strong>Portfolio → Holdings</strong>', 'Click the <strong>CSV ↓</strong> download icon at the top-right of the table', 'Upload the downloaded <code>.csv</code> file below'] },
      { title: 'Tradebook (full buy history — recommended)',
        items: ['Go to <strong>console.zerodha.com</strong>', 'Navigate to <strong>Reports → Tradebook</strong>', 'Set your date range → click <strong>Download</strong>', 'Upload the <code>.csv</code> — each individual buy trade becomes a separate lot'] },
    ]
  },
  groww: {
    name: 'Groww',
    steps: [
      { title: 'For Mutual Fund Holdings',
        items: ['Click on your <strong>profile photo</strong> (top right)', 'Click <strong>Reports</strong>', 'Go to <strong>Holdings → Mutual Funds Holdings Statement</strong>', 'Click <strong>Download</strong> on the right side', 'Upload the downloaded XLSX file below'] },
      { title: 'For Stock Holdings',
        items: ['Click on your <strong>profile photo</strong> (top right)', 'Click <strong>Reports</strong>', 'Go to <strong>Holdings → Stock Holdings Statement</strong>', 'Click <strong>Download</strong> on the right side', 'Upload the downloaded XLSX file below'] },
    ],
    note: 'Upload one file at a time — stocks and mutual funds are imported separately.'
  },
  upstox: {
    name: 'Upstox',
    steps: [
      { title: 'Holdings',
        items: ['Login to <strong>upstox.com</strong>', 'Go to <strong>Reports → Portfolio</strong>', 'Click <strong>Download Holdings</strong> (CSV)', 'Upload the file below'] },
    ]
  },
  angelone: {
    name: 'Angel One',
    steps: [
      { title: 'Holdings',
        items: ['Login to <strong>angelone.in</strong>', 'Go to <strong>Portfolio → Holdings</strong>', 'Click <strong>Export</strong> / download CSV icon', 'Upload the file below'] },
    ]
  },
  indmoney: {
    name: 'INDmoney',
    steps: [
      { title: 'Stock Holdings',
        items: ['Login to <strong>indmoney.com</strong>', 'Go to <strong>Investments → Stocks</strong>', 'Click the <strong>Export / Download</strong> icon', 'Upload the CSV file below'] },
    ]
  },
  icici: {
    name: 'ICICI Direct',
    steps: [
      { title: 'Portfolio Holdings',
        items: ['Login to <strong>icicidirect.com</strong>', 'Go to <strong>My Portfolio → Holdings</strong>', 'Click <strong>Download</strong> → CSV', 'Upload the file below'] },
    ]
  },
  kuvera: {
    name: 'Kuvera',
    steps: [
      { title: 'Mutual Fund Portfolio',
        items: ['Login to <strong>kuvera.in</strong>', 'Go to <strong>Portfolio</strong>', 'Click the <strong>Export</strong> icon (top-right)', 'Download as CSV', 'Upload the file below'] },
    ]
  },
  generic: {
    name: 'Generic CSV',
    steps: [
      { title: 'Required columns (any order, header row auto-detected)',
        items: ['<strong>Name</strong> — stock or fund name (required)', '<strong>Ticker / Symbol</strong> — NSE symbol e.g. RELIANCE (for live prices)', '<strong>Qty / Units</strong> — quantity purchased', '<strong>Avg Price</strong> — average purchase price in ₹', '<strong>Category</strong> — Stock / MF / Bond / Gold / etc. (optional)', '<strong>Date</strong> — purchase date YYYY-MM-DD (optional)'] },
    ]
  },
};

function setInvImportBroker(key) {
  invImportBroker = key;
  document.querySelectorAll('#invBrokerGrid .inv-broker-card').forEach(function(el) {
    el.classList.toggle('active', el.dataset.broker === key);
  });

  // Show/hide generic category row
  var catRow = document.getElementById('invImportCatRow');
  if (catRow) catRow.style.display = (key === 'generic' || key === 'auto') ? 'flex' : 'none';

  // Render step-by-step instructions
  var stepsEl = document.getElementById('invBrokerSteps');
  var meta = INV_BROKER_META[key] || INV_BROKER_META.auto;
  if (stepsEl) {
    if (!meta.steps) {
      stepsEl.innerHTML = '<div class="inv-broker-steps-note">' + (meta.note || '') + '</div>';
    } else {
      var html = '<div class="inv-broker-steps-title">How to Export from ' + meta.name + '</div>';
      html += meta.steps.map(function(section) {
        return '<div class="inv-broker-steps-section">'
          + '<div class="inv-broker-steps-sub">' + section.title + '</div>'
          + '<ol class="inv-broker-steps-list">'
          + section.items.map(function(item){ return '<li>' + item + '</li>'; }).join('')
          + '</ol></div>';
      }).join('');
      if (meta.note) html += '<div class="inv-broker-steps-note">' + meta.note + '</div>';
      stepsEl.innerHTML = html;
    }
  }

  if (invImportParsed) renderInvImportPreview(invImportParsed);
}

function openInvImport() {
  invImportParsed = null;
  document.getElementById('invImportModal').classList.remove('hidden');
  document.getElementById('invImportPreview').style.display = 'none';
  document.getElementById('invImportConfirmBtn').disabled = true;
  document.getElementById('invImportFileInput').value = '';
  setInvImportCat('Stock');
  setInvImportBroker('auto');

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
    reader.onload = function(ev) { parseBrokerRows(invCsvToRows(ev.target.result)); };
    reader.readAsText(file);
  } else if (ext === 'xlsx' || ext === 'xls') {
    var reader = new FileReader();
    reader.onload = function(ev) {
      try {
        var wb   = XLSX.read(ev.target.result, { type: 'array' });
        var ws   = wb.Sheets[wb.SheetNames[0]];
        var rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        parseBrokerRows(rows);
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

/* ══════════════════════════════════════════════════════════
   BROKER PLATFORM DETECTION
══════════════════════════════════════════════════════════ */
function detectInvPlatform(headerRow) {
  var h = headerRow.map(function(c){ return String(c).toLowerCase().trim().replace(/\./g,'').replace(/\s+/g,' '); });
  var has  = function(kw) { return h.some(function(x){ return x.includes(kw); }); };
  var hasAll = function(kws) { return kws.every(function(kw){ return has(kw); }); };

  // Zerodha Tradebook: trade_date + trade_type + symbol
  if (hasAll(['trade_date','trade_type','symbol'])) return 'zerodha-tb';
  // Zerodha Holdings: instrument/tradingsymbol + avg cost
  if ((has('instrument') || has('tradingsymbol')) && (has('avg cost') || has('avg_cost'))) return 'zerodha';
  // Groww MF: scheme name or fund name + (units or avg. nav or average nav)
  if ((has('scheme name') || has('fund name')) && (has('units') || has('avg. nav') || has('average nav') || has('purchase nav'))) return 'groww-mf';
  // Groww Stocks: stock/company col + any average price/cost column
  if ((has('stock') || has('company') || has('scrip')) && (has('avg. cost') || has('average cost') || has('avg cost') || has('average buy') || has('avg buy') || has('avg. buy'))) return 'groww';
  // Kuvera: folio no or purchase nav (before Angel One so "units" doesn't confuse)
  if (has('folio no') || has('folio number') || has('purchase nav')) return 'kuvera';
  // Angel One: net qty (distinctive)
  if (has('net qty') || has('net quantity')) return 'angelone';
  // Upstox: symbol + isin + avg buy price
  if (hasAll(['isin','avg buy price','symbol'])) return 'upstox';
  // INDmoney: current market price
  if (has('current market price') && (has('stock name') || has('symbol'))) return 'indmoney';
  // ICICI Direct: nse code or scrip name + avg cost
  if ((has('nse code') || has('scrip name') || has('scrip')) && (has('avg cost') || has('avg. cost'))) return 'icici';

  return 'generic';
}

/* ── Date normalizer: DD-MM-YYYY, DD/MM/YYYY, YYYY-MM-DD → YYYY-MM-DD ── */
function _invNormalizeDate(s) {
  if (!s) return '';
  s = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  var m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
  if (m) return m[3] + '-' + m[2].padStart(2,'0') + '-' + m[1].padStart(2,'0');
  return s;
}

/* ── Column finder helper (returns first matching index) ── */
function _invCol(h, keywords) {
  for (var i = 0; i < keywords.length; i++) {
    var idx = -1;
    for (var j = 0; j < h.length; j++) {
      if (h[j].includes(keywords[i])) { idx = j; break; }
    }
    if (idx >= 0) return idx;
  }
  return -1;
}

/* ══════════════════════════════════════════════════════════
   BROKER-SPECIFIC PARSERS
   All return: [{name, ticker, isin, qty, avgPrice, category, date}]
   ticker may be '' for brokers that don't export NSE symbol.
   isin  may be '' when not available.
══════════════════════════════════════════════════════════ */
function _invParseRows(rows, platformId) {
  var h    = rows[0].map(function(c){ return String(c).toLowerCase().trim().replace(/\./g,'').replace(/\s+/g,' '); });
  var data = rows.slice(1).filter(function(r){
    return r.some(function(c){ return String(c).trim() !== ''; });
  });
  var C = function(kws) { return _invCol(h, kws); };

  switch (platformId) {

    /* ── Zerodha Holdings ───────────────────────────────────────
       Columns: Instrument | Qty | Avg cost | LTP | Cur val | …  */
    case 'zerodha': {
      var nameI  = C(['instrument','tradingsymbol']);
      var qtyI   = C(['qty','quantity']);
      var priceI = C(['avg cost','avg_cost','average cost']);
      return data.map(function(r) {
        var name = String(r[nameI] || '').trim();
        if (!name || name.toLowerCase() === 'instrument') return null;
        return { name:name, ticker:name, isin:'', qty:invCleanNum(r[qtyI]), avgPrice:invCleanNum(r[priceI]), category:'Stock', date:'' };
      }).filter(Boolean);
    }

    /* ── Zerodha Tradebook ──────────────────────────────────────
       Columns: symbol | isin | trade_date | … | trade_type | … | quantity | price  */
    case 'zerodha-tb': {
      var symI   = C(['symbol']);
      var dateI  = C(['trade_date','date']);
      var typeI  = C(['trade_type']);
      var qtyI   = C(['quantity','qty']);
      var priceI = C(['price']);
      var segI   = C(['segment']);
      return data
        .filter(function(r){ return String(r[typeI]||'').toLowerCase().trim() === 'buy'; })
        .map(function(r) {
          var name = String(r[symI] || '').trim();
          if (!name) return null;
          var seg = String(r[segI] || '').toLowerCase();
          var cat = seg.includes('mf') ? 'MF' : 'Stock';
          return { name:name, ticker:name, isin:'', qty:invCleanNum(r[qtyI]), avgPrice:invCleanNum(r[priceI]), category:cat, date:_invNormalizeDate(String(r[dateI]||'')) };
        }).filter(Boolean);
    }

    /* ── Groww Stock Holdings ───────────────────────────────────
       Columns: Stock / Company | ISIN | Qty. | Avg. Cost Price | LTP | …
       NOTE: Groww does NOT export NSE ticker — stored as ''    */
    case 'groww': {
      var nameI  = C(['stock name','company name','stock','company','scrip name','scrip']);
      var isinI  = C(['isin']);
      var qtyI   = C(['qty.','qty','quantity','units']);
      var priceI = C(['average buy price','avg buy price','avg. buy price','avg. cost price','average cost price','avg. cost price','avg. cost','average cost','avg cost price','avg cost']);
      return data.map(function(r) {
        var name = String(r[nameI] || '').trim();
        var isin = isinI >= 0 ? String(r[isinI] || '').trim() : '';
        if (!name || /^stock$/i.test(name) || /^company$/i.test(name)) return null;
        return { name:name, ticker:'', isin:isin, qty:invCleanNum(r[qtyI]), avgPrice:invCleanNum(r[priceI]), category:'Stock', date:'' };
      }).filter(Boolean);
    }

    /* ── Groww Mutual Fund Holdings ─────────────────────────────
       Columns: Scheme Name / Fund Name | ISIN | Folio | Units | Avg NAV | …  */
    case 'groww-mf': {
      var nameI  = C(['scheme name','fund name','scheme','fund','name']);
      var isinI  = C(['isin']);
      var qtyI   = C(['units','qty','quantity']);
      var priceI = C(['average nav','avg. nav','avg nav','purchase nav','nav']);
      return data.map(function(r) {
        var name = String(r[nameI] || '').trim();
        var isin = isinI >= 0 ? String(r[isinI] || '').trim() : '';
        if (!name || /^scheme$/i.test(name) || /^fund$/i.test(name)) return null;
        return { name:name, ticker:'', isin:isin, qty:invCleanNum(r[qtyI]), avgPrice:invCleanNum(r[priceI]), category:'MF', date:'' };
      }).filter(Boolean);
    }

    /* ── Upstox Holdings ────────────────────────────────────────
       Columns: Symbol | ISIN | Qty | Avg Buy Price | LTP | …    */
    case 'upstox': {
      var symI   = C(['symbol']);
      var isinI  = C(['isin']);
      var qtyI   = C(['qty','quantity']);
      var priceI = C(['avg buy price','average buy price','avg. buy price']);
      return data.map(function(r) {
        var name = String(r[symI] || '').trim();
        var isin = isinI >= 0 ? String(r[isinI] || '').trim() : '';
        if (!name) return null;
        return { name:name, ticker:name, isin:isin, qty:invCleanNum(r[qtyI]), avgPrice:invCleanNum(r[priceI]), category:'Stock', date:'' };
      }).filter(Boolean);
    }

    /* ── Angel One Holdings ─────────────────────────────────────
       Columns: Symbol | ISIN | Net Qty | Avg Buy Price | …       */
    case 'angelone': {
      var symI   = C(['symbol','nse symbol']);
      var isinI  = C(['isin']);
      var qtyI   = C(['net qty','net quantity','qty','quantity']);
      var priceI = C(['avg buy price','average buy price','average price']);
      return data.map(function(r) {
        var name = String(r[symI] || '').trim();
        var isin = isinI >= 0 ? String(r[isinI] || '').trim() : '';
        if (!name) return null;
        return { name:name, ticker:name, isin:isin, qty:invCleanNum(r[qtyI]), avgPrice:invCleanNum(r[priceI]), category:'Stock', date:'' };
      }).filter(Boolean);
    }

    /* ── Kuvera MF ──────────────────────────────────────────────
       Columns: Fund Name | ISIN | Folio No. | Units | Purchase NAV | …  */
    case 'kuvera': {
      var nameI  = C(['fund name','scheme name','fund','name']);
      var isinI  = C(['isin']);
      var qtyI   = C(['units','qty','quantity']);
      var priceI = C(['purchase nav','average nav','avg nav','nav']);
      var dateI  = C(['date','purchase date','transaction date']);
      return data.map(function(r) {
        var name = String(r[nameI] || '').trim();
        var isin = isinI >= 0 ? String(r[isinI] || '').trim() : '';
        if (!name) return null;
        var date = dateI >= 0 ? _invNormalizeDate(String(r[dateI] || '')) : '';
        return { name:name, ticker:'', isin:isin, qty:invCleanNum(r[qtyI]), avgPrice:invCleanNum(r[priceI]), category:'MF', date:date };
      }).filter(Boolean);
    }

    /* ── INDmoney Stocks ────────────────────────────────────────
       Columns: Stock Name | Symbol | Exchange | Quantity | Average Price | …  */
    case 'indmoney': {
      var nameI  = C(['stock name','name']);
      var symI   = C(['symbol','ticker']);
      var qtyI   = C(['quantity','qty']);
      var priceI = C(['average buy price','average price','avg buy price','avg price','invested price','avg cost','average cost','cost price']);
      return data.map(function(r) {
        var name = String(r[nameI] || '').trim();
        var tick = symI >= 0 ? String(r[symI] || '').trim().toUpperCase() : '';
        if (!name) return null;
        return { name:name, ticker:tick, isin:'', qty:invCleanNum(r[qtyI]), avgPrice:invCleanNum(r[priceI]), category:'Stock', date:'' };
      }).filter(Boolean);
    }

    /* ── ICICI Direct Holdings ──────────────────────────────────
       Columns: Stock Name / Scrip | Symbol | Quantity | Avg Cost | …  */
    case 'icici': {
      var nameI  = C(['stock name','scrip name','scrip','name']);
      var symI   = C(['symbol','ticker','nse code']);
      var isinI  = C(['isin']);
      var qtyI   = C(['quantity','qty','net qty']);
      var priceI = C(['avg cost','average cost','avg. cost','buy avg price','average price']);
      return data.map(function(r) {
        var name = String(r[nameI] || '').trim();
        var tick = symI >= 0 ? String(r[symI] || '').trim().toUpperCase() : '';
        var isin = isinI >= 0 ? String(r[isinI] || '').trim() : '';
        if (!name) return null;
        return { name:name, ticker:tick, isin:isin, qty:invCleanNum(r[qtyI]), avgPrice:invCleanNum(r[priceI]), category:'Stock', date:'' };
      }).filter(Boolean);
    }

    default:
      return null;
  }
}

/* ── Smart header-row finder ─────────────────────────────────
   Scans first N rows to find the one with ≥3 non-numeric,
   non-empty cells — skips title/subtitle rows that brokers
   (e.g. Groww) insert above the actual column headers.
────────────────────────────────────────────────────────── */
function _invFindHeaderRow(rows) {
  for (var i = 0; i < Math.min(rows.length, 12); i++) {
    var row = rows[i];
    if (!row || !row.length) continue;
    var nonEmpty = row.filter(function(c){ return String(c).trim() !== ''; });
    if (nonEmpty.length < 3) continue;
    var headerLike = nonEmpty.filter(function(c) {
      var s = String(c).trim();
      if (/^[\d,₹.()\- %]+$/.test(s)) return false;       // pure numbers/symbols
      if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(s)) return false; // date
      return true;
    });
    if (headerLike.length >= 3) return i;
  }
  return 0;
}

/* ══════════════════════════════════════════════════════════
   BROKER-AWARE ORCHESTRATOR
══════════════════════════════════════════════════════════ */
function parseBrokerRows(rows) {
  if (!rows || !rows.length) { showInvToast('File is empty', 'error'); return; }

  // Skip to actual header row (handles brokers that add title rows at top)
  var headerIdx = _invFindHeaderRow(rows);

  // Detect or use selected platform
  var platform = invImportBroker === 'auto'
    ? detectInvPlatform(rows[headerIdx])
    : invImportBroker;

  // If auto-detect found a platform, highlight it in the grid and show instructions
  if (invImportBroker === 'auto') {
    var basePlatform = platform.replace(/-tb$/, '').replace(/-mf$/, '');
    var suffix = platform.endsWith('-tb') ? ' · Tradebook (each buy = lot)' : platform.endsWith('-mf') ? ' · Mutual Funds' : ' · Holdings';
    var detectedName = (INV_BROKER_META[basePlatform] || INV_BROKER_META.generic).name;
    var stepsEl = document.getElementById('invBrokerSteps');
    if (stepsEl) {
      var prev = stepsEl.innerHTML;
      stepsEl.innerHTML = '<div class="inv-broker-detected">✓ Detected: <strong>' + detectedName + suffix + '</strong></div>' + prev;
    }
  }

  // Try broker-specific parser
  var normalized = platform !== 'generic' ? _invParseRows(rows.slice(headerIdx), platform) : null;

  if (normalized) {
    var warnings = [];
    normalized.forEach(function(r, i) {
      if (!r.qty || r.qty <= 0) {
        warnings.push('Row ' + (i + 2) + ': "' + r.name + '" — qty missing/zero, defaulted to 1');
        r.qty = 1;
      }
      if (!r.avgPrice || r.avgPrice <= 0) {
        warnings.push('Row ' + (i + 2) + ': "' + r.name + '" — avg price missing or zero');
      }
    });
    invImportParsed = { rows: normalized, warnings: warnings, platform: platform };
    renderInvImportPreview(invImportParsed);
  } else {
    parseInvImportRows(rows.slice(headerIdx));
  }
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

  var hasIsin    = rows.some(function(r){ return r.isin; });
  var hasDate    = rows.some(function(r){ return r.date; });
  var noTicker   = rows.filter(function(r){ return !r.ticker; }).length;

  /* Pre-compute merge status for each row using the same matching logic as confirmInvImport */
  function _previewFindExisting(r) {
    var tickerNorm = r.ticker ? r.ticker.replace(/\.(NS|BO|BSE)$/i, '').toUpperCase() : '';
    var found = null;
    if (tickerNorm) {
      found = investmentsData.find(function(h) {
        var hTick = h.ticker ? h.ticker.replace(/\.(NS|BO|BSE)$/i, '').toUpperCase() : '';
        return hTick && hTick === tickerNorm;
      });
    }
    if (!found) {
      found = investmentsData.find(function(h) {
        return h.name.toLowerCase() === r.name.toLowerCase() && h.category === r.category;
      });
    }
    return found || null;
  }
  var mergeCount = 0, newCount = 0;
  var rowMeta = rows.map(function(r) {
    var ex = _previewFindExisting(r);
    if (ex) { mergeCount++; } else { newCount++; }
    return ex;
  });

  /* Table head */
  var head     = document.getElementById('invImportPreviewHead');
  var thStyle  = 'padding:.5rem .65rem;text-align:left;font-size:.59rem;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);border-bottom:1px solid var(--border);white-space:nowrap';
  var cols     = ['Action', 'Name', hasIsin ? 'ISIN' : null, 'Ticker / Live', 'Qty', 'Avg Price', 'Cost Basis', 'Category', hasDate ? 'Date' : null].filter(Boolean);
  head.innerHTML = '<tr>' + cols.map(function(c){ return '<th style="' + thStyle + '">' + c + '</th>'; }).join('') + '</tr>';

  /* Table body */
  var tbody   = document.getElementById('invImportPreviewBody');
  var tdStyle = 'padding:.5rem .65rem;border-bottom:1px solid rgba(35,45,63,.35);font-size:.71rem;white-space:nowrap';

  tbody.innerHTML = rows.slice(0, 30).map(function(r, i) {
    var meta      = CAT_META[r.category] || CAT_META.Others;
    var costBasis = r.qty * r.avgPrice;
    var tickerCell = r.ticker
      ? '<span style="color:var(--accent4);font-family:var(--font-mono)">' + invEsc(r.ticker) + '</span>'
      : '<span style="color:var(--accent3);font-size:.63rem">⚠ set after import</span>';
    var existing = rowMeta[i];
    var actionCell = existing
      ? '<span style="color:var(--accent);font-size:.63rem;font-weight:600">+ Add Lot</span>'
      : '<span style="color:var(--accent4);font-size:.63rem;font-weight:600">New</span>';
    var cells = [
      '<td style="' + tdStyle + '">' + actionCell + '</td>',
      '<td style="' + tdStyle + ';font-weight:600;max-width:180px;overflow:hidden;text-overflow:ellipsis">' + invEsc(r.name) + '</td>',
      hasIsin  ? '<td style="' + tdStyle + ';color:var(--muted);font-family:var(--font-mono);font-size:.63rem">' + (r.isin || '—') + '</td>' : '',
      '<td style="' + tdStyle + '">' + tickerCell + '</td>',
      '<td style="' + tdStyle + ';text-align:right">' + (r.qty||0).toLocaleString('en-IN', {maximumFractionDigits:4}) + '</td>',
      '<td style="' + tdStyle + ';text-align:right">₹' + (r.avgPrice||0).toLocaleString('en-IN',{maximumFractionDigits:2}) + '</td>',
      '<td style="' + tdStyle + ';text-align:right;font-weight:600">₹' + Math.round(costBasis).toLocaleString('en-IN') + '</td>',
      '<td style="' + tdStyle + '"><span class="cat-badge ' + meta.class + '">' + meta.label + '</span></td>',
      hasDate  ? '<td style="' + tdStyle + ';color:var(--muted)">' + (r.date || '—') + '</td>' : '',
    ].filter(function(c){ return c !== ''; });
    return '<tr>' + cells.join('') + '</tr>';
  }).join('') + (rows.length > 30
    ? '<tr><td colspan="' + cols.length + '" style="' + tdStyle + ';color:var(--muted);text-align:center">…and ' + (rows.length - 30) + ' more rows</td></tr>'
    : '');

  /* Summary */
  var totalInvested = rows.reduce(function(s,r){ return s + (r.qty||0) * (r.avgPrice||0); }, 0);
  var withTickers   = rows.length - noTicker;
  var sumEl = document.getElementById('invImportSummary');
  sumEl.innerHTML = '<strong style="color:var(--text)">' + rows.length + ' holding' + (rows.length !== 1 ? 's' : '') + '</strong>'
    + ' &nbsp;·&nbsp; Total invested: <strong style="color:var(--accent4)">₹' + Math.round(totalInvested).toLocaleString('en-IN') + '</strong>'
    + (newCount   ? ' &nbsp;·&nbsp; <span style="color:var(--accent4)">' + newCount + ' new</span>' : '')
    + (mergeCount ? ' &nbsp;·&nbsp; <span style="color:var(--accent)">' + mergeCount + ' lot' + (mergeCount > 1 ? 's' : '') + ' added to existing</span>' : '')
    + ' &nbsp;·&nbsp; <span style="color:var(--accent)">' + withTickers + ' with live ticker</span>'
    + (noTicker ? ' &nbsp;·&nbsp; <span style="color:var(--accent3)">' + noTicker + ' without ticker — set manually after import</span>' : '');

  /* Warnings */
  var warnEl = document.getElementById('invImportWarnings');
  var allWarnings = warnings.slice();
  if (noTicker > 0) {
    allWarnings.unshift('Live prices unavailable for ' + noTicker + ' holding(s) — open each holding after import to set the NSE/BSE ticker symbol.');
  }
  warnEl.innerHTML = allWarnings.length
    ? allWarnings.map(function(w){ return '<div style="margin-bottom:.2rem">⚠ ' + w + '</div>'; }).join('')
    : '';

  document.getElementById('invImportConfirmBtn').disabled = rows.length === 0;
}

function confirmInvImport() {
  if (!invImportParsed || !invImportParsed.rows.length) return;

  var imported = 0, lotsAdded = 0, skipped = 0;
  var platform = invImportParsed.platform || 'generic';
  var basePlatform = platform.replace(/-tb$/, '').replace(/-mf$/, '');
  var source = (INV_BROKER_META[basePlatform] || INV_BROKER_META.generic).name;

  invImportParsed.rows.forEach(function(r) {
    if (!r.name) { skipped++; return; }

    /* Normalize ticker for matching — strip exchange suffixes (.NS / .BO / .BSE) */
    var tickerNorm = r.ticker
      ? r.ticker.replace(/\.(NS|BO|BSE)$/i, '').toUpperCase()
      : '';

    /* Find existing holding: ticker match first, then name+category fallback */
    var existing = null;
    if (tickerNorm) {
      existing = investmentsData.find(function(h) {
        var hTick = h.ticker ? h.ticker.replace(/\.(NS|BO|BSE)$/i, '').toUpperCase() : '';
        return hTick && hTick === tickerNorm;
      });
    }
    if (!existing) {
      existing = investmentsData.find(function(h) {
        return h.name.toLowerCase() === r.name.toLowerCase() && h.category === r.category;
      });
    }

    var newLot = {
      id:       invLotId(),
      qty:      r.qty,
      avgPrice: r.avgPrice,
      date:     r.date || '',
      notes:    'via ' + source,
    };

    if (existing) {
      /* Migrate legacy qty/avgPrice fields into a proper lots array first */
      if (!existing.lots || !existing.lots.length) {
        var synthLots = getHoldingLots(existing);
        existing.lots = synthLots.slice(); // copy
        delete existing.qty;
        delete existing.avgPrice;
        delete existing.date;
      }
      existing.lots.push(newLot);
      lotsAdded++;
    } else {
      investmentsData.push({
        id:        invId(),
        name:      r.name,
        ticker:    r.ticker || '',
        isin:      r.isin   || '',
        category:  r.category,
        lots:      [newLot],
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

  var msg = '';
  if (imported)  msg += imported + ' new holding' + (imported > 1 ? 's' : '') + ' added';
  if (lotsAdded) msg += (msg ? ', ' : '') + lotsAdded + ' lot' + (lotsAdded > 1 ? 's' : '') + ' recorded';
  if (skipped)   msg += (msg ? ', ' : '') + skipped + ' skipped';
  showInvToast('✓ ' + msg + ' (' + source + ')', 'success');

  /* Auto-resolve tickers for holdings that don't have one yet */
  var noTickerHoldings = investmentsData.filter(function(h) {
    return !h.ticker && (h.category === 'Stock' || h.category === 'MF' || h.category === 'ESOP');
  });
  if (noTickerHoldings.length) {
    showInvToast('🔍 Looking up tickers for ' + noTickerHoldings.length + ' holding(s)…', 'success');
    invResolveTickers(noTickerHoldings).then(function(resolved) {
      if (resolved > 0) {
        saveInvestments();
        renderInvTable();
        renderInvLivePanel();
        invRefreshQuotes();
        showInvToast('✓ Tickers resolved for ' + resolved + ' holding(s) — live prices loading', 'success');
      } else {
        invRefreshQuotes();
      }
    });
  } else {
    invRefreshQuotes();
  }
}

/* ══════════════════════════════════════════════════════════
   TICKER RESOLVER
   Uses Yahoo Finance /v1/finance/search to find NSE/BSE
   symbols from company names exported by Groww / Kuvera.
══════════════════════════════════════════════════════════ */
function invResolveTickers(holdings) {
  /* Rate-limit: resolve one at a time with a small delay to avoid hammering */
  var resolved = 0;
  var queue = holdings.slice();

  function resolveNext() {
    if (!queue.length) return Promise.resolve(resolved);
    var h = queue.shift();
    return invFetchTickerForName(h.name, h.category, h.isin)
      .then(function(ticker) {
        if (ticker) {
          h.ticker = ticker;
          resolved++;
        }
      })
      .catch(function() { /* silently skip */ })
      .then(function() {
        return new Promise(function(res){ setTimeout(res, 200); }); // 200ms gap
      })
      .then(resolveNext);
  }

  return resolveNext();
}

function invFetchTickerForName(name, category, isin) {
  /* Build search query: prefer ISIN if available, else company name */
  var query = (isin && isin.length > 5) ? isin : name;
  var searchUrl = 'https://query1.finance.yahoo.com/v1/finance/search?q='
    + encodeURIComponent(query)
    + '&quotesCount=5&newsCount=0&enableFuzzyQuery=false&enableCb=false';

  return invProxyFetch(searchUrl)
    .then(function(data) {
      var quotes = data && data.finance && data.finance.result && data.finance.result[0]
        ? data.finance.result[0].quotes || []
        : (data && data.quotes ? data.quotes : []);

      if (!quotes.length) return null;

      /* Prefer Indian exchanges: .NS (NSE) > .BO (BSE) */
      var isMF = category === 'MF';
      var preferred = quotes.filter(function(q) {
        if (!q.symbol) return false;
        if (isMF) return q.quoteType === 'MUTUALFUND' || q.symbol.endsWith('.NS');
        return q.symbol.endsWith('.NS') || q.symbol.endsWith('.BO');
      });

      /* Fall back to any Indian equity result */
      if (!preferred.length) {
        preferred = quotes.filter(function(q) {
          return q.exchange === 'NSI' || q.exchange === 'BSE' || q.exchange === 'BSI';
        });
      }

      var best = preferred[0] || quotes[0];
      return best && best.symbol ? best.symbol : null;
    });
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

function initInvestments() {}


// Close modal on overlay click
document.addEventListener('click', function(e){
  var modal = document.getElementById('invModal');
  if (modal && !modal.classList.contains('hidden') && e.target === modal.parentElement) {
    closeInvModal();
  }
});
