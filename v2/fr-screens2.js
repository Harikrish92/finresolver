// ── LOANS SCREEN ──────────────────────────────────────────────────────────────
function renderLoans(el) {
  const totalBorrowed  = APP.loans.reduce((a,l)=>a+l.principal,0);
  const totalOutstanding = APP.loans.reduce((a,l)=>a+loanOutstanding(l),0);
  const totalEMI       = APP.loans.reduce((a,l)=>a+loanEMI(l),0);
  const totalInterest  = APP.loans.reduce((a,l)=>{
    const rows = calcAmortization(l);
    return a + rows.reduce((s,r)=>s+r.interest,0);
  },0);

  el.innerHTML = `
    <div class="sh">
      <div class="sh-l">
        <div class="sh-title">Loan Tracker</div>
        <div class="sh-sub">${APP.loans.length} active loans</div>
      </div>
      <div class="sh-r">
        <button class="btn btn-primary btn-sm" onclick="openAddLoan()">${ic('plus',12)} Add Loan</button>
      </div>
    </div>

    <div class="strip">
      ${statCard('Total Borrowed',   fmt(totalBorrowed,true),   '',    APP.loans.length+' loans')}
      ${statCard('Outstanding',      fmt(totalOutstanding,true),'neg', 'across all loans')}
      ${statCard('Monthly EMI',      fmt(totalEMI,true),        'gld', 'total outflow')}
      ${statCard('Interest Remaining', fmt(totalInterest,true), 'neg', 'estimated total')}
    </div>

    <div class="loan-grid">
      ${APP.loans.map(l => renderLoanCard(l)).join('')}
    </div>`;
}

function renderLoanCard(l) {
  const rate   = _loanRate(l);
  const tenure = _loanTenure(l);
  const outstanding = loanOutstanding(l);
  const emi    = loanEMI(l);
  const paid   = monthsElapsed(l.startDate);
  const pct    = Math.min(100, Math.max(0, Math.round((1 - outstanding / (l.principal || 1)) * 100)));
  const dueDate = (() => {
    const d = new Date(l.startDate);
    d.setMonth(d.getMonth() + paid + 1);
    return d.toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});
  })();
  const fullyPaid = outstanding <= 0;

  return `<div class="loan-card" onclick="navigate('loan-detail',{loanId:'${l.id}'})">
    <div class="row" style="justify-content:space-between;align-items:flex-start">
      <div>
        <div style="font-weight:600;font-size:14px;color:var(--t1)">${l.name}</div>
        <div style="margin-top:3px;display:flex;gap:6px;align-items:center">
          <span class="pill ${loanPillClass(l.type)}">${l.type || 'Loan'}</span>
          ${l.lender ? `<span style="font-size:11px;color:var(--t3)">${l.lender}</span>` : ''}
        </div>
      </div>
      <div class="row" style="gap:4px" onclick="event.stopPropagation()">
        <button class="btn-icon" onclick="openEditLoan('${l.id}')">${ic('edit',12)}</button>
        <button class="btn-icon" onclick="deleteLoan('${l.id}')">${ic('trash',12)}</button>
      </div>
    </div>

    <div>
      <div class="row" style="justify-content:space-between;margin-bottom:6px">
        <span style="font-size:12px;color:var(--t3)">${pct}% repaid</span>
        <span style="font-family:var(--font-m);font-size:12px;color:var(--t2)">${fmt(outstanding,true)} left</span>
      </div>
      <div class="prog">
        <div class="prog-fill${pct>70?'':pct>40?' gold':' red'}" style="width:${pct}%"></div>
      </div>
    </div>

    <div class="loan-stats-g">
      <div>
        <div class="lsg-label">Monthly EMI</div>
        <div class="lsg-val">${fmt(emi)}</div>
      </div>
      <div>
        <div class="lsg-label">Interest Rate</div>
        <div class="lsg-val">${rate}% p.a.</div>
      </div>
      <div>
        <div class="lsg-label">EMIs Paid</div>
        <div class="lsg-val">${Math.min(paid, tenure)} / ${tenure}</div>
      </div>
      <div>
        <div class="lsg-label">${fullyPaid?'Status':'Next EMI'}</div>
        <div class="lsg-val" style="${fullyPaid?'color:var(--accent)':''}">${fullyPaid?'Fully Paid ✓':dueDate}</div>
      </div>
    </div>

    <div class="row" style="gap:6px">
      <span style="font-size:11.5px;color:var(--t3)">Started ${new Date(l.startDate).toLocaleDateString('en-IN',{month:'short',year:'numeric'})}</span>
      <span class="ml-auto stat-badge badge-neu">${ic('chevRt',10)} View details</span>
    </div>
  </div>`;
}

