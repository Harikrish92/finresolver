// ── APP STATE ─────────────────────────────────────────────────────────────────
const _now = new Date();
const APP = {
  user: { name: 'Guest', email: '', initials: 'G' },
  theme: 'dark',
  synced: false,
  activeLoanId: null,
  activeInvFilter: 'ALL',
  invSort: { col: 'value', dir: 'desc' },

  monthly: {
    year:  _now.getFullYear(),
    month: _now.getMonth() + 1,  // 1-indexed (1=Jan … 12=Dec)
    initialBalance: 0,
    expenses: [], income: [], investments: [], loans: [],
    checklist: [
      { id: 1, label: 'HDFC CC Bill',  done: false },
      { id: 2, label: 'IDFC CC Bill',  done: false },
      { id: 3, label: 'SC CC Bill',    done: false },
      { id: 4, label: 'Amex CC Bill',  done: false },
    ],
    notes: [],
  },

  investments: [],
  loans: [],
  history: [],
  lifestyle: { goods: [], events: [] },
};

// ── UTILITIES ─────────────────────────────────────────────────────────────────
function fmt(n, compact = false) {
  if (n === undefined || n === null) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (compact && abs >= 10000000) return sign + '₹' + (abs / 10000000).toFixed(2) + 'Cr';
  if (compact && abs >= 100000)   return sign + '₹' + (abs / 100000).toFixed(1) + 'L';
  if (compact && abs >= 1000)     return sign + '₹' + (abs / 1000).toFixed(1) + 'K';
  return sign + '₹' + abs.toLocaleString('en-IN');
}

function fmtPct(n) {
  if (!isFinite(n)) return '0.00%';
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

function monthName(m) {
  return ['', 'January','February','March','April','May','June',
    'July','August','September','October','November','December'][m];
}

function calcEMI(p, r, n) {
  if (!n) return 0;
  if (r === 0) return p / n;
  const mr = r / 12 / 100;
  return p * mr * Math.pow(1 + mr, n) / (Math.pow(1 + mr, n) - 1);
}

// ── V1/V2 field adapters ──────────────────────────────────────────────────────
// V1 stores: loan.interestRate / loan.tenureMonths
// V2 stores: loan.rate / loan.tenure
function _loanRate(loan)   { return loan.rate    !== undefined ? Number(loan.rate)   : Number(loan.interestRate   || 0); }
function _loanTenure(loan) { return loan.tenure  !== undefined ? Number(loan.tenure) : Number(loan.tenureMonths   || 0); }

// V1 stores: inv.category / inv.lots[] / inv.qty / inv.avgPrice / inv.buyPricePerGram
// V2 stores: inv.cat / inv.qty / inv.avgPrice / inv.buyPrice / inv.livePrice
function _invCat(inv) { return inv.cat || inv.category || 'Others'; }

function _invTotalQty(inv) {
  if (inv.lots && inv.lots.length) return inv.lots.reduce((s, l) => s + (parseFloat(l.qty) || 0), 0);
  return inv.grams || inv.qty || 0;
}

function _invAvgPrice(inv) {
  if (inv.lots && inv.lots.length) {
    const qty = _invTotalQty(inv);
    const cost = inv.lots.reduce((s, l) => s + (parseFloat(l.qty)||0) * (parseFloat(l.price)||parseFloat(l.avgPrice)||0), 0);
    return qty ? cost / qty : 0;
  }
  return inv.avgPrice || 0;
}

function _invGoldBuyPrice(inv) { return inv.buyPrice || inv.buyPricePerGram || inv.avgPrice || 0; }

// ─────────────────────────────────────────────────────────────────────────────

function calcAmortization(loan) {
  const rate   = _loanRate(loan);
  const tenure = _loanTenure(loan);
  if (!tenure) return [];
  const emi = loan.emiOverride || calcEMI(loan.principal || 0, rate, tenure);
  const mr = rate / 12 / 100;
  let balance = Number(loan.principal) || 0;
  const rows = [];
  const start = new Date(loan.startDate);
  for (let i = 1; i <= tenure; i++) {
    const interest = balance * mr;
    const principal = Math.max(0, emi - interest);
    balance = Math.max(0, balance - principal);
    const due = new Date(start);
    due.setMonth(due.getMonth() + i);
    rows.push({
      num: i,
      date: due.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }),
      emi: Math.round(emi),
      principal: Math.round(principal),
      interest: Math.round(interest),
      balance: Math.round(balance)
    });
  }
  return rows;
}

function monthsElapsed(startDate) {
  return Math.floor((Date.now() - new Date(startDate)) / (30.44 * 86400000));
}

function loanOutstanding(loan) {
  const rows   = calcAmortization(loan);
  const tenure = _loanTenure(loan);
  const paid   = Math.min(monthsElapsed(loan.startDate), tenure);
  return paid >= rows.length ? 0 : (rows[paid]?.balance || 0);
}

