/* ============================================================
   fr-sync.js — Firebase Auth + Firestore sync for v2 UI
   FinResolver

   Data format on Firestore (shared with classic v1 UI):
     Monthly : users/{uid}/months/{year}_{month}  → { _enc: "ENC1:..." }
     Loans   : users/{uid}/config/loans           → { _enc: "ENC1:..." }
     Investments: users/{uid}/config/investments  → { _enc: "ENC1:..." }

   Encryption/decryption is handled by ../js/crypto.js (AES-GCM,
   same key derivation as the classic UI so data is fully portable).

   Storage schema bridge:
     v1 keys  (stored): initialAmount, expense[], investment[], loan[]
     v2 keys (in-memory): initialBalance, expenses[], investments[], loans[]
   ============================================================ */

const _FR_CONFIG   = (window.FINRESOLVER_CONFIG || {});
const _FB_CONFIG   = _FR_CONFIG.firebase   || {};
const _GOOGLE_CID  = _FR_CONFIG.googleClientId || '';

let _db          = null;
let _fbAuth      = null;
let _syncReady   = false;
let _currentUID  = null;
let _currentEmail = null;

// Tracks which month's data is currently loaded into APP.monthly
let _loadedYear  = null;
let _loadedMonth = null;

let _saveDebounce = null;

// ── Schema bridge ─────────────────────────────────────────────────────────────

function _v2ToStorage(monthly) {
  return {
    initialAmount: monthly.initialBalance || 0,
    expense:    monthly.expenses    || [],
    income:     monthly.income      || [],
    investment: monthly.investments || [],
    loan:       monthly.loans       || [],
    checklist:  monthly.checklist   || [],
    notes:      monthly.notes       || [],
  };
}

function _storageToV2(d, year, month) {
  let nextId = 1;
  const ensureIds = arr =>
    (arr || []).map(e => ({ ...e, id: e.id ?? nextId++ }));
  return {
    year, month,
    initialBalance: d.initialAmount || 0,
    expenses:    ensureIds(d.expense    || d.expenses    || []),
    income:      ensureIds(d.income     || []),
    investments: ensureIds(d.investment || d.investments || []),
    loans:       ensureIds(d.loan       || d.loans       || []),
    checklist:   (d.checklist || []).map((c, i) => ({ ...c, id: c.id ?? i + 1 })),
    notes:       (d.notes    || []).map((n, i) => ({ ...n, id: n.id ?? i + 1 })),
  };
}

function _emptyMonthly(year, month) {
  return {
    year, month,
    initialBalance: 0,
    expenses: [], income: [], investments: [], loans: [],
    checklist: [],
    notes: [],
  };
}

// Builds the repeating checklist items to carry into a brand-new month,
// from the previous month's storage-shaped data (v1 field names).
function _carryForwardChecklist(prevData) {
  let nid = 1;
  return (prevData?.checklist || [])
    .filter(c => c.repeat)
    .map(c => ({ id: nid++, label: c.label, done: false, repeat: true }));
}

// ── Firebase init ─────────────────────────────────────────────────────────────

