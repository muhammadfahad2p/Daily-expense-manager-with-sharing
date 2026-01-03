// =====================
// Expense Manager Pro (Mobile-first)
// =====================

// =====================
// --- CONSTANTS & STATE ---
// =====================
const DRIVE_LOGIN_KEY = 'drive_logged_in';
const CURRENCY_SYMBOL = 'SR ';
const TEMPLATES_KEY = 'expense_templates_v1';

// Keep the same filename everywhere (UI + Drive backup/restore)
const BACKUP_FILENAME = 'expenses_backup.json';

// TODO: replace with your own credentials (Google Cloud Console)
const CLIENT_ID = '388638798642-1vhopf07t99j77ndmn6hnf87nk8n1qlb.apps.googleusercontent.com';
const API_KEY = 'AIzaSyCr8iKxGBW4pSdxMi_aUchUyoHCbe0uFNs';

// Google Drive API discovery doc
const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';
// Use drive.file so the app only accesses files it created/opened
const SCOPES = 'https://www.googleapis.com/auth/drive.file';

let entries = JSON.parse(localStorage.getItem('expense_data_v7')) || [];
// migrate older records (pre-group)
entries = entries.map(e => ({...e, group: (e.group || '').trim()}));
let tokenClient;
let gapiInited = false;
let gisInited = false;

let summaryStartDate = null;
let summaryEndDate = null;

// Summary group filter (string or "__all__")
let summaryGroup = '__all__';

