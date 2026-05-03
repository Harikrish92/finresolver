// ── DATE HELPERS ──────────────────────────────────────────────────────────────
function toISODate(dateStr) {
  if (!dateStr) return new Date().toISOString().split('T')[0];
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  const d = new Date(dateStr);
  if (!isNaN(d)) return d.toISOString().split('T')[0];
  return new Date().toISOString().split('T')[0];
}

// ── EDIT ENTRY MODAL ─────────────────────────────────────────────────────────
function openEditEntry(type, id) {
  const item = APP.monthly[type]?.find(e => e.id === id);
  if (!item) return;
  const labels = { expenses:'Expense', income:'Income', investments:'Investment', loans:'Loan Payment' };
  const label  = labels[type] || type;
  openModal(`
    <div class="modal-hd">
      <div class="modal-title">${ic('edit',14)} Edit ${label}</div>
      <button class="modal-close" onclick="closeModal()">${ic('x',13)}</button>
    </div>
    <div class="modal-body">
      <div class="inp-grp">
        <div class="inp-label">Description</div>
        <input class="inp" id="ee-desc" value="${item.desc}" autofocus>
      </div>
      <div class="g-2">
        <div class="inp-grp">
          <div class="inp-label">Amount (₹)</div>
          <input class="inp" id="ee-amt" type="number" value="${item.amount}">
        </div>
        <div class="inp-grp">
          <div class="inp-label">Date</div>
          <input class="inp" id="ee-date" type="date" value="${toISODate(item.date)}">
        </div>
      </div>
      ${type==='investments'?`
        <div class="inp-grp">
          <div class="inp-label">Linked Ticker (optional)</div>
          <input class="inp" id="ee-linked" value="${item.linked||''}">
        </div>` : ''}
      ${type==='loans'?`
        <div class="inp-grp">
          <div class="inp-label">Linked Loan</div>
          <select class="sel" id="ee-loan">
            <option value="">— None —</option>
            ${APP.loans.map(l=>`<option value="${l.id}"${l.id===item.loanId?' selected':''}>${l.name}</option>`).join('')}
          </select>
        </div>` : ''}
    </div>
    <div class="modal-ft">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="confirmEditEntry('${type}',${id})">Save Changes</button>
    </div>
  `);
}

function confirmEditEntry(type, id) {
  const item = APP.monthly[type]?.find(e => e.id === id);
  if (!item) return;
  const desc = document.getElementById('ee-desc')?.value.trim();
  const amt  = parseFloat(document.getElementById('ee-amt')?.value) || 0;
  const date = document.getElementById('ee-date')?.value.trim() || '';
  if (!desc || !amt) { alert('Please fill description and amount.'); return; }

  if (type === 'loans') {
    const prevLoanId    = item.loanId;
    const prevPaymentId = item.paymentId;
    const newLoanId     = parseInt(document.getElementById('ee-loan')?.value) || null;
    item.desc = desc; item.amount = amt; item.date = date; item.loanId = newLoanId;
    if (prevPaymentId) {
      if (!newLoanId) {
        autoRemoveLoanPayment(prevLoanId, prevPaymentId);
        delete item.paymentId;
      } else if (prevLoanId !== newLoanId) {
        autoRemoveLoanPayment(prevLoanId, prevPaymentId);
        delete item.paymentId;
        autoLogLoanPayment(item);
      } else {
        autoUpdateLoanPayment(item);
      }
    } else if (newLoanId) {
      autoLogLoanPayment(item);
    }
  } else {
    item.desc   = desc;
    item.amount = amt;
    item.date   = date;
    if (type === 'investments') item.linked = document.getElementById('ee-linked')?.value.trim() || '';
  }

  closeModal();
  navigate('monthly');
}

// ── ADD ENTRY MODAL (expenses / income / investments / loans) ─────────────────
function openAddEntry(type) {
  const labels = { expenses:'Expense', income:'Income', investments:'Investment', loans:'Loan Payment' };
  const label = labels[type] || type;
  openModal(`
    <div class="modal-hd">
      <div class="modal-title">${ic('plus',14)} Add ${label}</div>
      <button class="modal-close" onclick="closeModal()">${ic('x',13)}</button>
    </div>
    <div class="modal-body">
      <div class="inp-grp">
        <div class="inp-label">Description</div>
        <input class="inp" id="ae-desc" placeholder="e.g. Grocery run, Salary…" autofocus>
      </div>
      <div class="g-2">
        <div class="inp-grp">
          <div class="inp-label">Amount (₹)</div>
          <input class="inp" id="ae-amt" type="number" placeholder="0">
        </div>
        <div class="inp-grp">
          <div class="inp-label">Date</div>
          <input class="inp" id="ae-date" type="date" value="${new Date().toISOString().split('T')[0]}">
        </div>
      </div>
      ${type==='investments'?`
        <div class="inp-grp">
          <div class="inp-label">Linked Ticker (optional)</div>
          <input class="inp" id="ae-linked" placeholder="e.g. NIFTYBEES.NS">
        </div>` : ''}
      ${type==='loans'?`
        <div class="inp-grp">
          <div class="inp-label">Linked Loan</div>
          <select class="sel" id="ae-loan">
            <option value="">— None —</option>
            ${APP.loans.map(l=>`<option value="${l.id}">${l.name}</option>`).join('')}
          </select>
        </div>` : ''}
    </div>
    <div class="modal-ft">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="confirmAddEntry('${type}')">Add ${label}</button>
    </div>
  `);
}

function confirmAddEntry(type) {
  const desc = document.getElementById('ae-desc')?.value.trim();
  const amt  = parseFloat(document.getElementById('ae-amt')?.value) || 0;
  const date = document.getElementById('ae-date')?.value.trim() || '';
  if (!desc || !amt) { alert('Please fill description and amount.'); return; }
  const newId = Math.max(0, ...APP.monthly[type].map(e=>e.id)) + 1;
  const entry = { id:newId, desc, amount:amt, date };
  if (type==='investments') entry.linked = document.getElementById('ae-linked')?.value.trim()||'';
  if (type==='loans') {
    entry.loanId = parseInt(document.getElementById('ae-loan')?.value) || null;
    if (entry.loanId) autoLogLoanPayment(entry);
  }
  APP.monthly[type].push(entry);
  closeModal();
  navigate('monthly');
}

// ── ADD / EDIT LOAN ───────────────────────────────────────────────────────────
function openAddLoan() {
  openModal(`
    <div class="modal-hd">
      <div class="modal-title">${ic('card',14)} Add New Loan</div>
      <button class="modal-close" onclick="closeModal()">${ic('x',13)}</button>
    </div>
    <div class="modal-body">
      <div class="g-2">
        <div class="inp-grp">
          <div class="inp-label">Loan Name</div>
          <input class="inp" id="al-name" placeholder="e.g. Home Loan" autofocus>
        </div>
        <div class="inp-grp">
          <div class="inp-label">Lender</div>
          <input class="inp" id="al-lender" placeholder="e.g. SBI, HDFC">
        </div>
      </div>
      <div class="inp-grp">
        <div class="inp-label">Loan Type</div>
        <select class="sel" id="al-type">
          <option>Home</option><option>Vehicle</option><option>Personal</option>
          <option>Education</option><option>Business</option><option>Other</option>
        </select>
      </div>
      <div class="g-2">
        <div class="inp-grp">
          <div class="inp-label">Principal (₹)</div>
          <input class="inp" id="al-principal" type="number" placeholder="0">
        </div>
        <div class="inp-grp">
          <div class="inp-label">Interest Rate (% p.a.)</div>
          <input class="inp" id="al-rate" type="number" step="0.1" placeholder="8.5">
        </div>
      </div>
      <div class="g-2">
        <div class="inp-grp">
          <div class="inp-label">Tenure (months)</div>
          <input class="inp" id="al-tenure" type="number" placeholder="240">
        </div>
        <div class="inp-grp">
          <div class="inp-label">Start Date</div>
          <input class="inp" id="al-start" type="date">
        </div>
      </div>
      <div id="al-emi-preview" style="background:var(--a10);border:1px solid var(--a20);border-radius:var(--rs);padding:12px 14px;font-size:13px;color:var(--accent);display:none">
        Estimated EMI: <strong id="al-emi-val"></strong>
      </div>
    </div>
    <div class="modal-ft">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="confirmAddLoan()">Add Loan</button>
    </div>
  `);

  // live EMI preview
  ['al-principal','al-rate','al-tenure'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => {
      const p = parseFloat(document.getElementById('al-principal')?.value)||0;
      const r = parseFloat(document.getElementById('al-rate')?.value)||0;
      const n = parseInt(document.getElementById('al-tenure')?.value)||0;
      if (p && r && n) {
        const emi = Math.round(calcEMI(p,r,n));
        document.getElementById('al-emi-preview').style.display = '';
        document.getElementById('al-emi-val').textContent = fmt(emi)+'/month';
      }
    });
  });
}