// ── LOAN DETAIL ───────────────────────────────────────────────────────────────
function renderLoanDetail(el) {
  const loan = APP.loans.find(l=>l.id===APP.activeLoanId) || APP.loans[0];
  if (!loan) { el.innerHTML='<p style="color:var(--t3);padding:40px">Loan not found.</p>'; return; }

  const rate   = _loanRate(loan);
  const tenure = _loanTenure(loan);
  const outstanding = loanOutstanding(loan);
  const emi = loanEMI(loan);
  const paid = Math.min(monthsElapsed(loan.startDate), tenure);
  const rows = calcAmortization(loan);
  const totalInterest = rows.reduce((a,r)=>a+r.interest,0);
  const totalPrincipal = loan.principal || 0;
  const payoffDate = (() => {
    const d = new Date(loan.startDate);
    d.setMonth(d.getMonth() + tenure);
    return d.toLocaleDateString('en-IN',{month:'short',year:'numeric'});
  })();

  // Balance curve data (every 12 months)
  const curveLabels=[], curveData=[];
  for(let i=0;i<rows.length;i+=Math.max(1,Math.floor(rows.length/12))){
    curveLabels.push(rows[i].date);
    curveData.push(rows[i].balance);
  }

  el.innerHTML = `
    <div class="sh">
      <div class="sh-l">
        <button class="btn btn-ghost btn-sm" onclick="navigate('loans')">${ic('arrowLt',12)} Back</button>
        <div class="sh-title" style="margin-top:4px">${loan.name} <span class="pill ${loanPillClass(loan.type)}" style="vertical-align:middle;margin-left:6px">${loan.type}</span></div>
        <div class="sh-sub">${loan.lender ? loan.lender+' · ' : ''}${rate}% p.a. · ${tenure} months · Started ${new Date(loan.startDate).toLocaleDateString('en-IN',{month:'long',year:'numeric'})}</div>
      </div>
      <div class="sh-r">
        <button class="btn btn-secondary btn-sm" onclick="openLogPayment('${loan.id}')">${ic('plus',12)} Log Payment</button>
      </div>
    </div>

    <!-- 5 Metric Cards -->
    <div class="strip">
      ${statCard('Outstanding',    fmt(outstanding,true),  'neg',  (loan.principal?Math.round(outstanding/loan.principal*100):0)+'% remaining')}
      ${statCard('Monthly EMI',    fmt(emi),               'gld',  'reducing balance')}
      ${statCard('Interest Rate',  rate+'% p.a.',          '',     'fixed rate')}
      ${statCard('EMIs Paid',      paid+' / '+tenure,      paid>tenure/2?'pos':'', paid+' completed')}
      ${statCard('Payoff Date',    payoffDate,             '',     tenure-paid+' months left')}
    </div>

    <!-- Charts -->
    <div class="g-2">
      <div class="card">
        <div class="card-hd"><div class="card-title">${ic('pie',13)} Principal vs Interest Split</div></div>
        <div class="card-body row" style="gap:20px;align-items:center">
          <div style="width:160px;height:160px;flex-shrink:0"><canvas id="loan-donut"></canvas></div>
          <div style="flex:1">
            <div class="alloc-row">
              <div class="alloc-dot" style="background:var(--blue)"></div>
              <div class="alloc-lbl">Principal</div>
              <div class="alloc-val">${fmt(totalPrincipal,true)}</div>
            </div>
            <div class="alloc-row">
              <div class="alloc-dot" style="background:var(--red)"></div>
              <div class="alloc-lbl">Total Interest</div>
              <div class="alloc-val text-neg">${fmt(totalInterest,true)}</div>
            </div>
            <div class="alloc-row" style="border-top:1px solid var(--b2);margin-top:6px;padding-top:8px">
              <div class="alloc-lbl" style="font-weight:600">Total Cost</div>
              <div class="alloc-val" style="font-weight:600">${fmt(totalPrincipal+totalInterest,true)}</div>
            </div>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-hd"><div class="card-title">${ic('trending',13)} Outstanding Balance Curve</div></div>
        <div class="card-body"><div class="chart-wrap"><canvas id="loan-line"></canvas></div></div>
      </div>
    </div>

    <!-- Amortization Table -->
    <div class="card">
      <div class="card-hd">
        <div class="card-title">${ic('file',13)} Amortization Schedule</div>
        <span style="font-size:11.5px;color:var(--t3)">${tenure} months total</span>
      </div>
      <div class="tbl-wrap" style="max-height:340px;overflow-y:auto">
        <table class="tbl">
          <thead style="position:sticky;top:0;background:var(--s1);z-index:1">
            <tr><th>#</th><th>Due Date</th><th>EMI</th><th>Principal</th><th>Interest</th><th>Balance</th><th>Status</th></tr>
          </thead>
          <tbody>
            ${rows.slice(0, Math.min(rows.length, 36)).map((r,i) => {
              const isPaid = i < paid;
              const isCurrent = i === paid;
              return `<tr class="${isPaid?'amort-paid':''} ${isCurrent?'amort-current':''}">
                <td class="mono muted">${r.num}</td>
                <td>${r.date}</td>
                <td class="mono">${fmt(r.emi)}</td>
                <td class="mono text-blue">${fmt(r.principal)}</td>
                <td class="mono text-neg">${fmt(r.interest)}</td>
                <td class="mono">${fmt(r.balance,true)}</td>
                <td>${isPaid?'<span class="stat-badge badge-up">Paid ✓</span>':isCurrent?'<span class="stat-badge badge-gld">Current</span>':'<span class="stat-badge badge-neu">Upcoming</span>'}</td>
              </tr>`;
            }).join('')}
            ${rows.length > 36 ? `<tr><td colspan="7" style="text-align:center;color:var(--t3);font-size:12px;padding:14px">${rows.length-36} more rows hidden · Total tenure ${tenure} months</td></tr>` : ''}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Payment Log -->
    <div class="card">
      <div class="card-hd">
        <div class="card-title">${ic('check',13)} Payment Log <span class="section-count">${loan.payments.length}</span></div>
        <button class="btn btn-ghost btn-sm" onclick="openLogPayment('${loan.id}')">${ic('plus',12)} Log Payment</button>
      </div>
      ${loan.payments.length === 0
        ? `<div style="padding:20px;text-align:center;color:var(--t3);font-size:12.5px">No payments logged yet.</div>`
        : `<div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Date</th><th>Amount</th><th>Note</th><th></th></tr></thead>
          <tbody>
            ${[...loan.payments].reverse().map(p=>`
              <tr>
                <td>${fmtDisplayDate(p.date)}</td>
                <td class="mono text-pos">${fmt(p.amount)}</td>
                <td class="muted">${p.note||'—'}</td>
                <td><div class="actions"><button class="btn-icon" onclick="APP.loans.find(l=>l.id===${loan.id}).payments=APP.loans.find(l=>l.id===${loan.id}).payments.filter(x=>x.id!=='${p.id}');navigate('loan-detail')">${ic('trash',12)}</button></div></td>
              </tr>`).join('')}
          </tbody>
        </table></div>`}
    </div>`;

  setTimeout(() => {
    makeChart('loan-donut', {
      type:'doughnut',
      data:{ labels:['Principal','Total Interest'], datasets:[{ data:[totalPrincipal,totalInterest], backgroundColor:['#4dabf7','#ff5c7a'], borderWidth:0 }] }
    });
    makeChart('loan-line', {
      type:'line',
      data:{
        labels: curveLabels,
        datasets:[{ label:'Outstanding Balance', data:curveData, borderColor:'#4dabf7', backgroundColor:'rgba(77,171,247,.1)', fill:true, tension:.4, pointRadius:3, pointBackgroundColor:'#4dabf7' }]
      },
      options:{ scales:{ y:{ ticks:{ callback:v=>'₹'+(v/100000).toFixed(1)+'L' } } } }
    });
  }, 80);
}