// =====================
// --- UTILITY FUNCTIONS ---
// =====================
function titleCaseWords(str) {
  return (str || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function cleanPersonName(str) {
  // Keep your existing "title-case" behavior for names
  return str ? str.trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : "";
}

function formatCurrency(amount) {
  return CURRENCY_SYMBOL + parseFloat(amount || 0).toFixed(2);
}

function escapeHtml(t) {
  return (t || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function toLocalDateShort(iso) {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

// =====================
// --- INIT ON DOM LOAD ---
// =====================
document.addEventListener('DOMContentLoaded', () => {
  // Wire up a safe click handler too (so button still works if inline onclick changes)
  const connectBtn = document.querySelector('#driveControls button');
  if (connectBtn) connectBtn.addEventListener('click', (e) => { e.preventDefault(); handleAuthClick(); });

  renderList();
  populateNamesAndGroups();
  refreshSummaryGroupDropdown();
  refreshListGroupDropdown();
  refreshListGroupDropdown();
  // preload templates UI if present
  renderTemplatesList();

  // Pre-fill date modals
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('sumStart').value = today;
  document.getElementById('sumEnd').value = today;

  // Default summary group dropdown if exists
  const grpSel = document.getElementById('summaryGroupFilter');
  if (grpSel) grpSel.value = '__all__';

  checkGoogleLoaded();
});

function trySilentReconnect() {
  const wasConnected = localStorage.getItem(DRIVE_LOGIN_KEY) === "1";
  if (!wasConnected || !tokenClient) return;

  // Try silent auth first (no popup)
  tokenClient.requestAccessToken({ prompt: "" });
}



// =====================
// --- RENDERING FUNCTIONS ---
// =====================
function renderList() {
  const container = document.getElementById('listContainer');
  const search = (document.getElementById('searchInput').value || '').toLowerCase();
  const type = document.getElementById('searchType').value;

  let data = [...entries].sort((a, b) => new Date(b.date) - new Date(a.date));

  // List group filter
  const grpSel = document.getElementById('listGroupFilter');
  const listGroup = grpSel ? (grpSel.value || '__all__') : '__all__';
  if (listGroup !== '__all__') {
    data = data.filter(e => (e.group || '').trim() === listGroup);
  }

  if (search) {
    data = data.filter(e => {
      const itemMatch = (e.item || '').toLowerCase().includes(search);
      const paidMatch = (e.paidBy || '').toLowerCase().includes(search);
      const consMatch = (e.consumedBy || '').toLowerCase().includes(search);
      const groupMatch = (e.group || '').toLowerCase().includes(search);
      const priceMatch = (String(e.price ?? '')).includes(search);

      if (type === 'all') return itemMatch || paidMatch || consMatch || groupMatch || priceMatch;
      if (type === 'item') return itemMatch;
      if (type === 'paid') return paidMatch;
      if (type === 'consumed') return consMatch;
      if (type === 'group') return groupMatch;
      if (type === 'price') return priceMatch;
      return false;
    });
  }

  const total = data.reduce((s, e) => s + parseFloat(e.price || 0), 0);
  document.getElementById('headerTotal').innerText = formatCurrency(total);

  if (data.length === 0) {
    container.innerHTML = `<div style="text-align:center; padding:40px; color:#94a3b8;">No records found.</div>`;
    return;
  }

  container.innerHTML = data.map(e => {
    const groupPill = e.group ? `<span class="pill" style="background:#f1f5f9;color:#0f172a;">${escapeHtml(e.group)}</span>` : '';
    return `
      <div class="card" onclick="editEntry(${e.id})">
        <div class="card-row-1">
          <span class="card-title">${escapeHtml(e.item)}</span>
          <span class="card-price">${formatCurrency(e.price)}</span>
        </div>
        <div class="card-row-2">
          <div class="card-meta">
            <i class="far fa-calendar"></i>
            <span>${toLocalDateShort(e.date)}</span>
          </div>
          <div class="card-meta" style="gap:6px; flex-wrap:wrap; justify-content:flex-end;">
            ${groupPill}
            <span class="pill">${escapeHtml(e.paidBy)}</span>
            <i class="fas fa-arrow-right" style="font-size:0.7rem"></i>
            <span style="max-width:110px; overflow:hidden; white-space:nowrap; text-overflow:ellipsis;">${escapeHtml(e.consumedBy)}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderMap(map) {
  return Object.keys(map).sort().map(k => {
    if (map[k] < 0.01) return '';
    return `<div class="stat-row"><span>${k}</span><span>${formatCurrency(map[k])}</span></div>`;
  }).join('') || '<div style="text-align:center; color:#ccc">-</div>';
}

// =====================
// --- SUMMARY FUNCTIONS ---
// =====================
function openDateModal() {
  document.getElementById('modalDateFilter').classList.add('active');
}

function applyDateFilter() {
  const sVal = document.getElementById('sumStart').value;
  const eVal = document.getElementById('sumEnd').value;

  if (sVal && eVal) {
    summaryStartDate = new Date(sVal);
    summaryEndDate = new Date(eVal);
    summaryEndDate.setHours(23, 59, 59);

    const fmtStart = summaryStartDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    const fmtEnd = summaryEndDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    document.getElementById('currentRangeDisplay').innerText = `${fmtStart} - ${fmtEnd}`;

    calculateSummary();
    closeModal('modalDateFilter');
  } else {
    alert("Please select both start and end dates");
  }
}

function resetDates() {
  document.getElementById('sumStart').value = new Date().toISOString().split('T')[0];
  document.getElementById('sumEnd').value = new Date().toISOString().split('T')[0];
  summaryStartDate = null;
  summaryEndDate = null;
  document.getElementById('currentRangeDisplay').innerText = "All Time";
  calculateSummary();
}

function refreshSummaryGroupDropdown() {
  const sel = document.getElementById('summaryGroupFilter');
  if (!sel) return;

  const existing = sel.value || '__all__';

  const groups = Array.from(new Set(entries.map(e => (e.group || '').trim()).filter(Boolean))).sort();
  sel.innerHTML = `<option value="__all__">All Groups</option>` + groups.map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
  // restore selection
  if ([...sel.options].some(o => o.value === existing)) sel.value = existing;
  else sel.value = '__all__';
}

function refreshListGroupDropdown() {
  const sel = document.getElementById('listGroupFilter');
  if (!sel) return;

  const existing = sel.value || '__all__';
  const groups = Array.from(new Set(entries.map(e => (e.group || '').trim()).filter(Boolean))).sort();
  sel.innerHTML = `<option value="__all__">All Groups</option>` + groups.map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');

  if ([...sel.options].some(o => o.value === existing)) sel.value = existing;
  else sel.value = '__all__';
}


function calculateSummary() {
  // Read summary group from dropdown if exists
  const sel = document.getElementById('summaryGroupFilter');
  if (sel) summaryGroup = sel.value || '__all__';

  let data = entries;

  // Apply date filter
  if (summaryStartDate && summaryEndDate) {
    data = data.filter(x => {
      const d = new Date(x.date);
      return d >= summaryStartDate && d <= summaryEndDate;
    });
  }

  // Apply group filter
  if (summaryGroup && summaryGroup !== '__all__') {
    data = data.filter(x => (x.group || '').trim() === summaryGroup);
  }

  const paidTotals = {};
  const consTotals = {};
  const debts = {};

  data.forEach(entry => {
    const price = parseFloat(entry.price);
    const payers = (entry.paidBy || '').split(/[,&|]+/).map(cleanPersonName).filter(n => n);
    const consumers = (entry.consumedBy || '').split(/[,&|]+/).map(cleanPersonName).filter(n => n);
    if (payers.length === 0 || consumers.length === 0 || !(price > 0)) return;

    const amountPerPayer = price / payers.length;
    const amountPerConsumer = price / consumers.length;

    payers.forEach(p => { paidTotals[p] = (paidTotals[p] || 0) + amountPerPayer; });
    consumers.forEach(c => { consTotals[c] = (consTotals[c] || 0) + amountPerConsumer; });

    const debtPerPayer = amountPerConsumer / payers.length;
    consumers.forEach(c => {
      payers.forEach(p => {
        if (c !== p) {
          if (!debts[c]) debts[c] = {};
          debts[c][p] = (debts[c][p] || 0) + debtPerPayer;
        }
      });
    });
  });

  document.getElementById('paidArea').innerHTML = renderMap(paidTotals);
  document.getElementById('consumedArea').innerHTML = renderMap(consTotals);

  // Simplify pairwise debts
  const settlements = [];
  const people = Array.from(new Set([...Object.keys(paidTotals), ...Object.keys(consTotals)]));
  for (let i = 0; i < people.length; i++) {
    for (let j = i + 1; j < people.length; j++) {
      const p1 = people[i], p2 = people[j];
      const d1 = (debts[p1] && debts[p1][p2]) || 0;
      const d2 = (debts[p2] && debts[p2][p1]) || 0;
      const net = d1 - d2;
      if (net > 0.01) settlements.push({ from: p1, to: p2, amt: net });
      else if (net < -0.01) settlements.push({ from: p2, to: p1, amt: -net });
    }
  }

  document.getElementById('settlementArea').innerHTML = settlements.length
    ? settlements.map(s => `<div class="settle-item"><i class="fas fa-check-circle"></i> ${s.from} pays ${s.to} <b>${formatCurrency(s.amt)}</b></div>`).join('')
    : `<div style="text-align:center; color:#94a3b8;">All Settled</div>`;
}

// =====================
// --- CRUD FUNCTIONS ---
// =====================
function openEntryModal() {
  document.getElementById('modalTitle').innerText = "Add Expense";
  document.getElementById('entryId').value = "";
  document.getElementById('inpDate').value = new Date().toISOString().slice(0, 16);
  document.getElementById('inpItem').value = "";
  document.getElementById('inpPrice').value = "";
  const grp = document.getElementById('inpGroup');
  if (grp) grp.value = "";
  document.getElementById('inpPaid').value = "";
  document.getElementById('inpConsumed').value = "";
  document.getElementById('inpDesc').value = "";
  document.getElementById('editTools').classList.add('hidden');
  document.getElementById('modalEntry').classList.add('active');
}

function editEntry(id) {
  const e = entries.find(x => x.id === id);
  if (!e) return;
  document.getElementById('modalTitle').innerText = "Edit Expense";
  document.getElementById('entryId').value = e.id;
  document.getElementById('inpDate').value = String(e.date || '').slice(0, 16);
  document.getElementById('inpItem').value = e.item || '';
  document.getElementById('inpPrice').value = e.price ?? '';
  const grp = document.getElementById('inpGroup');
  if (grp) grp.value = e.group || '';
  document.getElementById('inpPaid').value = e.paidBy || '';
  document.getElementById('inpConsumed').value = e.consumedBy || '';
  document.getElementById('inpDesc').value = e.desc || "";
  document.getElementById('editTools').classList.remove('hidden');
  document.getElementById('modalEntry').classList.add('active');
}

function saveEntry() {
  const id = document.getElementById('entryId').value;
  const dateStr = document.getElementById('inpDate').value;
  const item = document.getElementById('inpItem').value.trim();
  const price = parseFloat(document.getElementById('inpPrice').value);
  const group = titleCaseWords((document.getElementById('inpGroup')?.value || '')).trim();

  const paidBy = (document.getElementById('inpPaid').value || '')
    .split(/[,&|]+/)
    .map(cleanPersonName)
    .filter(n => n)
    .join(', ');

  const consumedBy = (document.getElementById('inpConsumed').value || '')
    .split(/[,&|]+/)
    .map(cleanPersonName)
    .filter(n => n)
    .join(', ');

  const desc = document.getElementById('inpDesc').value;

  if (!dateStr || !item || isNaN(price) || !paidBy || !consumedBy) {
    alert("Please fill in Date, Item, Price, and Names.");
    return;
  }

  const obj = {
    id: id ? parseInt(id) : Date.now(),
    date: new Date(dateStr).toISOString(),
    item,
    price,
    paidBy,
    consumedBy,
    group,
    desc
  };

  if (id) {
    const idx = entries.findIndex(x => x.id == id);
    if (idx > -1) entries[idx] = obj;
  } else {
    entries.push(obj);
  }

  persist();
  refreshSummaryGroupDropdown();
  refreshListGroupDropdown();
  closeModal('modalEntry');
  renderList();

  // Optional: if Drive session is active, auto-backup
  // (won't prompt sign-in; will only run if token exists)
  autoBackupIfConnected();
}

function deleteEntry() {
  if (!confirm("Delete record?")) return;
  const idStr = (document.getElementById('entryId').value || '').trim();
  if (!idStr) { alert('No record selected.'); return; }
  const id = parseInt(idStr);
  entries = entries.filter(x => x.id !== id);
  persist();
  refreshSummaryGroupDropdown();
  refreshListGroupDropdown();
  closeModal('modalEntry');
  renderList();
  autoBackupIfConnected();
}

// Copy button: open a centered date picker modal (mobile friendly)
let _copySourceId = null;

function triggerCopy() {
  const idVal = document.getElementById('entryId').value;
  if (!idVal) {
    alert('Open a record first, then tap Copy.');
    return;
  }
  _copySourceId = parseInt(idVal);

  const picker = document.getElementById('copyDatePicker');
  if (picker) {
    picker.value = new Date().toISOString().split('T')[0];
  }
  document.getElementById('modalCopyDate').classList.add('active');
}

function confirmCopyWithDate() {
  const picker = document.getElementById('copyDatePicker');
  const dateVal = picker ? picker.value : '';
  if (!dateVal) {
    alert('Please select a date.');
    return;
  }

  const src = entries.find(x => x.id == _copySourceId);
  if (!src) {
    alert('Could not find the record to copy.');
    closeModal('modalCopyDate');
    return;
  }

  // set midday to avoid timezone edge-cases
  const d = new Date(dateVal);
  d.setHours(12, 0, 0, 0);

  const newId = Date.now();
  const copy = { ...src, id: newId, date: d.toISOString() };

  entries.push(copy);
  persist();
  refreshSummaryGroupDropdown();
  refreshListGroupDropdown();
  renderList();

  closeModal('modalCopyDate');
  // Open the copied record so user can edit and then tap Save Record
  editEntry(newId);

  // tiny feedback
  alert('Copied! You can edit and Save Record.');
}

// Kept for backward compatibility (HTML still has #copyDateInput)
function finishCopy() {
  // legacy; no-op
}

// =====================
// --- CSV IMPORT/EXPORT ---
// =====================
function handleFileSelect(input) {
  const file = input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (e) {
    importCSV(e.target.result);
    input.value = "";
  };
  reader.readAsText(file);
}

function importCSV(csvText) {
  const lines = csvText.split('\n');
  let count = 0;
  const startIndex = lines[0]?.toLowerCase().includes('date') ? 1 : 0;

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const matches = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g);
    const cols = matches ? matches.map(m => m.replace(/^"|"$/g, '')) : line.split(',');

    // Expect: Date, Item, Price, PaidBy, ConsumedBy, (optional) Description, (optional) Group
    if (cols.length >= 5) {
      const d = new Date(cols[0]);
      const item = (cols[1] || "Imported Item").trim();
      const price = parseFloat(cols[2]) || 0;
      const paidBy = cols[3] || "Unknown";
      const consumedBy = cols[4] || "Unknown";
      const desc = cols[5] || "";
      const group = cols[6] || "";

      if (!isNaN(d.getTime()) && price > 0) {
        entries.push({
          id: Date.now() + count,
          date: d.toISOString(),
          item,
          price,
          paidBy: paidBy.split(/[,&|]+/).map(cleanPersonName).filter(Boolean).join(', '),
          consumedBy: consumedBy.split(/[,&|]+/).map(cleanPersonName).filter(Boolean).join(', '),
          group: titleCaseWords(group),
          desc: desc.trim()
        });
        count++;
      }
    }
  }

  if (count > 0) {
    persist();
    refreshSummaryGroupDropdown();
  refreshListGroupDropdown();
    alert(`Successfully imported ${count} records!`);
    renderList();
  } else {
    alert("Failed to import. Check CSV format.");
  }
}

function executeExport(type) {
  const sVal = document.getElementById('expStart').value;
  const eVal = document.getElementById('expEnd').value;

  let data = entries;
  if (sVal && eVal) {
    const s = new Date(sVal);
    const e = new Date(eVal);
    e.setHours(23, 59, 59, 999);
    data = entries.filter(x => {
      const d = new Date(x.date);
      return d >= s && d <= e;
    });
  }

  let csv = "Date,Item,Price,PaidBy,ConsumedBy,Description,Group\n";
  data.forEach(r => {
    const d = new Date(r.date).toLocaleDateString();
    csv += `${d},"${(r.item || '').replace(/"/g, '""')}",${r.price},"${(r.paidBy || '').replace(/"/g, '""')}","${(r.consumedBy || '').replace(/"/g, '""')}","${(r.desc || '').replace(/"/g, '""')}","${(r.group || '').replace(/"/g, '""')}"\n`;
  });

  const file = new File([csv], "expenses.csv", { type: 'text/csv' });

  if (type === 'share' && navigator.canShare && navigator.canShare({ files: [file] })) {
    navigator.share({ files: [file] });
  } else {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = 'expenses.csv';
    a.click();
  }

  closeModal('modalExport');
}

// =====================
// --- LOCAL STORAGE ---
// =====================
function persist() {
  localStorage.setItem('expense_data_v7', JSON.stringify(entries));
  populateNamesAndGroups();
}

function populateNamesAndGroups() {
  // People names (for datalist)
  const names = new Set();
  const groups = new Set();

  entries.forEach(e => {
    (e.paidBy || '').split(',').forEach(x => { const v = x.trim(); if (v) names.add(v); });
    (e.consumedBy || '').split(',').forEach(x => { const v = x.trim(); if (v) names.add(v); });
    const g = (e.group || '').trim();
    if (g) groups.add(g);
  });

  const namesList = document.getElementById('namesList');
  if (namesList) namesList.innerHTML = [...names].sort().map(n => `<option value="${escapeHtml(n)}">`).join('');

  const groupsList = document.getElementById('groupsList');
  if (groupsList) groupsList.innerHTML = [...groups].sort().map(g => `<option value="${escapeHtml(g)}">`).join('');
}

// =====================
// --- MODAL & UI ---
// =====================
function closeModal(id) { document.getElementById(id).classList.remove('active'); }

function clearAllData() {
  if (confirm("Permanently delete all local data?")) {
    entries = [];
    persist();
    refreshSummaryGroupDropdown();
  refreshListGroupDropdown();
    renderList();
    autoBackupIfConnected();
  }
}

function switchView(id) {
  document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));

  if (id === 'list') {
    document.getElementById('viewList').classList.add('active');
    document.getElementById('btnList').classList.add('active');
    renderList();
  } else if (id === 'summary') {
    document.getElementById('viewSummary').classList.add('active');
    document.getElementById('btnSum').classList.add('active');
    refreshSummaryGroupDropdown();
  refreshListGroupDropdown();
    calculateSummary();
  } else {
    document.getElementById('viewSettings').classList.add('active');
    document.getElementById('btnSet').classList.add('active');
  }
}

function openExportModal() { document.getElementById('modalExport').classList.add('active'); }

// HTML uses onclick="handleAuthClick()"
function handleAuthClick() {
  // If Google scripts are still loading, retry and inform user
  if (!gisInited || !gapiInited) {
    document.getElementById('syncStatus').innerText = "Loading Google libraries... try again in a second.";
    checkGoogleLoaded();
    setTimeout(() => {
      if (!gisInited || !gapiInited) alert("Google libraries are still loading. Please try again.");
    }, 600);
    return;
  }
  loginDrive();
}

// =====================
// --- GOOGLE DRIVE ---
// =====================
let _googleLoadAttempts = 0;
function checkGoogleLoaded() {
  const statusEl = document.getElementById('syncStatus');

  const haveGis = (typeof google !== 'undefined' && google.accounts && google.accounts.oauth2);
  const haveGapi = (typeof gapi !== 'undefined');

  if (haveGis && haveGapi) {
    gisLoaded();
    gapiLoaded();
    return;
  }

  _googleLoadAttempts++;
  if (statusEl) {
    statusEl.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Loading Google scripts...';
  }

  // After ~12 seconds, stop looping and show a helpful message
  if (_googleLoadAttempts > 24) {
    if (statusEl) {
      statusEl.innerHTML = '<span style="color:#b91c1c; font-weight:600;">Google scripts failed to load.</span><br><span style="font-size:0.85rem; color:#64748b;">Check your internet, disable ad-blockers for this site, and ensure apis.google.com is not blocked.</span>';
    }
    // Still show the connect button (user can retry by reloading)
    const controls = document.getElementById('driveControls');
    if (controls) controls.classList.remove('hidden');
    return;
  }

  setTimeout(checkGoogleLoaded, 500);
}


function gapiLoaded() {
  gapi.load('client', async () => {
    try {
      await gapi.client.init({ apiKey: API_KEY, discoveryDocs: [DISCOVERY_DOC] });
      gapiInited = true;
      updateDriveUI();
    } catch (e) {
      console.error(e);
      alert("Failed to load Google API.");
    }
  });
}

function gisLoaded() {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: async (resp) => {
      if (resp.error) {
        console.error(resp);
        alert("Drive login failed.");
        return;
      }

      localStorage.setItem(DRIVE_LOGIN_KEY, '1');
      document.getElementById('syncStatus').classList.add('active');
      document.getElementById('syncStatus').innerHTML = '<span style="color:green">Connected to Drive</span>';
      document.getElementById('driveControls').classList.add('hidden');
      document.getElementById('driveActions').classList.remove('hidden');

      // Auto-restore right after login (if backup exists)
      await restoreFromDrive(true);

      // And do an immediate backup after restore (keeps Drive in sync)
      await autoBackupIfConnected();
    }
  });

  gisInited = true;
  updateDriveUI();
  // Attempt silent reconnect on refresh if user connected before
