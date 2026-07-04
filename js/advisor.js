/* ============================================================
   advisor.js — AI Financial Advisor module
   FinResolver · finresolver.in
   ============================================================ */

/* Feature flag — AI Advisor is still being built. Flip to true when ready. */
var ADVISOR_ENABLED = false;

/* ── Module state ── */
var _advisorApiKey   = null;   // loaded from Firestore / localStorage
var _advisorHistory  = [];     // rolling last-6 messages [{role, content}]
var _advisorSnapshot = null;   // cached snapshot for the current session
var _advisorLoading  = false;  // guard against concurrent requests

var ADVISOR_CLAUDE_MODEL = 'claude-sonnet-4-6';
var ADVISOR_MAX_TOKENS   = 1000;
var ADVISOR_SYSTEM_PROMPT =
  'You are a friendly, expert personal finance advisor for an Indian user. ' +
  'You have access to their real financial data (provided below in each message). ' +
  'Give concise, actionable advice. Use ₹ for currency. Keep responses under 150 words ' +
  'unless the user explicitly asks for detail. Never give generic advice — always ' +
  'reference their actual numbers. Flag any red flags (high debt, negative savings, ' +
  'concentrated portfolio). End each response with exactly one follow-up question ' +
  'suggestion on its own line, prefixed with "💬 Ask me:".';

/* ─────────────────────────────────────────────────────────────
   1. FINANCIAL SNAPSHOT
───────────────────────────────────────────────────────────── */

