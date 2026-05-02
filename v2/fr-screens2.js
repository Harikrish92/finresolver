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
        <div style="font-size:12.5px;color:var(--t2)">Based on ₹${Math.round(avgMonthlyExp/1000)}K avg monthly expenses × 12 × 25</div>
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
    const pfHistLabels  = APP.history.length ? APP.history.map(h=>h.month) : [monthName(APP.monthly.month)];
    const pfNetWorthData = APP.history.length
      ? APP.history.map(h=>h.income-h.expenses+currentValue-totalDebt-10000*(APP.history.length-APP.history.indexOf(h)))
      : [netWorth];
    const pfInvestedData = APP.history.length
      ? APP.history.map((h,i)=>totalInvested-5000*(APP.history.length-1-i))
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
