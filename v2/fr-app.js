// ── APP SHELL & ROUTING ───────────────────────────────────────────────────────
let _screen = 'dashboard';
let _sidebarCollapsed = false;
let _chartInstances = {};

// Feature flag — AI Advisor is still being built. Flip to true when ready.
const ADVISOR_ENABLED = false;

const NAV = [
  { screen:'dashboard',   icon:'home',      label:'Dashboard',       section:'OVERVIEW'  },
  { screen:'monthly',     icon:'calendar',  label:'Monthly Tracker', section:'TRACKER'   },
  { screen:'investments', icon:'trending',  label:'Investments',     section:null        },
  { screen:'loans',       icon:'card',      label:'Loan Tracker',    section:null        },
  { screen:'lifestyle',   icon:'lifestyle', label:'Lifestyle Tracker',section:null        },
  { screen:'portfolio',   icon:'target',    label:'Portfolio & FIRE',section:'PLANNER'   },
  { screen:'goals',       icon:'flag',      label:'Goals',           section:null        },
  { screen:'dayplanner',  icon:'clock',     label:'Day Planner',     section:null        },
  { screen:'advisor',     icon:'bot',       label:'AI Advisor',      section:'ADVISOR'   },
];

// Bottom-nav (mobile) shows one tab per sidebar section; sections with
// multiple screens open a picker sheet instead of navigating directly.
const BNAV_LABELS = { OVERVIEW:'Home', TRACKER:'Tracker', PLANNER:'Planner', ADVISOR:'Advisor' };

function _navGroups() {
  const groups = [];
  NAV.forEach(item => {
    if (item.section) groups.push({ section: item.section, items: [] });
    groups[groups.length - 1].items.push(item);
  });
  return groups;
}

function _navGroupFor(screen) {
  const s = screen === 'loan-detail' ? 'loans' : screen === 'goal-detail' ? 'goals' : screen;
  const g = _navGroups().find(g => g.items.some(i => i.screen === s));
  return g ? g.section : null;
}

function navigate(screen, opts = {}) {
  if (screen === 'advisor' && !ADVISOR_ENABLED) {
    if (typeof _showToast === 'function') _showToast("AI Advisor is coming soon — we're still building it!");
    return;
  }
  if (typeof _syncOnNavigate === 'function') _syncOnNavigate(screen, _screen);
  if (opts.loanId)  APP.activeLoanId  = opts.loanId;
  if (opts.goalId)  APP.activeGoalId  = opts.goalId;
  _screen = screen;
  if (typeof closeBnavSheet === 'function') closeBnavSheet();

  // update sidebar nav highlights
  document.querySelectorAll('.nav-item').forEach(el => {
    const s = el.dataset.screen;
    el.classList.toggle('active',
      s === screen ||
      (screen === 'loan-detail'  && s === 'loans') ||
      (screen === 'goal-detail'  && s === 'goals'));
  });

  // update bottom nav highlights
  const activeBnavGroup = _navGroupFor(screen);
  document.querySelectorAll('.bnav-item[data-group]').forEach(el => {
    el.classList.toggle('active', el.dataset.group === activeBnavGroup);
  });

  // breadcrumb
  const titles = {
    dashboard:'Dashboard', monthly:'Monthly Tracker',
    investments:'Investments', loans:'Loan Tracker',
    'loan-detail':'Loan Detail', portfolio:'Portfolio & FIRE',
    goals:'My Financial Goals', 'goal-detail':'Goal Detail',
    lifestyle:'Lifestyle Tracker', advisor:'AI Advisor', dayplanner:'Day Planner'
  };
  const subs = {
    monthly:   monthName(APP.monthly.month) + ' ' + APP.monthly.year,
    dashboard: monthName(APP.monthly.month) + ' ' + APP.monthly.year,
  };
  document.getElementById('bc-title').textContent = titles[screen] || screen;
  document.getElementById('bc-sub').textContent   = subs[screen]  || '';

  // destroy old chart instances
  Object.values(_chartInstances).forEach(c => { try { c.destroy(); } catch(e){} });
  _chartInstances = {};

  renderScreen(screen, document.getElementById('screen-content'));
  // scroll to top
  const sc = document.getElementById('screen-content');
  if (sc) sc.scrollTop = 0;
}