function confirmAddLoan() {
  const name = document.getElementById('al-name')?.value.trim();
  const lender = document.getElementById('al-lender')?.value.trim();
  const type = document.getElementById('al-type')?.value;
  const principal = parseFloat(document.getElementById('al-principal')?.value)||0;
  const rate = parseFloat(document.getElementById('al-rate')?.value)||0;
  const tenure = parseInt(document.getElementById('al-tenure')?.value)||0;
  const startDate = document.getElementById('al-start')?.value || new Date().toISOString().split('T')[0];
  if (!name || !principal || !rate || !tenure) { alert('Please fill all required fields.'); return; }
  const newId = Math.max(0, ...APP.loans.map(l=>l.id)) + 1;
  APP.loans.push({ id:newId, name, lender, type, principal, rate, tenure, startDate, emiOverride:null, payments:[] });
  if (typeof saveLoansConfig === 'function') saveLoansConfig();
  closeModal();
  navigate('loans');
}

// ── LOG PAYMENT ───────────────────────────────────────────────────────────────
function openLogPayment(loanId) {
  const loan = APP.loans.find(l=>l.id===loanId);
  if (!loan) return;
  const emi = loanEMI(loan);
  openModal(`
    <div class="modal-hd">
      <div class="modal-title">${ic('check',14)} Log Payment — ${loan.name}</div>
      <button class="modal-close" onclick="closeModal()">${ic('x',13)}</button>
    </div>
    <div class="modal-body">
      <div class="g-2">
        <div class="inp-grp">
          <div class="inp-label">Amount (₹)</div>
          <input class="inp" id="lp-amt" type="number" value="${emi}">
        </div>
        <div class="inp-grp">
          <div class="inp-label">Date</div>
          <input class="inp" id="lp-date" type="date" value="${new Date().toISOString().split('T')[0]}">
        </div>
      </div>
      <div class="inp-grp">
        <div class="inp-label">Note</div>
        <input class="inp" id="lp-note" placeholder="e.g. Monthly EMI, Prepayment…" value="Monthly EMI">
      </div>
    </div>
    <div class="modal-ft">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="confirmLogPayment(${loanId})">Log Payment</button>
    </div>
  `);
}

function confirmLogPayment(loanId) {
  const loan = APP.loans.find(l=>l.id===loanId);
  if (!loan) return;
  const amt  = parseFloat(document.getElementById('lp-amt')?.value)||0;
  const date = document.getElementById('lp-date')?.value.trim()||'';
  const note = document.getElementById('lp-note')?.value.trim()||'';
  loan.payments.unshift({ id:'p'+Date.now(), date, amount:amt, note });
  if (typeof saveLoansConfig === 'function') saveLoansConfig();
  closeModal();
  navigate('loan-detail');
}

// ── ADD INVESTMENT ────────────────────────────────────────────────────────────
function openAddInv() {
  openModal(`
    <div class="modal-hd">
      <div class="modal-title">${ic('trending',14)} Add Investment Holding</div>
      <button class="modal-close" onclick="closeModal()">${ic('x',13)}</button>
    </div>
    <div class="modal-body">
      <div class="inp-grp">
        <div class="inp-label">Category</div>
        <div class="filter-tabs" style="flex-wrap:wrap">
          ${['Stock','MF','FD','Bond','EPF','ESOP','Real Estate','Gold','Others'].map((c,i)=>
            `<button class="ftab${i===0?' active':''}" onclick="this.closest('.filter-tabs').querySelectorAll('.ftab').forEach(b=>b.classList.remove('active'));this.classList.add('active');document.getElementById('ai-cat').value='${c}';_refreshAddInvLabels()">${c}</button>`
          ).join('')}
        </div>
        <input type="hidden" id="ai-cat" value="Stock">
      </div>
      <div class="g-2">
        <div class="inp-grp">
          <div class="inp-label">Investment Name</div>
          <input class="inp" id="ai-name" placeholder="e.g. Reliance Industries" autofocus>
        </div>
        <div class="inp-grp">
          <div class="inp-label">Ticker Symbol (optional)</div>
          <input class="inp" id="ai-ticker" placeholder="e.g. RELIANCE.NS">
        </div>
      </div>
      <div class="g-2">
        <div class="inp-grp">
          <div class="inp-label" id="ai-qty-label">Quantity / Units</div>
          <input class="inp" id="ai-qty" type="number" placeholder="0">
        </div>
        <div class="inp-grp">
          <div class="inp-label" id="ai-price-label">Average Buy Price (₹)</div>
          <input class="inp" id="ai-price" type="number" placeholder="0">
        </div>
      </div>
      <div class="inp-grp">
        <div class="inp-label">Purchase Date</div>
        <input class="inp" id="ai-date" type="date">
      </div>
    </div>
    <div class="modal-ft">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="confirmAddInv()">Add Holding</button>
    </div>
  `, 'modal-lg');
}

function _refreshAddInvLabels() {
  const cat   = document.getElementById('ai-cat')?.value;
  const isGold = cat === 'Gold';
  const isEPF  = cat === 'EPF';
  const isRE   = cat === 'Real Estate';
  const ql = document.getElementById('ai-qty-label');
  const pl = document.getElementById('ai-price-label');
  if (ql) ql.textContent = isGold ? 'Weight (grams)' : isEPF ? 'Units (enter 1)' : 'Quantity / Units';
  if (pl) pl.textContent = isGold ? 'Buy Price (₹/g)' : isEPF ? 'Total Contributed (₹)' : isRE ? 'Buy Price (₹)' : 'Average Buy Price (₹)';
}

function confirmAddInv() {
  const name  = document.getElementById('ai-name')?.value.trim();
  const cat   = document.getElementById('ai-cat')?.value||'Stock';
  const ticker= document.getElementById('ai-ticker')?.value.trim()||'';
  const qty   = parseFloat(document.getElementById('ai-qty')?.value)||0;
  const price = parseFloat(document.getElementById('ai-price')?.value)||0;
  const date  = document.getElementById('ai-date')?.value||'';
  if (!name || !qty || !price) { alert('Please fill name, quantity and price.'); return; }
  const newId = Math.max(0,...APP.investments.map(i=>i.id))+1;
  APP.investments.push({ id:newId, name, ticker, cat, qty, avgPrice:price, livePrice:price, lots:[{date,qty,price}] });
  if (typeof saveInvestmentsConfig === 'function') saveInvestmentsConfig();
  closeModal();
  navigate('investments');
}

