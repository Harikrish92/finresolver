/* ============================================================
   import.js — Excel/CSV import: parse, preview, confirm
   FinResolver · finresolver.in

   Supported formats:
   - .xlsx / .xls  (via SheetJS)
   - .csv

   Two import modes:
   1. Standard — matches the FinResolver spreadsheet template:
      Row 0 : "Current Balance" | <amount> | … | "Monthly Checklist"
      Row 1 : "Expense" | | "Income" | | "Investment" | | "Loan" | | <items>
      Row 2 : "Description" | "Amount" | … (column headers)
      Row 3+: data
      Col A–B = Expense, C–D = Income, E–F = Investment, G–H = Loan, I = Checklist

   2. Auto-Detect — scans for any Description+Amount column pairs
   ============================================================ */

let importMode   = 'standard';
let parsedImport = null;

// ── Modal open/close ─────────────────────────────────────────
function openImport() {
  parsedImport = null;
  document.getElementById('importModal').classList.remove('hidden');
  document.getElementById('previewSection').style.display = 'none';
  document.getElementById('importConfirmBtn').disabled = true;
  document.getElementById('fileInput').value = '';
  document.getElementById('userMenu').classList.remove('open');
}

function closeImport() {
  document.getElementById('importModal').classList.add('hidden');
}

// ── Mode toggle ──────────────────────────────────────────────
function setImportMode(m) {
  importMode = m;
  document.getElementById('optStd').classList.toggle('active',  m === 'standard');
  document.getElementById('optAuto').classList.toggle('active', m === 'auto');
}

// ── Drag & drop ──────────────────────────────────────────────
function initImportEvents() {
  const dz = document.getElementById('dropzone');
  dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', ()  => dz.classList.remove('drag-over'));
  dz.addEventListener('drop', e => {
    e.preventDefault(); dz.classList.remove('drag-over');
    if (e.dataTransfer.files.length) processFile(e.dataTransfer.files[0]);
  });
}

function handleFile(e) {
  if (e.target.files.length) processFile(e.target.files[0]);
}

// ── File processing ──────────────────────────────────────────
function processFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();

  if (ext === 'csv') {
    const reader = new FileReader();
    reader.onload = ev => routeParsedRows(csvToRows(ev.target.result));
    reader.readAsText(file);

  } else if (['xlsx','xls'].includes(ext)) {
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const wb   = XLSX.read(ev.target.result, { type: 'array' });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        routeParsedRows(rows);
      } catch (err) {
        showToast('Error reading file: ' + err.message, 'error');
      }
    };
    reader.readAsArrayBuffer(file);

  } else {
    showToast('Unsupported format. Use .xlsx, .xls or .csv', 'error');
  }
}

function routeParsedRows(rows) {
  importMode === 'standard' ? parseStandardRows(rows) : parseAutoRows(rows);
}

function csvToRows(text) {
  return text.trim().split('\n').map(r =>
    r.split(',').map(c => c.trim().replace(/^"|"$/g, ''))
  );
}

function cleanNum(v) {
  const n = parseFloat(String(v).replace(/[₹,\s]/g, ''));
  return isNaN(n) ? 0 : n;
}

// ── Standard parser ──────────────────────────────────────────
function parseStandardRows(rows) {
  const res = { initialAmount:0, expense:[], income:[], investment:[], loan:[], checklist:[] };

  // Row 0, Col B = initial balance
  if (rows[0]) {
    const v = cleanNum(rows[0][1]);
    if (v) res.initialAmount = v;
  }

  // Col I (index 8) throughout = checklist items
  rows.forEach(row => {
    const v = String(row[8] || '').trim();
    if (v
      && !/monthly checklist/i.test(v)
      && !/^description$/i.test(v)
      && !/^amount$/i.test(v)
    ) {
      res.checklist.push({ label: v, done: false });
    }
  });

  // Find the "Description" header row, skip it, then parse data
  let dataStart = 3;
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).toLowerCase() === 'description') {
      dataStart = i + 1;
      break;
    }
  }

  for (let i = dataStart; i < rows.length; i++) {
    const r = rows[i];
    const push = (arr, dI, aI) => {
      const d = String(r[dI] || '').trim();
      const a = cleanNum(r[aI]);
      if (d && a > 0) arr.push({ desc: d, amount: a });
    };
    push(res.expense,    0, 1);
    push(res.income,     2, 3);
    push(res.investment, 4, 5);
    push(res.loan,       6, 7);
  }

  showPreview(res);
}

