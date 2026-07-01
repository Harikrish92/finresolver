// ── AI FINANCIAL ADVISOR MODULE ───────────────────────────────────────────────
// Chat and insights state — persists across in-session navigation
let _adv2ApiKey   = null;
let _adv2History  = [];   // Anthropic API messages [{role, content}]
let _adv2Messages = [];   // display log [{role, text}]
let _adv2Snap     = null; // cached financial snapshot
let _adv2Insights = null; // cached insights HTML (null = not yet loaded)
let _adv2Loading  = false;

// Pro subscription state (server-funded advisor, no BYOK key needed)
let _adv2Pro         = null; // { active, expiry } — null = not loaded yet
let _adv2ProWatchUnsub = null;
const ADV2_PRO_PRICE_LABEL = '₹999/year';

const ADV2_MODEL   = 'claude-sonnet-4-6';
const ADV2_MAX_TOK = 1000;
const ADV2_SYSTEM  =
  'You are a friendly, expert personal finance advisor for an Indian user. ' +
  'You have access to their real financial data (provided below in each message). ' +
  'Give concise, actionable advice. Use ₹ for currency. Keep responses under 150 words ' +
  'unless the user explicitly asks for detail. Never give generic advice — always ' +
  'reference their actual numbers. Flag any red flags (high debt, negative savings, ' +
  'concentrated portfolio). End each response with exactly one follow-up question ' +
  'suggestion on its own line, prefixed with "💬 Ask me:".';

// ── HELPERS ───────────────────────────────────────────────────────────────────
function _adv2Uid() {
  if (typeof fbAuth !== 'undefined' && fbAuth && fbAuth.currentUser)
    return fbAuth.currentUser.uid;
  return (APP.user && APP.user.uid) || 'guest';
}