// ── IMPORT MODAL ──────────────────────────────────────────────────────────────
function openImport() {
  openModal(`
    <div class="modal-hd">
      <div class="modal-title">${ic('upload',14)} Import Monthly Data</div>
      <button class="modal-close" onclick="closeModal()">${ic('x',13)}</button>
    </div>
    <div class="modal-body">
      <div class="dropzone" onclick="document.getElementById('import-file').click()">
        <div style="margin-bottom:10px;font-size:28px">📂</div>
        <div style="font-weight:600;font-size:13.5px;margin-bottom:4px">Drop your file here or click to browse</div>
        <div style="font-size:12px">Supports .xlsx, .xls, .csv — columns A–H auto-detected</div>
        <input type="file" id="import-file" accept=".xlsx,.xls,.csv" style="display:none" onchange="previewImport(this)">
      </div>
      <div style="background:var(--s2);border:1px solid var(--b);border-radius:var(--rs);padding:12px 14px">
        <div style="font-size:11.5px;font-weight:600;color:var(--t2);margin-bottom:8px">Expected column layout</div>
        <div class="row" style="gap:6px;flex-wrap:wrap">
          ${['A: Type','B: Description','C: Amount','D: Date','E: Category','F: Notes','G: Linked','H: Tags'].map(c=>`<span class="pill p-other">${c}</span>`).join('')}
        </div>
      </div>
      <div id="import-preview" style="display:none">
        <div style="font-size:12px;color:var(--accent);margin-bottom:8px">✓ File detected · Preview (first 5 rows)</div>
        <div class="tbl-wrap"><table class="tbl" id="import-preview-tbl"></table></div>
      </div>
    </div>
    <div class="modal-ft">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="closeModal();alert('Data imported successfully!')">Import Data</button>
    </div>
  `);
}

function previewImport(input) {
  if (!input.files.length) return;
  document.getElementById('import-preview').style.display = '';
  // Simulate preview
  document.getElementById('import-preview-tbl').innerHTML = `
    <thead><tr><th>Type</th><th>Description</th><th>Amount</th><th>Date</th></tr></thead>
    <tbody>
      <tr><td><span class="pill p-other">income</span></td><td>Salary</td><td class="mono text-pos">₹85,000</td><td class="muted">01 Apr</td></tr>
      <tr><td><span class="pill p-other">expense</span></td><td>Rent</td><td class="mono text-neg">₹20,000</td><td class="muted">01 Apr</td></tr>
      <tr><td><span class="pill p-other">invest</span></td><td>SIP</td><td class="mono text-blu">₹10,000</td><td class="muted">05 Apr</td></tr>
    </tbody>`;
}

