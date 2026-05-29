/* ============================================================
   sync.js — Firebase Firestore cross-browser data sync
   FinResolver · finresolver.in

   FIRESTORE SECURITY RULES  (Firestore Console → Rules tab):
   ──────────────────────────────────────────────────────────
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{userId}/{document=**} {
         allow read, write: if request.auth != null
                            && request.auth.uid == userId;
       }
     }
   }
   ──────────────────────────────────────────────────────────

   Key design decision:
   Firebase Auth generates its OWN uid (e.g. BX7jnXX3mH...)
   which is DIFFERENT from the Google sub id (101115...).
   Firestore rules check Firebase's uid via request.auth.uid.
   So we MUST use fbAuth.currentUser.uid everywhere — both for
   the Firestore document path AND the localStorage cache key.

   Flow:
     GIS login → firebaseSignInWithIdToken/AccessToken()
               → signInWithCredential()  [returns Firebase uid]
               → applyUser({ uid: firebase_uid, ... })
               → onAuthStateChanged → syncLoadData()
   ============================================================ */

// ── Firebase config is loaded from js/config.js (gitignored) ──
const FIREBASE_CONFIG = (window.FINRESOLVER_CONFIG || {}).firebase || {};
// ─────────────────────────────────────────────────────────────

let db        = null;
let fbAuth    = null;
let syncReady = false;

/* ══════════════════════════════════════════════════════════
   INIT
══════════════════════════════════════════════════════════ */
function initSync() {
  if (!FIREBASE_CONFIG.apiKey || FIREBASE_CONFIG.apiKey === 'YOUR_FIREBASE_API_KEY') {
    console.info('[Sync] Config not set — local-only mode.');
    showSyncStatus('offline');
    return;
  }

  // FIX (session 1): Show 'syncing' while Firebase scripts load instead of
  // 'offline' — the old default caused "Local only" to stick permanently.
  showSyncStatus('syncing');

  const BASE = 'https://www.gstatic.com/firebasejs/10.12.2';
  loadScript(`${BASE}/firebase-app-compat.js`, () => {
    loadScript(`${BASE}/firebase-auth-compat.js`, () => {
      loadScript(`${BASE}/firebase-firestore-compat.js`, () => {
        try {
          if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
          fbAuth = firebase.auth();
          db     = firebase.firestore();
          console.info('[Sync] Firebase ready:', FIREBASE_CONFIG.projectId);

          fbAuth.onAuthStateChanged(async fbUser => {
            if (fbUser) {
              syncReady = true;
              console.info('[Sync] Firebase Auth uid:', fbUser.uid);

              // FIX (session 1): Race condition on page-refresh — Firebase fires
              // before auth.js has restored currentUser from SESSION_KEY.
              // Yield one microtask tick to let auth.js finish restoring session.
              if (!currentUser) {
                await new Promise(resolve => setTimeout(resolve, 0));
              }

              if (currentUser) {
                if (currentUser.uid !== fbUser.uid) {
                  console.warn('[Sync] uid mismatch — updating currentUser uid to Firebase uid');
                  currentUser.uid = fbUser.uid;
                  localStorage.setItem('fr_session', JSON.stringify(currentUser));
                }
                showSyncStatus('synced');
                syncLoadData();
              } else {
                // No stored session — user needs to log in fresh
                showSyncStatus('offline');
              }
            } else {
              syncReady = false;
              // FIX (session 1): Only show 'offline' when there's genuinely
              // no stored session. A session key means we're still mid-load.
              const hasStoredSession = !!localStorage.getItem('fr_session');
              showSyncStatus(hasStoredSession ? 'syncing' : 'offline');
            }
          });

        } catch (err) {
          console.error('[Sync] Init error:', err.code, err.message);
          showSyncStatus('offline');
          if (typeof hideHomeLoader === 'function') hideHomeLoader();
        }
      });
    });
  });
}

/* ══════════════════════════════════════════════════════════
   SIGN IN — called from auth.js, returns Promise
   Resolves with the Firebase uid so auth.js can call applyUser
   with the correct uid that matches Firestore paths.
══════════════════════════════════════════════════════════ */

/**
 * One Tap flow — GIS gives a JWT id_token (response.credential)
 * @param {string} idToken
 * @param {object} profile  { name, email, photo, initials }
 */