// ── FINANCIAL SNAPSHOT ────────────────────────────────────────────────────────
function _adv2BuildSnapshot() {
  const stats = getPortfolioStats();
  const m     = APP.monthly;

  // Aggregate YTD across current month + history
  // APP.monthly has arrays; APP.history entries have pre-summed numbers
  let ytdInc = 0, ytdExp = 0, ytdLoan = 0;
  const sumField = function(val) {
    if (!val) return 0;
    if (typeof val === 'number') return val;
    return val.reduce(function(a,i){ return a+(i.amount||0); }, 0);
  };
  const aggregate = function(hm) {
    ytdInc  += sumField(hm.income);
    ytdExp  += sumField(hm.expenses);
    ytdLoan += sumField(hm.loans);
  };
  aggregate(m);
  (APP.history || []).forEach(aggregate);

  const savingsRate = ytdInc > 0
    ? Math.round(((ytdInc - ytdExp - ytdLoan) / ytdInc) * 100) : 0;

  // Top expense categories (current month only)
  const descMap = {};
  m.expenses.forEach(function(e) {
    descMap[e.desc || 'Other'] = (descMap[e.desc || 'Other'] || 0) + (e.amount || 0);
  });
  const topCategories = Object.entries(descMap)
    .sort(function(a, b) { return b[1] - a[1]; }).slice(0, 5)
    .map(function(p) { return { name: p[0], amount: Math.round(p[1]) }; });

  // Portfolio by category
  const catMap = {};
  APP.investments.forEach(function(inv) {
    const cat = _invCat(inv);
    catMap[cat] = (catMap[cat] || 0) + invValue(inv);
  });
  const portfolioBreakdown = Object.entries(catMap)
    .sort(function(a, b) { return b[1] - a[1]; })
    .map(function(p) { return { category: p[0], value: Math.round(p[1]) }; });

  // Individual holdings
  const holdings = APP.investments.map(function(inv) {
    const cat  = _invCat(inv);
    const cost = invCost(inv);
    const val  = invValue(inv);
    const qty  = _invTotalQty(inv);
    const avgPx = _invAvgPrice(inv);
    const pnl  = val - cost;
    const entry = {
      name:         inv.name || inv.ticker || 'Unknown',
      category:     cat,
      invested:     Math.round(cost),
      currentValue: Math.round(val),
      gainLoss:     Math.round(pnl),
      gainLossPct:  cost > 0 ? Math.round((pnl / cost) * 1000) / 10 : 0
    };
    if (inv.ticker)    entry.ticker       = inv.ticker;
    if (qty)           entry.qty          = Math.round(qty * 100) / 100;
    if (avgPx)         entry.avgBuyPrice  = Math.round(avgPx);
    if (inv.livePrice) entry.currentPrice = Math.round(inv.livePrice);
    return entry;
  }).filter(function(h) { return h.invested > 0 || h.currentValue > 0; });

  // Highest interest open loan
  const openLoans = APP.loans.filter(function(l) { return loanOutstanding(l) > 0; });
  const hiLoan = openLoans.sort(function(a, b) { return _loanRate(b) - _loanRate(a); })[0];

  return {
    monthly: {
      totalIncome:   Math.round(ytdInc),
      totalExpenses: Math.round(ytdExp),
      topCategories: topCategories,
      savingsRate:   savingsRate
    },
    loans: {
      totalOutstanding: Math.round(stats.totalDebt),
      totalEMI:         Math.round(APP.loans.reduce(function(a,l){ return a+loanEMI(l); }, 0)),
      highestInterestLoan: hiLoan
        ? { name: hiLoan.name, rate: _loanRate(hiLoan), outstanding: Math.round(loanOutstanding(hiLoan)) }
        : null
    },
    investments: {
      totalInvested:      Math.round(stats.totalInvested),
      currentValue:       Math.round(stats.currentValue),
      totalGainLoss:      Math.round(stats.pnl),
      portfolioBreakdown: portfolioBreakdown,
      holdings:           holdings
    },
    netWorth: Math.round(stats.netWorth),
    summary:  'Net worth ' + fmt(stats.netWorth,true) + ' with ' + savingsRate + '% savings rate. ' +
              'Portfolio ' + fmt(stats.currentValue,true) + ', loans outstanding ' + fmt(stats.totalDebt,true) + '.'
  };
}

// ── API KEY MANAGEMENT ────────────────────────────────────────────────────────
async function _adv2LoadKey() {
  const uid = _adv2Uid();
  if (_adv2ApiKey) return _adv2ApiKey;
  if (uid === 'guest') return null;

  try {
    if (typeof db !== 'undefined' && db) {
      const snap = await db.collection('users').doc(uid)
                           .collection('config').doc('advisor').get();
      if (snap.exists && snap.data().apiKey) {
        _adv2ApiKey = snap.data().apiKey;
        return _adv2ApiKey;
      }
    }
  } catch(e) {}

  const local = localStorage.getItem('fr_adv_key_' + uid);
  if (local) { _adv2ApiKey = local; return local; }
  return null;
}

async function _adv2PersistKey(key) {
  const uid = _adv2Uid();
  _adv2ApiKey = key;
  if (uid !== 'guest') {
    localStorage.setItem('fr_adv_key_' + uid, key);
    try {
      if (typeof db !== 'undefined' && db) {
        await db.collection('users').doc(uid)
                .collection('config').doc('advisor')
                .set({ apiKey: key }, { merge: true });
      }
    } catch(e) {}
  }
}

// ── PRO SUBSCRIPTION STATUS ────────────────────────────────────────────────────
function _adv2ProActive() {
  return !!(_adv2Pro && _adv2Pro.active);
}

async function _adv2LoadProStatus() {
  const uid = _adv2Uid();
  if (uid === 'guest' || typeof _db === 'undefined' || !_db) {
    _adv2Pro = { active: false, expiry: null };
    return _adv2Pro;
  }
  try {
    const snap = await _db.collection('users').doc(uid).get();
    const d = snap.exists ? snap.data() : {};
    const expiryMs = d && d.proExpiry && typeof d.proExpiry.toMillis === 'function'
      ? d.proExpiry.toMillis() : null;
    const active = !!(d && d.pro === true && expiryMs && expiryMs > Date.now());
    _adv2Pro = { active, expiry: expiryMs };
  } catch(e) {
    _adv2Pro = { active: false, expiry: null };
  }
  return _adv2Pro;
}

