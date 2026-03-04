/* ============================================================
   auth.js — Google Identity Services OAuth
   FinResolver · finresolver.in

   SETUP (one-time):
   1. https://console.cloud.google.com/ → Select your project
   2. APIs & Services → Credentials → Edit your OAuth 2.0 Client ID
      Authorised JavaScript origins — add ALL of these:
        https://finresolver.in
        http://localhost
        http://localhost:3000   (adjust port as needed)
      Authorised redirect URIs — leave empty (not needed for popup flow)
   3. Paste your Client ID below

   Sign-in flow (3-layer fallback):
   Layer 1 — GIS One Tap          (works when Google session is active)
   Layer 2 — GIS TokenClient      (popup that works without any session)
   Layer 3 — GIS renderButton()   (rendered button if popups are blocked)
   ============================================================ */

const GOOGLE_CLIENT_ID = '1071814436875-r17652ke04i7el0nbcoec1nffpgfhd1m.apps.googleusercontent.com';
const SESSION_KEY = 'fr_session';

let currentUser  = null;
let tokenClient  = null;   // GIS OAuth2 token client (layer 2)

/* ── Boot ─────────────────────────────────────────────────── */
function initAuth() {
  const s = document.createElement('script');
  s.src     = 'https://accounts.google.com/gsi/client';
  s.async   = true;
  s.defer   = true;
  s.onload  = onGISReady;
  s.onerror = () => showLoginError('Failed to load Google sign-in. Check your connection.');
  document.head.appendChild(s);

  // Restore persisted session immediately so the UI doesn't flicker
  const stored = localStorage.getItem(SESSION_KEY);
  if (stored) {
    try { applyUser(JSON.parse(stored), true); }
    catch { localStorage.removeItem(SESSION_KEY); }
  }
}

/* ── GIS loaded ───────────────────────────────────────────── */
function onGISReady() {
  if (typeof google === 'undefined') {
    showLoginError('Google Identity Services unavailable.');
    return;
  }

  // Layer 1: One Tap — fires handleCredentialResponse() on success
  google.accounts.id.initialize({
    client_id:            GOOGLE_CLIENT_ID,
    callback:             handleCredentialResponse,
    auto_select:          false,
    cancel_on_tap_outside: true,
  });

  // Layer 2: Token client popup — fires resolveAccessToken() on success.
  // Uses google.accounts.oauth2 which is the current, non-deprecated popup API.
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope:     'openid email profile',
    prompt:    'select_account',
    callback:  async (tokenResponse) => {
      if (tokenResponse.error) {
        showLoginError('Sign-in cancelled or failed. Please try again.');
        setButtonReady();
        return;
      }
      await resolveAccessToken(tokenResponse.access_token);
    },
  });

  setButtonReady();
}

/* ── Button ready state ───────────────────────────────────── */
function setButtonReady() {
  const btn = document.getElementById('btnGoogleLogin');
  if (!btn) return;
  btn.disabled = false;
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
    Continue with Google`;
}

/* ── Login button click ───────────────────────────────────── */
function loginWithGoogle() {
  if (typeof google === 'undefined') {
    showLoginError('Google sign-in is still loading. Please wait a moment.');
    return;
  }
  const btn = document.getElementById('btnGoogleLogin');
  if (btn) { btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> Signing in…`; }
  hideLoginError();

  // Layer 1 — try One Tap first (instant if a Google session exists)
  google.accounts.id.prompt(notification => {
    if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
      // No active Google session in browser → use token client popup (layer 2)
      if (tokenClient) {
        tokenClient.requestAccessToken();
      } else {
        showLoginError('Sign-in unavailable. Please refresh and try again.');
      }
    } else if (notification.isDismissedMoment()) {
      setButtonReady();
    }
    // If neither branch fires, handleCredentialResponse() will be called by GIS
  });
}

/* ── Fetch user info with access token (layer 2 callback) ─── */
async function resolveAccessToken(accessToken) {
  try {
    const res  = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: 'Bearer ' + accessToken },
    });
    const info = await res.json();
    if (!info.sub) throw new Error('Invalid userinfo response');
    // Sign into Firebase Auth FIRST — then read Firebase's uid for storage key
    if (typeof firebaseSignInWithAccessToken === 'function') {
      await firebaseSignInWithAccessToken(accessToken, {
        name:     info.name,
        email:    info.email,
        photo:    info.picture || null,
        initials: getInitials(info.name),
      });
    } else {
      // Firebase sync not available — fall back to Google sub as uid
      applyUser({
        uid:      info.sub,
        name:     info.name,
        email:    info.email,
        photo:    info.picture || null,
        initials: getInitials(info.name),
      });
    }
  } catch (err) {
    showLoginError('Could not retrieve account info. Please try again.');
    console.error('[FinResolver] resolveAccessToken error:', err);
  }
}