function _initFirebase() {
  if (!_FB_CONFIG.apiKey || _FB_CONFIG.apiKey === 'YOUR_FIREBASE_API_KEY') {
    console.info('[Sync] No Firebase config — local-only mode.');
    setSyncBadge('offline');
    return;
  }
  setSyncBadge('syncing');
  const BASE = 'https://www.gstatic.com/firebasejs/10.12.2';
  _loadScript(`${BASE}/firebase-app-compat.js`, () =>
    _loadScript(`${BASE}/firebase-auth-compat.js`, () =>
      _loadScript(`${BASE}/firebase-firestore-compat.js`, () => {
        try {
          if (!firebase.apps.length) firebase.initializeApp(_FB_CONFIG);
          _fbAuth = firebase.auth();
          _db     = firebase.firestore();
          console.info('[Sync] Firebase ready:', _FB_CONFIG.projectId);

          _fbAuth.onAuthStateChanged(async fbUser => {
            if (fbUser) {
              _syncReady   = true;
              _currentUID  = fbUser.uid;
              _currentEmail = fbUser.email;
              console.info('[Sync] Auth uid:', fbUser.uid);

              // Check if the app is already shown (session was restored by fr-app.js)
              const layout = document.getElementById('app-layout');
              if (layout && layout.style.display !== 'none') {
                // Update user if session stored
                const stored = localStorage.getItem('fr_session');
                if (stored) {
                  try {
                    const s = JSON.parse(stored);
                    APP.user = { ...s, uid: fbUser.uid };
                  } catch {}
                }
                setSyncBadge('syncing');
                await loadAllData();
              }
            } else {
              _syncReady = false;
              setSyncBadge('offline');
            }
          });
        } catch (err) {
          console.error('[Sync] Init error:', err);
          setSyncBadge('offline');
        }
      })
    )
  );
}

// ── Google Identity Services auth ─────────────────────────────────────────────

let _gisTokenClient = null;

function _initGIS() {
  if (!_GOOGLE_CID) return;
  const s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client';
  s.async = s.defer = true;
  s.onload = () => {
    _gisTokenClient = google.accounts.oauth2.initTokenClient({
      client_id: _GOOGLE_CID,
      scope: 'openid email profile',
      callback: async resp => {
        if (resp.error) { setSyncBadge('offline'); return; }
        await _resolveAccessToken(resp.access_token);
      },
    });
    // One Tap
    google.accounts.id.initialize({
      client_id: _GOOGLE_CID,
      callback: _handleOneTap,
      auto_select: false,
    });
  };
  document.head.appendChild(s);
}

async function _resolveAccessToken(accessToken) {
  try {
    const res  = await fetch('https://www.googleapis.com/oauth2/v3/userinfo',
      { headers: { Authorization: 'Bearer ' + accessToken } });
    const info = await res.json();
    if (!info.sub) throw new Error('Bad userinfo');
    const cred = firebase.auth.GoogleAuthProvider.credential(null, accessToken);
    await _firebaseSignIn(cred, info);
  } catch (e) {
    console.error('[Sync] Access token resolve failed:', e);
    setSyncBadge('offline');
  }
}

async function _handleOneTap(response) {
  try {
    const payload = JSON.parse(atob(response.credential.split('.')[1]));
    const cred = firebase.auth.GoogleAuthProvider.credential(response.credential, null);
    await _firebaseSignIn(cred, payload);
  } catch (e) {
    console.error('[Sync] One Tap failed:', e);
    setSyncBadge('offline');
  }
}

async function _firebaseSignIn(credential, profile) {
  try {
    const result = await _fbAuth.signInWithCredential(credential);
    const uid    = result.user.uid;
    _currentUID   = uid;
    _currentEmail = result.user.email || profile.email;
    APP.user = {
      uid,
      name:     profile.name,
      email:    profile.email,
      initials: _initials(profile.name),
      photo:    profile.picture || null,
    };
    localStorage.setItem('fr_session', JSON.stringify(APP.user));
    showApp();
    setSyncBadge('syncing');
    await loadAllData();
  } catch (e) {
    console.error('[Sync] Firebase sign-in failed:', e);
    setSyncBadge('offline');
  }
}

// Override the stub in fr-app.js
function loginGoogle() {
  if (!_GOOGLE_CID || typeof google === 'undefined' || !_gisTokenClient) {
    // GIS not ready yet — retry
    setTimeout(loginGoogle, 400);
    return;
  }
  google.accounts.id.prompt(n => {
    if (n.isNotDisplayed() || n.isSkippedMoment()) {
      _gisTokenClient.requestAccessToken();
    }
  });
}

// ── Load all data ─────────────────────────────────────────────────────────────