// ── Auto-detect parser ───────────────────────────────────────
function parseAutoRows(rows) {
  const res = { initialAmount:0, expense:[], income:[], investment:[], loan:[], checklist:[] };

  if (rows[0]) {
    const v = cleanNum(rows[0][1]);
    if (v) res.initialAmount = v;
  }

  const hIdx = rows.findIndex(r => r.some(c => /description/i.test(String(c))));
  if (hIdx < 0) {
    showToast('Could not detect headers. Try Standard Format.', 'error');
    return;
  }

  const headers  = rows[hIdx].map(h => String(h).toLowerCase());
  const cats     = ['expense','income','investment','loan'];
  let catIdx     = 0;
  const sections = [];

  for (let i = 0; i < headers.length; i++) {
    if (/desc/i.test(headers[i])) {
      const aJ = headers.findIndex((h, j) => j > i && /amt|amount/i.test(h));
      if (aJ > 0) {
        sections.push({ type: cats[catIdx % 4], dC: i, aC: aJ });
        catIdx++;
      }
    }
  }

  for (let i = hIdx + 1; i < rows.length; i++) {
    sections.forEach(s => {
      const d = String(rows[i][s.dC] || '').trim();
      const a = cleanNum(rows[i][s.aC]);
      if (d && a > 0) res[s.type].push({ desc: d, amount: a });
    });
  }

  showPreview(res);
}

// ── Preview ──────────────────────────────────────────────────
function showPreview(res) {
  parsedImport = res;

  const all = [
    ...res.expense.map(r    => ({ t:'Expense',    c:'tag-exp',  ...r })),
    ...res.income.map(r     => ({ t:'Income',     c:'tag-inc',  ...r })),
    ...res.investment.map(r => ({ t:'Investment', c:'tag-inv',  ...r })),
    ...res.loan.map(r       => ({ t:'Loan',       c:'tag-loan', ...r })),
  ];

  document.getElementById('previewSection').style.display = 'block';
  document.getElementById('previewHead').innerHTML = '<tr><th>Type</th><th>Description</th><th>Amount</th></tr>';
  document.getElementById('previewBody').innerHTML =
    all.slice(0, 25).map(r =>
      `<tr><td class="${r.c}">${r.t}</td><td>${escHtml(r.desc)}</td><td>${fmt(r.amount)}</td></tr>`
    ).join('') +
    (all.length > 25
      ? `<tr><td colspan="3" class="empty">…and ${all.length - 25} more</td></tr>`
      : '');

  const ckNote = res.checklist.length ? ` + ${res.checklist.length} checklist item(s)` : '';
  document.getElementById('importSummText').innerHTML =
    `Detected: <span class="tag-exp">${res.expense.length} expenses</span>, ` +
    `<span class="tag-inc">${res.income.length} income</span>, ` +
    `<span class="tag-inv">${res.investment.length} investments</span>, ` +
    `<span class="tag-loan">${res.loan.length} loans</span>${ckNote}` +
    (res.initialAmount ? ` | Initial Balance: ${fmt(res.initialAmount)}` : '');

  document.getElementById('importConfirmBtn').disabled =
    all.length === 0 && !res.checklist.length;
}

// ── Confirm & merge ──────────────────────────────────────────
function confirmImport() {
  if (!parsedImport) return;

  if (parsedImport.initialAmount) {
    data.initialAmount = parsedImport.initialAmount;
  }

  ['expense','income','investment','loan'].forEach(t => {
    data[t].push(...parsedImport[t]);
  });

  // Merge checklist — skip duplicate labels (case-insensitive)
  const existing = new Set(data.checklist.map(c => c.label.toLowerCase()));
  parsedImport.checklist.forEach(c => {
    if (!existing.has(c.label.toLowerCase())) data.checklist.push(c);
  });

  saveData(); render(); closeImport();

  const total =
    parsedImport.expense.length +
    parsedImport.income.length  +
    parsedImport.investment.length +
    parsedImport.loan.length;

  showToast(`Successfully imported ${total} entries`, 'success');
}