trySilentReconnect();

}

function updateDriveUI() {
  if (!(gapiInited && gisInited)) return;

  const hasToken = !!(gapi.client && gapi.client.getToken && gapi.client.getToken());
  const wasConnected = localStorage.getItem(DRIVE_LOGIN_KEY) === '1';

  if (hasToken) {
    document.getElementById('syncStatus').classList.add('active');
    document.getElementById('syncStatus').innerHTML = '<span style="color:green">Connected to Drive</span>';
    document.getElementById('driveControls').classList.add('hidden');
    document.getElementById('driveActions').classList.remove('hidden');
  } else {
    document.getElementById('syncStatus').classList.remove('active');
    document.getElementById('syncStatus').innerText = wasConnected ? "Reconnect to Drive (session expired)." : "Ready to connect.";
    document.getElementById('driveControls').classList.remove('hidden');
    document.getElementById('driveActions').classList.add('hidden');
  }
}

async function loginDrive() {
  if (!tokenClient) {
    alert("Google sign-in is not ready yet. Refresh and try again.");
    return;
  }

  const wasConnected = localStorage.getItem(DRIVE_LOGIN_KEY) === "1";

  // If user connected before, try normal prompt first (less annoying).
  // If it fails, user can tap again and it will show chooser.
  tokenClient.requestAccessToken({ prompt: wasConnected ? "" : "select_account" });
}

