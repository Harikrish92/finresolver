/* ============================================================
   dayplanner.js — 30-minute interval Day Planner
   FinResolver · finresolver.in
   ============================================================ */

(function () {
  'use strict';

  var DP_KEY = 'finresolver_dayplanner';
  var _dpTimer = null;
  var _dpListenersAttached = false;

  /* ── Slot definitions: 6:00 AM → 10:00 PM, 30-min steps (32 slots) ── */
  function _dpSlots() {
    var slots = [];
    for (var m = 6 * 60; m < 22 * 60; m += 30) {
      var h   = Math.floor(m / 60);
      var min = m % 60;
      var ap  = h < 12 ? 'AM' : 'PM';
      var h12 = h % 12 || 12;
      slots.push({
        id:      'dp_' + m,
        label:   h12 + ':' + (min === 0 ? '00' : '30') + ' ' + ap,
        minutes: m,
      });
    }
    return slots;
  }

  /* ── Persistence ── */
  function _dpLoad() {
    try { return JSON.parse(localStorage.getItem(DP_KEY)) || {}; }
    catch (e) { return {}; }
  }

  function _dpSave(state) {
    try { localStorage.setItem(DP_KEY, JSON.stringify(state)); }
    catch (e) { /* quota exceeded — silent fail */ }
  }

  /* ── Time helpers ── */
  function _nowMin() {
    var d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }

  function _currentSlotId(nowMin) {
    var slotMin = Math.floor(nowMin / 30) * 30;
    if (slotMin < 6 * 60 || slotMin >= 22 * 60) return null;
    return 'dp_' + slotMin;
  }

  function _formatDate() {
    return new Date().toLocaleDateString('en-US', {
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
    var pct  = Math.round((done / slots.length) * 100);
    var fill = document.getElementById('dpProgressFill');
    var lbl  = document.getElementById('dpProgressLabel');
    if (fill) fill.style.width = pct + '%';
    if (lbl)  lbl.textContent  = done + ' / ' + slots.length + ' done';
  }

  /* ── Slot class helper ── */
  function _slotClass(slot, state, nowMin, currentId) {
    var done = state[slot.id] && state[slot.id].done;
    var isNow = slot.id === currentId;
    var isPast = (slot.minutes + 30) <= nowMin;
    var cls = 'dp-slot';
    if (isNow)          cls += ' dp-now';
    if (done)           cls += ' dp-done';
    if (isPast && !done) cls += ' dp-past';
    return cls;
  }

  /* ── Lightweight NOW-highlight refresh (no full re-render) ── */
  function _refreshNow(slots) {
    var state     = _dpLoad();
    var nowMin    = _nowMin();
    var currentId = _currentSlotId(nowMin);

    slots.forEach(function (slot) {
      var row = document.getElementById('dp-row-' + slot.id);
      if (!row) return;

      row.className = _slotClass(slot, state, nowMin, currentId);

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
    var currentId = _currentSlotId(nowMin);
    var container = document.getElementById('dpSlots');
    if (!container) return;

    var html = [];
    slots.forEach(function (slot) {
      var isDone = !!(state[slot.id] && state[slot.id].done);
      var note   = (state[slot.id] && state[slot.id].note) || '';
      var isNow  = slot.id === currentId;
      var cls    = _slotClass(slot, state, nowMin, currentId);

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
        '</div>'
      );
    });

    container.innerHTML = html.join('');

    /* Scroll current slot into view */
    var nowRow = currentId && document.getElementById('dp-row-' + currentId);
    if (nowRow) nowRow.scrollIntoView({ behavior: 'smooth', block: 'center' });

    /* ── Delegated events — attach only once to avoid double-toggle on re-entry ── */
    if (!_dpListenersAttached) {
      _dpListenersAttached = true;

      container.addEventListener('click', function (e) {
        var btn = e.target.closest && e.target.closest('.dp-check');
        if (!btn) return;
        var id  = btn.dataset.id;
        var st  = _dpLoad();
        if (!st[id]) st[id] = {};
        st[id].done = !st[id].done;
        _dpSave(st);

        btn.textContent = st[id].done ? '✓' : '';
        var row = document.getElementById('dp-row-' + id);
        if (row) {
          var s = slots.find(function (sl) { return sl.id === id; });
          row.className = _slotClass(s, st, _nowMin(), _currentSlotId(_nowMin()));
        }
        _renderProgress(slots, st);
      });

      container.addEventListener('input', function (e) {
        if (!e.target.classList.contains('dp-note')) return;
        var id  = e.target.dataset.id;
        var st  = _dpLoad();
        if (!st[id]) st[id] = {};
        st[id].note = e.target.value;
        _dpSave(st);
      });
    }
  }

  /* ── Public: reset ── */
  function dpReset() {
    if (!window.confirm('Clear all slots for today?')) return;
    localStorage.removeItem(DP_KEY);
    initDayPlanner();
  }

  /* ── Public: entry point ── */
  function initDayPlanner() {
    if (_dpTimer) { clearInterval(_dpTimer); _dpTimer = null; }

    var slots = _dpSlots();
    var state = _dpLoad();

    var dateEl = document.getElementById('dpDate');
    if (dateEl) dateEl.textContent = _formatDate();

    _buildDOM(slots, state);
    _renderProgress(slots, state);

    /* Auto-refresh every 30 s to move the NOW highlight */
    _dpTimer = setInterval(function () { _refreshNow(slots); }, 30000);
  }

  window.initDayPlanner = initDayPlanner;
  window.dpReset        = dpReset;
})();