// ── EDIT INVESTMENT ───────────────────────────────────────────────────────────
function openEditInv(id) {
  const inv = APP.investments.find(i => String(i.id) === String(id));
  if (!inv) return;
  const invCat = _invCat(inv);
  const isGold = invCat === 'Gold';
  const cats = ['Stock','MF','FD','Bond','EPF','ESOP','Real Estate','Gold','Others'];
  openModal(`
    <div class="modal-hd">
      <div class="modal-title">${ic('edit',14)} Edit Holding</div>
      <button class="modal-close" onclick="closeModal()">${ic('x',13)}</button>
    </div>
    <div class="modal-body">
      <div class="inp-grp">
        <div class="inp-label">Category</div>
        <div class="filter-tabs" style="flex-wrap:wrap">
          ${cats.map(c =>
            `<button class="ftab${c===invCat?' active':''}" onclick="
              this.closest('.filter-tabs').querySelectorAll('.ftab').forEach(b=>b.classList.remove('active'));
              this.classList.add('active');
              document.getElementById('ei-cat').value='${c}';
              _refreshEditInvLabels()">${c}</button>`
          ).join('')}
        </div>
        <input type="hidden" id="ei-cat" value="${invCat}">
      </div>
      <div class="g-2">
        <div class="inp-grp">
          <div class="inp-label">Investment Name</div>
          <input class="inp" id="ei-name" value="${inv.name}" autofocus>
        </div>
        <div class="inp-grp">
          <div class="inp-label">Ticker Symbol</div>
          <input class="inp" id="ei-ticker" value="${inv.ticker||''}">
        </div>
      </div>
      <div class="g-2">
        <div class="inp-grp">
          <div class="inp-label" id="ei-qty-label">${isGold?'Weight (grams)':'Quantity / Units'}</div>
          <input class="inp" id="ei-qty" type="number" value="${isGold?_invTotalQty(inv):_invTotalQty(inv)}">
        </div>
        <div class="inp-grp">
          <div class="inp-label" id="ei-price-label">${isGold?'Buy Price (₹/g)':'Avg Buy Price (₹)'}</div>
          <input class="inp" id="ei-price" type="number" value="${isGold?_invGoldBuyPrice(inv):_invAvgPrice(inv)}">
        </div>
      </div>
      <div class="inp-grp">
        <div class="inp-label" id="ei-live-label">Live Price (₹${isGold?'/g':''})</div>
        <input class="inp" id="ei-live" type="number" value="${inv.livePrice||0}">
      </div>
    </div>
    <div class="modal-ft">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="confirmEditInv('${id}')">Save Changes</button>
    </div>
  `, 'modal-lg');
}

function _refreshEditInvLabels() {
  const cat    = document.getElementById('ei-cat')?.value;
  const isGold = cat === 'Gold';
  const isEPF  = cat === 'EPF';
  const isRE   = cat === 'Real Estate';
  const ql = document.getElementById('ei-qty-label');
  const pl = document.getElementById('ei-price-label');
  const ll = document.getElementById('ei-live-label');
  if (ql) ql.textContent = isGold ? 'Weight (grams)' : isEPF ? 'Units (enter 1)' : 'Quantity / Units';
  if (pl) pl.textContent = isGold ? 'Buy Price (₹/g)' : isEPF ? 'Total Contributed (₹)' : isRE ? 'Buy Price (₹)' : 'Avg Buy Price (₹)';
  if (ll) ll.textContent = isGold ? 'Live Price (₹/g)' : isEPF ? 'Current EPF Balance (₹)' : 'Live Price (₹)';
}

function confirmEditInv(id) {
  const inv = APP.investments.find(i => String(i.id) === String(id));
  if (!inv) return;
  const name   = document.getElementById('ei-name')?.value.trim();
  const cat    = document.getElementById('ei-cat')?.value || inv.cat;
  const ticker = document.getElementById('ei-ticker')?.value.trim() || '';
  const qty    = parseFloat(document.getElementById('ei-qty')?.value) || 0;
  const price  = parseFloat(document.getElementById('ei-price')?.value) || 0;
  const live   = parseFloat(document.getElementById('ei-live')?.value) || price;
  if (!name || !qty || !price) { alert('Please fill name, quantity/weight and price.'); return; }

  inv.name      = name;
  inv.cat       = cat;
  inv.ticker    = ticker;
  inv.livePrice = live;
  if (cat === 'Gold') {
    inv.grams    = qty;
    inv.buyPrice = price;
    delete inv.qty;
    delete inv.avgPrice;
    delete inv.lots;
  } else {
    inv.qty      = qty;
    inv.avgPrice = price;
    delete inv.grams;
    delete inv.buyPrice;
    const prevDate = inv.lots && inv.lots.length ? inv.lots[0].date : '';
    inv.lots = [{ date: prevDate, qty, price }];
  }

  if (typeof saveInvestmentsConfig === 'function') saveInvestmentsConfig();
  closeModal();
  navigate(_screen);
}

// ── EDIT LOAN ─────────────────────────────────────────────────────────────────
function openEditLoan(id) {
  const loan = APP.loans.find(l => l.id === id);
  if (!loan) return;
  openModal(`
    <div class="modal-hd">
      <div class="modal-title">${ic('edit',14)} Edit Loan</div>
      <button class="modal-close" onclick="closeModal()">${ic('x',13)}</button>
    </div>
    <div class="modal-body">
      <div class="g-2">
        <div class="inp-grp">
          <div class="inp-label">Loan Name</div>
          <input class="inp" id="el-name" value="${loan.name}" autofocus>
        </div>
        <div class="inp-grp">
          <div class="inp-label">Lender</div>
          <input class="inp" id="el-lender" value="${loan.lender||''}">
        </div>
      </div>
      <div class="inp-grp">
        <div class="inp-label">Loan Type</div>
        <select class="sel" id="el-type">
          ${['Home','Vehicle','Personal','Education','Business','Other'].map(t =>
            `<option${t===loan.type?' selected':''}>${t}</option>`).join('')}
        </select>
      </div>
      <div class="g-2">
        <div class="inp-grp">
          <div class="inp-label">Principal (₹)</div>
          <input class="inp" id="el-principal" type="number" value="${loan.principal}">
        </div>
        <div class="inp-grp">
          <div class="inp-label">Interest Rate (% p.a.)</div>
          <input class="inp" id="el-rate" type="number" step="0.1" value="${_loanRate(loan)}">
        </div>
      </div>
      <div class="g-2">
        <div class="inp-grp">
          <div class="inp-label">Tenure (months)</div>
          <input class="inp" id="el-tenure" type="number" value="${_loanTenure(loan)}">
        </div>
        <div class="inp-grp">
          <div class="inp-label">Start Date</div>
          <input class="inp" id="el-start" type="date" value="${loan.startDate}">
        </div>
      </div>
      <div class="inp-grp">
        <div class="inp-label">EMI Override (₹) <span style="font-size:11px;color:var(--t3);font-weight:400">— leave blank to auto-calculate</span></div>
        <input class="inp" id="el-emi" type="number" placeholder="Auto" value="${loan.emiOverride||''}">
      </div>
    </div>
    <div class="modal-ft">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="confirmEditLoan(${id})">Save Changes</button>
    </div>
  `);
}

function confirmEditLoan(id) {
  const loan = APP.loans.find(l => l.id === id);
  if (!loan) return;
  const name      = document.getElementById('el-name')?.value.trim();
  const lender    = document.getElementById('el-lender')?.value.trim() || '';
  const type      = document.getElementById('el-type')?.value;
  const principal = parseFloat(document.getElementById('el-principal')?.value) || 0;
  const rate      = parseFloat(document.getElementById('el-rate')?.value) || 0;
  const tenure    = parseInt(document.getElementById('el-tenure')?.value) || 0;
  const startDate = document.getElementById('el-start')?.value || loan.startDate;
  const emiRaw    = document.getElementById('el-emi')?.value.trim();
  const emiOverride = emiRaw ? (parseFloat(emiRaw) || null) : null;
  if (!name || !principal || !rate || !tenure) { alert('Please fill all required fields.'); return; }

  loan.name        = name;
  loan.lender      = lender;
  loan.type        = type;
  loan.principal   = principal;
  loan.rate        = rate;
  loan.tenure      = tenure;
  loan.startDate   = startDate;
  loan.emiOverride = emiOverride;

  if (typeof saveLoansConfig === 'function') saveLoansConfig();
  closeModal();
  navigate(_screen === 'loan-detail' ? 'loan-detail' : 'loans');
}

// ── INVESTMENT IMPORT ─────────────────────────────────────────────────────────
let _invImportParsed = null;
let _invImportBroker = 'auto';

const _INV_BROKERS = [
  { key:'auto',     label:'Auto-detect' },
  { key:'zerodha',  label:'Zerodha' },
  { key:'groww',    label:'Groww' },
  { key:'indmoney', label:'INDmoney' },
  { key:'generic',  label:'Generic CSV' },
];

const _INV_IMPORT_COLS = {
  name:     ['name','stock','company','fund','security','scrip','instrument','tradingsymbol'],
  ticker:   ['ticker','symbol','code','trading symbol','script'],
  isin:     ['isin'],
  qty:      ['qty','quantity','units','shares','lot','holding','balance'],
  avgPrice: ['avg','average','price','buy price','cost','nav','rate','ltp','close price','last price'],
  category: ['category','type','asset','class','segment','instrument type'],
  date:     ['date','purchased','buy date','trade date'],
};

const _INV_CAT_ALIASES = {
  stock:'Stock', stocks:'Stock', equity:'Stock', eq:'Stock', equities:'Stock',
  mf:'MF', 'mutual fund':'MF', mutualfund:'MF', fund:'MF', etf:'MF',
  bond:'Bond', bonds:'Bond', ncd:'Bond', fd:'FD', 'fixed deposit':'FD', debt:'Bond',
  realestate:'Real Estate', 'real estate':'Real Estate', property:'Real Estate',
  others:'Others', other:'Others', misc:'Others', commodity:'Others',
  gold:'Gold', epf:'EPF', esop:'ESOP',
};

function openInvImport() {
  _invImportParsed = null;
  _invImportBroker = 'auto';
  openModal(`
    <div class="modal-hd">
      <div class="modal-title">${ic('upload',14)} Import Investment Holdings</div>
      <button class="modal-close" onclick="closeModal()">${ic('x',13)}</button>
    </div>
    <div class="modal-body">
      <div class="inp-grp">
        <div class="inp-label">Select Broker / Format</div>
        <div class="broker-grid">
          ${_INV_BROKERS.map(b=>`<div class="broker-btn${b.key==='auto'?' sel':''}" data-broker="${b.key}" onclick="_selInvBroker('${b.key}')">${b.label}</div>`).join('')}
        </div>
      </div>
      <div class="dropzone" id="inv-dropzone"
        onclick="document.getElementById('inv-import-file').click()"
        ondragover="event.preventDefault();this.classList.add('drag-over')"
        ondragleave="this.classList.remove('drag-over')"
        ondrop="event.preventDefault();this.classList.remove('drag-over');_handleInvImportFile(event.dataTransfer.files[0])">
        <div style="margin-bottom:8px;font-size:24px">📊</div>
        <div style="font-weight:600;font-size:13px;margin-bottom:3px">Drop broker export here or click to browse</div>
        <div style="font-size:11.5px;color:var(--t3)">Supports .csv, .xlsx, .xls</div>
        <input type="file" id="inv-import-file" accept=".xlsx,.xls,.csv" style="display:none"
          onchange="_handleInvImportFile(this.files[0])">
      </div>
      <div id="inv-import-preview"></div>
      <div style="background:var(--s2);border:1px solid var(--b);border-radius:var(--rs);padding:11px 14px">
        <div style="font-size:12px;color:var(--t2);line-height:1.7">
          ${ic('info',12)} <strong>Zerodha:</strong> Console → Holdings → Download → Holdings Statement (XLSX)<br>
          <strong style="margin-left:19px">Groww:</strong> Profile → Reports → Holdings Statement (XLSX)<br>
          <strong style="margin-left:19px">Generic:</strong> Any CSV with columns: Name, Qty, Avg Price, Category
        </div>
      </div>
    </div>
    <div class="modal-ft">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="inv-import-btn" disabled onclick="_confirmInvImport()">Import Holdings</button>
    </div>
  `, 'modal-lg');
}

function _selInvBroker(key) {
  _invImportBroker = key;
  document.querySelectorAll('.broker-btn').forEach(b => b.classList.remove('sel'));
  document.querySelector(`.broker-btn[data-broker="${key}"]`)?.classList.add('sel');
}

async function _handleInvImportFile(file) {
  if (!file) return;
  const preview = document.getElementById('inv-import-preview');
  if (preview) preview.innerHTML = `<div style="padding:12px;text-align:center;color:var(--t3);font-size:12.5px">Parsing file…</div>`;

  try {
    let rows = [];
    const name = file.name.toLowerCase();
    if (name.endsWith('.csv')) {
      rows = _parseInvCsv(await file.text());
    } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      if (typeof XLSX === 'undefined') throw new Error('XLSX library not loaded. Please refresh and try again.');
      const wb = XLSX.read(await file.arrayBuffer(), { type:'array' });
      // Prefer "Combined" sheet for multi-sheet Zerodha exports
      let sheetName = wb.SheetNames[0];
      for (const sn of wb.SheetNames) {
        if (sn.toLowerCase().includes('combined')) { sheetName = sn; break; }
      }
      rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header:1, defval:'' });
    } else {
      throw new Error('Unsupported file type. Please upload a .csv, .xlsx or .xls file.');
    }

    // Strip completely empty rows
    rows = rows.filter(r => r.some(c => String(c||'').trim() !== ''));
    if (rows.length < 2) throw new Error('File appears empty or has only one row.');

    // Skip metadata rows at top (e.g. Zerodha title/summary rows) to find real header
    rows = rows.slice(_findInvHeaderRow(rows));

    const header = rows[0].map(h => String(h||'').trim().toLowerCase());
    const cols   = _detectInvCols(header);

    let parsed;
    if (_isZerodhaNewFormat(header)) {
      parsed = _parseZerodhaHoldingsRows(rows[0], rows.slice(1));
    } else if (_isGrowwMFFormat(header)) {
      parsed = _parseGrowwMFRows(rows[0], rows.slice(1));
    } else {
      if (cols.name === undefined && cols.ticker === undefined)
        throw new Error('Could not detect a Name or Ticker/Symbol column. Check the file or use the Generic CSV format.');
      parsed = _parseInvRows(rows.slice(1), cols);
    }
    if (!parsed.length) throw new Error('No valid holdings found in this file.');

    _invImportParsed = parsed;
    _renderInvImportPreview(parsed);

    const btn = document.getElementById('inv-import-btn');
    if (btn) { btn.disabled = false; btn.textContent = `Import ${parsed.length} Holding${parsed.length!==1?'s':''}`; }
  } catch(e) {
    if (preview) preview.innerHTML = `<div style="margin-top:10px;padding:11px 14px;background:var(--r10);border:1px solid rgba(255,92,122,.25);border-radius:var(--rs);color:var(--red);font-size:12.5px">${ic('alert',13)} ${e.message}</div>`;
    _invImportParsed = null;
    const btn = document.getElementById('inv-import-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Import Holdings'; }
  }
}

function _parseInvCsv(text) {
  return text.trim().split(/\r?\n/).map(line => {
    const row = []; let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i+1] === '"') { cur += '"'; i++; } else inQ = !inQ;
      } else if (ch === ',' && !inQ) { row.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    row.push(cur.trim());
    return row;
  });
}

function _detectInvCols(header) {
  const map = {};
  header.forEach((h, i) => {
    for (const [key, terms] of Object.entries(_INV_IMPORT_COLS)) {
      if (map[key] === undefined && terms.some(t => h.includes(t))) map[key] = i;
    }
  });
  return map;
}

function _findInvHeaderRow(rows) {
  const knownHeaders = ['symbol','isin','instrument','tradingsymbol','qty','quantity','average price','avg cost','nav','scheme name','fund name','stock','company','units','folio'];
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const cells = rows[i].map(c => String(c||'').trim().toLowerCase());
    if (cells.filter(c => knownHeaders.some(h => c.includes(h))).length >= 2) return i;
  }
  return 0;
}

function _isZerodhaNewFormat(header) {
  const has = kw => header.some(h => h.includes(kw));
  return has('previous closing') || (has('symbol') && has('isin') && (has('average price') || has('avg. cost') || has('avg cost')));
}

function _parseZerodhaHoldingsRows(headerRow, dataRows) {
  const h      = headerRow.map(c => String(c||'').trim().toLowerCase());
  const col    = kw => h.findIndex(x => x.includes(kw));
  const symI   = col('symbol');
  const isinI  = col('isin');
  const qtyI   = (() => { const i = col('quantity available'); return i >= 0 ? i : col('quantity'); })();
  const priceI = (() => {
    for (const kw of ['average price', 'avg. cost', 'avg cost', 'average cost', 'avg price']) {
      const i = col(kw); if (i >= 0) return i;
    }
    return -1;
  })();
  const instrI = col('instrument type');
  return dataRows
    .filter(r => r.some(c => String(c||'').trim() !== ''))
    .map(r => {
      const sym = String(r[symI]||'').trim();
      if (!sym || sym.toLowerCase() === 'symbol') return null;
      const isin      = isinI  >= 0 ? String(r[isinI] ||'').trim() : '';
      const instrType = instrI >= 0 ? String(r[instrI]||'').trim() : '';
      const cat       = (instrType && instrType !== '-') ? 'MF' : 'Stock';
      const qty       = parseFloat(String(r[qtyI]  ||'').replace(/,/g,'')) || 0;
      const price     = parseFloat(String(r[priceI]||'').replace(/[₹,\s]/g,'').replace(/[^0-9.]/g,'')) || 0;
      return { name:sym, ticker:'', isin, cat, qty, avgPrice:price, date:'', source:'Zerodha' };
    })
    .filter(Boolean);
}

function _isGrowwMFFormat(header) {
  const has = kw => header.some(h => h.includes(kw));
  return has('scheme name') && (has('units') || has('folio') || has('invested value'));
}

function _parseGrowwMFRows(headerRow, dataRows) {
  const h         = headerRow.map(c => String(c||'').trim().toLowerCase());
  const col       = kw => h.findIndex(x => x.includes(kw));
  const nameI     = col('scheme name');
  const unitsI    = col('units');
  const investedI = col('invested value');
  const isinI     = col('isin');

  return dataRows
    .filter(r => r.some(c => String(c||'').trim() !== ''))
    .map(r => {
      const name = String(r[nameI]||'').trim();
      if (!name || name.toLowerCase() === 'scheme name') return null;
      const qty      = parseFloat(String(r[unitsI]    ||'').replace(/,/g,'')) || 0;
      const invested = parseFloat(String(r[investedI] ||'').replace(/[₹,\s]/g,'').replace(/[^0-9.]/g,'')) || 0;
      const isin     = isinI >= 0 ? String(r[isinI]||'').trim() : '';
      const avgPrice = qty > 0 ? invested / qty : 0;
      return { name, ticker:'', isin, cat:'MF', qty, avgPrice, date:'', source:'Groww' };
    })
    .filter(Boolean);
}

function _parseInvRows(rows, cols) {
  const get = (row, idx) => idx !== undefined ? String(row[idx]||'').trim() : '';
  return rows.map(row => {
    const name     = get(row, cols.name);
    const ticker   = get(row, cols.ticker);
    const isin     = get(row, cols.isin);
    const qtyRaw   = get(row, cols.qty);
    const priceRaw = get(row, cols.avgPrice);
    const catRaw   = get(row, cols.category).toLowerCase();
    const date     = get(row, cols.date);

    if (!name && !ticker) return null;

    const qty   = parseFloat(qtyRaw.replace(/,/g,'')) || 0;
    const price = parseFloat(priceRaw.replace(/[₹,\s]/g,'').replace(/[^0-9.]/g,'')) || 0;
    const cat   = _INV_CAT_ALIASES[catRaw] || (['Stock','MF','FD','Bond','EPF','ESOP','Real Estate','Gold','Others'].includes(catRaw) ? catRaw : 'Stock');

    const _srcLabel = _INV_BROKERS.find(b => b.key === _invImportBroker)?.label || _invImportBroker;
    return { name: name || ticker, ticker, isin, cat, qty, avgPrice: price, date, source: _srcLabel };
  }).filter(Boolean);
}

function _renderInvImportPreview(parsed) {
  const preview = document.getElementById('inv-import-preview');
  if (!preview) return;
  const show = parsed.slice(0, 5);
  preview.innerHTML = `
    <div style="margin-top:12px">
      <div style="font-size:12px;color:var(--t3);margin-bottom:8px">${ic('check',12)} ${parsed.length} holding${parsed.length!==1?'s':''} detected — preview below</div>
      <div class="tbl-wrap" style="max-height:200px;overflow-y:auto;overflow-x:auto;border-radius:var(--rs);border:1px solid var(--b)">
        <table class="tbl">
          <thead><tr><th>Name</th><th>Ticker</th><th>Category</th><th>Qty</th><th>Avg Price</th></tr></thead>
          <tbody>
            ${show.map(r=>`<tr>
              <td style="font-weight:500;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.name}</td>
              <td class="mono muted">${r.ticker||'—'}</td>
              <td><span class="pill ${pillClass(r.cat)}">${r.cat}</span></td>
              <td class="mono">${r.qty||'—'}</td>
              <td class="mono">${r.avgPrice?'₹'+r.avgPrice.toFixed(2):'—'}</td>
            </tr>`).join('')}
            ${parsed.length>5?`<tr><td colspan="5" style="text-align:center;color:var(--t3);font-size:11.5px;padding:10px">…and ${parsed.length-5} more holdings</td></tr>`:''}
          </tbody>
        </table>
      </div>
    </div>`;
}

function _confirmInvImport() {
  if (!_invImportParsed?.length) return;
  let added = 0, updated = 0;
  _invImportParsed.forEach(nh => {
    const id = 'inv_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
    const existing = APP.investments.find(i =>
      i.name === nh.name || (nh.ticker && nh.ticker !== '' && i.ticker === nh.ticker));
    if (existing) { Object.assign(existing, nh); updated++; }
    else          { APP.investments.push({ ...nh, id }); added++; }
  });
  if (typeof saveInvestmentsConfig === 'function') saveInvestmentsConfig();
  closeModal();
  navigate('investments');
  const msg = [added && `${added} added`, updated && `${updated} updated`].filter(Boolean).join(', ');
  _showToast(`Import complete: ${msg}.`);
  _invImportParsed = null;

  const needsLookup = APP.investments.filter(i => !i.ticker && (i.cat === 'Stock' || i.cat === 'MF' || i.cat === 'ESOP'));
  if (needsLookup.length) {
    _showToast(`Looking up tickers for ${needsLookup.length} holding(s)…`);
    _resolveInvTickers(needsLookup).then(resolved => {
      if (resolved > 0) {
        if (typeof saveInvestmentsConfig === 'function') saveInvestmentsConfig();
        renderScreen(_screen, document.getElementById('screen-content'));
        _showToast(`Tickers resolved for ${resolved} holding(s) — live prices ready.`);
      }
    });
  }
}

async function _resolveInvTickers(holdings) {
  let resolved = 0;
  for (const h of holdings) {
    try {
      const q = (h.isin && h.isin.length > 5) ? h.isin : h.name;
      const searchUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=5&newsCount=0&enableFuzzyQuery=false&enableCb=false`;
      const r = await fetch(_YAHOO_PROXY + encodeURIComponent(searchUrl));
      if (!r.ok) continue;
      const data = await r.json();
      const quotes = data?.finance?.result?.[0]?.quotes || data?.quotes || [];
      const isMF = h.cat === 'MF';
      const preferred = quotes.filter(q => {
        if (!q.symbol) return false;
        if (isMF) return q.quoteType === 'MUTUALFUND' || q.symbol.endsWith('.BO') || q.symbol.endsWith('.NS');
        return q.symbol.endsWith('.NS') || q.symbol.endsWith('.BO');
      });
      const best = preferred[0] || quotes.find(q => q.exchange === 'NSI' || q.exchange === 'BSE' || q.exchange === 'BSI');
      if (best?.symbol) { h.ticker = best.symbol; resolved++; }
    } catch(e) { /* skip */ }
    await new Promise(res => setTimeout(res, 200));
  }
  return resolved;
}

