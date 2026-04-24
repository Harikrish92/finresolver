/* ============================================================
   loans.js — Loan Tracker
   FinResolver · finresolver.in
   ============================================================ */

/* ══════════════════════════════════════════════════════════
   HELPERS — function declarations are fully hoisted,
   so these are available everywhere in this file
══════════════════════════════════════════════════════════ */

function fmtL(n) {
  return '\u20B9' + Math.round(Number(n)).toLocaleString('en-IN');
}

function loanFormatDate(d) {
  if (!d) return '\u2014';
  var date = d instanceof Date ? d : new Date(d);
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function showLoanToast(msg, type) {
  type = type || 'success';
  if (typeof showToast === 'function') { showToast(msg, type); return; }
  var t = document.createElement('div');
  t.className = 'toast ' + type;
  t.innerHTML = '<span>' + (type === 'success' ? '\u2713' : '\u26A0') + '</span><span>' + msg + '</span>';
  document.body.appendChild(t);
  setTimeout(function () {
    t.classList.add('hide');
    setTimeout(function () { t.remove(); }, 350);
  }, 3000);
}

function loanEscHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ══════════════════════════════════════════════════════════
   STATE
══════════════════════════════════════════════════════════ */
var loansData         = [];
var activeLoanId      = null;
var loanChartPie      = null;
var loanChartLine     = null;
/* Timestamp of last local write — used to suppress stale Firestore reads
   that would overwrite an in-progress local save. */
var _loansLastSavedAt = 0;

function resetLoansState() {
  loansData     = [];
  activeLoanId  = null;
}

/* ══════════════════════════════════════════════════════════
   STORAGE
══════════════════════════════════════════════════════════ */
function getLoanStorageKey() {
  var uid = (typeof fbAuth !== 'undefined' && fbAuth && fbAuth.currentUser && fbAuth.currentUser.uid)
    ? fbAuth.currentUser.uid
    : (typeof currentUser !== 'undefined' && currentUser && currentUser.uid ? currentUser.uid : 'guest');
  return 'fr_loans_' + uid;
}

async function loadLoans() {
  var raw   = localStorage.getItem(getLoanStorageKey());
  var email = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.email : null;
  loansData = raw ? ((await decryptFromStorage(raw, email)) || []) : [];
}

async function saveLoans() {
  _loansLastSavedAt = Date.now(); // guard: suppress stale Firestore reads until this save propagates
  var email = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.email : null;
  localStorage.setItem(getLoanStorageKey(), await encryptForStorage(loansData, email));
  syncSaveLoans();
}

function syncSaveLoans() {
  if (typeof syncReady === 'undefined' || !syncReady || typeof db === 'undefined' || !db) return;
  var uid = (typeof fbAuth !== 'undefined' && fbAuth && fbAuth.currentUser && fbAuth.currentUser.uid)
    ? fbAuth.currentUser.uid
    : (typeof currentUser !== 'undefined' && currentUser && currentUser.uid ? currentUser.uid : null);
  if (!uid) return;
  var email = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.email : null;
  encryptForStorage({ loans: loansData }, email).then(function (encStr) {
    db.collection('users').doc(uid).collection('config').doc('loans')
      .set({ _enc: encStr })
      .catch(function (e) { console.warn('[Loans] Firestore save failed:', e.message); });
  });
}

function syncLoadLoans() {
  if (typeof syncReady === 'undefined' || !syncReady || typeof db === 'undefined' || !db) return Promise.resolve();
  var uid = (typeof fbAuth !== 'undefined' && fbAuth && fbAuth.currentUser && fbAuth.currentUser.uid)
    ? fbAuth.currentUser.uid
    : (typeof currentUser !== 'undefined' && currentUser && currentUser.uid ? currentUser.uid : null);
  if (!uid) return Promise.resolve();
  var email = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.email : null;
  return db.collection('users').doc(uid).collection('config').doc('loans').get()
    .then(async function (snap) {
      if (!snap.exists) return;
      var d = snap.data();
      var loans;
      if (d._enc) {
        var dec = await decryptFromStorage(d._enc, email);
        loans = dec && dec.loans;
      } else {
        loans = d.loans;
      }
      if (!Array.isArray(loans)) return;
      // Skip overwrite if a local save happened in the last 15 s — Firestore
      // may not yet have that write and would roll back our in-memory changes.
      if (Date.now() - _loansLastSavedAt < 15000) return;
      loansData = loans;
      localStorage.setItem(getLoanStorageKey(), await encryptForStorage(loansData, email));
    })
    .catch(function (e) { console.warn('[Loans] Firestore load failed:', e.message); });
}

/* ══════════════════════════════════════════════════════════
   FINANCE CALCULATIONS
══════════════════════════════════════════════════════════ */
function calcEMI(principal, annualRate, tenureMonths) {
  if (!annualRate) return principal / tenureMonths;
  var r = annualRate / 12 / 100;
  var n = tenureMonths;
  return principal * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
}

function buildAmortization(loan) {
  var principal  = Number(loan.principal);
  var annualRate = Number(loan.interestRate);
  var n          = Number(loan.tenureMonths);
  var emi        = loan.emiOverride ? Number(loan.emiOverride) : calcEMI(principal, annualRate, n);
  var r          = annualRate / 12 / 100;
  var startDate  = new Date(loan.startDate);
  var payments   = (loan.payments || []).slice().sort(function (a, b) { return new Date(a.date) - new Date(b.date); });

  var balance = principal;
  var totalInterest = 0;
  var schedule = [];
  var paymentIdx = 0;

  for (var i = 1; i <= n && balance > 0.01; i++) {
    var dueDate = new Date(startDate);
    dueDate.setMonth(startDate.getMonth() + i);

    var interest      = balance * r;
    var principalPart = Math.min(emi - interest, balance);
    var scheduledEmi  = interest + principalPart;

    var extraPaid = 0;
    while (paymentIdx < payments.length && new Date(payments[paymentIdx].date) <= dueDate) {
      extraPaid += Number(payments[paymentIdx].amount);
      paymentIdx++;
    }

    var paid = extraPaid >= scheduledEmi;
    balance = Math.max(0, balance - principalPart - Math.max(0, extraPaid - scheduledEmi));
    totalInterest += interest;

    schedule.push({
      month: i, dueDate: dueDate, emi: scheduledEmi,
      principal: principalPart, interest: interest,
      balance: balance, paid: paid,
    });
  }

  return { schedule: schedule, totalInterest: totalInterest, emi: emi };
}

function loanStats(loan) {
  var r          = buildAmortization(loan);
  var schedule   = r.schedule;
  var emi        = r.emi;
  var totalInterest = r.totalInterest;

  var outstanding  = Number(loan.principal);
  var paidMonths   = 0;
  var interestPaid = 0;

  for (var i = 0; i < schedule.length; i++) {
    if (schedule[i].paid) {
      outstanding  = schedule[i].balance;
      interestPaid += schedule[i].interest;
      paidMonths++;
    } else {
      break;
    }
  }

  var currentRow = null;
  for (var j = 0; j < schedule.length; j++) {
    if (!schedule[j].paid) { currentRow = schedule[j]; break; }
  }

  var payoffDate = schedule.length ? schedule[schedule.length - 1].dueDate : null;
  var pctRepaid  = Number(loan.principal) > 0
    ? ((Number(loan.principal) - outstanding) / Number(loan.principal)) * 100
    : 0;

  return {
    emi: emi,
    outstanding: outstanding,
    paidMonths: paidMonths,
    totalMonths: schedule.length,
    totalInterest: totalInterest,
    interestPaid: interestPaid,
    currentRow: currentRow,
    payoffDate: payoffDate,
    pctRepaid: pctRepaid,
    closed: outstanding <= 0.01,
    schedule: schedule,
  };
}

/* ══════════════════════════════════════════════════════════
   NAVIGATION
══════════════════════════════════════════════════════════ */
function goToLoans() {
  history.pushState({ screen: 'loans' }, '');
  if (typeof _enterTracker === 'function') _enterTracker('loans');
  document.getElementById('loanScreen').style.display       = 'block';

  var tc = document.getElementById('headerTrackerControls');
  if (tc) tc.style.display = 'none';

  loadLoans();
  renderLoanList();
  syncLoadLoans().then(function () { renderLoanList(); });
}

function goToLoanDetail(id) {
  history.pushState({ screen: 'loanDetail', id: id }, '');
  activeLoanId = id;
  document.getElementById('loanScreen').style.display       = 'none';
  document.getElementById('loanDetailScreen').style.display = 'block';
  renderLoanDetail();
}

/* Navigate directly to a loan's detail screen from any screen
   (e.g. clicking the loan tag in the monthly tracker) */
function navigateToLoan(id) {
  history.pushState({ screen: 'loanDetail', id: id }, '');
  if (typeof _enterTracker === 'function') _enterTracker('loans');
  activeLoanId = id;
  document.getElementById('homeScreen').style.display       = 'none';
  document.getElementById('appMain').style.display          = 'none';
  document.getElementById('loanScreen').style.display       = 'none';
  document.getElementById('loanDetailScreen').style.display = 'block';
  renderLoanDetail();
}

function backToLoanList() {
  activeLoanId = null;
  document.getElementById('loanDetailScreen').style.display = 'none';
  document.getElementById('loanScreen').style.display       = 'block';
  renderLoanList();
}

/* ══════════════════════════════════════════════════════════
   RENDER — LIST
══════════════════════════════════════════════════════════ */
function renderLoanList() {
  renderLoanSummaryStrip();
  var grid = document.getElementById('loansGrid');
  if (!grid) return;

  if (!loansData.length) {
    grid.innerHTML = '<div class="loans-empty">'
      + '<div class="loans-empty-icon">\uD83C\uDFE6</div>'
      + '<div class="loans-empty-title">No loans yet</div>'
      + '<div class="loans-empty-sub">Add your first loan to start tracking EMIs,<br>interest paid, and payoff timeline.</div>'
      + '</div>';
    return;
  }

  var sorted = loansData.slice().sort(function (a, b) {
    var sa = loanStats(a), sb = loanStats(b);
    if (sa.closed !== sb.closed) return sa.closed ? 1 : -1;
    return sb.outstanding - sa.outstanding;
  });

  grid.innerHTML = sorted.map(function (loan) { return loanCardHTML(loan); }).join('');
}

function renderLoanSummaryStrip() {
  var totalPrincipal = 0, totalOutstanding = 0, totalEMI = 0, totalInterestLeft = 0;
  for (var i = 0; i < loansData.length; i++) {
    var s = loanStats(loansData[i]);
    if (s.closed) continue;
    totalPrincipal    += Number(loansData[i].principal);
    totalOutstanding  += s.outstanding;
    totalEMI          += s.emi;
    totalInterestLeft += (s.totalInterest - s.interestPaid);
  }
  function setText(id, val) { var el = document.getElementById(id); if (el) el.textContent = val; }
  setText('loanSumTotal',       fmtL(totalPrincipal));
  setText('loanSumOutstanding', fmtL(totalOutstanding));
  setText('loanSumEMI',         fmtL(totalEMI));
  setText('loanSumInterest',    fmtL(totalInterestLeft));
}

function loanCardHTML(loan) {
  var s      = loanStats(loan);
  var type   = (loan.type || 'other').toLowerCase();
  var pct    = Math.min(100, Math.max(0, s.pctRepaid)).toFixed(1);
  var danger = s.pctRepaid < 20;

  var nextEmiStr = '';
  if (!s.closed && s.currentRow) {
    var isOverdue = s.currentRow.dueDate < new Date();
    nextEmiStr = isOverdue
      ? '<span class="overdue">\u26A0 Overdue ' + loanFormatDate(s.currentRow.dueDate) + '</span>'
      : 'Next EMI ' + loanFormatDate(s.currentRow.dueDate);
  } else if (s.closed) {
    nextEmiStr = '<span style="color:var(--accent)">\u2713 Fully Paid Off</span>';
  }

  return '<div class="loan-card ' + (s.closed ? 'closed' : '') + '" onclick="goToLoanDetail(\'' + loan.id + '\')">'
    + '<div class="loan-card-accent"></div>'
    + '<div class="loan-card-head">'
    +   '<div class="loan-card-name">' + loanEscHtml(loan.name) + '</div>'
    +   (s.closed
          ? '<span class="loan-closed-badge">\u2713 Closed</span>'
          : '<span class="loan-type-badge ' + type + '">' + loanEscHtml(loan.type || 'Other') + '</span>')
    + '</div>'
    + '<div class="loan-progress-wrap">'
    +   '<div class="loan-progress-label"><span>Repaid ' + pct + '%</span><span>' + fmtL(s.outstanding) + ' left</span></div>'
    +   '<div class="loan-progress-track"><div class="loan-progress-bar ' + (danger ? 'danger' : '') + '" style="width:' + pct + '%"></div></div>'
    + '</div>'
    + '<div class="loan-stats-row">'
    +   '<div class="loan-stat"><div class="loan-stat-label">EMI</div><div class="loan-stat-value" style="color:var(--accent3)">' + fmtL(s.emi) + '</div></div>'
    +   '<div class="loan-stat"><div class="loan-stat-label">Rate</div><div class="loan-stat-value">' + Number(loan.interestRate).toFixed(2) + '%</div></div>'
    +   '<div class="loan-stat"><div class="loan-stat-label">Tenure</div><div class="loan-stat-value">' + loan.tenureMonths + 'm</div></div>'
    + '</div>'
    + '<div class="loan-card-foot">'
    +   '<span class="loan-next-emi">' + nextEmiStr + '</span>'
    +   '<span class="loan-card-actions" onclick="event.stopPropagation()">'
    +     '<button class="loan-act-btn" onclick="openLoanModal(\'' + loan.id + '\')">Edit</button>'
    +     '<button class="loan-act-btn danger" onclick="deleteLoan(\'' + loan.id + '\')">Delete</button>'
    +   '</span>'
    + '</div>'
    + '</div>';
}

/* ══════════════════════════════════════════════════════════
   RENDER — DETAIL
══════════════════════════════════════════════════════════ */
function renderLoanDetail() {
  var loan = null;
  for (var i = 0; i < loansData.length; i++) {
    if (loansData[i].id === activeLoanId) { loan = loansData[i]; break; }
  }
  if (!loan) { backToLoanList(); return; }

  var s    = loanStats(loan);
  var type = (loan.type || 'other').toLowerCase();

  function setText(id, val) { var el = document.getElementById(id); if (el) el.textContent = val; }

  setText('detailLoanName', loan.name);
  var badgeEl = document.getElementById('detailLoanBadge');
  if (badgeEl) { badgeEl.textContent = loan.type || 'Other'; badgeEl.className = 'loan-type-badge ' + type; }

  setText('detailMetricOutstanding',    fmtL(s.outstanding));
  setText('detailMetricOutstandingSub', 'of ' + fmtL(Number(loan.principal)) + ' principal');
  setText('detailMetricEMI',            fmtL(s.emi));
  setText('detailMetricRate',           Number(loan.interestRate).toFixed(2) + '%');
  setText('detailMetricPaid',           s.paidMonths + '/' + s.totalMonths);
  setText('detailMetricPayoff',         s.payoffDate ? loanFormatDate(s.payoffDate) : '\u2014');

  renderLoanCharts(loan, s);
  renderAmortTable(s.schedule);
  renderPaymentLog(loan);
}

function renderLoanCharts(loan, s) {
  var ct = typeof getChartTheme === 'function' ? getChartTheme() : { grid: 'rgba(255,255,255,.04)', tick: '#6b7a99' };

  if (loanChartPie) { loanChartPie.destroy(); loanChartPie = null; }
  var pieEl = document.getElementById('loanPieChart');
  if (pieEl) {
    loanChartPie = new Chart(pieEl, {
      type: 'doughnut',
      data: {
        labels: ['Principal', 'Total Interest'],
        datasets: [{ data: [Number(loan.principal), s.totalInterest],
          backgroundColor: ['#4dabf7', '#ffd166'], borderWidth: 0, hoverOffset: 6 }],
      },
      options: { responsive: true, maintainAspectRatio: false, cutout: '65%',
        plugins: { legend: { labels: { color: ct.tick, font: { family: 'DM Mono', size: 11 } } } } },
    });
  }

  if (loanChartLine) { loanChartLine.destroy(); loanChartLine = null; }
  var lineEl = document.getElementById('loanLineChart');
  if (lineEl) {
    loanChartLine = new Chart(lineEl, {
      type: 'line',
      data: {
        labels: s.schedule.map(function (r) { return 'M' + r.month; }),
        datasets: [{
          data: s.schedule.map(function (r) { return Math.round(r.balance); }),
          borderColor: '#ffd166', backgroundColor: 'rgba(255,209,102,.08)',
          borderWidth: 2, pointRadius: 0, fill: true, tension: 0.4,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: ct.tick, font: { family: 'DM Mono', size: 10 }, maxTicksLimit: 8 }, grid: { color: ct.grid } },
          y: { ticks: { color: ct.tick, font: { family: 'DM Mono', size: 10 },
                callback: function (v) { return '\u20B9' + Number(v).toLocaleString('en-IN'); } },
               grid: { color: ct.grid } },
        },
      },
    });
  }
}

