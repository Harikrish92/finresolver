/* ============================================================
   lifestyle.js — Lifestyle Tracker
   FinResolver · finresolver.in

   Two sub-modules:
     1. Household Goods — track appliances, warranty, lifespan,
        condition, and upgrade plans.
     2. Events & Notes — recurring dates, reminders, important
        notes with upcoming / overdue awareness.

   Storage (mirroring the investments pattern):
     localStorage  : fr_lifestyle_{uid}  (encrypted)
     Firestore     : users/{uid}/config/lifestyle
   ============================================================ */

/* ══════════════════════════════════════════════════════════
   STATE
══════════════════════════════════════════════════════════ */
var lifestyleData = { goods: [], events: [] };

var _lsActiveTab             = 'goods';    // 'goods' | 'events'
var _lsEditGoodId            = null;       // null = new, string = editing
var _lsEditEventId           = null;
var _lsGoodCategory          = 'TV';       // selected category in goods modal
var _lsEventCategory         = 'Birthday'; // selected category in events modal
var _lsNotifBannerDismissed  = false;      // session-only dismiss for alert banner

function resetLifestyleState() {
  lifestyleData              = { goods: [], events: [] };
  _lsActiveTab               = 'goods';
  _lsEditGoodId              = null;
  _lsEditEventId             = null;
  _lsNotifBannerDismissed    = false;
}

/* ══════════════════════════════════════════════════════════
   CONSTANTS
══════════════════════════════════════════════════════════ */
var LS_GOOD_CATS = [
  { key: 'TV',             icon: '📺', label: 'TV / Display',     lifespan: 10 },
  { key: 'Fridge',         icon: '🧊', label: 'Fridge',           lifespan: 15 },
  { key: 'Washing Machine',icon: '🫧', label: 'Washing Machine',  lifespan: 12 },
  { key: 'AC',             icon: '❄️', label: 'Air Conditioner',  lifespan: 15 },
  { key: 'Microwave',      icon: '♨️', label: 'Microwave / OTG',  lifespan: 10 },
  { key: 'Computer',       icon: '💻', label: 'Computer / Laptop', lifespan: 6 },
  { key: 'Phone',          icon: '📱', label: 'Smartphone',       lifespan: 4 },
  { key: 'Furniture',      icon: '🪑', label: 'Furniture',        lifespan: 20 },
  { key: 'Vehicle',        icon: '🚗', label: 'Vehicle',          lifespan: 15 },
  { key: 'Water Purifier', icon: '💧', label: 'Water Purifier',   lifespan: 8 },
  { key: 'Geyser',         icon: '🚿', label: 'Geyser / Heater',  lifespan: 10 },
  { key: 'Other',          icon: '📦', label: 'Other',            lifespan: 10 },
];

var LS_EVENT_CATS = [
  { key: 'Birthday',         icon: '🎂', label: 'Birthday' },
  { key: 'Anniversary',      icon: '💑', label: 'Anniversary' },
  { key: 'Insurance',        icon: '🛡️', label: 'Insurance Renewal' },
  { key: 'Subscription',     icon: '🔄', label: 'Subscription' },
  { key: 'Vehicle Service',  icon: '🔧', label: 'Vehicle Service' },
  { key: 'Medical',          icon: '🏥', label: 'Medical / Health' },
  { key: 'Tax',              icon: '📋', label: 'Tax / Compliance' },
  { key: 'Travel',           icon: '✈️', label: 'Travel' },
  { key: 'Reminder',         icon: '⏰', label: 'General Reminder' },
  { key: 'Other',            icon: '📌', label: 'Other' },
];

/* ══════════════════════════════════════════════════════════
   PERSISTENCE
══════════════════════════════════════════════════════════ */
function getLsKey() {
  var uid = (typeof fbAuth !== 'undefined' && fbAuth && fbAuth.currentUser)
    ? fbAuth.currentUser.uid
    : (typeof currentUser !== 'undefined' && currentUser && currentUser.uid ? currentUser.uid : 'guest');
  return 'fr_lifestyle_' + uid;
}

async function loadLifestyle() {
  var raw   = localStorage.getItem(getLsKey());
  var email = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.email : null;
  if (!raw) { lifestyleData = { goods: [], events: [] }; return; }
  var dec = await (typeof decryptFromStorage === 'function'
    ? decryptFromStorage(raw, email)
    : Promise.resolve(null));
  if (dec && typeof dec === 'object') {
    lifestyleData = { goods: dec.goods || [], events: dec.events || [] };
  } else {
    lifestyleData = { goods: [], events: [] };
  }
}

