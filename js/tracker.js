/* ============================================================
   tracker.js — CRUD actions: rows, checklist, balance, clear
   FinResolver · finresolver.in
   ============================================================ */

/* ── Loan-tracker payment sync helpers ────────────────────── */

// Auto-log a payment in the loan tracker and store paymentId back on entry
function autoLogLoanPayment(entry) {
  if (!entry.loanId) return;
  const loans = (typeof loansData !== 'undefined') ? loansData : [];
  const loan  = loans.find(l => l.id === entry.loanId);
  if (!loan) return;
  if (!loan.payments) loan.payments = [];
  const payId = 'pay_' + Date.now();
  const date  = entry.date || new Date().toISOString().slice(0, 10);
  loan.payments.push({ id: payId, date, amount: entry.amount, note: entry.desc });
  entry.paymentId = payId;
  if (typeof saveLoans === 'function') saveLoans();
}

// Remove a previously auto-logged payment from the loan tracker
function autoRemoveLoanPayment(loanId, paymentId) {
  if (!loanId || !paymentId) return;
  const loans = (typeof loansData !== 'undefined') ? loansData : [];
  const loan  = loans.find(l => l.id === loanId);
  if (!loan || !loan.payments) return;
  loan.payments = loan.payments.filter(p => p.id !== paymentId);
  if (typeof saveLoans === 'function') saveLoans();
}

// Update an existing auto-logged payment to match the edited tracker entry
function autoUpdateLoanPayment(entry) {
  if (!entry.loanId || !entry.paymentId) return;
  const loans = (typeof loansData !== 'undefined') ? loansData : [];
  const loan  = loans.find(l => l.id === entry.loanId);
  if (!loan || !loan.payments) return;
  const payment = loan.payments.find(p => p.id === entry.paymentId);
  if (!payment) return;
  payment.amount = entry.amount;
  payment.note   = entry.desc;
  if (entry.date) payment.date = entry.date;
  if (typeof saveLoans === 'function') saveLoans();
}

/* ── Row CRUD ─────────────────────────────────────────────── */
function addRow(type) {
  const descId = { expense:'expDesc', income:'incDesc', investment:'invDesc', loan:'loanDesc' }[type];
  const amtId  = { expense:'expAmt',  income:'incAmt',  investment:'invAmt',  loan:'loanAmt'  }[type];
  const dateId = { expense:'expDate', income:'incDate', investment:'invDate', loan:'loanDate' }[type];

  const desc   = document.getElementById(descId).value.trim();
  const amount = Number(document.getElementById(amtId).value);
  if (!desc || !amount || amount <= 0) return;

  const dateEl = document.getElementById(dateId);
  const date   = dateEl ? dateEl.value : '';
  const entry  = date ? { desc, amount, date } : { desc, amount };

  // For loans: optionally tag entry to a loan in the Loan Tracker
  if (type === 'loan') {
    const tagEl = document.getElementById('loanTagSelect');
    if (tagEl && tagEl.value) {
      const loans = (typeof loansData !== 'undefined') ? loansData : [];
      const linked = loans.find(l => l.id === tagEl.value);
      if (linked) {
        entry.loanId   = linked.id;
        entry.loanName = linked.name;
        autoLogLoanPayment(entry); // also logs payment & stores paymentId on entry
      }
      tagEl.value = '';
    }
  }

  data[type].push(entry);
  document.getElementById(descId).value = '';
  document.getElementById(amtId).value  = '';
  if (dateEl) dateEl.value = '';
  saveData(); render();
}

function delRow(type, idx) {
  if (type === 'loan') {
    const entry = data[type][idx];
    if (entry && entry.loanId && entry.paymentId) {
      autoRemoveLoanPayment(entry.loanId, entry.paymentId);
    }
  }
  data[type].splice(idx, 1);
  saveData(); render();
}

