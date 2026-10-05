/* ============================================================
   preferences.js — App Preferences (theme / UI mode / FinBolt / AI notes /
                    own Anthropic API key for FINOVA)
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
  var _prefDraft = { theme: 'light', uiMode: 'classic', showFinBolt: true, aiNotes: '', keyAction: null, newKey: '' };

  /* In-memory cache of the free-text "notes for AI" field, read
     synchronously by advisor.js when building the system prompt —
     loaded once per session (or refreshed on save) since decryption
     is async and the advisor's callers should not all re-await it. */
  var _prefsTextCache  = '';
  var _prefsTextUid    = null;   // uid the cache belongs to — reloaded on account switch

  /* The user's own Anthropic API key (optional). Treated like a password:
     stored only inside the encrypted preferences doc, never rendered back
     into the page once saved. Cached per uid so a different account
     signing in on the same page never picks up the previous user's key. */
  var _prefKeyCache = { uid: null, key: '' };

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
    var uid = _prefUid();
    if (_prefsTextUid === uid) return _prefsTextCache;
    var loaded = await _prefLoadConfig();
    _prefsTextCache  = (loaded && loaded.aiNotes) ? String(loaded.aiNotes).trim() : '';
    _prefsTextUid    = uid;
    return _prefsTextCache;
  }

  /* ── Public getter used by advisor.js — the user's own Anthropic key,
     or '' when they haven't set one (FINOVA then uses the app's key). ── */
  async function getUserAnthropicKey() {
    var uid = _prefUid();
    if (uid === 'guest') return '';
    if (_prefKeyCache.uid === uid) return _prefKeyCache.key;
    var loaded = await _prefLoadConfig();
    _prefKeyCache = { uid: uid, key: (loaded && loaded.anthropicKey) ? String(loaded.anthropicKey) : '' };
    return _prefKeyCache.key;
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

  /* ── Own API key (staged) ──
     keyAction: null = leave as is, 'replace' = showing the input,
     'remove' = delete the saved key on Save. The typed key lives only in
     _prefDraft.newKey until Save, and the input is cleared on every open. */
  function prefKeyReplace() {
    _prefDraft.keyAction = 'replace';
    _prefRenderKeyState();
    var inp = document.getElementById('prefApiKey');
    if (inp) inp.focus();
  }

  function prefKeyRemove() {
    _prefDraft.keyAction = 'remove';
    _prefDraft.newKey = '';
    _prefRenderKeyState();
  }

  function prefKeyUndo() {
    _prefDraft.keyAction = null;
    _prefDraft.newKey = '';
    _prefRenderKeyState();
  }

  function prefOnKeyInput() {
    var inp = document.getElementById('prefApiKey');
    if (!inp) return;
    _prefDraft.newKey = inp.value.trim();
    _prefSetKeyError('');
  }

  function _prefSetKeyError(msg) {
    var el = document.getElementById('prefApiKeyError');
    if (!el) return;
    el.textContent = msg;
    el.style.display = msg ? '' : 'none';
  }

  /* Guests keep everything in this browser only, and their preferences are
     encrypted with a fixed, non-secret value — not a safe home for a key. */
  function _prefRenderKeyState() {
    var guest   = _prefUid() === 'guest';
    var section = document.getElementById('prefApiKeySection');
    var gNote   = document.getElementById('prefApiKeyGuest');
    if (section) section.style.display = guest ? 'none' : '';
    if (gNote)   gNote.style.display   = guest ? '' : 'none';
    var hasKey  = !!_prefData.anthropicKey;
    var action  = _prefDraft.keyAction;
    var saved   = document.getElementById('prefApiKeySaved');
    var entry   = document.getElementById('prefApiKeyEntry');
    var removed = document.getElementById('prefApiKeyRemoved');
    var inp     = document.getElementById('prefApiKey');
    var cancel  = document.getElementById('prefApiKeyCancel');
    var showEntry = !hasKey || action === 'replace';
    if (saved)   saved.style.display   = (hasKey && !action) ? '' : 'none';
    if (removed) removed.style.display = (hasKey && action === 'remove') ? '' : 'none';
    if (entry)   entry.style.display   = (showEntry && action !== 'remove') ? '' : 'none';
    if (cancel)  cancel.style.display  = (hasKey && action === 'replace') ? '' : 'none';
    if (inp && !showEntry) inp.value = '';
  }

  /* Format check + a free GET /v1/models call so a mistyped key is caught
     here rather than on the first FINOVA question. Returns an error string,
     or '' when the key is usable (network failures don't block saving). */
  async function _prefValidateKey(key) {
    if (!/^sk-ant-[A-Za-z0-9_\-]{20,}$/.test(key)) {
      return 'That doesn’t look like an Anthropic API key — it should start with "sk-ant-".';
    }
    try {
      var resp = await fetch('https://api.anthropic.com/v1/models?limit=1', {
        headers: {
          'x-api-key':         key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        }
      });
      if (resp.status === 401 || resp.status === 403) return 'Anthropic rejected this key. Please check it and try again.';
    } catch (e) { /* offline / blocked — accept and let FINOVA report later */ }
    return '';
  }

  /* ── Modal open/save/cancel ── */
  async function openPreferences() {
    var loaded = await _prefLoadConfig();
    _prefData = loaded ? Object.assign(_prefDefaultData(), loaded) : _prefDefaultData();

    _prefDraft = {
      theme:   (typeof getCurrentTheme === 'function') ? getCurrentTheme() : 'light',
      uiMode:  _prefData.uiMode || 'classic',
      showFinBolt: _prefData.showFinBolt !== false,
      aiNotes: _prefData.aiNotes || '',
      keyAction: null,
      newKey:  ''
    };

    var ta = document.getElementById('prefAiNotes');
    if (ta) ta.value = _prefDraft.aiNotes;
    var keyInp = document.getElementById('prefApiKey');
    if (keyInp) keyInp.value = '';
    _prefSetKeyError('');
    _prefRenderKeyState();

    _prefUpdateThemeBtns();
    _prefUpdateModeBtns();
    _prefUpdateFinBoltBtns();

    var modal = document.getElementById('preferencesModal');
    if (modal) modal.classList.remove('hidden');
  }

  function cancelPreferences() {
    _prefDraft.newKey = '';
    var keyInp = document.getElementById('prefApiKey');
    if (keyInp) keyInp.value = '';
    var modal = document.getElementById('preferencesModal');
    if (modal) modal.classList.add('hidden');
  }

  async function savePreferences() {
    if (_prefDraft.newKey && _prefUid() !== 'guest') {
      var saveBtn = document.getElementById('prefSaveBtn');
      if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Checking key…'; }
      var keyErr = await _prefValidateKey(_prefDraft.newKey);
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
      if (keyErr) { _prefSetKeyError(keyErr); return; }
      _prefData.anthropicKey = _prefDraft.newKey;
    } else if (_prefDraft.keyAction === 'remove') {
      delete _prefData.anthropicKey;
    }
    _prefKeyCache = { uid: _prefUid(), key: _prefData.anthropicKey || '' };
    _prefDraft.newKey = '';
    _prefDraft.keyAction = null;
    var keyInp = document.getElementById('prefApiKey');
    if (keyInp) keyInp.value = '';

    _prefData.aiNotes = _prefDraft.aiNotes;
    _prefData.uiMode  = _prefDraft.uiMode;
    _prefData.showFinBolt = _prefDraft.showFinBolt;
    _prefsTextCache   = _prefDraft.aiNotes.trim();
    _prefsTextUid     = _prefUid();

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
  window.getUserAnthropicKey    = getUserAnthropicKey;
  window.prefKeyReplace         = prefKeyReplace;
  window.prefKeyRemove          = prefKeyRemove;
  window.prefKeyUndo            = prefKeyUndo;
  window.prefOnKeyInput         = prefOnKeyInput;
  window.prefCheckUiModeRedirect = prefCheckUiModeRedirect;
})();
