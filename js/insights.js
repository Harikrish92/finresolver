/* ============================================================
   insights.js — FIRE number, pattern analysis, smart fill
   FinResolver · finresolver.in
   ============================================================ */

/* ══════════════════════════════════════════════════════════
   HELPERS — read past month data
══════════════════════════════════════════════════════════ */

/** Get raw data object for any month (current user) */
function getPastMonthData(offsetMonths) {
  const uid   = (typeof fbAuth !== 'undefined' && fbAuth?.currentUser?.uid)
                ? fbAuth.currentUser.uid : (currentUser?.uid || 'guest');
  let year  = Number(document.getElementById('yearSelect').value);
  let month = Number(document.getElementById('monthSelect').value);

  month -= offsetMonths;
  while (month < 0) { month += 12; year--; }

  const raw = localStorage.getItem(`fr_data_${uid}_${year}_${month}`);
  return raw ? JSON.parse(raw) : null;
}

/** Get last N months of data (not including current month) */
function getLastNMonths(n) {
  const months = [];
  for (let i = 1; i <= n; i++) {
    const d = getPastMonthData(i);
    if (d) months.push(d);
  }
  return months;
}

/* ══════════════════════════════════════════════════════════
   FIRE NUMBER
   Formula: monthly expense (excl. loans) × 12 × 25
   Based on 3-month average to smooth out anomalies
══════════════════════════════════════════════════════════ */
function renderFIRE() {
  const past = getLastNMonths(3);
  // Include current month too
  const allMonths = [data, ...past].filter(Boolean);

  const monthlyExpenses = allMonths.map(m => sumArr(m.expense || []));
  const avgMonthlyExp = monthlyExpenses.length
    ? monthlyExpenses.reduce((a, b) => a + b, 0) / monthlyExpenses.length
    : sumArr(data.expense);

  const annualExp  = avgMonthlyExp * 12;
  const fireNumber = annualExp * 25;

  // Current net worth estimate (sum of all month balances for context)
  const uid = (typeof fbAuth !== 'undefined' && fbAuth?.currentUser?.uid)
              ? fbAuth.currentUser.uid : (currentUser?.uid || 'guest');
  const yr = Number(document.getElementById('yearSelect').value);
  const mo = Number(document.getElementById('monthSelect').value);
  const currentBalance = getMonthBalance(uid, yr, mo);

  const progress = fireNumber > 0 ? Math.min((currentBalance / fireNumber) * 100, 100) : 0;
  const monthsOfData = allMonths.length;

  document.getElementById('fireNumber').textContent     = fmtCrore(fireNumber);
  const fn2 = document.getElementById('fireNumber2');
  if (fn2) fn2.textContent = fmtCrore(fireNumber);
  document.getElementById('fireAnnualExp').textContent  = fmt(annualExp);
  document.getElementById('fireMonthlyExp').textContent = fmt(avgMonthlyExp);
  document.getElementById('fireDataMonths').textContent = monthsOfData + (monthsOfData === 1 ? ' month' : ' months');

  // Progress bar
  const bar = document.getElementById('fireProgressBar');
  if (bar) {
    bar.style.width = progress.toFixed(1) + '%';
    bar.title = `${progress.toFixed(1)}% of FIRE number`;
  }
  const pct = document.getElementById('fireProgressPct');
  if (pct) pct.textContent = progress.toFixed(1) + '%';
}

/** Format large numbers as ₹X.XX Cr or ₹X.XX L */
function fmtCrore(n) {
  if (n >= 1e7)  return '₹' + (n / 1e7).toFixed(2) + ' Cr';
  if (n >= 1e5)  return '₹' + (n / 1e5).toFixed(2) + ' L';
  return fmt(n);
}