async function firebaseSignInWithIdToken(idToken, profile) {
  if (!fbAuth) {
    // SDK not ready — fall back to Google sub (sync won't work but app works)
    console.warn('[Sync] Firebase not ready, falling back to local-only');
    return null;
  }
  try {
    const credential = firebase.auth.GoogleAuthProvider.credential(idToken, null);
    const result     = await fbAuth.signInWithCredential(credential);
    const firebaseUid = result.user.uid;
    console.info('[Sync] Signed in via id_token, Firebase uid:', firebaseUid);
    // Call applyUser with the Firebase uid — this is what Firestore paths use
    applyUser({ uid: firebaseUid, ...profile });
    return firebaseUid;
  } catch (err) {
    console.error('[Sync] id_token sign-in failed:', err.code, err.message);
    showSyncStatus('offline');
    return null;
  }
}

/**
 * Popup flow — GIS gives an access_token
 * @param {string} accessToken
 * @param {object} profile  { name, email, photo, initials }
 */
async function firebaseSignInWithAccessToken(accessToken, profile) {
  if (!fbAuth) {
    console.warn('[Sync] Firebase not ready, falling back to local-only');
    return null;
  }
  try {
    const credential  = firebase.auth.GoogleAuthProvider.credential(null, accessToken);
    const result      = await fbAuth.signInWithCredential(credential);
    const firebaseUid = result.user.uid;
    console.info('[Sync] Signed in via access_token, Firebase uid:', firebaseUid);
    applyUser({ uid: firebaseUid, ...profile });
    return firebaseUid;
  } catch (err) {
    console.error('[Sync] access_token sign-in failed:', err.code, err.message);
    showSyncStatus('offline');
    return null;
  }
}

/* ══════════════════════════════════════════════════════════
   LOAD — current month
══════════════════════════════════════════════════════════ */
async function syncLoadData() {
  if (!currentUser || !syncReady || !db) return;

  const uid   = fbAuth?.currentUser?.uid || currentUser.uid;
  const year  = document.getElementById('yearSelect').value;
  const month = document.getElementById('monthSelect').value;
  const key   = `${year}_${month}`;

  // Show local data immediately for instant render
  loadData();
  showSyncStatus('syncing');

  console.info('[Sync] Reading: users/' + uid + '/months/' + key);

  const email = currentUser?.email || null;

  try {
    const docRef = db.collection('users').doc(uid).collection('months').doc(key);
    const snap   = await docRef.get();

    if (snap.exists) {
      const d = snap.data();
      // Support both new encrypted format { _enc: "ENC1:..." } and legacy plain docs
      const encStr   = d._enc || JSON.stringify(d);
      const cloudData = await decryptFromStorage(encStr, email);
      if (cloudData) {
        data = cloudData;
        _monthCache.set(`${uid}_${year}_${month}`, cloudData);
        localStorage.setItem(`fr_data_${uid}_${year}_${month}`, encStr);
        render();
        showSyncStatus('synced');
        console.info('[Sync] ✅ Loaded:', key);
      }
    } else {
      // No cloud record — push local data up if it exists
      const localRaw = localStorage.getItem(`fr_data_${uid}_${year}_${month}`);
      if (localRaw) {
        const encStr = localRaw.startsWith('ENC1:')
          ? localRaw
          : await encryptForStorage(JSON.parse(localRaw), email);
        await docRef.set({ _enc: encStr });
        console.info('[Sync] ✅ Pushed local → Firestore:', key);
      }
      showSyncStatus('synced');
    }

    // Fix 1 & 3: Always fetch last 3 months after loading current month.
    // This populates localStorage cache so home dashboard and FIRE number
    // have real data even on a first login / fresh device.
    await syncPrefetchPastMonths(uid, Number(year), Number(month));

    // Also sync loans and investments config so home dashboard totals are accurate
    await syncLoadConfig(uid);

  } catch (err) {
    console.error('[Sync] ❌ Load failed:', err.code, err.message);
    showSyncStatus('offline');
    if (typeof hideHomeLoader === 'function') hideHomeLoader();
  }
}