function renderAmortTable(schedule) {
  var tbody = document.getElementById('amortBody');
  if (!tbody) return;
  var today = new Date();
  tbody.innerHTML = schedule.map(function (row) {
    var isCurrent = !row.paid
      && row.dueDate.getMonth() === today.getMonth()
      && row.dueDate.getFullYear() === today.getFullYear();
    var cls = row.paid ? 'amort-row-paid' : (isCurrent ? 'amort-row-current' : '');
    return '<tr class="' + cls + '">'
      + '<td>' + row.month + '</td>'
      + '<td>' + loanFormatDate(row.dueDate) + '</td>'
      + '<td style="color:var(--accent3)">' + fmtL(row.emi) + '</td>'
      + '<td style="color:var(--accent4)">' + fmtL(row.principal) + '</td>'
      + '<td style="color:var(--accent2)">' + fmtL(row.interest) + '</td>'
      + '<td>' + fmtL(row.balance) + '</td>'
      + '<td>' + (row.paid ? '\u2713' : (isCurrent ? '\u2190 Now' : '')) + '</td>'
      + '</tr>';
  }).join('');
}

function renderPaymentLog(loan) {
  var list = document.getElementById('paymentLogList');
  if (!list) return;
  var payments = (loan.payments || []).slice().sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
  if (!payments.length) {
    list.innerHTML = '<div style="padding:1.2rem;text-align:center;font-size:.75rem;color:var(--muted);opacity:.5">No payments logged yet</div>';
    return;
  }
  list.innerHTML = payments.map(function (p) {
    return '<div class="payment-log-item">'
      + '<div class="payment-log-dot"></div>'
      + '<div class="payment-log-info">'
      +   '<div class="payment-log-desc">' + loanEscHtml(p.note || 'EMI Payment') + '</div>'
      +   '<div class="payment-log-date">' + loanFormatDate(new Date(p.date)) + '</div>'
      + '</div>'
      + '<div class="payment-log-amt">' + fmtL(Number(p.amount)) + '</div>'
      + '<button class="btn-del payment-log-del" onclick="deletePayment(\'' + loan.id + '\',\'' + p.id + '\')">&#x2715;</button>'
      + '</div>';
  }).join('');
}

