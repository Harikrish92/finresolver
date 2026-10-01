/* ============================================================
   preferences.js — App Preferences (theme / UI mode / FinBolt / AI notes)
   FinResolver · finresolver.in
   ============================================================ */

(function () {
  'use strict';

  var PREF_CFG_PREFIX = 'fr_userprefs_';
  /* Plaintext mirror of the "Show FinBolt" choice so it can be applied
     synchronously at login (the encrypted config needs an async decrypt,
     which would otherwise let FinBolt flash on screen first). */
  var FINBOLT_OFF_PREFIX = 'fr_finbolt_off_';
  var _prefData = _prefDefaultData();

  /* Staged edits — only committed to storage (and, for theme, applied
     to the page) when the user clicks Save. Cancel just discards this. */
  var _prefDraft = { theme: 'light', uiMode: 'classic', showFinBolt: true, aiNotes: '' };

  /* In-memory cache of the free-text "notes for AI" field, read
     synchronously by advisor.js when building the system prompt —
     loaded once per session (or refreshed on save) since decryption
     is async and the advisor's callers should not all re-await it. */
  var _prefsTextCache  = '';
  var _prefsTextLoaded = false;

  function _prefDefaultData() {
    return { aiNotes: '', uiMode: 'classic', showFinBolt: true };
  }

  /* ── Per-user config persistence (mirrors js/healthcheck.js) ── */
  function _prefUid() {
    return (typeof fbAuth !== 'undefined' && fbAuth && fbAuth.currentUser)
      ? fbAuth.currentUser.uid
      : (typeof currentUser !== 'undefined' && currentUser && currentUser.uid ? currentUser.uid : 'guest');
  }

  function _prefCfgKey() { return PREF_CFG_PREFIX + _prefUid(); }

  async function _prefLoadConfig() {
    var email = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.email : null;
    var data = null;

    var raw = localStorage.getItem(_prefCfgKey());
    if (raw) {
      try {
        var dec = await (typeof decryptFromStorage === 'function'
          ? decryptFromStorage(raw, email)
          : Promise.resolve(JSON.parse(raw)));
        if (dec && typeof dec === 'object') data = dec;
      } catch (e) { /* fall through — treat as first run */ }
    }

    if (typeof db !== 'undefined' && db && typeof fbAuth !== 'undefined' && fbAuth && fbAuth.currentUser) {
      try {
        var uid  = fbAuth.currentUser.uid;
        var snap = await db.collection('users').doc(uid).collection('config').doc('preferences').get();
        if (snap.exists) {
          var cloudRaw = snap.data()._enc || JSON.stringify(snap.data());
          var cloudDec = await (typeof decryptFromStorage === 'function'
            ? decryptFromStorage(cloudRaw, email)
            : Promise.resolve(JSON.parse(cloudRaw)));
          if (cloudDec && typeof cloudDec === 'object') {
            data = cloudDec;
            localStorage.setItem(_prefCfgKey(), cloudRaw);
          }
        }
      } catch (e) { console.warn('[Preferences] Firestore load failed:', e.message); }
    }

    return data;
  }

  async function _prefSaveConfig() {
    var email = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.email : null;
    var enc = (typeof encryptForStorage === 'function')
      ? await encryptForStorage(_prefData, email)
      : JSON.stringify(_prefData);
    localStorage.setItem(_prefCfgKey(), enc);
    _prefSyncConfigToFirestore(enc);
  }

  function _prefSyncConfigToFirestore(encStr) {
    if (typeof db === 'undefined' || !db || typeof fbAuth === 'undefined' || !fbAuth || !fbAuth.currentUser) return;
    var uid = fbAuth.currentUser.uid;
    db.collection('users').doc(uid).collection('config').doc('preferences').set({ _enc: encStr })
      .catch(function (e) { console.warn('[Preferences] Firestore save failed:', e.message); });
  }

  /* ── Public getter used by advisor.js to prime the system prompt.
     Loads (and decrypts) on first call, then serves from cache. ── */
  async function getUserPrefsText() {
    if (_prefsTextLoaded) return _prefsTextCache;
    var loaded = await _prefLoadConfig();
    _prefsTextCache  = (loaded && loaded.aiNotes) ? String(loaded.aiNotes).trim() : '';
    _prefsTextLoaded = true;
    return _prefsTextCache;
  }

  /* ── Called once per browser session right after login (see js/sync.js).
     Applies a saved "Modern" UI-mode preference by redirecting there.
     Guarded by sessionStorage so it only ever fires once per session and
     never fights a manual Classic/Modern switch made afterwards. ── */
  async function prefCheckUiModeRedirect() {
    if (sessionStorage.getItem('fr_uimode_checked')) return false;
    sessionStorage.setItem('fr_uimode_checked', '1');
    var loaded = await _prefLoadConfig();
    if (loaded && loaded.uiMode === 'modern') {
      location.href = 'v2/index.html';
      return true;
    }
    return false;
  }

  /* ── FinBolt visibility ──
     Called from applyUser() (local mirror only, instant) and again from
     syncLoadData() once Firestore is reachable (authoritative cloud value). ── */
  function _prefFinBoltKey() { return FINBOLT_OFF_PREFIX + _prefUid(); }

  function _prefSetFinBoltMirror(on) {
    try {
      if (on) localStorage.removeItem(_prefFinBoltKey());
      else    localStorage.setItem(_prefFinBoltKey(), '1');
    } catch (e) {}
  }

  async function prefApplyFinBolt(opts) {
    if (typeof QuickAddBot === 'undefined') return;
    var off = false;
    try { off = localStorage.getItem(_prefFinBoltKey()) === '1'; } catch (e) {}
    QuickAddBot.setEnabled(!off);
    if (opts && opts.localOnly) return;

    var loaded = await _prefLoadConfig();
    if (!loaded) return;
    var on = loaded.showFinBolt !== false;
    _prefSetFinBoltMirror(on);
    QuickAddBot.setEnabled(on);
  }

  /* ── Theme segment (staged — applied on Save) ── */
  function prefSetTheme(theme) {
    _prefDraft.theme = theme;
    _prefUpdateThemeBtns();
  }

  function _prefUpdateThemeBtns() {
    ['light', 'dark'].forEach(function (t) {
      var btn = document.getElementById('pref-theme-' + t);
      if (btn) btn.classList.toggle('active', _prefDraft.theme === t);
    });
  }

  /* ── UI mode segment (staged — effective next login) ── */
  function prefSetMode(mode) {
    _prefDraft.uiMode = mode;
    _prefUpdateModeBtns();
  }

  function _prefUpdateModeBtns() {
    ['classic', 'modern'].forEach(function (m) {
      var btn = document.getElementById('pref-mode-' + m);
      if (btn) btn.classList.toggle('active', _prefDraft.uiMode === m);
    });
  }

  /* ── FinBolt segment (staged — applied on Save) ── */
  function prefSetFinBolt(on) {
    _prefDraft.showFinBolt = !!on;
    _prefUpdateFinBoltBtns();
  }

  function _prefUpdateFinBoltBtns() {
    var show = document.getElementById('pref-finbolt-show');
    var hide = document.getElementById('pref-finbolt-hide');
    if (show) show.classList.toggle('active', _prefDraft.showFinBolt);
    if (hide) hide.classList.toggle('active', !_prefDraft.showFinBolt);
  }

  /* ── AI notes textarea (staged) ── */
  function prefOnNotesInput() {
    var ta = document.getElementById('prefAiNotes');
    if (!ta) return;
    _prefDraft.aiNotes = ta.value;
  }

  /* ── Modal open/save/cancel ── */
  async function openPreferences() {
    var loaded = await _prefLoadConfig();
    _prefData = loaded ? Object.assign(_prefDefaultData(), loaded) : _prefDefaultData();

    _prefDraft = {
      theme:   (typeof getCurrentTheme === 'function') ? getCurrentTheme() : 'light',
      uiMode:  _prefData.uiMode || 'classic',
      showFinBolt: _prefData.showFinBolt !== false,
      aiNotes: _prefData.aiNotes || ''
    };

    var ta = document.getElementById('prefAiNotes');
    if (ta) ta.value = _prefDraft.aiNotes;

    _prefUpdateThemeBtns();
    _prefUpdateModeBtns();
    _prefUpdateFinBoltBtns();

    var modal = document.getElementById('preferencesModal');
    if (modal) modal.classList.remove('hidden');
  }

  function cancelPreferences() {
    var modal = document.getElementById('preferencesModal');
    if (modal) modal.classList.add('hidden');
  }

  async function savePreferences() {
    _prefData.aiNotes = _prefDraft.aiNotes;
    _prefData.uiMode  = _prefDraft.uiMode;
    _prefData.showFinBolt = _prefDraft.showFinBolt;
    _prefsTextCache   = _prefDraft.aiNotes.trim();
    _prefsTextLoaded  = true;

    await _prefSaveConfig();

    if (typeof applyTheme === 'function') applyTheme(_prefDraft.theme);

    _prefSetFinBoltMirror(_prefDraft.showFinBolt);
    if (typeof QuickAddBot !== 'undefined') {
      QuickAddBot.setEnabled(_prefDraft.showFinBolt);
      if (_prefDraft.showFinBolt) QuickAddBot.restore();
    }

    var modal = document.getElementById('preferencesModal');
    if (modal) modal.classList.add('hidden');
  }

  window.openPreferences        = openPreferences;
  window.cancelPreferences      = cancelPreferences;
  window.savePreferences        = savePreferences;
  window.prefSetTheme           = prefSetTheme;
  window.prefSetMode            = prefSetMode;
  window.prefSetFinBolt         = prefSetFinBolt;
  window.prefApplyFinBolt       = prefApplyFinBolt;
  window.prefOnNotesInput       = prefOnNotesInput;
  window.getUserPrefsText       = getUserPrefsText;
  window.prefCheckUiModeRedirect = prefCheckUiModeRedirect;
})();