function getFinancialSnapshot() {
  var uid = (typeof fbAuth !== 'undefined' && fbAuth && fbAuth.currentUser && fbAuth.currentUser.uid)
            ? fbAuth.currentUser.uid
            : (typeof currentUser !== 'undefined' && currentUser ? currentUser.uid : 'guest');

  var now = new Date();
  var yr  = now.getFullYear();
  var mo  = now.getMonth();

  /* ── YTD monthly totals ── */
  var ytdInc = 0, ytdExp = 0, ytdLoan = 0;
  var descMap = {}; // expense description → total amount (for top categories)

  for (var m = 0; m <= mo; m++) {
    var d = (typeof getCachedMonthData === 'function')
            ? getCachedMonthData(uid, yr, m) : null;
    if (!d) continue;
    var _sum = function(arr) {
      return (arr || []).reduce(function(a, e) { return a + Number(e.amount || 0); }, 0);
    };
    ytdInc  += _sum(d.income);
    ytdExp  += _sum(d.expense);
    ytdLoan += _sum(d.loan);
    (d.expense || []).forEach(function(e) {
      var cat = (e.desc || 'Other').trim();
      descMap[cat] = (descMap[cat] || 0) + Number(e.amount || 0);
    });
  }

  var savingsRate = ytdInc > 0
    ? Math.round(((ytdInc - ytdExp - ytdLoan) / ytdInc) * 100) : 0;

  var topCategories = Object.entries(descMap)
    .sort(function(a, b) { return b[1] - a[1]; })
    .slice(0, 5)
    .map(function(pair) { return { name: pair[0], amount: Math.round(pair[1]) }; });

  /* ── Loans ── */
  var totalOutstanding = 0, totalEMI = 0, highestInterestLoan = null;
  try {
    var loans = (typeof loansData !== 'undefined') ? loansData : [];
    loans.forEach(function(loan) {
      if (loan.closed) return;
      var outstanding = Number(loan.principal || 0);
      (loan.payments || []).forEach(function(p) { outstanding -= Number(p.amount || 0); });
      if (typeof calcLoanStats === 'function') {
        try { outstanding = calcLoanStats(loan).outstanding; } catch(e2) {}
      }
      if (outstanding <= 0) return;
      totalOutstanding += outstanding;
      var r   = Number(loan.rate || 0) / 100 / 12;
      var n   = Number(loan.tenure || 0);
      var p   = Number(loan.principal || 0);
      var emi = (r > 0 && n > 0) ? p * r * Math.pow(1+r,n) / (Math.pow(1+r,n) - 1) : 0;
      totalEMI += emi;
      if (!highestInterestLoan || Number(loan.rate) > Number(highestInterestLoan.rate)) {
        highestInterestLoan = {
          name: loan.name,
          rate: Number(loan.rate),
          outstanding: Math.round(outstanding)
        };
      }
    });
  } catch(e) {}

  /* ── Investments ── */
  var totalInvested = 0, currentValue = 0;
  var catBreakdown = {};
  var holdingsList = [];
  try {
    var holdings = (typeof investmentsData !== 'undefined') ? investmentsData : [];
    holdings.forEach(function(h) {
      var cost = 0, val = 0, qty = 0, avgPx = 0, livePx = 0;
      if (h.category === 'Gold') {
        qty   = Number(h.grams || h.qty || 0);
        avgPx = Number(h.buyPricePerGram || h.avgPrice || 0);
        cost  = qty * avgPx;
        var liveG = (typeof goldPriceCache !== 'undefined' && goldPriceCache && goldPriceCache.pricePerGram)
                    ? goldPriceCache.pricePerGram : 0;
        livePx = liveG || avgPx;
        val = qty * livePx;
      } else if (h.category === 'RealEstate' || h.category === 'EPF') {
        cost   = Number(h.buyPrice || h.avgPrice || 0);
        val    = Number(h.curPrice || h.buyPrice || h.avgPrice || 0);
        livePx = Number(h.curPrice || 0);
      } else {
        qty   = Number(h.qty || 0);
        avgPx = Number(h.avgPrice || 0);
        cost  = qty * avgPx;
        var q = (typeof invQuoteCache !== 'undefined') && h.ticker && invQuoteCache[h.ticker];
        livePx = q ? (typeof toInr === 'function' ? toInr(q.price, q.currency) : q.price) : 0;
        val = livePx ? qty * livePx : cost;
      }
      totalInvested += cost;
      currentValue  += val;
      var cat = h.category || 'Others';
      catBreakdown[cat] = (catBreakdown[cat] || 0) + val;

      if (cost > 0 || val > 0) {
        var entry = {
          name:         h.name || h.ticker || 'Unknown',
          category:     cat === 'RealEstate' ? 'Real Estate' : cat,
          invested:     Math.round(cost),
          currentValue: Math.round(val),
          gainLoss:     Math.round(val - cost),
          gainLossPct:  cost > 0 ? Math.round(((val - cost) / cost) * 1000) / 10 : 0
        };
        if (h.ticker) entry.ticker       = h.ticker;
        if (h.isin)   entry.isin         = h.isin;
        if (qty)      entry.qty          = Math.round(qty * 100) / 100;
        if (avgPx)    entry.avgBuyPrice  = Math.round(avgPx);
        if (livePx)   entry.currentPrice = Math.round(livePx);
        var _hSrc = (typeof invGetHoldingSources === 'function')
                    ? invGetHoldingSources(h)
                    : (h.source && h.source !== 'manual' ? [h.source] : []);
        if (_hSrc.length) entry.brokers = _hSrc;
        holdingsList.push(entry);
      }
    });
  } catch(e) {}

  var portfolioBreakdown = Object.entries(catBreakdown)
    .sort(function(a, b) { return b[1] - a[1]; })
    .map(function(pair) { return { category: pair[0], value: Math.round(pair[1]) }; });

  /* ── Net worth ── */
  var curBal = (typeof getMonthBalance === 'function')
               ? getMonthBalance(uid, yr, mo) : 0;
  var netWorth = currentValue + Math.max(0, curBal) - totalOutstanding;

  /* ── Plain English summary ── */
  var srLabel = savingsRate >= 20 ? 'healthy' : savingsRate >= 10 ? 'moderate' : 'low';
  var summary = 'Net worth ' + _advFmt(netWorth) + ' with a ' + savingsRate + '% savings rate (' + srLabel + '). ' +
    'Portfolio value ' + _advFmt(currentValue) + ', loans outstanding ' + _advFmt(totalOutstanding) + '.';

  return {
    monthly: {
      totalIncome:   Math.round(ytdInc),
      totalExpenses: Math.round(ytdExp),
      topCategories: topCategories,
      savingsRate:   savingsRate
    },
    loans: {
      totalOutstanding: Math.round(totalOutstanding),
      totalEMI:         Math.round(totalEMI),
      highestInterestLoan: highestInterestLoan
    },
    investments: {
      totalInvested:      Math.round(totalInvested),
      currentValue:       Math.round(currentValue),
      totalGainLoss:      Math.round(currentValue - totalInvested),
      portfolioBreakdown: portfolioBreakdown,
      holdings:           holdingsList
    },
    netWorth: Math.round(netWorth),
    summary:  summary
  };
}