/* ══════════════════════════════════════════════════════════
   PATTERN INSIGHTS
   Analyses last 3 months vs current month
══════════════════════════════════════════════════════════ */
function renderInsights() {
  const past = getLastNMonths(3);
  const container = document.getElementById('insightsList');
  if (!container) return;

  if (!past.length) {
    container.innerHTML = `<div class="insight-empty">Add data for previous months to see patterns</div>`;
    return;
  }

  const insights = [];

  // ── Expense trend ──
  const pastExpAvg = past.reduce((s, m) => s + sumArr(m.expense || []), 0) / past.length;
  const curExp     = sumArr(data.expense);
  if (pastExpAvg > 0 && curExp > 0) {
    const delta = ((curExp - pastExpAvg) / pastExpAvg) * 100;
    if (delta > 15)
      insights.push({ icon: '📈', text: `Expenses are <strong>${delta.toFixed(0)}% higher</strong> than your ${past.length}-month avg of ${fmt(pastExpAvg)}` });
    else if (delta < -15)
      insights.push({ icon: '📉', text: `Expenses are <strong>${Math.abs(delta).toFixed(0)}% lower</strong> than your ${past.length}-month avg — great discipline!` });
    else
      insights.push({ icon: '✅', text: `Expenses are <strong>on track</strong> — within 15% of your ${past.length}-month avg of ${fmt(pastExpAvg)}` });
  }

  // ── Savings rate ──
  const curInc  = sumArr(data.income);
  const curSave = curInc - curExp;
  if (curInc > 0) {
    const saveRate = (curSave / curInc) * 100;
    if (saveRate >= 30)
      insights.push({ icon: '💪', text: `Savings rate this month: <strong>${saveRate.toFixed(0)}%</strong> — excellent! Aim for 30%+ consistently` });
    else if (saveRate >= 0)
      insights.push({ icon: '💡', text: `Savings rate: <strong>${saveRate.toFixed(0)}%</strong> — try to reach 30% to accelerate FIRE progress` });
    else
      insights.push({ icon: '⚠️', text: `Spending exceeds income this month by <strong>${fmt(Math.abs(curSave))}</strong> — review discretionary expenses` });
  }

  // ── Investment consistency ──
  const investedMonths = past.filter(m => sumArr(m.investment || []) > 0).length;
  const curInv = sumArr(data.investment);
  if (past.length >= 2) {
    if (investedMonths === past.length && curInv > 0)
      insights.push({ icon: '🎯', text: `<strong>Consistent investor</strong> — you've invested every month for the past ${past.length} months` });
    else if (investedMonths === 0 && curInv === 0)
      insights.push({ icon: '💰', text: `No investments recorded in the past ${past.length} months — consider starting a SIP` });
  }

  // ── Top expense category ──
  const allExpenses = data.expense || [];
  if (allExpenses.length >= 3) {
    const sorted = [...allExpenses].sort((a, b) => b.amount - a.amount);
    const top = sorted[0];
    const topPct = curExp > 0 ? ((top.amount / curExp) * 100).toFixed(0) : 0;
    insights.push({ icon: '🔍', text: `Biggest expense: <strong>${escHtml(top.desc)}</strong> at ${fmt(top.amount)} (${topPct}% of total)` });
  }

  // ── Recurring loans ──
  const pastLoanAvg = past.reduce((s, m) => s + sumArr(m.loan || []), 0) / past.length;
  const curLoan = sumArr(data.loan);
  if (pastLoanAvg > 0) {
    const loanDelta = ((curLoan - pastLoanAvg) / pastLoanAvg) * 100;
    if (loanDelta < -20)
      insights.push({ icon: '🏆', text: `Loan payments are down <strong>${Math.abs(loanDelta).toFixed(0)}%</strong> vs avg — debt reducing!` });
  }

  if (!insights.length) {
    container.innerHTML = `<div class="insight-empty">Keep adding data — insights will appear after a few months</div>`;
    return;
  }

  container.innerHTML = insights.slice(0, 5).map(i => `
    <div class="insight-item">
      <span class="insight-icon">${i.icon}</span>
      <span class="insight-text">${i.text}</span>
    </div>`).join('');
}

/* ══════════════════════════════════════════════════════════
   SMART FILL
   Finds items that appeared in 2+ of last 3 months
══════════════════════════════════════════════════════════ */
let smartFillSuggestions = { expense: [], income: [], investment: [], loan: [] };
let smartFillSelected    = new Set();

function buildSmartFillSuggestions() {
  const past = getLastNMonths(3);
  if (!past.length) return;

  const types = ['expense', 'income', 'investment', 'loan'];
  const result = {};

  types.forEach(type => {
    // Count how many months each description appeared in
    const freq = {};
    const amounts = {};
    past.forEach(m => {
      const seen = new Set();
      (m[type] || []).forEach(row => {
        const key = row.desc.trim().toLowerCase();
        if (!seen.has(key)) {
          freq[key]    = (freq[key] || 0) + 1;
          amounts[key] = amounts[key] || [];
          amounts[key].push(row.amount);
          seen.add(key);
        }
      });
    });

    // Keep items that appeared in 2+ months
    const recurring = Object.entries(freq)
      .filter(([, count]) => count >= 2)
      .map(([key]) => {
        // Find the canonical description (original case) from most recent month
        let desc = key;
        for (const m of past) {
          const found = (m[type] || []).find(r => r.desc.trim().toLowerCase() === key);
          if (found) { desc = found.desc; break; }
        }
        const avgAmt = amounts[key].reduce((a, b) => a + b, 0) / amounts[key].length;
        return { desc, amount: Math.round(avgAmt), freq: freq[key] };
      })
      .sort((a, b) => b.amount - a.amount);

    // Filter out items already in this month
    const existing = new Set((data[type] || []).map(r => r.desc.trim().toLowerCase()));
    result[type] = recurring.filter(r => !existing.has(r.desc.trim().toLowerCase()));
  });

  smartFillSuggestions = result;
}

