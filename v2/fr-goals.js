// ── GOAL-BASED TRACKER ────────────────────────────────────────────────────────

const GOAL_COLORS = ['#00e5a0','#4dabf7','#ffc947','#a78bfa','#ff5c7a','#fb923c','#2dd4bf','#f472b6'];
const GOAL_ICONS  = ['🏠','🏖️','🎓','🚗','💍','🏥','✈️','👶','💼','🏦','📈','🎯'];

// ── BUSINESS LOGIC ────────────────────────────────────────────────────────────

// Returns qty of an investment not yet allocated to any goal
function getAvailableQty(investmentId) {
  const inv = APP.investments.find(i => String(i.id) === String(investmentId));
  if (!inv) return 0;
  const totalQty = _invTotalQty(inv);
  const allocated = (APP.goalAllocations || [])
    .filter(a => String(a.investmentId) === String(investmentId))
    .reduce((s, a) => s + (Number(a.allocatedQty) || 0), 0);
  return Math.max(0, totalQty - allocated);
}

// Same as above but excludes a specific allocation (used when editing an existing allocation)
function getAvailableQtyExcluding(investmentId, excludeAllocationId) {
  const inv = APP.investments.find(i => String(i.id) === String(investmentId));
  if (!inv) return 0;
  const totalQty = _invTotalQty(inv);
  const allocated = (APP.goalAllocations || [])
    .filter(a => String(a.investmentId) === String(investmentId) && a.id !== excludeAllocationId)
    .reduce((s, a) => s + (Number(a.allocatedQty) || 0), 0);
  return Math.max(0, totalQty - allocated);
}

// Returns current price per unit for any investment category
function _invPricePerUnit(inv) {
  if (!inv) return 0;
  const cat = _invCat(inv);
  if (cat === 'Gold') return Number(inv.livePrice || _invGoldBuyPrice(inv) || 0);
  if (inv.livePrice)  return Number(inv.livePrice);
  const qty = _invTotalQty(inv);
  return qty > 0 ? invCost(inv) / qty : 0;
}

// Returns total current value of all allocations mapped to a specific goal
function getGoalCurrentValue(goalId) {
  return (APP.goalAllocations || [])
    .filter(a => a.goalId === goalId)
    .reduce((sum, a) => {
      const inv = APP.investments.find(i => String(i.id) === String(a.investmentId));
      if (!inv) return sum;
      return sum + (Number(a.allocatedQty) || 0) * _invPricePerUnit(inv);
    }, 0);
}

// Returns all investments that have unallocated quantity remaining
function getUnassignedHoldings() {
  return APP.investments
    .map(inv => {
      const unallocatedQty = getAvailableQty(inv.id);
      if (unallocatedQty <= 0) return null;
      return {
        inv,
        unallocatedQty,
        unallocatedValue: unallocatedQty * _invPricePerUnit(inv),
      };
    })
    .filter(Boolean);
}

// ── SCREEN: GOALS DASHBOARD ───────────────────────────────────────────────────

