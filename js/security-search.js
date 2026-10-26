/* ============================================================
   security-search.js — search stocks / mutual funds / ETFs by name
   Shared by classic (js/investments.js) and v2 (v2/fr-modals.js).

   Users type a company or fund name; we query Yahoo's v1/search through
   our own Cloudflare Worker and show matches by name + exchange only.
   The Yahoo ticker stays in the background — the caller stores it on the
   holding and fetches the live price with its existing quote logic.
   ============================================================ */

var FrSecuritySearch = (function() {
  var WORKER_URL = 'https://yf-proxy.t-r-harikrish.workers.dev';
  var MIN_CHARS  = 2;
  var DEBOUNCE   = 300;
  var MAX_ITEMS  = 8;
  var cache      = {};   // { lowercased query: [items] }

  var TYPE_LABEL = { EQUITY: 'Stock', MUTUALFUND: 'Mutual Fund', ETF: 'ETF' };

  // Yahoo exchange codes → what users recognise. Lower rank sorts first.
  var EXCHANGES = {
    NSI: { label: 'NSE',    rank: 0 },
    BSE: { label: 'BSE',    rank: 1 },
    BOM: { label: 'BSE',    rank: 1 },
    NMS: { label: 'NASDAQ', rank: 2 },
    NGM: { label: 'NASDAQ', rank: 2 },
    NCM: { label: 'NASDAQ', rank: 2 },
    NYQ: { label: 'NYSE',   rank: 2 },
    ASE: { label: 'NYSE',   rank: 2 },
    PCX: { label: 'NYSE',   rank: 2 },
  };

  // German regional exchanges re-list big Indian/US names (e.g. HDFC Bank on
  // Hanover) — noise next to the primary listing, so they're dropped.
  var SKIP_EXCHANGES = { HAN: 1, MUN: 1, STU: 1, DUS: 1, BER: 1, HAM: 1, FRA: 1 };

  function timedFetch(url, ms) {
    var ctrl  = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function() { if (ctrl) ctrl.abort(); }, ms);
    return fetch(url, ctrl ? { signal: ctrl.signal } : undefined)
      .then(function(r) { clearTimeout(timer); return r; },
            function(e) { clearTimeout(timer); throw e; });
  }

  function workerJson(yahooUrl) {
    return timedFetch(WORKER_URL + '?url=' + encodeURIComponent(yahooUrl), 8000).then(function(r) {
      if (!r.ok) throw new Error('search ' + r.status);
      return r.json();
    });
  }

  function search(query) {
    var q = String(query || '').trim();
    if (q.length < MIN_CHARS) return Promise.resolve([]);
    var key = q.toLowerCase();
    if (cache[key]) return Promise.resolve(cache[key]);

    var url = 'https://query1.finance.yahoo.com/v1/finance/search?q=' + encodeURIComponent(q)
            + '&quotesCount=15&newsCount=0&listsCount=0&enableFuzzyQuery=true';
    // Yahoo rate-limits per host, so retry once on query2
    return workerJson(url)
      .catch(function() { return workerJson(url.replace('://query1.', '://query2.')); })
      .then(function(data) {
        var items = toItems((data && data.quotes) || []);
        cache[key] = items;
        return items;
      });
  }

  function toItems(quotes) {
    var seen = {};
    return quotes
      .filter(function(x) {
        // Skip derivatives/indices and NSE block-deal windows (e.g. TMCV-BL.NS)
        return x && x.symbol && TYPE_LABEL[x.quoteType] && !/-BL\./.test(x.symbol)
          && !SKIP_EXCHANGES[x.exchange];
      })
      .map(function(x, i) {
        var ex = EXCHANGES[x.exchange] || { label: x.exchDisp || x.exchange || '', rank: 3 };
        // MF shortnames are often just the 0P… code, so prefer the long name
        var name = x.longname || x.shortname || x.symbol;
        return {
          symbol:   x.symbol,
          name:     String(name).replace(/\s+/g, ' ').trim(),
          exchange: ex.label,
          type:     x.quoteType,
          typeLabel: TYPE_LABEL[x.quoteType],
          _rank:    ex.rank,
          _order:   i,
        };
      })
      .sort(function(a, b) { return (a._rank - b._rank) || (a._order - b._order); })
      // Same company on NSE and BSE → keep only the higher-ranked (NSE) listing
      .filter(function(it) {
        var k = it.name.toLowerCase() + '|' + it.type + '|' + (it._rank <= 1 ? 'IN' : it.exchange);
        if (seen[k]) return false;
        seen[k] = true;
        return true;
      })
      .slice(0, MAX_ITEMS);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var stylesAdded = false;
  function addStyles() {
    if (stylesAdded) return;
    stylesAdded = true;
    // Variables fall back across v2 (--s2/--t1/…) and classic (--surface/--text/…)
    var css = ''
      + '.frss-wrap{position:relative}'
      + '.frss-list{position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:10050;max-height:300px;overflow-y:auto;'
      +   'background:var(--s2,var(--surface,#161a22));border:1px solid var(--b2,var(--border,#2a2f3a));border-radius:10px;'
      +   'box-shadow:0 10px 28px rgba(0,0,0,.35);padding:4px;display:none}'
      + '.frss-list.open{display:block}'
      + '.frss-item{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;border-radius:7px;cursor:pointer;'
      +   'color:var(--t1,var(--text,#e8eaf0));font-size:13px;line-height:1.3}'
      + '.frss-item.active,.frss-item:hover{background:var(--a10,rgba(0,200,150,.12))}'
      + '.frss-name{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}'
      + '.frss-meta{flex-shrink:0;font-size:11px;color:var(--t3,var(--muted,#8a90a0));white-space:nowrap}'
      + '.frss-msg{padding:9px 10px;font-size:12px;color:var(--t3,var(--muted,#8a90a0))}'
      + '.frss-status{margin-top:5px;font-size:11.5px;color:var(--t3,var(--muted,#8a90a0))}'
      + '.frss-status.linked{color:var(--accent,#00c896)}';
    var el = document.createElement('style');
    el.textContent = css;
    document.head.appendChild(el);
  }

  /* Turn a text input into a name-search combobox.
     opts.enabled()   → false disables search (e.g. category is FD / Gold)
     opts.onPick(it)  → user chose a match: { symbol, name, exchange, type, typeLabel }
     opts.onEdit()    → user changed the text after a pick (caller unlinks the ticker)
     opts.prefer      → () => 'EQUITY' | 'MUTUALFUND' to float that type to the top */
  function attach(input, opts) {
    if (!input || input._frss) return;
    opts = opts || {};
    addStyles();

    var host = input.parentNode;
    host.classList.add('frss-wrap');
    var list = document.createElement('div');
    list.className = 'frss-list';
    list.setAttribute('role', 'listbox');
    host.appendChild(list);

    input.setAttribute('autocomplete', 'off');
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');

    var state = { items: [], active: -1, seq: 0, timer: null };
    input._frss = state;

    function enabled() { return !opts.enabled || opts.enabled(); }

    function close() {
      list.classList.remove('open');
      input.setAttribute('aria-expanded', 'false');
      state.active = -1;
    }
    function showMsg(msg) {
      list.innerHTML = '<div class="frss-msg">' + esc(msg) + '</div>';
      list.classList.add('open');
      input.setAttribute('aria-expanded', 'true');
    }
    function render() {
      if (!state.items.length) {
        showMsg('No matches — check the spelling. You can still save it without a live price.');
        return;
      }
      list.innerHTML = state.items.map(function(it, i) {
        return '<div class="frss-item' + (i === state.active ? ' active' : '') + '" role="option" data-i="' + i + '">'
          + '<span class="frss-name">' + esc(it.name) + '</span>'
          + '<span class="frss-meta">' + esc([it.exchange, it.typeLabel].filter(Boolean).join(' · ')) + '</span>'
          + '</div>';
      }).join('');
      list.classList.add('open');
      input.setAttribute('aria-expanded', 'true');
    }
    function pick(i) {
      var it = state.items[i];
      if (!it) return;
      input.value = it.name;
      close();
      if (opts.onPick) opts.onPick(it);
    }

    function run() {
      var q = input.value.trim();
      if (q.length < MIN_CHARS) { close(); return; }
      var seq = ++state.seq;
      showMsg('Searching…');
      search(q).then(function(items) {
        if (seq !== state.seq || document.activeElement !== input) return;
        var pref = opts.prefer && opts.prefer();
        state.items = pref
          ? items.filter(function(it) { return it.type === pref; })
              .concat(items.filter(function(it) { return it.type !== pref; }))
          : items;
        state.active = state.items.length ? 0 : -1;
        render();
      }).catch(function(e) {
        if (seq !== state.seq) return;
        console.warn('[SecuritySearch]', e.message);
        showMsg('Search is unavailable right now — you can still save it without a live price.');
      });
    }

    input.addEventListener('input', function() {
      if (opts.onEdit) opts.onEdit();
      clearTimeout(state.timer);
      if (!enabled()) { close(); return; }
      state.timer = setTimeout(run, DEBOUNCE);
    });
    input.addEventListener('keydown', function(e) {
      if (!list.classList.contains('open') || !state.items.length) {
        if (e.key === 'Escape') close();
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        var n = state.items.length;
        state.active = (state.active + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
        render();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        pick(state.active < 0 ? 0 : state.active);
      } else if (e.key === 'Escape') {
        e.stopPropagation();   // close the dropdown, not the whole modal
        close();
      }
    });
    input.addEventListener('blur', function() { setTimeout(close, 150); });
    // mousedown (not click) so the pick lands before the input's blur closes the list
    list.addEventListener('mousedown', function(e) {
      var row = e.target.closest('.frss-item');
      if (!row) return;
      e.preventDefault();
      pick(+row.getAttribute('data-i'));
    });
  }

  return { search: search, attach: attach };
})();
