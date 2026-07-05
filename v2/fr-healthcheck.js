// ── FINANCE HEALTH CHECKUP ───────────────────────────────────────────────────
// Emergency Fund / Medical Insurance / Term Insurance quick assessment.
// Config persists per-user via Firestore, same path as the classic v1 UI
// (users/{uid}/config/healthcheck), so answers sync between Classic and Modern.

const HC_CFG_PREFIX = 'fr_healthcheck_';
let _hcStep = 1;
let _hcData = _hcDefaultData();
let _hcGoldPricePerGram = 0;

function _hcDefaultData() {
  return { efSavings: 0, efUseGold: false, efGoldGrams: 0, efManualExpense: null, medicalCover: 1000000, termCover: 0 };
}

/* ── Per-user config persistence (mirrors _loadLifestyleConfig/saveLifestyleConfig in fr-sync.js) ── */
async function _hcLoadConfig() {
  const localKey = `${HC_CFG_PREFIX}${_currentUID}`;
  let data = null;
  const localRaw = localStorage.getItem(localKey);
  if (localRaw) {
    const d = await decryptFromStorage(localRaw, _currentEmail);
    if (d && typeof d === 'object') data = d;
  }
  if (_syncReady && _db) {
    try {
      const snap = await _db.collection('users').doc(_currentUID)
        .collection('config').doc('healthcheck').get();
      if (snap.exists) {
        const raw = snap.data()._enc || JSON.stringify(snap.data());
        const d   = await decryptFromStorage(raw, _currentEmail);
        if (d && typeof d === 'object') { data = d; localStorage.setItem(localKey, raw); }
      }
    } catch (e) { console.warn('[HealthCheck] load failed:', e); }
  }
  return data;
}

async function _hcSaveConfig() {
  if (!_currentUID) return;
  const encStr = await encryptForStorage(_hcData, _currentEmail);
  localStorage.setItem(`${HC_CFG_PREFIX}${_currentUID}`, encStr);
  if (_syncReady && _db) {
    try {
      await _db.collection('users').doc(_currentUID)
        .collection('config').doc('healthcheck').set({ _enc: encStr });
    } catch (e) { console.warn('[HealthCheck] save failed:', e); }
  }
}

let _hcSaveTimer = null;
function _hcScheduleSave() {
  if (_hcSaveTimer) clearTimeout(_hcSaveTimer);
  _hcSaveTimer = setTimeout(_hcSaveConfig, 500);
}

/* ── Shared financial data ── */
function _hcExpenseInfo() {
  const avgMonthlyExp = APP.history.length
    ? APP.history.reduce((a, h) => a + h.expenses, 0) / APP.history.length
    : (getMonthlyTotals().expenses || 0);
  return { avgMonthlyExp };
}

function _hcTotalDebt() {
  return APP.loans.reduce((a, l) => a + loanOutstanding(l), 0);
}

function _hcGoldValue() {
  const grams = Number(_hcData.efGoldGrams) || 0;
  if (!grams || !_hcGoldPricePerGram) return 0;
  return grams * _hcGoldPricePerGram * 0.8; // 20% discount for volatility
}

function _hcFetchGoldPrice() {
  if (typeof _fetchGoldINR !== 'function') { hcRecalc(); return; }
  _fetchGoldINR()
    .then(p => { if (p) _hcGoldPricePerGram = p; })
    .catch(() => {})
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
  return fmt(Math.round(Number(n) || 0));
}

function _hcSetText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function _hcSetBadge(id, cls) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = 'hc-badge ' + cls;
  el.textContent = _hcRatingLabel(cls);
}

function _hcSetTabDot(id, cls) {
  const el = document.getElementById(id);
  if (el) el.className = 'hc-tab-dot ' + cls;
}