/* Compact lakh/crore formatter for snapshot text */
function _advFmt(n) {
  if (typeof fmtCrore === 'function') return fmtCrore(n);
  var abs = Math.abs(n);
  var sign = n < 0 ? '-' : '';
  if (abs >= 1e7) return sign + '₹' + (abs / 1e7).toFixed(1) + 'Cr';
  if (abs >= 1e5) return sign + '₹' + (abs / 1e5).toFixed(1) + 'L';
  return sign + '₹' + Math.round(abs).toLocaleString('en-IN');
}

/* ─────────────────────────────────────────────────────────────
   2. API KEY MANAGEMENT  (stored in Firestore + localStorage)
───────────────────────────────────────────────────────────── */

async function advisorLoadApiKey() {
  var uid = _advUid();
  if (uid === 'guest') return null;

  /* Try Firestore first */
  try {
    if (typeof db !== 'undefined' && db) {
      var snap = await db.collection('users').doc(uid)
                         .collection('config').doc('advisor').get();
      if (snap.exists && snap.data().apiKey) {
        _advisorApiKey = snap.data().apiKey;
        return _advisorApiKey;
      }
    }
  } catch(e) { console.warn('[advisor] key load error', e); }

  /* Fall back to localStorage */
  var local = localStorage.getItem('fr_advisor_key_' + uid);
  if (local) { _advisorApiKey = local; return local; }
  return null;
}

async function _advisorPersistKey(key) {
  var uid = _advUid();
  _advisorApiKey = key;
  if (uid !== 'guest') {
    localStorage.setItem('fr_advisor_key_' + uid, key);
    try {
      if (typeof db !== 'undefined' && db) {
        await db.collection('users').doc(uid)
                .collection('config').doc('advisor')
                .set({ apiKey: key }, { merge: true });
      }
    } catch(e) { console.warn('[advisor] key save error', e); }
  }
}

function _advUid() {
  if (typeof fbAuth !== 'undefined' && fbAuth && fbAuth.currentUser && fbAuth.currentUser.uid)
    return fbAuth.currentUser.uid;
  return (typeof currentUser !== 'undefined' && currentUser && currentUser.uid) ? currentUser.uid : 'guest';
}

/* ─────────────────────────────────────────────────────────────
   3. CLAUDE API CALLS
───────────────────────────────────────────────────────────── */

/* Low-level call — does NOT touch conversation history */
async function _advCallRaw(userContent) {
  var resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         _advisorApiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model:      ADVISOR_CLAUDE_MODEL,
      max_tokens: ADVISOR_MAX_TOKENS,
      system:     ADVISOR_SYSTEM_PROMPT,
      messages:   [{ role: 'user', content: userContent }]
    })
  });

  if (resp.status === 429) throw new Error('RATE_LIMIT');
  if (!resp.ok) {
    var err = await resp.json().catch(function() { return {}; });
    throw new Error((err.error && err.error.message) || 'API_ERROR');
  }
  var data = await resp.json();
  return (data.content && data.content[0] && data.content[0].text) ? data.content[0].text : '';
}