function openSmartFill() {
  buildSmartFillSuggestions();
  smartFillSelected = new Set();

  const body   = document.getElementById('smartFillBody');
  const types  = { expense: '💸 Expenses', income: '💰 Income', investment: '📈 Investments', loan: '🏦 Loans' };
  const colors = { expense: 'amount-neg', income: 'amount-pos', investment: 'amount-inv', loan: 'amount-loan' };

  let html = '';
  let total = 0;

  Object.entries(types).forEach(([type, label]) => {
    const items = smartFillSuggestions[type];
    if (!items.length) return;
    total += items.length;

    html += `<div class="smart-section-title">${label}</div>`;
    items.forEach((item, idx) => {
      const id = `${type}_${idx}`;
      html += `
        <div class="smart-item" id="sfi_${id}" onclick="toggleSmartItem('${type}', ${idx}, '${id}')">
          <div class="smart-item-check" id="sfck_${id}"></div>
          <span class="smart-item-desc">${escHtml(item.desc)}</span>
          <span class="smart-item-meta">${item.freq}× last ${getLastNMonths(3).length}mo</span>
          <span class="smart-item-amt ${colors[type]}">${fmt(item.amount)}</span>
        </div>`;
    });
  });

  if (!total) {
    html = `<div class="insight-empty" style="padding:2rem 0">
      No recurring items found yet.<br/>
      <span style="font-size:.7rem;opacity:.6">Items that appear in 2+ of the last 3 months will show here.</span>
    </div>`;
  }

  body.innerHTML = html;
  document.getElementById('smartFillCount').textContent = `${total} suggestion${total !== 1 ? 's' : ''}`;
  document.getElementById('smartFillModal').classList.remove('hidden');
}

function toggleSmartItem(type, idx, id) {
  const key = `${type}_${idx}`;
  const el  = document.getElementById(`sfi_${id}`);
  const ck  = document.getElementById(`sfck_${id}`);

  if (smartFillSelected.has(key)) {
    smartFillSelected.delete(key);
    el.classList.remove('selected');
    ck.textContent = '';
  } else {
    smartFillSelected.add(key);
    el.classList.add('selected');
    ck.textContent = '✓';
  }
  document.getElementById('smartFillApplyBtn').disabled = smartFillSelected.size === 0;
}

function selectAllSmartFill() {
  const types = ['expense', 'income', 'investment', 'loan'];
  types.forEach(type => {
    smartFillSuggestions[type].forEach((_, idx) => {
      const id  = `${type}_${idx}`;
      const key = `${type}_${idx}`;
      smartFillSelected.add(key);
      document.getElementById(`sfi_${id}`)?.classList.add('selected');
      const ck = document.getElementById(`sfck_${id}`);
      if (ck) ck.textContent = '✓';
    });
  });
  document.getElementById('smartFillApplyBtn').disabled = smartFillSelected.size === 0;
}

function applySmartFill() {
  if (!smartFillSelected.size) return;
  let added = 0;

  smartFillSelected.forEach(key => {
    const [type, idxStr] = key.split('_');
    const idx  = Number(idxStr);
    const item = smartFillSuggestions[type]?.[idx];
    if (!item) return;
    data[type].push({ desc: item.desc, amount: item.amount });
    added++;
  });

  saveData(); render();
  closeSmartFill();
  showToast(`Added ${added} recurring item${added !== 1 ? 's' : ''} ✓`, 'success');
  renderFIRE();
  renderInsights();
}

function closeSmartFill() {
  document.getElementById('smartFillModal').classList.add('hidden');
}

/* ══════════════════════════════════════════════════════════
   INIT — called from render()
══════════════════════════════════════════════════════════ */
function renderInsightsPanel() {
  renderFIRE();
  renderInsights();
}