function _hcReadAllInputs() {
  const sav       = document.getElementById('hcEfSavings');
  const gold      = document.getElementById('hcEfUseGold');
  const grams     = document.getElementById('hcEfGoldGrams');
  const manual    = document.getElementById('hcEfManualExpense');
  const cover     = document.getElementById('hcMedicalCover');
  const termCover = document.getElementById('hcTermCover');
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

  const expenseInfo    = _hcExpenseInfo();
  const hasAutoExpense = expenseInfo.avgMonthlyExp > 0;

  const autoRow   = document.getElementById('hcExpenseAutoRow');
  const manualRow = document.getElementById('hcManualExpenseRow');
  if (autoRow)   autoRow.style.display   = hasAutoExpense ? '' : 'none';
  if (manualRow) manualRow.style.display = hasAutoExpense ? 'none' : '';
  _hcSetText('hcAutoExpenseValue', _hcFmt(expenseInfo.avgMonthlyExp));

  const monthlyExpense = hasAutoExpense ? expenseInfo.avgMonthlyExp : (Number(_hcData.efManualExpense) || 0);

  /* Step 1 — Emergency Fund */
  const goldValue = _hcGoldValue();
  const efTotal   = (Number(_hcData.efSavings) || 0) + (_hcData.efUseGold ? goldValue : 0);
  const months    = monthlyExpense > 0 ? efTotal / monthlyExpense : 0;

  const efRatingCls = _hcRatingClass(months);
  _hcSetText('hcEfTotalValue', _hcFmt(efTotal));
  _hcSetText('hcEfMonthsValue', months.toFixed(1));
  _hcSetBadge('hcEfBadge', efRatingCls);
  _hcSetTabDot('hcTabDot1', efRatingCls);

  const goldRow = document.getElementById('hcGoldGramsRow');
  if (goldRow) goldRow.style.display = _hcData.efUseGold ? '' : 'none';

  const goldPreview = document.getElementById('hcGoldPreview');
  if (goldPreview) {
    goldPreview.textContent = _hcGoldPricePerGram
      ? `≈ ${_hcFmt(goldValue)} after a 20% volatility discount (live price ${_hcFmt(_hcGoldPricePerGram)}/g)`
      : 'Fetching live gold price…';
  }

  const warnNote = document.getElementById('hcGoldWarningNote');
  if (warnNote) warnNote.style.display = (_hcData.efUseGold && Number(_hcData.efGoldGrams) > 0) ? '' : 'none';

  /* Step 2 — Medical Insurance */
  const medicalCover     = Number(_hcData.medicalCover) || 0;
  const medicalRatingCls = _hcMedicalRatingClass(medicalCover);
  _hcSetText('hcMedicalValue', _hcFmt(medicalCover));
  _hcSetBadge('hcMedicalBadge', medicalRatingCls);
  _hcSetTabDot('hcTabDot2', medicalRatingCls);

  /* Step 3 — Term Insurance: 10x annual expense + outstanding debt */
  const annualExpense  = monthlyExpense * 12;
  const debt           = _hcTotalDebt();
  const expensePart    = annualExpense * 0.5 * 20;
  const suggestedTerm  = expensePart + debt;
  _hcSetText('hcTermExpensePart', _hcFmt(expensePart));
  _hcSetText('hcTermDebtPart', _hcFmt(debt));
  _hcSetText('hcTermTotalValue', _hcFmt(suggestedTerm));

  const termCover     = Number(_hcData.termCover) || 0;
  const coverRatio    = suggestedTerm > 0 ? termCover / suggestedTerm : 0;
  const termRatingCls = _hcTermRatingClass(coverRatio);
  _hcSetText('hcTermCoverPct', Math.round(coverRatio * 100) + '%');
  _hcSetBadge('hcTermBadge', termRatingCls);
  _hcSetTabDot('hcTabDot3', termRatingCls);
}

/* ── Step navigation ── */
function _hcApplyStepUI(n) {
  document.querySelectorAll('.hc-step').forEach(el => {
    el.classList.toggle('hc-step-hidden', el.id !== 'hcStep' + n);
  });
  document.querySelectorAll('.hc-progress-step').forEach(el => {
    const stepNum = Number(el.getAttribute('data-step'));
    el.classList.toggle('active', stepNum === n);
    el.classList.toggle('done', stepNum < n);
  });
  const backBtn = document.getElementById('hcBackBtn');
  const nextBtn = document.getElementById('hcNextBtn');
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
  closeModal();
}

function hcPrevStep() {
  if (_hcStep > 1) hcGoToStep(_hcStep - 1);
}

function hcCloseModal() {
  if (_hcSaveTimer) { clearTimeout(_hcSaveTimer); _hcSaveTimer = null; }
  _hcSaveConfig();
  closeModal();
}