/* Live-watches the user doc after a payment redirect so Pro activates the
   moment the Razorpay webhook lands, without a manual refresh. */
function _adv2WatchProActivation() {
  const uid = _adv2Uid();
  if (uid === 'guest' || typeof _db === 'undefined' || !_db) return;
  if (_adv2ProWatchUnsub) return; // already watching

  _showToast('Payment received — activating Pro…');

  const deadline = Date.now() + 60000; // stop watching after 60s
  _adv2ProWatchUnsub = _db.collection('users').doc(uid).onSnapshot(async (snap) => {
    const d = snap.exists ? snap.data() : {};
    const expiryMs = d && d.proExpiry && typeof d.proExpiry.toMillis === 'function'
      ? d.proExpiry.toMillis() : null;
    const active = !!(d && d.pro === true && expiryMs && expiryMs > Date.now());
    if (active) {
      _adv2Pro = { active, expiry: expiryMs };
      _adv2ProWatchUnsub();
      _adv2ProWatchUnsub = null;
      _showToast('🎉 AI Advisor Pro activated!');
      if (_screen === 'advisor') navigate('advisor');
    } else if (Date.now() > deadline) {
      _adv2ProWatchUnsub();
      _adv2ProWatchUnsub = null;
    }
  });
}

/* Calls the createProPaymentLink Cloud Function and redirects to the
   Razorpay UPI-only checkout page. */
async function _adv2StartUpgrade() {
  if (typeof _functions === 'undefined' || !_functions) {
    _showToast('Payments are not configured yet.');
    return;
  }
  try {
    const call = _functions.httpsCallable('createProPaymentLink');
    const { data } = await call();
    if (data && data.url) {
      window.location.href = data.url;
    } else {
      _showToast('Could not start payment. Please try again.');
    }
  } catch(e) {
    _showToast((e && e.message) || 'Could not start payment.');
  }
}

function _adv2OpenProModal() {
  openModal(`
    <div class="modal-hd">
      <div class="modal-title">✨ AI Advisor Pro</div>
      <button class="modal-close" onclick="closeModal()">${ic('x',14)}</button>
    </div>
    <div class="modal-body" style="display:flex;flex-direction:column;gap:1rem">
      <p style="font-size:13px;color:var(--t2);line-height:1.7;margin:0">
        Go Pro and FinResolver funds your AI Advisor for you — no Anthropic API key needed.
        One-time payment, valid for 1 year.
      </p>
      <div style="font-family:var(--font-d);font-size:26px;font-weight:700;color:var(--t1)">
        ${ADV2_PRO_PRICE_LABEL}
      </div>
      <div style="font-size:12px;color:var(--t3)">Pay securely via UPI (GPay, PhonePe, Paytm, or any UPI app) through Razorpay.</div>
    </div>
    <div class="modal-ft">
      <button class="btn btn-ghost" onclick="closeModal()">Not now</button>
      <button class="btn btn-primary" onclick="_adv2StartUpgrade()">Pay with UPI</button>
    </div>
  `);
}

// ── CLAUDE API ────────────────────────────────────────────────────────────────
/* Pro users are server-funded via the advisorProxy Cloud Function — the
   client never sees or needs an Anthropic key. */
async function _adv2CallViaProxy(messages) {
  const call = _functions.httpsCallable('advisorProxy');
  try {
    const { data } = await call({ system: ADV2_SYSTEM, messages });
    return (data && data.text) || '';
  } catch(e) {
    if (e && e.code === 'functions/resource-exhausted') throw new Error('RATE_LIMIT');
    throw new Error((e && e.message) || 'API_ERROR');
  }
}