// ── PORTFOLIO / FIRE ──────────────────────────────────────────────────────────
function renderPortfolio(el) {
  const { totalInvested, currentValue, pnl, pnlPct, totalDebt, netWorth, cashBalance } = getPortfolioStats();
  const { income, expenses } = getMonthlyTotals();
  const avgMonthlyExp = APP.history.length
    ? APP.history.reduce((a,h)=>a+h.expenses,0)/APP.history.length
    : expenses || 0;
  const fireNum       = avgMonthlyExp * 12 * 25;
  const firePct       = fireNum > 0 ? Math.min(100, Math.round(currentValue/fireNum*100)) : 0;
  const safetyMonths  = (cashBalance>0 && avgMonthlyExp>0) ? (cashBalance/avgMonthlyExp).toFixed(1) : '0';
  const debtRatio     = totalInvested ? (totalDebt/(totalInvested+cashBalance)*100).toFixed(1) : '0';
  const annualExp     = avgMonthlyExp * 12;
  const ytdSavRate    = income>0 ? Math.round((income-expenses)/income*100) : 0;

  // allocation
  const alloc = {};
  APP.investments.forEach(i => { const cat=_invCat(i); const v=invValue(i); alloc[cat]=(alloc[cat]||0)+(isFinite(v)?v:0); });
  const allocTotal = Object.values(alloc).reduce((a,v)=>a+v,0);
  const top5 = [...APP.investments].sort((a,b)=>(isFinite(invValue(b))?invValue(b):0)-(isFinite(invValue(a))?invValue(a):0)).slice(0,5);

  el.innerHTML = `
    <div class="sh">
      <div class="sh-l">
        <div class="sh-title">Portfolio & FIRE</div>
        <div class="sh-sub">Net worth overview and retirement readiness</div>
      </div>
      <div class="sh-r">
        <div class="sync"><div class="sync-dot"></div>Live data</div>
      </div>
    </div>

    <!-- 5 Metric Cards -->
    <div class="strip">
      ${statCard('Net Worth',      fmt(netWorth,true),         netWorth>0?'pos':'neg', 'Assets − Liabilities')}
      ${statCard('Total Invested', fmt(totalInvested,true),    '',    pnl>=0?'+'+fmt(pnl,true)+' P&L':fmt(pnl,true)+' P&L')}
      ${statCard('Total Debt',     fmt(totalDebt,true),        'neg', 'outstanding balance')}
      ${statCard('Cash Balance',   fmt(cashBalance,true),      'blu', safetyMonths+' months safety')}
      ${statCard('YTD Savings Rate', ytdSavRate+'%',           ytdSavRate>=20?'pos':ytdSavRate>=10?'gld':'neg', ytdSavRate>=20?'Excellent':'Keep going')}
    </div>

    <!-- FIRE Banner -->
    <div class="fire-banner">
      <div>
        <div style="font-size:10.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--t3)">FIRE Number</div>
        <div style="font-family:var(--font-d);font-weight:800;font-size:38px;color:var(--accent);line-height:1;margin:6px 0 4px">${fmt(fireNum,true)}</div>
        <div style="font-size:12.5px;color:var(--t2)">${APP.history.length}-month avg ₹${Math.round(avgMonthlyExp/1000)}K/mo × 12 × 25</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px 28px">
        ${miniStat('Annual Expenses', fmt(annualExp,true), '')}
        ${miniStat('Corpus Progress', firePct+'%', firePct>=100?'text-pos':firePct>=50?'text-gld':'')}
        ${miniStat('Debt-to-Assets', debtRatio+'%', parseFloat(debtRatio)<30?'text-pos':parseFloat(debtRatio)<50?'text-gld':'text-neg')}
        ${miniStat('Safety Buffer', safetyMonths+' months', parseFloat(safetyMonths)>=6?'text-pos':parseFloat(safetyMonths)>=3?'text-gld':'text-neg')}
      </div>
      <div style="width:120px">
        <div style="font-size:11px;color:var(--t3);text-align:center;margin-bottom:8px">${firePct}% funded</div>
        <div class="prog" style="height:8px;border-radius:999px">
          <div class="prog-fill" style="width:${firePct}%;height:8px"></div>
        </div>
        <div style="font-size:10.5px;color:var(--t3);text-align:center;margin-top:6px">${fmt(currentValue,true)} of ${fmt(fireNum,true)}</div>
      </div>
    </div>

    <!-- Allocation + Top Holdings -->
    <div class="g-2">
      <div class="card">
        <div class="card-hd">
          <div class="card-title">${ic('pie',13)} Asset Allocation</div>
          <span style="font-size:11px;color:var(--t3)">${fmt(allocTotal,true)} total</span>
        </div>
        <div class="card-body row" style="gap:20px;align-items:center;flex-wrap:wrap">
          <div style="width:170px;height:170px;flex-shrink:0"><canvas id="pf-donut"></canvas></div>
          <div style="flex:1;min-width:160px">
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
        <div class="card-hd"><div class="card-title">${ic('bar',13)} Top 5 Holdings</div></div>
        <div class="card-body">
          ${top5.map((inv,i)=>{
            const val = invValue(inv);
            const pnlI = val - invCost(inv);
            return `<div style="display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid var(--b);${i===4?'border:none':''}">
              <div style="width:22px;height:22px;border-radius:6px;background:${CHART_COLORS[i]}22;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:${CHART_COLORS[i]};flex-shrink:0">${i+1}</div>
              <div style="flex:1;overflow:hidden">
                <div style="font-size:13px;font-weight:600;color:var(--t1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${inv.name}</div>
                <span class="pill ${pillClass(_invCat(inv))}" style="font-size:10px">${_invCat(inv)}</span>
              </div>
              <div style="text-align:right">
                <div style="font-family:var(--font-m);font-size:13px;font-weight:500;color:var(--t1)">${fmt(val,true)}</div>
                <div style="font-size:11px;${pnlI>=0?'color:var(--accent)':'color:var(--red)'}">${pnlI>=0?'+':''}${fmt(Math.abs(pnlI),true)}</div>
              </div>
              <div style="font-family:var(--font-m);font-size:12px;color:var(--t3);min-width:36px;text-align:right">${(val/allocTotal*100).toFixed(1)}%</div>
              <div style="display:flex;gap:4px;flex-shrink:0">
                <button class="btn-icon" title="Edit" onclick="openEditInv('${inv.id}')">${ic('edit',11)}</button>
                <button class="btn-icon" title="Delete" onclick="deleteInvestment('${inv.id}')">${ic('trash',11)}</button>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>
    </div>

    <!-- Net Worth Trend -->
    <div class="card">
      <div class="card-hd">
        <div class="card-title">${ic('trending',13)} Net Worth Progression</div>
        <span style="font-size:11px;color:var(--t3)">Monthly trend</span>
      </div>
      <div class="card-body"><div class="chart-wrap" style="height:180px"><canvas id="pf-trend"></canvas></div></div>
    </div>`;

  setTimeout(() => {
    const allocEntries = Object.entries(alloc);
    makeChart('pf-donut', {
      type:'doughnut',
      data:{ labels:allocEntries.map(e=>e[0]), datasets:[{ data:allocEntries.map(e=>e[1]), backgroundColor:CHART_COLORS, borderWidth:0 }] }
    });
    const pfHistLabels   = APP.history.length
      ? APP.history.map(h => monthName(h.month).slice(0,3))
      : [monthName(APP.monthly.month).slice(0,3)];
    const pfNetWorthData = APP.history.length
      ? APP.history.map(h => currentValue + h.balance - totalDebt)
      : [netWorth];
    const pfInvestedData = APP.history.length
      ? APP.history.map(() => totalInvested)
      : [totalInvested];
    makeChart('pf-trend', {
      type:'line',
      data:{
        labels: pfHistLabels,
        datasets:[
          { label:'Net Worth', data:pfNetWorthData,
            borderColor:'#00e5a0', backgroundColor:'rgba(0,229,160,.1)', fill:true, tension:.4, pointRadius:4, pointBackgroundColor:'#00e5a0' },
          { label:'Invested', data:pfInvestedData,
            borderColor:'#4dabf7', backgroundColor:'transparent', tension:.4, pointRadius:3, pointBackgroundColor:'#4dabf7' }
        ]
      },
      options:{ scales:{ y:{ ticks:{ callback:v=>'₹'+(v/100000).toFixed(1)+'L' } } }, plugins:{ legend:{ labels:{ color:'#8a9ab5',font:{size:11},boxWidth:10,padding:12 } } } }
    });
  }, 80);
}

// ── LIFESTYLE TRACKER ─────────────────────────────────────────────────────────

const LS_CATS = [
  { key:'TV',             icon:'📺', lifespan:10 },
  { key:'Fridge',         icon:'🧊', lifespan:15 },
  { key:'Washing Machine',icon:'🫧', lifespan:12 },
  { key:'AC',             icon:'❄️', lifespan:15 },
  { key:'Microwave',      icon:'♨️', lifespan:10 },
  { key:'Computer',       icon:'💻', lifespan:6  },
  { key:'Phone',          icon:'📱', lifespan:4  },
  { key:'Furniture',      icon:'🪑', lifespan:20 },
  { key:'Vehicle',        icon:'🚗', lifespan:15 },
  { key:'Water Purifier', icon:'💧', lifespan:8  },
  { key:'Geyser',         icon:'🚿', lifespan:10 },
  { key:'Other',          icon:'📦', lifespan:10 },
];

const LS_EV_CATS = [
  { key:'Birthday',        icon:'🎂' },
  { key:'Anniversary',     icon:'💑' },
  { key:'Insurance',       icon:'🛡️' },
  { key:'Subscription',    icon:'🔄' },
  { key:'Vehicle Service', icon:'🔧' },
  { key:'Medical',         icon:'🏥' },
  { key:'Tax',             icon:'📋' },
  { key:'Travel',          icon:'✈️' },
  { key:'Reminder',        icon:'⏰' },
  { key:'Other',           icon:'📌' },
];

let _lsTab = 'goods'; // 'goods' | 'events'

function _lsCat(key) {
  return LS_CATS.find(c => c.key === key) || LS_CATS[LS_CATS.length - 1];
}
function _lsEvCat(key) {
  return LS_EV_CATS.find(c => c.key === key) || LS_EV_CATS[LS_EV_CATS.length - 1];
}

function _lsAge(dateStr) {
  if (!dateStr) return null;
  const then = new Date(dateStr), now = new Date();
  if (isNaN(then)) return null;
  const months = (now.getFullYear() - then.getFullYear()) * 12 + (now.getMonth() - then.getMonth());
  if (months < 0) return null;
  const yrs = Math.floor(months / 12), mo = months % 12;
  if (yrs === 0 && mo === 0) return 'Just purchased';
  if (yrs === 0) return mo + ' mo old';
  if (mo === 0)  return yrs + (yrs === 1 ? ' yr old' : ' yrs old');
  return `${yrs} yr${yrs > 1 ? 's' : ''} ${mo} mo old`;
}

function _lsWarranty(purchaseDate, warrantyYears) {
  if (!purchaseDate || !warrantyYears) return { cls:'ls-w-none', label:'No Warranty', exp:null };
  const exp = new Date(purchaseDate);
  exp.setFullYear(exp.getFullYear() + Number(warrantyYears));
  const days = Math.round((exp - new Date()) / 86400000);
  const expStr = exp.toLocaleDateString('en-IN', { month:'short', year:'numeric' });
  if (days < 0)  return { cls:'ls-w-exp',  label:'Expired',                  exp:expStr };
  if (days < 90) return { cls:'ls-w-soon', label:`Expires in ${days}d`,      exp:expStr };
  return              { cls:'ls-w-ok',   label:'Warranty Active',           exp:expStr };
}

function _lsLifePct(purchaseDate, lifespanYrs) {
  if (!purchaseDate || !lifespanYrs) return 0;
  return Math.min(100, Math.max(0,
    (new Date() - new Date(purchaseDate)) / (lifespanYrs * 365.25 * 86400000) * 100
  ));
}

function _lsNextOcc(dateStr, recurring) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  if (!recurring) { d.setHours(0,0,0,0); return d; }
  const today = new Date(); today.setHours(0,0,0,0);
  const next = new Date(today.getFullYear(), d.getMonth(), d.getDate());
  if (next < today) next.setFullYear(next.getFullYear() + 1);
  return next;
}

function _lsDays(dateStr, recurring) {
  const occ = _lsNextOcc(dateStr, recurring);
  if (!occ) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  return Math.round((occ - today) / 86400000);
}

function _lsDaysBadge(days) {
  if (days === null) return '';
  if (days === 0)         return `<span class="ls-days-badge ls-day-today">Today!</span>`;
  if (days > 0 && days <= 14) return `<span class="ls-days-badge ls-day-soon">in ${days}d</span>`;
  if (days > 0)           return `<span class="ls-days-badge ls-day-up">in ${days}d</span>`;
  return                         `<span class="ls-days-badge ls-day-past">${Math.abs(days)}d ago</span>`;
}

function renderLifestyle(el) {
  const ls     = APP.lifestyle || { goods:[], events:[] };
  const goods  = ls.goods  || [];
  const events = ls.events || [];
  const today  = new Date(); today.setHours(0,0,0,0);

  // Summary stats
  const warrantyExpiring = goods.filter(g => {
    if (!g.purchaseDate || !g.warrantyYears) return false;
    const exp = new Date(g.purchaseDate);
    exp.setFullYear(exp.getFullYear() + Number(g.warrantyYears));
    const d = Math.round((exp - today) / 86400000);
    return d >= 0 && d <= 90;
  }).length;

  const upcomingEvents = events.filter(ev => {
    const d = _lsDays(ev.date, ev.recurring);
    return d !== null && d >= 0 && d <= 30;
  }).length;

  const dueUpgrade = goods.filter(g => _lsLifePct(g.purchaseDate, g.expectedLifespan) >= 100).length;

  el.innerHTML = `
    <div class="sh">
      <div class="sh-l">
        <div class="sh-title">Lifestyle Tracker</div>
        <div class="sh-sub">Household goods · warranties · important dates</div>
      </div>
      <div class="sh-r" style="gap:8px">
        <button class="btn btn-sm" style="border-color:rgba(255,107,107,.4);color:var(--red);background:rgba(255,107,107,.06)" onclick="openAddEvent()">📅 Add Event</button>
        <button class="btn btn-primary btn-sm" onclick="openAddGood()">${ic('plus',12)} Add Item</button>
      </div>
    </div>

    <div class="strip">
      ${statCard('Household Items',    goods.length || '—',       'red',  'tracked appliances')}
      ${statCard('Warranty Expiring',  warrantyExpiring || '—',   'gld',  'within 3 months')}
      ${statCard('Upcoming Events',    upcomingEvents || '—',     '',     'next 30 days')}
      ${statCard('Due for Upgrade',    dueUpgrade || '—',         'neg',  'past expected life')}
    </div>

    <div class="filter-tabs" style="margin-bottom:20px">
      <button class="ftab${_lsTab === 'goods'  ? ' active' : ''}" onclick="_lsSetTab('goods')">🏠 Household Goods</button>
      <button class="ftab${_lsTab === 'events' ? ' active' : ''}" onclick="_lsSetTab('events')">📅 Events &amp; Notes</button>
    </div>

    <div id="ls-tab-content">
      ${_lsTab === 'goods' ? _renderLsGoods(goods) : _renderLsEvents(events)}
    </div>`;
}

function _lsSetTab(tab) {
  _lsTab = tab;
  const sc = document.getElementById('screen-content');
  if (sc) renderLifestyle(sc);
}

function _renderLsGoods(goods) {
  if (!goods.length) return `
    <div style="text-align:center;padding:60px 20px;color:var(--t3)">
      <div style="font-size:3rem;margin-bottom:12px;opacity:.3">🏠</div>
      <div style="font-family:var(--font-d);font-size:16px;font-weight:700;color:var(--t2);margin-bottom:8px">No items yet</div>
      <div style="font-size:13px;margin-bottom:20px">Track your appliances — TV, fridge, AC and more</div>
      <button class="btn btn-primary btn-sm" onclick="openAddGood()">${ic('plus',12)} Add Your First Item</button>
    </div>`;

  return `<div class="ls-good-grid">${goods.map(_renderGoodCard).join('')}</div>`;
}

function _renderGoodCard(g) {
  const cat      = _lsCat(g.category);
  const age      = _lsAge(g.purchaseDate);
  const warranty = _lsWarranty(g.purchaseDate, g.warrantyYears);
  const lifePct  = _lsLifePct(g.purchaseDate, g.expectedLifespan);
  const fillCls  = lifePct >= 100 ? ' red' : lifePct >= 75 ? ' gold' : '';
  const condClr  = g.condition === 'Good' ? 'var(--accent)' : g.condition === 'Fair' ? 'var(--gold)' : g.condition === 'Poor' ? 'var(--red)' : 'var(--t3)';

  return `<div class="ls-good-card">

    <div class="row" style="justify-content:space-between;align-items:flex-start;gap:10px">
      <div class="row" style="gap:10px;align-items:flex-start;min-width:0">
        <div class="ls-good-icon">${cat.icon}</div>
        <div style="min-width:0">
          <div style="font-weight:600;font-size:14px;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_lsEsc(g.name || '—')}</div>
          <div style="margin-top:3px;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
            <span class="pill p-other" style="font-size:10px">${_lsEsc(cat.key)}</span>
            ${g.brand ? `<span style="font-size:11px;color:var(--t3)">${_lsEsc(g.brand)}${g.model ? ' · ' + _lsEsc(g.model) : ''}</span>` : ''}
          </div>
        </div>
      </div>
      <div class="row" style="gap:4px;flex-shrink:0">
        <button class="btn-icon" onclick="openEditGood('${_lsEsc(g.id)}')">${ic('edit',12)}</button>
        <button class="btn-icon" onclick="deleteGood('${_lsEsc(g.id)}')">${ic('trash',12)}</button>
      </div>
    </div>

    <div class="row" style="justify-content:space-between;margin-top:2px">
      <span style="font-size:13px;font-weight:600;color:var(--t1)">${g.purchasePrice ? fmt(g.purchasePrice) : '<span style="color:var(--t3)">No price set</span>'}</span>
      ${age ? `<span style="font-size:11px;color:var(--t3)">${_lsEsc(age)}</span>` : ''}
    </div>

    <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:4px">
      <span class="${warranty.cls}">${_lsEsc(warranty.label)}</span>
      ${warranty.exp ? `<span style="font-size:11px;color:var(--t3)">Exp: ${_lsEsc(warranty.exp)}</span>` : ''}
    </div>

    ${g.expectedLifespan ? `
    <div>
      <div class="row" style="justify-content:space-between;margin-bottom:5px">
        <span style="font-size:11px;color:var(--t3);text-transform:uppercase;letter-spacing:.05em">Lifespan</span>
        <span style="font-size:11px;font-family:var(--font-m);color:var(--t2)">${((new Date() - new Date(g.purchaseDate || 0)) / (g.expectedLifespan * 365.25 * 86400000)).toFixed(1)} / ${g.expectedLifespan} yrs${lifePct >= 100 ? ' · <span style="color:var(--red)">Overdue</span>' : ''}</span>
      </div>
      <div class="prog"><div class="prog-fill${fillCls}" style="width:${Math.min(100,lifePct).toFixed(1)}%"></div></div>
    </div>` : ''}

    ${g.condition ? `
    <div class="row" style="gap:6px">
      <span style="width:8px;height:8px;border-radius:50%;background:${condClr};flex-shrink:0;display:inline-block"></span>
      <span style="font-size:11.5px;color:var(--t2)">Condition: ${_lsEsc(g.condition)}</span>
    </div>` : ''}

    ${g.upgradeNotes ? `
    <div class="ls-upgrade-note">${ic('alert',11)} <strong style="color:var(--purple)">Upgrade plan:</strong> ${_lsEsc(g.upgradeNotes)}</div>` : ''}

    ${g.notes ? `<div style="font-size:12px;color:var(--t3);border-left:2px solid var(--b2);padding-left:8px;line-height:1.5">${_lsEsc(g.notes)}</div>` : ''}
  </div>`;
}

function _renderLsEvents(events) {
  if (!events.length) return `
    <div style="text-align:center;padding:60px 20px;color:var(--t3)">
      <div style="font-size:3rem;margin-bottom:12px;opacity:.3">📅</div>
      <div style="font-family:var(--font-d);font-size:16px;font-weight:700;color:var(--t2);margin-bottom:8px">No events yet</div>
      <div style="font-size:13px;margin-bottom:20px">Track birthdays, anniversaries, renewals and reminders</div>
      <button class="btn btn-primary btn-sm" onclick="openAddEvent()">${ic('plus',12)} Add Your First Event</button>
    </div>`;

  // Enrich with days-until for sorting
  const enriched = events.map(ev => ({ ev, days: _lsDays(ev.date, ev.recurring) }));
  enriched.sort((a, b) => {
    const da = a.days === null ? Infinity : a.days;
    const db = b.days === null ? Infinity : b.days;
    if (da >= 0 && db >= 0) return da - db;
    if (da < 0  && db < 0)  return db - da;
    return da >= 0 ? -1 : 1;
  });

  const sections = [
    { label:'Today',        items: enriched.filter(e => e.days === 0) },
    { label:'Upcoming',     items: enriched.filter(e => e.days !== null && e.days > 0) },
    { label:'Past / Overdue', items: enriched.filter(e => e.days !== null && e.days < 0) },
    { label:'No Date',      items: enriched.filter(e => e.days === null) },
  ];

  let html = '<div style="display:flex;flex-direction:column;gap:8px">';
  sections.forEach(sec => {
    if (!sec.items.length) return;
    html += `<div style="font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--t3);padding:8px 0 4px;border-bottom:1px solid var(--b1)">${sec.label}</div>`;
    sec.items.forEach(({ ev, days }) => {
      const cat     = _lsEvCat(ev.category);
      const dateStr = _lsFmtEvDate(ev.date, ev.recurring);
      const isToday = days === 0;

      html += `<div class="ls-event-row${isToday ? ' ls-ev-today' : days !== null && days < 0 ? ' ls-ev-past' : ''}">
        <div class="ls-event-icon">${cat.icon}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:14px;color:var(--t1)">${_lsEsc(ev.title || '—')}</div>
          <div class="row" style="gap:6px;margin-top:3px;flex-wrap:wrap">
            <span style="font-size:11px;font-family:var(--font-m);color:var(--t3)">${_lsEsc(dateStr)}</span>
            <span class="pill p-other" style="font-size:10px">${_lsEsc(cat.key)}</span>
          </div>
          ${ev.notes ? `<div style="font-size:12px;color:var(--t3);margin-top:5px;line-height:1.5">${_lsEsc(ev.notes)}</div>` : ''}
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0">
          ${_lsDaysBadge(days)}
          <div class="row" style="gap:4px">
            <button class="btn-icon" onclick="openEditEvent('${_lsEsc(ev.id)}')">${ic('edit',11)}</button>
            <button class="btn-icon" onclick="deleteEvent('${_lsEsc(ev.id)}')">${ic('trash',11)}</button>
          </div>
        </div>
      </div>`;
    });
  });
  html += '</div>';
  return html;
}

function _lsFmtEvDate(dateStr, recurring) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString('en-IN', recurring
    ? { month: 'short', day: 'numeric' }
    : { day: 'numeric', month: 'short', year: 'numeric' }
  ) + (recurring ? ' · Yearly' : '');
}

function _lsEsc(s) {
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── LIFESTYLE CRUD ────────────────────────────────────────────────────────────

function deleteGood(id) {
  const g = (APP.lifestyle.goods || []).find(x => x.id === id);
  if (!g || !confirm(`Delete "${g.name}"?`)) return;
  APP.lifestyle.goods = APP.lifestyle.goods.filter(x => x.id !== id);
  saveLifestyleConfig();
  renderLifestyle(document.getElementById('screen-content'));
}

function deleteEvent(id) {
  const ev = (APP.lifestyle.events || []).find(x => x.id === id);
  if (!ev || !confirm(`Delete "${ev.title}"?`)) return;
  APP.lifestyle.events = APP.lifestyle.events.filter(x => x.id !== id);
  saveLifestyleConfig();
  renderLifestyle(document.getElementById('screen-content'));
}
