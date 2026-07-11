/* ============================================================
   dayplanner.js — configurable-interval Day Planner
   FinResolver · finresolver.in
   ============================================================ */

(function () {
  'use strict';

  var DP_LEGACY_KEY   = 'finresolver_dayplanner';            // pre-2026-07 flat "today only" key — migrated on first load
  var DP_KEY_PREFIX    = 'finresolver_dayplanner_';           // + <uid>_YYYY-MM-DD, one entry per user per day
  var DP_RECURRING_KEY = 'finresolver_dayplanner_recurring';  // + _<uid> — { [slotId]: {note} } — tasks that auto-appear on every day
  var _dpTimer = null;
  var _dpListenersAttached = false;
  var _dpConfig = null;   // { slotMinutes, fromMin, toMin } — loaded per-user, first-run if null
  var _dpViewDate = null; // Date currently shown — resets to "today" every time the screen is opened

  /* ── Per-user config persistence (mirrors js/lifestyle.js) ── */
  function _dpUid() {
    return (typeof fbAuth !== 'undefined' && fbAuth && fbAuth.currentUser)
      ? fbAuth.currentUser.uid
      : (typeof currentUser !== 'undefined' && currentUser && currentUser.uid ? currentUser.uid : 'guest');
  }

  function _dpCfgKey() { return 'fr_dayplanner_cfg_' + _dpUid(); }

  async function _dpLoadConfig() {
    var raw = localStorage.getItem(_dpCfgKey());
    if (!raw) return null;
    var email = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.email : null;
    try {
      var dec = await (typeof decryptFromStorage === 'function'
        ? decryptFromStorage(raw, email)
        : Promise.resolve(JSON.parse(raw)));
      if (dec && dec.slotMinutes && dec.toMin > dec.fromMin) return dec;
    } catch (e) { /* fall through to null — treat as first run */ }
    return null;
  }

  async function _dpSaveConfig(cfg) {
    var email = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.email : null;
    var enc = (typeof encryptForStorage === 'function')
      ? await encryptForStorage(cfg, email)
      : JSON.stringify(cfg);
    localStorage.setItem(_dpCfgKey(), enc);
    _dpSyncConfigToFirestore(enc);
  }

  function _dpSyncConfigToFirestore(encStr) {
    if (typeof db === 'undefined' || !db || typeof fbAuth === 'undefined' || !fbAuth || !fbAuth.currentUser) return;
    var uid = fbAuth.currentUser.uid;
    db.collection('users').doc(uid).collection('config').doc('dayplanner').set({ _enc: encStr })
      .catch(function (e) { console.warn('[DayPlanner] Firestore save failed:', e.message); });
  }

  /* ── Slot definitions: driven by the loaded config ── */
  function _dpSlots(cfg) {
    var slots = [];
    for (var m = cfg.fromMin; m < cfg.toMin; m += cfg.slotMinutes) {
      var h   = Math.floor(m / 60);
      var min = m % 60;
      var ap  = h < 12 ? 'AM' : 'PM';
      var h12 = h % 12 || 12;
      slots.push({
        id:      'dp_' + m,
        label:   h12 + ':' + (min < 10 ? '0' + min : min) + ' ' + ap,
        minutes: m,
      });
    }
    return slots;
  }

  /* ── Date helpers ── */
  function _dpDateKey(date) {
    var y = date.getFullYear(), m = date.getMonth() + 1, d = date.getDate();
    return DP_KEY_PREFIX + _dpUid() + '_' + y + '-' + (m < 10 ? '0' + m : m) + '-' + (d < 10 ? '0' + d : d);
  }

  function _dpRecurringKey() { return DP_RECURRING_KEY + '_' + _dpUid(); }

  function _dpInputDate(date) {
    var y = date.getFullYear(), m = date.getMonth() + 1, d = date.getDate();
    return y + '-' + (m < 10 ? '0' + m : m) + '-' + (d < 10 ? '0' + d : d);
  }

  function _dpDateOnly(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }

  function _dpIsToday(date) {
    return _dpDateOnly(date) === _dpDateOnly(new Date());
  }

  /* ── Completion/notes persistence — one flat object per calendar day ── */
  function _dpLoad(date) {
    try { return JSON.parse(localStorage.getItem(_dpDateKey(date))) || {}; }
    catch (e) { return {}; }
  }

  function _dpSave(date, state) {
    try { localStorage.setItem(_dpDateKey(date), JSON.stringify(state)); }
    catch (e) { /* quota exceeded — silent fail */ }
  }

  /* ── One-time migration: pre-2026-07 installs kept a single flat key for "today" ── */
  function _dpMigrateLegacy() {
    var raw = localStorage.getItem(DP_LEGACY_KEY);
    if (!raw) return;
    var todayKey = _dpDateKey(new Date());
    if (!localStorage.getItem(todayKey)) localStorage.setItem(todayKey, raw);
    localStorage.removeItem(DP_LEGACY_KEY);
  }

  /* ── Recurring-task templates: tasks marked "repeat daily" pre-fill every day ── */
  function _dpLoadRecurring() {
    try { return JSON.parse(localStorage.getItem(_dpRecurringKey())) || {}; }
    catch (e) { return {}; }
  }

  function _dpSaveRecurring(rec) {
    try { localStorage.setItem(_dpRecurringKey(), JSON.stringify(rec)); }
    catch (e) { /* quota exceeded — silent fail */ }
  }

  function _dpToggleRepeat(id, noteValue) {
    var rec = _dpLoadRecurring();
    if (rec[id]) delete rec[id];
    else rec[id] = { note: noteValue || '' };
    _dpSaveRecurring(rec);
  }

  /* Merge a day's explicit entries on top of the recurring templates: explicit
     note/done always win; `repeating` reflects whether a template exists for
     that slot, independent of what the day's own note currently says. */
  function _dpEffectiveState(date) {
    var explicit  = _dpLoad(date);
    var recurring = _dpLoadRecurring();
    var merged = {};
    Object.keys(recurring).forEach(function (id) {
      merged[id] = { note: recurring[id].note, done: false, repeating: true };
    });
    Object.keys(explicit).forEach(function (id) {
      var base = merged[id] || {};
      merged[id] = {
        note: explicit[id].note !== undefined ? explicit[id].note : (base.note || ''),
        done: !!explicit[id].done,
        repeating: !!recurring[id],
      };
    });
    return merged;
  }

  /* ── Time helpers ── */
  function _nowMin() {
    var d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }

  function _currentSlotId(nowMin, cfg) {
    var slotMin = Math.floor(nowMin / cfg.slotMinutes) * cfg.slotMinutes;
    if (slotMin < cfg.fromMin || slotMin >= cfg.toMin) return null;
    return 'dp_' + slotMin;
  }

  function _formatDate(date) {
    return date.toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
  }

  function _escAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
                    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ── Progress bar ── */
  function _renderProgress(slots, state) {
    var done = slots.filter(function (s) { return state[s.id] && state[s.id].done; }).length;
    var pct  = slots.length ? Math.round((done / slots.length) * 100) : 0;
    var fill = document.getElementById('dpProgressFill');
    var lbl  = document.getElementById('dpProgressLabel');
    if (fill) fill.style.width = pct + '%';
    if (lbl)  lbl.textContent  = done + ' / ' + slots.length + ' done';
  }

  /* ── Slot class helper ── */
  function _slotClass(slot, state, nowMin, currentId, cfg, viewDate) {
    var done = state[slot.id] && state[slot.id].done;
    var isNow = slot.id === currentId;
    var dayIsPast = _dpDateOnly(viewDate) < _dpDateOnly(new Date());
    var isPast = dayIsPast || (_dpIsToday(viewDate) && (slot.minutes + cfg.slotMinutes) <= nowMin);
    var cls = 'dp-slot';
    if (isNow)           cls += ' dp-now';
    if (done)             cls += ' dp-done';
    if (isPast && !done) cls += ' dp-past';
    return cls;
  }

  /* ── Lightweight NOW-highlight refresh (no full re-render) ── */
  function _refreshNow(slots) {
    if (!_dpIsToday(_dpViewDate)) return; // NOW marker/past-dimming only matters when viewing today
    var state     = _dpEffectiveState(_dpViewDate);
    var nowMin    = _nowMin();
    var currentId = _currentSlotId(nowMin, _dpConfig);

    slots.forEach(function (slot) {
      var row = document.getElementById('dp-row-' + slot.id);
      if (!row) return;

      row.className = _slotClass(slot, state, nowMin, currentId, _dpConfig, _dpViewDate);

      var badge = row.querySelector('.dp-now-badge');
      var isNow = slot.id === currentId;

      if (isNow && !badge) {
        var timeEl = row.querySelector('.dp-time');
        if (timeEl) {
          var b = document.createElement('span');
          b.className   = 'dp-now-badge';
          b.textContent = 'NOW';
          timeEl.appendChild(b);
        }
      } else if (!isNow && badge) {
        badge.remove();
      }
    });

    _renderProgress(slots, state);
  }

  /* ── Full DOM build ── */
  function _buildDOM(slots, state) {
    var nowMin    = _nowMin();
    var currentId = _dpIsToday(_dpViewDate) ? _currentSlotId(nowMin, _dpConfig) : null;
    var container = document.getElementById('dpSlots');
    if (!container) return;

    var html = [];
    slots.forEach(function (slot) {
      var isDone      = !!(state[slot.id] && state[slot.id].done);
      var note        = (state[slot.id] && state[slot.id].note) || '';
      var isRepeating = !!(state[slot.id] && state[slot.id].repeating);
      var isNow       = slot.id === currentId;
      var cls         = _slotClass(slot, state, nowMin, currentId, _dpConfig, _dpViewDate);

      html.push(
        '<div class="' + cls + '" id="dp-row-' + slot.id + '">',
          '<div class="dp-slot-left">',
            '<button class="dp-check" data-id="' + slot.id + '" aria-label="Toggle done">',
              isDone ? '✓' : '',
            '</button>',
            '<div class="dp-time">',
              slot.label,
              isNow ? '<span class="dp-now-badge">NOW</span>' : '',
            '</div>',
          '</div>',
          '<div class="dp-note-wrap">',
            '<input class="dp-note" type="text" placeholder="Add note…" ',
              'data-id="' + slot.id + '" ',
              'value="' + _escAttr(note) + '" ',
              'maxlength="200" />',
          '</div>',
          '<button class="dp-repeat' + (isRepeating ? ' active' : '') + '" data-id="' + slot.id + '" ',
            'title="' + (isRepeating ? 'Repeating daily — click to stop' : 'Repeat this task every day') + '" ',
            'aria-label="Toggle daily repeat">🔁</button>',
        '</div>'
      );
    });

    container.innerHTML = html.join('');

    /* Scroll current slot into view (today only) */
    var nowRow = currentId && document.getElementById('dp-row-' + currentId);
    if (nowRow) nowRow.scrollIntoView({ behavior: 'smooth', block: 'center' });

    /* ── Delegated events — attach only once to avoid double-toggle on re-entry ── */
    if (!_dpListenersAttached) {
      _dpListenersAttached = true;

      container.addEventListener('click', function (e) {
        var repeatBtn = e.target.closest && e.target.closest('.dp-repeat');
        if (repeatBtn) {
          var rid = repeatBtn.dataset.id;
          var noteInput = container.querySelector('.dp-note[data-id="' + rid + '"]');
          _dpToggleRepeat(rid, noteInput ? noteInput.value : '');
          _dpRenderWithConfig();
          return;
        }

        var btn = e.target.closest && e.target.closest('.dp-check');
        if (!btn) return;
        var id  = btn.dataset.id;
        var st  = _dpLoad(_dpViewDate);
        if (!st[id]) st[id] = {};
        st[id].done = !st[id].done;
        _dpSave(_dpViewDate, st);
        _dpRenderWithConfig();
      });

      container.addEventListener('input', function (e) {
        if (!e.target.classList.contains('dp-note')) return;
        var id  = e.target.dataset.id;
        var st  = _dpLoad(_dpViewDate);
        if (!st[id]) st[id] = {};
        st[id].note = e.target.value;
        _dpSave(_dpViewDate, st);
      });
    }

  }

  /* ── Public: reset the currently viewed day ── */
  function dpReset() {
    var label = _dpIsToday(_dpViewDate) ? 'today' : _formatDate(_dpViewDate);
    if (!window.confirm('Clear all slots for ' + label + '?')) return;
    localStorage.removeItem(_dpDateKey(_dpViewDate));
    _dpRenderWithConfig();
  }

  /* ── Public: redo the first-run setup (schedule window) ── */
  function dpChangeSchedule() {
    if (_dpTimer) { clearInterval(_dpTimer); _dpTimer = null; }
    var durationEl = document.getElementById('dpSetupDuration');
    var fromEl     = document.getElementById('dpSetupFrom');
    var toEl       = document.getElementById('dpSetupTo');
    if (_dpConfig) {
      if (durationEl) durationEl.value = String(_dpConfig.slotMinutes);
      if (fromEl) fromEl.value = _dpMinToTimeInput(_dpConfig.fromMin);
      if (toEl)   toEl.value   = _dpMinToTimeInput(_dpConfig.toMin);
    }
    _dpShowSetupModal();
  }

  function _dpMinToTimeInput(mins) {
    var h = Math.floor(mins / 60), m = mins % 60;
    return (h < 10 ? '0' + h : h) + ':' + (m < 10 ? '0' + m : m);
  }

  /* ── Public: day navigation ── */
  function dpPrevDay() {
    _dpViewDate.setDate(_dpViewDate.getDate() - 1);
    _dpRenderWithConfig();
  }

  function dpNextDay() {
    _dpViewDate.setDate(_dpViewDate.getDate() + 1);
    _dpRenderWithConfig();
  }

  function dpGoToday() {
    _dpViewDate = new Date();
    _dpRenderWithConfig();
  }

  /* ── Render using the currently loaded config + viewed date ── */
  function _dpRenderWithConfig() {
    if (_dpTimer) { clearInterval(_dpTimer); _dpTimer = null; }

    var slots = _dpSlots(_dpConfig);
    var state = _dpEffectiveState(_dpViewDate);

    var isToday = _dpIsToday(_dpViewDate);
    var dateEl  = document.getElementById('dpDate');
    if (dateEl) {
      var prefix = isToday ? 'Today · ' : '';
      dateEl.textContent = prefix + _formatDate(_dpViewDate);
    }
    var todayBtn = document.getElementById('dpTodayBtn');
    if (todayBtn) todayBtn.classList.toggle('hidden', isToday);

    _buildDOM(slots, state);
    _renderProgress(slots, state);

    /* Auto-refresh every 30 s to move the NOW highlight (no-op on non-today views) */
    _dpTimer = setInterval(function () { _refreshNow(slots); }, 30000);
  }

  /* ── First-run setup modal ── */
  function _dpShowSetupModal() {
    var modal = document.getElementById('dpSetupModal');
    if (modal) modal.classList.remove('hidden');
  }

  function _dpHideSetupModal() {
    var modal = document.getElementById('dpSetupModal');
    if (modal) modal.classList.add('hidden');
  }

  function dpSaveSetup() {
    var durationEl = document.getElementById('dpSetupDuration');
    var fromEl     = document.getElementById('dpSetupFrom');
    var toEl       = document.getElementById('dpSetupTo');
    var errEl      = document.getElementById('dpSetupError');

    var slotMinutes = Number(durationEl && durationEl.value);
    var fromParts   = (fromEl && fromEl.value || '').split(':').map(Number);
    var toParts     = (toEl && toEl.value || '').split(':').map(Number);
    var fromMin     = fromParts.length === 2 ? fromParts[0] * 60 + fromParts[1] : NaN;
    var toMin       = toParts.length === 2 ? toParts[0] * 60 + toParts[1] : NaN;

    if (!slotMinutes || isNaN(fromMin) || isNaN(toMin) || toMin <= fromMin) {
      if (errEl) {
        errEl.textContent = 'Please pick a "From" time earlier than "To".';
        errEl.style.display = 'block';
      }
      return;
    }
    if (errEl) errEl.style.display = 'none';

    var cfg = { slotMinutes: slotMinutes, fromMin: fromMin, toMin: toMin };
    _dpConfig = cfg;
    _dpSaveConfig(cfg);
    _dpHideSetupModal();
    _dpRenderWithConfig();
  }

  /* ── Copy tasks from another day ── */
  function dpOpenCopyModal() {
    var input = document.getElementById('dpCopySourceDate');
    if (input) {
      var yesterday = new Date(_dpViewDate.getTime());
      yesterday.setDate(yesterday.getDate() - 1);
      input.value = _dpInputDate(yesterday);
    }
    var label = document.getElementById('dpCopyTargetLabel');
    if (label) label.textContent = _dpIsToday(_dpViewDate) ? 'today' : _formatDate(_dpViewDate);
    var errEl = document.getElementById('dpCopyError');
    if (errEl) errEl.style.display = 'none';
    var modal = document.getElementById('dpCopyModal');
    if (modal) modal.classList.remove('hidden');
  }

  function dpCloseCopyModal() {
    var modal = document.getElementById('dpCopyModal');
    if (modal) modal.classList.add('hidden');
  }

  function dpCopyFromDate() {
    var input = document.getElementById('dpCopySourceDate');
    var errEl = document.getElementById('dpCopyError');
    var val   = input && input.value;

    function _fail(msg) {
      if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
    }

    if (!val) { _fail('Please pick a day to copy from.'); return; }

    var parts   = val.split('-').map(Number);
    var srcDate = new Date(parts[0], parts[1] - 1, parts[2]);
    if (_dpDateOnly(srcDate) === _dpDateOnly(_dpViewDate)) {
      _fail("Pick a different day than the one you're viewing.");
      return;
    }

    var validIds = {};
    _dpSlots(_dpConfig).forEach(function (s) { validIds[s.id] = true; });

    var srcState = _dpLoad(srcDate);
    var srcKeys  = Object.keys(srcState).filter(function (id) {
      return validIds[id] && srcState[id] && srcState[id].note;
    });

    if (!srcKeys.length) { _fail('That day has no notes to copy.'); return; }

    var targetLabel = _dpIsToday(_dpViewDate) ? 'today' : _formatDate(_dpViewDate);
    if (!window.confirm('Copy ' + srcKeys.length + ' note(s) into ' + targetLabel + '? This will overwrite matching notes on this day.')) return;

    var targetState = _dpLoad(_dpViewDate);
    srcKeys.forEach(function (id) {
      if (!targetState[id]) targetState[id] = {};
      targetState[id].note = srcState[id].note;
    });
    _dpSave(_dpViewDate, targetState);

    dpCloseCopyModal();
    _dpRenderWithConfig();
  }

  /* ── Public: slot count (for the home-screen stat) ── */
  function dpSlotCount() {
    return _dpConfig ? _dpSlots(_dpConfig).length : 0;
  }

  /* ── Public: today's done/total (for the home-screen stat) ── */
  function dpTodayStats() {
    if (!_dpConfig) return { done: 0, total: 0 };
    var slots = _dpSlots(_dpConfig);
    var state = _dpLoad(new Date());
    var done  = slots.filter(function (s) { return state[s.id] && state[s.id].done; }).length;
    return { done: done, total: slots.length };
  }

  /* ── Public: entry point ── */
  async function initDayPlanner() {
    _dpMigrateLegacy();
    _dpViewDate = new Date();
    if (!_dpConfig) _dpConfig = await _dpLoadConfig();

    if (!_dpConfig) {
      _dpShowSetupModal();
      return;
    }

    _dpHideSetupModal();
    _dpRenderWithConfig();
  }

  window.initDayPlanner   = initDayPlanner;
  window.dpReset          = dpReset;
  window.dpSaveSetup      = dpSaveSetup;
  window.dpSlotCount      = dpSlotCount;
  window.dpTodayStats     = dpTodayStats;
  window.dpChangeSchedule = dpChangeSchedule;
  window.dpPrevDay        = dpPrevDay;
  window.dpNextDay        = dpNextDay;
  window.dpGoToday        = dpGoToday;
  window.dpOpenCopyModal  = dpOpenCopyModal;
  window.dpCloseCopyModal = dpCloseCopyModal;
  window.dpCopyFromDate   = dpCopyFromDate;
})();