/* ── Layer 3: render official button (popups blocked) ──────── */
function renderGoogleButton() {
  const container = document.getElementById('googleBtnContainer');
  if (!container) return;
  container.style.display = 'flex';
  document.getElementById('btnGoogleLogin').style.display = 'none';
  google.accounts.id.renderButton(container, {
    theme: 'filled_black', size: 'large',
    width: 340, text: 'continue_with', shape: 'rectangular',
  });
}

/* ── One Tap credential callback (layer 1) ────────────────── */
async function handleCredentialResponse(response) {
  try {
    // GIS returns a signed JWT — decode the payload (no verification needed client-side)
    const payload = JSON.parse(atob(response.credential.split('.')[1]));
    // Sign into Firebase Auth FIRST — then read Firebase's uid for storage key
    if (typeof firebaseSignInWithIdToken === 'function') {
      await firebaseSignInWithIdToken(response.credential, {
        name:     payload.name,
        email:    payload.email,
        photo:    payload.picture || null,
        initials: getInitials(payload.name),
      });
    } else {
      applyUser({
        uid:      payload.sub,
        name:     payload.name,
        email:    payload.email,
        photo:    payload.picture || null,
        initials: getInitials(payload.name),
      });
    }
  } catch (err) {
    showLoginError('Sign-in failed. Please try again.');
    setButtonReady();
    console.error('[FinResolver] handleCredentialResponse error:', err);
  }
}

/* ── Apply signed-in user & load data ─────────────────────── */
function applyUser(user, skipSave = false) {
  currentUser = user;
  if (!skipSave) localStorage.setItem(SESSION_KEY, JSON.stringify(user));

  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appMain').style.display     = 'block';

  const av = document.getElementById('userAvatar');
  if (user.photo) {
    av.innerHTML = `<img src="${user.photo}" alt="${user.name}" referrerpolicy="no-referrer" />`;
  } else {
    av.textContent = user.initials;
  }
  document.getElementById('userName').textContent     = user.name.split(' ')[0];
  document.getElementById('menuUserInfo').textContent = user.email;

  // Show/hide guest-specific UI
  const isGuest = !!user.isGuest;
  const guestBanner   = document.getElementById('guestBanner');
  const menuSignIn    = document.getElementById('menuSignInRow');
  const menuSignOut   = document.getElementById('menuSignOutRow');
  if (guestBanner) guestBanner.style.display  = isGuest ? 'block' : 'none';
  if (menuSignIn)  menuSignIn.style.display   = isGuest ? 'block' : 'none';
  if (menuSignOut) menuSignOut.style.display  = isGuest ? 'none'  : 'block';

  // Load local data immediately for instant render
  if (typeof loadData === 'function') loadData();
  // Cloud sync is triggered by onAuthStateChanged in sync.js (skipped for guest)
}

/* ── Sign out ─────────────────────────────────────────────── */
function logOut() {
  if (typeof google !== 'undefined') {
    google.accounts.id.disableAutoSelect();
    if (currentUser?.email) google.accounts.id.revoke(currentUser.email, () => {});
  }
  if (typeof firebaseSignOut === 'function') firebaseSignOut();

  localStorage.removeItem(SESSION_KEY);
  currentUser = null;

  // Reset guest UI
  const guestBanner = document.getElementById('guestBanner');
  const menuSignIn  = document.getElementById('menuSignInRow');
  const menuSignOut = document.getElementById('menuSignOutRow');
  if (guestBanner) guestBanner.style.display = 'none';
  if (menuSignIn)  menuSignIn.style.display  = 'none';
  if (menuSignOut) menuSignOut.style.display = 'block';

  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('appMain').style.display     = 'none';
  document.getElementById('userMenu').classList.remove('open');
  setButtonReady();
}

/* ── Guest login ──────────────────────────────────────────── */
function loginAsGuest() {
  applyUser({
    uid:      'guest',
    name:     'Guest',
    email:    'Local storage only',
    initials: '👤',
    photo:    null,
    isGuest:  true,
  });
}

/* ── User menu ────────────────────────────────────────────── */
function toggleUserMenu() {
  document.getElementById('userMenu').classList.toggle('open');
}
document.addEventListener('click', e => {
  const pill = document.getElementById('userPill');
  if (pill && !pill.contains(e.target))
    document.getElementById('userMenu').classList.remove('open');
});

/* ── Helpers ──────────────────────────────────────────────── */
function getInitials(name = '') {
  return name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}
function showLoginError(msg) {
  const el = document.getElementById('loginError');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
  setButtonReady();
}
function hideLoginError() {
  const el = document.getElementById('loginError');
  if (el) el.style.display = 'none';
}
