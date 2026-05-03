// ── DATE DISPLAY HELPER ───────────────────────────────────────────────────────
function fmtDisplayDate(dateStr) {
  if (!dateStr) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const d = new Date(dateStr + 'T00:00:00');
    return isNaN(d) ? dateStr : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }
  return dateStr;
}

// ── SCREEN ROUTER ─────────────────────────────────────────────────────────────
function renderScreen(screen, el) {
  switch (screen) {
    case 'dashboard':   renderDashboard(el);   break;
    case 'monthly':     renderMonthly(el);     break;
    case 'investments': renderInvestments(el); break;
    case 'loans':       renderLoans(el);       break;
    case 'loan-detail': renderLoanDetail(el);  break;
    case 'portfolio':   renderPortfolio(el);   break;
    case 'lifestyle':   renderLifestyle(el);   break;
    default: el.innerHTML = '<p style="color:var(--t3);padding:40px">Screen not found.</p>';
  }
}

function _buildInsights(income, expenses, investments, loans, savRate) {
  const m = APP.monthly;
  const insightList = [];

  if (income === 0 && expenses === 0) {
    insightList.push(insight('ℹ️','a10','accent', 'Add income and expenses to see personalized insights here.'));
    return insightList.join('');
  }

  if (income > 0) {
    insightList.push(insight('💰','a10','accent',
      `Savings rate <strong>${savRate}%</strong> this month — ${savRate >= 20 ? 'exceeding' : savRate >= 10 ? 'approaching' : 'below'} the 20% target.`));
  }

  if (expenses > 0 && m.expenses.length > 0) {
    const top = m.expenses.reduce((a, b) => b.amount > a.amount ? b : a, m.expenses[0]);
    insightList.push(insight('📊','bl10','blue',
      `<strong>${top.desc}</strong> is your largest expense this month at ${fmt(top.amount)}.`));
  }

  if (investments > 0) {
    insightList.push(insight('📈','a10','accent',
      `You invested <strong>${fmt(investments, true)}</strong> this month — keep the SIP discipline going.`));
  }

  if (APP.loans.length > 0) {
    const totalEMI = APP.loans.reduce((a, l) => a + loanEMI(l), 0);
    insightList.push(insight('🏦','p10','purple',
      `<strong>${APP.loans.length} active loan${APP.loans.length > 1 ? 's' : ''}</strong> · total EMI ${fmt(totalEMI)}/month.`));
  }

  const { balance } = getMonthlyTotals();
  if (balance < 0) {
    insightList.push(insight('⚠️','r10','red',
      `<strong>Negative balance this month.</strong> Review your expenses to stay on track.`));
  }

  return insightList.join('') || insight('ℹ️','a10','accent', 'No insights yet — add transactions to get started.');
}