/* ══════════════════════════════════════════════════════════
   ADD / EDIT MODAL
══════════════════════════════════════════════════════════ */
function openLoanModal(id) {
  var modal   = document.getElementById('loanModal');
  var titleEl = document.getElementById('loanModalTitle');
  var saveBtn = document.getElementById('loanModalSave');
  if (!modal) return;

  if (id) {
    var loan = null;
    for (var i = 0; i < loansData.length; i++) { if (loansData[i].id === id) { loan = loansData[i]; break; } }
    if (!loan) return;
    titleEl.textContent = 'Edit Loan';
    saveBtn.dataset.editId = id;
    document.getElementById('loanFormName').value      = loan.name;
    document.getElementById('loanFormType').value      = loan.type || 'Personal';
    document.getElementById('loanFormPrincipal').value = loan.principal;
    document.getElementById('loanFormRate').value      = loan.interestRate;
    document.getElementById('loanFormTenure').value    = loan.tenureMonths;
    document.getElementById('loanFormStart').value     = loan.startDate;
    document.getElementById('loanFormEMI').value       = loan.emiOverride || '';
  } else {
    titleEl.textContent = 'Add New Loan';
    delete saveBtn.dataset.editId;
    document.getElementById('loanForm').reset();
    document.getElementById('loanFormStart').value = new Date().toISOString().slice(0, 10);
  }

  updateEMIPreview();
  modal.classList.remove('hidden');
}