async function findLatestBackupFileId(token) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=name="${BACKUP_FILENAME}"&orderBy=modifiedTime desc&fields=files(id,name,modifiedTime)&pageSize=1`,
    { headers: { Authorization: 'Bearer ' + token } }
  );
  const data = await res.json();
  if (!data.files || data.files.length === 0) return null;
  return data.files[0].id;
}

async function uploadBackupMultipart(token, fileIdOrNull) {
  const blob = new Blob([JSON.stringify(entries)], { type: 'application/json' });
  const metadata = { name: BACKUP_FILENAME, mimeType: 'application/json' };

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', blob);

  const url = fileIdOrNull
    ? `https://www.googleapis.com/upload/drive/v3/files/${fileIdOrNull}?uploadType=multipart`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;

  const method = fileIdOrNull ? 'PATCH' : 'POST';

  const res = await fetch(url, {
    method,
    headers: { Authorization: 'Bearer ' + token },
    body: form
  });

  return res.ok;
}

async function backupToDrive() {
  try {
    const token = gapi.client.getToken() ? gapi.client.getToken().access_token : null;
    if (!token) { alert("Not logged in!"); return; }

    const fileId = await findLatestBackupFileId(token);
    const ok = await uploadBackupMultipart(token, fileId);

    if (ok) alert("Backup saved to Google Drive!");
    else alert("Drive backup failed.");
  } catch (e) {
    console.error(e);
    alert("Drive backup failed.");
  }
}