/* ══════════════════════════════════════════════════════════
   LOAD CONFIG — loans + investments (for home dashboard totals)
   Called after monthly data sync so home stats are up to date.
══════════════════════════════════════════════════════════ */
async function syncLoadConfig(uid) {
  if (!db || !syncReady) return;

  const email    = currentUser?.email || null;
  const promises = [];

  // ── Loans ──
  promises.push(
    db.collection('users').doc(uid).collection('config').doc('loans').get()
      .then(async snap => {
        if (!snap.exists) return;
        const d = snap.data();
        // Support new encrypted format { _enc: "ENC1:..." } and legacy { loans: [...] }
        let loans;
        if (d._enc) {
          const dec = await decryptFromStorage(d._enc, email);
          loans = dec?.loans;
        } else {
          loans = d.loans;
        }
        if (!Array.isArray(loans)) return;
        // Skip overwrite if a local save happened in the last 15 s
        if (typeof _loansLastSavedAt !== 'undefined' && Date.now() - _loansLastSavedAt < 15000) return;
        localStorage.setItem('fr_loans_' + uid, await encryptForStorage(loans, email));
        if (typeof loansData !== 'undefined') loansData = loans;
        console.info('[Sync] ✅ Loans loaded from Firestore:', loans.length);
      })
      .catch(e => console.warn('[Sync] Loans load failed:', e.message))
  );

  // ── Investments ──
  promises.push(
    db.collection('users').doc(uid).collection('config').doc('investments').get()
      .then(async snap => {
        if (!snap.exists) return;
        const d = snap.data();
        let holdings;
        if (d._enc) {
          const dec = await decryptFromStorage(d._enc, email);
          holdings = dec?.investments;
        } else {
          holdings = d.investments;
        }
        if (!Array.isArray(holdings)) return;
        localStorage.setItem('fr_investments_' + uid, await encryptForStorage(holdings, email));
        if (typeof investmentsData !== 'undefined') investmentsData = holdings;
        console.info('[Sync] ✅ Investments loaded from Firestore:', holdings.length);
      })
      .catch(e => console.warn('[Sync] Investments load failed:', e.message))
  );

  // ── Investment Journey ──
  promises.push(
    db.collection('users').doc(uid).collection('config').doc('invJourney').get()
      .then(async snap => {
        if (!snap.exists) return;
        const d = snap.data();
        let journey;
        if (d._enc) {
          const dec = await decryptFromStorage(d._enc, email);
          journey = dec?.journey;
        } else {
          journey = d.journey;
        }
        if (!Array.isArray(journey)) return;
        localStorage.setItem('fr_invjourney_' + uid, await encryptForStorage(journey, email));
        if (typeof invJourneyData !== 'undefined') invJourneyData = journey;
        console.info('[Sync] ✅ Investment Journey loaded from Firestore:', journey.length, 'entries');
      })
      .catch(e => console.warn('[Sync] Investment Journey load failed:', e.message))
  );

  // ── Lifestyle ──
  promises.push(
    db.collection('users').doc(uid).collection('config').doc('lifestyle').get()
      .then(async snap => {
        if (!snap.exists) return;
        const d = snap.data();
        let lsData;
        if (d._enc) {
          const dec = await decryptFromStorage(d._enc, email);
          lsData = dec;
        } else {
          lsData = d;
        }
        if (!lsData || typeof lsData !== 'object') return;
        const merged = {
          goods:  Array.isArray(lsData.goods)  ? lsData.goods  : [],
          events: Array.isArray(lsData.events) ? lsData.events : [],
        };
        localStorage.setItem('fr_lifestyle_' + uid, await encryptForStorage(merged, email));
        if (typeof lifestyleData !== 'undefined') lifestyleData = merged;
        console.info('[Sync] ✅ Lifestyle loaded from Firestore:', merged.goods.length, 'goods,', merged.events.length, 'events');
      })
      .catch(e => console.warn('[Sync] Lifestyle load failed:', e.message))
  );

  await Promise.all(promises);

  // Hide the home screen loader now that all cloud data has been fetched
  if (typeof hideHomeLoader === 'function') hideHomeLoader();

  // Refresh home dashboard now that loans + investments are in memory
  if (typeof renderHomeDashboard === 'function') {
    renderHomeDashboard();
  }
  // Trigger live price fetch now that investmentsData is populated.
  // homeFetchLivePricesOnce() was a no-op on page load because investmentsData
  // was still empty when showHomeScreen() ran — retry it here.
  if (typeof homeFetchLivePricesOnce === 'function' &&
      document.getElementById('homeScreen')?.style.display !== 'none') {
    homeFetchLivePricesOnce();
  }
}