/* Conversational call — maintains rolling history of last 6 messages */
async function _advCallWithHistory(userContent) {
  /* Push user message (with snapshot injected) */
  _advisorHistory.push({ role: 'user', content: userContent });
  if (_advisorHistory.length > 6) _advisorHistory.shift();

  var resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         _advisorApiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model:      ADVISOR_CLAUDE_MODEL,
      max_tokens: ADVISOR_MAX_TOKENS,
      system:     ADVISOR_SYSTEM_PROMPT,
      messages:   _advisorHistory
    })
  });

  if (resp.status === 429) {
    _advisorHistory.pop(); // remove the failed user message
    throw new Error('RATE_LIMIT');
  }
  if (!resp.ok) {
    _advisorHistory.pop();
    var err = await resp.json().catch(function() { return {}; });
    throw new Error((err.error && err.error.message) || 'API_ERROR');
  }

  var data    = await resp.json();
  var answer  = (data.content && data.content[0] && data.content[0].text) ? data.content[0].text : '';

  /* Push assistant reply into history */
  _advisorHistory.push({ role: 'assistant', content: answer });
  if (_advisorHistory.length > 6) _advisorHistory.shift();

  return answer;
}

/* ─────────────────────────────────────────────────────────────
   4. PROACTIVE INSIGHTS (auto-generated on load)
───────────────────────────────────────────────────────────── */

async function _advisorLoadInsights(snap) {
  var container = document.getElementById('advisorInsightsCards');
  if (!container) return;

  container.innerHTML =
    '<div class="adv-insights-loading"><span class="adv-dot-pulse"></span> Analyzing your finances…</div>';

  var prompt =
    'User\'s current financial data:\n' + JSON.stringify(snap, null, 2) + '\n\n' +
    'Analyze this data and give exactly 3 key financial insights. ' +
    'Format: each item on its own line, starting with exactly one of these labels: ' +
    '"⚠️ Risk:", "💡 Opportunity:", or "📊 Insight:". Use each label at most once. ' +
    'Be specific — always cite actual numbers. Keep each item under 45 words. ' +
    'Do not add a follow-up question here.';

  try {
    if (!_advisorApiKey) throw new Error('NO_KEY');
    var answer = await _advCallRaw(prompt);
    var lines  = answer.split('\n')
      .map(function(l) { return l.trim(); })
      .filter(function(l) { return /^(⚠️|💡|📊)/.test(l); })
      .slice(0, 3);

    if (!lines.length) {
      container.innerHTML =
        '<div class="adv-insight-card adv-insight-neutral">' +
        '<span class="adv-insight-icon">📊</span>' +
        '<div class="adv-insight-text">' + _advMarkdown(answer) + '</div></div>';
      return;
    }

    container.innerHTML = lines.map(function(line) {
      var isRisk = line.includes('⚠️');
      var isOpp  = line.includes('💡');
      var icon   = isRisk ? '⚠️' : isOpp ? '💡' : '📊';
      var cls    = isRisk ? 'adv-insight-risk' : isOpp ? 'adv-insight-opp' : 'adv-insight-info';
      var text   = line.replace(/^(⚠️|💡|📊)\s*(Risk:|Opportunity:|Insight:)?\s*/i, '').trim();
      return '<div class="adv-insight-card ' + cls + '">' +
             '<span class="adv-insight-icon">' + icon + '</span>' +
             '<div class="adv-insight-text">' + _advMarkdown(text) + '</div>' +
             '</div>';
    }).join('');

  } catch(e) {
    var msg = e.message === 'NO_KEY'
      ? 'Enter your Anthropic API key in Settings to see insights.'
      : 'Could not load insights. Check your API key and try again.';
    container.innerHTML =
      '<div class="adv-insight-card adv-insight-neutral">' +
      '<span class="adv-insight-icon">📊</span>' +
      '<div class="adv-insight-text" style="color:var(--muted)">' + msg + '</div>' +
      '</div>';
  }
}

