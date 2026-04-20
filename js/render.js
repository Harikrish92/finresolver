/* ============================================================
   render.js — All DOM rendering: tables, checklist, summary, charts
   FinResolver · finresolver.in
   ============================================================ */

let pieChart, barChart, lineChart;

// ── Master render ────────────────────────────────────────────
function render() {
  // Guard: only render tracker UI when appMain is actually visible.
  // syncLoadData() can be called while the home screen is showing (on initial
  // auth or prefetch), which would crash trying to update tracker DOM elements
  // (charts on hidden canvases, null element refs, etc.).
  const appMain = document.getElementById('appMain');
  if (!appMain || appMain.style.display === 'none') return;

  renderSummary();
  renderTable('expense',    'expBody',  'amount-neg');
  renderTable('income',     'incBody',  'amount-pos');
  renderTable('investment', 'invBody',  'amount-inv');
  renderTable('loan',       'loanBody', 'amount-loan');
  renderChecklist();
  renderCharts();
  populateLoanTagSelect();
  if (typeof renderNotes         === 'function') renderNotes();
  if (typeof renderInsightsPanel === 'function') renderInsightsPanel();
}

// ── Summary cards ────────────────────────────────────────────
function renderSummary() {
  const init  = Number(data.initialAmount) || 0;
  const tInc  = sumArr(data.income);
  const tExp  = sumArr(data.expense);
  const tInv  = sumArr(data.investment);
  const tLoan = sumArr(data.loan);
  const bal   = init + tInc - tExp - tInv - tLoan;
  const done  = data.checklist.filter(c => c.done).length;

  document.getElementById('initialAmount').value = init || '';

  const balEl = document.getElementById('sumBalance');
  balEl.textContent   = fmt(bal);
  balEl.style.color   = bal >= 0 ? 'var(--accent)' : 'var(--accent2)';

  document.getElementById('sumExpense').textContent    = fmt(tExp);
  document.getElementById('sumIncome').textContent     = fmt(tInc);
  document.getElementById('sumInvestment').textContent = fmt(tInv);
  document.getElementById('sumLoan').textContent       = fmt(tLoan);
  document.getElementById('sumChecklist').textContent  = `${done}/${data.checklist.length}`;

  document.getElementById('expTotal').textContent  = fmt(tExp);
  document.getElementById('incTotal').textContent  = fmt(tInc);
  document.getElementById('invTotal').textContent  = fmt(tInv);
  document.getElementById('loanTotal').textContent = fmt(tLoan);

  const keys  = ['expense','income','investment','loan'];
  const badges = ['expBadge','incBadge','invBadge','loanBadge'];
  keys.forEach((k, i) => document.getElementById(badges[i]).textContent = data[k].length);
}

// ── Data tables ──────────────────────────────────────────────
function renderTable(type, bodyId, amtClass) {
  const tbody = document.getElementById(bodyId);
  const rows  = data[type];

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty">No entries yet</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map((r, i) => {
    const loanTag = (type === 'loan' && r.loanId && r.loanName)
      ? `<br><span class="loan-link-tag" onclick="navigateToLoan('${r.loanId}')" title="View in Loan Tracker">🏷 ${escHtml(r.loanName)}</span>`
      : '';
    return `
    <tr id="tr-${type}-${i}">
      <td>${escHtml(r.desc)}${r.date ? `<br><span class="row-date">${fmtDate(r.date)}</span>` : ''}${loanTag}</td>
      <td class="${amtClass}">${fmt(r.amount)}</td>
      <td>
        <button class="btn-row-edit" onclick="startEditRow('${type}',${i})" title="Edit entry">✏️</button>
      </td>
      <td>
        <button class="btn-del" onclick="delRow('${type}',${i})" title="Delete entry">✕</button>
      </td>
    </tr>`;
  }).join('');
}

// ── Loan tag select population ───────────────────────────────
function populateLoanTagSelect() {
  const sel = document.getElementById('loanTagSelect');
  if (!sel) return;
  const loans = (typeof loansData !== 'undefined') ? loansData : [];
  const current = sel.value; // preserve selection if already chosen
  sel.innerHTML = `<option value="">🏷 Link to loan\u2026</option>` +
    loans.map(l => `<option value="${l.id}"${l.id === current ? ' selected' : ''}>${escHtml(l.name)}</option>`).join('');
}