async function loadAllData() {
  if (!_currentUID) return;
  const year  = APP.monthly.year;
  const month = APP.monthly.month;

  await Promise.all([
    _loadMonth(year, month),
    _loadLoansConfig(),
    _loadInvestmentsConfig(),
    _loadLifestyleConfig(),
    _loadGoalsConfig(),
    _loadDayPlannerConfig(),
    dpv2SyncTodayFromFirestore(),
  ]);

  _loadedYear  = year;
  _loadedMonth = month;

  await _loadRecentHistory(6);

  // Re-render current screen with real data
  const sc = document.getElementById('screen-content');
  if (sc) renderScreen(_screen || 'dashboard', sc);
}

// ── Monthly data ──────────────────────────────────────────────────────────────

async function _loadMonth(year, month) {
  // month is 1-indexed internally; classic v1 storage uses 0-indexed keys
  const storageMonth = month - 1;
  const localKey    = `fr_data_${_currentUID}_${year}_${storageMonth}`;
  const firestoreKey = `${year}_${storageMonth}`;

  // 1. Apply localStorage data immediately (instant render)
  const localRaw = localStorage.getItem(localKey);
  if (localRaw) {
    const d = await decryptFromStorage(localRaw, _currentEmail);
    if (d) _applyMonthData(d, year, month);
  }

  // 2. Fetch Firestore for latest
  if (_syncReady && _db) {
    try {
      const snap = await _db.collection('users').doc(_currentUID)
        .collection('months').doc(firestoreKey).get();

      if (snap.exists) {
        const raw = snap.data()._enc || JSON.stringify(snap.data());
        const d   = await decryptFromStorage(raw, _currentEmail);
        if (d) {
          localStorage.setItem(localKey, raw);
          _applyMonthData(d, year, month);
        }
      } else if (!localRaw) {
        // Brand new month — seed initial balance and repeating checklist items from prev month
        const prevData = await _getPrevMonthData(year, month);
        const empty = _emptyMonthly(year, month);
        if (prevData) {
          const prevBalance = _calcBalance(_storageToV2(prevData, year, month));
          if (prevBalance) empty.initialBalance = prevBalance;
          empty.checklist = _carryForwardChecklist(prevData);
        }
        _applyMonthData(_v2ToStorage(empty), year, month);
      }
      setSyncBadge('synced');
    } catch (e) {
      console.error('[Sync] Month load failed:', e);
      setSyncBadge('offline');
    }
  } else if (!localRaw) {
    // Brand new month, offline/unsynced — still carry forward repeating checklist items
    const prevData = await _getPrevMonthData(year, month);
    const empty = _emptyMonthly(year, month);
    if (prevData) empty.checklist = _carryForwardChecklist(prevData);
    _applyMonthData(_v2ToStorage(empty), year, month);
  }
}

function _applyMonthData(d, year, month) {
  const m = _storageToV2(d, year, month);
  APP.monthly = m;
  _loadedYear  = year;
  _loadedMonth = month;
  if (_screen === 'monthly') {
    const sc = document.getElementById('screen-content');
    if (sc) renderScreen('monthly', sc);
  }
}

// Returns the previous month's raw storage-shaped data object (or null).
// `year`/`month` are the *new* month being loaded; this steps back one month.
async function _getPrevMonthData(year, month) {
  // month is 1-indexed; step back one month (still 1-indexed)
  let y = year, m = month - 1;
  if (m < 1) { m = 12; y--; }
  // convert to 0-indexed for storage keys (to match classic v1)
  const sm = m - 1;
  const raw = localStorage.getItem(`fr_data_${_currentUID}_${y}_${sm}`);
  if (raw) return (await decryptFromStorage(raw, _currentEmail)) || null;

  if (_syncReady && _db) {
    try {
      const snap = await _db.collection('users').doc(_currentUID)
        .collection('months').doc(`${y}_${sm}`).get();
      if (snap.exists) {
        return await decryptFromStorage(
          snap.data()._enc || JSON.stringify(snap.data()), _currentEmail);
      }
    } catch {}
  }
  return null;
}