/* ── Inline row editing ───────────────────────────────────── */
function startEditRow(type, idx) {
  const row = document.getElementById(`tr-${type}-${idx}`);
  if (!row) return;
  const r = data[type][idx];
  row.classList.add('editing');

  // For loan rows: build a loan-tag selector pre-filled with the current linked loan
  let loanTagField = '';
  if (type === 'loan') {
    const loans = (typeof loansData !== 'undefined') ? loansData : [];
    const opts = loans.map(l =>
      `<option value="${l.id}"${r.loanId === l.id ? ' selected' : ''}>${escHtml(l.name)}</option>`
    ).join('');
    loanTagField = `<select class="row-edit-input loan-tag-select" id="edit-loantag-${idx}"
        title="Link to Loan Tracker loan">
      <option value="">🏷 Link to loan\u2026</option>${opts}
    </select>`;
  }

  row.innerHTML = `
    <td colspan="2">
      <div class="row-edit-fields">
        <input class="row-edit-input" id="edit-desc-${type}-${idx}"
               value="${escHtml(r.desc)}" placeholder="Description" />
        <input class="row-edit-input row-edit-amt" type="number"
               id="edit-amt-${type}-${idx}" value="${r.amount}" placeholder="Amount" />
        <input class="row-edit-input row-edit-date" type="date"
               id="edit-date-${type}-${idx}" value="${r.date || ''}" title="Date (optional)" />
        ${loanTagField}
      </div>
    </td>
    <td style="text-align:right;white-space:nowrap">
      <button class="btn-row-save" onclick="saveEditRow('${type}',${idx})" title="Save">✓</button>
    </td>
    <td>
      <button class="btn-del" onclick="cancelEditRow('${type}',${idx})" title="Cancel">✕</button>
    </td>`;
  const descEl = document.getElementById(`edit-desc-${type}-${idx}`);
  const amtEl  = document.getElementById(`edit-amt-${type}-${idx}`);
  if (descEl) { descEl.focus(); descEl.select(); }
  [descEl, amtEl].forEach(el => {
    if (!el) return;
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter')  saveEditRow(type, idx);
      if (e.key === 'Escape') cancelEditRow(type, idx);
    });
  });
}

function saveEditRow(type, idx) {
  const desc   = (document.getElementById(`edit-desc-${type}-${idx}`) || {}).value?.trim();
  const amount = Number((document.getElementById(`edit-amt-${type}-${idx}`) || {}).value);
  if (!desc || !amount || amount <= 0) return;
  const date  = (document.getElementById(`edit-date-${type}-${idx}`) || {}).value || '';
  const entry = date ? { desc, amount, date } : { desc, amount };

  // For loans: capture loan tag and sync payment in Loan Tracker
  if (type === 'loan') {
    const prev  = data[type][idx]; // snapshot before overwrite
    const tagEl = document.getElementById(`edit-loantag-${idx}`);
    const newLoanId = tagEl ? tagEl.value : (prev.loanId || '');

    if (newLoanId) {
      const loans  = (typeof loansData !== 'undefined') ? loansData : [];
      const linked = loans.find(l => l.id === newLoanId);
      if (linked) { entry.loanId = linked.id; entry.loanName = linked.name; }
    }

    if (prev.paymentId) {
      if (!entry.loanId) {
        // Tag cleared → remove the payment
        autoRemoveLoanPayment(prev.loanId, prev.paymentId);
      } else if (prev.loanId !== entry.loanId) {
        // Switched to a different loan → remove from old, add to new
        autoRemoveLoanPayment(prev.loanId, prev.paymentId);
        autoLogLoanPayment(entry);
      } else {
        // Same loan → update amount/date/note in place
        entry.paymentId = prev.paymentId;
        autoUpdateLoanPayment(entry);
      }
    } else if (entry.loanId) {
      // Newly tagged → log a fresh payment
      autoLogLoanPayment(entry);
    }
  }

  data[type][idx] = entry;
  saveData(); render();
}

function cancelEditRow(type, idx) {
  render();
}

/* ── Checklist ────────────────────────────────────────────── */
function toggleCheck(i) {
  data.checklist[i].done = !data.checklist[i].done;
  saveData(); render();
}