// ── SMART FILL ────────────────────────────────────────────────────────────────
function openSmartFill() {
  // Build suggestions from entries already in the current month as copy templates
  const m = APP.monthly;
  const recurring = [
    ...m.expenses.map(e    => ({ desc:e.desc,    avg:e.amount,    type:'expenses'    })),
    ...m.income.map(e      => ({ desc:e.desc,    avg:e.amount,    type:'income'      })),
    ...m.investments.map(e => ({ desc:e.desc,    avg:e.amount,    type:'investments' })),
    ...m.loans.map(e       => ({ desc:e.desc,    avg:e.amount,    type:'loans'       })),
  ];

  const typeLabel = { expenses:'expense', income:'income', investments:'investment', loans:'loan' };
  const pillCls   = { expenses:'p-other', income:'p-epf', investments:'p-stock', loans:'p-gold' };

  const emptyMsg = `<div style="padding:24px;text-align:center;color:var(--t3);font-size:13px">
    No entries in the current month to suggest. Add transactions first.
  </div>`;

  openModal(`
    <div class="modal-hd">
      <div class="modal-title">${ic('zap',14)} Smart Fill — Copy Recurring Items</div>
      <button class="modal-close" onclick="closeModal()">${ic('x',13)}</button>
    </div>
    <div class="modal-body">
      ${recurring.length ? `
      <div style="font-size:12.5px;color:var(--t2);padding:10px 12px;background:var(--a05);border:1px solid var(--a20);border-radius:var(--rs)">
        ${ic('info',13)} <strong>${recurring.length} entries</strong> from ${monthName(m.month)} ${m.year} available to re-add next month.
      </div>
      <div class="row" style="justify-content:space-between">
        <span style="font-size:12px;color:var(--t3)">${recurring.length} items</span>
        <button class="btn btn-ghost btn-sm" onclick="document.querySelectorAll('.sf-cb').forEach(c=>c.checked=true)">Select All</button>
      </div>
      <div>
        ${recurring.map((r,i)=>`
          <div class="sf-item">
            <input type="checkbox" class="sf-cb" id="sf-${i}" data-type="${r.type}" data-desc="${r.desc.replace(/"/g,'&quot;')}" data-amt="${r.avg}" checked style="accent-color:var(--accent);width:15px;height:15px;cursor:pointer">
            <div style="flex:1">
              <div class="sf-name">${r.desc}</div>
              <div class="sf-freq"><span class="pill ${pillCls[r.type]}">${typeLabel[r.type]}</span></div>
            </div>
            <div class="sf-amt">${fmt(r.avg)}</div>
          </div>`).join('')}
      </div>` : emptyMsg}
    </div>
    <div class="modal-ft">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      ${recurring.length ? `<button class="btn btn-primary" onclick="confirmSmartFill()">Add Selected</button>` : ''}
    </div>
  `);
}

