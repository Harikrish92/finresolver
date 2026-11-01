/* ============================================================
   usage.js — product usage analytics, shared by Classic and Modern
   FinResolver · finresolver.in

   Counts which screens signed-in users open and how often they use
   FINOVA, so admin.html can show what to build and improve next.
   Only counters and the Google profile (name, email, photo) are
   written — never any financial data.

   Firestore (rules: firestore.rules at the repo root):
     analytics_users/{uid}       one doc per user: profile, firstSeen,
                                 lastSeen, sessions, views, screens.*,
                                 events.*, ui.*, lastUi, device
     analytics_daily/{YYYY-MM-DD} one doc per day: views, sessions,
                                 screens.*, events.*, ui.*, devices.*,
                                 users.{uid}=true (daily active users)
     app_admin/admins            { emails: [...] } — created by hand in
                                 the Firebase console; readable only by
                                 the admins it lists

   Guests have no Firebase account, so nothing is recorded for them.
   Counts are buffered and written at most once a minute (and when the
   tab is hidden), as two merged writes.

   Usage:  FrUsage.screen('loans');  FrUsage.event('finova_query');
   Any element with a data-admin-only attribute (and an inline
   display:none) is revealed when the signed-in user is an admin.
   ============================================================ */
(function () {
  'use strict';

  var FLUSH_MS       = 60000;
  var FIRST_FLUSH_MS = 8000;
  var MAX_FAILURES   = 3;   // e.g. rules not deployed yet — stop retrying

  /* Classic and Modern call the same screens by different names. */
  var ALIASES = { home: 'finova', advisor: 'finova', tracker: 'monthly',
                  'loan-detail': 'loans', 'goal-detail': 'goals' };

  var UI     = /\/v2\//.test(location.pathname) ? 'modern' : 'classic';
  var DEVICE = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent || '') ? 'mobile' : 'desktop';

  var pending        = _empty();
  var lastScreen     = null;
  var sessionUid     = null;  // uid whose session has been counted this page load
  var adminUid       = null;  // uid the admin check last ran for
  var flushing       = false;
  var failures       = 0;
  var disabled       = false;

  function _empty() { return { views: 0, screens: {}, events: {} }; }
  function _pad(n)  { return (n < 10 ? '0' : '') + n; }
  function _dayKey() {
    var d = new Date();
    return d.getFullYear() + '-' + _pad(d.getMonth() + 1) + '-' + _pad(d.getDate());
  }
  function _key(name) {
    var k = String(name || '').toLowerCase();
    k = ALIASES[k] || k;
    return k.replace(/[^a-z0-9_-]/g, '_').slice(0, 40);
  }
  function _isEmpty(o) { for (var k in o) return false; return true; }

  function _fb() {
    return (window.firebase && firebase.apps && firebase.apps.length && firebase.firestore && firebase.auth)
      ? firebase : null;
  }
  function _authUser() {
    var f = _fb();
    try { return f ? f.auth().currentUser : null; } catch (e) { return null; }
  }

  function screen(name) {
    var k = _key(name);
    if (!k || k === lastScreen) return;  // re-renders of the same screen aren't new visits
    lastScreen = k;
    pending.screens[k] = (pending.screens[k] || 0) + 1;
    pending.views++;
  }

  function event(name) {
    var k = _key(name);
    if (k) pending.events[k] = (pending.events[k] || 0) + 1;
  }

  /* Put counts from a failed write back so the next flush retries them. */
  function _restore(batch) {
    pending.views += batch.views;
    ['screens', 'events'].forEach(function (f) {
      for (var k in batch[f]) pending[f][k] = (pending[f][k] || 0) + batch[f][k];
    });
  }

  async function flush() {
    if (flushing || disabled) return;
    var u = _authUser();
    if (!u) return;  // not signed in (yet) — keep the buffer
    var newSession = sessionUid !== u.uid;
    if (!newSession && !pending.views && _isEmpty(pending.events)) return;

    var f   = _fb();
    var db  = f.firestore();
    var inc = f.firestore.FieldValue.increment;
    var now = f.firestore.FieldValue.serverTimestamp();
    var batch = pending;
    pending = _empty();
    flushing = true;

    var userDoc = { uid: u.uid, name: u.displayName || '', email: u.email || '',
                    photo: u.photoURL || '', lastSeen: now, lastUi: UI, device: DEVICE,
                    views: inc(batch.views), screens: {}, events: {} };
    var dayDoc  = { date: _dayKey(), views: inc(batch.views), screens: {}, events: {}, users: {} };
    dayDoc.users[u.uid] = true;
    for (var s in batch.screens) { userDoc.screens[s] = inc(batch.screens[s]); dayDoc.screens[s] = inc(batch.screens[s]); }
    for (var e in batch.events)  { userDoc.events[e]  = inc(batch.events[e]);  dayDoc.events[e]  = inc(batch.events[e]); }
    if (newSession) {
      userDoc.sessions = inc(1);
      userDoc.ui = {};      userDoc.ui[UI] = inc(1);
      dayDoc.sessions = inc(1);
      dayDoc.ui = {};       dayDoc.ui[UI] = inc(1);
      dayDoc.devices = {};  dayDoc.devices[DEVICE] = inc(1);
    }

    try {
      var userRef = db.collection('analytics_users').doc(u.uid);
      if (newSession) {
        var snap = await userRef.get();
        if (!snap.exists) userDoc.firstSeen = now;
      }
      var wb = db.batch();
      wb.set(userRef, userDoc, { merge: true });
      wb.set(db.collection('analytics_daily').doc(dayDoc.date), dayDoc, { merge: true });
      await wb.commit();
      sessionUid = u.uid;
      failures = 0;
    } catch (err) {
      _restore(batch);
      if (++failures >= MAX_FAILURES) {
        disabled = true;
        console.warn('[Usage] disabled after repeated failures:', err && err.message);
      }
    } finally {
      flushing = false;
    }
  }

  /* app_admin/admins is only readable by the emails it lists, so a
     successful read is the admin check. */
  function isAdmin() {
    var f = _fb(), u = _authUser();
    if (!f || !u) return Promise.resolve(false);
    return f.firestore().collection('app_admin').doc('admins').get()
      .then(function (d) { return d.exists; })
      .catch(function () { return false; });
  }

  function _applyAdmin(show) {
    document.querySelectorAll('[data-admin-only]').forEach(function (el) {
      el.style.display = show ? '' : 'none';
    });
  }

  function _onAuth(u) {
    if (!u) { adminUid = null; _applyAdmin(false); return; }
    if (sessionUid && sessionUid !== u.uid) { pending = _empty(); lastScreen = null; }  // a different user signed in
    if (adminUid !== u.uid) {
      adminUid = u.uid;
      isAdmin().then(function (ok) { if (adminUid === u.uid) _applyAdmin(ok); });
    }
  }

  /* Firebase is loaded lazily by sync.js / fr-sync.js — hook in once it's up. */
  var hookTimer = setInterval(function () {
    var f = _fb();
    if (!f) return;
    clearInterval(hookTimer);
    try { f.auth().onAuthStateChanged(_onAuth); } catch (e) {}
  }, 1000);

  setTimeout(flush, FIRST_FLUSH_MS);
  setInterval(flush, FLUSH_MS);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flush();
  });

  window.FrUsage = { screen: screen, event: event, flush: flush, isAdmin: isAdmin };
})();
