// ── DAY PLANNER ───────────────────────────────────────────────────────────────
// Config (schedule window) syncs per-user via Firestore (fr-sync.js), same
// Firestore path (users/{uid}/config/dayplanner) as the classic v1 UI.
// Slot completion state is kept in the same per-user, per-day localStorage keys
// the classic UI uses ('finresolver_dayplanner_<uid>_YYYY-MM-DD', same
// 'dp_<minutes>' slot ids), and recurring "repeat daily" templates share the
// same 'finresolver_dayplanner_recurring_<uid>' key — so both UIs stay in sync
// for the same signed-in user.

const DP_LEGACY_KEY   = 'finresolver_dayplanner';           // pre-2026-07 flat "today only" key — migrated on first load
const DP_KEY_PREFIX    = 'finresolver_dayplanner_';
const DP_RECURRING_KEY = 'finresolver_dayplanner_recurring';

function _dpv2Uid() {
  return (typeof _currentUID !== 'undefined' && _currentUID) ? _currentUID : 'guest';
}
let _dpv2Timer = null;
let _dpv2ViewDate = new Date(); // resets to "today" every time the screen is opened via navigate()

function _dpv2Slots(cfg) {
  const slots = [];
  for (let m = cfg.fromMin; m < cfg.toMin; m += cfg.slotMinutes) {
    const h = Math.floor(m / 60), min = m % 60;
    const ap = h < 12 ? 'AM' : 'PM';
    const h12 = h % 12 || 12;
    slots.push({ id: 'dp_' + m, label: h12 + ':' + (min < 10 ? '0' + min : min) + ' ' + ap, minutes: m });
  }
  return slots;
}

// ── Date helpers ──
function _dpv2DateKey(date) {
  const y = date.getFullYear(), m = date.getMonth() + 1, d = date.getDate();
  return DP_KEY_PREFIX + _dpv2Uid() + '_' + y + '-' + (m < 10 ? '0' + m : m) + '-' + (d < 10 ? '0' + d : d);
}
function _dpv2RecurringKey() { return DP_RECURRING_KEY + '_' + _dpv2Uid(); }
function _dpv2InputDate(date) {
  const y = date.getFullYear(), m = date.getMonth() + 1, d = date.getDate();
  return y + '-' + (m < 10 ? '0' + m : m) + '-' + (d < 10 ? '0' + d : d);
}
function _dpv2DateOnly(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }
function _dpv2IsToday(date) { return _dpv2DateOnly(date) === _dpv2DateOnly(new Date()); }

function _dpv2LoadState(date) {
  try { return JSON.parse(localStorage.getItem(_dpv2DateKey(date))) || {}; }
  catch (e) { return {}; }
}
function _dpv2SaveState(date, state) {
  try { localStorage.setItem(_dpv2DateKey(date), JSON.stringify(state)); } catch (e) {}
  if (_dpv2DaySaveTimer) clearTimeout(_dpv2DaySaveTimer);
  _dpv2DaySaveTimer = setTimeout(() => _dpv2PushDayToFirestore(date, state), 500);
}

// ── Firestore sync: day-state + recurring templates (mirrors classic v1's
// js/dayplanner.js — same Firestore paths, so both UIs stay in sync for the
// same signed-in user). Config sync already lives in fr-sync.js; task data
// is self-contained here since it doesn't fit fr-sync.js's single-blob
// per-module pattern (one doc per calendar day). ──
function _dpv2DbReady() {
  return typeof _db !== 'undefined' && _db && _currentUID;
}

let _dpv2SyncedDayKeys   = {};
let _dpv2RecurringSynced = false;
let _dpv2DaySaveTimer    = null;

async function _dpv2FetchDayFromFirestore(date) {
  if (!_dpv2DbReady()) return null;
  try {
    const snap = await _db.collection('users').doc(_currentUID)
      .collection('dayplanner_days').doc(_dpv2InputDate(date)).get();
    if (!snap.exists) return null;
    const raw = snap.data()._enc;
    if (!raw) return null;
    const dec = await decryptFromStorage(raw, _currentEmail);
    return (dec && typeof dec === 'object') ? dec : null;
  } catch (e) { console.warn('[DayPlanner] Firestore day load failed:', e); return null; }
}