// ── DASHBOARD ─────────────────────────────────────────────────────────────────
function renderDashboard(el) {
  const { totalInvested, currentValue, pnl, pnlPct, totalDebt, netWorth, cashBalance } = getPortfolioStats();
  const { income, expenses, investments, loans, balance } = getMonthlyTotals();
  const savRate = income ? Math.round((income - expenses - loans) / income * 100) : 0;
  const outstanding = APP.loans.reduce((a, l) => a + loanOutstanding(l), 0);
  const totalEMI    = APP.loans.reduce((a, l) => a + loanEMI(l), 0);
  const avgMonthlyExp = APP.history.length
    ? APP.history.reduce((a,h)=>a+h.expenses,0)/APP.history.length
    : expenses || 0;
  const fireNum = avgMonthlyExp * 12 * 25;
  const firePct = fireNum > 0 ? Math.min(100, Math.round(currentValue / fireNum * 100)) : 0;
  const h = new Date().getHours();
  const greeting = h<12 ? 'Good morning' : h<18 ? 'Good afternoon' : 'Good evening';

  el.innerHTML = `
    <div class="sh">
      <div class="sh-l">
        <div class="sh-title">${greeting}, ${APP.user.name.split(' ')[0]} 👋</div>
        <div class="sh-sub">Financial snapshot · ${monthName(APP.monthly.month)} ${APP.monthly.year}</div>
      </div>
      <div class="sh-r">
        <div class="sync"><div class="sync-dot"></div>Synced just now</div>
      </div>
    </div>

    <div class="fire-banner">
      <div>
        <div class="fire-label">Net Worth</div>
        <div style="font-family:var(--font-d);font-weight:800;font-size:34px;color:var(--accent);line-height:1;margin:6px 0 4px">${fmt(netWorth,true)}</div>
        <div class="row" style="gap:6px;font-size:12px;color:var(--t2)">
          ${ic(pnl>=0?'trending':'trendingDn',13)}
          <span class="${pnl>=0?'text-pos':'text-neg'}">${fmtPct(pnlPct)} portfolio return</span>
          <span style="color:var(--t3)">·</span>
          <span class="text-muted">YTD savings ${fmt(income-expenses-loans,true)}</span>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px 28px">
        ${miniStat('Total Assets',    fmt(currentValue+cashBalance,true), 'text-pos')}
        ${miniStat('Total Debt',      fmt(totalDebt,true),                'text-neg')}
        ${miniStat('Cash Balance',    fmt(cashBalance,true),              '')}
        ${miniStat('Invested',        fmt(totalInvested,true),            '')}
        ${miniStat('Total P&L',       (pnl>=0?'+':'')+fmt(Math.abs(pnl),true), pnl>=0?'text-pos':'text-neg')}
        ${miniStat('FIRE Progress',   firePct+'%',                        'text-gld')}
      </div>
    </div>

    <div class="dash-grid">
      ${dashCard('monthly',    'calendar','icon-green',  'Monthly Tracker',     fmt(balance,true),    'Balance this month',   savRate+'% savings rate',    savRate>=20?'badge-up':savRate>=10?'badge-neu':'badge-dn')}
      ${dashCard('investments','trending','icon-blue',   'Investment Portfolio', fmt(currentValue,true),'Current value',       (pnl>=0?'+':'')+fmt(Math.abs(pnl),true)+' P&L', pnl>=0?'badge-up':'badge-dn', true)}
      ${dashCard('loans',      'card',    'icon-red',    'Loan Tracker',        fmt(outstanding,true), 'Outstanding balance',  fmt(totalEMI,true)+'/mo EMI', 'badge-neu')}
      ${dashCard('portfolio',  'target',  'icon-gold',   'Portfolio & FIRE',    fmt(fireNum,true),    'FIRE number',           firePct+'% funded',           'badge-up')}
    </div>

    <div class="g-2">
      <div class="card">
        <div class="card-hd">
          <div class="card-title">${ic('zap',14)} Smart Insights</div>
          <button class="btn btn-ghost btn-sm" onclick="openSmartFill()">${ic('zap',12)} Smart Fill</button>
        </div>
        <div class="card-body col" style="gap:7px">
          ${_buildInsights(income, expenses, investments, loans, savRate)}
        </div>
      </div>
      <div class="card">
        <div class="card-hd">
          <div class="card-title">${ic('bar',14)} Income vs Expenses</div>
          <span style="font-size:11px;color:var(--t3)">Last 4 months</span>
        </div>
        <div class="card-body">
          <div class="chart-wrap"><canvas id="dash-chart"></canvas></div>
        </div>
      </div>
    </div>`;

  setTimeout(() => {
    const histLabels = APP.history.length ? APP.history.map(h => h.month) : [monthName(APP.monthly.month)];
    const histIncome   = APP.history.length ? APP.history.map(h=>h.income)   : [income];
    const histExpenses = APP.history.length ? APP.history.map(h=>h.expenses) : [expenses];
    makeChart('dash-chart', {
      type: 'bar',
      data: {
        labels: histLabels,
        datasets: [
          { label:'Income',   data:histIncome,   backgroundColor:'rgba(0,229,160,.55)',  borderRadius:5 },
          { label:'Expenses', data:histExpenses, backgroundColor:'rgba(255,92,122,.5)', borderRadius:5 },
        ]
      },
      options: { scales: { y: { ticks: { callback: v=>'₹'+(v/1000)+'K' } } } }
    });
  }, 80);
}

function miniStat(label, val, cls) {
  return `<div>
    <div style="font-size:10.5px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--t3);margin-bottom:3px">${label}</div>
    <div style="font-family:var(--font-d);font-weight:700;font-size:16px;line-height:1" class="${cls}">${val}</div>
  </div>`;
}

function dashCard(screen, iconKey, iconCls, label, val, sub, badge, badgeCls, live=false) {
  return `<div class="dash-card" onclick="navigate('${screen}')">
    <div class="row" style="justify-content:space-between">
      <div class="dash-icon ${iconCls}">${ic(iconKey,18)}</div>
      <div class="row" style="gap:6px">
        ${live?'<div class="live"><div class="live-dot"></div>LIVE</div>':''}
        ${ic('arrowRt',14)}
      </div>
    </div>
    <div>
      <div class="dash-lbl">${label}</div>
      <div class="dash-val">${val}</div>
      <div class="dash-sub">${sub}</div>
    </div>
    <span class="stat-badge ${badgeCls}">${badge}</span>
  </div>`;
}

