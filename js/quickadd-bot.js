/* ============================================================
   quickadd-bot.js — "FinBolt" shared Quick Add floating widget core
   FinResolver · finresolver.in

   Framework-free, app-agnostic. Never touches `data`, `APP`,
   `loansData` or any other host global directly — everything an
   app needs to supply comes through QuickAddBot.init({ getLoans,
   onSubmit, fabIcon }). Styling is done entirely via the qab-*
   class names below; each host provides its own stylesheet for them.
   ============================================================ */

window.QuickAddBot = (function () {
  'use strict';

  var opts    = null;
  var els     = {};
  var state   = { screen: 'select', type: null, undo: null, justDragged: false };
  var visible = false; // show()/hide() may be called before build() runs

  var SIDE_KEY = 'fr_qab_side';
  var DRAG_THRESHOLD = 6; // px of horizontal movement before a press counts as a drag, not a tap

  var TYPES = {
    expense:    { label: 'Add Expense',       icon: '💸' },
    income:     { label: 'Add Income',        icon: '💰' },
    investment: { label: 'Add Investment',    icon: '📈' },
    loan:       { label: 'Add Loan Payment',  icon: '🏦' },
  };

  /* ── helpers ─────────────────────────────────────────────── */

  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtCurrency(n) {
    return '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }

  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function safeGetLoans() {
    try {
      var loans = opts && typeof opts.getLoans === 'function' ? opts.getLoans() : [];
      return Array.isArray(loans) ? loans : [];
    } catch (e) {
      return [];
    }
  }

  /* ── DOM construction ───────────────────────────────────────── */

  function build() {
    var fabInner = opts.fabIcon
      ? '<img class="qab-fab-icon-img" src="' + escHtml(opts.fabIcon) + '" alt="FinBolt" draggable="false" />'
      : '<span class="qab-fab-icon">+</span>';

    els.root = document.createElement('div');
    els.root.className = 'qab-root';
    els.root.innerHTML =
      '<button type="button" class="qab-fab" aria-label="Open FinBolt" aria-expanded="false">' +
        fabInner +
      '</button>' +
      '<div class="qab-panel qab-hidden" role="dialog" aria-label="FinBolt">' +
        '<div class="qab-panel-header">' +
          '<button type="button" class="qab-back qab-hidden" aria-label="Back">←</button>' +
          '<div class="qab-header-text">' +
            '<span class="qab-title">FinBolt</span>' +
            '<span class="qab-subtitle">Quick add to your Monthly Tracker</span>' +
          '</div>' +
          '<button type="button" class="qab-close" aria-label="Close">×</button>' +
        '</div>' +
        '<div class="qab-panel-body"></div>' +
      '</div>';
    els.root.classList.add('qab-hidden');
    document.body.appendChild(els.root);

    els.fab   = els.root.querySelector('.qab-fab');
    els.panel = els.root.querySelector('.qab-panel');
    els.back  = els.root.querySelector('.qab-back');
    els.close = els.root.querySelector('.qab-close');
    els.title = els.root.querySelector('.qab-title');
    els.body  = els.root.querySelector('.qab-panel-body');

    els.fab.addEventListener('click', function () {
      // A drag-and-release that just finished fires a click right after —
      // swallow that one so dragging doesn't also pop the panel open.
      if (state.justDragged) { state.justDragged = false; return; }
      togglePanel();
    });
    els.close.addEventListener('click', closePanel);
    els.back.addEventListener('click', goToSelect);

    applySide(loadSide());
    initDrag();

    var fabImg = els.root.querySelector('.qab-fab-icon-img');
    if (fabImg) {
      fabImg.addEventListener('error', function () {
        fabImg.outerHTML = '<span class="qab-fab-icon">+</span>';
      });
    }

    // Close when clicking outside the widget. Uses composedPath() rather than
    // els.root.contains(e.target) because a click inside the panel (e.g. a
    // type-select button) can replace els.body's innerHTML — via goToForm()
    // — before this listener runs, detaching the original target from the
    // document and making a plain .contains() check wrongly report "outside".
    document.addEventListener('click', function (e) {
      if (els.panel.classList.contains('qab-hidden')) return;
      var path = typeof e.composedPath === 'function' ? e.composedPath() : [];
      if (path.indexOf(els.root) !== -1) return;
      closePanel();
    });
  }

  /* ── panel open/close ────────────────────────────────────────── */

  function openPanel() {
    els.panel.classList.remove('qab-hidden');
    els.fab.setAttribute('aria-expanded', 'true');
    goToSelect();
  }

  function closePanel() {
    els.panel.classList.add('qab-hidden');
    els.fab.setAttribute('aria-expanded', 'false');
  }

  function togglePanel() {
    if (els.panel.classList.contains('qab-hidden')) openPanel();
    else closePanel();
  }

  /* ── horizontal drag-to-reposition ───────────────────────────────
     FinBolt can cover content on narrow screens (bottom nav, other
     FABs). Dragging it sideways snaps it to whichever bottom corner
     — left or right — it's released closer to; the vertical position
     always stays pinned to the bottom via CSS. The choice persists
     across sessions via localStorage. */

  function loadSide() {
    try { return localStorage.getItem(SIDE_KEY) === 'left' ? 'left' : 'right'; }
    catch (e) { return 'right'; }
  }

  function saveSide(side) {
    try { localStorage.setItem(SIDE_KEY, side); } catch (e) {}
  }

  function applySide(side) {
    els.fab.classList.toggle('qab-side-left', side === 'left');
    els.panel.classList.toggle('qab-side-left', side === 'left');
  }

  function initDrag() {
    var drag = null;

    els.fab.addEventListener('pointerdown', function (e) {
      if (e.isPrimary === false) return;
      state.justDragged = false; // guard against a browser skipping the post-drag click
      var rect = els.fab.getBoundingClientRect();
      drag = { pointerId: e.pointerId, startX: e.clientX, startLeft: rect.left, width: rect.width, dragging: false };
    });

    els.fab.addEventListener('pointermove', function (e) {
      if (!drag || drag.pointerId !== e.pointerId) return;
      var dx = e.clientX - drag.startX;
      if (!drag.dragging) {
        if (Math.abs(dx) < DRAG_THRESHOLD) return;
        drag.dragging = true;
        try { els.fab.setPointerCapture(drag.pointerId); } catch (err) {}
        els.fab.classList.add('qab-dragging');
        closePanel();
      }
      var maxLeft = window.innerWidth - drag.width - 4;
      var newLeft = Math.min(maxLeft, Math.max(4, drag.startLeft + dx));
      els.fab.style.left  = newLeft + 'px';
      els.fab.style.right = 'auto';
    });

    function endDrag(e) {
      if (!drag || drag.pointerId !== e.pointerId) return;
      if (drag.dragging) {
        var center = els.fab.getBoundingClientRect().left + drag.width / 2;
        var side   = center < window.innerWidth / 2 ? 'left' : 'right';
        els.fab.classList.remove('qab-dragging');
        els.fab.style.left  = '';
        els.fab.style.right = '';
        applySide(side);
        saveSide(side);
        state.justDragged = true;
      }
      drag = null;
    }

    els.fab.addEventListener('pointerup', endDrag);
    els.fab.addEventListener('pointercancel', endDrag);
  }

  /* ── screen: type select ─────────────────────────────────────── */

  function goToSelect() {
    state.screen = 'select';
    state.type   = null;
    state.undo   = null;
    els.back.classList.add('qab-hidden');
    els.title.textContent = 'FinBolt';
    renderSelectScreen();
  }

  function renderSelectScreen() {
    var html = '<div class="qab-select-grid">';
    Object.keys(TYPES).forEach(function (type) {
      var t = TYPES[type];
      html +=
        '<button type="button" class="qab-btn qab-type-btn" data-type="' + type + '">' +
          '<span class="qab-btn-icon">' + t.icon + '</span>' +
          '<span class="qab-btn-label">' + t.label + '</span>' +
        '</button>';
    });
    html += '</div>';
    els.body.innerHTML = html;

    Array.prototype.forEach.call(els.body.querySelectorAll('.qab-type-btn'), function (btn) {
      btn.addEventListener('click', function () { goToForm(btn.getAttribute('data-type')); });
    });
  }

  /* ── screen: form ─────────────────────────────────────────────── */

  function goToForm(type) {
    state.screen = 'form';
    state.type   = type;
    els.back.classList.remove('qab-hidden');
    els.title.textContent = TYPES[type].label;
    renderFormScreen(type);
  }

  function fieldHtml(name, type, label, placeholder, value) {
    return (
      '<div class="qab-field" data-field="' + name + '">' +
        '<label class="qab-field-label">' + label + '</label>' +
        '<input class="qab-input" type="' + type + '" name="' + name + '"' +
          (placeholder ? ' placeholder="' + escHtml(placeholder) + '"' : '') +
          (value ? ' value="' + escHtml(value) + '"' : '') +
        ' />' +
        '<div class="qab-error"></div>' +
      '</div>'
    );
  }

  function renderFormScreen(type) {
    var html = '<form class="qab-form" novalidate>';

    html += fieldHtml('desc', 'text', 'Description', 'e.g. Grocery run');
    html += fieldHtml('amount', 'number', 'Amount (₹)', '0');
    html += fieldHtml('date', 'date', 'Date', '', todayISO());

    if (type === 'loan') {
      var loans = safeGetLoans();
      html +=
        '<div class="qab-field" data-field="loanId">' +
          '<label class="qab-field-label">Linked Loan</label>' +
          '<select class="qab-input qab-select" name="loanId">' +
            '<option value="">Select a loan…</option>' +
            loans.map(function (l) {
              return '<option value="' + escHtml(l.id) + '">' + escHtml(l.name) + '</option>';
            }).join('') +
          '</select>' +
          '<div class="qab-error"></div>' +
        '</div>';
    }

    html += '<button type="submit" class="qab-submit-btn">Add</button>';
    html += '</form>';
    els.body.innerHTML = html;

    var form = els.body.querySelector('.qab-form');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      handleSubmit(type, form);
    });
    Array.prototype.forEach.call(form.querySelectorAll('.qab-input'), function (inp) {
      var clear = function () { clearError(form, inp.name); };
      inp.addEventListener('input', clear);
      inp.addEventListener('change', clear);
    });
  }

  function clearError(form, name) {
    var wrap = form.querySelector('[data-field="' + name + '"]');
    if (!wrap) return;
    var err = wrap.querySelector('.qab-error');
    if (err) err.textContent = '';
    wrap.classList.remove('qab-field-invalid');
  }

  function setError(form, name, msg) {
    var wrap = form.querySelector('[data-field="' + name + '"]');
    if (!wrap) return;
    var err = wrap.querySelector('.qab-error');
    if (err) err.textContent = msg;
    wrap.classList.add('qab-field-invalid');
  }

  function handleSubmit(type, form) {
    var fd     = new FormData(form);
    var desc   = (fd.get('desc') || '').toString().trim();
    var amount = Number(fd.get('amount'));
    var date   = (fd.get('date') || '').toString().trim() || todayISO();
    var loanId = (fd.get('loanId') || '').toString().trim();

    var valid = true;
    if (!desc) { setError(form, 'desc', 'Description is required'); valid = false; }
    if (!amount || amount <= 0) { setError(form, 'amount', 'Enter an amount greater than 0'); valid = false; }
    if (type === 'loan' && !loanId) { setError(form, 'loanId', 'Select a loan'); valid = false; }
    if (!valid) return;

    var entry = { desc: desc, amount: amount, date: date };
    if (type === 'loan') entry.loanId = loanId;

    var undo;
    try {
      undo = opts.onSubmit(type, entry);
    } catch (e) {
      setError(form, 'desc', 'Something went wrong adding this entry.');
      return;
    }
    state.undo = typeof undo === 'function' ? undo : null;
    goToConfirm(type, entry);
  }

  /* ── screen: confirm ─────────────────────────────────────────── */

  function goToConfirm(type, entry) {
    state.screen = 'confirm';
    els.back.classList.add('qab-hidden');
    els.title.textContent = 'Added!';

    var msg = '✅ Added ' + fmtCurrency(entry.amount) + ' ' + type + ' — ' +
      escHtml(entry.desc) + ' — ' + fmtDate(entry.date);

    els.body.innerHTML =
      '<div class="qab-confirm">' +
        '<div class="qab-confirm-msg">' + msg + '</div>' +
        '<div class="qab-confirm-actions">' +
          (state.undo ? '<button type="button" class="qab-btn qab-undo-btn">Undo</button>' : '') +
          '<button type="button" class="qab-btn qab-done-btn">Done</button>' +
        '</div>' +
      '</div>';

    var undoBtn = els.body.querySelector('.qab-undo-btn');
    if (undoBtn) {
      undoBtn.addEventListener('click', function () {
        if (state.undo) { try { state.undo(); } catch (e) {} }
        closePanel();
      });
    }
    els.body.querySelector('.qab-done-btn').addEventListener('click', closePanel);
  }

  /* ── show/hide ────────────────────────────────────────────────
     The FAB starts hidden (built but not shown) so hosts can keep it
     off the login screen and only reveal it once a user is signed in. */

  function show() {
    visible = true;
    if (els.root) els.root.classList.remove('qab-hidden');
  }

  function hide() {
    visible = false;
    if (!els.root) return;
    closePanel();
    els.root.classList.add('qab-hidden');
  }

  /* ── public API ──────────────────────────────────────────────── */

  function init(options) {
    opts = options || {};
    if (!els.root) build();
    if (visible) show();
  }

  return { init: init, show: show, hide: hide };
})();