/* One-shot call — does not touch conversation history */
async function _adv2CallRaw(userContent) {
  if (_adv2ProActive()) {
    return _adv2CallViaProxy([{ role: 'user', content: userContent }]);
  }

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         _adv2ApiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: ADV2_MODEL, max_tokens: ADV2_MAX_TOK, system: ADV2_SYSTEM,
      messages: [{ role: 'user', content: userContent }]
    })
  });
  if (resp.status === 429) throw new Error('RATE_LIMIT');
  if (!resp.ok) {
    const e = await resp.json().catch(function(){ return {}; });
    throw new Error((e.error && e.error.message) || 'API_ERROR');
  }
  const data = await resp.json();
  return (data.content && data.content[0] && data.content[0].text) || '';
}

/* Conversational call — maintains rolling 6-message history */
async function _adv2CallChat(userContent) {
  _adv2History.push({ role: 'user', content: userContent });
  if (_adv2History.length > 6) _adv2History.shift();

  if (_adv2ProActive()) {
    try {
      const answer = await _adv2CallViaProxy(_adv2History);
      _adv2History.push({ role: 'assistant', content: answer });
      if (_adv2History.length > 6) _adv2History.shift();
      return answer;
    } catch(e) {
      _adv2History.pop();
      throw e;
    }
  }

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         _adv2ApiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: ADV2_MODEL, max_tokens: ADV2_MAX_TOK, system: ADV2_SYSTEM,
      messages: _adv2History
    })
  });

  if (resp.status === 429) { _adv2History.pop(); throw new Error('RATE_LIMIT'); }
  if (!resp.ok) {
    _adv2History.pop();
    const e = await resp.json().catch(function(){ return {}; });
    throw new Error((e.error && e.error.message) || 'API_ERROR');
  }

  const data   = await resp.json();
  const answer = (data.content && data.content[0] && data.content[0].text) || '';
  _adv2History.push({ role: 'assistant', content: answer });
  if (_adv2History.length > 6) _adv2History.shift();
  return answer;
}