function _dpv2PushDayToFirestore(date, state) {
  if (!_dpv2DbReady()) return;
  const uid = _currentUID, docId = _dpv2InputDate(date);
  (async () => {
    try {
      const enc = await encryptForStorage(state, _currentEmail);
      await _db.collection('users').doc(uid).collection('dayplanner_days').doc(docId).set({ _enc: enc });
    } catch (e) { console.warn('[DayPlanner] Firestore day save failed:', e); }
  })();
}

function _dpv2DeleteDayFromFirestore(date) {
  if (!_dpv2DbReady()) return;
  _db.collection('users').doc(_currentUID)
    .collection('dayplanner_days').doc(_dpv2InputDate(date)).delete()
    .catch(e => console.warn('[DayPlanner] Firestore day delete failed:', e));
}

// Pull a day's cloud state into the local cache the first time it's viewed
// this session; every save afterwards keeps local + cloud in sync going forward.
async function _dpv2EnsureDaySynced(date) {
  const key = _dpv2DateKey(date);
  if (_dpv2SyncedDayKeys[key]) return;
  _dpv2SyncedDayKeys[key] = true;
  const cloud = await _dpv2FetchDayFromFirestore(date);
  if (cloud) localStorage.setItem(key, JSON.stringify(cloud));
}

async function _dpv2FetchRecurringFromFirestore() {
  if (!_dpv2DbReady()) return null;
  try {
    const snap = await _db.collection('users').doc(_currentUID)
      .collection('config').doc('dayplanner_recurring').get();
    if (!snap.exists) return null;
    const raw = snap.data()._enc;
    if (!raw) return null;
    const dec = await decryptFromStorage(raw, _currentEmail);
    return (dec && typeof dec === 'object') ? dec : null;
  } catch (e) { console.warn('[DayPlanner] Firestore recurring load failed:', e); return null; }
}

function _dpv2PushRecurringToFirestore(rec) {
  if (!_dpv2DbReady()) return;
  const uid = _currentUID;
  (async () => {
    try {
      const enc = await encryptForStorage(rec, _currentEmail);
      await _db.collection('users').doc(uid).collection('config').doc('dayplanner_recurring').set({ _enc: enc });
    } catch (e) { console.warn('[DayPlanner] Firestore recurring save failed:', e); }
  })();
}

async function _dpv2EnsureRecurringSynced() {
  if (_dpv2RecurringSynced) return;
  _dpv2RecurringSynced = true;
  const cloud = await _dpv2FetchRecurringFromFirestore();
  if (cloud) localStorage.setItem(_dpv2RecurringKey(), JSON.stringify(cloud));
}

// Called by fr-sync.js's loadAllData() at login so the dashboard is correct
// without requiring the user to open the Day Planner screen first.
async function dpv2SyncTodayFromFirestore() {
  await Promise.all([_dpv2EnsureDaySynced(new Date()), _dpv2EnsureRecurringSynced()]);
}

// Called by fr-sync.js's logout() so a subsequent login on the same page
// can't see the previous user's "already synced" cache markers.
function resetDayPlannerV2State() {
  if (_dpv2Timer) { clearInterval(_dpv2Timer); _dpv2Timer = null; }
  if (_dpv2DaySaveTimer) { clearTimeout(_dpv2DaySaveTimer); _dpv2DaySaveTimer = null; }
  _dpv2ViewDate = new Date();
  _dpv2SyncedDayKeys = {};
  _dpv2RecurringSynced = false;
}

function _dpv2MigrateLegacy() {
  const raw = localStorage.getItem(DP_LEGACY_KEY);
  if (!raw) return;
  const todayKey = _dpv2DateKey(new Date());
  if (!localStorage.getItem(todayKey)) localStorage.setItem(todayKey, raw);
  localStorage.removeItem(DP_LEGACY_KEY);
}

