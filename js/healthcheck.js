/* ============================================================
   healthcheck.js — Finance Health Checkup
   FinResolver · finresolver.in
   ============================================================ */

(function () {
  'use strict';

  var HC_CFG_PREFIX = 'fr_healthcheck_';
  var _hcStep = 1;
  var _hcData = _hcDefaultData();
  var _hcGoldPricePerGram = 0;

  function _hcDefaultData() {
    return { efSavings: 0, efUseGold: false, efGoldGrams: 0, efManualExpense: null, medicalCover: 1000000, termCover: 0 };
  }

  /* ── Per-user config persistence (mirrors js/dayplanner.js) ── */
  function _hcUid() {
    return (typeof fbAuth !== 'undefined' && fbAuth && fbAuth.currentUser)
      ? fbAuth.currentUser.uid
      : (typeof currentUser !== 'undefined' && currentUser && currentUser.uid ? currentUser.uid : 'guest');
  }

  function _hcCfgKey() { return HC_CFG_PREFIX + _hcUid(); }

  async function _hcLoadConfig() {
    var email = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.email : null;
    var data = null;

    var raw = localStorage.getItem(_hcCfgKey());
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
        var snap = await db.collection('users').doc(uid).collection('config').doc('healthcheck').get();
        if (snap.exists) {
          var cloudRaw = snap.data()._enc || JSON.stringify(snap.data());
          var cloudDec = await (typeof decryptFromStorage === 'function'
            ? decryptFromStorage(cloudRaw, email)
            : Promise.resolve(JSON.parse(cloudRaw)));
          if (cloudDec && typeof cloudDec === 'object') {
            data = cloudDec;
            localStorage.setItem(_hcCfgKey(), cloudRaw);
          }
        }
      } catch (e) { console.warn('[HealthCheck] Firestore load failed:', e.message); }
    }

    return data;
  }

  async function _hcSaveConfig() {
    var email = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.email : null;
    var enc = (typeof encryptForStorage === 'function')
      ? await encryptForStorage(_hcData, email)
      : JSON.stringify(_hcData);
    localStorage.setItem(_hcCfgKey(), enc);
    _hcSyncConfigToFirestore(enc);
  }

  var _hcSaveTimer = null;
  function _hcScheduleSave() {
    if (_hcSaveTimer) clearTimeout(_hcSaveTimer);
    _hcSaveTimer = setTimeout(_hcSaveConfig, 500);
  }

  function _hcSyncConfigToFirestore(encStr) {
    if (typeof db === 'undefined' || !db || typeof fbAuth === 'undefined' || !fbAuth || !fbAuth.currentUser) return;
    var uid = fbAuth.currentUser.uid;
    db.collection('users').doc(uid).collection('config').doc('healthcheck').set({ _enc: encStr })
      .catch(function (e) { console.warn('[HealthCheck] Firestore save failed:', e.message); });
  }

  /* ── Shared financial data ── */
  function _hcExpenseInfo() {
    return (typeof getAvgMonthlyExpenseData === 'function')
      ? getAvgMonthlyExpenseData()
      : { avgMonthlyExp: 0, monthsWithData: 0 };
  }

  function _hcTotalDebt() {
    return (typeof getTotalLoanOutstanding === 'function') ? getTotalLoanOutstanding() : 0;
  }

  function _hcGoldValue() {
    var grams = Number(_hcData.efGoldGrams) || 0;
    if (!grams || !_hcGoldPricePerGram) return 0;
    return grams * _hcGoldPricePerGram * 0.8; // 20% discount for volatility
  }

  function _hcFetchGoldPrice() {
    if (typeof fetchGoldPriceINR !== 'function') { hcRecalc(); return; }
    fetchGoldPriceINR()
      .then(function (res) { if (res && res.pricePerGram) _hcGoldPricePerGram = res.pricePerGram; })
      .catch(function () {})
      .then(hcRecalc);
  }

  /* ── Ratings ── */
  function _hcRatingClass(months) {
    if (months >= 6) return 'hc-dark-green';
    if (months >= 3) return 'hc-light-green';
    return 'hc-amber';
  }

  function _hcMedicalRatingClass(amt) {
    if (amt >= 1000000) return 'hc-dark-green';
    if (amt >= 500000) return 'hc-light-green';
    return 'hc-amber';
  }

  function _hcTermRatingClass(coverRatio) {
    if (coverRatio >= 1) return 'hc-dark-green';
    if (coverRatio >= 0.5) return 'hc-light-green';
    return 'hc-amber';
  }

  function _hcRatingLabel(cls) {
    return cls === 'hc-dark-green' ? 'Strong' : cls === 'hc-light-green' ? 'Building' : 'Needs Attention';
  }

  /* ── DOM helpers ── */
  function _hcFmt(n) {
    return typeof fmtL === 'function' ? fmtL(n) : ('₹' + Math.round(Number(n) || 0).toLocaleString('en-IN'));
  }

  function _hcSetText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function _hcSetBadge(id, cls) {
    var el = document.getElementById(id);
    if (!el) return;
    el.className = 'hc-badge ' + cls;
    el.textContent = _hcRatingLabel(cls);
  }

  function _hcSetTabDot(id, cls) {
    var el = document.getElementById(id);
    if (el) el.className = 'hc-tab-dot ' + cls;
  }

  function _hcReadAllInputs() {
    var sav       = document.getElementById('hcEfSavings');
    var gold      = document.getElementById('hcEfUseGold');
    var grams     = document.getElementById('hcEfGoldGrams');
    var manual    = document.getElementById('hcEfManualExpense');
    var cover     = document.getElementById('hcMedicalCover');
    var termCover = document.getElementById('hcTermCover');
    if (sav)       _hcData.efSavings       = Number(sav.value) || 0;
    if (gold)      _hcData.efUseGold       = gold.checked;
    if (grams)     _hcData.efGoldGrams     = Number(grams.value) || 0;
    if (manual)    _hcData.efManualExpense = manual.value === '' ? null : Number(manual.value);
    if (cover)     _hcData.medicalCover    = cover.value === '' ? 0 : Number(cover.value);
    if (termCover) _hcData.termCover       = termCover.value === '' ? 0 : Number(termCover.value);
  }

  /* ── Live recompute — called on every input change ── */
  function hcRecalc() {
    _hcReadAllInputs();
    _hcScheduleSave();

    var expenseInfo    = _hcExpenseInfo();
    var hasAutoExpense = expenseInfo.avgMonthlyExp > 0;

    var autoRow   = document.getElementById('hcExpenseAutoRow');
    var manualRow = document.getElementById('hcManualExpenseRow');
    if (autoRow)   autoRow.style.display   = hasAutoExpense ? '' : 'none';
    if (manualRow) manualRow.style.display = hasAutoExpense ? 'none' : '';
    _hcSetText('hcAutoExpenseValue', _hcFmt(expenseInfo.avgMonthlyExp));

    var monthlyExpense = hasAutoExpense ? expenseInfo.avgMonthlyExp : (Number(_hcData.efManualExpense) || 0);

    /* Step 1 — Emergency Fund */
    var goldValue = _hcGoldValue();
    var efTotal   = (Number(_hcData.efSavings) || 0) + (_hcData.efUseGold ? goldValue : 0);
    var months    = monthlyExpense > 0 ? efTotal / monthlyExpense : 0;

    var efRatingCls = _hcRatingClass(months);
    _hcSetText('hcEfTotalValue', _hcFmt(efTotal));
    _hcSetText('hcEfMonthsValue', months.toFixed(1));
    _hcSetBadge('hcEfBadge', efRatingCls);
    _hcSetTabDot('hcTabDot1', efRatingCls);

    var goldRow = document.getElementById('hcGoldGramsRow');
    if (goldRow) goldRow.style.display = _hcData.efUseGold ? '' : 'none';

    var goldPreview = document.getElementById('hcGoldPreview');
    if (goldPreview) {
      goldPreview.textContent = _hcGoldPricePerGram
        ? ('≈ ' + _hcFmt(goldValue) + ' after a 20% volatility discount (live price ' + _hcFmt(_hcGoldPricePerGram) + '/g)')
        : 'Fetching live gold price…';
    }

    var warnNote = document.getElementById('hcGoldWarningNote');
    if (warnNote) warnNote.style.display = (_hcData.efUseGold && Number(_hcData.efGoldGrams) > 0) ? '' : 'none';

    /* Step 2 — Medical Insurance */
    var medicalCover    = Number(_hcData.medicalCover) || 0;
    var medicalRatingCls = _hcMedicalRatingClass(medicalCover);
    _hcSetText('hcMedicalValue', _hcFmt(medicalCover));
    _hcSetBadge('hcMedicalBadge', medicalRatingCls);
    _hcSetTabDot('hcTabDot2', medicalRatingCls);

    /* Step 3 — Term Insurance: 10x annual expense + outstanding debt */
    var annualExpense = monthlyExpense * 12;
    var debt          = _hcTotalDebt();
    var expensePart    = annualExpense * 0.5 * 20;
    var suggestedTerm  = expensePart + debt;
    _hcSetText('hcTermExpensePart', _hcFmt(expensePart));
    _hcSetText('hcTermDebtPart', _hcFmt(debt));
    _hcSetText('hcTermTotalValue', _hcFmt(suggestedTerm));

    var termCover    = Number(_hcData.termCover) || 0;
    var coverRatio   = suggestedTerm > 0 ? termCover / suggestedTerm : 0;
    var termRatingCls = _hcTermRatingClass(coverRatio);
    _hcSetText('hcTermCoverPct', Math.round(coverRatio * 100) + '%');
    _hcSetBadge('hcTermBadge', termRatingCls);
    _hcSetTabDot('hcTabDot3', termRatingCls);
  }

  /* ── Step navigation ── */
  function _hcApplyStepUI(n) {
    var steps = document.querySelectorAll('.hc-step');
    for (var i = 0; i < steps.length; i++) {
      steps[i].classList.toggle('hc-step-hidden', steps[i].id !== 'hcStep' + n);
    }
    var dots = document.querySelectorAll('.hc-progress-step');
    for (var j = 0; j < dots.length; j++) {
      var stepNum = Number(dots[j].getAttribute('data-step'));
      dots[j].classList.toggle('active', stepNum === n);
      dots[j].classList.toggle('done', stepNum < n);
    }
    var backBtn = document.getElementById('hcBackBtn');
    var nextBtn = document.getElementById('hcNextBtn');
    if (backBtn) backBtn.style.display = n > 1 ? '' : 'none';
    if (nextBtn) nextBtn.textContent = n < 3 ? 'Next →' : 'Done';
  }

  function hcGoToStep(n) {
    _hcSaveConfig();
    _hcStep = n;
    _hcApplyStepUI(n);
  }

  function hcNextStep() {
    if (_hcStep < 3) { hcGoToStep(_hcStep + 1); return; }
    _hcSaveConfig();
    closeHealthCheck();
  }

  function hcPrevStep() {
    if (_hcStep > 1) hcGoToStep(_hcStep - 1);
  }

  /* ── Modal open/close ── */
  async function openHealthCheck() {
    var loaded = await _hcLoadConfig();
    _hcData = loaded ? Object.assign(_hcDefaultData(), loaded) : _hcDefaultData();

    var efSavings = document.getElementById('hcEfSavings');
    var efGold    = document.getElementById('hcEfUseGold');
    var efGrams   = document.getElementById('hcEfGoldGrams');
    var efManual  = document.getElementById('hcEfManualExpense');
    var medical   = document.getElementById('hcMedicalCover');
    var termCover = document.getElementById('hcTermCover');
    if (efSavings) efSavings.value = _hcData.efSavings || '';
    if (efGold)    efGold.checked  = !!_hcData.efUseGold;
    if (efGrams)   efGrams.value   = _hcData.efGoldGrams || '';
    if (efManual)  efManual.value  = _hcData.efManualExpense != null ? _hcData.efManualExpense : '';
    if (medical)   medical.value   = _hcData.medicalCover;
    if (termCover) termCover.value = _hcData.termCover || '';

    var modal = document.getElementById('healthCheckModal');
    if (modal) modal.classList.remove('hidden');

    _hcStep = 1;
    _hcApplyStepUI(1);
    hcRecalc();
    _hcFetchGoldPrice();
  }

  function closeHealthCheck() {
    if (_hcSaveTimer) { clearTimeout(_hcSaveTimer); _hcSaveTimer = null; }
    _hcSaveConfig();
    var modal = document.getElementById('healthCheckModal');
    if (modal) modal.classList.add('hidden');
  }

  window.openHealthCheck  = openHealthCheck;
  window.closeHealthCheck = closeHealthCheck;
  window.hcRecalc         = hcRecalc;
  window.hcGoToStep       = hcGoToStep;
  window.hcNextStep       = hcNextStep;
  window.hcPrevStep       = hcPrevStep;
})();