function _calcBalance(v2) {
  const sum = arr => (arr || []).reduce((a, e) => a + (e.amount || 0), 0);
  return v2.initialBalance + sum(v2.income) - sum(v2.expenses) - sum(v2.investments) - sum(v2.loans);
}

async function _loadRecentHistory(n) {
  const sum   = arr => (arr || []).reduce((a, e) => a + (e.amount || 0), 0);
  const entries = [];
  const year  = APP.monthly.year;
  const month = APP.monthly.month;

  for (let i = 0; i < n; i++) {
    let y = year, m = month - i;
    while (m < 1) { m += 12; y--; }

    if (i === 0) {
      entries.push({
        year: y, month: m,
        expenses: sum(APP.monthly.expenses),
        income:   sum(APP.monthly.income),
        balance:  _calcBalance(APP.monthly),
      });
    } else {
      const sm  = m - 1; // 0-indexed storage key
      const key = `fr_data_${_currentUID}_${y}_${sm}`;
      let raw   = localStorage.getItem(key);

      if (!raw && _syncReady && _db) {
        try {
          const snap = await _db.collection('users').doc(_currentUID)
            .collection('months').doc(`${y}_${sm}`).get();
          if (snap.exists) {
            raw = snap.data()._enc || JSON.stringify(snap.data());
            localStorage.setItem(key, raw);
          }
        } catch {}
      }

      if (raw) {
        const d = await decryptFromStorage(raw, _currentEmail);
        if (d) {
          const v2 = _storageToV2(d, y, m);
          entries.push({
            year: y, month: m,
            expenses: sum(v2.expenses),
            income:   sum(v2.income),
            balance:  _calcBalance(v2),
          });
        }
      }
    }
  }

  APP.history = entries.reverse(); // oldest first
}

// ── Save monthly ──────────────────────────────────────────────────────────────

async function saveCurrentMonth() {
  const year  = _loadedYear;
  const month = _loadedMonth;
  if (!_currentUID || year === null) return;

  // month is 1-indexed internally; classic v1 storage uses 0-indexed keys
  const storageMonth = month - 1;
  const localKey    = `fr_data_${_currentUID}_${year}_${storageMonth}`;
  const firestoreKey = `${year}_${storageMonth}`;
  const payload  = _v2ToStorage(APP.monthly);
  const encStr   = await encryptForStorage(payload, _currentEmail);

  localStorage.setItem(localKey, encStr);

  if (_syncReady && _db) {
    setSyncBadge('syncing');
    try {
      await _db.collection('users').doc(_currentUID)
        .collection('months').doc(firestoreKey).set({ _enc: encStr });
      setSyncBadge('synced');
    } catch (e) {
      console.error('[Sync] Save month failed:', e);
      setSyncBadge('offline');
    }
  }
}

// ── Loans config ──────────────────────────────────────────────────────────────

async function _loadLoansConfig() {
  const localKey = `fr_loans_${_currentUID}`;
  const localRaw = localStorage.getItem(localKey);
  if (localRaw) {
    const d = await decryptFromStorage(localRaw, _currentEmail);
    if (Array.isArray(d?.loans)) APP.loans = d.loans;
  }
  if (_syncReady && _db) {
    try {
      const snap = await _db.collection('users').doc(_currentUID)
        .collection('config').doc('loans').get();
      if (snap.exists) {
        const raw = snap.data()._enc || JSON.stringify(snap.data());
        const d   = await decryptFromStorage(raw, _currentEmail);
        if (Array.isArray(d?.loans)) {
          APP.loans = d.loans;
          localStorage.setItem(localKey, raw);
        }
      }
    } catch (e) {
      console.warn('[Sync] Loans load failed:', e);
    }
  }
}

async function saveLoansConfig() {
  if (!_currentUID) return;
  const payload = { loans: APP.loans };
  const encStr  = await encryptForStorage(payload, _currentEmail);
  localStorage.setItem(`fr_loans_${_currentUID}`, encStr);
  if (_syncReady && _db) {
    try {
      await _db.collection('users').doc(_currentUID)
        .collection('config').doc('loans').set({ _enc: encStr });
    } catch (e) {
      console.warn('[Sync] Loans save failed:', e);
    }
  }
}