async function restoreFromDrive(silent = false) {
  try {
    const token = gapi.client.getToken() ? gapi.client.getToken().access_token : null;
    if (!token) { if (!silent) alert("Not logged in!"); return false; }

    const fileId = await findLatestBackupFileId(token);
    if (!fileId) { if (!silent) alert("No backup found."); return false; }

    const fileRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: { Authorization: 'Bearer ' + token }
    });

    const text = await fileRes.text();
    const parsed = JSON.parse(text);

    if (!Array.isArray(parsed)) { if (!silent) alert("Backup file is invalid."); return false; }

    // Upgrade older backups that don't have `group`
    entries = parsed.map(e => ({
      id: e.id ?? Date.now(),
      date: e.date ?? new Date().toISOString(),
      item: e.item ?? '',
      price: e.price ?? 0,
      paidBy: e.paidBy ?? '',
      consumedBy: e.consumedBy ?? '',
      group: e.group ?? '',
      desc: e.desc ?? ''
    }));

    persist();
    refreshSummaryGroupDropdown();
  refreshListGroupDropdown();
    renderList();

    if (!silent) alert("Backup restored!");
    return true;
  } catch (e) {
    console.error(e);
    if (!silent) alert("Drive restore failed.");
    return false;
  }
}

async function autoBackupIfConnected() {
  try {
    const token = gapi?.client?.getToken?.() ? gapi.client.getToken().access_token : null;
    if (!token) return;
    const fileId = await findLatestBackupFileId(token);
    await uploadBackupMultipart(token, fileId);
  } catch (e) {
    // Silent by design
    console.warn('Auto-backup skipped:', e);
  }
}