/* ── Modal markup + open ── */
function _hcModalHtml() {
  return `
    <div class="modal-hd">
      <div class="modal-title">🩺 Finance Health Checkup</div>
      <button class="modal-close" onclick="hcCloseModal()">${ic('x', 13)}</button>
    </div>

    <div class="hc-progress">
      <div class="hc-progress-step" data-step="1" onclick="hcGoToStep(1)"><span class="hc-progress-num">1</span><span>Emergency Fund</span><span class="hc-tab-dot" id="hcTabDot1"></span></div>
      <div class="hc-progress-step" data-step="2" onclick="hcGoToStep(2)"><span class="hc-progress-num">2</span><span>Medical Insurance</span><span class="hc-tab-dot" id="hcTabDot2"></span></div>
      <div class="hc-progress-step" data-step="3" onclick="hcGoToStep(3)"><span class="hc-progress-num">3</span><span>Term Insurance</span><span class="hc-tab-dot" id="hcTabDot3"></span></div>
    </div>

    <div class="modal-body">

      <!-- STEP 1: Emergency Fund -->
      <div class="hc-step" id="hcStep1">
        <div class="hc-desc">We suggest keeping <b>3–6 months</b> of expenses as a liquid Emergency Fund.</div>

        <div class="hc-expense-row" id="hcExpenseAutoRow">
          <span>Your average monthly expense (last 3 months)</span>
          <span class="hc-expense-value" id="hcAutoExpenseValue">₹0</span>
        </div>

        <div class="inp-grp" id="hcManualExpenseRow" style="display:none">
          <div class="inp-label">We don't have enough expense history yet — enter your average monthly expense</div>
          <input class="inp" id="hcEfManualExpense" type="number" placeholder="e.g. 50000" oninput="hcRecalc()" value="${_hcData.efManualExpense != null ? _hcData.efManualExpense : ''}" />
        </div>

        <div class="inp-grp">
          <div class="inp-label">Current Emergency Fund savings (₹)</div>
          <input class="inp" id="hcEfSavings" type="number" placeholder="0" oninput="hcRecalc()" value="${_hcData.efSavings || ''}" />
        </div>

        <div class="inp-grp">
          <label class="hc-checkbox-label">
            <input type="checkbox" id="hcEfUseGold" onchange="hcRecalc()" ${_hcData.efUseGold ? 'checked' : ''} />
            Also count physical gold towards my Emergency Fund
          </label>
        </div>

        <div class="inp-grp" id="hcGoldGramsRow" style="display:none">
          <div class="inp-label">Gold quantity (grams)</div>
          <input class="inp" id="hcEfGoldGrams" type="number" placeholder="0" oninput="hcRecalc()" value="${_hcData.efGoldGrams || ''}" />
          <div class="hc-gold-note" id="hcGoldPreview"></div>
        </div>

        <div class="hc-result-card">
          <div class="hc-result-row"><span>Total Emergency Fund</span><span class="hc-result-value" id="hcEfTotalValue">₹0</span></div>
          <div class="hc-result-row"><span>Months of expenses covered</span><span class="hc-result-value" id="hcEfMonthsValue">0.0</span></div>
          <span class="hc-badge hc-amber" id="hcEfBadge">Needs Attention</span>
        </div>

        <div class="hc-note-box" id="hcGoldWarningNote" style="display:none">
          ⚠️ Gold counted towards your Emergency Fund shouldn't also be counted as part of your Investment portfolio — that would double-count it.
        </div>
      </div>

      <!-- STEP 2: Medical Insurance -->
      <div class="hc-step hc-step-hidden" id="hcStep2">
        <div class="hc-desc">A health cover of at least <b>₹10,00,000</b> is recommended against rising medical costs.</div>

        <div class="inp-grp">
          <div class="inp-label">Your current Medical Insurance cover (₹)</div>
          <input class="inp" id="hcMedicalCover" type="number" oninput="hcRecalc()" value="${_hcData.medicalCover}" />
        </div>

        <div class="hc-result-card">
          <div class="hc-result-row"><span>Coverage</span><span class="hc-result-value" id="hcMedicalValue">₹0</span></div>
          <span class="hc-badge hc-amber" id="hcMedicalBadge">Needs Attention</span>
        </div>
      </div>

      <!-- STEP 3: Term Insurance -->
      <div class="hc-step hc-step-hidden" id="hcStep3">
        <div class="hc-desc">Suggested term cover ≈ 10× your annual expenses, plus any outstanding debt.</div>

        <div class="hc-result-card">
          <div class="hc-result-row"><span>10× annual expense</span><span class="hc-result-value" id="hcTermExpensePart">₹0</span></div>
          <div class="hc-result-row"><span>Outstanding debt</span><span class="hc-result-value" id="hcTermDebtPart">₹0</span></div>
          <div class="hc-result-row hc-result-total"><span>Suggested Term Cover</span><span class="hc-result-value" id="hcTermTotalValue">₹0</span></div>
        </div>

        <div class="inp-grp">
          <div class="inp-label">Your current Term Insurance cover (₹) — enter 0 if you don't have one</div>
          <input class="inp" id="hcTermCover" type="number" placeholder="0" oninput="hcRecalc()" value="${_hcData.termCover || ''}" />
        </div>

        <div class="hc-result-card">
          <div class="hc-result-row"><span>Your cover vs suggested</span><span class="hc-result-value" id="hcTermCoverPct">0%</span></div>
          <span class="hc-badge hc-amber" id="hcTermBadge">Needs Attention</span>
        </div>
      </div>

    </div>

    <div class="modal-ft">
      <button class="btn btn-ghost" id="hcBackBtn" onclick="hcPrevStep()" style="display:none">← Back</button>
      <button class="btn btn-primary" id="hcNextBtn" onclick="hcNextStep()">Next →</button>
    </div>`;
}

async function openHealthCheckV2() {
  const loaded = await _hcLoadConfig();
  _hcData = loaded ? Object.assign(_hcDefaultData(), loaded) : _hcDefaultData();
  _hcStep = 1;

  openModal(_hcModalHtml());
  _hcApplyStepUI(1);
  hcRecalc();
  _hcFetchGoldPrice();
}