function confirmSmartFill() {
  document.querySelectorAll('.sf-cb:checked').forEach(cb => {
    const type = cb.dataset.type;
    const desc = cb.dataset.desc;
    const amount = parseFloat(cb.dataset.amt) || 0;
    if (!type || !desc || !amount) return;
    const newId = Math.max(0, ...APP.monthly[type].map(e => e.id)) + 1;
    APP.monthly[type].push({ id: newId, desc, amount, date: new Date().toISOString().split('T')[0] });
  });
  closeModal();
  navigate(_screen);
}

// ── ADD CHECKLIST ITEM ────────────────────────────────────────────────────────
function openAddCheck() {
  openModal(`
    <div class="modal-hd">
      <div class="modal-title">${ic('check',14)} Add Checklist Item</div>
      <button class="modal-close" onclick="closeModal()">${ic('x',13)}</button>
    </div>
    <div class="modal-body">
      <div class="inp-grp">
        <div class="inp-label">Item Label</div>
        <input class="inp" id="ac-label" placeholder="e.g. Axis CC Bill" autofocus>
      </div>
    </div>
    <div class="modal-ft">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="
        const v=document.getElementById('ac-label').value.trim();
        if(v){
          const nid=Math.max(0,...APP.monthly.checklist.map(c=>c.id))+1;
          APP.monthly.checklist.push({id:nid,label:v,done:false});
          closeModal();navigate('monthly');
        }">Add Item</button>
    </div>
  `);
}