function toggleSidebar() {
  _sidebarCollapsed = !_sidebarCollapsed;
  document.getElementById('sidebar').classList.toggle('collapsed', _sidebarCollapsed);
}

function toggleTheme() {
  APP.theme = APP.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('fr_theme', APP.theme);
  document.body.classList.toggle('light', APP.theme === 'light');
  const isDark = APP.theme === 'dark';
  // moon SVG = dark mode icon, sun SVG = light mode icon
  const moonSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
  const sunSvg  = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;
  const newIcon = isDark ? moonSvg : sunSvg;
  // topbar icon
  const topIcon = document.getElementById('theme-icon-topbar');
  if (topIcon) topIcon.outerHTML = newIcon.replace('id="', 'id="theme-icon-topbar" ');
  // sidebar theme icon
  const sbIcon = document.getElementById('theme-icon');
  if (sbIcon) sbIcon.innerHTML = isDark ? moonSvg : sunSvg;
  // bottom nav icon
  const bnIcon = document.getElementById('bnav-theme-icon');
  if (bnIcon) bnIcon.outerHTML = newIcon.replace('id="', 'id="bnav-theme-icon" ');
}

// ── AUTH ──────────────────────────────────────────────────────────────────────
// NOTE: fr-sync.js overrides this stub with the real GIS flow. The walkthrough
// trigger lives in showApp() so every login path (incl. the override) hits it.
function loginGoogle() {
  showApp();
}

function loginGuest() {
  APP.user = { name:'Guest User', email:'guest@finresolver.app', initials:'G' };
  showApp();
}

function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  const layout = document.getElementById('app-layout');
  layout.style.display = 'flex';
  layout.style.width   = '100%';

  document.getElementById('sb-user-name').textContent    = APP.user.name;
  document.getElementById('sb-user-email').textContent   = APP.user.email;
  document.getElementById('sb-user-initials').textContent = APP.user.initials;

  navigate('dashboard');

  // First-time walkthrough — runs once per browser regardless of which login
  // path got us here (Google sign-in, session restore or guest). The real
  // loginGoogle() lives in fr-sync.js and overrides the stub below, so the
  // trigger has to sit here, the single chokepoint every path passes through.
  if (!localStorage.getItem('fr_wt_seen')) showWalkthrough();
}

// ── WALKTHROUGH ───────────────────────────────────────────────────────────────
const WT_STEPS = [
  { icon:'wallet',   title:'Welcome to FinResolver',         desc:'Your all-in-one personal finance dashboard. Track spending, investments, loans and your path to financial independence — all in one place.' },
  { icon:'calendar', title:'Monthly Tracker',                desc:'Log income, expenses, investments and EMIs each month. Get a live balance, checklist reminders and 3-month trend charts.' },
  { icon:'trending', title:'Investment Portfolio',           desc:'Track stocks, mutual funds, gold, real estate and more with live prices. Import from Zerodha, Groww, Upstox and 5 other brokers.' },
  { icon:'card',     title:'Loan Tracker',                   desc:'Monitor all your loans in one place. View full amortization schedules, payment history and outstanding balance curves.' },
  { icon:'target',   title:'Portfolio & FIRE Number',        desc:'See your net worth, asset allocation and your FIRE number — the corpus you need to retire early based on your spending.' },
  { icon:'flag',     title:'Goals',                          desc:'Set savings and investment goals, track progress towards each one and see exactly when you\'ll get there at your current pace.' },
  { icon:'lifestyle',title:'Lifestyle Tracker',              desc:'Catalogue your household goods, keep tabs on warranties and never miss an important date or renewal again.' },
  { icon:'bot',      title:'AI Advisor',                     desc:'Chat with a personal finance assistant powered by Claude that reads your real data to give personalised, actionable advice.' },
];
let _wtStep = 0;