// ── Recurring-task templates ──
function _dpv2LoadRecurring() {
  try { return JSON.parse(localStorage.getItem(_dpv2RecurringKey())) || {}; }
  catch (e) { return {}; }
}
function _dpv2SaveRecurring(rec) {
  try { localStorage.setItem(_dpv2RecurringKey(), JSON.stringify(rec)); } catch (e) {}
  _dpv2PushRecurringToFirestore(rec);
}
function _dpv2ToggleRepeat(id, noteValue) {
  const rec = _dpv2LoadRecurring();
  if (rec[id]) delete rec[id];
  else rec[id] = { note: noteValue || '' };
  _dpv2SaveRecurring(rec);
}

function _dpv2EffectiveState(date) {
  const explicit  = _dpv2LoadState(date);
  const recurring = _dpv2LoadRecurring();
  const merged = {};
  Object.keys(recurring).forEach(id => { merged[id] = { note: recurring[id].note, done: false, repeating: true }; });
  Object.keys(explicit).forEach(id => {
    const base = merged[id] || {};
    merged[id] = {
      note: explicit[id].note !== undefined ? explicit[id].note : (base.note || ''),
      done: !!explicit[id].done,
      repeating: !!recurring[id],
    };
  });
  return merged;
}

function _dpv2NowMin() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function _dpv2CurrentId(nowMin, cfg) {
  const slotMin = Math.floor(nowMin / cfg.slotMinutes) * cfg.slotMinutes;
  if (slotMin < cfg.fromMin || slotMin >= cfg.toMin) return null;
  return 'dp_' + slotMin;
}

function _dpv2MinToTimeInput(mins) {
  const h = Math.floor(mins / 60), m = mins % 60;
  return (h < 10 ? '0' + h : h) + ':' + (m < 10 ? '0' + m : m);
}