/* ─────────────────────────────────────────────────────────────
   5. CHAT SEND / RECEIVE
───────────────────────────────────────────────────────────── */

async function advisorSend(text) {
  if (_advisorLoading) return;

  var inp = document.getElementById('advisorInput');
  var msg = (text || (inp && inp.value) || '').trim();
  if (!msg) return;
  if (!_advisorApiKey) { advisorShowKeyModal(); return; }

  if (inp) { inp.value = ''; inp.style.height = 'auto'; }
  _advisorLoading = true;

  /* Hide error */
  var errEl = document.getElementById('advisorError');
  if (errEl) errEl.style.display = 'none';

  _advAppendMsg('user', msg);
  _advShowTyping(true);

  /* Inject snapshot into every user message sent to API */
  var snap     = _advisorSnapshot || getFinancialSnapshot();
  var fullMsg  = 'User\'s current financial data:\n' +
                 JSON.stringify(snap, null, 2) +
                 '\n\nUser question: ' + msg;

  try {
    var reply = await _advCallWithHistory(fullMsg);
    _advShowTyping(false);
    _advAppendMsg('assistant', reply);
  } catch(e) {
    _advShowTyping(false);
    if (e.message === 'NO_KEY') {
      advisorShowKeyModal();
    } else if (e.message === 'RATE_LIMIT') {
      _advShowError('Please wait a moment before asking again.');
    } else {
      _advShowError("Couldn't reach the advisor. Check your API key in ⚙️ Settings.");
    }
  } finally {
    _advisorLoading = false;
  }
}

function advisorSendInput() {
  var inp = document.getElementById('advisorInput');
  if (inp && inp.value.trim()) advisorSend(inp.value.trim());
}

/* ─────────────────────────────────────────────────────────────
   6. RENDER HELPERS
───────────────────────────────────────────────────────────── */

