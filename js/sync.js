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

// ── Paste your Firebase config here ──────────────────────────
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyByO2cgWjIkMJWPVjq-B6ytLrnWfB-WqvA",
  authDomain: "finresolver-2026.firebaseapp.com",
  projectId: "finresolver-2026",
  storageBucket: "finresolver-2026.firebasestorage.app",
  messagingSenderId: "949500754876",
  appId: "1:949500754876:web:a69419188583958cdbc9b9"
};
// ─────────────────────────────────────────────────────────────

let db        = null;
let fbAuth    = null;
let syncReady = false;

/* ══════════════════════════════════════════════════════════
   INIT
══════════════════════════════════════════════════════════ */
function initSync() {
  if (FIREBASE_CONFIG.apiKey === 'YOUR_FIREBASE_API_KEY') {
    console.info('[Sync] Config not set — local-only mode.');
    showSyncStatus('offline');
    return;
  }

  const BASE = 'https://www.gstatic.com/firebasejs/10.12.2';
  loadScript(`${BASE}/firebase-app-compat.js`, () => {
    loadScript(`${BASE}/firebase-auth-compat.js`, () => {
      loadScript(`${BASE}/firebase-firestore-compat.js`, () => {
        try {
          if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
          fbAuth = firebase.auth();
          db     = firebase.firestore();
          console.info('[Sync] Firebase ready:', FIREBASE_CONFIG.projectId);

          // onAuthStateChanged is the ONLY place that sets syncReady and
          // triggers syncLoadData. This fires:
          //   • after signInWithCredential() resolves  (new login)
          //   • automatically on page refresh if Firebase session persists
          fbAuth.onAuthStateChanged(async fbUser => {
            if (fbUser) {
              syncReady = true;
              console.info('[Sync] Firebase Auth uid:', fbUser.uid);

              // On page refresh: currentUser is restored from localStorage by
              // auth.js using the stored session. But that session was saved
              // with the Firebase uid, so they will match.
              if (currentUser) {
                // Ensure the stored uid matches Firebase's uid (safety check)
                if (currentUser.uid !== fbUser.uid) {
                  console.warn('[Sync] uid mismatch — updating currentUser uid to Firebase uid');
                  currentUser.uid = fbUser.uid;
                  localStorage.setItem('fr_session', JSON.stringify(currentUser));
                }
                showSyncStatus('synced');
                syncLoadData();
              }
            } else {
              syncReady = false;
              showSyncStatus('offline');
            }
          });

        } catch (err) {
          console.error('[Sync] Init error:', err.code, err.message);
          showSyncStatus('offline');
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
   LOAD
══════════════════════════════════════════════════════════ */
async function syncLoadData() {
  if (!currentUser || !syncReady || !db) return;

  // Always use Firebase Auth uid for Firestore paths
  const uid   = fbAuth?.currentUser?.uid || currentUser.uid;
  const year  = document.getElementById('yearSelect').value;
  const month = document.getElementById('monthSelect').value;
  const key   = `${year}_${month}`;

  // Show local data immediately
  loadData();
  showSyncStatus('syncing');

  console.info('[Sync] Reading: users/' + uid + '/months/' + key);

  try {
    const docRef = db.collection('users').doc(uid).collection('months').doc(key);
    const snap   = await docRef.get();

    if (snap.exists) {
      const cloudData = snap.data();
      data = cloudData;
      localStorage.setItem(`fr_data_${uid}_${year}_${month}`, JSON.stringify(cloudData));
      render();
      showSyncStatus('synced');
      console.info('[Sync] ✅ Loaded:', key);
    } else {
      // No cloud record — push local data up if it exists
      const localRaw = localStorage.getItem(`fr_data_${uid}_${year}_${month}`);
      if (localRaw) {
        await docRef.set(JSON.parse(localRaw));
        console.info('[Sync] ✅ Pushed local → Firestore:', key);
      }
      showSyncStatus('synced');
    }
  } catch (err) {
    console.error('[Sync] ❌ Load failed:', err.code, err.message);
    showSyncStatus('offline');
  }
}

/* ══════════════════════════════════════════════════════════
   SAVE
══════════════════════════════════════════════════════════ */
async function syncSaveData(monthKey, monthData) {
  if (!syncReady || !db || !currentUser) return;

  const uid = fbAuth?.currentUser?.uid || currentUser.uid;
  showSyncStatus('syncing');

  try {
    await db.collection('users').doc(uid).collection('months').doc(monthKey).set(monthData);
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