function renderGoals(el) {
  const goals      = APP.goals || [];
  const allocs     = APP.goalAllocations || [];
  const unassigned = getUnassignedHoldings();

  const totalGoalValue = goals.reduce((s, g) => s + getGoalCurrentValue(g.id), 0);
  const totalTarget    = goals.reduce((s, g) => s + (Number(g.targetAmount) || 0), 0);

  el.innerHTML = `
    <div class="sh">
      <div class="sh-l">
        <div class="sh-title">My Financial Goals</div>
        <div class="sh-sub">${goals.length} goal${goals.length !== 1 ? 's' : ''} · track your financial milestones</div>
      </div>
      <div class="sh-r">
        <button class="btn btn-primary btn-sm" onclick="openAddGoal()">${ic('plus',12)} New Goal</button>
      </div>
    </div>

    ${goals.length > 0 ? `
      <div class="strip">
        ${statCard('Total Goals',        String(goals.length),        '',    goals.length + ' active goals')}
        ${statCard('Current Value',      fmt(totalGoalValue, true),   'pos', 'across all goals')}
        ${statCard('Total Target',       fmt(totalTarget, true),      '',    'combined target')}
        ${statCard('Overall Progress',   totalTarget > 0 ? Math.round(totalGoalValue / totalTarget * 100) + '%' : '0%', totalGoalValue >= totalTarget ? 'pos' : 'gld', totalTarget > 0 ? fmt(totalTarget - totalGoalValue, true) + ' remaining' : '—')}
      </div>
    ` : ''}

    ${goals.length === 0 ? `
      <div class="goal-empty">
        <div style="font-size:4rem;margin-bottom:16px;opacity:.3">🎯</div>
        <div style="font-family:var(--font-d);font-size:18px;font-weight:700;color:var(--t2);margin-bottom:8px">Set your first financial goal</div>
        <div style="font-size:13.5px;color:var(--t3);margin-bottom:24px;max-width:340px;line-height:1.6">Map your investments to specific goals — retirement, education, a dream holiday and more.</div>
        <button class="btn btn-primary" onclick="openAddGoal()">${ic('plus',13)} Create Your First Goal</button>
      </div>
    ` : `
      <div class="goal-grid">
        ${goals.map(g => _renderGoalCard(g, allocs)).join('')}
      </div>
    `}

    ${unassigned.length > 0 ? `
      <div class="card" style="margin-top:${goals.length ? '8px' : '0'}">
        <div class="card-hd">
          <div class="card-title">${ic('info',13)} Unassigned Holdings <span class="section-count">${unassigned.length}</span></div>
          <span style="font-size:11.5px;color:var(--t3)">Allocate these to a goal</span>
        </div>
        <div class="tbl-wrap">
          <table class="tbl">
            <thead>
              <tr>
                <th>Investment</th>
                <th>Type</th>
                <th>Unassigned Qty</th>
                <th>Current Value</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${unassigned.map(u => `
                <tr>
                  <td>
                    <div style="font-weight:600;font-size:13px;color:var(--t1)">${_gEsc(u.inv.name)}</div>
                    ${u.inv.ticker ? `<div style="font-size:11px;color:var(--t3);font-family:var(--font-m)">${_gEsc(u.inv.ticker)}</div>` : ''}
                  </td>
                  <td><span class="pill ${pillClass(_invCat(u.inv))}">${_invCat(u.inv)}</span></td>
                  <td class="mono">${_fmtQty(u.unallocatedQty)}</td>
                  <td class="mono text-pos">${fmt(u.unallocatedValue, true)}</td>
                  <td>
                    ${(APP.goals || []).length > 0
                      ? `<button class="btn btn-ghost btn-sm" onclick="openAllocationModal(null,'${_gEsc(String(u.inv.id))}')">${ic('plus',11)} Assign to Goal</button>`
                      : `<span style="font-size:11.5px;color:var(--t3)">Create a goal first</span>`}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    ` : (goals.length > 0 ? `
      <div style="text-align:center;padding:20px;color:var(--t3);font-size:12.5px;margin-top:4px">
        <span style="color:var(--accent)">✓</span> All holdings are fully allocated to goals.
      </div>
    ` : '')}
  `;
}

function _renderGoalCard(g, allocs) {
  const currentValue  = getGoalCurrentValue(g.id);
  const targetAmount  = Number(g.targetAmount) || 0;
  const hasTarget     = targetAmount > 0;
  const pct           = hasTarget ? Math.min(100, Math.max(0, (currentValue / targetAmount) * 100)) : null;
  const progressCls   = pct === null ? '' : pct >= 80 ? '' : pct >= 40 ? ' gold' : ' red';
  const holdingCount  = allocs.filter(a => a.goalId === g.id).length;

  const targetDateObj = g.targetDate ? new Date(g.targetDate + 'T00:00:00') : null;
  const targetDateStr = targetDateObj
    ? targetDateObj.toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' })
    : '—';

  const daysLeft = targetDateObj ? Math.ceil((targetDateObj - new Date()) / 86400000) : null;
  const timeLabel = daysLeft === null ? ''
    : daysLeft < 0   ? 'Overdue'
    : daysLeft === 0 ? 'Today!'
    : daysLeft < 365 ? daysLeft + 'd left'
    : Math.floor(daysLeft / 365) + 'y left';
  const timeBadgeCls = daysLeft !== null && daysLeft < 0 ? 'badge-dn' : daysLeft !== null && daysLeft < 365 ? 'badge-gld' : 'badge-neu';

  return `
    <div class="goal-card" style="border-left:3px solid ${_gEsc(g.color || '#00e5a0')}"
         onclick="navigate('goal-detail',{goalId:'${_gEsc(g.id)}'})">
      <div class="row" style="justify-content:space-between;align-items:flex-start;gap:8px">
        <div class="row" style="gap:10px;align-items:center;min-width:0">
          <span class="goal-icon-badge">${g.icon || '🎯'}</span>
          <div style="min-width:0">
            <div style="font-weight:700;font-size:14px;color:var(--t1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_gEsc(g.name)}</div>
            <div style="font-size:11px;color:var(--t3);margin-top:1px">${hasTarget ? 'Target: ' + fmt(targetAmount, true) + ' · ' : ''}${targetDateStr}</div>
          </div>
        </div>
        <div class="row" style="gap:4px;flex-shrink:0" onclick="event.stopPropagation()">
          <button class="btn-icon" onclick="openEditGoal('${_gEsc(g.id)}')">${ic('edit',12)}</button>
          <button class="btn-icon" onclick="deleteGoal('${_gEsc(g.id)}')">${ic('trash',12)}</button>
        </div>
      </div>

      <div style="margin-top:12px">
        <div style="font-family:var(--font-d);font-size:22px;font-weight:700;color:var(--t1)">${fmt(currentValue, true)}</div>
        <div style="font-size:11px;color:var(--t3);margin-top:1px">${hasTarget ? 'of ' + fmt(targetAmount, true) + ' target' : 'current value'}</div>
      </div>

      ${hasTarget ? `
      <div style="margin-top:10px">
        <div class="row" style="justify-content:space-between;margin-bottom:6px">
          <span style="font-size:12px;color:var(--t3)">${Math.round(pct)}% funded</span>
          <span style="font-size:12px;font-family:var(--font-m);color:var(--t2)">
            ${pct >= 100 ? 'Goal reached! 🎉' : fmt(targetAmount - currentValue, true) + ' to go'}
          </span>
        </div>
        <div class="prog">
          <div class="prog-fill${progressCls} goal-prog-fill" style="width:${Math.round(pct)}%"></div>
        </div>
      </div>` : ''}

      <div class="row" style="margin-top:10px;justify-content:space-between;align-items:center">
        <span style="font-size:11.5px;color:var(--t3)">${holdingCount} holding${holdingCount !== 1 ? 's' : ''} mapped</span>
        ${timeLabel ? `<span class="stat-badge ${timeBadgeCls}">${_gEsc(timeLabel)}</span>` : ''}
      </div>
    </div>`;
}

// ── SCREEN: GOAL DETAIL ───────────────────────────────────────────────────────

function renderGoalDetail(el) {
  const goal = (APP.goals || []).find(g => g.id === APP.activeGoalId);
  if (!goal) {
    el.innerHTML = `
      <div style="padding:40px;text-align:center;color:var(--t3)">
        <div style="font-size:13.5px">Goal not found.</div>
        <button class="btn btn-ghost btn-sm" style="margin-top:12px" onclick="navigate('goals')">${ic('arrowLt',12)} Back to Goals</button>
      </div>`;
    return;
  }

  const allocs       = (APP.goalAllocations || []).filter(a => a.goalId === goal.id);
  const currentValue = getGoalCurrentValue(goal.id);
  const targetAmount = Number(goal.targetAmount) || 0;
  const hasTarget    = targetAmount > 0;
  const pct          = hasTarget ? Math.min(100, Math.max(0, (currentValue / targetAmount) * 100)) : null;
  const progressCls  = pct === null ? '' : pct >= 80 ? '' : pct >= 40 ? ' gold' : ' red';

  const targetDateObj = goal.targetDate ? new Date(goal.targetDate + 'T00:00:00') : null;
  const targetDateStr = targetDateObj
    ? targetDateObj.toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' })
    : '—';
  const daysLeft = targetDateObj ? Math.ceil((targetDateObj - new Date()) / 86400000) : null;
  const daysLabel = daysLeft === null ? '—'
    : daysLeft < 0   ? 'Overdue'
    : daysLeft === 0 ? 'Today!'
    : daysLeft + ' days left';

  el.innerHTML = `
    <div class="sh">
      <div class="sh-l">
        <button class="btn btn-ghost btn-sm" onclick="navigate('goals')">${ic('arrowLt',12)} Back</button>
        <div class="sh-title" style="margin-top:4px">
          <span style="margin-right:8px">${goal.icon || '🎯'}</span>${_gEsc(goal.name)}
          <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${_gEsc(goal.color || '#00e5a0')};margin-left:8px;vertical-align:middle"></span>
        </div>
        <div class="sh-sub">${hasTarget ? 'Target: ' + fmt(goal.targetAmount, true) + ' · ' : ''}${targetDateStr !== '—' ? 'Due: ' + targetDateStr : ''}</div>
      </div>
      <div class="sh-r">
        <button class="btn btn-secondary btn-sm" onclick="openEditGoal('${_gEsc(goal.id)}')">${ic('edit',12)} Edit Goal</button>
        <button class="btn btn-primary btn-sm" onclick="openAllocationModal('${_gEsc(goal.id)}',null)">${ic('plus',12)} Add Investment</button>
      </div>
    </div>

    <div class="strip">
      ${statCard('Current Value',   fmt(currentValue, true),  hasTarget && currentValue >= targetAmount ? 'pos' : '',   hasTarget ? Math.round(pct) + '% of target' : 'invested so far')}
      ${hasTarget ? statCard('Target Amount', fmt(goal.targetAmount, true), '', 'your goal') : ''}
      ${hasTarget ? statCard('Remaining', fmt(Math.max(0, targetAmount - currentValue), true), pct >= 100 ? 'pos' : 'neg', pct >= 100 ? 'Goal reached!' : 'still needed') : ''}
      ${statCard('Target Date',     targetDateStr, '', daysLabel)}
      ${statCard('Holdings Mapped', String(allocs.length), '', allocs.length + ' allocation' + (allocs.length !== 1 ? 's' : ''))}
    </div>

    ${hasTarget ? `
    <!-- Progress card -->
    <div class="card">
      <div class="card-hd">
        <div class="card-title">${ic('trending',13)} Progress toward goal</div>
        <span style="font-size:11.5px;color:var(--t3)">${Math.round(pct)}% funded</span>
      </div>
      <div class="card-body">
        <div class="prog" style="height:14px;border-radius:999px">
          <div class="prog-fill${progressCls} goal-prog-fill" style="width:${Math.round(pct)}%;height:14px;border-radius:999px"></div>
        </div>
        <div class="row" style="justify-content:space-between;margin-top:8px">
          <span style="font-size:12px;color:var(--t3)">${fmt(currentValue, true)} invested</span>
          <span style="font-size:12px;font-family:var(--font-m);color:var(--t2)">${fmt(goal.targetAmount, true)} target</span>
        </div>
      </div>
    </div>` : ''}

    <!-- Allocations table -->
    <div class="card">
      <div class="card-hd">
        <div class="card-title">${ic('trending',13)} Mapped Investments <span class="section-count">${allocs.length}</span></div>
        <button class="btn btn-ghost btn-sm" onclick="openAllocationModal('${_gEsc(goal.id)}',null)">${ic('plus',12)} Add Investment</button>
      </div>
      ${allocs.length === 0 ? `
        <div style="padding:28px;text-align:center;color:var(--t3)">
          <div style="font-size:2rem;margin-bottom:10px;opacity:.3">📊</div>
          <div style="font-size:13px;margin-bottom:14px">No investments mapped to this goal yet.</div>
          <button class="btn btn-primary btn-sm" onclick="openAllocationModal('${_gEsc(goal.id)}',null)">${ic('plus',11)} Add Investment to Goal</button>
        </div>
      ` : `
        <div class="tbl-wrap">
          <table class="tbl">
            <thead>
              <tr>
                <th>Investment</th>
                <th>Type</th>
                <th>Ticker</th>
                <th>Allocated Qty</th>
                <th>Total Qty</th>
                <th>Current Price</th>
                <th>Allocated Value</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${allocs.map(a => {
                const inv = APP.investments.find(i => String(i.id) === String(a.investmentId));
                if (!inv) return `<tr><td colspan="8" style="color:var(--t3);font-size:12px;padding:12px">Investment removed — <button class="btn btn-ghost btn-sm" onclick="deleteAllocation('${a.id}')">Remove</button></td></tr>`;
                const cat        = _invCat(inv);
                const totalQty   = _invTotalQty(inv);
                const price      = _invPricePerUnit(inv);
                const allocValue = (Number(a.allocatedQty) || 0) * price;
                return `
                  <tr>
                    <td>
                      <div style="font-weight:600;font-size:13px;color:var(--t1)">${_gEsc(inv.name)}</div>
                    </td>
                    <td><span class="pill ${pillClass(cat)}">${cat}</span></td>
                    <td class="mono muted">${_gEsc(inv.ticker || '—')}</td>
                    <td class="mono">${_fmtQty(a.allocatedQty)}</td>
                    <td class="mono muted">${_fmtQty(totalQty)}</td>
                    <td class="mono">${fmt(price)}</td>
                    <td class="mono text-pos">${fmt(allocValue, true)}</td>
                    <td>
                      <div class="actions">
                        <button class="btn-icon" title="Edit quantity" onclick="openEditAllocation('${a.id}')">${ic('edit',11)}</button>
                        <button class="btn-icon" title="Remove allocation" onclick="deleteAllocation('${a.id}')">${ic('trash',11)}</button>
                      </div>
                    </td>
                  </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      `}
    </div>
  `;
}

// ── GOAL CRUD ─────────────────────────────────────────────────────────────────

let _editGoalId   = null;
let _selGoalIcon  = GOAL_ICONS[0];
let _selGoalColor = GOAL_COLORS[0];

function openAddGoal() {
  _editGoalId   = null;
  _selGoalIcon  = GOAL_ICONS[0];
  _selGoalColor = GOAL_COLORS[0];
  _openGoalModal({ name:'', targetAmount:'', targetDate:'', icon: GOAL_ICONS[0], color: GOAL_COLORS[0] });
}

function openEditGoal(id) {
  const g = (APP.goals || []).find(g => g.id === id);
  if (!g) return;
  _editGoalId   = id;
  _selGoalIcon  = g.icon  || GOAL_ICONS[0];
  _selGoalColor = g.color || GOAL_COLORS[0];
  _openGoalModal(g);
}

function _openGoalModal(g) {
  openModal(`
    <div class="modal-hd">
      <div class="modal-title">${ic(_editGoalId ? 'edit' : 'plus', 14)} ${_editGoalId ? 'Edit' : 'New'} Goal / Category</div>
      <button class="modal-close" onclick="closeModal()">${ic('x',13)}</button>
    </div>
    <div class="modal-body">
      <div class="g-2">
        <div class="inp-grp">
          <div class="inp-label">Goal Name *</div>
          <input class="inp" id="gm-name" placeholder="e.g. Retirement Fund" value="${_gEsc(g.name || '')}" autofocus>
        </div>
        <div class="inp-grp">
          <div class="inp-label">Target Amount ₹</div>
          <input class="inp" id="gm-target" type="number" min="1" placeholder="5000000" value="${_gEsc(String(g.targetAmount || ''))}">
        </div>
      </div>
      <div class="inp-grp">
        <div class="inp-label">Target Date</div>
        <input class="inp" id="gm-date" type="date" value="${_gEsc(g.targetDate || '')}">
      </div>
      <div class="inp-grp">
        <div class="inp-label">Icon</div>
        <div class="goal-icon-grid" id="gm-icon-grid">
          ${GOAL_ICONS.map(ico => `
            <button type="button" class="goal-icon-btn${ico === _selGoalIcon ? ' sel' : ''}"
                    onclick="_selGoalIconFn('${ico}')">${ico}</button>
          `).join('')}
        </div>
      </div>
      <div class="inp-grp">
        <div class="inp-label">Color</div>
        <div class="goal-color-row" id="gm-color-row">
          ${GOAL_COLORS.map(c => `
            <button type="button" class="goal-color-swatch${c === _selGoalColor ? ' sel' : ''}"
                    data-color="${c}" style="background:${c}" onclick="_selGoalColorFn('${c}')">
              ${c === _selGoalColor ? `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="${_isDarkColor(c) ? '#fff' : '#111'}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>` : ''}
            </button>
          `).join('')}
        </div>
      </div>
    </div>
    <div class="modal-ft">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="confirmSaveGoal()">Save Goal</button>
    </div>
  `);
}

function _isDarkColor(hex) {
  const r = parseInt(hex.slice(1, 3), 16) || 0;
  const g = parseInt(hex.slice(3, 5), 16) || 0;
  const b = parseInt(hex.slice(5, 7), 16) || 0;
  return (r * 299 + g * 587 + b * 114) / 1000 < 128;
}

function _selGoalIconFn(ico) {
  _selGoalIcon = ico;
  document.querySelectorAll('#gm-icon-grid .goal-icon-btn').forEach(btn => {
    btn.classList.toggle('sel', btn.textContent.trim() === ico);
  });
}

function _selGoalColorFn(color) {
  _selGoalColor = color;
  const checkSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="${_isDarkColor(color) ? '#fff' : '#111'}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
  document.querySelectorAll('#gm-color-row .goal-color-swatch').forEach(btn => {
    const isSel = btn.dataset.color === color;
    btn.classList.toggle('sel', isSel);
    btn.innerHTML = isSel ? checkSvg : '';
  });
}

function confirmSaveGoal() {
  const name   = document.getElementById('gm-name')?.value.trim();
  const target = parseFloat(document.getElementById('gm-target')?.value) || 0;
  const date   = document.getElementById('gm-date')?.value.trim() || '';

  if (!name)   { alert('Please enter a goal name.');    return; }

  if (_editGoalId) {
    const goal = (APP.goals || []).find(g => g.id === _editGoalId);
    if (goal) {
      goal.name         = name;
      goal.targetAmount = target;
      goal.targetDate   = date;
      goal.icon         = _selGoalIcon;
      goal.color        = _selGoalColor;
    }
  } else {
    if (!APP.goals) APP.goals = [];
    APP.goals.push({
      id:           'g_' + Date.now() + Math.random().toString(36).slice(2, 5),
      name,
      targetAmount: target,
      targetDate:   date,
      icon:         _selGoalIcon,
      color:        _selGoalColor,
      createdAt:    new Date().toISOString(),
    });
  }

  if (typeof saveGoalsConfig === 'function') saveGoalsConfig();
  closeModal();
  navigate(_screen === 'goal-detail' ? 'goal-detail' : 'goals');
}

function deleteGoal(id) {
  const goal = (APP.goals || []).find(g => g.id === id);
  if (!goal || !confirm(`Delete goal "${goal.name}"? This will also remove all its investment allocations.`)) return;
  APP.goals           = APP.goals.filter(g => g.id !== id);
  APP.goalAllocations = (APP.goalAllocations || []).filter(a => a.goalId !== id);
  if (typeof saveGoalsConfig === 'function') saveGoalsConfig();
  navigate('goals');
}

// ── ALLOCATION CRUD ───────────────────────────────────────────────────────────

let _allocGoalId = null;   // null = user picks from dropdown
let _allocInvId  = null;   // null = user picks from dropdown
let _editAllocId = null;   // non-null = editing existing allocation

function openAllocationModal(goalId, invId) {
  _editAllocId = null;
  _allocGoalId = goalId;
  _allocInvId  = invId ? String(invId) : null;
  _renderAllocModal('');
}

function openEditAllocation(allocId) {
  const alloc = (APP.goalAllocations || []).find(a => a.id === allocId);
  if (!alloc) return;
  _editAllocId = allocId;
  _allocGoalId = alloc.goalId;
  _allocInvId  = String(alloc.investmentId);
  _renderAllocModal(alloc.allocatedQty);
}

function _renderAllocModal(prefillQty) {
  const goals  = APP.goals || [];
  const invs   = APP.investments || [];
  const isEdit = !!_editAllocId;

  // Pre-compute availability info for pre-selected investment
  const allocInfo = _allocInvId ? _getAllocInfo(_allocInvId, _editAllocId) : null;

  openModal(`
    <div class="modal-hd">
      <div class="modal-title">${ic(isEdit ? 'edit' : 'plus', 14)} ${isEdit ? 'Edit Allocation' : 'Assign Investment to Goal'}</div>
      <button class="modal-close" onclick="closeModal()">${ic('x',13)}</button>
    </div>
    <div class="modal-body">

      ${_allocGoalId ? `
        <div class="inp-grp">
          <div class="inp-label">Goal</div>
          <div class="inp" style="cursor:default;color:var(--t1)">
            ${(() => { const g = goals.find(g => g.id === _allocGoalId); return g ? _gEsc(g.icon + ' ' + g.name) : '—'; })()}
          </div>
        </div>
      ` : `
        <div class="inp-grp">
          <div class="inp-label">Goal *</div>
          <select class="sel" id="am-goal" onchange="_allocGoalId=this.value">
            <option value="">— Select a goal —</option>
            ${goals.map(g => `<option value="${_gEsc(g.id)}">${_gEsc(g.icon + ' ' + g.name)}</option>`).join('')}
          </select>
        </div>
      `}

      <div class="inp-grp">
        <div class="inp-label">Investment *</div>
        <select class="sel" id="am-inv" ${isEdit || _allocInvId ? 'disabled' : ''}
                onchange="_onAllocInvChange(this.value)">
          <option value="">— Select investment —</option>
          ${invs.map(inv => {
            const totalQty = _invTotalQty(inv);
            const avail    = isEdit && String(inv.id) === _allocInvId
              ? getAvailableQtyExcluding(inv.id, _editAllocId)
              : getAvailableQty(inv.id);
            const sel      = String(inv.id) === _allocInvId ? 'selected' : '';
            const ticker   = inv.ticker ? ' (' + inv.ticker + ')' : '';
            const label    = _gEsc(inv.name + ticker + ' — ' + _fmtQty(totalQty) + ' total, ' + _fmtQty(avail) + ' available');
            return `<option value="${_gEsc(String(inv.id))}" ${sel}>${label}</option>`;
          }).join('')}
        </select>
      </div>

      <div class="inp-grp">
        <div class="inp-label">Quantity to Allocate *</div>
        <input class="inp" id="am-qty" type="number" step="any" min="0.0001"
               value="${prefillQty}"
               placeholder="${allocInfo ? 'Max ' + _fmtQty(allocInfo.available) : 'Enter quantity'}"
               oninput="_validateAllocQty(this)">
        <div id="am-qty-info" style="font-size:11.5px;color:var(--t3);margin-top:5px">
          ${allocInfo
            ? `Available: <strong style="color:var(--t2)">${_fmtQty(allocInfo.available)}</strong> units
               · Already in other goals: <strong style="color:var(--t2)">${_fmtQty(allocInfo.allocatedElsewhere)}</strong> units`
            : 'Select an investment to see availability'}
        </div>
        <div id="am-qty-err" style="font-size:11.5px;color:var(--red);margin-top:4px;display:none"></div>
      </div>

    </div>
    <div class="modal-ft">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="am-save-btn" onclick="confirmSaveAllocation()">${isEdit ? 'Update' : 'Assign'}</button>
    </div>
  `);
}

function _getAllocInfo(invId, excludeAllocId) {
  const inv = APP.investments.find(i => String(i.id) === String(invId));
  if (!inv) return null;
  const totalQty = _invTotalQty(inv);
  const available = excludeAllocId
    ? getAvailableQtyExcluding(invId, excludeAllocId)
    : getAvailableQty(invId);
  const allocatedElsewhere = (APP.goalAllocations || [])
    .filter(a => String(a.investmentId) === String(invId) && a.id !== excludeAllocId)
    .reduce((s, a) => s + (Number(a.allocatedQty) || 0), 0);
  return { totalQty, available, allocatedElsewhere };
}

// Called when investment dropdown changes in allocation modal
function _onAllocInvChange(invId) {
  _allocInvId = invId || null;
  const info  = invId ? _getAllocInfo(invId, null) : null;
  const infoEl = document.getElementById('am-qty-info');
  if (infoEl) {
    infoEl.innerHTML = info
      ? `Available: <strong style="color:var(--t2)">${_fmtQty(info.available)}</strong> units
         · Already in other goals: <strong style="color:var(--t2)">${_fmtQty(info.allocatedElsewhere)}</strong> units`
      : 'Select an investment to see availability';
  }
  const qtyEl = document.getElementById('am-qty');
  if (qtyEl) {
    qtyEl.placeholder = info ? 'Max ' + _fmtQty(info.available) : 'Enter quantity';
    qtyEl.value = '';
  }
  const errEl = document.getElementById('am-qty-err');
  if (errEl) errEl.style.display = 'none';
}

// Live validation as user types in quantity field
function _validateAllocQty(input) {
  const invId  = _allocInvId || document.getElementById('am-inv')?.value;
  const errEl  = document.getElementById('am-qty-err');
  const saveBtn = document.getElementById('am-save-btn');
  if (!errEl || !saveBtn) return;

  if (!invId) {
    errEl.style.display = 'none';
    return;
  }

  const info = _getAllocInfo(invId, _editAllocId);
  if (!info) return;

  const val = parseFloat(input.value);
  if (isNaN(val) || val <= 0) {
    errEl.textContent   = 'Enter a positive quantity.';
    errEl.style.display = '';
    saveBtn.disabled    = true;
  } else if (val > info.available + 0.00001) {
    errEl.textContent   = `Exceeds available quantity of ${_fmtQty(info.available)} units.`;
    errEl.style.display = '';
    saveBtn.disabled    = true;
  } else {
    errEl.style.display = 'none';
    saveBtn.disabled    = false;
  }
}

function confirmSaveAllocation() {
  const goalId = _allocGoalId || document.getElementById('am-goal')?.value;
  const invId  = _allocInvId  || document.getElementById('am-inv')?.value;
  const qty    = parseFloat(document.getElementById('am-qty')?.value) || 0;

  if (!goalId)  { alert('Please select a goal.');        return; }
  if (!invId)   { alert('Please select an investment.'); return; }
  if (qty <= 0) { alert('Enter a positive quantity.');   return; }

  // Enforce available-qty rule before every write
  const available = _editAllocId
    ? getAvailableQtyExcluding(invId, _editAllocId)
    : getAvailableQty(invId);
  if (qty > available + 0.00001) {
    alert(`Quantity (${_fmtQty(qty)}) exceeds available units (${_fmtQty(available)}).`);
    return;
  }

  if (!APP.goalAllocations) APP.goalAllocations = [];

  if (_editAllocId) {
    const alloc = APP.goalAllocations.find(a => a.id === _editAllocId);
    if (alloc) {
      alloc.allocatedQty = qty;
      alloc.updatedAt    = new Date().toISOString();
    }
  } else {
    // If same goal+investment already has an allocation, merge into it
    const existing = APP.goalAllocations.find(
      a => a.goalId === goalId && String(a.investmentId) === String(invId)
    );
    if (existing) {
      existing.allocatedQty = (existing.allocatedQty || 0) + qty;
      existing.updatedAt    = new Date().toISOString();
    } else {
      APP.goalAllocations.push({
        id:           'al_' + Date.now() + Math.random().toString(36).slice(2, 5),
        goalId,
        investmentId: String(invId),
        allocatedQty: qty,
        createdAt:    new Date().toISOString(),
        updatedAt:    new Date().toISOString(),
      });
    }
  }

  if (typeof saveGoalsConfig === 'function') saveGoalsConfig();
  closeModal();
  navigate(_screen === 'goal-detail' ? 'goal-detail' : 'goals');
}

function deleteAllocation(allocId) {
  const alloc = (APP.goalAllocations || []).find(a => a.id === allocId);
  if (!alloc) return;
  const inv = APP.investments.find(i => String(i.id) === String(alloc.investmentId));
  const msg = `Remove allocation of ${_fmtQty(alloc.allocatedQty)} units${inv ? ' of "' + inv.name + '"' : ''} from this goal?`;
  if (!confirm(msg)) return;
  APP.goalAllocations = APP.goalAllocations.filter(a => a.id !== allocId);
  if (typeof saveGoalsConfig === 'function') saveGoalsConfig();
  navigate('goal-detail');
}

// ── UTILITIES ─────────────────────────────────────────────────────────────────

function _gEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _fmtQty(n) {
  if (n == null || !isFinite(Number(n))) return '0';
  const num = Number(n);
  if (Number.isInteger(num)) return num.toLocaleString('en-IN');
  // Show up to 4 decimal places, strip trailing zeros
  return parseFloat(num.toFixed(4)).toLocaleString('en-IN', { maximumFractionDigits: 4 });
}