function closeLoanModal() {
  var modal = document.getElementById('loanModal');
  if (modal) modal.classList.add('hidden');
}

function saveLoan() {
  var saveBtn = document.getElementById('loanModalSave');
  var editId  = saveBtn ? saveBtn.dataset.editId : null;

  var name      = document.getElementById('loanFormName').value.trim();
  var type      = document.getElementById('loanFormType').value;
  var principal = Number(document.getElementById('loanFormPrincipal').value);
  var rate      = Number(document.getElementById('loanFormRate').value);
  var tenure    = Number(document.getElementById('loanFormTenure').value);
  var start     = document.getElementById('loanFormStart').value;
  var emiOvr    = document.getElementById('loanFormEMI').value;

  if (!name || !principal || !tenure || !start) {
    showLoanToast('Please fill in all required fields', 'error');
    return;
  }

  if (editId) {
    for (var i = 0; i < loansData.length; i++) {
      if (loansData[i].id === editId) {
        loansData[i].name         = name;
        loansData[i].type         = type;
        loansData[i].principal    = principal;
        loansData[i].interestRate = rate;
        loansData[i].tenureMonths = tenure;
        loansData[i].startDate    = start;
        loansData[i].emiOverride  = emiOvr ? Number(emiOvr) : null;
        break;
      }
    }
    showLoanToast('Loan updated');
  } else {
    loansData.push({
      id:           'loan_' + Date.now(),
      name:         name,
      type:         type,
      principal:    principal,
      interestRate: rate,
      tenureMonths: tenure,
      startDate:    start,
      emiOverride:  emiOvr ? Number(emiOvr) : null,
      payments:     [],
    });
    showLoanToast('Loan added');
  }

  saveLoans();
  closeLoanModal();

  var detailScreen = document.getElementById('loanDetailScreen');
  if (detailScreen && detailScreen.style.display !== 'none') {
    renderLoanDetail();
  } else {
    renderLoanList();
  }
}

