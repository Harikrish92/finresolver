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

/* ── Inline row editing ───────────────────────────────────── */
function startEditRow(type, idx) {
  const row = document.getElementById(`tr-${type}-${idx}`);
  if (!row) return;
  const r = data[type][idx];
  row.classList.add('editing');
  row.innerHTML = `
    <td colspan="2">
      <div class="row-edit-fields">
        <input class="row-edit-input" id="edit-desc-${type}-${idx}"
               value="${escHtml(r.desc)}" placeholder="Description" />
        <input class="row-edit-input row-edit-amt" type="number"
               id="edit-amt-${type}-${idx}" value="${r.amount}" placeholder="Amount" />
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
  data[type][idx] = { desc, amount };
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