// ── SCREEN ────────────────────────────────────────────────────────────────────
function renderDayPlanner(el) {
  if (_dpv2Timer) { clearInterval(_dpv2Timer); _dpv2Timer = null; }
  _dpv2MigrateLegacy();

  const cfg = APP.dayplanner && APP.dayplanner.config;
  if (!cfg) { el.innerHTML = _dpv2SetupHtml(); return; }

  // Kick off a background reconcile the first time this day/the recurring
  // templates are viewed this session; re-render once when it resolves so
  // cloud edits (e.g. made on another device) appear without a page refresh.
  const dayKey = _dpv2DateKey(_dpv2ViewDate);
  if (!_dpv2SyncedDayKeys[dayKey]) {
    _dpv2EnsureDaySynced(_dpv2ViewDate).then(() => {
      if (_screen === 'dayplanner') renderDayPlanner(document.getElementById('screen-content'));
    });
  }
  if (!_dpv2RecurringSynced) {
    _dpv2EnsureRecurringSynced().then(() => {
      if (_screen === 'dayplanner') renderDayPlanner(document.getElementById('screen-content'));
    });
  }

  const slots    = _dpv2Slots(cfg);
  const state    = _dpv2EffectiveState(_dpv2ViewDate);
  const isToday  = _dpv2IsToday(_dpv2ViewDate);
  const nowMin   = _dpv2NowMin();
  const curId    = isToday ? _dpv2CurrentId(nowMin, cfg) : null;
  const done     = slots.filter(s => state[s.id] && state[s.id].done).length;
  const pct      = slots.length ? Math.round((done / slots.length) * 100) : 0;
  const dateStr  = (isToday ? 'Today · ' : '') + _dpv2ViewDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  el.innerHTML = `
    <div class="sh">
      <div class="sh-l">
        <div class="sh-title">${ic('clock', 20)} Day Planner</div>
        <div class="sh-sub row" style="gap:8px;align-items:center">
          <button class="dpv2-date-arrow" onclick="dpv2PrevDay()" aria-label="Previous day">${ic('chevLt', 12)}</button>
          <span>${dateStr}</span>
          <button class="dpv2-date-arrow" onclick="dpv2NextDay()" aria-label="Next day">${ic('chevRt', 12)}</button>
          ${!isToday ? `<button class="dpv2-today-btn" onclick="dpv2GoToday()">Today</button>` : ''}
        </div>
      </div>
      <div class="sh-r" style="gap:8px">
        <button class="btn btn-sm" onclick="dpv2OpenCopyModal()">⧉ Copy from…</button>
        <button class="btn btn-sm" onclick="dpv2ChangeSchedule()">${ic('edit',12)} Change Schedule</button>
        <button class="btn btn-sm" onclick="dpv2ResetDay()">${ic('refresh',12)} Reset Day</button>
      </div>
    </div>

    <div class="card" style="margin-bottom:20px">
      <div class="card-body row" style="gap:14px;align-items:center">
        <div class="prog" style="flex:1"><div class="prog-fill" style="width:${pct}%"></div></div>
        <span style="font-size:12px;font-family:var(--font-m);color:var(--t3);white-space:nowrap">${done} / ${slots.length} done</span>
      </div>
    </div>

    <div class="dpv2-slots" id="dpv2-slots">
      ${slots.map(s => _dpv2SlotHtml(s, state, curId)).join('')}
    </div>`;

  const slotsEl = document.getElementById('dpv2-slots');
  const nowRow  = curId && document.getElementById('dpv2-row-' + curId);
  if (nowRow) nowRow.scrollIntoView({ behavior: 'smooth', block: 'center' });

  if (slotsEl) {
    slotsEl.addEventListener('click', e => {
      const repeatBtn = e.target.closest && e.target.closest('.dpv2-repeat');
      if (repeatBtn) {
        const rid = repeatBtn.dataset.id;
        const noteInput = slotsEl.querySelector(`.dpv2-note[data-id="${rid}"]`);
        _dpv2ToggleRepeat(rid, noteInput ? noteInput.value : '');
        renderDayPlanner(document.getElementById('screen-content'));
        return;
      }
      const btn = e.target.closest && e.target.closest('.dpv2-check');
      if (!btn) return;
      const id = btn.dataset.id;
      const st = _dpv2LoadState(_dpv2ViewDate);
      if (!st[id]) st[id] = {};
      st[id].done = !st[id].done;
      _dpv2SaveState(_dpv2ViewDate, st);
      renderDayPlanner(document.getElementById('screen-content'));
    });
    slotsEl.addEventListener('input', e => {
      if (!e.target.classList.contains('dpv2-note')) return;
      const id = e.target.dataset.id;
      const st = _dpv2LoadState(_dpv2ViewDate);
      if (!st[id]) st[id] = {};
      st[id].note = e.target.value;
      _dpv2SaveState(_dpv2ViewDate, st);
    });
  }

  _dpv2Timer = setInterval(() => {
    if (_screen === 'dayplanner') renderDayPlanner(document.getElementById('screen-content'));
  }, 30000);
}

function _dpv2SlotHtml(slot, state, curId) {
  const isDone      = !!(state[slot.id] && state[slot.id].done);
  const note        = (state[slot.id] && state[slot.id].note) || '';
  const isRepeating = !!(state[slot.id] && state[slot.id].repeating);
  const isNow       = slot.id === curId;
  return `<div class="dpv2-slot${isNow ? ' now' : ''}${isDone ? ' done' : ''}" id="dpv2-row-${slot.id}">
    <button class="dpv2-check" data-id="${slot.id}">${isDone ? ic('check', 13) : ''}</button>
    <div class="dpv2-time">${slot.label}${isNow ? '<span class="dpv2-now-badge">NOW</span>' : ''}</div>
    <input class="dpv2-note" type="text" placeholder="Add note…" data-id="${slot.id}" maxlength="200" value="${(note || '').replace(/"/g, '&quot;')}" />
    <button class="dpv2-repeat${isRepeating ? ' active' : ''}" data-id="${slot.id}" title="${isRepeating ? 'Repeating daily — click to stop' : 'Repeat this task every day'}">🔁</button>
  </div>`;
}