/* Minimal markdown → HTML (supports headings, tables, bold, italic, lists) */
function _advMarkdown(text) {
  function _esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function _inline(s) {
    return s
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*\n]+?)\*/g, '<em>$1</em>');
  }

  var lines = _esc(text).split('\n');
  var out = [], inList = false, inTable = false, tableRows = [];

  function flushTable() {
    if (!tableRows.length) { inTable = false; return; }
    var dataRows = tableRows.filter(function(r) { return r !== null; });
    if (!dataRows.length) { inTable = false; return; }
    var html = '<div class="adv-table-wrap"><table class="adv-table"><thead><tr>';
    dataRows[0].forEach(function(c) { html += '<th>' + _inline(c.trim()) + '</th>'; });
    html += '</tr></thead><tbody>';
    dataRows.slice(1).forEach(function(row) {
      html += '<tr>';
      row.forEach(function(c) { html += '<td>' + _inline(c.trim()) + '</td>'; });
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    out.push(html);
    tableRows = []; inTable = false;
  }

  for (var i = 0; i < lines.length; i++) {
    var t = lines[i].trim();

    /* Table row — lines starting with | (but NOT heading lines starting with #) */
    if (/^\|.+\|/.test(t) && !/^#/.test(t)) {
      if (inList) { out.push('</ul>'); inList = false; }
      inTable = true;
      if (/^\|[-:\s|]+\|$/.test(t)) {
        tableRows.push(null); // separator row
      } else {
        tableRows.push(t.split('|').slice(1, -1));
      }
      continue;
    }
    if (inTable) flushTable();

    /* Headings — ### before ## before # to avoid prefix collision */
    var hm;
    if ((hm = t.match(/^###\s+(.*)/))) {
      if (inList) { out.push('</ul>'); inList = false; }
      /* Strip any trailing | col | col | from heading (model sometimes embeds columns) */
      var hText = hm[1].replace(/\s*\|.*$/, '').trim();
      out.push('<div class="adv-h3">' + _inline(hText) + '</div>');
      continue;
    }
    if ((hm = t.match(/^##?\s+(.*)/))) {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push('<div class="adv-h2">' + _inline(hm[1]) + '</div>');
      continue;
    }

    var line = _inline(t);
    if (/^[-•]\s+/.test(line)) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push('<li>' + line.replace(/^[-•]\s+/, '') + '</li>');
    } else {
      if (inList) { out.push('</ul>'); inList = false; }
      if (!line) {
        if (out.length && out[out.length - 1] !== '<br>') out.push('<br>');
      } else if (/^💬\s*Ask me:/.test(line)) {
        out.push('<div class="adv-followup">' + line + '</div>');
      } else {
        out.push(line);
      }
    }
  }

  if (inList) out.push('</ul>');
  if (inTable) flushTable();
  return out.join('\n');
}

/* Tone classification for color-coding */
function _advTone(text) {
  var lower = text.toLowerCase();
  var risks  = ['red flag','risk','warning','danger','high debt','negative savings','oversp','too much','above average'];
  var greens = ['great','excellent','good job','well done','positive trend','healthy','strong savings','on track'];
  if (risks.some(function(w)  { return lower.includes(w); })) return 'warn';
  if (greens.some(function(w) { return lower.includes(w); })) return 'good';
  return 'neutral';
}

function _advAppendMsg(role, text) {
  var chat = document.getElementById('advisorChatHistory');
  if (!chat) return;

  var div = document.createElement('div');
  div.className = 'adv-msg adv-msg-' + role;

  if (role === 'assistant') {
    div.setAttribute('data-tone', _advTone(text));
    div.innerHTML = _advMarkdown(text);
  } else {
    var p = document.createElement('p');
    p.textContent = text;
    div.appendChild(p);
  }

  chat.appendChild(div);
  /* Scroll to latest message */
  chat.scrollTop = chat.scrollHeight;
}

function _advShowTyping(show) {
  var el = document.getElementById('advisorTyping');
  if (el) el.style.display = show ? 'flex' : 'none';
  if (show) {
    var chat = document.getElementById('advisorChatHistory');
    if (chat) chat.scrollTop = chat.scrollHeight;
  }
}

function _advShowError(msg) {
  var el = document.getElementById('advisorError');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(function() { el.style.display = 'none'; }, 8000);
}

/* ─────────────────────────────────────────────────────────────
   7. CONTEXT PANEL
───────────────────────────────────────────────────────────── */

function _advisorRenderCtxPanel(snap) {
  var setText = function(id, v) {
    var el = document.getElementById(id);
    if (el) el.textContent = v;
  };

  setText('advCtxNetWorth',   _advFmt(snap.netWorth));
  setText('advCtxSavings',    snap.monthly.savingsRate + '%');
  setText('advCtxPortfolio',  _advFmt(snap.investments.currentValue));
  setText('advCtxLoan',       snap.loans.totalOutstanding > 0 ? _advFmt(snap.loans.totalOutstanding) : '₹0');

  /* Color coding */
  var nwEl = document.getElementById('advCtxNetWorth');
  if (nwEl) nwEl.style.color = snap.netWorth >= 0 ? 'var(--purple)' : 'var(--accent2)';

  var srEl = document.getElementById('advCtxSavings');
  if (srEl) srEl.style.color =
    snap.monthly.savingsRate >= 20 ? 'var(--accent)'
    : snap.monthly.savingsRate >= 10 ? 'var(--accent3)' : 'var(--accent2)';

  var loEl = document.getElementById('advCtxLoan');
  if (loEl) loEl.style.color = snap.loans.totalOutstanding > 0 ? 'var(--accent2)' : 'var(--accent)';
}

/* ─────────────────────────────────────────────────────────────
   8. API KEY MODAL
───────────────────────────────────────────────────────────── */

function advisorShowKeyModal() {
  var modal = document.getElementById('advisorKeyModal');
  if (modal) modal.classList.remove('hidden');
  var inp = document.getElementById('advisorKeyInput');
  if (inp) { inp.value = _advisorApiKey || ''; inp.focus(); }
}

function advisorHideKeyModal() {
  var modal = document.getElementById('advisorKeyModal');
  if (modal) modal.classList.add('hidden');
}

async function advisorSaveKey() {
  var inp = document.getElementById('advisorKeyInput');
  var key = (inp && inp.value || '').trim();

  if (!key.startsWith('sk-ant-')) {
    var errEl = document.getElementById('advisorKeyError');
    if (errEl) { errEl.textContent = 'Key must start with sk-ant-'; errEl.style.display = 'block'; }
    return;
  }

  await _advisorPersistKey(key);
  advisorHideKeyModal();

  /* Now that we have a key, load insights if the screen is active */
  if (_advisorSnapshot) {
    _advisorLoadInsights(_advisorSnapshot);
  }
}

/* ─────────────────────────────────────────────────────────────
   9. SCREEN ENTRY POINT
───────────────────────────────────────────────────────────── */

async function goToAdvisor(_fromPopstate) {
  if (!ADVISOR_ENABLED) {
    if (typeof showToast === 'function') showToast("AI Advisor is coming soon — we're still building it!", 'info');
    return;
  }
  if (typeof ProManager !== 'undefined' && !ProManager.isPro()) {
    ProManager.showUpgradeModal('AI Advisor');
    return;
  }
  if (!_fromPopstate) history.pushState({ screen: 'advisor' }, '');

  /* Hide all other screens (home.js helper) */
  if (typeof _hideAllScreens === 'function') _hideAllScreens();
  if (typeof _currentScreen !== 'undefined') _currentScreen = 'advisor';

  var screen = document.getElementById('advisorScreen');
  if (screen) screen.style.display = 'block';

  document.getElementById('btnHamburger').style.display = 'flex';
  var tc = document.getElementById('headerTrackerControls');
  if (tc) tc.style.display = 'none';

  if (typeof closeNavDrawer === 'function') closeNavDrawer();

  /* Check if any financial data exists */
  var uid     = _advUid();
  var hasData = _advisorHasData(uid);

  var emptyEl = document.getElementById('advisorEmptyState');
  var mainEl  = document.getElementById('advisorMainContent');

  if (!hasData) {
    if (emptyEl) emptyEl.style.display  = 'flex';
    if (mainEl)  mainEl.style.display   = 'none';
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';
  if (mainEl)  mainEl.style.display  = 'block';

  /* Build & render snapshot */
  _advisorSnapshot = getFinancialSnapshot();
  _advisorRenderCtxPanel(_advisorSnapshot);

  /* Load API key */
  await advisorLoadApiKey();

  /* Kick off proactive insights (even without key — will show "add key" message) */
  _advisorLoadInsights(_advisorSnapshot);

  /* If no key yet, show settings modal */
  if (!_advisorApiKey) {
    setTimeout(advisorShowKeyModal, 400); // slight delay so screen renders first
  }
}

function _advisorHasData(uid) {
  var now = new Date();
  for (var i = 0; i <= 3; i++) {
    var m = now.getMonth() - i, y = now.getFullYear();
    if (m < 0) { m += 12; y--; }
    if (localStorage.getItem('fr_data_' + uid + '_' + y + '_' + m)) return true;
  }
  try {
    var inv  = localStorage.getItem('fr_investments_' + uid);
    var loan = localStorage.getItem('fr_loans_' + uid);
    if (inv  && JSON.parse(inv).length)  return true;
    if (loan && JSON.parse(loan).length) return true;
  } catch(e) {}
  return false;
}