// ── MARKDOWN ──────────────────────────────────────────────────────────────────
function _adv2Md(text) {
  const _esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const _inline = s => s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+?)\*/g, '<em>$1</em>');

  const lines = _esc(text).split('\n');
  const out = []; let inList = false, inTable = false;
  let tableRows = [];

  function flushTable() {
    if (!tableRows.length) { inTable = false; return; }
    const dataRows = tableRows.filter(r => r !== null);
    if (!dataRows.length) { inTable = false; return; }
    let html = '<div class="adv2-table-wrap"><table class="adv2-table"><thead><tr>';
    dataRows[0].forEach(c => { html += '<th>' + _inline(c.trim()) + '</th>'; });
    html += '</tr></thead><tbody>';
    dataRows.slice(1).forEach(row => {
      html += '<tr>';
      row.forEach(c => { html += '<td>' + _inline(c.trim()) + '</td>'; });
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    out.push(html);
    tableRows = []; inTable = false;
  }

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();

    // Table rows (but not heading lines)
    if (/^\|.+\|/.test(t) && !/^#/.test(t)) {
      if (inList) { out.push('</ul>'); inList = false; }
      inTable = true;
      if (/^\|[-:\s|]+\|$/.test(t)) {
        tableRows.push(null);
      } else {
        tableRows.push(t.split('|').slice(1, -1));
      }
      continue;
    }
    if (inTable) flushTable();

    // Headings (### before ## to avoid prefix collision)
    let hm;
    if ((hm = t.match(/^###\s+(.*)/))) {
      if (inList) { out.push('</ul>'); inList = false; }
      const hText = hm[1].replace(/\s*\|.*$/, '').trim();
      out.push('<div class="adv2-h3">' + _inline(hText) + '</div>');
      continue;
    }
    if ((hm = t.match(/^##?\s+(.*)/))) {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push('<div class="adv2-h2">' + _inline(hm[1]) + '</div>');
      continue;
    }

    const line = _inline(t);
    if (/^[-•]\s+/.test(line)) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push('<li>' + line.replace(/^[-•]\s+/, '') + '</li>');
    } else {
      if (inList) { out.push('</ul>'); inList = false; }
      if (!line) {
        if (out.length && out[out.length - 1] !== '<br>') out.push('<br>');
      } else if (/^💬\s*Ask me:/.test(line)) {
        out.push('<div class="adv2-followup">' + line + '</div>');
      } else { out.push(line); }
    }
  }

  if (inList) out.push('</ul>');
  if (inTable) flushTable();
  return out.join('\n');
}

function _adv2Tone(text) {
  const lower = text.toLowerCase();
  const warns = ['red flag','risk','warning','danger','high debt','negative savings','oversp','too much'];
  const goods = ['great','excellent','well done','positive trend','healthy savings','on track'];
  if (warns.some(function(w){ return lower.includes(w); })) return 'warn';
  if (goods.some(function(w){ return lower.includes(w); })) return 'good';
  return 'neutral';
}

// ── PROACTIVE INSIGHTS ────────────────────────────────────────────────────────
async function _adv2LoadInsights() {
  const el = document.getElementById('adv2-insights-body');
  if (!el) return;

  if (_adv2Insights) { el.innerHTML = _adv2Insights; return; }

  if (!_adv2ApiKey && !_adv2ProActive()) {
    _adv2Insights =
      '<div class="adv2-ic adv2-ic-neutral">' +
      '<span class="adv2-ic-icon">📊</span>' +
      '<div class="adv2-ic-text" style="color:var(--t3)">Enter your Anthropic API key via Settings, or ' +
      '<a href="#" onclick="_adv2OpenProModal();return false" style="color:var(--purple)">go Pro</a> to see personalized insights.</div>' +
      '</div>';
    el.innerHTML = _adv2Insights;
    return;
  }

  el.innerHTML = '<div class="adv2-loading"><div class="adv2-pulse"></div> Analyzing your finances…</div>';

  const snap   = _adv2Snap || _adv2BuildSnapshot();
  const prompt =
    'User\'s current financial data:\n' + JSON.stringify(snap, null, 2) + '\n\n' +
    'Analyze this data and give exactly 3 key financial insights. ' +
    'Format: each on its own line, starting with one of: "⚠️ Risk:", "💡 Opportunity:", or "📊 Insight:". ' +
    'Use each label at most once. Be specific — cite actual numbers from the data. ' +
    'Keep each item under 45 words. No follow-up question here.';

  try {
    const answer = await _adv2CallRaw(prompt);
    const lines  = answer.split('\n')
      .map(function(l){ return l.trim(); })
      .filter(function(l){ return /^(⚠️|💡|📊)/.test(l); })
      .slice(0, 3);

    if (!lines.length) {
      _adv2Insights =
        '<div class="adv2-ic adv2-ic-neutral"><span class="adv2-ic-icon">📊</span>' +
        '<div class="adv2-ic-text">' + _adv2Md(answer) + '</div></div>';
    } else {
      _adv2Insights = lines.map(function(line) {
        const isRisk = line.includes('⚠️');
        const isOpp  = line.includes('💡');
        const icon   = isRisk ? '⚠️' : isOpp ? '💡' : '📊';
        const cls    = isRisk ? 'adv2-ic-risk' : isOpp ? 'adv2-ic-opp' : 'adv2-ic-info';
        const text   = line.replace(/^(⚠️|💡|📊)\s*(Risk:|Opportunity:|Insight:)?\s*/i, '').trim();
        return '<div class="adv2-ic ' + cls + '">' +
               '<span class="adv2-ic-icon">' + icon + '</span>' +
               '<div class="adv2-ic-text">' + _adv2Md(text) + '</div>' +
               '</div>';
      }).join('');
    }
    el.innerHTML = _adv2Insights;

  } catch(e) {
    const msg = e.message === 'RATE_LIMIT'
      ? 'Rate limited — please wait a moment.'
      : _adv2ProActive()
        ? 'Could not load insights. Please try again shortly.'
        : 'Could not load insights. Check your API key in Settings.';
    el.innerHTML =
      '<div class="adv2-ic adv2-ic-neutral"><span class="adv2-ic-icon">⚠️</span>' +
      '<div class="adv2-ic-text" style="color:var(--t3)">' + msg + '</div></div>';
  }
}

// ── CHAT ──────────────────────────────────────────────────────────────────────
async function adv2Send(text) {
  if (_adv2Loading) return;
  const inp = document.getElementById('adv2-input');
  const msg = (text || (inp && inp.value) || '').trim();
  if (!msg) return;
  if (!_adv2ApiKey && !_adv2ProActive()) { _adv2OpenKeyModal(); return; }

  if (inp) { inp.value = ''; inp.style.height = 'auto'; }
  _adv2Loading = true;

  const errEl = document.getElementById('adv2-error');
  if (errEl) errEl.style.display = 'none';

  _adv2Messages.push({ role: 'user', text: msg });
  _adv2AppendBubble('user', msg);
  _adv2SetTyping(true);

  const snap    = _adv2Snap || _adv2BuildSnapshot();
  const fullMsg = 'User\'s current financial data:\n' + JSON.stringify(snap, null, 2) +
                  '\n\nUser question: ' + msg;

  try {
    const reply = await _adv2CallChat(fullMsg);
    _adv2SetTyping(false);
    _adv2Messages.push({ role: 'assistant', text: reply });
    _adv2AppendBubble('assistant', reply);
  } catch(e) {
    _adv2SetTyping(false);
    const em = e.message === 'RATE_LIMIT'
      ? 'Please wait a moment before asking again.'
      : _adv2ProActive()
        ? "Couldn't reach the advisor. Please try again shortly."
        : "Couldn't reach the advisor. Check your API key in ⚙ Settings.";
    _adv2ShowErr(em);
  } finally {
    _adv2Loading = false;
  }
}

function adv2SendInput() {
  const inp = document.getElementById('adv2-input');
  if (inp && inp.value.trim()) adv2Send(inp.value.trim());
}

function _adv2AppendBubble(role, text) {
  const chat = document.getElementById('adv2-chat');
  if (!chat) return;
  const div = document.createElement('div');
  div.className = 'adv2-msg adv2-msg-' + role;
  if (role === 'assistant') {
    div.setAttribute('data-tone', _adv2Tone(text));
    div.innerHTML = _adv2Md(text);
  } else {
    div.textContent = text;
  }
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

function _adv2SetTyping(show) {
  const el = document.getElementById('adv2-typing');
  if (el) el.style.display = show ? 'flex' : 'none';
  if (show) {
    const c = document.getElementById('adv2-chat');
    if (c) c.scrollTop = c.scrollHeight;
  }
}

function _adv2ShowErr(msg) {
  const el = document.getElementById('adv2-error');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(function(){ el.style.display = 'none'; }, 8000);
}

// ── API KEY MODAL ─────────────────────────────────────────────────────────────
function _adv2OpenKeyModal() {
  openModal(`
    <div class="modal-hd">
      <div class="modal-title">${ic('settings',16)} Anthropic API Key</div>
      <button class="modal-close" onclick="closeModal()">${ic('x',14)}</button>
    </div>
    <div class="modal-body" style="display:flex;flex-direction:column;gap:1rem">
      <p style="font-size:13px;color:var(--t2);line-height:1.7;margin:0">
        The AI Advisor uses Claude by Anthropic. Your key is stored securely in your account and never shared.<br><br>
        Get a key at <a href="https://console.anthropic.com" target="_blank" rel="noopener" style="color:var(--purple)">console.anthropic.com</a>
        → API Keys → Create Key.
      </p>
      <div>
        <label style="display:block;font-size:11px;font-weight:600;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">API Key</label>
        <input id="adv2-key-inp" class="inp" type="password" placeholder="sk-ant-api03-…"
          value="${_adv2ApiKey || ''}"
          onkeydown="if(event.key==='Enter')_adv2ConfirmKey()"
          style="width:100%;font-family:var(--font-m);font-size:13px" />
        <div id="adv2-key-err" style="font-size:12px;color:var(--red);margin-top:5px;display:none"></div>
      </div>
    </div>
    <div class="modal-ft">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="_adv2ConfirmKey()">Save Key</button>
    </div>
  `);
  setTimeout(function() {
    const inp = document.getElementById('adv2-key-inp');
    if (inp) inp.focus();
  }, 50);
}

async function _adv2ConfirmKey() {
  const inp = document.getElementById('adv2-key-inp');
  const key = (inp && inp.value || '').trim();
  if (!key.startsWith('sk-ant-')) {
    const errEl = document.getElementById('adv2-key-err');
    if (errEl) { errEl.textContent = 'Key must start with sk-ant-'; errEl.style.display = 'block'; }
    return;
  }
  await _adv2PersistKey(key);
  closeModal();
  _adv2Insights = null; // force insights to reload with new key
  navigate('advisor');  // re-render the screen
}

// ── SCREEN RENDER ENTRY POINT ─────────────────────────────────────────────────
async function renderAdvisor(el) {
  await _adv2LoadProStatus();

  if (location.search.includes('pro=pending')) {
    history.replaceState(null, '', location.pathname + location.hash);
    if (!_adv2ProActive()) _adv2WatchProActivation();
  }

  const hasData = APP.investments.length > 0
    || APP.loans.length > 0
    || APP.monthly.expenses.length > 0
    || APP.monthly.income.length > 0
    || (APP.history || []).some(function(h){ return (h.expenses||[]).length > 0; });

  if (!hasData) {
    el.innerHTML = `
      <div class="sh">
        <div class="sh-l">
          <div class="sh-title">AI Financial Advisor</div>
          <div class="sh-sub">Powered by Claude AI</div>
        </div>
      </div>
      <div class="adv2-empty">
        <div class="adv2-empty-icon">🤖</div>
        <div class="adv2-empty-title">No financial data yet</div>
        <div class="adv2-empty-desc">Add some expenses, loans, or investments first to get personalized AI-powered advice based on your actual numbers.</div>
        <div class="adv2-empty-btns">
          <button class="btn btn-ghost btn-sm" onclick="navigate('monthly')">📊 Add Expenses</button>
          <button class="btn btn-ghost btn-sm" onclick="navigate('investments')">📈 Add Investments</button>
          <button class="btn btn-ghost btn-sm" onclick="navigate('loans')">💳 Add Loans</button>
        </div>
      </div>`;
    return;
  }

  _adv2Snap = _adv2BuildSnapshot();
  const stats = getPortfolioStats();
  const snap  = _adv2Snap;

  const srColor = snap.monthly.savingsRate >= 20 ? 'var(--accent)'
                : snap.monthly.savingsRate >= 10 ? 'var(--gold)' : 'var(--red)';
  const nwColor = stats.netWorth >= 0 ? 'var(--purple)' : 'var(--red)';
  const srLabel = snap.monthly.savingsRate >= 20 ? 'healthy'
                : snap.monthly.savingsRate >= 10 ? 'moderate' : 'low';

  el.innerHTML = `
    <div class="sh">
      <div class="sh-l">
        <div class="sh-title">AI Financial Advisor</div>
        <div class="sh-sub">Personalized insights powered by Claude AI</div>
      </div>
      <div class="sh-r">
        ${_adv2ProActive()
          ? '<span class="adv2-pro-badge">✨ Pro</span>'
          : '<button class="btn btn-primary btn-sm" onclick="_adv2OpenProModal()">✨ Go Pro</button>'}
        <button class="btn btn-ghost btn-sm" onclick="_adv2OpenKeyModal()">${ic('settings',12)} API Key</button>
      </div>
    </div>

    <div class="strip">
      ${statCard('Net Worth',    fmt(stats.netWorth,true),    '', '<span style="color:' + nwColor + '">' + (stats.netWorth>=0?'positive':'negative') + '</span>')}
      ${statCard('Savings Rate', snap.monthly.savingsRate+'%','', '<span style="color:' + srColor + '">' + srLabel + '</span>')}
      ${statCard('Portfolio',    fmt(stats.currentValue,true),'', 'current value')}
      ${statCard('Loans',        fmt(stats.totalDebt,true),  'neg','outstanding')}
    </div>

    <div class="card" style="margin-bottom:1.25rem;padding:18px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.85rem">
        <div style="font-size:11px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.6px">Key Insights</div>
        <button class="btn-icon" title="Refresh insights"
          onclick="_adv2Insights=null;_adv2LoadInsights()">${ic('refresh',12)}</button>
      </div>
      <div id="adv2-insights-body" class="adv2-insights-grid">
        <div class="adv2-loading"><div class="adv2-pulse"></div> Analyzing your finances…</div>
      </div>
    </div>

    <div class="card adv2-chat-card">

      <div class="adv2-chips">
        <button class="adv2-chip" onclick="adv2Send('Am I saving enough?')">Am I saving enough?</button>
        <button class="adv2-chip" onclick="adv2Send('Which loan should I pay off first?')">Which loan to pay first?</button>
        <button class="adv2-chip" onclick="adv2Send('How is my portfolio performing?')">How is my portfolio doing?</button>
        <button class="adv2-chip" onclick="adv2Send('Where am I overspending?')">Where am I overspending?</button>
      </div>

      <div class="adv2-chat" id="adv2-chat">
        <div class="adv2-welcome">
          <div class="adv2-welcome-avatar">🤖</div>
          <div class="adv2-welcome-bubble">Hi! I'm your AI financial advisor powered by Claude. I have access to your real financial data and I'm ready to give personalized, actionable advice. Ask me anything!</div>
        </div>
      </div>

      <div class="adv2-typing" id="adv2-typing" style="display:none">
        <div class="adv2-dots"><span></span><span></span><span></span></div>
        <span style="font-size:12px;color:var(--t3)">Advisor is thinking…</span>
      </div>

      <div id="adv2-error" class="adv2-err-banner" style="display:none"></div>

      <div class="adv2-input-bar">
        <textarea id="adv2-input" class="adv2-textarea"
          placeholder="Ask about your finances… (Enter to send, Shift+Enter for newline)"
          rows="1"
          onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();adv2SendInput();}"
          oninput="this.style.height='auto';this.style.height=Math.min(this.scrollHeight,100)+'px'"
        ></textarea>
        <button class="btn btn-primary btn-sm adv2-send" onclick="adv2SendInput()">Send</button>
      </div>

    </div>`;

  // Restore previous session chat
  if (_adv2Messages.length > 0) {
    const chatEl = document.getElementById('adv2-chat');
    if (chatEl) {
      _adv2Messages.forEach(function(m) {
        const div = document.createElement('div');
        div.className = 'adv2-msg adv2-msg-' + m.role;
        if (m.role === 'assistant') {
          div.setAttribute('data-tone', _adv2Tone(m.text));
          div.innerHTML = _adv2Md(m.text);
        } else {
          div.textContent = m.text;
        }
        chatEl.appendChild(div);
      });
      chatEl.scrollTop = chatEl.scrollHeight;
    }
  }

  // Load API key then insights
  await _adv2LoadKey();
  _adv2LoadInsights(); // async, don't block render

  if (!_adv2ApiKey && !_adv2ProActive()) {
    setTimeout(_adv2OpenKeyModal, 350);
  }
}
