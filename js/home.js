/* ============================================================
   home.js — Dashboard / home screen logic
   FinResolver · finresolver.in
   ============================================================ */

/** Navigate from home → tracker */
function goToTracker() {
  document.getElementById('homeScreen').style.display  = 'none';
  document.getElementById('appMain').style.display     = 'block';
  document.getElementById('btnBackHome').style.display = 'flex';
  render();
}

/** Navigate back to home */
function goToHome() {
  document.getElementById('appMain').style.display     = 'none';
  document.getElementById('homeScreen').style.display  = 'block';
  document.getElementById('btnBackHome').style.display = 'none';
  renderHomeDashboard();
}

/** Render the home dashboard stats */
function renderHomeDashboard() {
  const uid = (typeof fbAuth !== 'undefined' && fbAuth?.currentUser?.uid)
              ? fbAuth.currentUser.uid : (currentUser?.uid || 'guest');

  const now   = new Date();
  const yr    = now.getFullYear();
  const mo    = now.getMonth();

  // Current month balance
  const curBal = getMonthBalance(uid, yr, mo);

  // Last 3 months total expense (excl loans) for FIRE
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
  let ytdInc = 0, ytdExp = 0;
  for (let m = 0; m <= mo; m++) {
    const raw = localStorage.getItem(`fr_data_${uid}_${yr}_${m}`);
    if (raw) {
      const d = JSON.parse(raw);
      ytdInc += sumArr(d.income || []);
      ytdExp += sumArr(d.expense || []);
    }
  }
  const ytdSavings = ytdInc - ytdExp;

  // Current month name
  const monthName = MONTHS[mo];

  // Set welcome
  const name = currentUser?.name?.split(' ')[0] || 'there';
  document.getElementById('homeWelcomeName').textContent = name;
  document.getElementById('homeMonthName').textContent   = monthName;

  // Set stats
  document.getElementById('homeStatBalance').textContent = fmtCrore(Math.abs(curBal));
  document.getElementById('homeStatBalance').style.color = curBal >= 0 ? 'var(--accent)' : 'var(--accent2)';
  document.getElementById('homeStatFire').textContent    = fireNumber > 0 ? fmtCrore(fireNumber) : '—';
  document.getElementById('homeStatYTD').textContent     = fmtCrore(Math.abs(ytdSavings));
  document.getElementById('homeStatYTD').style.color     = ytdSavings >= 0 ? 'var(--accent)' : 'var(--accent2)';

  // Month quick summary
  const curRaw = localStorage.getItem(`fr_data_${uid}_${yr}_${mo}`);
  const curData = curRaw ? JSON.parse(curRaw) : null;
  const curExp  = curData ? sumArr(curData.expense) : 0;
  const curInc  = curData ? sumArr(curData.income)  : 0;
  document.getElementById('homeStatMonthExp').textContent = fmt(curExp);
  document.getElementById('homeStatMonthInc').textContent = fmt(curInc);
}

/** Called from applyUser — shows home instead of tracker directly */
function showHomeScreen() {
  document.getElementById('loginScreen').style.display  = 'none';
  document.getElementById('appMain').style.display      = 'none';
  document.getElementById('homeScreen').style.display   = 'block';
  document.getElementById('btnBackHome').style.display  = 'none';
  renderHomeDashboard();
}