// ── Investments config ────────────────────────────────────────────────────────

async function _loadInvestmentsConfig() {
  const localKey = `fr_investments_${_currentUID}`;
  const localRaw = localStorage.getItem(localKey);
  if (localRaw) {
    const d = await decryptFromStorage(localRaw, _currentEmail);
    if (Array.isArray(d)) APP.investments = d;                  // classic raw-array format
    else if (Array.isArray(d?.investments)) APP.investments = d.investments;  // v2 wrapped format
  }
  if (_syncReady && _db) {
    try {
      const snap = await _db.collection('users').doc(_currentUID)
        .collection('config').doc('investments').get();
      if (snap.exists) {
        const raw = snap.data()._enc || JSON.stringify(snap.data());
        const d   = await decryptFromStorage(raw, _currentEmail);
        if (Array.isArray(d?.investments)) {
          APP.investments = d.investments;
          localStorage.setItem(`fr_investments_${_currentUID}`, raw);
        }
      }
    } catch (e) {
      console.warn('[Sync] Investments load failed:', e);
    }
  }
}

async function saveInvestmentsConfig() {
  if (!_currentUID) return;
  const payload = { investments: APP.investments };
  const encStr  = await encryptForStorage(payload, _currentEmail);
  localStorage.setItem(`fr_investments_${_currentUID}`, encStr);
  if (_syncReady && _db) {
    try {
      await _db.collection('users').doc(_currentUID)
        .collection('config').doc('investments').set({ _enc: encStr });
    } catch (e) {
      console.warn('[Sync] Investments save failed:', e);
    }
  }
}

// ── Lifestyle config ──────────────────────────────────────────────────────────

async function _loadLifestyleConfig() {
  const localKey = `fr_lifestyle_${_currentUID}`;
  const localRaw = localStorage.getItem(localKey);
  if (localRaw) {
    const d = await decryptFromStorage(localRaw, _currentEmail);
    if (d && typeof d === 'object') {
      APP.lifestyle = { goods: Array.isArray(d.goods) ? d.goods : [], events: Array.isArray(d.events) ? d.events : [] };
    }
  }
  if (_syncReady && _db) {
    try {
      const snap = await _db.collection('users').doc(_currentUID)
        .collection('config').doc('lifestyle').get();
      if (snap.exists) {
        const raw = snap.data()._enc || JSON.stringify(snap.data());
        const d   = await decryptFromStorage(raw, _currentEmail);
        if (d && typeof d === 'object') {
          APP.lifestyle = { goods: Array.isArray(d.goods) ? d.goods : [], events: Array.isArray(d.events) ? d.events : [] };
          localStorage.setItem(localKey, raw);
        }
      }
    } catch (e) {
      console.warn('[Sync] Lifestyle load failed:', e);
    }
  }
}

async function saveLifestyleConfig() {
  if (!_currentUID) return;
  if (!APP.lifestyle) APP.lifestyle = { goods: [], events: [] };
  const encStr = await encryptForStorage(APP.lifestyle, _currentEmail);
  localStorage.setItem(`fr_lifestyle_${_currentUID}`, encStr);
  if (_syncReady && _db) {
    try {
      await _db.collection('users').doc(_currentUID)
        .collection('config').doc('lifestyle').set({ _enc: encStr });
    } catch (e) {
      console.warn('[Sync] Lifestyle save failed:', e);
    }
  }
}

// ── Day Planner config (schedule window) ─────────────────────────────────────
// Same Firestore path as classic v1 UI (users/{uid}/config/dayplanner), so a
// user's schedule window is shared between Classic and Modern.