function insight(emoji, bgKey, colorKey, html) {
  return `<div class="insight">
    <div class="insight-ico" style="background:var(--${bgKey});color:var(--${colorKey})">${emoji}</div>
    <div>${html}</div>
  </div>`;
}

// ── MONTHLY TRACKER ───────────────────────────────────────────────────────────
function renderMonthly(el) {
  const { income, expenses, investments, loans, balance } = getMonthlyTotals();
  const done  = APP.monthly.checklist.filter(c=>c.done).length;
  const total = APP.monthly.checklist.length;

  el.innerHTML = `
    <div class="sh">
      <div class="sh-l">
        <div class="sh-title">Monthly Tracker</div>
        <div class="sh-sub">${monthName(APP.monthly.month)} ${APP.monthly.year}</div>
      </div>
      <div class="sh-r">
        <select class="sel" style="width:auto" onchange="APP.monthly.month=parseInt(this.value);navigate('monthly')">
          ${[1,2,3,4,5,6,7,8,9,10,11,12].map(m=>`<option value="${m}"${m===APP.monthly.month?' selected':''}>${monthName(m)}</option>`).join('')}
        </select>
        <select class="sel" style="width:auto" onchange="APP.monthly.year=parseInt(this.value);navigate('monthly')">
          ${(()=>{const cy=new Date().getFullYear();const ys=[];for(let y=cy-3;y<=cy+1;y++)ys.push(y);return ys;})().map(y=>`<option value="${y}"${y===APP.monthly.year?' selected':''}>${y}</option>`).join('')}
        </select>
        <button class="btn btn-secondary btn-sm" onclick="openImport()">${ic('upload',12)} Import</button>
        <button class="btn btn-primary btn-sm" onclick="openSmartFill()">${ic('zap',12)} Smart Fill</button>
        <button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="clearMonth()">${ic('trash',12)} Clear</button>
      </div>
    </div>

    <!-- Summary Strip -->
    <div class="strip">
      ${statCard('Current Balance',  fmt(balance,true), balance>=0?'pos':'neg',  `Initial: ${fmt(APP.monthly.initialBalance,true)}`)}
      ${statCard('Total Income',     fmt(income,true),  'pos',  APP.monthly.income.length+' sources')}
      ${statCard('Total Expenses',   fmt(expenses,true),'neg',  APP.monthly.expenses.length+' items')}
      ${statCard('Investments',      fmt(investments,true),'blu', APP.monthly.investments.length+' entries')}
      ${statCard('Loan Payments',    fmt(loans,true),   'gld',  APP.monthly.loans.length+' EMIs')}
      ${statCard('Checklist',        done+'/'+total,    done===total?'pos':'', `${total-done} pending`)}
    </div>

    <!-- Opening Balance -->
    <div style="display:flex;align-items:center;gap:10px;background:var(--s1);border:1px solid var(--b);border-radius:var(--r);padding:12px 18px;flex-wrap:wrap">
      <div style="font-size:12.5px;font-weight:500;color:var(--t2);white-space:nowrap">Opening Balance</div>
      <div style="position:relative;display:inline-flex;align-items:center">
        <span style="position:absolute;left:10px;color:var(--t3);font-size:13px;pointer-events:none">₹</span>
        <input class="inp" style="max-width:160px;padding-left:22px" type="number" value="${APP.monthly.initialBalance}"
          onchange="APP.monthly.initialBalance=parseFloat(this.value)||0;navigate('monthly')">
      </div>
      <div style="font-size:12px;color:var(--t3)">Balance = Opening + Income − Expenses − Investments − Loans</div>
    </div>

    <!-- Accordion Panels -->
    <div class="acc-wrap">
      ${accPanel('expenses',    'Expenses',      'var(--red)',    expenses,   false)}
      ${accPanel('income',      'Income',        'var(--accent)', income,     true)}
      ${accPanel('investments', 'Investments',   'var(--blue)',   investments,true)}
      ${accPanel('loans',       'Loan Payments', 'var(--gold)',   loans,      true)}
    </div>

    <!-- Charts -->
    <div class="charts-row">
      <div class="chart-area">
        <div class="card-hd" style="padding:12px 16px"><div class="card-title">${ic('pie',13)} Breakdown</div></div>
        <div class="card-body"><div class="chart-wrap" style="height:200px"><canvas id="m-pie"></canvas></div></div>
      </div>
      <div class="chart-area">
        <div class="card-hd" style="padding:12px 16px"><div class="card-title">${ic('bar',13)} Income vs Expenses</div></div>
        <div class="card-body"><div class="chart-wrap" style="height:200px"><canvas id="m-bar"></canvas></div></div>
      </div>
      <div class="chart-area">
        <div class="card-hd" style="padding:12px 16px"><div class="card-title">${ic('trending',13)} Balance Trend</div></div>
        <div class="card-body"><div class="chart-wrap" style="height:200px"><canvas id="m-line"></canvas></div></div>
      </div>
    </div>

    <!-- Checklist + Notes -->
    <div class="g-2">
      <div class="card">
        <div class="card-hd">
          <div class="card-title">${ic('check',14)} Checklist <span class="section-count">${done}/${total}</span></div>
          <button class="btn btn-ghost btn-sm" onclick="openAddCheck()">${ic('plus',12)} Add</button>
        </div>
        ${APP.monthly.checklist.map(c=>`
          <div class="cl-item${c.done?' done-item':''}">
            <div class="cl-box${c.done?' done':''}" onclick="toggleCheck(${c.id})">
              ${c.done?`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`:''}
            </div>
            <span>${c.label}</span>
            <button class="btn-icon ml-auto" onclick="APP.monthly.checklist=APP.monthly.checklist.filter(x=>x.id!==${c.id});navigate('monthly')">${ic('x',11)}</button>
          </div>`).join('')}
      </div>
      <div class="card">
        <div class="card-hd">
          <div class="card-title">${ic('pin',14)} Notes</div>
          <button class="btn btn-ghost btn-sm" onclick="openAddNote()">${ic('plus',12)} Add</button>
        </div>
        <div class="card-body col" style="gap:8px">
          ${APP.monthly.notes.sort((a,b)=>b.pinned-a.pinned).map(n=>`
            <div class="note${n.pinned?' pinned':''}">
              <div class="note-pin"></div>
              <div style="flex:1;font-size:12.5px;line-height:1.6">${n.text}</div>
              <div class="note-acts">
                <button class="btn-icon" title="${n.pinned?'Unpin':'Pin'}" onclick="APP.monthly.notes.find(x=>x.id===${n.id}).pinned=!${n.pinned};navigate('monthly')">${ic('pin',11)}</button>
                <button class="btn-icon" title="Edit" onclick="openEditNote(${n.id})">${ic('edit',11)}</button>
                <button class="btn-icon" title="Delete" onclick="APP.monthly.notes=APP.monthly.notes.filter(x=>x.id!==${n.id});navigate('monthly')">${ic('x',11)}</button>
              </div>
            </div>`).join('')}
        </div>
      </div>
    </div>`;

  setTimeout(() => {
    makeChart('m-pie', {
      type: 'doughnut',
      data: { labels:['Expenses','Income','Investments','Loans'],
        datasets:[{ data:[expenses,income,investments,loans], backgroundColor:['#ff5c7a','#00e5a0','#4dabf7','#ffc947'], borderWidth:0 }] },
      options:{ cutout:'65%', plugins:{ legend:{ display:true, position:'right', labels:{ color:'#8a9ab5',font:{size:10.5},boxWidth:9,padding:10 } } } }
    });
    const mHistLabels   = APP.history.length ? APP.history.map(h=>h.month)   : [monthName(APP.monthly.month)];
    const mHistIncome   = APP.history.length ? APP.history.map(h=>h.income)   : [income];
    const mHistExpenses = APP.history.length ? APP.history.map(h=>h.expenses) : [expenses];
    const mHistBalance  = APP.history.length ? APP.history.map(h=>h.balance)  : [balance];
    makeChart('m-bar', {
      type:'bar',
      data:{ labels:mHistLabels,
        datasets:[
          { label:'Income',   data:mHistIncome,   backgroundColor:'rgba(0,229,160,.55)',  borderRadius:4 },
          { label:'Expenses', data:mHistExpenses, backgroundColor:'rgba(255,92,122,.5)', borderRadius:4 },
        ]},
      options:{ scales:{ y:{ ticks:{ callback:v=>'₹'+(v/1000)+'K' } } } }
    });
    makeChart('m-line', {
      type:'line',
      data:{ labels:mHistLabels,
        datasets:[{ label:'Balance', data:mHistBalance,
          borderColor:'#00e5a0', backgroundColor:'rgba(0,229,160,.1)', fill:true,
          tension:.4, pointBackgroundColor:'#00e5a0', pointRadius:4 }]},
      options:{ scales:{ y:{ ticks:{ callback:v=>'₹'+(v/1000)+'K' } } } }
    });
  }, 80);
}

