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

// Decrypted monthly data cache — keyed by `${uid}_${year}_${month}`.
// Populated on every load so that getMonthBalance() can work synchronously
// without re-decrypting from localStorage on each chart/dashboard render.
const _monthCache = new Map();

function clearDataCache() { _monthCache.clear(); }

function emptyData() {
  return {
    initialAmount: 0,
    expense:    [],
    income:     [],
    investment: [],
    loan:       [],
    notes: [],          // { id, text, pinned, createdAt }
    checklist: [],      // { label, done, repeat } — starts empty; repeat items carry over from the previous month
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

/* ── Previous month data ──────────────────────────────────── */
/**
 * Returns the full data object for the month immediately before
 * the currently selected year/month, for this user (or null if none).
 * Used to seed a new month's initial balance and repeating checklist items.
 */
async function getPrevMonthData() {
  const uid   = currentUser?.uid || 'guest';
  let year  = Number(document.getElementById('yearSelect').value);
  let month = Number(document.getElementById('monthSelect').value);

  // Step back one month
  month -= 1;
  if (month < 0) { month = 11; year -= 1; }

  const cacheKey = `${uid}_${year}_${month}`;
  if (_monthCache.has(cacheKey)) return _monthCache.get(cacheKey);

  const raw = localStorage.getItem(`fr_data_${uid}_${year}_${month}`);
  if (!raw) return null;

  // If encrypted, decrypt asynchronously
  const email = currentUser?.email || null;
  const d = await decryptFromStorage(raw, email);
  if (d) { _monthCache.set(cacheKey, d); return d; }
  return null;
}

/**
 * Returns the closing balance of the month immediately before
 * the currently selected year/month, for this user.
 * Used to auto-populate the initial balance of a new month.
 */
async function getPrevMonthBalance() {
  const d = await getPrevMonthData();
  return d ? calcBalance(d) : 0;
}

/* ── Load ─────────────────────────────────────────────────── */
async function loadData() {
  const key   = getDataKey();
  const raw   = localStorage.getItem(key);
  const email = currentUser?.email || null;
  const uid   = currentUser?.uid   || 'guest';
  const year  = document.getElementById('yearSelect').value;
  const month = document.getElementById('monthSelect').value;

  if (raw) {
    // Existing month — decrypt and load
    data = (await decryptFromStorage(raw, email)) || emptyData();
    // Migrate: older saves may not have a notes array
    if (!Array.isArray(data.notes)) data.notes = [];
    _monthCache.set(`${uid}_${year}_${month}`, data);
  } else {
    // New month — seed initial balance from previous month's closing balance,
    // and carry forward any checklist items flagged to repeat monthly.
    const prevData = await getPrevMonthData();
    data = emptyData();
    if (prevData) {
      const prevBalance = calcBalance(prevData);
      if (prevBalance !== 0) data.initialAmount = prevBalance;
      data.checklist = (prevData.checklist || [])
        .filter(c => c.repeat)
        .map(c => ({ label: c.label, done: false, repeat: true }));
    }
    if (data.initialAmount || data.checklist.length) {
      // Save immediately so the pre-fill persists
      localStorage.setItem(key, await encryptForStorage(data, email));
    }
  }

  render();
}

/* ── Save ─────────────────────────────────────────────────── */
async function saveData() {
  if (!currentUser) return;
  const key   = getDataKey();
  const email = currentUser.email || null;
  const uid   = currentUser.uid   || 'guest';
  const year  = document.getElementById('yearSelect').value;
  const month = document.getElementById('monthSelect').value;

  localStorage.setItem(key, await encryptForStorage(data, email));
  _monthCache.set(`${uid}_${year}_${month}`, data);

  // Push to cloud if sync is available (sync.js)
  if (typeof syncSaveData === 'function') {
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

// Compute closing balance from a data object.
function calcBalance(d) {
  return (
    (Number(d.initialAmount) || 0)
    + sumArr(d.income)
    - sumArr(d.expense)
    - sumArr(d.investment)
    - sumArr(d.loan)
  );
}

function getMonthBalance(uid, year, month) {
  // Check in-memory cache first (populated by loadData / sync prefetch).
  const cacheKey = `${uid}_${year}_${month}`;
  if (_monthCache.has(cacheKey)) return calcBalance(_monthCache.get(cacheKey));

  const raw = localStorage.getItem(`fr_data_${uid}_${year}_${month}`);
  if (!raw) return 0;

  // Encrypted data cannot be decoded synchronously here.
  // Return 0 — the caller will re-render once the async sync completes
  // and populates _monthCache via syncPrefetchPastMonths / loadData.
  if (raw.startsWith('ENC1:')) return 0;

  // Legacy plain-JSON (pre-encryption) — parse, cache, return.
  const d = JSON.parse(raw);
  _monthCache.set(cacheKey, d);
  return calcBalance(d);
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

/**
 * Returns the decrypted data object for any month, using _monthCache first.
 * Falls back to plain-JSON localStorage for legacy (unencrypted) entries.
 * Returns null when the month has no data or is encrypted but not yet cached
 * (caller should wait for syncPrefetchPastMonths to populate the cache).
 */
function getCachedMonthData(uid, year, month) {
  const cacheKey = `${uid}_${year}_${month}`;
  if (_monthCache.has(cacheKey)) return _monthCache.get(cacheKey);
  const raw = localStorage.getItem(`fr_data_${uid}_${year}_${month}`);
  if (!raw) return null;
  if (raw.startsWith('ENC1:')) return null; // encrypted but not yet in cache
  const d = JSON.parse(raw);
  _monthCache.set(cacheKey, d);
  return d;
}

/* ── Shared helpers ───────────────────────────────────────── */
const fmt     = n => '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const sumArr  = arr => arr.reduce((a, b) => a + Number(b.amount), 0);
const escHtml = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const fmtDate = s => { if (!s) return ''; const d = new Date(s + 'T00:00:00'); return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); };
