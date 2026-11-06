/* ============================================================
   pro.js — Free / Pro tier management + Razorpay checkout
   FinResolver · finresolver.in
   ============================================================ */

(function () {
  'use strict';

  const FEATURE_LABELS = {
    advisor: 'FINOVA',
  };

  window.ProManager = {
    _status:    null,
    _uid:       null,
    _granted:   false,  // admin grant — see loadGrant()
    _grantLoad: null,   // in-flight grant read, see ready()

    /* ── Init (call with Firebase uid after login) ─────────── */
    init(uid) {
      if (this._uid !== uid) { this._status = null; this._granted = false; }
      this._uid = uid;
      try {
        const cached = localStorage.getItem('fr_pro_' + uid);
        if (cached) this._status = JSON.parse(cached);
        this._granted = localStorage.getItem('fr_pro_grant_' + uid) === '1';
      } catch (e) { /* ignore parse errors */ }
      this._refreshProUI();
    },

    /* ── Called from sync.js after Firestore subscription doc loads ── */
    setStatus(status) {
      this._status = status;
      if (this._uid && status) {
        localStorage.setItem('fr_pro_' + this._uid, JSON.stringify(status));
      }
      this._refreshProUI();
    },

    /* ── Admin grants ──────────────────────────────────────── */
    /* An admin adds a user from admin.html, which writes pro_users/{email}
       (lowercased). The doc existing is the grant; deleting it revokes Pro.
       Called by sync.js / fr-sync.js once Firebase auth is ready. The result
       is cached so the next page load knows before this read finishes; if the
       read fails the last known state stands. */
    loadGrant() {
      let user = null;
      try { user = firebase.auth().currentUser; } catch (e) { /* not loaded */ }
      if (!user || !user.email) return Promise.resolve();
      if (this._uid !== user.uid) this.init(user.uid);
      const uid = user.uid;
      this._grantLoad = firebase.firestore().collection('pro_users').doc(user.email.toLowerCase()).get()
        .then(snap => {
          if (this._uid !== uid) return;  // signed out meanwhile
          this._granted = snap.exists;
          if (snap.exists) localStorage.setItem('fr_pro_grant_' + uid, '1');
          else localStorage.removeItem('fr_pro_grant_' + uid);
          this._refreshProUI();
        })
        .catch(e => console.warn('[Pro] Grant load failed:', e.message));
      return this._grantLoad;
    },

    /* Resolves once any in-flight grant read has settled, so a FINOVA call
       made right after sign-in is routed on the real answer. */
    ready() { return this._grantLoad || Promise.resolve(); },

    /* ── Core check ────────────────────────────────────────── */
    isPro() {
      if (this._granted) return true;
      if (!this._status || !this._status.active) return false;
      if (this._status.expiresAt && new Date(this._status.expiresAt) < new Date()) return false;
      return true;
    },

    /* ── Gate helper for onclick handlers ──────────────────── */
    checkAndDo(featureKey, fn) {
      if (this.isPro()) {
        fn();
      } else {
        this.showUpgradeModal(FEATURE_LABELS[featureKey] || featureKey);
      }
    },

    /* ── Imperative check (returns bool) ────────────────────── */
    requirePro(featureKey) {
      if (this.isPro()) return true;
      this.showUpgradeModal(FEATURE_LABELS[featureKey] || featureKey);
      return false;
    },

    /* ── Modals ─────────────────────────────────────────────── */
    showUpgradeModal(featureName) {
      const nameEl = document.getElementById('proGateFeatureName');
      if (nameEl && featureName) nameEl.textContent = featureName;
      _showEl('proGateModal');
    },

    hideUpgradeModal() { _hideEl('proGateModal'); },

    /* ── DEV ONLY: bypass payment and activate Pro locally ─── */
    devActivatePro() {
      const exp = new Date();
      exp.setFullYear(exp.getFullYear() + 1);
      this.setStatus({
        active:      true,
        plan:        'pro_annual_earlybird',
        paymentId:   'dev_bypass',
        activatedAt: new Date().toISOString(),
        expiresAt:   exp.toISOString(),
        _devBypass:  true,
      });
      console.info('[Pro] Dev bypass: Pro activated until', exp.toDateString());
    },

    /* ── Razorpay checkout ──────────────────────────────────── */
    async initiatePayment() {
      const key = (window.FINRESOLVER_CONFIG || {}).razorpayKey || '';
      if (!key || key === 'YOUR_RAZORPAY_KEY_ID') {
        alert('Payments are not configured yet. Please contact support.');
        return;
      }
      this.hideUpgradeModal();

      if (typeof Razorpay === 'undefined') {
        alert('Payment library failed to load. Check your internet connection and try again.');
        return;
      }

      const user = window.currentUser || {};
      const rzp  = new Razorpay({
        key,
        amount:      9900,
        currency:    'INR',
        name:        'FinResolver',
        description: 'Pro Annual Subscription (Early Bird)',
        image:       'finresolver.png',
        prefill:     { email: user.email || '', name: user.name || '' },
        theme:       { color: '#00e5a0' },
        handler:     (resp) => this._onPaymentSuccess(resp),
        modal:       { ondismiss: () => {} },
      });
      rzp.on('payment.failed', (r) => {
        this._showFail('Payment failed — ' + (r.error?.description || 'Please try again.'));
      });
      rzp.open();
    },

    /* ── Payment success callback ───────────────────────────── */
    async _onPaymentSuccess(response) {
      _showEl('proActivatingOverlay');
      try {
        // Try Firebase Callable Function first (server-side verification)
        if (typeof firebase !== 'undefined' && typeof firebase.app === 'function') {
          try {
            const fn  = firebase.app().functions().httpsCallable('verifyRazorpayPayment');
            const res = await fn({ payment_id: response.razorpay_payment_id });
            if (res.data && res.data.success) {
              this.setStatus(res.data.subscription);
              _hideEl('proActivatingOverlay');
              _showEl('proSuccessModal');
              return;
            }
          } catch (fnErr) {
            console.warn('[Pro] Cloud Function unavailable, falling back to local activation:', fnErr.message);
          }
        }
        // Fallback: activate locally (unverified — acceptable for personal use)
        const exp = new Date();
        exp.setFullYear(exp.getFullYear() + 1);
        this.setStatus({
          active:       true,
          plan:         'pro_annual_earlybird',
          paymentId:    response.razorpay_payment_id,
          activatedAt:  new Date().toISOString(),
          expiresAt:    exp.toISOString(),
          _localActivation: true,
        });
        _hideEl('proActivatingOverlay');
        _showEl('proSuccessModal');
      } catch (err) {
        console.error('[Pro] Activation error:', err);
        _hideEl('proActivatingOverlay');
        this._showFail(
          'Activation error. Your payment ID: ' + response.razorpay_payment_id +
          '. Please contact support with this ID.'
        );
      }
    },

    _showFail(msg) {
      const el = document.getElementById('proFailMessage');
      if (el) el.textContent = msg;
      _showEl('proFailModal');
    },

    /* ── Update UI lock state ───────────────────────────────── */
    _refreshProUI() {
      const pro = this.isPro();
      // Lock badges: visible for free users, hidden for pro
      document.querySelectorAll('.pro-lock-badge').forEach(el => {
        el.style.display = pro ? 'none' : '';
      });
      document.querySelectorAll('.nav-pro-badge').forEach(el => {
        el.style.display = pro ? 'none' : '';
      });
      document.querySelectorAll('.home-nav-card.pro-gated').forEach(el => {
        el.classList.toggle('pro-locked-card', !pro);
      });
      // Pro crown in header
      const crown = document.getElementById('proBadgeHeader');
      if (crown) crown.style.display = pro ? 'inline-flex' : 'none';
    },

    /* ── Reset on logout ────────────────────────────────────── */
    reset() {
      if (this._uid) {
        localStorage.removeItem('fr_pro_' + this._uid);
        localStorage.removeItem('fr_pro_grant_' + this._uid);
      }
      this._status    = null;
      this._uid       = null;
      this._granted   = false;
      this._grantLoad = null;
      this._refreshProUI();
    },
  };

  /* ── Helpers ─────────────────────────────────────────────── */
  function _showEl(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('hidden');
  }
  function _hideEl(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  }
})();