/* ══════════════════════════════════════════════════════════
   PREFETCH — last 3 months for FIRE & home dashboard
   Fetches each of the 3 months before the selected month from
   Firestore and caches them in localStorage. Then re-renders
   the home dashboard so FIRE number is accurate.
══════════════════════════════════════════════════════════ */
async function syncPrefetchPastMonths(uid, year, month) {
  if (!db || !syncReady) return;

  const email   = currentUser?.email || null;
  const fetches = [];

  // ── Step 1: last 3 months (may span year boundary) ──────────
  for (let i = 1; i <= 3; i++) {
    let m = month - i;
    let y = year;
    while (m < 0) { m += 12; y--; }

    const localKey     = `fr_data_${uid}_${y}_${m}`;
    const firestoreKey = `${y}_${m}`;
    const cacheKey     = `${uid}_${y}_${m}`;

    if (!localStorage.getItem(localKey)) {
      // Not in localStorage at all — fetch from Firestore
      fetches.push(
        db.collection('users').doc(uid).collection('months').doc(firestoreKey)
          .get()
          .then(async snap => {
            if (snap.exists) {
              const d      = snap.data();
              const encStr = d._enc || JSON.stringify(d);
              localStorage.setItem(localKey, encStr);
              const parsed = await decryptFromStorage(encStr, email);
              if (parsed) _monthCache.set(cacheKey, parsed);
              console.info('[Sync] ✅ Prefetched past month:', firestoreKey);
            }
          })
          .catch(err => console.warn('[Sync] Could not prefetch', firestoreKey, err.message))
      );
    } else if (!_monthCache.has(cacheKey)) {
      // Already in localStorage (encrypted) but not yet decrypted into cache
      fetches.push(
        decryptFromStorage(localStorage.getItem(localKey), email).then(parsed => {
          if (parsed) _monthCache.set(cacheKey, parsed);
        })
      );
    }
  }

  // ── Step 2: warm the full YTD range (Jan → month-1) ─────────
  // home.js loops months 0..mo for YTD income/expense totals.
  // These months are already in localStorage for returning users
  // but may not be in _monthCache yet.
  for (let m = 0; m < month; m++) {
    const localKey = `fr_data_${uid}_${year}_${m}`;
    const cacheKey = `${uid}_${year}_${m}`;
    const raw      = localStorage.getItem(localKey);
    if (raw && !_monthCache.has(cacheKey)) {
      fetches.push(
        decryptFromStorage(raw, email).then(parsed => {
          if (parsed) _monthCache.set(cacheKey, parsed);
        })
      );
    }
  }

  if (fetches.length) {
    await Promise.all(fetches);
  }

  // Re-render home dashboard now that past months are in _monthCache
  if (typeof renderHomeDashboard === 'function') {
    renderHomeDashboard();
  }
  // Also refresh FIRE number in tracker if it's visible
  if (typeof renderInsightsPanel === 'function') {
    renderInsightsPanel();
  }
}

/* ══════════════════════════════════════════════════════════
   SAVE
══════════════════════════════════════════════════════════ */
async function syncSaveData(monthKey, monthData) {
  if (!syncReady || !db || !currentUser) return;

  const uid   = fbAuth?.currentUser?.uid || currentUser.uid;
  const email = currentUser.email || null;
  showSyncStatus('syncing');

  try {
    const encStr = await encryptForStorage(monthData, email);
    await db.collection('users').doc(uid).collection('months').doc(monthKey).set({ _enc: encStr });
    showSyncStatus('synced');
  } catch (err) {
    console.error('[Sync] ❌ Save failed:', err.code, err.message);
    showSyncStatus('offline');
  }
}

/* ══════════════════════════════════════════════════════════
   SIGN OUT
══════════════════════════════════════════════════════════ */
function firebaseSignOut() {
  syncReady = false;
  if (fbAuth) fbAuth.signOut().catch(() => {});
  showSyncStatus('offline');
}

/* ══════════════════════════════════════════════════════════
   MONTH CHANGE  (called from data.js onMonthChange)
══════════════════════════════════════════════════════════ */
// data.js already guards on syncReady before calling syncLoadData

/* ══════════════════════════════════════════════════════════
   STATUS + LOADER
══════════════════════════════════════════════════════════ */
function showSyncStatus(status) {
  const el = document.getElementById('syncStatus');
  if (!el) return;
  // Only update the visible label when the tracker controls are shown.
  // The element lives inside #headerTrackerControls which is hidden on the
  // home screen — updating it while hidden caused the "Local only" flash
  // that users saw on the home screen (it was visible before our wrapper fix,
  // and the stale value would appear the moment the tracker opened).
  // We still store the status internally so the correct value is displayed
  // as soon as the user navigates to the tracker.
  const labels = { syncing: '↑ Syncing…', synced: '✓ Synced', offline: '⚡ Local only' };
  const colors = { syncing: 'var(--accent3)', synced: 'var(--accent)', offline: 'var(--muted)' };
  el.textContent = labels[status] || '';
  el.style.color = colors[status] || 'var(--muted)';
}

function loadScript(src, cb) {
  const s = document.createElement('script');
  s.src = src; s.async = true;
  s.onload  = cb;
  s.onerror = () => { console.error('[Sync] Failed to load:', src); showSyncStatus('offline'); };
  document.head.appendChild(s);
}