function showWalkthrough() {
  _wtStep = 0;
  document.getElementById('walkthrough').style.display = 'flex';
  renderWtStep();
}

function renderWtStep() {
  const s = WT_STEPS[_wtStep];
  document.getElementById('wt-icon').innerHTML  = ic(s.icon, 30);
  document.getElementById('wt-title').textContent = s.title;
  document.getElementById('wt-desc').textContent  = s.desc;
  document.getElementById('wt-step').textContent  = `${_wtStep + 1} of ${WT_STEPS.length}`;
  // dots
  const dots = document.getElementById('wt-dots');
  dots.innerHTML = WT_STEPS.map((_, i) =>
    `<div class="wt-dot${i === _wtStep ? ' active' : ''}"></div>`).join('');
  // buttons
  document.getElementById('wt-prev').style.display = _wtStep === 0 ? 'none' : '';
  document.getElementById('wt-next').textContent =
    _wtStep === WT_STEPS.length - 1 ? "Let's go!" : 'Next';
}

function wtNext() {
  if (_wtStep < WT_STEPS.length - 1) { _wtStep++; renderWtStep(); }
  else { closeWalkthrough(); }
}

function wtPrev() {
  if (_wtStep > 0) { _wtStep--; renderWtStep(); }
}

function closeWalkthrough() {
  document.getElementById('walkthrough').style.display = 'none';
  localStorage.setItem('fr_wt_seen', '1');
}

// ── SIDEBAR NAV ───────────────────────────────────────────────────────────────
function buildSidebarNav() {
  const nav = document.getElementById('sb-nav');
  let html = '';
  NAV.forEach(item => {
    if (item.section) {
      html += `<div class="nav-section">${item.section}</div>`;
    }
    const isDisabled = item.screen === 'advisor' && !ADVISOR_ENABLED;
    html += `
      <div class="nav-item${isDisabled ? ' disabled' : ''}" data-screen="${item.screen}" onclick="${isDisabled ? '' : `navigate('${item.screen}')`}">
        <div class="ni">${ic(item.icon, 16)}</div>
        <span class="nav-label">${item.label}</span>
        ${isDisabled ? '<span class="nav-upcoming">Upcoming</span>' : ''}
      </div>`;
  });
  nav.innerHTML = html;
}

// ── BOTTOM NAV (mobile) ────────────────────────────────────────────────────────
let _bnavOpenGroup = null;

function buildBottomNav() {
  const nav = document.getElementById('bottom-nav');
  nav.innerHTML = _navGroups().map(g => {
    const first = g.items[0];
    const isMulti = g.items.length > 1;
    const isDisabled = g.section === 'ADVISOR' && !ADVISOR_ENABLED;
    const action = isDisabled ? ''
      : isMulti ? `onclick="toggleBnavSheet('${g.section}')"`
      : `onclick="navigate('${first.screen}')"`;
    return `
      <div class="bnav-item${isDisabled ? ' disabled' : ''}${g.section === 'OVERVIEW' ? ' active' : ''}" data-group="${g.section}" ${action}>
        ${ic(first.icon, 20)}
        <span>${BNAV_LABELS[g.section] || g.section}</span>
      </div>`;
  }).join('');
}

function toggleBnavSheet(section) {
  if (_bnavOpenGroup === section) closeBnavSheet();
  else openBnavSheet(section);
}

function openBnavSheet(section) {
  const group = _navGroups().find(g => g.section === section);
  if (!group) return;
  _bnavOpenGroup = section;
  document.getElementById('bnav-sheet-title').textContent = BNAV_LABELS[section] || section;
  document.getElementById('bnav-sheet-items').innerHTML = group.items.map(item => `
    <div class="bnav-sheet-item${item.screen === _screen ? ' active' : ''}" onclick="navigate('${item.screen}'); closeBnavSheet();">
      ${ic(item.icon, 18)}
      <span>${item.label}</span>
    </div>`).join('');
  document.getElementById('bnav-sheet').classList.add('open');
  document.getElementById('bnav-sheet-overlay').classList.add('open');
  document.querySelectorAll('.bnav-item[data-group]').forEach(el =>
    el.classList.toggle('sheet-open', el.dataset.group === section));
}