function deleteLoan(id) {
  var loan = null;
  for (var i = 0; i < loansData.length; i++) { if (loansData[i].id === id) { loan = loansData[i]; break; } }
  if (!loan) return;
  if (!confirm('Delete "' + loan.name + '"?\n\nThis will remove all payment history. This cannot be undone.')) return;
  loansData = loansData.filter(function (l) { return l.id !== id; });
  saveLoans();
  var detailScreen = document.getElementById('loanDetailScreen');
  if (detailScreen && detailScreen.style.display !== 'none') {
    backToLoanList();
  } else {
    renderLoanList();
  }
  showLoanToast('Loan deleted');
}

/* ══════════════════════════════════════════════════════════
   PAYMENTS
══════════════════════════════════════════════════════════ */
function logPayment() {
  var loan = null;
  for (var i = 0; i < loansData.length; i++) { if (loansData[i].id === activeLoanId) { loan = loansData[i]; break; } }
  if (!loan) return;

  var amtEl  = document.getElementById('paymentAmt');
  var dateEl = document.getElementById('paymentDate');
  var noteEl = document.getElementById('paymentNote');
  var amount = Number(amtEl ? amtEl.value : 0);
  var date   = dateEl ? dateEl.value : '';
  var note   = (noteEl && noteEl.value.trim()) ? noteEl.value.trim() : 'EMI Payment';

  if (!amount || !date) { showLoanToast('Enter amount and date', 'error'); return; }

  if (!loan.payments) loan.payments = [];
  loan.payments.push({ id: 'pay_' + Date.now(), date: date, amount: amount, note: note });
  saveLoans();

  if (amtEl)  amtEl.value  = '';
  if (noteEl) noteEl.value = '';

  renderLoanDetail();
  showLoanToast('Payment logged');
}

