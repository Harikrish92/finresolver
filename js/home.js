/* ============================================================
   home.js — Dashboard / home screen logic
   FinResolver · finresolver.in
   ============================================================ */

/* ── Nav Drawer ── */
let _currentScreen = 'home';

function openNavDrawer() {
  document.getElementById('navDrawer').classList.add('open');
  document.getElementById('navDrawerOverlay').classList.add('open');
  _setDrawerActive(_currentScreen);
}

function closeNavDrawer() {
  document.getElementById('navDrawer').classList.remove('open');
  document.getElementById('navDrawerOverlay').classList.remove('open');
}

function _setDrawerActive(screen) {
  document.querySelectorAll('.nav-drawer-item').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.screen === screen);
  });
}

function _hideAllScreens() {
  ['homeScreen','appMain','loanScreen','loanDetailScreen','investmentScreen','portfolioScreen','lifestyleScreen'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  if (typeof invStopAutoRefresh === 'function') invStopAutoRefresh();
}

function _enterTracker(screen) {
  _currentScreen = screen;
  _hideAllScreens();
  document.getElementById('btnHamburger').style.display = 'flex';
}

function _exitTracker() {
  _currentScreen = 'home';
  document.getElementById('btnHamburger').style.display = 'none';
}

/** Navigate from home → tracker */
function goToTracker() {
  history.pushState({ screen: 'tracker' }, '');
  _enterTracker('tracker');
  document.getElementById('appMain').style.display     = 'block';

  // Show tracker-only header controls (month selector, sync status, import)
  const tc = document.getElementById('headerTrackerControls');
  if (tc) tc.style.display = 'flex';

  // FIX: Always reload from storage for the current user before rendering.
  // Without this, a guest login after a real-user session shows the previous
  // user's in-memory data because the global `data` variable is never reset.
  if (typeof syncLoadData === 'function' && typeof syncReady !== 'undefined' && syncReady) {
    syncLoadData();
  } else {
    loadData();
  }
}

/** Navigate back to home */
function goToHome() {
  history.replaceState({ screen: 'home' }, '');
  closeNavDrawer();
  _hideAllScreens();
  _exitTracker();
  document.getElementById('homeScreen').style.display  = 'block';

  // Hide tracker-only header controls on home screen
  const tc = document.getElementById('headerTrackerControls');
  if (tc) tc.style.display = 'none';

  renderHomeDashboard();
}

/** Navigate home → portfolio overview */
function goToPortfolio() {
  history.pushState({ screen: 'portfolio' }, '');
  _enterTracker('portfolio');
  document.getElementById('portfolioScreen').style.display = 'block';

  const tc = document.getElementById('headerTrackerControls');
  if (tc) tc.style.display = 'none';

  renderPortfolioOverview();

  // Fetch fresh prices then re-render; reuse the same helper as the home screen.
  // If caches are already warm (user came from investment screen) this resolves instantly.
  pfFetchLivePricesAndRender();
}

/** Navigate home → lifestyle tracker */
function goToLifestyle() {
  history.pushState({ screen: 'lifestyle' }, '');
  _enterTracker('lifestyle');
  document.getElementById('lifestyleScreen').style.display = 'block';

  const tc = document.getElementById('headerTrackerControls');
  if (tc) tc.style.display = 'none';

  if (typeof goToLifestyle._loaded === 'undefined') {
    // First visit: let lifestyle.js handle load + render via its own goToLifestyle()
    goToLifestyle._loaded = true;
  }
  if (typeof loadLifestyle === 'function') {
    loadLifestyle().then(function() {
      if (typeof lsRenderAll === 'function') lsRenderAll();
    });
  }
}

function pfFetchLivePricesAndRender() {
  if (typeof invFetchQuote !== 'function') return;

  const uid = (typeof fbAuth !== 'undefined' && fbAuth?.currentUser?.uid)
              ? fbAuth.currentUser.uid : (currentUser?.uid || 'guest');

  let holdings = [];
  try {
    const raw = localStorage.getItem(`fr_investments_${uid}`);
    if (raw) holdings = JSON.parse(raw);
  } catch(e) { return; }
  if (!holdings.length) return;

  const tickers = [...new Set(
    holdings
      .filter(h => (h.category === 'Stock' || h.category === 'MF' || h.category === 'ESOP') && h.ticker)
      .map(h => h.ticker)
  )];
  const hasGold = holdings.some(h => h.category === 'Gold');

  const jobs = [];
  const BATCH = 5;
  for (let i = 0; i < tickers.length; i += BATCH) {
    jobs.push(Promise.allSettled(
      tickers.slice(i, i + BATCH).map(t => invFetchQuote(t).then(q => { invQuoteCache[t] = q; }))
    ));
  }
  if (hasGold && typeof fetchGoldPriceINR === 'function') {
    jobs.push(fetchGoldPriceINR().catch(() => {}));
  }
  // Pre-fetch USD/INR rate so portfolio values are correctly converted to ₹
  if (tickers.length && typeof fetchUsdInrRate === 'function') {
    jobs.push(fetchUsdInrRate().catch(() => {}));
  }
  if (!jobs.length) return;

  setInvLiveDot(true);
  Promise.allSettled(jobs).then(() => {
    setInvLiveDot(false);
    if (document.getElementById('portfolioScreen').style.display !== 'none') {
      renderPortfolioOverview();
    }
  });
}

/** Render the home dashboard stats */
function renderHomeDashboard() {
  // Safety guard: fmtCrore is defined in insights.js — if not yet loaded, bail
  if (typeof fmtCrore !== 'function') return;

  const uid = (typeof fbAuth !== 'undefined' && fbAuth?.currentUser?.uid)
              ? fbAuth.currentUser.uid : (currentUser?.uid || 'guest');

  const now   = new Date();
  const yr    = now.getFullYear();
  const mo    = now.getMonth();

  // ── Fix 1: detect whether any data exists yet for this user ──
  // On first login the localStorage cache is empty until syncPrefetchPastMonths
  // completes. Show a subtle "loading" state instead of all-zero stats.
  const hasAnyData = (() => {
    for (let i = 0; i <= 3; i++) {
      let m = mo - i, y = yr;
      if (m < 0) { m += 12; y--; }
      if (localStorage.getItem(`fr_data_${uid}_${y}_${m}`)) return true;
    }
    return false;
  })();

  const isSyncing = typeof syncReady !== 'undefined' && !syncReady
                    && typeof db !== 'undefined' && db !== null;

  // Last 3 months total expense for FIRE — Fix 3: now populated by prefetch
  let totalExp = 0, monthsWithData = 0;
  for (let i = 0; i < 3; i++) {
    let m = mo - i, y = yr;
    if (m < 0) { m += 12; y--; }
    const d = getCachedMonthData(uid, y, m);
    if (d) { totalExp += sumArr(d.expense || []); monthsWithData++; }
  }
  const avgMonthlyExp = monthsWithData ? totalExp / monthsWithData : 0;
  const fireNumber    = avgMonthlyExp * 12 * 25;

  // YTD savings = Income − Expenses − Loan repayments
  let ytdInc = 0, ytdExp = 0, ytdLoan = 0;
  for (let m = 0; m <= mo; m++) {
    const d = getCachedMonthData(uid, yr, m);
    if (d) {
      ytdInc  += sumArr(d.income   || []);
      ytdExp  += sumArr(d.expense  || []);
      ytdLoan += sumArr(d.loan     || []);
    }
  }
  const ytdSavings = ytdInc - ytdExp - ytdLoan;

  // Total investment current value — use in-memory investmentsData (already decrypted)
  let totalInvCurrentVal = 0;
  try {
    const holdings = (typeof investmentsData !== 'undefined') ? investmentsData : [];
    holdings.forEach(h => {
      if (h.category === 'Gold') {
        const grams = h.grams || h.qty || 0;
        const liveG = (typeof goldPriceCache !== 'undefined' && goldPriceCache?.pricePerGram) || 0;
        totalInvCurrentVal += liveG > 0 ? grams * liveG
                                        : grams * (h.buyPricePerGram || h.avgPrice || 0);
      } else if (h.category === 'RealEstate') {
        totalInvCurrentVal += h.curPrice || h.buyPrice || h.avgPrice || 0;
      } else {
        const qty = h.qty || 0;
        const q   = (typeof invQuoteCache !== 'undefined') && h.ticker && invQuoteCache[h.ticker];
        totalInvCurrentVal += q ? (toInr(q.price, q.currency) * qty) : qty * (h.avgPrice || 0);
      }
    });
  } catch(e) {}

  // Total loan outstanding balance — use in-memory loansData (already decrypted)
  let totalLoanOutstanding = 0;
  try {
    const loans = (typeof loansData !== 'undefined') ? loansData : [];
    loans.forEach(loan => {
      if (loan.closed) return;
      // Simple outstanding: principal - payments made
      let outstanding = Number(loan.principal || 0);
      const payments = loan.payments || [];
      payments.forEach(p => { outstanding -= Number(p.amount || 0); });
      // Use schedule-based outstanding if calcLoanStats is available
      if (typeof calcLoanStats === 'function') {
        try { outstanding = calcLoanStats(loan).outstanding; } catch(e) {}
      }
      if (outstanding > 0) totalLoanOutstanding += outstanding;
    });
  } catch(e) {}

  const monthName = MONTHS[mo];
  const name      = currentUser?.name?.split(' ')[0] || 'there';

  // Helper: safely set textContent only if element exists
  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  setText('homeWelcomeName', name);
  setText('homeMonthName',   monthName);

  // If we're still fetching on a fresh login, show a loading indicator
  const placeholder = (!hasAnyData && isSyncing) ? '…' : null;

  setText('homeStatFire', placeholder ?? (fireNumber > 0 ? fmtCrore(fireNumber) : '—'));

  const invEl = document.getElementById('homeStatInvestments');
  if (invEl) {
    invEl.textContent = placeholder ?? (totalInvCurrentVal > 0 ? fmtCrore(totalInvCurrentVal) : '—');
  }

  const loanEl = document.getElementById('homeStatLoans');
  if (loanEl) {
    loanEl.textContent = placeholder ?? (totalLoanOutstanding > 0 ? fmtCrore(totalLoanOutstanding) : '—');
    loanEl.style.color = totalLoanOutstanding > 0 ? 'var(--accent2)' : 'var(--accent)';
  }

  const ytdEl = document.getElementById('homeStatYTD');
  if (ytdEl) {
    ytdEl.textContent = placeholder ?? fmtCrore(Math.abs(ytdSavings));
    ytdEl.style.color = ytdSavings >= 0 ? 'var(--accent)' : 'var(--accent2)';
  }

  // Lifestyle tracker stat
  const lsEl = document.getElementById('homeStatLifestyle');
  if (lsEl && typeof lsGetHomeStat === 'function') {
    const lsStat = lsGetHomeStat();
    lsEl.textContent = lsStat || '—';
  }

  // Month quick summary
}

/* Chart.js donut instance for portfolio allocation */
let pfAllocChartInst = null;

/** Render the full Portfolio Overview screen */
function renderPortfolioOverview() {
  if (typeof fmtCrore !== 'function') return;

  const uid = (typeof fbAuth !== 'undefined' && fbAuth?.currentUser?.uid)
              ? fbAuth.currentUser.uid : (currentUser?.uid || 'guest');

  const now = new Date();
  const yr  = now.getFullYear();
  const mo  = now.getMonth();

  const CAT_COLORS = {
    Stock: '#00e5a0', MF: '#4dabf7', Bond: '#ffd166',
    FD: '#f0b429', RealEstate: '#a78bfa', Gold: '#e9c46a',
    EPF: '#06b6d4', ESOP: '#c084fc', Others: '#ff6b6b'
  };

  // ── 1. Investment holdings — use in-memory investmentsData (already decrypted)
  let totalInvValue = 0;
  let holdings = [];
  try {
    holdings = (typeof investmentsData !== 'undefined') ? [...investmentsData] : [];
    holdings.forEach(h => {
      let val;
      if (h.category === 'Gold') {
        const grams  = Number(h.grams || h.qty || 0);
        const liveG  = (typeof goldPriceCache !== 'undefined' && goldPriceCache?.pricePerGram) || 0;
        val = liveG > 0 ? grams * liveG : grams * Number(h.buyPricePerGram || h.avgPrice || 0);
      } else if (h.category === 'RealEstate') {
        val = Number(h.curPrice || h.buyPrice || h.avgPrice || 0);
      } else if (h.ticker && typeof invQuoteCache !== 'undefined' && invQuoteCache[h.ticker]?.price) {
        const _q = invQuoteCache[h.ticker];
        val = toInr(_q.price, _q.currency) * Number(h.qty || 0);
      } else {
        val = Number(h.qty || 0) * Number(h.avgPrice || 0);
      }
      h._pfVal = val;
      totalInvValue += val;
    });
  } catch(e) {}

  // ── 2. Cash balance ───────────────────────────────────────────
  const curBal = getMonthBalance(uid, yr, mo);

  // ── 3. Loan outstanding — use in-memory loansData (already decrypted)
  let totalLoanOutstanding = 0;
  try {
    const loans = (typeof loansData !== 'undefined') ? loansData : [];
    loans.forEach(loan => {
      if (loan.closed) return;
      let outstanding = Number(loan.principal || 0);
      (loan.payments || []).forEach(p => { outstanding -= Number(p.amount || 0); });
      if (typeof calcLoanStats === 'function') {
        try { outstanding = calcLoanStats(loan).outstanding; } catch(e) {}
      }
      if (outstanding > 0) totalLoanOutstanding += outstanding;
    });
  } catch(e) {}

  const netWorth = totalInvValue + Math.max(0, curBal) - totalLoanOutstanding;

  // ── 4. YTD & rolling metrics ──────────────────────────────────
  let ytdInc = 0, ytdExp = 0, ytdLoan = 0;
  for (let m = 0; m <= mo; m++) {
    const d = getCachedMonthData(uid, yr, m);
    if (d) {
      ytdInc  += sumArr(d.income  || []);
      ytdExp  += sumArr(d.expense || []);
      ytdLoan += sumArr(d.loan    || []);
    }
  }
  let totalExp3m = 0, months3m = 0;
  for (let i = 0; i < 3; i++) {
    let m = mo - i, y = yr;
    if (m < 0) { m += 12; y--; }
    const d = getCachedMonthData(uid, y, m);
    if (d) { totalExp3m += sumArr(d.expense || []); months3m++; }
  }
  const avgMonthlyExp = months3m ? totalExp3m / months3m : 0;

  const savingsRate  = ytdInc > 0
    ? Math.round(((ytdInc - ytdExp - ytdLoan) / ytdInc) * 100) : null;
  const totalAssets  = totalInvValue + Math.max(0, curBal);
  const debtRatio    = totalAssets > 0
    ? Math.round((totalLoanOutstanding / totalAssets) * 100) : null;
  const safetyMonths = avgMonthlyExp > 0 && curBal > 0
    ? Math.floor(curBal / avgMonthlyExp) : null;

  // ── 5. Category totals ────────────────────────────────────────
  const catTotals = {};
  holdings.forEach(h => {
    const cat = h.category || 'Others';
    catTotals[cat] = (catTotals[cat] || 0) + (h._pfVal || 0);
  });

  // ── 6. Top 5 holdings ─────────────────────────────────────────
  const topHoldings = [...holdings]
    .sort((a, b) => (b._pfVal || 0) - (a._pfVal || 0))
    .slice(0, 5);

  // ── Render helpers ────────────────────────────────────────────
  const fmt     = v => fmtCrore(v);
  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  // Summary strip
  const nwEl = document.getElementById('pfNetWorth');
  if (nwEl) {
    nwEl.textContent = (totalInvValue > 0 || curBal !== 0) ? fmt(netWorth) : '—';
    nwEl.style.color = netWorth >= 0 ? 'var(--purple)' : 'var(--accent2)';
  }
  setText('pfNWInvested', totalInvValue > 0 ? fmt(totalInvValue) : '—');
  setText('pfNWLoans',    totalLoanOutstanding > 0 ? fmt(totalLoanOutstanding) : '—');
  setText('pfNWCash',     curBal !== 0 ? fmt(Math.abs(curBal)) : '—');

  const srEl = document.getElementById('pfSavingsRate');
  if (srEl) {
    srEl.textContent = savingsRate !== null ? savingsRate + '%' : '—';
    srEl.style.color = savingsRate === null ? 'var(--accent3)'
      : savingsRate >= 20 ? 'var(--accent)'
      : savingsRate >= 10 ? 'var(--accent3)' : 'var(--accent2)';
  }

  // FIRE panel
  const fireNumber = avgMonthlyExp * 12 * 25;
  const pfFireEl = document.getElementById('pfFireNumber');
  if (pfFireEl) {
    pfFireEl.textContent = fireNumber > 0 ? fmt(fireNumber) : '—';
    pfFireEl.style.color = fireNumber > 0 ? 'var(--accent3)' : 'var(--muted)';
  }
  setText('pfFireMonthly', avgMonthlyExp > 0 ? fmt(avgMonthlyExp) : '—');
  setText('pfFireAnnual',  avgMonthlyExp > 0 ? fmt(avgMonthlyExp * 12) : '—');

  // Health panel
  const drEl = document.getElementById('pfDebtRatio');
  if (drEl) {
    drEl.textContent = debtRatio !== null ? debtRatio + '%' : '—';
    drEl.style.color = debtRatio === null ? 'var(--text)'
      : debtRatio < 20 ? 'var(--accent)'
      : debtRatio < 40 ? 'var(--accent3)' : 'var(--accent2)';
  }
  const smEl = document.getElementById('pfSafetyMonths');
  if (smEl) {
    smEl.textContent = safetyMonths !== null ? safetyMonths + 'mo' : '—';
    smEl.style.color = safetyMonths === null ? 'var(--text)'
      : safetyMonths >= 6 ? 'var(--accent)'
      : safetyMonths >= 3 ? 'var(--accent3)' : 'var(--accent2)';
  }

  // ── Donut chart ───────────────────────────────────────────────
  const canvas = document.getElementById('pfAllocChart');
  const legEl  = document.getElementById('pfAllocLegend');

  if (canvas && typeof Chart !== 'undefined') {
    // Destroy previous instance to avoid canvas reuse errors
    if (pfAllocChartInst) { pfAllocChartInst.destroy(); pfAllocChartInst = null; }

    // Inline plugin: draws center text directly on the canvas so it never
    // conflicts with the tooltip z-index (both are on the same canvas layer).
    const centerTextPlugin = {
      id: 'pfCenterText',
      // afterDatasetsDraw fires BEFORE the built-in tooltip plugin's afterDraw,
      // so the center text is always underneath the tooltip layer.
      afterDatasetsDraw(chart) {
        const { ctx, chartArea } = chart;
        const cx = (chartArea.left + chartArea.right) / 2;
        const cy = (chartArea.top + chartArea.bottom) / 2;
        const cs = getComputedStyle(document.documentElement);
        const textColor  = cs.getPropertyValue('--text').trim()  || '#e8edf5';
        const mutedColor = cs.getPropertyValue('--muted').trim() || '#6b7a99';
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '700 13px Syne, sans-serif';
        ctx.fillStyle = textColor;
        ctx.fillText(totalInvValue > 0 ? fmt(totalInvValue) : '—', cx, cy - 9);
        ctx.font = '400 9px DM Mono, monospace';
        ctx.fillStyle = mutedColor;
        ctx.fillText('INVESTED', cx, cy + 9);
        ctx.restore();
      }
    };

    if (totalInvValue <= 0) {
      pfAllocChartInst = new Chart(canvas, {
        type: 'doughnut',
        data: {
          labels: ['No holdings'],
          datasets: [{ data: [1], backgroundColor: ['#232d3f'], borderWidth: 0 }]
        },
        options: {
          cutout: '72%', animation: { duration: 600 },
          plugins: { legend: { display: false }, tooltip: { enabled: false } }
        },
        plugins: [centerTextPlugin]
      });
      if (legEl) legEl.innerHTML = '<span style="font-size:.72rem;color:var(--muted)">Add holdings in Investment Tracker</span>';
    } else {
      const sorted = Object.entries(catTotals).sort((a, b) => b[1] - a[1]);
      const labels = sorted.map(([cat]) => cat);
      const values = sorted.map(([, v])  => v);
      const colors = labels.map(c => CAT_COLORS[c] || '#888');

      pfAllocChartInst = new Chart(canvas, {
        type: 'doughnut',
        data: {
          labels,
          datasets: [{
            data: values,
            backgroundColor: colors,
            borderColor: '#111620',
            borderWidth: 3,
            hoverBorderWidth: 0,
            hoverOffset: 8
          }]
        },
        options: {
          cutout: '72%',
          animation: { duration: 700, easing: 'easeOutQuart' },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: ctx => {
                  const pct = (ctx.parsed / totalInvValue * 100).toFixed(1);
                  return `  ${ctx.label}: ${fmt(ctx.parsed)}  (${pct}%)`;
                }
              },
              backgroundColor: '#1a2030',
              borderColor: '#232d3f',
              borderWidth: 1,
              titleColor: '#e8edf5',
              bodyColor: '#a0aec0',
              padding: 10,
              cornerRadius: 8
            }
          }
        },
        plugins: [centerTextPlugin]
      });

      // Custom legend
      if (legEl) {
        legEl.innerHTML = sorted.map(([cat, val]) => {
          const pct  = (val / totalInvValue * 100).toFixed(1);
          const color = CAT_COLORS[cat] || '#888';
          return `<div class="pf-leg-item">
            <span class="pf-leg-dot" style="background:${color}"></span>
            <span class="pf-leg-name">${cat}</span>
            <span class="pf-leg-pct">${pct}%</span>
            <span class="pf-leg-val">${fmt(val)}</span>
          </div>`;
        }).join('');
      }
    }
  }

  // ── Top holdings ──────────────────────────────────────────────
  const holdingsEl = document.getElementById('pfTopHoldings');
  if (holdingsEl) {
    if (topHoldings.length === 0) {
      holdingsEl.innerHTML = '<div class="pf-empty">No holdings yet — add some in Investment Tracker</div>';
    } else {
      holdingsEl.innerHTML = topHoldings.map(h => {
        const initials = (h.name || '?').replace(/[^a-zA-Z ]/g, '')
          .split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?';
        const color = CAT_COLORS[h.category] || '#888';
        const val   = h._pfVal || 0;
        const pct   = totalInvValue > 0 ? (val / totalInvValue * 100).toFixed(1) : '0.0';
        return `<div class="pf-holding-row">
          <div class="pf-holding-badge" style="background:${color}22;color:${color}">${initials}</div>
          <div class="pf-holding-info">
            <div class="pf-holding-name">${h.name || '—'}</div>
            <div class="pf-holding-meta">${h.category || 'Others'}${h.ticker ? ' · ' + h.ticker : ''}</div>
          </div>
          <div class="pf-holding-right">
            <div class="pf-holding-val">${fmt(val)}</div>
            <div class="pf-holding-pct">${pct}%</div>
          </div>
        </div>`;
      }).join('');
    }
  }
}

