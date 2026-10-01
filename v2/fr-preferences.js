// ── PREFERENCES ────────────────────────────────────────────────────────────────
// Appearance / UI mode / FinBolt visibility / free-text notes shared with FINOVA. Config persists
// per-user via Firestore, same path convention as fr-healthcheck.js
// (users/{uid}/config/preferences), so it syncs between Classic and Modern.

const PREF_CFG_PREFIX = 'fr_userprefs_';
// Plaintext mirror of the "Show FinBolt" choice so it can be applied
// synchronously in showApp() (the encrypted config needs an async decrypt,
// which would otherwise let FinBolt flash on screen first).
const FINBOLT_OFF_PREFIX = 'fr_finbolt_off_';
let _prefData = _prefDefaultData();

// Staged edits — only committed to storage (and, for theme, applied to the
// page) when the user clicks Save. Cancel just discards this.
let _prefDraft = { theme: 'light', uiMode: 'modern', showFinBolt: true, aiNotes: '' };

// In-memory cache of the free-text "notes for AI" field, read synchronously
// (well — awaited once, then cached) by fr-advisor.js when building the
// system prompt.
let _prefsTextCache  = '';
let _prefsTextLoaded = false;

function _prefDefaultData() {
  return { aiNotes: '', uiMode: 'modern', showFinBolt: true };
}

/* ── Per-user config persistence (mirrors _hcLoadConfig/_hcSaveConfig in fr-healthcheck.js) ── */
async function _prefLoadConfig() {
  const localKey = `${PREF_CFG_PREFIX}${_currentUID}`;
  let data = null;
  const localRaw = localStorage.getItem(localKey);
  if (localRaw) {
    const d = await decryptFromStorage(localRaw, _currentEmail);
    if (d && typeof d === 'object') data = d;
  }
  if (_syncReady && _db) {
    try {
      const snap = await _db.collection('users').doc(_currentUID)
        .collection('config').doc('preferences').get();
      if (snap.exists) {
        const raw = snap.data()._enc || JSON.stringify(snap.data());
        const d   = await decryptFromStorage(raw, _currentEmail);
        if (d && typeof d === 'object') { data = d; localStorage.setItem(localKey, raw); }
      }
    } catch (e) { console.warn('[Preferences] load failed:', e); }
  }
  return data;
}

async function _prefSaveConfig() {
  if (!_currentUID) return;
  const encStr = await encryptForStorage(_prefData, _currentEmail);
  localStorage.setItem(`${PREF_CFG_PREFIX}${_currentUID}`, encStr);
  if (_syncReady && _db) {
    try {
      await _db.collection('users').doc(_currentUID)
        .collection('config').doc('preferences').set({ _enc: encStr });
    } catch (e) { console.warn('[Preferences] save failed:', e); }
  }
}

// ── Public getter used by fr-advisor.js to prime the system prompt.
// Loads (and decrypts) on first call, then serves from cache.
async function getUserPrefsText() {
  if (_prefsTextLoaded) return _prefsTextCache;
  const loaded = await _prefLoadConfig();
  _prefsTextCache  = (loaded && loaded.aiNotes) ? String(loaded.aiNotes).trim() : '';
  _prefsTextLoaded = true;
  return _prefsTextCache;
}

// ── Called once per browser session right after login (see fr-sync.js).
// Applies a saved "Classic" UI-mode preference by redirecting there.
// Guarded by sessionStorage so it only ever fires once per session and
// never fights a manual Classic/Modern switch made afterwards.
async function prefCheckUiModeRedirect() {
  if (sessionStorage.getItem('fr_uimode_checked')) return false;
  sessionStorage.setItem('fr_uimode_checked', '1');
  const loaded = await _prefLoadConfig();
  if (loaded && loaded.uiMode === 'classic') {
    location.href = '../';
    return true;
  }
  return false;
}

// ── FinBolt visibility ──
// Called from showApp() (local mirror only, instant) and again from
// loadAllData() once Firestore is reachable (authoritative cloud value).
function _prefFinBoltKey() {
  return FINBOLT_OFF_PREFIX + (_currentUID || (APP.user && APP.user.uid) || 'guest');
}

function _prefSetFinBoltMirror(on) {
  try {
    if (on) localStorage.removeItem(_prefFinBoltKey());
    else    localStorage.setItem(_prefFinBoltKey(), '1');
  } catch (e) {}
}

async function prefApplyFinBolt(opts) {
  if (typeof QuickAddBot === 'undefined') return;
  let off = false;
  try { off = localStorage.getItem(_prefFinBoltKey()) === '1'; } catch (e) {}
  QuickAddBot.setEnabled(!off);
  if ((opts && opts.localOnly) || !_currentUID) return;

  const loaded = await _prefLoadConfig();
  if (!loaded) return;
  const on = loaded.showFinBolt !== false;
  _prefSetFinBoltMirror(on);
  QuickAddBot.setEnabled(on);
}

// ── Theme segment (staged — applied on Save) ──
function prefSetTheme(theme) {
  _prefDraft.theme = theme;
  _prefUpdateThemeBtns();
}

function _prefUpdateThemeBtns() {
  ['light', 'dark'].forEach(t => {
    const btn = document.getElementById('pref-theme-' + t);
    if (btn) btn.classList.toggle('active', _prefDraft.theme === t);
  });
}