async function _loadDayPlannerConfig() {
  const localKey = `fr_dayplanner_cfg_${_currentUID}`;
  const localRaw = localStorage.getItem(localKey);
  if (localRaw) {
    const d = await decryptFromStorage(localRaw, _currentEmail);
    if (d && d.slotMinutes && d.toMin > d.fromMin) APP.dayplanner.config = d;
  }
  if (_syncReady && _db) {
    try {
      const snap = await _db.collection('users').doc(_currentUID)
        .collection('config').doc('dayplanner').get();
      if (snap.exists) {
        const raw = snap.data()._enc || JSON.stringify(snap.data());
        const d   = await decryptFromStorage(raw, _currentEmail);
        if (d && d.slotMinutes && d.toMin > d.fromMin) {
          APP.dayplanner.config = d;
          localStorage.setItem(localKey, raw);
        }
      }
    } catch (e) {
      console.warn('[Sync] Day Planner config load failed:', e);
    }
  }
}

async function saveDayPlannerConfig() {
  if (!_currentUID || !APP.dayplanner.config) return;
  const encStr = await encryptForStorage(APP.dayplanner.config, _currentEmail);
  localStorage.setItem(`fr_dayplanner_cfg_${_currentUID}`, encStr);
  if (_syncReady && _db) {
    try {
      await _db.collection('users').doc(_currentUID)
        .collection('config').doc('dayplanner').set({ _enc: encStr });
    } catch (e) {
      console.warn('[Sync] Day Planner config save failed:', e);
    }
  }
}

// ── Goals config ──────────────────────────────────────────────────────────────

async function _loadGoalsConfig() {
  const localKey = `fr_goals_${_currentUID}`;
  const localRaw = localStorage.getItem(localKey);
  if (localRaw) {
    const d = await decryptFromStorage(localRaw, _currentEmail);
    if (d && typeof d === 'object') {
      if (Array.isArray(d.goals))           APP.goals           = d.goals;
      if (Array.isArray(d.goalAllocations)) APP.goalAllocations = d.goalAllocations;
    }
  }
  if (_syncReady && _db) {
    try {
      const snap = await _db.collection('users').doc(_currentUID)
        .collection('config').doc('goals').get();
      if (snap.exists) {
        const raw = snap.data()._enc || JSON.stringify(snap.data());
        const d   = await decryptFromStorage(raw, _currentEmail);
        if (d && typeof d === 'object') {
          if (Array.isArray(d.goals))           APP.goals           = d.goals;
          if (Array.isArray(d.goalAllocations)) APP.goalAllocations = d.goalAllocations;
          localStorage.setItem(localKey, raw);
        }
      }
    } catch (e) {
      console.warn('[Sync] Goals load failed:', e);
    }
  }
}

async function saveGoalsConfig() {
  if (!_currentUID) return;
  const payload = { goals: APP.goals || [], goalAllocations: APP.goalAllocations || [] };
  const encStr  = await encryptForStorage(payload, _currentEmail);
  localStorage.setItem(`fr_goals_${_currentUID}`, encStr);
  if (_syncReady && _db) {
    try {
      await _db.collection('users').doc(_currentUID)
        .collection('config').doc('goals').set({ _enc: encStr });
    } catch (e) {
      console.warn('[Sync] Goals save failed:', e);
    }
  }
}

// ── Navigation hook (called from navigate() in fr-app.js) ────────────────────

function _syncOnNavigate(toScreen, fromScreen) {
  if (!_currentUID) return;

  const newY = APP.monthly.year, newM = APP.monthly.month;
  const monthChanged = newY !== _loadedYear || newM !== _loadedMonth;

  if (toScreen === 'monthly') {
    if (monthChanged && _loadedYear !== null) {
      // Save old month immediately, then load new month
      clearTimeout(_saveDebounce);
      saveCurrentMonth().then(() => {
        _loadedYear = newY; _loadedMonth = newM;
        _loadMonth(newY, newM);
      });
    } else if (!monthChanged && _loadedYear !== null) {
      // Same month — debounced save after mutation
      clearTimeout(_saveDebounce);
      _saveDebounce = setTimeout(saveCurrentMonth, 800);
    } else if (_loadedYear === null) {
      // First time on monthly after login
      _loadedYear = newY; _loadedMonth = newM;
      _loadMonth(newY, newM);
    }
  } else if (fromScreen === 'monthly' && _loadedYear !== null) {
    // Leaving monthly — save immediately
    clearTimeout(_saveDebounce);
    saveCurrentMonth();
  }
}