/** Called from applyUser — shows home instead of tracker directly */
function showHomeScreen() {
  history.replaceState({ screen: 'home' }, '');
  closeNavDrawer();
  _exitTracker();
  document.getElementById('loginScreen').style.display  = 'none';
  document.getElementById('appMain').style.display      = 'none';
  document.getElementById('homeScreen').style.display   = 'block';

  // Hide ALL module screens so nothing bleeds through on login/logout
  ['loanScreen','loanDetailScreen','investmentScreen','portfolioScreen','lifestyleScreen'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  // Stop investment auto-refresh if running
  if (typeof invStopAutoRefresh === 'function') invStopAutoRefresh();

  // Always hide tracker-only controls when on home screen
  const tc = document.getElementById('headerTrackerControls');
  if (tc) tc.style.display = 'none';

  renderHomeDashboard();

  // Show loader if Firebase is configured and the initial cloud sync hasn't
  // completed yet (syncReady is false until onAuthStateChanged fires in sync.js).
  // Guest users and local-only mode skip this path.
  const _fbCfg   = (window.FINRESOLVER_CONFIG || {}).firebase || {};
  const _fbReady = typeof syncReady !== 'undefined' ? syncReady : false;
  if (_fbCfg.apiKey && !_fbCfg.apiKey.includes('YOUR_FIREBASE_API_KEY')
      && !currentUser?.isGuest && !_fbReady) {
    showHomeLoader();
  }

  // Show first-time intro walkthrough (no-op if already seen)
  maybeShowIntro();

  // Silently fetch live prices once so the home stat reflects current values,
  // regardless of whether live tracking is enabled in the investment screen.
  homeFetchLivePricesOnce();
}

/**
 * One-time background fetch of stock quotes + gold price for the home screen.
 * Does NOT start the auto-refresh timer and ignores invLiveEnabled.
 * Re-renders the home dashboard once all fetches settle.
 */
function homeFetchLivePricesOnce() {
  if (typeof invFetchQuote !== 'function') return; // investments.js not ready

  const uid = (typeof fbAuth !== 'undefined' && fbAuth?.currentUser?.uid)
              ? fbAuth.currentUser.uid : (currentUser?.uid || 'guest');

  const holdings = (typeof investmentsData !== 'undefined') ? [...investmentsData] : [];

  if (!holdings.length) return;

  const tickers  = [...new Set(
    holdings
      .filter(h => (h.category === 'Stock' || h.category === 'MF' || h.category === 'ESOP') && h.ticker)
      .map(h => h.ticker)
  )];
  const hasGold  = holdings.some(h => h.category === 'Gold');

  const jobs = [];

  // Fetch stock/MF/ESOP quotes in batches of 5
  const BATCH = 5;
  for (let i = 0; i < tickers.length; i += BATCH) {
    const batch = tickers.slice(i, i + BATCH);
    jobs.push(
      Promise.allSettled(
        batch.map(t => invFetchQuote(t).then(q => { invQuoteCache[t] = q; }))
      )
    );
  }

  // Fetch gold price
  if (hasGold && typeof fetchGoldPriceINR === 'function') {
    jobs.push(fetchGoldPriceINR().catch(() => {}));
  }

  // Pre-fetch USD/INR rate so home stat is correctly converted to ₹
  if (tickers.length && typeof fetchUsdInrRate === 'function') {
    jobs.push(fetchUsdInrRate().catch(() => {}));
  }

  if (!jobs.length) return;

  setInvLiveDot(true);
  Promise.allSettled(jobs).then(() => {
    setInvLiveDot(false);
    // Only re-render if the home screen is still visible
    if (document.getElementById('homeScreen').style.display !== 'none') {
      renderHomeDashboard();
    }
  });
}

/* ════════════════════════════════════════════════════════════════════════════
   FIRST-TIME INTRO WALKTHROUGH
   5 slides: Welcome (modal) → Monthly → Investment → Loan → FIRE (spotlight)
   Ring, callout, and tracker panel live OUTSIDE the overlay so they aren't
   trapped by its backdrop-filter stacking context.
════════════════════════════════════════════════════════════════════════════ */

const INTRO_SLIDES = [
  {
    type: 'welcome',
    icon: '✨',
    title: '<span>Fin</span>Resolver',
    sub: 'Your personal finance command center. Let\'s take a quick tour of everything you can do here.',
    features: [
      { icon: '📊', title: 'Monthly Tracker',    desc: 'Log expenses, income, investments & loan payments month by month.' },
      { icon: '📈', title: 'Investment Tracker', desc: 'Live prices for stocks & mutual funds, portfolio P&L & allocation.' },
      { icon: '🏦', title: 'Loan Tracker',       desc: 'EMI schedule, amortization table & full payoff timeline.' },
      { icon: '🔥', title: 'FIRE & Insights',    desc: 'Net worth, savings rate, FIRE number & spending pattern insights.' },
    ]
  },
  {
    type: 'spotlight',
    selector: '.home-nav-card.tracker',
    icon: '📊',
    title: 'Monthly <span>Tracker</span>',
    sub: 'Every month, record income, expenses, SIPs and EMIs in one place. Totals and charts update instantly.',
    features: [
      { icon: '💸', title: 'Expenses & Income',   desc: 'Add entries with descriptions and optional dates.' },
      { icon: '📈', title: 'Investments & Loans', desc: 'Track monthly SIPs and EMIs side by side.' },
      { icon: '✅', title: 'Monthly Checklist',   desc: 'Mark off recurring payments so nothing slips.' },
      { icon: '✨', title: 'Smart Fill',           desc: 'Pre-populate recurring items from past months in one click.' },
    ]
  },
  {
    type: 'spotlight',
    selector: '.home-nav-card.investment',
    icon: '📈',
    title: 'Investment <span>Tracker</span>',
    sub: 'Your entire portfolio with live prices, P&L and asset allocation across every category.',
    features: [
      { icon: '⚡', title: 'Live Prices',       desc: 'NSE/BSE stocks & MFs via Yahoo Finance. Auto-refreshes every 60s.' },
      { icon: '🥇', title: 'All Asset Classes', desc: 'Stocks, MF, FD, EPF, ESOP, Real Estate, Gold & more.' },
      { icon: '📉', title: 'Price Charts',      desc: 'Interactive chart, financials & news for each holding.' },
      { icon: '⬆',  title: 'Broker Import',    desc: 'Import from Zerodha, Groww, Upstox and others.' },
    ]
  },
  {
    type: 'spotlight',
    selector: '.home-nav-card.loan',
    icon: '🏦',
    title: 'Loan <span>Tracker</span>',
    sub: 'Model every loan you hold and see exactly when you\'ll be debt-free.',
    features: [
      { icon: '🧮', title: 'EMI Calculator', desc: 'Enter principal, rate & tenure to get the exact monthly EMI.' },
      { icon: '📅', title: 'Amortization',   desc: 'Month-by-month principal vs interest with payoff date.' },
      { icon: '💳', title: 'Payment Log',    desc: 'Record actual payments and track outstanding balance.' },
      { icon: '📊', title: 'Visual Charts',  desc: 'Pie chart of principal vs interest + balance timeline.' },
    ]
  },
  {
    type: 'spotlight',
    selector: '.home-nav-card.portfolio',
    icon: '🔥',
    title: 'FIRE &amp; <span>Insights</span>',
    sub: 'Your complete financial picture — net worth, savings rate, FIRE number and spending patterns, all auto-calculated.',
    features: [
      { icon: '💰', title: 'Net Worth',     desc: 'Total investments + cash minus all loan balances.' },
      { icon: '🔥', title: 'FIRE Number',   desc: '25× annual expenses — track your financial independence goal.' },
      { icon: '📊', title: 'Savings Rate',  desc: 'YTD income saved as a percentage, updated each month.' },
      { icon: '💡', title: 'Insights',      desc: 'Auto-observations on biggest categories and spending trends.' },
    ]
  },
];

let _introStep = 0;
let _introHighlightedCard = null;   // track which card is currently boosted

/* ─── Public API ──────────────────────────────────────────────────────────── */

/** Show intro once per user (keyed by uid). No-op if already seen. */
function maybeShowIntro() {
  const uid = (typeof fbAuth !== 'undefined' && fbAuth?.currentUser?.uid)
              ? fbAuth.currentUser.uid : (currentUser?.uid || 'guest');
  if (localStorage.getItem(`fr_intro_done_${uid}`)) return;
  _introStep = 0;
  // Boost header above the backdrop so user can see the actual UI elements
  const header = document.querySelector('header');
  if (header) header.style.zIndex = '10002'; // above overlay(9999); callout is 10003 so it paints on top
  document.getElementById('introOverlay').classList.remove('hidden');
  _introRender();
}

/** Dismiss and permanently mark as done for this user. */
function introDismiss() {
  const uid = (typeof fbAuth !== 'undefined' && fbAuth?.currentUser?.uid)
              ? fbAuth.currentUser.uid : (currentUser?.uid || 'guest');
  localStorage.setItem(`fr_intro_done_${uid}`, '1');
  document.getElementById('introOverlay').classList.add('hidden');
  _introHideTrackerPanel();
  _introHideHeaderHighlight();
  _introClearCardHighlight();
  const header = document.querySelector('header');
  if (header) header.style.zIndex = '';
}

/** Step forward (+1) or backward (-1). */
function introNav(dir) {
  _introStep = Math.max(0, Math.min(INTRO_SLIDES.length - 1, _introStep + dir));
  _introRender();
}

/* ─── Render dispatcher ───────────────────────────────────────────────────── */

function _introRender() {
  const slide   = INTRO_SLIDES[_introStep];
  const isFirst = _introStep === 0;
  const isLast  = _introStep === INTRO_SLIDES.length - 1;

  if (slide.type === 'welcome') {
    _introClearCardHighlight();
    _introHideTrackerPanel();
    _introRenderWelcomeCard(slide, isFirst, isLast);
    _introShowHeaderHighlight();
  } else {
    _introHideWelcomeCard();
    _introHideHeaderHighlight();
    _introClearCardHighlight();
    _introHighlightCard(slide.selector);
    _introRenderTrackerPanel(slide, isFirst, isLast);
  }
}

/* ─── Slide 0: centered welcome modal ────────────────────────────────────── */

function _introRenderWelcomeCard(slide, isFirst, isLast) {
  const card = document.getElementById('introCard');
  if (card) card.style.display = '';

  // Dots
  const dotsEl = document.getElementById('introDots');
  if (dotsEl) dotsEl.innerHTML = _introDotHtml();

  // Content
  const contentEl = document.getElementById('introSlideContent');
  if (contentEl) {
    contentEl.innerHTML = `
      <div class="intro-icon">${slide.icon}</div>
      <div class="intro-title">${slide.title}</div>
      <div class="intro-sub">${slide.sub}</div>
      <div class="intro-features">
        ${(slide.features || []).map(f => `
          <div class="intro-feat">
            <div class="intro-feat-icon">${f.icon}</div>
            <div class="intro-feat-body">
              <div class="intro-feat-title">${f.title}</div>
              <div class="intro-feat-desc">${f.desc}</div>
            </div>
          </div>`).join('')}
      </div>`;
  }

  // Step label + nav buttons
  const stepEl = document.getElementById('introStepLabel');
  if (stepEl) stepEl.textContent = `${_introStep + 1} of ${INTRO_SLIDES.length}`;
  _introSetNavBtns('introPrevBtn', 'introNextBtn', 'introDoneBtn', isFirst, isLast);
}

function _introHideWelcomeCard() {
  const card = document.getElementById('introCard');
  if (card) card.style.display = 'none';
}

/* ─── Slides 1-4: spotlight + bottom tracker panel ───────────────────────── */

function _introHighlightCard(selector) {
  const card = selector ? document.querySelector(selector) : null;
  if (!card) return;
  _introHighlightedCard = card;

  // #homeScreen has z-index:1 which traps children in its stacking context.
  // Remove it so the card's z-index is evaluated against the root context and
  // it can appear above the overlay (z-index 9999).
  const homeScreen = document.getElementById('homeScreen');
  if (homeScreen) homeScreen.style.zIndex = 'auto';

  // Boost the card above the overlay in the root stacking context
  card.style.position      = 'relative';
  card.style.zIndex        = '10002';
  card.style.pointerEvents = 'none';           // prevent accidental navigation
  card.style.boxShadow     = '0 0 0 3px rgba(0,229,160,.4), 0 8px 32px rgba(0,0,0,.4)';

  // Position the shared ring around the card
  const ring = document.getElementById('introHighlightRing');
  if (ring) {
    const r = card.getBoundingClientRect();
    ring.style.left         = (r.left   - 7) + 'px';
    ring.style.top          = (r.top    - 7) + 'px';
    ring.style.width        = (r.width  + 14) + 'px';
    ring.style.height       = (r.height + 14) + 'px';
    ring.style.borderRadius = '20px';
    ring.classList.remove('hidden');
  }
}

function _introClearCardHighlight() {
  if (_introHighlightedCard) {
    _introHighlightedCard.style.position      = '';
    _introHighlightedCard.style.zIndex        = '';
    _introHighlightedCard.style.pointerEvents = '';
    _introHighlightedCard.style.boxShadow     = '';
    _introHighlightedCard = null;
  }
  // Restore #homeScreen's stacking context
  const homeScreen = document.getElementById('homeScreen');
  if (homeScreen) homeScreen.style.zIndex = '';
  const ring = document.getElementById('introHighlightRing');
  if (ring) ring.classList.add('hidden');
}

function _introRenderTrackerPanel(slide, isFirst, isLast) {
  const panel = document.getElementById('introTrackerPanel');
  if (!panel) return;

  // Dots
  const dotsEl = document.getElementById('introDotsSpot');
  if (dotsEl) dotsEl.innerHTML = _introDotHtml();

  // Step label
  const stepEl = document.getElementById('introStepLabelSpot');
  if (stepEl) stepEl.textContent = `${_introStep + 1} of ${INTRO_SLIDES.length}`;

  // Content
  const iconEl  = document.getElementById('itpIcon');
  const titleEl = document.getElementById('itpTitle');
  const subEl   = document.getElementById('itpSub');
  const featEl  = document.getElementById('itpFeatures');
  if (iconEl)  iconEl.textContent = slide.icon;
  if (titleEl) titleEl.innerHTML  = slide.title;
  if (subEl)   subEl.textContent  = slide.sub;
  if (featEl) {
    featEl.innerHTML = (slide.features || []).map(f => `
      <div class="itp-feat">
        <div class="itp-feat-icon">${f.icon}</div>
        <div class="itp-feat-body">
          <div class="itp-feat-title">${f.title}</div>
          <div class="itp-feat-desc">${f.desc}</div>
        </div>
      </div>`).join('');
  }

  // Nav buttons
  _introSetNavBtns('itpPrevBtn', 'itpNextBtn', 'itpDoneBtn', isFirst, isLast);

  // ── Smart positioning: never overlap the highlighted card ──────────────────
  // Show panel off-screen first so offsetHeight is measurable, then position.
  panel.style.top       = '-9999px';
  panel.style.bottom    = '';
  panel.style.maxHeight = '';
  panel.classList.remove('hidden');

  // requestAnimationFrame ensures the browser has rendered the panel so
  // offsetHeight is accurate before we compute the final position.
  requestAnimationFrame(function() {
    _introPositionTrackerPanel();
  });
}

function _introPositionTrackerPanel() {
  const panel = document.getElementById('introTrackerPanel');
  if (!panel || panel.classList.contains('hidden')) return;

  // ── Mobile: anchor panel above or below the card depending on its position ──
  if (window.innerWidth <= 600) {
    panel.style.left      = '0';
    panel.style.right     = '0';
    panel.style.transform = 'none';
    panel.style.width     = '100%';
    panel.style.maxWidth  = '100%';

    var mCard    = _introHighlightedCard;
    var HEADER_M = 68;
    var GAP_M    = 12;

    if (mCard) {
      var mRect       = mCard.getBoundingClientRect();
      var mSpaceAbove = mRect.top - HEADER_M - GAP_M;
      var mSpaceBelow = window.innerHeight - mRect.bottom - GAP_M;

      if (mSpaceBelow >= mSpaceAbove) {
        // Card is in upper half — panel anchors to bottom (bottom-sheet style)
        panel.classList.add('mobile-sheet');
        panel.classList.remove('mobile-sheet-top');
        panel.style.top    = '';
        panel.style.bottom = '0';
        panel.style.maxHeight = Math.max(mSpaceBelow, window.innerHeight * 0.28) + 'px';
      } else {
        // Card is in lower half — panel anchors to top (top-sheet style)
        panel.classList.remove('mobile-sheet');
        panel.classList.add('mobile-sheet-top');
        panel.style.bottom = '';
        panel.style.top    = HEADER_M + 'px';
        panel.style.maxHeight = Math.max(mSpaceAbove, window.innerHeight * 0.28) + 'px';
      }
    } else {
      panel.classList.add('mobile-sheet');
      panel.classList.remove('mobile-sheet-top');
      panel.style.top       = '';
      panel.style.bottom    = '0';
      panel.style.maxHeight = '52vh';
    }
    return;
  }

  // ── Desktop: smart above/below positioning ───────────────────
  panel.classList.remove('mobile-sheet');
  // Restore desktop defaults that mobile may have overridden
  panel.style.left      = '50%';
  panel.style.right     = '';
  panel.style.transform = 'translateX(-50%)';
  panel.style.width     = '';
  panel.style.maxWidth  = '';

  const card     = _introHighlightedCard;
  const GAP      = 16;
  const HEADER_H = 68;

  if (!card) {
    panel.style.top    = '';
    panel.style.bottom = '1.25rem';
    return;
  }

  const rect   = card.getBoundingClientRect();
  const viewH  = window.innerHeight;
  const panelH = panel.offsetHeight || 260;

  const spaceBelow = viewH - rect.bottom - GAP * 2;
  const spaceAbove = rect.top - HEADER_H - GAP;

  if (spaceBelow >= panelH || spaceBelow >= spaceAbove) {
    // ① Enough room below — sit directly under the card
    panel.style.top       = (rect.bottom + GAP) + 'px';
    panel.style.bottom    = '';
    panel.style.maxHeight = spaceBelow + 'px';
  } else if (spaceAbove >= panelH) {
    // ② Not enough below but enough above — float above the card
    panel.style.top       = '';
    panel.style.bottom    = (viewH - rect.top + GAP) + 'px';
    panel.style.maxHeight = spaceAbove + 'px';
  } else {
    // ③ Tight viewport — just below the header, cap height
    panel.style.top       = HEADER_H + 'px';
    panel.style.bottom    = '';
    panel.style.maxHeight = (rect.top - HEADER_H - GAP) + 'px';
  }
}

function _introHideTrackerPanel() {
  const panel = document.getElementById('introTrackerPanel');
  if (panel) panel.classList.add('hidden');
}

/* ─── Header highlight (slide 0) ─────────────────────────────────────────── */

function _introShowHeaderHighlight() {
  const pill   = document.getElementById('userPill');
  const toggle = document.getElementById('themeToggle');
  const ring   = document.getElementById('introHighlightRing');
  const callout= document.getElementById('introHeaderCallout');

  if (pill && toggle && ring) {
    const pr = pill.getBoundingClientRect();
    const tr = toggle.getBoundingClientRect();
    const ringTop    = Math.min(pr.top,    tr.top)    - 6;
    const ringLeft   = Math.min(pr.left,   tr.left)   - 6;
    const ringRight  = Math.max(pr.right,  tr.right)  + 6;
    const ringBottom = Math.max(pr.bottom, tr.bottom) + 6;

    ring.style.left         = ringLeft + 'px';
    ring.style.top          = ringTop  + 'px';
    ring.style.width        = (ringRight - ringLeft) + 'px';
    ring.style.height       = (ringBottom - ringTop) + 'px';
    ring.style.borderRadius = '30px';
    ring.classList.remove('hidden');

    // Anchor callout to ring's actual bottom edge — never covered by the header
    if (callout) {
      callout.style.top = (ringBottom + 8) + 'px';
      callout.classList.remove('hidden');
    }
  }
}

function _introHideHeaderHighlight() {
  const ring   = document.getElementById('introHighlightRing');
  const callout= document.getElementById('introHeaderCallout');
  if (ring)    ring.classList.add('hidden');
  if (callout) callout.classList.add('hidden');
}

/* ─── Shared helpers ─────────────────────────────────────────────────────── */

/** Generate step-dot HTML for the current step */
function _introDotHtml() {
  return INTRO_SLIDES.map((_, i) =>
    `<div class="intro-dot${i === _introStep ? ' active' : ''}"></div>`
  ).join('');
}

/** Wire up the three nav buttons (prev / next / done) for a given slide */
function _introSetNavBtns(prevId, nextId, doneId, isFirst, isLast) {
  const prevBtn = document.getElementById(prevId);
  const nextBtn = document.getElementById(nextId);
  const doneBtn = document.getElementById(doneId);
  if (prevBtn) prevBtn.style.visibility = isFirst ? 'hidden' : 'visible';
  if (nextBtn) nextBtn.style.display    = isLast  ? 'none'   : '';
  if (doneBtn) doneBtn.style.display    = isLast  ? ''       : 'none';
}

// Reposition the tracker panel and ring whenever the viewport is resized
window.addEventListener('resize', function() {
  const overlay = document.getElementById('introOverlay');
  if (!overlay || overlay.classList.contains('hidden')) return;

  if (_introHighlightedCard) {
    // Re-measure card position after layout shift
    const ring = document.getElementById('introHighlightRing');
    if (ring && !ring.classList.contains('hidden')) {
      const r = _introHighlightedCard.getBoundingClientRect();
      ring.style.left   = (r.left   - 7) + 'px';
      ring.style.top    = (r.top    - 7) + 'px';
      ring.style.width  = (r.width  + 14) + 'px';
      ring.style.height = (r.height + 14) + 'px';
    }
    _introPositionTrackerPanel();
  } else {
    // Slide 0 — re-anchor the header callout
    _introShowHeaderHighlight();
  }
});

/* ── Home screen data loader ────────────────────────────────────────────────
   Shown while Firebase data is being fetched on initial load.
   hideHomeLoader() is called from sync.js once syncLoadConfig() completes. */
let _homeLoaderTimer = null;

function showHomeLoader() {
  const el = document.getElementById('homeLoader');
  if (!el) return;
  el.classList.remove('hidden', 'home-loader-fadeout');
  // Safety valve: always hide after 12 s regardless of sync status
  clearTimeout(_homeLoaderTimer);
  _homeLoaderTimer = setTimeout(hideHomeLoader, 12000);
}

function hideHomeLoader() {
  clearTimeout(_homeLoaderTimer);
  _homeLoaderTimer = null;
  const el = document.getElementById('homeLoader');
  if (!el || el.classList.contains('hidden')) return;
  el.classList.add('home-loader-fadeout');
  setTimeout(function() {
    el.classList.add('hidden');
    el.classList.remove('home-loader-fadeout');
  }, 350);
}

/* ── Live-fetch dot helper ──────────────────────────────────────────────────
   Shows/hides the orange pulsing dot on the Total Investments / Current Value
   cards across all three screens while live price data is being fetched. */
function setInvLiveDot(show) {
  ['invLoadDotHome', 'invLoadDotPf', 'invLoadDotInv'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.style.display = show ? 'block' : 'none';
  });
}

/* ── Browser back-button support ────────────────────────────────────────────
   Each tracker navigation pushes a history state; popstate fires when the
   user presses the browser/device back button and routes back appropriately. */
window.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeNavDrawer();
});

window.addEventListener('popstate', function(e) {
  closeNavDrawer();
  var s = e.state && e.state.screen;
  if (s === 'loans') {
    if (typeof backToLoanList === 'function') backToLoanList();
  } else if (s === 'lifestyle') {
    goToLifestyle();
  } else {
    goToHome();
  }
});