function statCard(label, val, cls, sub) {
  return `<div class="stat">
    <div class="stat-label">${label}</div>
    <div class="stat-val ${cls}">${val}</div>
    <div style="font-size:11px;color:var(--t3)">${sub}</div>
  </div>`;
}

// ── ACCORDION PANEL BUILDER ───────────────────────────────────────────────────
function accPanel(type, label, dotColor, total, collapsed=false) {
  const items    = APP.monthly[type] || [];
  const count    = items.length;
  const isIncome = type === 'income';
  const totalCls = type==='income'?'text-pos':type==='investments'?'text-blue':type==='loans'?'text-gld':'text-neg';
  const openCls  = collapsed ? '' : ' open';
  const chevOpen = collapsed ? '' : ' open';

  const colsExtra = type==='investments'
    ? '<th>Linked To</th>'
    : type==='loans' ? '<th>Loan</th>' : '';

  const rowsHtml = items.map(it => {
    const extraTd = type==='investments'
      ? `<td>${it.linked?`<span class="pill p-stock" style="font-size:10px">${it.linked}</span>`:'<span class="muted">—</span>'}</td>`
      : type==='loans'
      ? `<td>${it.loanId?`<span class="pill p-other" style="font-size:10px">Loan #${it.loanId}</span>`:'<span class="muted">—</span>'}</td>`
      : '';
    return `<tr>
      <td><div style="font-weight:500">${it.desc}</div></td>
      <td class="mono ${isIncome?'pos':'neg'}">${fmt(it.amount)}</td>
      <td class="muted">${fmtDisplayDate(it.date)}</td>
      ${extraTd}
      <td><div class="actions">
        <button class="btn-icon" title="Edit" onclick="openEditEntry('${type}',${it.id})">${ic('edit',12)}</button>
        <button class="btn-icon" title="Delete" onclick="deleteEntry('${type}',${it.id})">${ic('trash',12)}</button>
      </div></td>
    </tr>`;
  }).join('');

  const body = count > 0
    ? `<div class="tbl-wrap"><table class="tbl">
        <thead><tr>
          <th>Description</th><th>Amount</th><th>Date</th>${colsExtra}<th style="width:60px"></th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table></div>`
    : `<div style="padding:20px 18px;text-align:center;color:var(--t3);font-size:12.5px">No entries yet.</div>`;

  const addLabel = {expenses:'Add Expense',income:'Add Income',investments:'Add Investment',loans:'Add Payment'}[type]||'Add';

  return `<div class="acc-panel">
    <div class="acc-head" onclick="toggleAcc('${type}')">
      <div class="acc-head-l">
        <div class="acc-dot" style="background:${dotColor}"></div>
        ${label}
        <span class="section-count">${count}</span>
      </div>
      <div class="acc-head-r">
        <span class="acc-total ${totalCls}">${fmt(total)}</span>
        <svg class="chevron${chevOpen}" xmlns="http://www.w3.org/2000/svg" width="14" height="14" id="chev-${type}"
          viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </div>
    </div>
    <div class="acc-body${openCls}" id="acc-${type}">
      ${body}
      <div class="acc-footer">
        <button class="btn btn-ghost btn-sm" onclick="openAddEntry('${type}')">${ic('plus',12)} ${addLabel}</button>
      </div>
    </div>
  </div>`;
}