// ── FIRST-RUN / CHANGE-SCHEDULE SETUP ─────────────────────────────────────────
function _dpv2SetupHtml() {
  return `
    <div class="sh">
      <div class="sh-l">
        <div class="sh-title">${ic('clock', 20)} Set Up Your Day Planner</div>
        <div class="sh-sub">Tell us how you'd like your day broken up — you can change this any time.</div>
      </div>
    </div>
    <div class="card" style="max-width:420px">
      <div class="card-body col" style="gap:14px">
        <div class="inp-grp">
          <div class="inp-label">Slot Duration</div>
          <select class="inp" id="dpv2-duration">
            <option value="15">15 minutes</option>
            <option value="30" selected>30 minutes</option>
            <option value="60">60 minutes</option>
          </select>
        </div>
        <div class="row" style="gap:12px">
          <div class="inp-grp" style="flex:1">
            <div class="inp-label">From</div>
            <input class="inp" type="time" id="dpv2-from" value="06:00" />
          </div>
          <div class="inp-grp" style="flex:1">
            <div class="inp-label">To</div>
            <input class="inp" type="time" id="dpv2-to" value="22:00" />
          </div>
        </div>
        <div id="dpv2-setup-error" style="display:none;font-size:12px;color:var(--red)"></div>
        <button class="btn btn-primary" onclick="dpv2SaveSetup()">Save &amp; Start →</button>
      </div>
    </div>`;
}

function dpv2ChangeSchedule() {
  APP.dayplanner.config = null;
  renderDayPlanner(document.getElementById('screen-content'));
  // Pre-fill the form with the previous values for convenience
  setTimeout(() => {
    const prev = _dpv2LastConfig;
    if (!prev) return;
    const d = document.getElementById('dpv2-duration');
    const f = document.getElementById('dpv2-from');
    const t = document.getElementById('dpv2-to');
    if (d) d.value = String(prev.slotMinutes);
    if (f) f.value = _dpv2MinToTimeInput(prev.fromMin);
    if (t) t.value = _dpv2MinToTimeInput(prev.toMin);
  }, 0);
}

let _dpv2LastConfig = null;

function dpv2SaveSetup() {
  const durationEl = document.getElementById('dpv2-duration');
  const fromEl = document.getElementById('dpv2-from');
  const toEl = document.getElementById('dpv2-to');
  const errEl = document.getElementById('dpv2-setup-error');

  const slotMinutes = Number(durationEl && durationEl.value);
  const fromParts = (fromEl && fromEl.value || '').split(':').map(Number);
  const toParts = (toEl && toEl.value || '').split(':').map(Number);
  const fromMin = fromParts.length === 2 ? fromParts[0] * 60 + fromParts[1] : NaN;
  const toMin = toParts.length === 2 ? toParts[0] * 60 + toParts[1] : NaN;

  if (!slotMinutes || isNaN(fromMin) || isNaN(toMin) || toMin <= fromMin) {
    if (errEl) { errEl.textContent = 'Please pick a "From" time earlier than "To".'; errEl.style.display = 'block'; }
    return;
  }

  const cfg = { slotMinutes, fromMin, toMin };
  _dpv2LastConfig = cfg;
  APP.dayplanner.config = cfg;
  if (typeof saveDayPlannerConfig === 'function') saveDayPlannerConfig();
  renderDayPlanner(document.getElementById('screen-content'));
}

function dpv2ResetDay() {
  const label = _dpv2IsToday(_dpv2ViewDate) ? 'today' : _dpv2ViewDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  if (!confirm('Clear all slots for ' + label + '?')) return;
  localStorage.removeItem(_dpv2DateKey(_dpv2ViewDate));
  _dpv2DeleteDayFromFirestore(_dpv2ViewDate);
  renderDayPlanner(document.getElementById('screen-content'));
}

