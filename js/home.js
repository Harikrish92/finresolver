/* ============================================================
   home.js — Dashboard / home screen logic
   FinResolver · finresolver.in
   ============================================================ */

/** Navigate from home → tracker */
function goToTracker() {
  document.getElementById('homeScreen').style.display  = 'none';
  document.getElementById('appMain').style.display     = 'block';
  document.getElementById('btnBackHome').style.display = 'flex';

  // Show tracker-only header controls (month selector, sync status, import)
  const tc = document.getElementById('headerTrackerControls');
  if (tc) tc.style.display = 'flex';

  // FIX: Always reload from storage for the current user before rendering.
  // Without this, a guest login after a real-user session shows the previous
  // user's in-memory data because the global `data` variable is never reset.
  if (typeof syncLoadData === 'function' && typeof syncReady !== 'undefined' && syncReady) {
    syncLoadData();
  } else {
    loadData();
  }
}

/** Navigate back to home */
function goToHome() {
  document.getElementById('appMain').style.display     = 'none';
  document.getElementById('homeScreen').style.display  = 'block';
  document.getElementById('btnBackHome').style.display = 'none';

  // Hide tracker-only header controls on home screen
  const tc = document.getElementById('headerTrackerControls');
  if (tc) tc.style.display = 'none';

  renderHomeDashboard();
}

/** Render the home dashboard stats */
function renderHomeDashboard() {
  const uid = (typeof fbAuth !== 'undefined' && fbAuth?.currentUser?.uid)
              ? fbAuth.currentUser.uid : (currentUser?.uid || 'guest');

  const now   = new Date();
  const yr    = now.getFullYear();
  const mo    = now.getMonth();

  // ── Fix 1: detect whether any data exists yet for this user ──
  // On first login the localStorage cache is empty until syncPrefetchPastMonths
  // completes. Show a subtle "loading" state instead of all-zero stats.
  const hasAnyData = (() => {
    for (let i = 0; i <= 3; i++) {
      let m = mo - i, y = yr;
      if (m < 0) { m += 12; y--; }
      if (localStorage.getItem(`fr_data_${uid}_${y}_${m}`)) return true;
    }
    return false;
  })();

  const isSyncing = typeof syncReady !== 'undefined' && !syncReady
                    && typeof db !== 'undefined' && db !== null;

  // Current month balance
  const curBal = getMonthBalance(uid, yr, mo);

  // Last 3 months total expense for FIRE — Fix 3: now populated by prefetch
  let totalExp = 0, monthsWithData = 0;
  for (let i = 0; i < 3; i++) {
    let m = mo - i, y = yr;
    if (m < 0) { m += 12; y--; }
    const raw = localStorage.getItem(`fr_data_${uid}_${y}_${m}`);
    if (raw) {
      const d = JSON.parse(raw);
      totalExp += sumArr(d.expense || []);
      monthsWithData++;
    }
  }
  const avgMonthlyExp = monthsWithData ? totalExp / monthsWithData : 0;
  const fireNumber    = avgMonthlyExp * 12 * 25;

  // YTD savings
  let ytdInc = 0, ytdExp = 0, ytdLoan=0;
  for (let m = 0; m <= mo; m++) {
    const raw = localStorage.getItem(`fr_data_${uid}_${yr}_${m}`);
    if (raw) {
      const d = JSON.parse(raw);
      ytdInc += sumArr(d.income   || []);
      ytdExp += sumArr(d.expense  || []);
      ytdLoan += sumArr(d.loan || []);
    }
  }
  const ytdSavings = ytdInc - ytdExp - ytdLoan;

  const monthName = MONTHS[mo];
  const name      = currentUser?.name?.split(' ')[0] || 'there';

  // Helper: safely set textContent only if element exists
  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  setText('homeWelcomeName', name);
  setText('homeMonthName',   monthName);

  // If we're still fetching on a fresh login, show a loading indicator
  const placeholder = (!hasAnyData && isSyncing) ? '…' : null;

  const balEl = document.getElementById('homeStatBalance');
  if (balEl) {
    balEl.textContent = placeholder ?? fmtCrore(Math.abs(curBal));
    balEl.style.color = curBal >= 0 ? 'var(--accent)' : 'var(--accent2)';
  }

  setText('homeStatFire', placeholder ?? (fireNumber > 0 ? fmtCrore(fireNumber) : '—'));

  const ytdEl = document.getElementById('homeStatYTD');
  if (ytdEl) {
    ytdEl.textContent = placeholder ?? fmtCrore(Math.abs(ytdSavings));
    ytdEl.style.color = ytdSavings >= 0 ? 'var(--accent)' : 'var(--accent2)';
  }

  // Month quick summary
  const curRaw  = localStorage.getItem(`fr_data_${uid}_${yr}_${mo}`);
  const curData = curRaw ? JSON.parse(curRaw) : null;
  const curExp  = curData ? sumArr(curData.expense) : 0;
  const curInc  = curData ? sumArr(curData.income)  : 0;
  setText('homeStatMonthExp', placeholder ?? fmt(curExp));
  setText('homeStatMonthInc', placeholder ?? fmt(curInc)); // element optional
}

/** Called from applyUser — shows home instead of tracker directly */
function showHomeScreen() {
  document.getElementById('loginScreen').style.display  = 'none';
  document.getElementById('appMain').style.display      = 'none';
  document.getElementById('homeScreen').style.display   = 'block';
  document.getElementById('btnBackHome').style.display  = 'none';

  // Always hide tracker-only controls when on home screen
  const tc = document.getElementById('headerTrackerControls');
  if (tc) tc.style.display = 'none';

  renderHomeDashboard();
}