function loanEMI(loan) {
  return Math.round(loan.emiOverride || calcEMI(Number(loan.principal) || 0, _loanRate(loan), _loanTenure(loan)));
}

function getMonthlyTotals() {
  const m = APP.monthly;
  const income      = m.income.reduce((a, i) => a + i.amount, 0);
  const expenses    = m.expenses.reduce((a, i) => a + i.amount, 0);
  const investments = m.investments.reduce((a, i) => a + i.amount, 0);
  const loans       = m.loans.reduce((a, i) => a + i.amount, 0);
  const balance     = m.initialBalance + income - expenses - investments - loans;
  return { income, expenses, investments, loans, balance };
}

function getPortfolioStats() {
  let totalInvested = 0, currentValue = 0;
  APP.investments.forEach(inv => {
    const cost = invCost(inv);
    const curr = invValue(inv);
    if (isFinite(cost)) totalInvested += cost;
    if (isFinite(curr)) currentValue  += curr;
  });
  const pnl       = currentValue - totalInvested;
  const pnlPct    = totalInvested ? (pnl / totalInvested) * 100 : 0;
  const totalDebt = APP.loans.reduce((a, l) => a + loanOutstanding(l), 0);
  const { balance } = getMonthlyTotals();
  const netWorth  = currentValue + balance - totalDebt;
  return { totalInvested, currentValue, pnl, pnlPct, totalDebt, netWorth, cashBalance: balance };
}

function invCost(inv) {
  const cat = _invCat(inv);
  if (cat === 'Gold') return (_invTotalQty(inv)) * _invGoldBuyPrice(inv);
  if (cat === 'RealEstate' || cat === 'Real Estate') return Number(inv.buyPrice || inv.avgPrice || 0);
  if (cat === 'EPF') return Number(inv.buyPrice || inv.avgPrice || 0);
  if (inv.lots && inv.lots.length) {
    return inv.lots.reduce((s, l) => s + (parseFloat(l.qty)||0) * (parseFloat(l.price)||parseFloat(l.avgPrice)||0), 0);
  }
  return Number(inv.qty || 0) * Number(inv.avgPrice || 0);
}

function invValue(inv) {
  const cat = _invCat(inv);
  if (cat === 'Gold') {
    const grams   = _invTotalQty(inv);
    const liveP   = inv.livePrice || _invGoldBuyPrice(inv);
    return grams * (liveP || 0);
  }
  if (cat === 'RealEstate' || cat === 'Real Estate') return Number(inv.curPrice || inv.livePrice || inv.buyPrice || inv.avgPrice || 0);
  if (cat === 'EPF') return Number(inv.curPrice || inv.livePrice || inv.buyPrice || inv.avgPrice || 0);
  const qty = _invTotalQty(inv);
  if (inv.livePrice) return qty * Number(inv.livePrice);
  return invCost(inv); // fallback to cost when no live price
}

function pillClass(cat) {
  const map = { Stock:'p-stock', MF:'p-mf', FD:'p-fd', Bond:'p-bond',
    EPF:'p-epf', ESOP:'p-esop', 'Real Estate':'p-re', RealEstate:'p-re',
    Gold:'p-gold', Others:'p-other' };
  return map[cat] || 'p-other';
}

function loanPillClass(type) {
  const map = { Home:'p-home', Vehicle:'p-vehicle', Personal:'p-personal', Education:'p-education' };
  return map[type] || 'p-other';
}

// SVG icons (inline paths)
const IC = {
  home:        '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  calendar:    '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  trending:    '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
  trendingDn:  '<polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/>',
  card:        '<rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>',
  target:      '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  plus:        '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  edit:        '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
  trash:       '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>',
  check:       '<polyline points="20 6 9 17 4 12"/>',
  chevDn:      '<polyline points="6 9 12 15 18 9"/>',
  chevRt:      '<polyline points="9 18 15 12 9 6"/>',
  chevLt:      '<polyline points="15 18 9 12 15 6"/>',
  upload:      '<polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>',
  download:    '<polyline points="8 17 12 21 16 17"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"/>',
  refresh:     '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
  x:           '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  search:      '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  arrowRt:     '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
  arrowLt:     '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
  sun:         '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>',
  moon:        '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  zap:         '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  bar:         '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  pie:         '<path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
  menu:        '<line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>',
  file:        '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  info:        '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
  pin:         '<line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24z"/>',
  alert:       '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  wallet:      '<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>',
  lifestyle:   '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  settings:    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
};

function ic(name, size = 15) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${IC[name] || ''}</svg>`;
}

// Chart color palette
const CHART_COLORS = ['#00e5a0','#4dabf7','#ffc947','#a78bfa','#ff5c7a','#fb923c','#2dd4bf','#f472b6'];