// ── ADD NOTE ──────────────────────────────────────────────────────────────────
function openAddNote() {
  openModal(`
    <div class="modal-hd">
      <div class="modal-title">${ic('pin',14)} Add Note</div>
      <button class="modal-close" onclick="closeModal()">${ic('x',13)}</button>
    </div>
    <div class="modal-body">
      <div class="inp-grp">
        <div class="inp-label">Note <span style="font-size:11px;color:var(--t3);font-weight:400">(Enter to save · Shift+Enter for new line)</span></div>
        <textarea class="inp" id="an-text" rows="4" placeholder="Write your note…" style="resize:vertical"></textarea>
      </div>
      <div class="row" style="gap:8px">
        <input type="checkbox" id="an-pin" style="accent-color:var(--accent)">
        <label for="an-pin" style="font-size:12.5px;color:var(--t2);cursor:pointer">Pin this note</label>
      </div>
    </div>
    <div class="modal-ft">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="submitAddNote()">Save Note</button>
    </div>
  `);
  setTimeout(() => {
    const ta = document.getElementById('an-text');
    if (!ta) return;
    ta.focus();
    ta.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitAddNote(); }
    });
  }, 50);
}

function submitAddNote() {
  const t = document.getElementById('an-text')?.value.trim();
  const p = document.getElementById('an-pin')?.checked || false;
  if (!t) return;
  const nid = Math.max(0, ...APP.monthly.notes.map(n => n.id)) + 1;
  APP.monthly.notes.push({ id: nid, text: t, pinned: p });
  if (p) APP.monthly.notes.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  closeModal();
  navigate('monthly');
}

// ── EDIT NOTE ─────────────────────────────────────────────────────────────────
function openEditNote(id) {
  const note = APP.monthly.notes.find(n => n.id === id);
  if (!note) return;
  openModal(`
    <div class="modal-hd">
      <div class="modal-title">${ic('edit',14)} Edit Note</div>
      <button class="modal-close" onclick="closeModal()">${ic('x',13)}</button>
    </div>
    <div class="modal-body">
      <div class="inp-grp">
        <div class="inp-label">Note <span style="font-size:11px;color:var(--t3);font-weight:400">(Enter to save · Shift+Enter for new line)</span></div>
        <textarea class="inp" id="en-text" rows="4" style="resize:vertical">${note.text}</textarea>
      </div>
      <div class="row" style="gap:8px">
        <input type="checkbox" id="en-pin" style="accent-color:var(--accent)" ${note.pinned ? 'checked' : ''}>
        <label for="en-pin" style="font-size:12.5px;color:var(--t2);cursor:pointer">Pin this note</label>
      </div>
    </div>
    <div class="modal-ft">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="confirmEditNote(${id})">Save</button>
    </div>
  `);
  setTimeout(() => {
    const ta = document.getElementById('en-text');
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    ta.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); confirmEditNote(id); }
    });
  }, 50);
}

function confirmEditNote(id) {
  const note = APP.monthly.notes.find(n => n.id === id);
  if (!note) return;
  const text = document.getElementById('en-text')?.value.trim();
  if (!text) { closeModal(); return; }
  note.text   = text;
  note.pinned = document.getElementById('en-pin')?.checked || false;
  APP.monthly.notes.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  closeModal();
  navigate('monthly');
}

// ── LIFESTYLE MODALS ──────────────────────────────────────────────────────────

let _lsEditGoodId  = null;
let _lsEditEventId = null;
let _lsGoodCat     = 'TV';
let _lsEvCatSel    = 'Birthday';