// ── UI mode segment (staged — effective next login) ──
function prefSetMode(mode) {
  _prefDraft.uiMode = mode;
  _prefUpdateModeBtns();
}

function _prefUpdateModeBtns() {
  ['classic', 'modern'].forEach(m => {
    const btn = document.getElementById('pref-mode-' + m);
    if (btn) btn.classList.toggle('active', _prefDraft.uiMode === m);
  });
}

// ── FinBolt segment (staged — applied on Save) ──
function prefSetFinBolt(on) {
  _prefDraft.showFinBolt = !!on;
  _prefUpdateFinBoltBtns();
}

function _prefUpdateFinBoltBtns() {
  const show = document.getElementById('pref-finbolt-show');
  const hide = document.getElementById('pref-finbolt-hide');
  if (show) show.classList.toggle('active', _prefDraft.showFinBolt);
  if (hide) hide.classList.toggle('active', !_prefDraft.showFinBolt);
}

// ── AI notes textarea (staged) ──
function prefOnNotesInput() {
  const ta = document.getElementById('prefAiNotes');
  if (!ta) return;
  _prefDraft.aiNotes = ta.value;
}

function prefCancelModal() {
  closeModal();
}

async function prefSaveModal() {
  _prefData.aiNotes = _prefDraft.aiNotes;
  _prefData.uiMode  = _prefDraft.uiMode;
  _prefData.showFinBolt = _prefDraft.showFinBolt;
  _prefsTextCache   = _prefDraft.aiNotes.trim();
  _prefsTextLoaded  = true;

  await _prefSaveConfig();

  if (APP.theme !== _prefDraft.theme) toggleTheme();

  _prefSetFinBoltMirror(_prefDraft.showFinBolt);
  if (typeof QuickAddBot !== 'undefined') {
    QuickAddBot.setEnabled(_prefDraft.showFinBolt);
    if (_prefDraft.showFinBolt) QuickAddBot.restore();
  }

  closeModal();
}

// ── Modal markup + open ──
function _prefModalHtml() {
  return `
    <div class="modal-hd">
      <div class="modal-title">${ic('settings', 14)} Preferences</div>
      <button class="modal-close" onclick="prefCancelModal()">${ic('x', 13)}</button>
    </div>
    <div class="modal-body">

      <div class="inp-grp">
        <div class="inp-label">Appearance</div>
        <div class="pref-segmented">
          <button class="pref-seg-btn" id="pref-theme-light" onclick="prefSetTheme('light')">☀️ Light</button>
          <button class="pref-seg-btn" id="pref-theme-dark" onclick="prefSetTheme('dark')">🌙 Dark</button>
        </div>
        <div style="font-size:11.5px;color:var(--t3);margin-top:8px">Applies as soon as you save.</div>
      </div>

      <div class="inp-grp">
        <div class="inp-label">Interface</div>
        <div class="pref-segmented">
          <button class="pref-seg-btn" id="pref-mode-classic" onclick="prefSetMode('classic')">Classic</button>
          <button class="pref-seg-btn" id="pref-mode-modern" onclick="prefSetMode('modern')">Modern</button>
        </div>
        <div style="font-size:11.5px;color:var(--t3);margin-top:8px">Takes effect the next time you sign in.</div>
      </div>

      <div class="inp-grp">
        <div class="inp-label">FinBolt quick add</div>
        <div class="pref-segmented">
          <button class="pref-seg-btn" id="pref-finbolt-show" onclick="prefSetFinBolt(true)">Show</button>
          <button class="pref-seg-btn" id="pref-finbolt-hide" onclick="prefSetFinBolt(false)">Hide</button>
        </div>
        <div style="font-size:11.5px;color:var(--t3);margin-top:8px">The ✕ on FinBolt only hides it until the page is reloaded — this setting hides it for your account.</div>
      </div>

      <div class="inp-grp">
        <div class="inp-label">Tell FINOVA about yourself</div>
        <textarea class="inp" id="prefAiNotes" rows="4"
          placeholder="e.g. I'm saving for a house down payment, prefer simple explanations, keep an eye on my SIPs…"
          style="resize:vertical" oninput="prefOnNotesInput()">${_prefDraft.aiNotes || ''}</textarea>
        <div style="font-size:11.5px;color:var(--t3);margin-top:8px;line-height:1.5">
          Shared with FINOVA (the AI Advisor) as background context for every conversation — use it for
          goals, constraints, or how you'd like it to talk to you. It's never shown to anyone else.
        </div>
      </div>

    </div>
    <div class="modal-ft">
      <button class="btn btn-ghost" onclick="prefCancelModal()">Cancel</button>
      <button class="btn btn-primary" onclick="prefSaveModal()">Save</button>
    </div>`;
}

async function openPreferencesV2() {
  const loaded = await _prefLoadConfig();
  _prefData = loaded ? Object.assign(_prefDefaultData(), loaded) : _prefDefaultData();

  _prefDraft = {
    theme:   APP.theme,
    uiMode:  _prefData.uiMode || 'modern',
    showFinBolt: _prefData.showFinBolt !== false,
    aiNotes: _prefData.aiNotes || ''
  };
  _prefsTextCache  = _prefData.aiNotes || '';
  _prefsTextLoaded = true;

  openModal(_prefModalHtml());
  _prefUpdateThemeBtns();
  _prefUpdateModeBtns();
  _prefUpdateFinBoltBtns();
}