async function saveLifestyle() {
  var email = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.email : null;
  if (typeof encryptForStorage === 'function') {
    localStorage.setItem(getLsKey(), await encryptForStorage(lifestyleData, email));
  } else {
    localStorage.setItem(getLsKey(), JSON.stringify(lifestyleData));
  }
  // Cloud sync — fire-and-forget (no await so UI stays responsive)
  _lsSyncToFirestore();
}

function _lsSyncToFirestore() {
  if (typeof db === 'undefined' || !db || typeof fbAuth === 'undefined' || !fbAuth || !fbAuth.currentUser) return;
  var uid   = fbAuth.currentUser.uid;
  var email = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.email : null;
  if (!uid) return;
  (async function() {
    try {
      var enc = await (typeof encryptForStorage === 'function'
        ? encryptForStorage(lifestyleData, email)
        : Promise.resolve(JSON.stringify(lifestyleData)));
      await db.collection('users').doc(uid).collection('config').doc('lifestyle').set({ _enc: enc });
    } catch (e) { console.warn('[Lifestyle] Firestore save failed:', e.message); }
  })();
}

/* ══════════════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════════════ */
function lsId() { return 'ls_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7); }

function lsEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function lsFmt(n) {
  var v = Number(n);
  if (!v) return '—';
  return '₹' + v.toLocaleString('en-IN');
}

function lsGoodCat(key) {
  return LS_GOOD_CATS.find(function(c){ return c.key === key; }) || LS_GOOD_CATS[LS_GOOD_CATS.length - 1];
}

function lsEventCat(key) {
  return LS_EVENT_CATS.find(function(c){ return c.key === key; }) || LS_EVENT_CATS[LS_EVENT_CATS.length - 1];
}

/* Compute age string like "3 yrs 2 mo" from a date string */
function lsAge(dateStr) {
  if (!dateStr) return null;
  var then = new Date(dateStr);
  var now  = new Date();
  if (isNaN(then.getTime())) return null;
  var months = (now.getFullYear() - then.getFullYear()) * 12 + (now.getMonth() - then.getMonth());
  if (months < 0) return null;
  var yrs = Math.floor(months / 12);
  var mo  = months % 12;
  if (yrs === 0 && mo === 0) return 'Just purchased';
  if (yrs === 0) return mo + ' mo old';
  if (mo === 0)  return yrs + (yrs === 1 ? ' yr old' : ' yrs old');
  return yrs + ' yr' + (yrs > 1 ? 's' : '') + ' ' + mo + ' mo old';
}

/* Compute warranty status from purchase date + warranty years */
function lsWarrantyStatus(purchaseDate, warrantyYears) {
  if (!purchaseDate || !warrantyYears) return { status: 'none', label: 'No Warranty', exp: null };
  var then   = new Date(purchaseDate);
  var expiry = new Date(then);
  expiry.setFullYear(expiry.getFullYear() + Number(warrantyYears));
  var now    = new Date();
  var days   = Math.round((expiry - now) / 86400000);
  var expStr = expiry.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
  if (days < 0)   return { status: 'expired',  label: 'Warranty Expired',       exp: expStr };
  if (days < 90)  return { status: 'expiring', label: 'Expiring in ' + days + 'd', exp: expStr };
  return            { status: 'active',   label: 'Warranty Active',         exp: expStr };
}

/* Lifespan percentage (0–100) */
function lsLifespanPct(purchaseDate, lifespanYears) {
  if (!purchaseDate || !lifespanYears) return 0;
  var then  = new Date(purchaseDate);
  var now   = new Date();
  var ageMs = now - then;
  var total = lifespanYears * 365.25 * 86400000;
  return Math.min(100, Math.max(0, (ageMs / total) * 100));
}

/* Years used / total */
function lsLifespanText(purchaseDate, lifespanYears) {
  if (!purchaseDate || !lifespanYears) return '';
  var then  = new Date(purchaseDate);
  var now   = new Date();
  var usedYrs = (now - then) / (365.25 * 86400000);
  return usedYrs.toFixed(1) + ' / ' + lifespanYears + ' yrs';
}

/* Compute next occurrence of a MM-DD event (for recurring = yearly) */
function lsNextOccurrence(dateStr, recurring) {
  if (!dateStr) return null;
  var d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;

  var today = new Date();
  today.setHours(0, 0, 0, 0);

  if (!recurring) {
    // One-time: just use the raw date
    d.setHours(0, 0, 0, 0);
    return d;
  }

  // Recurring yearly: find next occurrence of MM-DD
  var month = d.getMonth();
  var day   = d.getDate();
  var next  = new Date(today.getFullYear(), month, day);
  if (next < today) next.setFullYear(next.getFullYear() + 1);
  return next;
}

function lsDaysUntil(dateStr, recurring) {
  var occ = lsNextOccurrence(dateStr, recurring);
  if (!occ) return null;
  var today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((occ - today) / 86400000);
}

function lsDaysBadge(days) {
  if (days === null) return '';
  if (days === 0)  return '<span class="ls-days-badge today">Today!</span>';
  if (days > 0 && days <= 14) return '<span class="ls-days-badge soon">in ' + days + ' days</span>';
  if (days > 0)   return '<span class="ls-days-badge upcoming">in ' + days + ' days</span>';
  return '<span class="ls-days-badge overdue">' + Math.abs(days) + ' days ago</span>';
}

function lsFormatEventDate(dateStr, recurring) {
  if (!dateStr) return '';
  var d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  var opts = recurring
    ? { month: 'short', day: 'numeric' }           // Jun 15 (no year for recurring)
    : { day: 'numeric', month: 'short', year: 'numeric' };
  return d.toLocaleDateString('en-IN', opts) + (recurring ? ' · Yearly' : '');
}

/* ══════════════════════════════════════════════════════════
   RENDERING
══════════════════════════════════════════════════════════ */
function lsRenderAll() {
  lsRenderSummary();
  lsRenderAlertBanner();
  if (_lsActiveTab === 'goods') {
    lsRenderGoods();
  } else {
    lsRenderEvents();
  }
}

/* ── Summary strip ── */
function lsRenderSummary() {
  var goods    = lifestyleData.goods  || [];
  var events   = lifestyleData.events || [];
  var today    = new Date(); today.setHours(0,0,0,0);

  var warrantyExpiring = goods.filter(function(g) {
    if (!g.purchaseDate || !g.warrantyYears) return false;
    var exp = new Date(g.purchaseDate);
    exp.setFullYear(exp.getFullYear() + Number(g.warrantyYears));
    var days = Math.round((exp - today) / 86400000);
    return days >= 0 && days <= 90;
  }).length;

  var upcomingEvents = events.filter(function(ev) {
    var days = lsDaysUntil(ev.date, ev.recurring);
    return days !== null && days >= 0 && days <= 30;
  }).length;

  var dueForUpgrade = goods.filter(function(g) {
    if (!g.purchaseDate || !g.expectedLifespan) return false;
    var pct = lsLifespanPct(g.purchaseDate, g.expectedLifespan);
    return pct >= 100;
  }).length;

  var setText = function(id, val) {
    var el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  setText('lsSumGoods',    goods.length);
  setText('lsSumWarranty', warrantyExpiring);
  setText('lsSumEvents',   upcomingEvents);
  setText('lsSumUpgrade',  dueForUpgrade);
}

/* ── Goods grid ── */
function lsRenderGoods() {
  var grid  = document.getElementById('lsGoodsGrid');
  var empty = document.getElementById('lsGoodsEmpty');
  if (!grid) return;

  var goods = lifestyleData.goods || [];

  if (goods.length === 0) {
    grid.innerHTML = '';
    if (empty) empty.style.display = 'flex';
    return;
  }
  if (empty) empty.style.display = 'none';

  grid.innerHTML = goods.map(function(g) {
    var cat        = lsGoodCat(g.category);
    var ageStr     = lsAge(g.purchaseDate) || '—';
    var warranty   = lsWarrantyStatus(g.purchaseDate, g.warrantyYears);
    var lifePct    = lsLifespanPct(g.purchaseDate, g.expectedLifespan);
    var lifeText   = g.expectedLifespan ? lsLifespanText(g.purchaseDate, g.expectedLifespan) : null;
    var fillClass  = lifePct >= 100 ? 'danger' : lifePct >= 75 ? 'warn' : '';
    var condDot    = (g.condition || '').toLowerCase() || 'unknown';
    var overdue    = lifePct >= 100;

    return [
      '<div class="ls-good-card" id="lsgood-' + lsEsc(g.id) + '">',

        // Top: icon + name + badge
        '<div class="ls-good-top">',
          '<div class="ls-good-icon">' + cat.icon + '</div>',
          '<div class="ls-good-top-info">',
            '<div class="ls-good-name">' + lsEsc(g.name || '—') + '</div>',
            '<div class="ls-good-brand">',
              (g.brand ? lsEsc(g.brand) : '') + (g.model ? ' · ' + lsEsc(g.model) : ''),
            '</div>',
          '</div>',
          '<span class="ls-good-cat-badge">' + lsEsc(cat.key) + '</span>',
        '</div>',

        // Price + age
        '<div class="ls-good-meta-row">',
          '<span class="ls-good-price">',
            g.purchasePrice ? lsFmt(g.purchasePrice) : '<span style="color:var(--muted)">No price</span>',
          '</span>',
          '<span class="ls-good-age">' + lsEsc(ageStr) + '</span>',
        '</div>',

        // Warranty status
        '<div class="ls-warranty-row">',
          '<span class="ls-warranty-badge ' + warranty.status + '">',
            warranty.status === 'active'   ? '🛡 ' :
            warranty.status === 'expiring' ? '⚠️ ' :
            warranty.status === 'expired'  ? '✗ '  : '',
            lsEsc(warranty.label),
          '</span>',
          warranty.exp ? '<span class="ls-warranty-exp">Exp: ' + lsEsc(warranty.exp) + '</span>' : '',
        '</div>',

        // Lifespan progress (only if lifespan is set)
        g.expectedLifespan ? [
          '<div class="ls-lifespan">',
            '<div class="ls-lifespan-labels">',
              '<span class="ls-lifespan-label">Lifespan</span>',
              '<span class="ls-lifespan-value">' + (lifeText || '') + (overdue ? ' · <span style="color:var(--accent2)">Overdue</span>' : '') + '</span>',
            '</div>',
            '<div class="ls-lifespan-track">',
              '<div class="ls-lifespan-fill ' + fillClass + '" style="width:' + Math.min(100, lifePct).toFixed(1) + '%"></div>',
            '</div>',
          '</div>',
        ].join('') : '',

        // Condition
        g.condition ? [
          '<div class="ls-condition">',
            '<span class="ls-condition-dot ' + condDot + '"></span>',
            '<span>Condition: ' + lsEsc(g.condition) + '</span>',
          '</div>',
        ].join('') : '',

        // Upgrade notes
        g.upgradeNotes ? [
          '<div class="ls-upgrade-note">',
            '<strong>Upgrade Plan: </strong>',
            lsEsc(g.upgradeNotes),
          '</div>',
        ].join('') : '',

        // Notes
        g.notes ? '<div class="ls-good-notes">' + lsEsc(g.notes) + '</div>' : '',

        // Actions
        '<div class="ls-card-actions">',
          '<button class="ls-btn-edit" onclick="openLsGoodModal(\'' + lsEsc(g.id) + '\')">✏ Edit</button>',
          '<button class="ls-btn-del"  onclick="deleteLsGood(\'' + lsEsc(g.id) + '\')">🗑 Delete</button>',
        '</div>',

      '</div>',
    ].join('');
  }).join('');
}

/* ── Events list ── */
function lsRenderEvents() {
  var listEl = document.getElementById('lsEventsList');
  var empty  = document.getElementById('lsEventsEmpty');
  if (!listEl) return;

  var events = lifestyleData.events || [];

  if (events.length === 0) {
    listEl.innerHTML = '';
    if (empty) empty.style.display = 'flex';
    return;
  }
  if (empty) empty.style.display = 'none';

  // Compute days-until for sorting
  var enriched = events.map(function(ev) {
    return { ev: ev, days: lsDaysUntil(ev.date, ev.recurring) };
  });

  // Sort: today (0) → upcoming (asc) → past (desc by recency)
  enriched.sort(function(a, b) {
    var da = a.days === null ? Infinity : a.days;
    var db = b.days === null ? Infinity : b.days;
    if (da >= 0 && db >= 0) return da - db;     // both upcoming: nearest first
    if (da < 0  && db < 0)  return db - da;     // both past: most recent first
    return da >= 0 ? -1 : 1;                    // upcoming before past
  });

  var sections = [
    { label: 'Today',    items: enriched.filter(function(e){ return e.days === 0; }) },
    { label: 'Upcoming', items: enriched.filter(function(e){ return e.days !== null && e.days > 0; }) },
    { label: 'Past / Overdue', items: enriched.filter(function(e){ return e.days !== null && e.days < 0; }) },
    { label: 'No Date',  items: enriched.filter(function(e){ return e.days === null; }) },
  ];

  var html = '';
  sections.forEach(function(sec) {
    if (sec.items.length === 0) return;
    html += '<div class="ls-event-section-header">' + lsEsc(sec.label) + '</div>';
    html += '<div class="ls-events-list">';
    sec.items.forEach(function(item) {
      var ev      = item.ev;
      var days    = item.days;
      var cat     = lsEventCat(ev.category);
      var dateStr = lsFormatEventDate(ev.date, ev.recurring);
      var rowCls  = days === 0 ? 'today' : days !== null && days < 0 ? 'overdue' : '';

      html += [
        '<div class="ls-event-row ' + rowCls + '">',
          '<div class="ls-event-icon">' + cat.icon + '</div>',
          '<div class="ls-event-info">',
            '<div class="ls-event-title">' + lsEsc(ev.title || '—') + '</div>',
            '<div class="ls-event-meta">',
              '<span class="ls-event-date">' + lsEsc(dateStr) + '</span>',
              '<span class="ls-event-cat-badge">' + lsEsc(cat.label) + '</span>',
            '</div>',
            ev.notes ? '<div class="ls-event-notes">' + lsEsc(ev.notes) + '</div>' : '',
          '</div>',
          '<div class="ls-event-right">',
            lsDaysBadge(days),
            '<div class="ls-event-actions">',
              '<button onclick="openLsEventModal(\'' + lsEsc(ev.id) + '\')">✏</button>',
              '<button class="del" onclick="deleteLsEvent(\'' + lsEsc(ev.id) + '\')">🗑</button>',
            '</div>',
          '</div>',
        '</div>',
      ].join('');
    });
    html += '</div>';
  });

  listEl.innerHTML = html;
}

/* ══════════════════════════════════════════════════════════
   TABS
══════════════════════════════════════════════════════════ */
function lsShowTab(tab) {
  _lsActiveTab = tab;
  ['goods', 'events'].forEach(function(t) {
    var btn = document.getElementById('lsTab' + t.charAt(0).toUpperCase() + t.slice(1));
    var content = document.getElementById('lsContent-' + t);
    var isActive = t === tab;
    if (btn) btn.classList.toggle('active', isActive);
    if (content) content.style.display = isActive ? 'block' : 'none';
  });
  if (tab === 'goods')  lsRenderGoods();
  if (tab === 'events') lsRenderEvents();
}

/* ══════════════════════════════════════════════════════════
   GOODS MODAL
══════════════════════════════════════════════════════════ */
function openLsGoodModal(id) {
  _lsEditGoodId = id || null;
  var good = id ? (lifestyleData.goods || []).find(function(g){ return g.id === id; }) : null;

  // Default category
  _lsGoodCategory = (good && good.category) ? good.category : 'TV';

  // Populate form
  _lsSetVal('lsGoodName',       good ? good.name            : '');
  _lsSetVal('lsGoodBrand',      good ? good.brand           : '');
  _lsSetVal('lsGoodModel',      good ? good.model           : '');
  _lsSetVal('lsGoodDate',       good ? good.purchaseDate    : '');
  _lsSetVal('lsGoodPrice',      good ? good.purchasePrice   : '');
  _lsSetVal('lsGoodWarranty',   good && good.warrantyYears  ? good.warrantyYears  : '');
  _lsSetVal('lsGoodLifespan',   good && good.expectedLifespan ? good.expectedLifespan : _lsDefaultLifespan(_lsGoodCategory));
  _lsSetVal('lsGoodCondition',  good ? good.condition       : 'Good');
  _lsSetVal('lsGoodNotes',      good ? good.notes           : '');
  _lsSetVal('lsGoodUpgrade',    good ? good.upgradeNotes    : '');

  // Title
  var titleEl = document.getElementById('lsGoodModalTitle');
  if (titleEl) titleEl.textContent = id ? '✏ Edit Household Item' : '+ Add Household Item';

  // Render category pills
  _lsRenderGoodCatPills();

  document.getElementById('lsGoodModal').classList.remove('hidden');
}

function closeLsGoodModal() {
  document.getElementById('lsGoodModal').classList.add('hidden');
}

function _lsDefaultLifespan(catKey) {
  var cat = LS_GOOD_CATS.find(function(c){ return c.key === catKey; });
  return cat ? cat.lifespan : 10;
}

function _lsRenderGoodCatPills() {
  var wrap = document.getElementById('lsGoodCatPills');
  if (!wrap) return;
  wrap.innerHTML = LS_GOOD_CATS.map(function(c) {
    var active = c.key === _lsGoodCategory ? ' active' : '';
    return '<button class="ls-cat-pill' + active + '" onclick="lsSelectGoodCat(\'' + lsEsc(c.key) + '\')">' +
      c.icon + ' ' + lsEsc(c.label) + '</button>';
  }).join('');
}

function lsSelectGoodCat(key) {
  _lsGoodCategory = key;
  _lsRenderGoodCatPills();
  // Suggest default lifespan if field is empty or was the previous default
  var lsEl = document.getElementById('lsGoodLifespan');
  if (lsEl && (!lsEl.value || lsEl.value === '0')) {
    lsEl.value = _lsDefaultLifespan(key);
  }
}

function saveLsGood() {
  var name = (_lsGetVal('lsGoodName') || '').trim();
  if (!name) { alert('Please enter a name for the item.'); return; }

  var good = {
    id:               _lsEditGoodId || lsId(),
    name:             name,
    category:         _lsGoodCategory,
    brand:            (_lsGetVal('lsGoodBrand') || '').trim(),
    model:            (_lsGetVal('lsGoodModel') || '').trim(),
    purchaseDate:     _lsGetVal('lsGoodDate') || '',
    purchasePrice:    Number(_lsGetVal('lsGoodPrice')) || 0,
    warrantyYears:    Number(_lsGetVal('lsGoodWarranty')) || 0,
    expectedLifespan: Number(_lsGetVal('lsGoodLifespan')) || 0,
    condition:        _lsGetVal('lsGoodCondition') || 'Good',
    notes:            (_lsGetVal('lsGoodNotes') || '').trim(),
    upgradeNotes:     (_lsGetVal('lsGoodUpgrade') || '').trim(),
  };

  var goods = lifestyleData.goods || [];
  if (_lsEditGoodId) {
    var idx = goods.findIndex(function(g){ return g.id === _lsEditGoodId; });
    if (idx >= 0) goods[idx] = good; else goods.push(good);
  } else {
    goods.push(good);
  }
  lifestyleData.goods = goods;
  saveLifestyle();
  closeLsGoodModal();
  lsRenderAll();
  if (typeof showToast === 'function') showToast(_lsEditGoodId ? 'Item updated' : 'Item added', 'success');
}

function deleteLsGood(id) {
  var g = (lifestyleData.goods || []).find(function(x){ return x.id === id; });
  if (!g || !confirm('Delete "' + g.name + '"?')) return;
  lifestyleData.goods = (lifestyleData.goods || []).filter(function(x){ return x.id !== id; });
  saveLifestyle();
  lsRenderAll();
  if (typeof showToast === 'function') showToast('Item deleted', 'success');
}

/* ══════════════════════════════════════════════════════════
   EVENTS MODAL
══════════════════════════════════════════════════════════ */
function openLsEventModal(id) {
  _lsEditEventId = id || null;
  var ev = id ? (lifestyleData.events || []).find(function(e){ return e.id === id; }) : null;

  _lsEventCategory = (ev && ev.category) ? ev.category : 'Birthday';

  _lsSetVal('lsEventTitle',    ev ? ev.title    : '');
  _lsSetVal('lsEventDate',     ev ? ev.date     : '');
  _lsSetVal('lsEventNotes',    ev ? ev.notes    : '');

  var recEl = document.getElementById('lsEventRecurring');
  if (recEl) recEl.checked = ev ? !!ev.recurring : true;

  var titleEl = document.getElementById('lsEventModalTitle');
  if (titleEl) titleEl.textContent = id ? '✏ Edit Event / Note' : '+ Add Event / Note';

  _lsRenderEventCatPills();

  document.getElementById('lsEventModal').classList.remove('hidden');
}

function closeLsEventModal() {
  document.getElementById('lsEventModal').classList.add('hidden');
}

function _lsRenderEventCatPills() {
  var wrap = document.getElementById('lsEventCatPills');
  if (!wrap) return;
  wrap.innerHTML = LS_EVENT_CATS.map(function(c) {
    var active = c.key === _lsEventCategory ? ' active' : '';
    return '<button class="ls-cat-pill' + active + '" onclick="lsSelectEventCat(\'' + lsEsc(c.key) + '\')">' +
      c.icon + ' ' + lsEsc(c.label) + '</button>';
  }).join('');
}

function lsSelectEventCat(key) {
  _lsEventCategory = key;
  _lsRenderEventCatPills();
}

function saveLsEvent() {
  var title = (_lsGetVal('lsEventTitle') || '').trim();
  if (!title) { alert('Please enter a title for the event.'); return; }

  var recEl = document.getElementById('lsEventRecurring');

  var ev = {
    id:        _lsEditEventId || lsId(),
    title:     title,
    category:  _lsEventCategory,
    date:      _lsGetVal('lsEventDate') || '',
    notes:     (_lsGetVal('lsEventNotes') || '').trim(),
    recurring: recEl ? recEl.checked : false,
  };

  var events = lifestyleData.events || [];
  if (_lsEditEventId) {
    var idx = events.findIndex(function(e){ return e.id === _lsEditEventId; });
    if (idx >= 0) events[idx] = ev; else events.push(ev);
  } else {
    events.push(ev);
  }
  lifestyleData.events = events;
  saveLifestyle();
  closeLsEventModal();
  lsRenderAll();
  if (typeof showToast === 'function') showToast(_lsEditEventId ? 'Event updated' : 'Event added', 'success');
}

function deleteLsEvent(id) {
  var ev = (lifestyleData.events || []).find(function(x){ return x.id === id; });
  if (!ev || !confirm('Delete "' + ev.title + '"?')) return;
  lifestyleData.events = (lifestyleData.events || []).filter(function(x){ return x.id !== id; });
  saveLifestyle();
  lsRenderAll();
  if (typeof showToast === 'function') showToast('Event deleted', 'success');
}

/* ══════════════════════════════════════════════════════════
   DOM HELPERS
══════════════════════════════════════════════════════════ */
function _lsSetVal(id, val) {
  var el = document.getElementById(id);
  if (!el) return;
  if (el.type === 'checkbox') { el.checked = !!val; return; }
  el.value = val == null ? '' : val;
}

function _lsGetVal(id) {
  var el = document.getElementById(id);
  return el ? el.value : '';
}

/* ══════════════════════════════════════════════════════════
   HOME DASHBOARD STAT
══════════════════════════════════════════════════════════ */
function lsGetHomeStat() {
  var goods  = lifestyleData.goods  || [];
  var events = lifestyleData.events || [];
  var today  = new Date(); today.setHours(0,0,0,0);

  // Count items approaching end of life (>= 75% lifespan used)
  var aging = goods.filter(function(g) {
    var pct = lsLifespanPct(g.purchaseDate, g.expectedLifespan);
    return pct >= 75;
  }).length;

  // Count events in next 7 days
  var upcoming7 = events.filter(function(ev) {
    var days = lsDaysUntil(ev.date, ev.recurring);
    return days !== null && days >= 0 && days <= 7;
  }).length;

  if (goods.length === 0 && events.length === 0) return null;
  if (upcoming7 > 0) return upcoming7 + ' event' + (upcoming7 > 1 ? 's' : '') + ' soon';
  if (aging > 0) return aging + ' item' + (aging > 1 ? 's' : '') + ' aging';
  return goods.length + ' item' + (goods.length !== 1 ? 's' : '');
}

/* ══════════════════════════════════════════════════════════
   NOTIFICATIONS
══════════════════════════════════════════════════════════ */

function lsGetAlerts() {
  var goods  = lifestyleData.goods  || [];
  var events = lifestyleData.events || [];
  var alerts = [];

  events.forEach(function(ev) {
    if (lsDaysUntil(ev.date, ev.recurring) === 0) {
      alerts.push({ level: 'urgent', type: 'event-today', ev: ev });
    }
  });

  var soonEvents = events.filter(function(ev) {
    var d = lsDaysUntil(ev.date, ev.recurring);
    return d !== null && d > 0 && d <= 7;
  });
  if (soonEvents.length > 0) {
    alerts.push({ level: 'warn', type: 'events-soon', items: soonEvents });
  }

  goods.forEach(function(g) {
    if (!g.purchaseDate || !g.warrantyYears) return;
    var exp = new Date(g.purchaseDate);
    exp.setFullYear(exp.getFullYear() + Number(g.warrantyYears));
    var days = Math.round((exp - new Date()) / 86400000);
    if (days >= 0 && days <= 30) {
      alerts.push({ level: 'warn', type: 'warranty', good: g, days: days });
    }
  });

  var overdue = goods.filter(function(g) {
    return g.purchaseDate && g.expectedLifespan && lsLifespanPct(g.purchaseDate, g.expectedLifespan) >= 100;
  });
  if (overdue.length > 0) {
    alerts.push({ level: 'info', type: 'upgrade-due', items: overdue });
  }

  return alerts;
}

function lsRenderAlertBanner() {
  var el = document.getElementById('lsAlertBanner');
  if (!el) return;

  if (_lsNotifBannerDismissed) { el.style.display = 'none'; return; }

  var alerts = lsGetAlerts();
  if (alerts.length === 0) { el.style.display = 'none'; return; }

  var rows = alerts.map(function(a) {
    if (a.type === 'event-today') {
      var cat = lsEventCat(a.ev.category);
      return '<div class="ls-alert-row urgent">' + cat.icon +
        ' <strong>' + lsEsc(a.ev.title) + '</strong> is <strong>today</strong>!</div>';
    }
    if (a.type === 'events-soon') {
      var titles = a.items.slice(0, 2).map(function(ev) { return lsEsc(ev.title); }).join(', ');
      var extra  = a.items.length > 2 ? ' +' + (a.items.length - 2) + ' more' : '';
      return '<div class="ls-alert-row warn">📅 ' + a.items.length + ' event' +
        (a.items.length > 1 ? 's' : '') + ' this week: ' + titles + extra + '</div>';
    }
    if (a.type === 'warranty') {
      var cat = lsGoodCat(a.good.category);
      return '<div class="ls-alert-row warn">' + cat.icon + ' <strong>' + lsEsc(a.good.name) +
        '</strong> warranty expires in ' + a.days + ' day' + (a.days !== 1 ? 's' : '') + '</div>';
    }
    if (a.type === 'upgrade-due') {
      var names = a.items.slice(0, 2).map(function(g) { return lsEsc(g.name); }).join(', ');
      var extra = a.items.length > 2 ? ' +' + (a.items.length - 2) + ' more' : '';
      return '<div class="ls-alert-row info">📦 ' + a.items.length + ' item' +
        (a.items.length > 1 ? 's' : '') + ' past expected lifespan: ' + names + extra + '</div>';
    }
    return '';
  }).join('');

  var nudge = '';
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    nudge = '<div class="ls-notif-nudge">' +
      '<span>🔔 Get reminders even when the app is closed.</span>' +
      '<button class="ls-notif-enable-btn" onclick="lsEnableNotifications()">Enable Notifications</button>' +
      '</div>';
  }

  el.innerHTML =
    '<div class="ls-alert-content">' +
      '<div class="ls-alert-rows">' + rows + '</div>' +
      nudge +
    '</div>' +
    '<button class="ls-alert-dismiss" onclick="lsDismissAlertBanner()" title="Dismiss">✕</button>';

  el.style.display = 'flex';
}

function lsDismissAlertBanner() {
  _lsNotifBannerDismissed = true;
  var el = document.getElementById('lsAlertBanner');
  if (el) el.style.display = 'none';
}

function lsCheckBrowserNotify() {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

  var uid = (typeof fbAuth !== 'undefined' && fbAuth && fbAuth.currentUser)
    ? fbAuth.currentUser.uid : 'guest';
  var key   = 'fr_ls_notif_date_' + uid;
  var today = new Date().toISOString().slice(0, 10);
  if (localStorage.getItem(key) === today) return;

  var alerts = lsGetAlerts();
  if (alerts.length === 0) return;

  var lines = [];
  alerts.forEach(function(a) {
    if (a.type === 'event-today') lines.push(a.ev.title + ' is today!');
    else if (a.type === 'events-soon') lines.push(a.items.length + ' event' + (a.items.length > 1 ? 's' : '') + ' coming this week');
    else if (a.type === 'warranty') lines.push(a.good.name + ' warranty expires in ' + a.days + 'd');
    else if (a.type === 'upgrade-due') lines.push(a.items.length + ' item' + (a.items.length > 1 ? 's' : '') + ' due for upgrade');
  });

  try {
    new Notification('FinResolver · ' + alerts.length + ' lifestyle reminder' + (alerts.length > 1 ? 's' : ''), {
      body: lines.join('\n'),
      tag:  'fr-lifestyle',
    });
    localStorage.setItem(key, today);
  } catch(e) {}
}

function lsEnableNotifications() {
  if (typeof Notification === 'undefined') return;
  Notification.requestPermission().then(function(perm) {
    if (perm === 'granted') {
      var uid = (typeof fbAuth !== 'undefined' && fbAuth && fbAuth.currentUser)
        ? fbAuth.currentUser.uid : 'guest';
      localStorage.removeItem('fr_ls_notif_date_' + uid);
      lsCheckBrowserNotify();
      lsRenderAlertBanner();
      if (typeof showToast === 'function') showToast('Notifications enabled!', 'success');
    }
  });
}

/* ══════════════════════════════════════════════════════════
   INIT
══════════════════════════════════════════════════════════ */
function initLifestyle() {
  // Pre-load data so home card stat is available
  loadLifestyle().then(function() {
    var statEl = document.getElementById('homeStatLifestyle');
    if (statEl) {
      var stat = lsGetHomeStat();
      statEl.textContent = stat || '—';
    }
    lsCheckBrowserNotify();
  });
}
