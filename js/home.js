/* ============================================================
   home.js — Dashboard / home screen logic
   FinResolver · finresolver.in
   ============================================================ */

/** Navigate from home → tracker */
function goToTracker() {
  history.pushState({ screen: 'tracker' }, '');
  document.getElementById('homeScreen').style.display  = 'none';
  document.getElementById('appMain').style.display     = 'block';
  document.getElementById('btnBackHome').style.display = 'flex';

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
  document.getElementById('appMain').style.display     = 'none';
  document.getElementById('homeScreen').style.display  = 'block';
  document.getElementById('btnBackHome').style.display = 'none';

  // Hide tracker-only header controls on home screen
  const tc = document.getElementById('headerTrackerControls');
  if (tc) tc.style.display = 'none';

  // Hide all module screens
  ['loanScreen', 'loanDetailScreen', 'investmentScreen', 'portfolioScreen'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  if (typeof invStopAutoRefresh === 'function') invStopAutoRefresh();

  renderHomeDashboard();
}

/** Navigate home → portfolio overview */
function goToPortfolio() {
  history.pushState({ screen: 'portfolio' }, '');
  document.getElementById('homeScreen').style.display      = 'none';
  document.getElementById('portfolioScreen').style.display = 'block';
  document.getElementById('btnBackHome').style.display     = 'flex';

  const tc = document.getElementById('headerTrackerControls');
  if (tc) tc.style.display = 'none';

  renderPortfolioOverview();

  // Fetch fresh prices then re-render; reuse the same helper as the home screen.
  // If caches are already warm (user came from investment screen) this resolves instantly.
  pfFetchLivePricesAndRender();
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
    const raw = localStorage.getItem(`fr_data_${uid}_${y}_${m}`);
    if (raw) {
      const d = JSON.parse(raw);
      totalExp += sumArr(d.expense || []);
      monthsWithData++;
    }
  }
  const avgMonthlyExp = monthsWithData ? totalExp / monthsWithData : 0;
  const fireNumber    = avgMonthlyExp * 12 * 25;

  // YTD savings = Income − Expenses − Loan repayments
  let ytdInc = 0, ytdExp = 0, ytdLoan = 0;
  for (let m = 0; m <= mo; m++) {
    const raw = localStorage.getItem(`fr_data_${uid}_${yr}_${m}`);
    if (raw) {
      const d = JSON.parse(raw);
      ytdInc  += sumArr(d.income   || []);
      ytdExp  += sumArr(d.expense  || []);
      ytdLoan += sumArr(d.loan     || []);
    }
  }
  const ytdSavings = ytdInc - ytdExp - ytdLoan;

  // Total investment current value from fr_investments_{uid}
  // Uses live caches (invQuoteCache, goldPriceCache) when available, else cost basis
  let totalInvCurrentVal = 0;
  try {
    const invRaw = localStorage.getItem(`fr_investments_${uid}`);
    if (invRaw) {
      JSON.parse(invRaw).forEach(h => {
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
    }
  } catch(e) {}

  // Total loan outstanding balance from fr_loans_{uid}
  let totalLoanOutstanding = 0;
  try {
    const loanRaw = localStorage.getItem(`fr_loans_${uid}`);
    if (loanRaw) {
      const loans = JSON.parse(loanRaw);
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
    }
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

  // ── 1. Investment holdings ────────────────────────────────────
  let totalInvValue = 0;
  let holdings = [];
  try {
    const invRaw = localStorage.getItem(`fr_investments_${uid}`);
    if (invRaw) {
      holdings = JSON.parse(invRaw);
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
    }
  } catch(e) {}

  // ── 2. Cash balance ───────────────────────────────────────────
  const curBal = getMonthBalance(uid, yr, mo);

  // ── 3. Loan outstanding ───────────────────────────────────────
  let totalLoanOutstanding = 0;
  try {
    const loanRaw = localStorage.getItem(`fr_loans_${uid}`);
    if (loanRaw) {
      JSON.parse(loanRaw).forEach(loan => {
        if (loan.closed) return;
        let outstanding = Number(loan.principal || 0);
        (loan.payments || []).forEach(p => { outstanding -= Number(p.amount || 0); });
        if (typeof calcLoanStats === 'function') {
          try { outstanding = calcLoanStats(loan).outstanding; } catch(e) {}
        }
        if (outstanding > 0) totalLoanOutstanding += outstanding;
      });
    }
  } catch(e) {}

  const netWorth = totalInvValue + Math.max(0, curBal) - totalLoanOutstanding;

  // ── 4. YTD & rolling metrics ──────────────────────────────────
  let ytdInc = 0, ytdExp = 0, ytdLoan = 0;
  for (let m = 0; m <= mo; m++) {
    const raw = localStorage.getItem(`fr_data_${uid}_${yr}_${m}`);
    if (raw) {
      const d = JSON.parse(raw);
      ytdInc  += sumArr(d.income  || []);
      ytdExp  += sumArr(d.expense || []);
      ytdLoan += sumArr(d.loan    || []);
    }
  }
  let totalExp3m = 0, months3m = 0;
  for (let i = 0; i < 3; i++) {
    let m = mo - i, y = yr;
    if (m < 0) { m += 12; y--; }
    const raw = localStorage.getItem(`fr_data_${uid}_${y}_${m}`);
    if (raw) { totalExp3m += sumArr(JSON.parse(raw).expense || []); months3m++; }
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
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '700 13px Syne, sans-serif';
        ctx.fillStyle = '#e8edf5';
        ctx.fillText(totalInvValue > 0 ? fmt(totalInvValue) : '—', cx, cy - 9);
        ctx.font = '400 9px DM Mono, monospace';
        ctx.fillStyle = '#6b7a99';
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
  document.getElementById('loginScreen').style.display  = 'none';
  document.getElementById('appMain').style.display      = 'none';
  document.getElementById('homeScreen').style.display   = 'block';
  document.getElementById('btnBackHome').style.display  = 'none';

  // Hide ALL module screens so nothing bleeds through on login/logout
  ['loanScreen','loanDetailScreen','investmentScreen','portfolioScreen'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  // Stop investment auto-refresh if running
  if (typeof invStopAutoRefresh === 'function') invStopAutoRefresh();

  // Always hide tracker-only controls when on home screen
  const tc = document.getElementById('headerTrackerControls');
  if (tc) tc.style.display = 'none';

  renderHomeDashboard();

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

  let holdings = [];
  try {
    const raw = localStorage.getItem(`fr_investments_${uid}`);
    if (raw) holdings = JSON.parse(raw);
  } catch(e) { return; }

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
window.addEventListener('popstate', function(e) {
  var s = e.state && e.state.screen;
  if (s === 'loans') {
    // Popped from loanDetail back to loans → show the loan list
    if (typeof backToLoanList === 'function') backToLoanList();
  } else {
    // Popped back to home (or no state) from any tracker section
    goToHome();
  }
});