// ── Checklist ────────────────────────────────────────────────
function renderChecklist() {
  document.getElementById('checklistGrid').innerHTML = data.checklist.map((c, i) => `
    <div class="check-item ${c.done ? 'done' : ''}" onclick="toggleCheck(${i})">
      <div class="check-box">${c.done ? '✓' : ''}</div>
      <span class="check-label">${escHtml(c.label)}</span>
      <button class="btn-del check-del"
        onclick="event.stopPropagation(); delCheck(${i})"
        title="Remove item">✕</button>
    </div>`).join('');
}

// ── Charts ───────────────────────────────────────────────────
function renderCharts() {
  const tExp  = sumArr(data.expense);
  const tInc  = sumArr(data.income);
  const tInv  = sumArr(data.investment);
  const tLoan = sumArr(data.loan);

  // Use theme-aware colours if theme.js is loaded, else fall back to dark defaults
  const ct = (typeof getChartTheme === 'function') ? getChartTheme() : {
    grid: 'rgba(255,255,255,.04)', tick: '#6b7a99',
    accent: '#00e5a0', areaFill: 'rgba(0,229,160,.07)',
  };

  const chartBase = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: ct.tick, font: { family: 'DM Mono', size: 11 } } }
    }
  };

  // Accent colours are the same in both themes (only slightly adjusted via CSS vars)
  const PIE_COLORS = ['#ff6b6b','#00e5a0','#4dabf7','#ffd166'];
  const BAR_COLORS = ['rgba(0,229,160,.75)','rgba(255,107,107,.75)','rgba(77,171,247,.75)','rgba(255,209,102,.75)'];

  // Doughnut breakdown
  if (pieChart) pieChart.destroy();
  pieChart = new Chart(document.getElementById('pieChart'), {
    type: 'doughnut',
    data: {
      labels: ['Expenses', 'Income', 'Investments', 'Loans'],
      datasets: [{
        data: [tExp, tInc, tInv, tLoan],
        backgroundColor: PIE_COLORS,
        borderWidth: 0, hoverOffset: 8
      }]
    },
    options: { ...chartBase, cutout: '68%' }
  });

  // Bar: income vs expenses
  if (barChart) barChart.destroy();
  barChart = new Chart(document.getElementById('barChart'), {
    type: 'bar',
    data: {
      labels: ['Income','Expenses','Investments','Loans'],
      datasets: [{
        data: [tInc, tExp, tInv, tLoan],
        backgroundColor: BAR_COLORS,
        borderRadius: 6
      }]
    },
    options: {
      ...chartBase,
      plugins: { ...chartBase.plugins, legend: { display: false } },
      scales: {
        x: { ticks: { color: ct.tick, font:{ family:'DM Mono', size:11 } }, grid: { color: ct.grid } },
        y: { ticks: { color: ct.tick, font:{ family:'DM Mono', size:11 }, callback: v => '₹'+Number(v).toLocaleString('en-IN') }, grid: { color: ct.grid } }
      }
    }
  });

  // Line: 3-month balance trend (for this user)
  const uid = currentUser?.uid || 'guest';
  const labels   = [];
  const balances = [];
  const yr = Number(document.getElementById('yearSelect').value);
  const mo = Number(document.getElementById('monthSelect').value);

  for (let i = 2; i >= 0; i--) {
    let m2 = mo - i, y2 = yr;
    if (m2 < 0) { m2 += 12; y2--; }
    labels.push(MONTHS[m2].slice(0,3) + ' ' + String(y2).slice(2));
    balances.push(getMonthBalance(uid, y2, m2));
  }

  if (lineChart) lineChart.destroy();
  lineChart = new Chart(document.getElementById('lineChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data: balances,
        borderColor: ct.accent,
        backgroundColor: ct.areaFill,
        borderWidth: 2, pointRadius: 4, pointBackgroundColor: ct.accent,
        fill: true, tension: .4
      }]
    },
    options: {
      ...chartBase,
      plugins: { ...chartBase.plugins, legend: { display: false } },
      scales: {
        x: { ticks: { color: ct.tick, font:{ family:'DM Mono', size:11 } }, grid: { color: ct.grid } },
        y: { ticks: { color: ct.tick, font:{ family:'DM Mono', size:11 }, callback: v => '₹'+Number(v).toLocaleString('en-IN') }, grid: { color: ct.grid } }
      }
    }
  });
}