// ── Day navigation ──
async function dpv2PrevDay() {
  _dpv2ViewDate = new Date(_dpv2ViewDate.getTime());
  _dpv2ViewDate.setDate(_dpv2ViewDate.getDate() - 1);
  await _dpv2EnsureDaySynced(_dpv2ViewDate);
  renderDayPlanner(document.getElementById('screen-content'));
}
async function dpv2NextDay() {
  _dpv2ViewDate = new Date(_dpv2ViewDate.getTime());
  _dpv2ViewDate.setDate(_dpv2ViewDate.getDate() + 1);
  await _dpv2EnsureDaySynced(_dpv2ViewDate);
  renderDayPlanner(document.getElementById('screen-content'));
}
async function dpv2GoToday() {
  _dpv2ViewDate = new Date();
  await _dpv2EnsureDaySynced(_dpv2ViewDate);
  renderDayPlanner(document.getElementById('screen-content'));
}

// ── Copy tasks from another day ──
function dpv2OpenCopyModal() {
  const targetLabel = _dpv2IsToday(_dpv2ViewDate) ? 'today' : _dpv2ViewDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const yesterday = new Date(_dpv2ViewDate.getTime());
  yesterday.setDate(yesterday.getDate() - 1);
  openModal(`
    <div class="modal-hd">
      <div class="modal-title">⧉ Copy Tasks From Another Day</div>
      <button class="modal-close" onclick="closeModal()">${ic('x',13)}</button>
    </div>
    <div class="modal-body">
      <p style="font-size:13px;color:var(--t3);margin:0 0 14px">
        Pick a day to copy its notes into <b>${targetLabel}</b>. This overwrites matching notes
        on this day — done status is never copied.
      </p>
      <div class="inp-grp">
        <div class="inp-label">Source Day</div>
        <input class="inp" id="dpv2-copy-source" type="date" value="${_dpv2InputDate(yesterday)}" />
      </div>
      <div id="dpv2-copy-error" style="display:none;font-size:12px;color:var(--red);margin-top:10px"></div>
    </div>
    <div class="modal-ft">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="dpv2CopyFromDate()">Copy</button>
    </div>
  `);
}

async function dpv2CopyFromDate() {
  const input = document.getElementById('dpv2-copy-source');
  const errEl = document.getElementById('dpv2-copy-error');
  const val   = input && input.value;

  function fail(msg) { if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; } }

  if (!val) { fail('Please pick a day to copy from.'); return; }

  const parts   = val.split('-').map(Number);
  const srcDate = new Date(parts[0], parts[1] - 1, parts[2]);
  if (_dpv2DateOnly(srcDate) === _dpv2DateOnly(_dpv2ViewDate)) {
    fail("Pick a different day than the one you're viewing.");
    return;
  }

  await _dpv2EnsureDaySynced(srcDate);

  const cfg = APP.dayplanner && APP.dayplanner.config;
  const validIds = {};
  _dpv2Slots(cfg).forEach(s => { validIds[s.id] = true; });

  const srcState = _dpv2LoadState(srcDate);
  const srcKeys  = Object.keys(srcState).filter(id => validIds[id] && srcState[id] && srcState[id].note);

  if (!srcKeys.length) { fail('That day has no notes to copy.'); return; }

  const targetLabel = _dpv2IsToday(_dpv2ViewDate) ? 'today' : _dpv2ViewDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  if (!confirm(`Copy ${srcKeys.length} note(s) into ${targetLabel}? This will overwrite matching notes on this day.`)) return;

  const targetState = _dpv2LoadState(_dpv2ViewDate);
  srcKeys.forEach(id => {
    if (!targetState[id]) targetState[id] = {};
    targetState[id].note = srcState[id].note;
  });
  _dpv2SaveState(_dpv2ViewDate, targetState);

  closeModal();
  renderDayPlanner(document.getElementById('screen-content'));
}