// =====================
// --- TEMPLATES ---
// =====================
function loadTemplates() {
  try {
    const raw = localStorage.getItem(TEMPLATES_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveTemplates(arr) {
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(arr || []));
}

function renderTemplatesList() {
  const holder = document.getElementById('templatesList');
  if (!holder) return;

  const templates = loadTemplates();
  if (templates.length === 0) {
    holder.innerHTML = '<div style="text-align:center; color:#94a3b8; padding:10px;">No templates yet.</div>';
    return;
  }

  holder.innerHTML = templates
    .map((t, idx) => {
      const title = escapeHtml(t.name || ('Template ' + (idx + 1)));
      const subtitle = `${escapeHtml(t.item || '')} • ${formatCurrency(t.price || 0)} • ${escapeHtml(t.group || 'No Group')}`;
      return `
        <div class="card" style="padding:12px;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">
            <div style="flex:1; min-width:0;">
              <div style="font-weight:700; margin-bottom:4px;">${title}</div>
              <div style="font-size:0.85rem; color:#64748b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${subtitle}</div>
            </div>
            <div style="display:flex; gap:8px;">
              <button class="btn btn-copy" style="padding:10px 12px;" onclick="applyTemplate(${idx})"><i class="fas fa-check"></i></button>
              <button class="btn btn-danger" style="padding:10px 12px;" onclick="deleteTemplate(${idx})"><i class="fas fa-trash"></i></button>
            </div>
          </div>
        </div>
      `;
    })
    .join('');
}

function openTemplatesModal() {
  const modal = document.getElementById('modalTemplates');
  if (!modal) return;
  document.getElementById('tplName').value = '';
  renderTemplatesList();
  modal.classList.add('active');
}

function saveCurrentAsTemplate() {
  const name = (document.getElementById('tplName').value || '').trim();
  if (!name) {
    alert('Please enter a template name.');
    return;
  }

  // Use current fields from the entry modal if present; otherwise use empty.
  const tpl = {
    name,
    item: (document.getElementById('inpItem')?.value || '').trim(),
    price: parseFloat(document.getElementById('inpPrice')?.value || '0') || 0,
    group: (document.getElementById('inpGroup')?.value || '').trim(),
    paidBy: (document.getElementById('inpPaid')?.value || '').trim(),
    consumedBy: (document.getElementById('inpConsumed')?.value || '').trim(),
    desc: (document.getElementById('inpDesc')?.value || '').trim()
  };

  const templates = loadTemplates();
  templates.push(tpl);
  saveTemplates(templates);
  renderTemplatesList();
  alert('Template saved.');
}

function applyTemplate(idx) {
  const templates = loadTemplates();
  const t = templates[idx];
  if (!t) return;

  // Open entry modal and apply
  openEntryModal();

  if (t.item) document.getElementById('inpItem').value = t.item;
  if (t.price) document.getElementById('inpPrice').value = t.price;
  if (t.group) document.getElementById('inpGroup').value = t.group;
  if (t.paidBy) document.getElementById('inpPaid').value = t.paidBy;
  if (t.consumedBy) document.getElementById('inpConsumed').value = t.consumedBy;
  if (t.desc) document.getElementById('inpDesc').value = t.desc;

  closeModal('modalTemplates');
}

function deleteTemplate(idx) {
  if (!confirm('Delete this template?')) return;
  const templates = loadTemplates();
  templates.splice(idx, 1);
  saveTemplates(templates);
  renderTemplatesList();
}

// expose for inline onclick
Object.assign(window, {switchView, openEntryModal, saveEntry, editEntry, deleteEntry, triggerCopy, confirmCopyWithDate, openTemplatesModal, saveCurrentAsTemplate, applyTemplate, deleteTemplate, backupToDrive, restoreFromDrive, handleAuthClick, openDateModal, applyDateFilter, resetDates, openExportModal, executeExport, clearAllData, closeModal});