function deletePayment(loanId, paymentId) {
  var loan = null;
  for (var i = 0; i < loansData.length; i++) { if (loansData[i].id === loanId) { loan = loansData[i]; break; } }
  if (!loan) return;
  loan.payments = (loan.payments || []).filter(function (p) { return p.id !== paymentId; });
  saveLoans();
  renderLoanDetail();
}

/* ══════════════════════════════════════════════════════════
   EMI PREVIEW
══════════════════════════════════════════════════════════ */
function updateEMIPreview() {
  var pEl = document.getElementById('loanFormPrincipal');
  var rEl = document.getElementById('loanFormRate');
  var tEl = document.getElementById('loanFormTenure');
  var preview = document.getElementById('emiPreview');
  if (!preview) return;

  var principal = pEl ? Number(pEl.value) : 0;
  var rate      = rEl ? Number(rEl.value) : 0;
  var tenure    = tEl ? Number(tEl.value) : 0;

  if (!principal || !tenure) { preview.classList.remove('visible'); return; }

  var emi           = calcEMI(principal, rate, tenure);
  var totalPayable  = emi * tenure;
  var totalInterest = totalPayable - principal;

  var e1 = document.getElementById('emiPreviewEMI');
  var e2 = document.getElementById('emiPreviewTotal');
  var e3 = document.getElementById('emiPreviewInterest');
  if (e1) e1.textContent = fmtL(emi);
  if (e2) e2.textContent = fmtL(totalPayable);
  if (e3) e3.textContent = fmtL(totalInterest);
  preview.classList.add('visible');
}