function closeBnavSheet() {
  _bnavOpenGroup = null;
  document.getElementById('bnav-sheet').classList.remove('open');
  document.getElementById('bnav-sheet-overlay').classList.remove('open');
  document.querySelectorAll('.bnav-item.sheet-open').forEach(el => el.classList.remove('sheet-open'));
}

// ── MODAL HELPERS ─────────────────────────────────────────────────────────────
function openModal(html, size = '') {
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-bg" onclick="if(event.target===this)closeModal()">
      <div class="modal ${size}">${html}</div>
    </div>`;
}

function closeModal() {
  document.getElementById('modal-root').innerHTML = '';
}

// ── CHART HELPERS ─────────────────────────────────────────────────────────────
function makeChart(id, config) {
  const ctx = document.getElementById(id);
  if (!ctx) return;
  if (_chartInstances[id]) { try { _chartInstances[id].destroy(); } catch(e){} }
  const darkGrid = { color: 'rgba(100,140,230,.06)' };
  const tickStyle = { color:'#8a9ab5', font:{ size:10.5, family:'Inter' } };
  // merge defaults
  if (config.type === 'bar' || config.type === 'line') {
    config.options = config.options || {};
    config.options.responsive = true;
    config.options.maintainAspectRatio = false;
    config.options.plugins = config.options.plugins || {};
    config.options.plugins.legend = config.options.plugins.legend || { labels: { color:'#8a9ab5', font:{ size:11, family:'Inter' }, boxWidth:10, padding:14 } };
    config.options.scales = config.options.scales || {};
    config.options.scales.x = { ...(config.options.scales.x||{}), ticks: tickStyle, grid: darkGrid };
    config.options.scales.y = { ...(config.options.scales.y||{}), ticks: { ...tickStyle, ...(config.options.scales.y?.ticks||{}) }, grid: darkGrid };
  }
  if (config.type === 'doughnut' || config.type === 'pie') {
    config.options = config.options || {};
    config.options.responsive = true;
    config.options.maintainAspectRatio = false;
    config.options.plugins = config.options.plugins || {};
    config.options.cutout = config.options.cutout || '66%';
    config.options.plugins.legend = config.options.plugins.legend || { display: false };
  }
  _chartInstances[id] = new Chart(ctx, config);
}

// ── MONTHLY TRACKER INTERACTIONS ──────────────────────────────────────────────
function toggleSection(id) {
  const body = document.getElementById('sec-' + id);
  const chev = document.getElementById('chev-' + id);
  if (!body) return;
  if (body.style.display === 'none') {
    body.style.display = '';
    if (chev) chev.classList.add('open');
  } else {
    body.style.display = 'none';
    if (chev) chev.classList.remove('open');
  }
}

function toggleCheck(id) {
  const item = APP.monthly.checklist.find(c => c.id === id);
  if (item) {
    item.done = !item.done;
    navigate('monthly');
  }
}

function deleteEntry(type, id) {
  if (type === 'loans') {
    const entry = APP.monthly.loans.find(e => e.id === id);
    if (entry?.loanId && entry?.paymentId) autoRemoveLoanPayment(entry.loanId, entry.paymentId);
  }
  APP.monthly[type] = APP.monthly[type].filter(e => e.id !== id);
  navigate(_screen);
}

function deleteLoan(id) {
  APP.loans = APP.loans.filter(l => l.id !== id);
  if (typeof saveLoansConfig === 'function') saveLoansConfig();
  navigate(_screen === 'loan-detail' ? 'loans' : _screen);
}

function deleteInvestment(id) {
  const inv = APP.investments.find(i => String(i.id) === String(id));
  if (!inv || !confirm(`Delete "${inv.name}"?`)) return;
  APP.investments = APP.investments.filter(i => String(i.id) !== String(id));
  if (typeof saveInvestmentsConfig === 'function') saveInvestmentsConfig();
  // Remove any goal allocations that referenced this investment
  if (APP.goalAllocations && APP.goalAllocations.length) {
    APP.goalAllocations = APP.goalAllocations.filter(a => String(a.investmentId) !== String(id));
    if (typeof saveGoalsConfig === 'function') saveGoalsConfig();
  }
  navigate(_screen);
}

// ── INVESTMENT EXPORT ─────────────────────────────────────────────────────────
function invExport() {
  if (!APP.investments.length) { _showToast('No holdings to export.'); return; }
  const headers = ['Name','Ticker','ISIN','Category','Qty','Avg Price (₹)','Cost Basis (₹)','Current Value (₹)','P&L (₹)','Return %','Source','Date','Notes'];
  const rows = APP.investments.map(i => {
    const cat  = _invCat(i);
    const qty  = _invTotalQty(i);
    const avg  = cat === 'Gold' ? _invGoldBuyPrice(i) : _invAvgPrice(i);
    const cost = invCost(i);
    const val  = invValue(i);
    const pnl  = val - cost;
    const pct  = cost ? (pnl / cost * 100) : 0;
    return [i.name, i.ticker||'', i.isin||'', cat, qty, avg.toFixed(2),
      Math.round(cost), Math.round(val), Math.round(pnl), pct.toFixed(2),
      i.source||'manual', i.date||'', i.notes||''];
  });
  const csv = [headers, ...rows].map(row =>
    row.map(cell => {
      const s = cell == null ? '' : String(cell);
      return (s.includes(',') || s.includes('"') || s.includes('\n'))
        ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')
  ).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = 'investments_' + new Date().toISOString().slice(0,10) + '.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  _showToast(`Exported ${APP.investments.length} holdings to CSV.`);
}

// ── INVESTMENT CLEAR ──────────────────────────────────────────────────────────
let _invClearCat = 'ALL';

function openInvClear() {
  _invClearCat = 'ALL';
  openModal(_invClearModalHtml());
}

function _invClearModalHtml() {
  const cats    = ['ALL', ...new Set(APP.investments.map(_invCat))];
  const targets = _invClearCat === 'ALL' ? APP.investments : APP.investments.filter(i => _invCat(i) === _invClearCat);
  const cost    = targets.reduce((s, i) => s + invCost(i), 0);
  return `
    <div class="modal-hd">
      <div class="modal-title" style="color:var(--red)">${ic('trash',14)} Clear Holdings</div>
      <button class="modal-close" onclick="closeModal()">${ic('x',13)}</button>
    </div>
    <div class="modal-body">
      <div class="inp-grp">
        <div class="inp-label">Category</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">
          ${cats.map(c=>`<button class="ftab${_invClearCat===c?' active':''}" onclick="_setInvClearCat('${c}')">${c}</button>`).join('')}
        </div>
      </div>
      <div style="margin-top:14px;padding:12px 14px;background:var(--s2);border:1px solid var(--b2);border-radius:var(--rs);font-size:12.5px;line-height:1.7">
        ${targets.length
          ? `⚠️ Permanently delete <strong style="color:var(--red)">${targets.length} holding${targets.length!==1?'s':''}</strong>${_invClearCat!=='ALL'?' in <strong>'+_invClearCat+'</strong>':' across all categories'}.<br>Total cost basis: <strong>₹${Math.round(cost).toLocaleString('en-IN')}</strong><br><span style="font-size:11px;color:var(--t3)">This cannot be undone.</span>`
          : `<span style="color:var(--t3)">No holdings in this category.</span>`}
      </div>
    </div>
    <div class="modal-ft">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn" style="background:var(--red);color:#fff;font-weight:600" ${!targets.length?'disabled':''} onclick="confirmInvClear()">Clear ${_invClearCat==='ALL'?'All':_invClearCat}</button>
    </div>`;
}

function _setInvClearCat(cat) {
  _invClearCat = cat;
  const modal = document.querySelector('#modal-root .modal');
  if (modal) modal.innerHTML = _invClearModalHtml();
}

function confirmInvClear() {
  const before = APP.investments.length;
  APP.investments = _invClearCat === 'ALL' ? [] : APP.investments.filter(i => _invCat(i) !== _invClearCat);
  const deleted = before - APP.investments.length;
  if (typeof saveInvestmentsConfig === 'function') saveInvestmentsConfig();
  closeModal();
  navigate('investments');
  _showToast(`Deleted ${deleted} holding${deleted!==1?'s':''}.`);
}

// ── Loan-tracker payment sync ─────────────────────────────────────────────────
function autoLogLoanPayment(entry) {
  if (!entry.loanId) return;
  const loan = APP.loans.find(l => l.id === entry.loanId);
  if (!loan) return;
  if (!loan.payments) loan.payments = [];
  const payId = 'pay_' + Date.now();
  const date  = entry.date || new Date().toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
  loan.payments.unshift({ id: payId, date, amount: entry.amount, note: entry.desc });
  entry.paymentId = payId;
  if (typeof saveLoansConfig === 'function') saveLoansConfig();
}

function autoRemoveLoanPayment(loanId, paymentId) {
  if (!loanId || !paymentId) return;
  const loan = APP.loans.find(l => l.id === loanId);
  if (!loan || !loan.payments) return;
  loan.payments = loan.payments.filter(p => p.id !== paymentId);
  if (typeof saveLoansConfig === 'function') saveLoansConfig();
}

function autoUpdateLoanPayment(entry) {
  if (!entry.loanId || !entry.paymentId) return;
  const loan = APP.loans.find(l => l.id === entry.loanId);
  if (!loan || !loan.payments) return;
  const payment = loan.payments.find(p => p.id === entry.paymentId);
  if (!payment) return;
  payment.amount = entry.amount;
  payment.note   = entry.desc;
  if (entry.date) payment.date = entry.date;
  if (typeof saveLoansConfig === 'function') saveLoansConfig();
}

function clearMonth() {
  openModal(`
    <div class="modal-hd">
      <div class="modal-title" style="color:var(--red)">${ic('trash',14)} Clear Month</div>
      <button class="modal-close" onclick="closeModal()">${ic('x',13)}</button>
    </div>
    <div class="modal-body">
      <p style="font-size:13.5px;color:var(--t2);line-height:1.6">This will clear all <strong>expenses, income, investments and loan payments</strong> for ${monthName(APP.monthly.month)} ${APP.monthly.year}.</p>
      <p style="font-size:12px;color:var(--t3);margin-top:8px">Checklist and notes are kept. This cannot be undone.</p>
    </div>
    <div class="modal-ft">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn" style="background:var(--red);color:#fff;font-weight:600" onclick="confirmClearMonth()">Clear Month</button>
    </div>
  `);
}

function confirmClearMonth() {
  APP.monthly.loans.forEach(entry => {
    if (entry.loanId && entry.paymentId) autoRemoveLoanPayment(entry.loanId, entry.paymentId);
  });
  APP.monthly.expenses    = [];
  APP.monthly.income      = [];
  APP.monthly.investments = [];
  APP.monthly.loans       = [];
  closeModal();
  navigate('monthly');
}

function setInvFilter(cat) {
  APP.activeInvFilter = cat;
  renderScreen('investments', document.getElementById('screen-content'));
}

function sortInv(col) {
  if (APP.invSort.col === col) {
    APP.invSort.dir = APP.invSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    APP.invSort = { col, dir: 'desc' };
  }
  renderScreen('investments', document.getElementById('screen-content'));
}

// ── LIVE PRICE FETCH ──────────────────────────────────────────────────────────
async function refreshLivePrices() {
  const btn = document.getElementById('refresh-prices-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Fetching…'; }

  const goldInvs  = APP.investments.filter(i => _invCat(i) === 'Gold');
  const otherInvs = APP.investments.filter(i => _invCat(i) !== 'Gold' && i.ticker && _invCat(i) !== 'EPF');

  if (!goldInvs.length && !otherInvs.length) {
    if (btn) { btn.disabled = false; btn.innerHTML = ic('refresh',12) + ' Refresh'; }
    _showToast('No holdings have tickers. Add tickers via Edit to enable live prices.');
    return;
  }

  let updated = 0, failed = 0;

  // Gold: fetch once via GC=F + USDINR=X
  if (goldInvs.length) {
    try {
      const pricePerGram = await _fetchGoldINR();
      goldInvs.forEach(i => { i.livePrice = Math.round(pricePerGram); updated++; });
    } catch(e) { failed += goldInvs.length; }
  }

  // Pre-fetch USD/INR so USD-denominated tickers (e.g. US stocks) convert to INR
  let usdInrRate = null;
  if (otherInvs.length) {
    try { usdInrRate = await _fetchUsdInr(); } catch(e) {}
  }

  // Stocks / MF / FD / Bond / ESOP: Yahoo Finance
  await Promise.all(otherInvs.map(async inv => {
    try {
      const { price, currency } = await _fetchYahooPrice(inv.ticker);
      if (price && isFinite(price)) {
        inv.livePrice = (currency === 'USD' && usdInrRate) ? Math.round(price * usdInrRate) : price;
        updated++;
      } else failed++;
    } catch(e) { failed++; }
  }));

  if (typeof saveInvestmentsConfig === 'function') saveInvestmentsConfig();

  if (btn) { btn.disabled = false; btn.innerHTML = ic('refresh',12) + ' Refresh'; }
  const msg = `Updated ${updated} price${updated !== 1 ? 's' : ''}` +
    (failed ? `. ${failed} failed — check ticker symbols (use Yahoo Finance format, e.g. RELIANCE.NS).` : '.');
  _showToast(msg);

  renderScreen(_screen, document.getElementById('screen-content'));
}

function _timedFetch(url, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(t));
}

const _YAHOO_PROXIES = [
  url => _timedFetch('https://corsproxy.io/?url='                         + encodeURIComponent(url), 7000).then(r => { if (!r.ok) throw new Error('corsproxy '  + r.status); return r.json(); }),
  url => _timedFetch('https://api.codetabs.com/v1/proxy?quest='           + encodeURIComponent(url), 7000).then(r => { if (!r.ok) throw new Error('codetabs '   + r.status); return r.json(); }),
  url => _timedFetch('https://thingproxy.freeboard.io/fetch/'             + url,                     8000).then(r => { if (!r.ok) throw new Error('thingproxy ' + r.status); return r.json(); }),
  url => _timedFetch('https://api.allorigins.win/raw?url='                + encodeURIComponent(url), 8000).then(r => { if (!r.ok) throw new Error('allorigins ' + r.status); return r.json(); }),
];

async function _proxyFetch(url) {
  for (const proxy of _YAHOO_PROXIES) {
    try {
      const data = await proxy(url);
      if (!data || (typeof data === 'object' && data.error)) throw new Error('bad response');
      return data;
    } catch(e) {
      console.warn('[V2 proxy] failed, trying next:', e.message);
    }
  }
  throw new Error('All proxies failed');
}

function _yahooUrl(ticker) {
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;
}

async function _fetchYahooPrice(ticker) {
  const d = await _proxyFetch(_yahooUrl(ticker));
  const meta = d?.chart?.result?.[0]?.meta;
  if (!meta?.regularMarketPrice) throw new Error('No price for ' + ticker);
  return { price: meta.regularMarketPrice, currency: meta.currency ?? 'INR' };
}

async function _fetchUsdInr() {
  const d = await _proxyFetch(_yahooUrl('USDINR=X'));
  const rate = d?.chart?.result?.[0]?.meta?.regularMarketPrice;
  if (!rate) throw new Error('USDINR fetch failed');
  return rate;
}

async function _fetchGoldINR() {
  // Primary: CoinGecko — PAX Gold is backed 1:1 by 1 troy oz, returns INR directly
  // (no CORS proxy needed; avoids relying solely on the flaky public Yahoo proxies below)
  try {
    const r = await _timedFetch('https://api.coingecko.com/api/v3/simple/price?ids=pax-gold&vs_currencies=inr', 7000);
    if (!r.ok) throw new Error('CG HTTP ' + r.status);
    const data = await r.json();
    const oz = data?.['pax-gold']?.inr;
    if (!oz || oz <= 0) throw new Error('CG: no price');
    return oz / 31.1035; // INR/oz → INR/gram
  } catch(e) {
    // Fallback: Yahoo Finance GC=F (COMEX gold, USD/troy oz) + USDINR=X
    const [gD, fxD] = await Promise.all([
      _proxyFetch(_yahooUrl('GC=F')),
      _proxyFetch(_yahooUrl('USDINR=X')),
    ]);
    const usd  = gD?.chart?.result?.[0]?.meta?.regularMarketPrice;
    const rate = fxD?.chart?.result?.[0]?.meta?.regularMarketPrice;
    if (!usd || !rate) throw new Error('Gold/FX fetch failed');
    return (usd * rate) / 31.1035; // USD/oz → INR/gram
  }
}

function _showToast(msg) {
  const t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:var(--s3);color:var(--t1);border:1px solid var(--b2);border-radius:var(--r);padding:11px 20px;font-size:13px;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,.35);white-space:nowrap;max-width:90vw;white-space:normal;text-align:center';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

// ── INIT ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  buildSidebarNav();
  buildBottomNav();
  document.getElementById('app-layout').style.display = 'none';
  document.getElementById('sidebar-toggle').addEventListener('click', toggleSidebar);

  // Restore session (fr-sync.js will load real data once Firebase auth fires)
  const stored = localStorage.getItem('fr_session');
  let autoLoggedIn = false;
  if (stored) {
    try {
      const s = JSON.parse(stored);
      APP.user = {
        uid:      s.uid      || '',
        name:     s.name     || 'User',
        email:    s.email    || '',
        initials: s.initials || 'U',
        photo:    s.photo    || null,
      };
      showApp();
      autoLoggedIn = true;
    } catch {}
  }
  if (!autoLoggedIn) document.getElementById('login-screen').style.display = '';
  document.getElementById('boot-loader').style.display = 'none';

  // Quick Add widget adapter — bridges the app-agnostic QuickAddBot core
  // to Modern's `APP` global and the loan-payment auto-sync helpers above.
  if (typeof QuickAddBot !== 'undefined') {
    const QAB_PLURAL = { expense: 'expenses', income: 'income', investment: 'investments', loan: 'loans' };
    QuickAddBot.init({
      fabIcon: '../FinBolt.png',
      getLoans: () => APP.loans.map(l => ({ id: l.id, name: l.name })),
      onSubmit: (type, entry) => {
        const pluralType = QAB_PLURAL[type];
        if (entry.loanId) entry.loanId = parseInt(entry.loanId, 10) || null;
        entry.id = Math.max(0, ...APP.monthly[pluralType].map(e => e.id)) + 1;
        if (entry.loanId) autoLogLoanPayment(entry);
        APP.monthly[pluralType].push(entry);
        navigate('monthly');
        return () => {
          if (entry.loanId && entry.paymentId) autoRemoveLoanPayment(entry.loanId, entry.paymentId);
          APP.monthly[pluralType] = APP.monthly[pluralType].filter(e => e.id !== entry.id);
          navigate('monthly');
        };
      },
    });
  }

  // Tweaks panel protocol
  window.addEventListener('message', e => {
    if (e.data?.type === '__activate_edit_mode')   document.getElementById('tweaks-panel')?.classList.remove('hide');
    if (e.data?.type === '__deactivate_edit_mode') document.getElementById('tweaks-panel')?.classList.add('hide');
  });
  window.parent.postMessage({ type: '__edit_mode_available' }, '*');
});