// Toggle accordion open/close
function toggleAcc(id) {
  const body = document.getElementById('acc-' + id);
  const chev = document.getElementById('chev-' + id);
  if (!body) return;
  body.classList.toggle('open');
  if (chev) chev.classList.toggle('open');
}

// ── INVESTMENTS ───────────────────────────────────────────────────────────────
if (!APP.invViewMode) APP.invViewMode = 'cards';

function setInvView(mode) {
  APP.invViewMode = mode;
  Object.values(_chartInstances).forEach(c => { try { c.destroy(); } catch(e){} });
  _chartInstances = {};
  renderScreen('investments', document.getElementById('screen-content'));
}

function renderInvestments(el) {
  const cats = ['ALL','Stock','MF','FD','Bond','EPF','ESOP','Real Estate','Gold','Others'];
  let inv = APP.activeInvFilter === 'ALL'
    ? APP.investments
    : APP.investments.filter(i => _invCat(i) === APP.activeInvFilter);

  inv = [...inv].sort((a, b) => {
    const col = APP.invSort.col;
    let va = col==='value'?invValue(a):col==='pnl'?(invValue(a)-invCost(a)):col==='name'?a.name:invValue(a);
    let vb = col==='value'?invValue(b):col==='pnl'?(invValue(b)-invCost(b)):col==='name'?b.name:invValue(b);
    va = isFinite(va) ? va : 0;
    vb = isFinite(vb) ? vb : 0;
    if (typeof va==='string') return APP.invSort.dir==='asc'?va.localeCompare(vb):vb.localeCompare(va);
    return APP.invSort.dir==='asc'?va-vb:vb-va;
  });

  const totalInvested = inv.reduce((a,i)=>a+invCost(i),0);
  const totalValue    = inv.reduce((a,i)=>a+invValue(i),0);
  const totalPnl      = totalValue - totalInvested;
  const totalPnlPct   = totalInvested ? totalPnl/totalInvested*100 : 0;

  const alloc = {};
  APP.investments.forEach(i => { const cat=_invCat(i); const v=invValue(i); alloc[cat]=(alloc[cat]||0)+(isFinite(v)?v:0); });
  const allocTotal = Object.values(alloc).reduce((a,v)=>a+v,0);

  const isCards = APP.invViewMode === 'cards';

  el.innerHTML = `
    <div class="sh">
      <div class="sh-l">
        <div class="sh-title">Investment Tracker</div>
        <div class="sh-sub">${APP.investments.length} holdings · Live prices</div>
      </div>
      <div class="sh-r">
        <button class="btn btn-secondary btn-sm" id="refresh-prices-btn" onclick="refreshLivePrices()">${ic('refresh',12)} Refresh Prices</button>
        <button class="btn btn-secondary btn-sm" onclick="openInvImport()">${ic('upload',12)} Import</button>
        <button class="btn btn-secondary btn-sm" onclick="invExport()">${ic('download',12)} Export</button>
        <button class="btn btn-secondary btn-sm" onclick="openInvClear()" style="color:var(--red)">${ic('trash',12)} Clear</button>
        <button class="btn btn-primary btn-sm" onclick="openAddInv()">${ic('plus',12)} Add Holding</button>
      </div>
    </div>

    <div class="strip">
      ${statCard('Total Invested',  fmt(totalInvested,true), '',    APP.investments.length+' holdings')}
      ${statCard('Current Value',   fmt(totalValue,true),    'pos', '')}
      ${statCard('Total P&L',       (totalPnl>=0?'+':'')+fmt(Math.abs(totalPnl),true), totalPnl>=0?'pos':'neg', fmtPct(totalPnlPct))}
      ${statCard('Holdings',        APP.investments.length+'', '', APP.activeInvFilter!=='ALL'?APP.activeInvFilter+' filter':'all categories')}
      ${statCard('Live Tracking',   inv.filter(i=>i.ticker).length+'', 'blu', 'tickers with live price')}
    </div>

    <!-- Filter + Search + View Toggle -->
    <div class="card" style="overflow:visible">
      <div class="card-hd" style="flex-wrap:wrap;gap:10px">
        <div class="filter-tabs">
          ${cats.map(c=>`<button class="ftab${APP.activeInvFilter===c?' active':''}" onclick="setInvFilter('${c}')">${c}</button>`).join('')}
        </div>
        <div class="row" style="gap:8px;margin-left:auto">
          <div class="search-wrap">
            <div class="search-ico">${ic('search',13)}</div>
            <input class="inp inp-sm" style="width:190px" placeholder="Search holdings…" oninput="filterInvSearch(this.value)" id="inv-search">
          </div>
          <div class="view-toggle">
            <button class="vt-btn${isCards?' active':''}" title="Card view" onclick="setInvView('cards')">
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
            </button>
            <button class="vt-btn${!isCards?' active':''}" title="Table view" onclick="setInvView('table')">
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
            </button>
          </div>
        </div>
      </div>

      <!-- Holdings: Cards or Table -->
      <div id="inv-content">
        ${isCards ? renderInvCards(inv) : renderInvTable(inv)}
      </div>
    </div>

    <!-- Allocation -->
    <div class="g-2">
      <div class="card">
        <div class="card-hd"><div class="card-title">${ic('pie',13)} Asset Allocation</div></div>
        <div class="card-body row" style="gap:20px;align-items:center;flex-wrap:wrap">
          <div style="width:180px;height:180px;flex-shrink:0"><canvas id="alloc-chart"></canvas></div>
          <div style="flex:1;min-width:180px">
            ${Object.entries(alloc).map(([cat,val],i)=>`
              <div class="alloc-row">
                <div class="alloc-dot" style="background:${CHART_COLORS[i%CHART_COLORS.length]}"></div>
                <div class="alloc-lbl">${cat}</div>
                <div class="alloc-pct">${(val/allocTotal*100).toFixed(1)}%</div>
                <div class="alloc-val">${fmt(val,true)}</div>
              </div>`).join('')}
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-hd"><div class="card-title">${ic('bar',13)} Top Holdings by Value</div></div>
        <div class="card-body"><div class="chart-wrap"><canvas id="inv-bar"></canvas></div></div>
      </div>
    </div>`;

  setTimeout(() => {
    const allocEntries = Object.entries(alloc);
    makeChart('alloc-chart', {
      type:'doughnut',
      data:{ labels:allocEntries.map(e=>e[0]), datasets:[{ data:allocEntries.map(e=>e[1]), backgroundColor:CHART_COLORS, borderWidth:0 }] }
    });
    const top5 = [...APP.investments].sort((a,b)=>invValue(b)-invValue(a)).slice(0,5);
    makeChart('inv-bar', {
      type:'bar',
      data:{ labels:top5.map(i=>i.name.split(' ').slice(0,2).join(' ')),
        datasets:[{ label:'Value', data:top5.map(invValue), backgroundColor:CHART_COLORS.slice(0,5), borderRadius:5 }]},
      options:{ indexAxis:'y', scales:{ x:{ ticks:{ callback:v=>'₹'+(v/100000).toFixed(1)+'L' } }, y:{ ticks:{ font:{size:11} } } } }
    });
  }, 80);
}