// ── Sign out ──────────────────────────────────────────────────────────────────

async function logout() {
  clearTimeout(_saveDebounce);
  if (_loadedYear !== null) await saveCurrentMonth();

  if (_fbAuth) await _fbAuth.signOut().catch(() => {});
  if (typeof google !== 'undefined') {
    google.accounts.id.disableAutoSelect();
    if (_currentEmail) google.accounts.id.revoke(_currentEmail, () => {});
  }

  // Clear all localStorage data for this user so the next user starts clean
  // (mirrors classic v1's logOut() in js/auth.js — same key shapes, since v2
  // shares localStorage with v1 for the same signed-in user). v2 previously
  // never scrubbed any of this on sign-out.
  const signedOutUid = _currentUID;
  if (signedOutUid) {
    const dataPrefix = `fr_data_${signedOutUid}_`;
    const dpPrefix    = `finresolver_dayplanner_${signedOutUid}_`;
    Object.keys(localStorage)
      .filter(k => k.startsWith(dataPrefix) || k.startsWith(dpPrefix))
      .forEach(k => localStorage.removeItem(k));
    localStorage.removeItem(`fr_loans_${signedOutUid}`);
    localStorage.removeItem(`fr_investments_${signedOutUid}`);
    localStorage.removeItem(`fr_lifestyle_${signedOutUid}`);
    localStorage.removeItem(`fr_goals_${signedOutUid}`);
    localStorage.removeItem(`fr_dayplanner_cfg_${signedOutUid}`);
    localStorage.removeItem(`finresolver_dayplanner_recurring_${signedOutUid}`);
  }
  if (typeof resetDayPlannerV2State === 'function') resetDayPlannerV2State();

  _syncReady   = false;
  _currentUID  = null;
  _currentEmail = null;
  _loadedYear  = null;
  _loadedMonth = null;

  localStorage.removeItem('fr_session');
  setSyncBadge('offline');

  // Reset APP to clean state
  APP.user = { name: 'Guest', email: '', initials: 'G' };
  APP.monthly = { year: new Date().getFullYear(), month: new Date().getMonth() + 1,
    initialBalance: 0, expenses: [], income: [], investments: [], loans: [],
    checklist: [], notes: [] };
  APP.loans             = [];
  APP.investments       = [];
  APP.goals             = [];
  APP.goalAllocations   = [];
  APP.activeGoalId      = null;
  APP.dayplanner        = { config: null, slots: {} };

  document.getElementById('app-layout').style.display = 'none';
  document.getElementById('login-screen').style.display = '';
  if (typeof QuickAddBot !== 'undefined') QuickAddBot.hide();
}

// ── Sync badge ────────────────────────────────────────────────────────────────

function setSyncBadge(status) {
  const el = document.getElementById('sync-badge');
  if (!el) return;
  const map = {
    syncing: { text: '↑ Syncing…', color: 'var(--gold)' },
    synced:  { text: '✓ Synced',   color: 'var(--accent)' },
    offline: { text: 'Local only', color: 'var(--t3)' },
  };
  const s = map[status] || map.offline;
  el.textContent = s.text;
  el.style.color  = s.color;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _loadScript(src, cb) {
  const s = document.createElement('script');
  s.src = src; s.async = true;
  s.onload  = cb;
  s.onerror = () => { console.error('[Sync] Failed to load:', src); setSyncBadge('offline'); };
  document.head.appendChild(s);
}

function _initials(name = '') {
  return name.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

// ── Boot ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  _initGIS();
  _initFirebase();
});