const _LS_CATS_MODAL = [
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

const _LS_EV_CATS_MODAL = [
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

function _lsGoodCatPillsHtml() {
  return _LS_CATS_MODAL.map(c => `
    <button class="ftab${c.key === _lsGoodCat ? ' active' : ''}" style="font-size:11px;padding:4px 10px"
      onclick="_lsPickGoodCat('${c.key}')">${c.icon} ${c.key}</button>`
  ).join('');
}

function _lsEvCatPillsHtml() {
  return _LS_EV_CATS_MODAL.map(c => `
    <button class="ftab${c.key === _lsEvCatSel ? ' active' : ''}" style="font-size:11px;padding:4px 10px"
      onclick="_lsPickEvCat('${c.key}')">${c.icon} ${c.key}</button>`
  ).join('');
}

function _lsPickGoodCat(key) {
  _lsGoodCat = key;
  const wrap = document.getElementById('ls-good-cat-pills');
  if (wrap) wrap.innerHTML = _lsGoodCatPillsHtml();
  const lsEl = document.getElementById('ls-lifespan');
  const cat  = _LS_CATS_MODAL.find(c => c.key === key);
  if (lsEl && (!lsEl.value || lsEl.value === '0')) lsEl.value = cat ? cat.lifespan : 10;
}

function _lsPickEvCat(key) {
  _lsEvCatSel = key;
  const wrap = document.getElementById('ls-ev-cat-pills');
  if (wrap) wrap.innerHTML = _lsEvCatPillsHtml();
}

function _lsGoodModalHtml(g) {
  const cat = _LS_CATS_MODAL.find(c => c.key === _lsGoodCat) || _LS_CATS_MODAL[0];
  return `
  <div class="modal-hd">
    <span>${g ? '✏ Edit Item' : '+ Add Household Item'}</span>
    <button class="modal-close" onclick="closeModal()">${ic('x',13)}</button>
  </div>
  <div class="modal-body" style="display:flex;flex-direction:column;gap:14px">

    <div>
      <div class="inp-label">Category</div>
      <div id="ls-good-cat-pills" class="filter-tabs" style="flex-wrap:wrap;gap:4px">${_lsGoodCatPillsHtml()}</div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="inp-wrap" style="grid-column:1/-1">
        <div class="inp-label">Item Name *</div>
        <input class="inp" id="ls-name" placeholder='e.g. Samsung 55" OLED TV' value="${g ? g.name || '' : ''}">
      </div>
      <div class="inp-wrap">
        <div class="inp-label">Brand</div>
        <input class="inp" id="ls-brand" placeholder="e.g. Samsung" value="${g ? g.brand || '' : ''}">
      </div>
      <div class="inp-wrap">
        <div class="inp-label">Model</div>
        <input class="inp" id="ls-model" placeholder="e.g. QN55S95D" value="${g ? g.model || '' : ''}">
      </div>
      <div class="inp-wrap">
        <div class="inp-label">Purchase Date</div>
        <input class="inp" id="ls-date" type="date" value="${g ? g.purchaseDate || '' : ''}">
      </div>
      <div class="inp-wrap">
        <div class="inp-label">Purchase Price (₹)</div>
        <input class="inp" id="ls-price" type="number" min="0" placeholder="e.g. 120000" value="${g ? g.purchasePrice || '' : ''}">
      </div>
      <div class="inp-wrap">
        <div class="inp-label">Warranty (Years)</div>
        <input class="inp" id="ls-warranty" type="number" min="0" step="0.5" placeholder="e.g. 3" value="${g ? g.warrantyYears || '' : ''}">
      </div>
      <div class="inp-wrap">
        <div class="inp-label">Expected Lifespan (Years)</div>
        <input class="inp" id="ls-lifespan" type="number" min="1" placeholder="e.g. 10" value="${g ? g.expectedLifespan || '' : cat.lifespan}">
      </div>
      <div class="inp-wrap">
        <div class="inp-label">Condition</div>
        <select class="sel" id="ls-condition">
          <option${(!g || g.condition === 'Good') ? ' selected' : ''}>Good</option>
          <option${g && g.condition === 'Fair' ? ' selected' : ''}>Fair</option>
          <option${g && g.condition === 'Poor' ? ' selected' : ''}>Poor</option>
        </select>
      </div>
      <div class="inp-wrap" style="grid-column:1/-1">
        <div class="inp-label">Upgrade Plan <span style="color:var(--t3);font-weight:400;text-transform:none">(optional)</span></div>
        <input class="inp" id="ls-upgrade" placeholder='e.g. Planning to get 77" OLED when lifespan ends' value="${g ? g.upgradeNotes || '' : ''}">
      </div>
      <div class="inp-wrap" style="grid-column:1/-1">
        <div class="inp-label">Notes <span style="color:var(--t3);font-weight:400;text-transform:none">(optional)</span></div>
        <textarea class="inp" id="ls-notes" style="min-height:60px;resize:vertical" placeholder="Any additional notes…">${g ? g.notes || '' : ''}</textarea>
      </div>
    </div>
  </div>
  <div class="modal-ft">
    <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="confirmSaveGood()">Save Item</button>
  </div>`;
}

function openAddGood() {
  _lsEditGoodId = null;
  _lsGoodCat    = 'TV';
  openModal(_lsGoodModalHtml(null));
}

function openEditGood(id) {
  _lsEditGoodId = id;
  const g = (APP.lifestyle.goods || []).find(x => x.id === id);
  if (!g) return;
  _lsGoodCat = g.category || 'TV';
  openModal(_lsGoodModalHtml(g));
}

function confirmSaveGood() {
  const name = (document.getElementById('ls-name')?.value || '').trim();
  if (!name) { _showToast('Please enter an item name', 'error'); return; }

  const good = {
    id:               _lsEditGoodId || ('ls_' + Date.now()),
    name,
    category:         _lsGoodCat,
    brand:            (document.getElementById('ls-brand')?.value || '').trim(),
    model:            (document.getElementById('ls-model')?.value || '').trim(),
    purchaseDate:     document.getElementById('ls-date')?.value || '',
    purchasePrice:    Number(document.getElementById('ls-price')?.value) || 0,
    warrantyYears:    Number(document.getElementById('ls-warranty')?.value) || 0,
    expectedLifespan: Number(document.getElementById('ls-lifespan')?.value) || 0,
    condition:        document.getElementById('ls-condition')?.value || 'Good',
    upgradeNotes:     (document.getElementById('ls-upgrade')?.value || '').trim(),
    notes:            (document.getElementById('ls-notes')?.value || '').trim(),
  };

  if (!APP.lifestyle) APP.lifestyle = { goods: [], events: [] };
  const goods = APP.lifestyle.goods || [];
  if (_lsEditGoodId) {
    const idx = goods.findIndex(x => x.id === _lsEditGoodId);
    if (idx >= 0) goods[idx] = good; else goods.push(good);
  } else {
    goods.push(good);
  }
  APP.lifestyle.goods = goods;
  saveLifestyleConfig();
  closeModal();
  _showToast(_lsEditGoodId ? 'Item updated' : 'Item added');
  renderLifestyle(document.getElementById('screen-content'));
}

function _lsEvModalHtml(ev) {
  return `
  <div class="modal-hd">
    <span>${ev ? '✏ Edit Event' : '+ Add Event / Note'}</span>
    <button class="modal-close" onclick="closeModal()">${ic('x',13)}</button>
  </div>
  <div class="modal-body" style="display:flex;flex-direction:column;gap:14px">

    <div>
      <div class="inp-label">Category</div>
      <div id="ls-ev-cat-pills" class="filter-tabs" style="flex-wrap:wrap;gap:4px">${_lsEvCatPillsHtml()}</div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="inp-wrap" style="grid-column:1/-1">
        <div class="inp-label">Title *</div>
        <input class="inp" id="ls-ev-title" placeholder="e.g. Mom's Birthday" value="${ev ? ev.title || '' : ''}">
      </div>
      <div class="inp-wrap">
        <div class="inp-label">Date</div>
        <input class="inp" id="ls-ev-date" type="date" value="${ev ? ev.date || '' : ''}">
      </div>
      <div class="inp-wrap" style="display:flex;flex-direction:column;justify-content:flex-end">
        <div class="inp-label">Recurrence</div>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;color:var(--t2);padding:8px 0">
          <input type="checkbox" id="ls-ev-recurring"${(!ev || ev.recurring) ? ' checked' : ''} style="width:15px;height:15px;accent-color:var(--accent);cursor:pointer">
          Repeat yearly
        </label>
      </div>
      <div class="inp-wrap" style="grid-column:1/-1">
        <div class="inp-label">Notes <span style="color:var(--t3);font-weight:400;text-transform:none">(optional)</span></div>
        <textarea class="inp" id="ls-ev-notes" style="min-height:60px;resize:vertical" placeholder="Details or reminder…">${ev ? ev.notes || '' : ''}</textarea>
      </div>
    </div>
  </div>
  <div class="modal-ft">
    <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="confirmSaveEvent()">Save Event</button>
  </div>`;
}

function openAddEvent() {
  _lsEditEventId = null;
  _lsEvCatSel    = 'Birthday';
  openModal(_lsEvModalHtml(null));
}

function openEditEvent(id) {
  _lsEditEventId = id;
  const ev = (APP.lifestyle.events || []).find(x => x.id === id);
  if (!ev) return;
  _lsEvCatSel = ev.category || 'Birthday';
  openModal(_lsEvModalHtml(ev));
}

function confirmSaveEvent() {
  const title = (document.getElementById('ls-ev-title')?.value || '').trim();
  if (!title) { _showToast('Please enter a title', 'error'); return; }

  const ev = {
    id:        _lsEditEventId || ('lsev_' + Date.now()),
    title,
    category:  _lsEvCatSel,
    date:      document.getElementById('ls-ev-date')?.value || '',
    recurring: document.getElementById('ls-ev-recurring')?.checked ?? true,
    notes:     (document.getElementById('ls-ev-notes')?.value || '').trim(),
  };

  if (!APP.lifestyle) APP.lifestyle = { goods: [], events: [] };
  const events = APP.lifestyle.events || [];
  if (_lsEditEventId) {
    const idx = events.findIndex(x => x.id === _lsEditEventId);
    if (idx >= 0) events[idx] = ev; else events.push(ev);
  } else {
    events.push(ev);
  }
  APP.lifestyle.events = events;
  saveLifestyleConfig();
  closeModal();
  _showToast(_lsEditEventId ? 'Event updated' : 'Event added');
  renderLifestyle(document.getElementById('screen-content'));
}