function toggleCheckRepeat(i) {
  data.checklist[i].repeat = !data.checklist[i].repeat;
  saveData(); render();
}

function delCheck(i) {
  data.checklist.splice(i, 1);
  saveData(); render();
}

function addCheckItem() {
  const inp    = document.getElementById('checkDesc');
  const repeat = document.getElementById('checkRepeat');
  const val = inp.value.trim();
  if (!val) return;
  data.checklist.push({ label: val, done: false, repeat: !!(repeat && repeat.checked) });
  inp.value = '';
  if (repeat) repeat.checked = false;
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
    expDesc: 'expense',  expAmt: 'expense',  expDate: 'expense',
    incDesc: 'income',   incAmt: 'income',   incDate: 'income',
    invDesc: 'investment', invAmt: 'investment', invDate: 'investment',
    loanDesc: 'loan',    loanAmt: 'loan',    loanDate: 'loan',
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

/* ── Notes ────────────────────────────────────────────────── */
function addNote() {
  const inp = document.getElementById('noteInput');
  const text = inp.value.trim();
  if (!text) return;
  if (!Array.isArray(data.notes)) data.notes = [];
  data.notes.unshift({
    id:        Date.now(),
    text,
    pinned:    false,
    createdAt: new Date().toISOString(),
  });
  inp.value = '';
  saveData();
  renderNotes();
}

function deleteNote(id) {
  data.notes = data.notes.filter(n => n.id !== id);
  saveData();
  renderNotes();
}

function togglePinNote(id) {
  const note = data.notes.find(n => n.id === id);
  if (!note) return;
  note.pinned = !note.pinned;
  // Keep pinned notes at the top
  data.notes.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  saveData();
  renderNotes();
}

function startEditNote(id) {
  const note = data.notes.find(n => n.id === id);
  if (!note) return;
  const el = document.getElementById(`note-text-${id}`);
  const actionsEl = document.getElementById(`note-actions-${id}`);
  if (!el) return;

  el.contentEditable = 'true';
  el.focus();
  // Move cursor to end
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);

  el.classList.add('editing');
  if (actionsEl) actionsEl.style.display = 'none';

  // Show save/cancel inline
  const saveRow = document.getElementById(`note-edit-row-${id}`);
  if (saveRow) saveRow.style.display = 'flex';
}

function saveEditNote(id) {
  const note = data.notes.find(n => n.id === id);
  if (!note) return;
  const el = document.getElementById(`note-text-${id}`);
  if (!el) return;
  const newText = el.innerText.trim();
  if (!newText) { cancelEditNote(id); return; }
  note.text = newText;
  note.editedAt = new Date().toISOString();
  el.contentEditable = 'false';
  el.classList.remove('editing');
  const saveRow = document.getElementById(`note-edit-row-${id}`);
  if (saveRow) saveRow.style.display = 'none';
  saveData();
  renderNotes();
}

function cancelEditNote(id) {
  renderNotes(); // Just re-render to discard changes
}

function initNotesEvents() {
  const inp = document.getElementById('noteInput');
  if (inp) {
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addNote(); }
    });
  }
}

/* ── Quick Add widget adapter ─────────────────────────────────
   Bridges the app-agnostic QuickAddBot core to Classic's `data`
   global and the loan-payment auto-sync helpers above. */
document.addEventListener('DOMContentLoaded', () => {
  if (typeof QuickAddBot === 'undefined') return;
  QuickAddBot.init({
    fabIcon: 'FinBolt.png',
    getLoans: () => (typeof loansData !== 'undefined' ? loansData : [])
      .map(l => ({ id: l.id, name: l.name })),
    onSubmit: (type, entry) => {
      if (entry.loanId) autoLogLoanPayment(entry);
      data[type].push(entry);
      saveData(); render();
      return () => {
        const idx = data[type].indexOf(entry);
        if (idx === -1) return;
        if (entry.loanId && entry.paymentId) autoRemoveLoanPayment(entry.loanId, entry.paymentId);
        data[type].splice(idx, 1);
        saveData(); render();
      };
    },
  });
});
