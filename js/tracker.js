/* ============================================================
   tracker.js — CRUD actions: rows, checklist, balance, clear
   FinResolver · finresolver.in
   ============================================================ */

/* ── Row CRUD ─────────────────────────────────────────────── */
function addRow(type) {
  const descId = { expense:'expDesc', income:'incDesc', investment:'invDesc', loan:'loanDesc' }[type];
  const amtId  = { expense:'expAmt',  income:'incAmt',  investment:'invAmt',  loan:'loanAmt'  }[type];

  const desc   = document.getElementById(descId).value.trim();
  const amount = Number(document.getElementById(amtId).value);
  if (!desc || !amount || amount <= 0) return;

  data[type].push({ desc, amount });
  document.getElementById(descId).value = '';
  document.getElementById(amtId).value  = '';
  saveData(); render();
}

function delRow(type, idx) {
  data[type].splice(idx, 1);
  saveData(); render();
}

/* ── Checklist ────────────────────────────────────────────── */
function toggleCheck(i) {
  data.checklist[i].done = !data.checklist[i].done;
  saveData(); render();
}

function delCheck(i) {
  data.checklist.splice(i, 1);
  saveData(); render();
}

function addCheckItem() {
  const inp = document.getElementById('checkDesc');
  const val = inp.value.trim();
  if (!val) return;
  data.checklist.push({ label: val, done: false });
  inp.value = '';
  saveData(); render();
}

/* ── Initial balance ──────────────────────────────────────── */
function onInitialAmountChange(e) {
  data.initialAmount = Number(e.target.value) || 0;
  saveData(); renderSummary(); renderCharts();
}

/* ── Event wiring ─────────────────────────────────────────── */
function initTrackerEvents() {
  document.getElementById('initialAmount')
    .addEventListener('input', onInitialAmountChange);

  const enterMap = {
    expDesc: 'expense',  expAmt: 'expense',
    incDesc: 'income',   incAmt: 'income',
    invDesc: 'investment', invAmt: 'investment',
    loanDesc: 'loan',    loanAmt: 'loan',
  };
  Object.entries(enterMap).forEach(([id, type]) => {
    document.getElementById(id).addEventListener('keydown', e => {
      if (e.key === 'Enter') addRow(type);
    });
  });

  document.getElementById('checkDesc')
    .addEventListener('keydown', e => { if (e.key === 'Enter') addCheckItem(); });
}

/* ── Toast ────────────────────────────────────────────────── */
function showToast(msg, type = 'success') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span>${type === 'success' ? '✓' : '⚠'}</span><span>${msg}</span>`;
  document.body.appendChild(t);
  setTimeout(() => { t.classList.add('hide'); setTimeout(() => t.remove(), 350); }, 3500);
}
