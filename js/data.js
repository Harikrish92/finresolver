/* ============================================================
   data.js — Per-user, per-month data store
   FinResolver · finresolver.in

   localStorage key: fr_data_{uid}_{year}_{month}
   Cloud key (Firestore): users/{uid}/months/{year}_{month}

   When sync.js is present, all reads/writes go through Firestore
   and are also cached in localStorage for offline use.
   ============================================================ */

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December'
];

let data = emptyData();

function emptyData() {
  return {
    initialAmount: 0,
    expense:    [],
    income:     [],
    investment: [],
    loan:       [],
    checklist: [
      { label: 'HDFC CC Payment',  done: false },
      { label: 'IDFC CC Payment',  done: false },
      { label: 'SC CC Payment',    done: false },
      { label: 'Amex CC Payment',  done: false },
    ],
  };
}

/* ── Key helpers ──────────────────────────────────────────── */
function getDataKey() {
  // Always use Firebase Auth uid when available — it matches Firestore paths.
  // Falls back to currentUser.uid (which is also Firebase uid after first login).
  const uid = (typeof fbAuth !== 'undefined' && fbAuth?.currentUser?.uid)
    ? fbAuth.currentUser.uid
    : (currentUser?.uid || 'guest');
  const year  = document.getElementById('yearSelect').value;
  const month = document.getElementById('monthSelect').value;
  return `fr_data_${uid}_${year}_${month}`;
}

function getMonthKey(year, month) {
  return `${year}_${month}`;
}

/* ── Previous month closing balance ──────────────────────── */
/**
 * Returns the closing balance of the month immediately before
 * the currently selected year/month, for this user.
 * Used to auto-populate the initial balance of a new month.
 */
function getPrevMonthBalance() {
  const uid   = currentUser?.uid || 'guest';
  let year  = Number(document.getElementById('yearSelect').value);
  let month = Number(document.getElementById('monthSelect').value);

  // Step back one month
  month -= 1;
  if (month < 0) { month = 11; year -= 1; }

  return getMonthBalance(uid, year, month);
}

/* ── Load ─────────────────────────────────────────────────── */
function loadData() {
  const raw = localStorage.getItem(getDataKey());

  if (raw) {
    // Existing month — load as-is
    data = JSON.parse(raw);
  } else {
    // New month — seed initial balance from previous month's closing balance
    const prev = getPrevMonthBalance();
    data = emptyData();
    if (prev !== 0) {
      data.initialAmount = prev;
      // Save immediately so the pre-fill persists
      localStorage.setItem(getDataKey(), JSON.stringify(data));
    }
  }

  render();
}

/* ── Save ─────────────────────────────────────────────────── */
function saveData() {
  if (!currentUser) return;
  const key = getDataKey();
  localStorage.setItem(key, JSON.stringify(data));

  // Push to cloud if sync is available (sync.js)
  if (typeof syncSaveData === 'function') {
    const year  = document.getElementById('yearSelect').value;
    const month = document.getElementById('monthSelect').value;
    syncSaveData(getMonthKey(year, month), data);
  }
}

/* ── Clear current month ──────────────────────────────────── */
function clearMonthData() {
  const monthName = MONTHS[Number(document.getElementById('monthSelect').value)];
  const year      = document.getElementById('yearSelect').value;

  if (!confirm(`Clear ALL data for ${monthName} ${year}?\n\nThis will remove all expenses, income, investments, loans and reset the checklist. The initial balance will be kept.\n\nThis cannot be undone.`)) return;

  const savedInitial = data.initialAmount;
  data = emptyData();
  data.initialAmount = savedInitial; // preserve the initial balance
  saveData();
  render();
  showToast(`${monthName} ${year} data cleared`, 'success');
}

/* ── Balance helpers ──────────────────────────────────────── */
function getMonthBalance(uid, year, month) {
  // uid here is already the Firebase uid passed from render.js
  const raw = localStorage.getItem(`fr_data_${uid}_${year}_${month}`);
  if (!raw) return 0;
  const d = JSON.parse(raw);
  return (
    (Number(d.initialAmount) || 0)
    + sumArr(d.income)
    - sumArr(d.expense)
    - sumArr(d.investment)
    - sumArr(d.loan)
  );
}

/* ── Selectors ────────────────────────────────────────────── */
function initSelectors() {
  const now      = new Date();
  const monthSel = document.getElementById('monthSelect');
  const yearSel  = document.getElementById('yearSelect');

  MONTHS.forEach((m, i) => {
    const o = document.createElement('option');
    o.value = i; o.textContent = m;
    if (i === now.getMonth()) o.selected = true;
    monthSel.appendChild(o);
  });
  for (let y = 2020; y <= 2030; y++) {
    const o = document.createElement('option');
    o.value = y; o.textContent = y;
    if (y === now.getFullYear()) o.selected = true;
    yearSel.appendChild(o);
  }

  monthSel.addEventListener('change', onMonthChange);
  yearSel.addEventListener('change',  onMonthChange);
}

function onMonthChange() {
  // Only call syncLoadData if Firebase Auth is confirmed (syncReady=true).
  // Otherwise fall back to localStorage to avoid permission-denied races.
  if (typeof syncLoadData === 'function' && typeof syncReady !== 'undefined' && syncReady) {
    syncLoadData();
  } else {
    loadData();
  }
}

/* ── Shared helpers ───────────────────────────────────────── */
const fmt     = n => '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const sumArr  = arr => arr.reduce((a, b) => a + Number(b.amount), 0);
const escHtml = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