// ── INVESTMENT CARD VIEW ──────────────────────────────────────────────────────
function renderInvCards(inv) {
  if (!inv.length) return `<div style="padding:32px;text-align:center;color:var(--t3);font-size:13px">No holdings match your filter.</div>`;
  return `<div class="inv-cards">
    ${inv.map(i => {
      const cat  = _invCat(i);
      const cost = invCost(i), val = invValue(i), pnl = val - cost;
      const pct  = (isFinite(cost) && cost) ? pnl / cost * 100 : 0;
      const qty  = cat==='Gold' ? (_invTotalQty(i)+'g') : (_invTotalQty(i) + (_invTotalQty(i)===1?' unit':' units'));
      const avg  = cat==='Gold' ? fmt(_invGoldBuyPrice(i))+'/g' : fmt(_invAvgPrice(i));
      const gainW = Math.min(100, Math.abs(isFinite(pct)?pct:0));
      const liveP = i.livePrice ? fmt(i.livePrice) : (i.lots && i.lots.length ? '—' : fmt(i.avgPrice||0));
      return `<div class="inv-card" id="inv-card-${i.id}">
        <div class="inv-card-head">
          <div style="min-width:0">
            <div class="inv-card-name">${i.name}</div>
            <div class="inv-card-ticker">${i.ticker||'No ticker'}</div>
            ${i.source && i.source !== 'manual' && i.source !== 'Auto-detect' ? `<span style="font-size:.5rem;padding:.1rem .32rem;border-radius:3px;background:rgba(77,171,247,.13);color:var(--accent4);font-weight:700;letter-spacing:.3px;text-transform:uppercase">${i.source}</span>` : ''}
          </div>
          <span class="pill ${pillClass(cat)}" style="flex-shrink:0">${cat}</span>
        </div>
        <div class="inv-card-body">
          <div class="inv-card-val">${fmt(val,true)}</div>
          <div class="inv-card-pnl ${pnl>=0?'text-pos':'text-neg'}">
            ${pnl>=0?'+':''}${fmt(Math.abs(pnl),true)} &nbsp;·&nbsp; ${fmtPct(pct)}
          </div>
          <div style="margin:10px 0 4px;display:flex;align-items:center;gap:8px">
            <div class="prog" style="flex:1">
              <div class="prog-fill${pct<0?' red':''}" style="width:${gainW}%"></div>
            </div>
            <span style="font-size:10.5px;color:var(--t3);white-space:nowrap">${pct>=0?'Gain':'Loss'}</span>
          </div>
          <div class="inv-card-stats">
            <div>
              <div class="ics-label">Cost Basis</div>
              <div class="ics-val">${fmt(cost,true)}</div>
            </div>
            <div>
              <div class="ics-label">${cat==='Gold'?'Weight':'Quantity'}</div>
              <div class="ics-val">${qty}</div>
            </div>
            <div>
              <div class="ics-label">Avg Buy Price</div>
              <div class="ics-val">${avg}</div>
            </div>
            <div>
              <div class="ics-label">Live Price</div>
              <div class="ics-val text-pos">${liveP}</div>
            </div>
          </div>
          <div class="inv-card-actions">
            <button class="btn btn-ghost btn-sm" onclick="openEditInv('${i.id}')">${ic('edit',12)} Edit</button>
            <button class="btn btn-danger btn-sm" onclick="deleteInvestment('${i.id}')">${ic('trash',12)} Delete</button>
          </div>
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

// ── INVESTMENT TABLE VIEW ─────────────────────────────────────────────────────
function renderInvTable(inv) {
  if (!inv.length) return `<div style="padding:32px;text-align:center;color:var(--t3);font-size:13px">No holdings match your filter.</div>`;
  function thSort(label, col) {
    const active = APP.invSort.col === col;
    const arrow  = active ? (APP.invSort.dir==='asc'?' ↑':' ↓') : '';
    return `<th onclick="sortInv('${col}')" style="cursor:pointer;${active?'color:var(--accent)':''}">${label}${arrow}</th>`;
  }
  return `<div class="tbl-wrap">
    <table class="tbl" id="inv-table">
      <thead><tr>
        ${thSort('Name','name')}
        <th>Category</th>
        <th>Live Price</th>
        <th>Qty</th>
        <th>Avg Price</th>
        <th>Cost Basis</th>
        ${thSort('Curr Value','value')}
        ${thSort('P&L','pnl')}
        <th>Return %</th>
        <th></th>
      </tr></thead>
      <tbody>
        ${inv.map(i => {
          const cat  = _invCat(i);
          const cost = invCost(i), val = invValue(i), pnl = val - cost;
          const pct  = (isFinite(cost) && cost) ? pnl/cost*100 : 0;
          const qty  = cat==='Gold' ? _invTotalQty(i)+'g' : _invTotalQty(i);
          const avg  = cat==='Gold' ? fmt(_invGoldBuyPrice(i)) : fmt(_invAvgPrice(i));
          const liveP = i.livePrice ? fmt(i.livePrice) : '—';
          return `<tr>
            <td>
              <div style="font-weight:600">${i.name}</div>
              ${i.ticker?`<div class="muted">${i.ticker}</div>`:''}
              ${i.source && i.source !== 'manual' && i.source !== 'Auto-detect' ? `<span style="font-size:.5rem;padding:.1rem .32rem;border-radius:3px;background:rgba(77,171,247,.13);color:var(--accent4);font-weight:700;letter-spacing:.3px;text-transform:uppercase;display:inline-block;margin-top:2px">${i.source}</span>` : ''}
            </td>
            <td><span class="pill ${pillClass(cat)}">${cat}</span></td>
            <td class="mono">${liveP}</td>
            <td class="mono">${qty}</td>
            <td class="mono">${avg}</td>
            <td class="mono">${fmt(cost,true)}</td>
            <td class="mono" style="font-weight:600">${fmt(val,true)}</td>
            <td class="mono ${pnl>=0?'pos':'neg'}">${pnl>=0?'+':''}${fmt(Math.abs(pnl),true)}</td>
            <td class="mono ${pct>=0?'pos':'neg'}">${fmtPct(pct)}</td>
            <td><div class="actions">
              <button class="btn-icon" onclick="openEditInv('${i.id}')">${ic('edit',12)}</button>
              <button class="btn-icon" onclick="deleteInvestment('${i.id}')">${ic('trash',12)}</button>
            </div></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>`;
}

function filterInvSearch(q) {
  const content = document.getElementById('inv-content');
  if (!content) return;
  if (APP.invViewMode === 'cards') {
    content.querySelectorAll('.inv-card').forEach(card => {
      card.style.display = card.textContent.toLowerCase().includes(q.toLowerCase()) ? '' : 'none';
    });
  } else {
    content.querySelectorAll('#inv-table tbody tr').forEach(row => {
      row.style.display = row.textContent.toLowerCase().includes(q.toLowerCase()) ? '' : 'none';
    });
  }
}
