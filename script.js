// =====================
// Expense Manager Pro (Mobile-first)
// =====================

// =====================
// --- CONSTANTS & STATE ---
// =====================
const DRIVE_LOGIN_KEY = "drive_logged_in";
const CURRENCY_SYMBOL = "SR ";
const TEMPLATES_KEY = "expense_templates_v1";
// Settled batches archive storage
const SETTLED_BATCHES_KEY = "expense_settled_batches_v1";

// Paid-state map for settlement lines (per filter batch)
const SETTLEMENT_PAID_KEY = "expense_settlement_paid_v1";

// Keep the same filename everywhere (UI + Drive backup/restore)
const BACKUP_FILENAME = "expenses_backup.json";

// TODO: replace with your own credentials (Google Cloud Console)
const CLIENT_ID =
  "388638798642-1vhopf07t99j77ndmn6hnf87nk8n1qlb.apps.googleusercontent.com";
const API_KEY = "AIzaSyCr8iKxGBW4pSdxMi_aUchUyoHCbe0uFNs";

// Google Drive API discovery doc
const DISCOVERY_DOC =
  "https://www.googleapis.com/discovery/v1/apis/drive/v3/rest";
// Use drive.file so the app only accesses files it created/opened
const SCOPES = "https://www.googleapis.com/auth/drive.file";

let entries = JSON.parse(localStorage.getItem("expense_data_v7")) || [];
// migrate older records (pre-group)
entries = entries.map((e) => ({ ...e, group: (e.group || "").trim() }));
let tokenClient;
let gapiInited = false;
let gisInited = false;

let summaryStartDate = null;
let summaryEndDate = null;
let _lastFocusEl = null;

// Summary group filter (string or "__all__")
let summaryGroup = "__all__"; // =====================
// --- LIST PERIOD STATE ---
// =====================
let listPeriod = "daily"; // 'daily' | 'monthly' | 'yearly'
let listCursor = new Date(); // controls which day/month/year is shown

const NAMES_KEY = "expense_names_v1";

// =====================
// --- UTILITY FUNCTIONS ---
// =====================
function titleCaseWords(str) {
  return (str || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function cleanPersonName(str) {
  // Keep your existing "title-case" behavior for names
  return str
    ? str
        .trim()
        .toLowerCase()
        .replace(/\b\w/g, (c) => c.toUpperCase())
    : "";
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
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

// =====================
// --- MODERN CONFIRM (no browser confirm) ---
// =====================
let _uiConfirmResolver = null;
let _uiConfirmLastFocus = null;

function uiConfirm(opts = {}) {
  const overlay = document.getElementById("uiConfirmOverlay");
  const titleEl = document.getElementById("uiConfirmTitle");
  const subEl = document.getElementById("uiConfirmSub");
  const msgEl = document.getElementById("uiConfirmMsg");
  const detailsEl = document.getElementById("uiConfirmDetails");
  const okBtn = document.getElementById("uiConfirmOkBtn");
  const cancelBtn = document.getElementById("uiConfirmCancelBtn");

  if (
    !overlay ||
    !titleEl ||
    !subEl ||
    !msgEl ||
    !detailsEl ||
    !okBtn ||
    !cancelBtn
  ) {
    return Promise.resolve(confirm(opts?.message || "Are you sure?"));
  }

  titleEl.textContent = opts.title || "Confirm";
  subEl.textContent = opts.sub || "";
  msgEl.textContent = opts.message || "Are you sure?";

  if (opts.detailsHtml) {
    detailsEl.style.display = "";
    detailsEl.innerHTML = opts.detailsHtml;
  } else {
    detailsEl.style.display = "none";
    detailsEl.innerHTML = "";
  }

  okBtn.textContent = opts.okText || "OK";
  cancelBtn.textContent = opts.cancelText || "Cancel";

  // ✅ remember what had focus before opening
  _uiConfirmLastFocus = document.activeElement;

  overlay.classList.add("active");
  overlay.setAttribute("aria-hidden", "false");

  // ✅ focus OK button after it becomes visible
  requestAnimationFrame(() => okBtn.focus());

  return new Promise((resolve) => {
    _uiConfirmResolver = resolve;
  });
}

function uiConfirmClose(result) {
  const overlay = document.getElementById("uiConfirmOverlay");

  // ✅ move focus back OUTSIDE the overlay BEFORE aria-hidden
  if (_uiConfirmLastFocus && typeof _uiConfirmLastFocus.focus === "function") {
    _uiConfirmLastFocus.focus();
  }
  _uiConfirmLastFocus = null;

  if (overlay) {
    overlay.classList.remove("active");
    overlay.setAttribute("aria-hidden", "true");
  }

  if (typeof _uiConfirmResolver === "function") {
    const r = _uiConfirmResolver;
    _uiConfirmResolver = null;
    r(!!result);
  }
}

// Close confirm on click outside + ESC
document.addEventListener("click", (e) => {
  const overlay = document.getElementById("uiConfirmOverlay");
  if (!overlay || !overlay.classList.contains("active")) return;
  if (e.target === overlay) uiConfirmClose(false);
});
document.addEventListener("keydown", (e) => {
  const overlay = document.getElementById("uiConfirmOverlay");
  if (!overlay || !overlay.classList.contains("active")) return;
  if (e.key === "Escape") uiConfirmClose(false);
});


document.addEventListener("pointerdown", (e) => {
  const inp = e.target.closest("#modalNamePicker input[type='text'], #modalNamePicker input[type='search']");
  if (!inp) return;

  // Allow typing only when user taps the input
  inp.removeAttribute("readonly");

  // Small delay helps mobile browsers focus correctly
  setTimeout(() => inp.focus(), 0);
});
// =====================
// --- SETTLED BATCHES ---
// =====================
function loadSettledBatches() {
  try {
    const raw = localStorage.getItem(SETTLED_BATCHES_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveSettledBatches(arr) {
  localStorage.setItem(SETTLED_BATCHES_KEY, JSON.stringify(arr || []));
}

function loadSettledBatches() {
  try {
    const raw = localStorage.getItem(SETTLED_BATCHES_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveSettledBatches(arr) {
  localStorage.setItem(SETTLED_BATCHES_KEY, JSON.stringify(arr || []));
}

function loadSettlementPaidMap() {
  try {
    const raw = localStorage.getItem(SETTLEMENT_PAID_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}

function escapeAttr(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function saveSettlementPaidMap(mapObj) {
  localStorage.setItem(SETTLEMENT_PAID_KEY, JSON.stringify(mapObj || {}));
}

// =====================
// --- SETTLEMENT "PAID" CHECKLIST (per summary filter) ---
// =====================
function _summaryContextKey() {
  const s = summaryStartDate
    ? new Date(summaryStartDate).toISOString().slice(0, 10)
    : "all";
  const e = summaryEndDate
    ? new Date(summaryEndDate).toISOString().slice(0, 10)
    : "all";
  const g = summaryGroup || "__all__";
  return `${s}|${e}|${g}`;
}
function loadSettlementPaidMap() {
  try {
    const raw = localStorage.getItem(SETTLEMENT_PAID_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}
function saveSettlementPaidMap(map) {
  localStorage.setItem(SETTLEMENT_PAID_KEY, JSON.stringify(map || {}));
}
function isSettlementPaid(settleKey) {
  const map = loadSettlementPaidMap();
  const batchKey = getCurrentSettlementBatchKey();
  return !!(map[batchKey] && map[batchKey][settleKey]);
}

function getCurrentSettlementBatchKey() {
  const start = summaryStartDate
    ? new Date(summaryStartDate).toISOString().slice(0, 10)
    : "all";
  const end = summaryEndDate
    ? new Date(summaryEndDate).toISOString().slice(0, 10)
    : "all";
  const grp = summaryGroup || "__all__";
  return `${start}__${end}__${grp}`;
}

function setSettlementPaid(settleKey, paid) {
  const map = loadSettlementPaidMap();
  const batchKey = getCurrentSettlementBatchKey();
  if (!map[batchKey]) map[batchKey] = {};
  if (paid) map[batchKey][settleKey] = 1;
  else delete map[batchKey][settleKey];
  saveSettlementPaidMap(map);
}
function toggleSettlementPaid(k) {
  const ctx = _summaryContextKey();
  const paidMap = loadSettlementPaidMap();
  if (!paidMap[ctx]) paidMap[ctx] = {};

  // keys stored exactly like: "from__to"
  if (paidMap[ctx][k]) delete paidMap[ctx][k];
  else paidMap[ctx][k] = 1;

  saveSettlementPaidMap(paidMap);
  console.log("TOGGLE PAID:", ctx, k, loadSettlementPaidMap());
}

function markAllSettlementsPaid(keysOrJson) {
  const ctx = _summaryContextKey();

  // ✅ Accept array OR JSON string (backward compatible)
  let keys = [];
  if (Array.isArray(keysOrJson)) {
    keys = keysOrJson;
  } else if (typeof keysOrJson === "string") {
    try {
      keys = JSON.parse(keysOrJson);
    } catch {
      keys = [];
    }
  }

  if (!keys.length) return;

  const paidMap = loadSettlementPaidMap();
  if (!paidMap[ctx]) paidMap[ctx] = {};

  keys.forEach((k) => {
    paidMap[ctx][k] = 1;
  });

  saveSettlementPaidMap(paidMap);
}

// =====================
// --- SUMMARY FILTERED ENTRIES HELPERS ---
// =====================
function getSummaryFilteredEntries() {
  let data = entries;

  if (summaryStartDate && summaryEndDate) {
    data = data.filter((x) => {
      const d = new Date(x.date);
      return d >= summaryStartDate && d <= summaryEndDate;
    });
  }
  if (summaryGroup && summaryGroup !== "__all__") {
    data = data.filter((x) => (x.group || "").trim() === summaryGroup);
  }
  return data;
}

// =====================
// --- BACKUP PAYLOAD (includes entries + settled history + templates + names) ---
// =====================
function buildBackupPayload() {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    entries: entries || [],
    settledBatches: loadSettledBatches(), // ✅ archived history
    settlementPaidMap: loadSettlementPaidMap?.() || {}, // ✅ paid flags (if you use it)
    templates: loadTemplates?.() || [], // optional
    namesCatalog: loadNamesCatalog?.() || [], // optional
  };
}

function applyBackupPayload(payload) {
  if (!payload || typeof payload !== "object")
    throw new Error("Invalid backup payload");

  // Support old backups that were just an array of entries:
  if (Array.isArray(payload)) {
    entries = payload;
    persist();
    return;
  }

  // New format:
  entries = Array.isArray(payload.entries) ? payload.entries : [];

  // Restore archives + paid map
  if (Array.isArray(payload.settledBatches))
    saveSettledBatches(payload.settledBatches);
  if (
    payload.settlementPaidMap &&
    typeof payload.settlementPaidMap === "object" &&
    saveSettlementPaidMap
  ) {
    saveSettlementPaidMap(payload.settlementPaidMap);
  }

  // Restore templates + names (optional)
  if (Array.isArray(payload.templates) && saveTemplates)
    saveTemplates(payload.templates);
  if (Array.isArray(payload.namesCatalog) && saveNamesCatalog)
    saveNamesCatalog(payload.namesCatalog);

  persist();
}

async function syncBackupIfConnected() {
  try {
    const token = gapi?.client?.getToken?.()
      ? gapi.client.getToken().access_token
      : null;
    if (!token) return false;
    const fileId = await findLatestBackupFileId(token);
    return await uploadBackupMultipart(token, fileId);
  } catch {
    return false;
  }
}

// =====================
// --- INIT ON DOM LOAD ---
// =====================
document.addEventListener("DOMContentLoaded", () => {
  document.body.classList.add("compact"); // default ON

  // Wire up a safe click handler too (so button still works if inline onclick changes)
  const connectBtn = document.querySelector("#driveControls button");
  if (connectBtn)
    connectBtn.addEventListener("click", (e) => {
      e.preventDefault();
      handleAuthClick();
    });

  mergeNamesFromEntries();
  renderList();
  populateNamesAndGroups();
  refreshSummaryGroupDropdown();
  refreshListGroupDropdown();
  refreshListGroupDropdown();
  // preload templates UI if present
  renderTemplatesList();

  // Pre-fill date modals
  const today = new Date().toISOString().split("T")[0];
  document.getElementById("sumStart").value = today;
  document.getElementById("sumEnd").value = today;

  // Default summary group dropdown if exists
  const grpSel = document.getElementById("summaryGroupFilter");
  if (grpSel) grpSel.value = "__all__";

  checkGoogleLoaded();
});

document.addEventListener("click", async (e) => {
  const delBtn = e.target.closest(".name-del-btn");
  if (!delBtn) return;

  e.preventDefault();
  e.stopPropagation(); // prevent selecting the row

  const row = delBtn.closest(".name-pick-row");
  const name = row?.getAttribute("data-name");
  if (!name) return;

  const { activeCount, archivedCount } = getAllNamesUsedCounts(name);

  if (activeCount > 0 || archivedCount > 0) {
    // Use your modern confirm/alert if available
    const msg =
      `You can't delete "${cleanPersonName(name)}" because it is used.\n\n` +
      `Active records: ${activeCount}\nArchived records: ${archivedCount}`;

    if (typeof uiConfirm === "function") {
      await uiConfirm({
        title: "Can't delete",
        message: msg,
        okText: "OK",
        cancelText: "",
      });
    } else {
      alert(msg);
    }
    return;
  }

  // Confirm delete
  let ok = true;
  if (typeof uiConfirm === "function") {
    ok = await uiConfirm({
      title: "Delete name?",
      message: `Delete "${cleanPersonName(name)}" from the list?`,
      sub: "This name is not used in any record.",
      okText: "Delete",
      cancelText: "Cancel",
    });
  } else {
    ok = confirm(`Delete "${cleanPersonName(name)}"?`);
  }
  if (!ok) return;

  removeNameFromCatalog(name);

  // Re-render picker list + dropdown displays
  if (typeof renderNamePickerList === "function") renderNamePickerList();
  if (typeof renderNameDropdownLists === "function") renderNameDropdownLists();
});

// =====================
// --- RENDERING FUNCTIONS ---
// =====================
function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}
function endOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}
function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}
function endOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}
function startOfYear(d) {
  return new Date(d.getFullYear(), 0, 1, 0, 0, 0, 0);
}
function endOfYear(d) {
  return new Date(d.getFullYear(), 11, 31, 23, 59, 59, 999);
}

function getListPeriodBounds() {
  if (listPeriod === "monthly") {
    return { start: startOfMonth(listCursor), end: endOfMonth(listCursor) };
  }
  if (listPeriod === "yearly") {
    return { start: startOfYear(listCursor), end: endOfYear(listCursor) };
  }
  return { start: startOfDay(listCursor), end: endOfDay(listCursor) };
}

function updateDateStrip(balanceAmount) {
  const dayEl = document.getElementById("listDayNumber");
  const monthEl = document.getElementById("listMonthYear");
  const wkEl = document.getElementById("listWeekday");
  const balEl = document.getElementById("listBalance");
  if (!dayEl || !monthEl || !wkEl || !balEl) return; // header UI not present

  const d = new Date(listCursor);
  if (listPeriod === "daily") {
    dayEl.textContent = String(d.getDate()).padStart(2, "0");
    monthEl.textContent = d.toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
    });
    wkEl.textContent = d.toLocaleDateString(undefined, { weekday: "long" });
  } else if (listPeriod === "monthly") {
    dayEl.textContent = String(d.getMonth() + 1).padStart(2, "0");
    monthEl.textContent = d.toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
    });
    wkEl.textContent = "Monthly";
  } else {
    const yy = String(d.getFullYear()).slice(-2);
    dayEl.textContent = yy;
    monthEl.textContent = "Year " + d.getFullYear();
    wkEl.textContent = "Yearly";
  }

  balEl.textContent = formatCurrency(balanceAmount || 0);
}

function setListPeriod(period) {
  listPeriod = period;
  // update tab UI
  document.querySelectorAll(".period-tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.period === period);
  });
  // keep cursor valid
  listCursor = new Date(listCursor || new Date());
  renderList();
}

function shiftListDate(delta) {
  const d = new Date(listCursor);
  if (listPeriod === "monthly") {
    d.setMonth(d.getMonth() + delta);
  } else if (listPeriod === "yearly") {
    d.setFullYear(d.getFullYear() + delta);
  } else {
    d.setDate(d.getDate() + delta);
  }
  listCursor = d;
  renderList();
}

function openListDatePicker() {
  if (listPeriod === "daily") {
    const inp = document.getElementById("listDatePicker");
    if (!inp) return;
    inp.value = startOfDay(listCursor).toISOString().slice(0, 10);
    inp.click();
    return;
  }
  if (listPeriod === "monthly") {
    openMonthPicker();
    return;
  }
  // yearly: quick prompt
  const y = prompt("Enter year (e.g. 2026):", String(listCursor.getFullYear()));
  if (!y) return;
  const yr = parseInt(y, 10);
  if (!isNaN(yr) && yr >= 1900 && yr <= 2100) {
    const d = new Date(listCursor);
    d.setFullYear(yr);
    listCursor = d;
    renderList();
  }
}

function onListDatePicked(val) {
  if (!val) return;
  const [yy, mm, dd] = val.split("-").map((x) => parseInt(x, 10));
  if (!yy || !mm || !dd) return;
  listCursor = new Date(yy, mm - 1, dd, 12, 0, 0, 0);
  renderList();
}

// =====================
// --- MONTH PICKER ---
// =====================
let monthPickerYear = new Date().getFullYear();
function openMonthPicker() {
  monthPickerYear = listCursor.getFullYear();
  renderMonthPicker();
  const modal = document.getElementById("modalMonthPicker");
  if (modal) modal.classList.add("active");
}
function shiftMonthPicker(deltaYears) {
  monthPickerYear += deltaYears;
  renderMonthPicker();
}
function renderMonthPicker() {
  const yearEl = document.getElementById("monthPickerYear");
  const grid = document.getElementById("monthGrid");
  if (!yearEl || !grid) return;
  yearEl.textContent = String(monthPickerYear);
  const activeMonth = listCursor.getMonth();
  const activeYear = listCursor.getFullYear();
  const months = Array.from({ length: 12 }, (_, i) =>
    new Date(2000, i, 1).toLocaleDateString(undefined, { month: "short" })
  );
  grid.innerHTML = months
    .map((m, i) => {
      const active =
        activeYear === monthPickerYear && activeMonth === i ? "active" : "";
      return `<button class="month-btn ${active}" type="button" onclick="pickMonth(${i})">${m}</button>`;
    })
    .join("");
}
function pickMonth(monthIdx) {
  const d = new Date(listCursor);
  d.setFullYear(monthPickerYear);
  d.setMonth(monthIdx);
  listCursor = d;
  closeModal("modalMonthPicker");
  renderList();
}

// =====================
// --- NAMES CATALOG (Paid/Consumed dropdowns) ---
// =====================
function loadNamesCatalog() {
  try {
    const raw = localStorage.getItem(NAMES_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter(Boolean).map(cleanPersonName) : [];
  } catch {
    return [];
  }
}

function getAllNamesUsedCounts(nameRaw) {
  const target = cleanPersonName(nameRaw);
  let activeCount = 0;
  let archivedCount = 0;

  // Active entries
  (entries || []).forEach((e) => {
    const paid = (e.paidBy || "").split(/[,&|]+/).map(cleanPersonName);
    const cons = (e.consumedBy || "").split(/[,&|]+/).map(cleanPersonName);
    if (paid.includes(target) || cons.includes(target)) activeCount++;
  });

  // Archived batches (Settled History)
  const batches = loadSettledBatches ? loadSettledBatches() || [] : [];
  batches.forEach((b) => {
    (b.entries || []).forEach((e) => {
      const paid = (e.paidBy || "").split(/[,&|]+/).map(cleanPersonName);
      const cons = (e.consumedBy || "").split(/[,&|]+/).map(cleanPersonName);
      if (paid.includes(target) || cons.includes(target)) archivedCount++;
    });
  });

  return { activeCount, archivedCount };
}

function removeNameFromCatalog(nameRaw) {
  const target = cleanPersonName(nameRaw);
  const names = loadNamesCatalog();
  const filtered = names.filter((n) => cleanPersonName(n) !== target);
  saveNamesCatalog(filtered);
}

function saveNamesCatalog(arr) {
  const uniq = Array.from(
    new Set((arr || []).map(cleanPersonName).filter(Boolean))
  ).sort();
  localStorage.setItem(NAMES_KEY, JSON.stringify(uniq));
  renderNameDropdownLists();
}
function mergeNamesFromEntries() {
  const names = new Set(loadNamesCatalog());
  entries.forEach((e) => {
    (e.paidBy || "").split(",").forEach((x) => {
      const v = cleanPersonName(x);
      if (v) names.add(v);
    });
    (e.consumedBy || "").split(",").forEach((x) => {
      const v = cleanPersonName(x);
      if (v) names.add(v);
    });
  });
  saveNamesCatalog([...names]);
}
function addNameFromInput(which) {
  const inp = document.getElementById(
    which === "paid" ? "paidNewName" : "consumedNewName"
  );
  if (!inp) return;
  const name = cleanPersonName(inp.value || "");
  if (!name) return;
  const names = loadNamesCatalog();
  names.push(name);
  saveNamesCatalog(names);
  inp.value = "";
}

function toggleNameDropdown(which, forceClose = false) {
  const panelId = which === "paid" ? "paidPanel" : "consumedPanel";
  const panel = document.getElementById(panelId);
  if (!panel) return;
  const isOpen = !panel.classList.contains("hidden");
  if (forceClose || isOpen) {
    panel.classList.add("hidden");
    return;
  }
  // close the other
  const other = document.getElementById(
    which === "paid" ? "consumedPanel" : "paidPanel"
  );
  if (other) other.classList.add("hidden");
  renderNameDropdownLists();
  panel.classList.remove("hidden");
}

function renderNameDropdownLists() {
  const names = loadNamesCatalog();

  // Paid (radio)
  const paidList = document.getElementById("paidList");
  const paidHidden = document.getElementById("inpPaid");
  const paidDisplay = document.getElementById("paidDisplay");
  if (paidList && paidHidden && paidDisplay) {
    const selected = cleanPersonName(paidHidden.value || "");
    paidList.innerHTML =
      names
        .map((n) => {
          const checked = cleanPersonName(n) === selected ? "checked" : "";
          return `
        <label class="name-opt" onclick="selectPaidName('${escapeHtml(n)}')">
          <span class="left">
            <input type="radio" name="paidRadio" ${checked} />
            <span class="lbl">${escapeHtml(n)}</span>
          </span>
        </label>
      `;
        })
        .join("") ||
      '<div style="color:#94a3b8; text-align:center; padding:10px;">No names yet. Add one above.</div>';
    paidDisplay.textContent = selected || "Select / Add";
  }

  // Consumed (checkboxes)
  const consList = document.getElementById("consumedList");
  const consHidden = document.getElementById("inpConsumed");
  const consDisplay = document.getElementById("consumedDisplay");
  if (consList && consHidden && consDisplay) {
    const selectedArr = (consHidden.value || "")
      .split(",")
      .map(cleanPersonName)
      .filter(Boolean);
    const selectedSet = new Set(selectedArr);
    consList.innerHTML =
      names
        .map((n) => {
          const chk = selectedSet.has(cleanPersonName(n)) ? "checked" : "";
          return `
        <label class="name-opt">
          <span class="left">
            <input type="checkbox" ${chk} onchange="toggleConsumedName('${escapeHtml(
            n
          )}', this.checked)" />
            <span class="lbl">${escapeHtml(n)}</span>
          </span>
        </label>
      `;
        })
        .join("") ||
      '<div style="color:#94a3b8; text-align:center; padding:10px;">No names yet. Add one above.</div>';
    consDisplay.textContent = selectedArr.length
      ? selectedArr.join(", ")
      : "Select / Add";
  }
}

function selectPaidName(name) {
  const paidHidden = document.getElementById("inpPaid");
  if (!paidHidden) return;
  paidHidden.value = cleanPersonName(name);
  renderNameDropdownLists();
  // close panel after selection
  const panel = document.getElementById("paidPanel");
  if (panel) panel.classList.add("hidden");
}

function toggleConsumedName(name, isChecked) {
  const consHidden = document.getElementById("inpConsumed");
  if (!consHidden) return;
  let arr = (consHidden.value || "")
    .split(",")
    .map(cleanPersonName)
    .filter(Boolean);
  const n = cleanPersonName(name);
  if (isChecked) {
    if (!arr.includes(n)) arr.push(n);
  } else {
    arr = arr.filter((x) => x !== n);
  }
  consHidden.value = arr.join(", ");
  renderNameDropdownLists();
}

// Close dropdown panels if user taps outside
document.addEventListener("click", (e) => {
  const paid = document.getElementById("paidDropdown");
  const cons = document.getElementById("consumedDropdown");
  if (paid && paid.contains(e.target)) return;
  if (cons && cons.contains(e.target)) return;
  const p = document.getElementById("paidPanel");
  if (p) p.classList.add("hidden");
  const c = document.getElementById("consumedPanel");
  if (c) c.classList.add("hidden");
});

function renderList() {
  const container = document.getElementById("listContainer");
  const search = (
    document.getElementById("searchInput")?.value || ""
  ).toLowerCase();
  const type = document.getElementById("searchType")?.value || "all";

  // grand total (always all-time, not affected by period selection)
  const grandTotal = entries.reduce((s, e) => s + parseFloat(e.price || 0), 0);
  const headerTotalEl = document.getElementById("headerTotal");
  if (headerTotalEl) headerTotalEl.innerText = formatCurrency(grandTotal);

  let data = [...entries].sort((a, b) => new Date(b.date) - new Date(a.date));

  // List group filter
  const grpSel = document.getElementById("listGroupFilter");
  const listGroup = grpSel ? grpSel.value || "__all__" : "__all__";
  if (listGroup !== "__all__") {
    data = data.filter((e) => (e.group || "").trim() === listGroup);
  }

  // Period filter
  const { start, end } = getListPeriodBounds();
  data = data.filter((e) => {
    const d = new Date(e.date);
    return d >= start && d <= end;
  });

  // Search filter
  if (search) {
    data = data.filter((e) => {
      const itemMatch = (e.item || "").toLowerCase().includes(search);
      const paidMatch = (e.paidBy || "").toLowerCase().includes(search);
      const consMatch = (e.consumedBy || "").toLowerCase().includes(search);
      const groupMatch = (e.group || "").toLowerCase().includes(search);
      const priceMatch = String(e.price ?? "").includes(search);

      if (type === "all")
        return itemMatch || paidMatch || consMatch || groupMatch || priceMatch;
      if (type === "item") return itemMatch;
      if (type === "paid") return paidMatch;
      if (type === "consumed") return consMatch;
      if (type === "group") return groupMatch;
      if (type === "price") return priceMatch;
      return false;
    });
  }

  const periodTotal = data.reduce((s, e) => s + parseFloat(e.price || 0), 0);
  updateDateStrip(periodTotal);

  if (!container) return;

  if (data.length === 0) {
    container.innerHTML = `<div style="text-align:center; padding:28px 10px; color:#94a3b8;">No records for this period.</div>`;
    return;
  }

  container.innerHTML = data
    .map((e) => {
      const groupPill = e.group
        ? `<span class="pill" style="background:#f1f5f9;color:#0f172a;">${escapeHtml(
            e.group
          )}</span>`
        : "";
      const descRow = (e.desc || "").trim()
        ? `<div class="card-row-3"><span class="card-desc">${escapeHtml(
            e.desc
          )}</span></div>`
        : "";
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
            <span style="max-width:110px; overflow:hidden; white-space:nowrap; text-overflow:ellipsis;">${escapeHtml(
              e.consumedBy
            )}</span>
          </div>
        </div>
        ${descRow}
      </div>
    `;
    })
    .join("");
}

function renderMap(map) {
  return (
    Object.keys(map)
      .sort()
      .map((k) => {
        if (map[k] < 0.01) return "";
        return `<div class="stat-row"><span>${k}</span><span>${formatCurrency(
          map[k]
        )}</span></div>`;
      })
      .join("") || '<div style="text-align:center; color:#ccc">-</div>'
  );
}

// =====================
// --- SUMMARY FUNCTIONS ---
// =====================
function openDateModal() {
  document.getElementById("modalDateFilter").classList.add("active");
}

function applyDateFilter() {
  const sVal = document.getElementById("sumStart").value;
  const eVal = document.getElementById("sumEnd").value;

  if (sVal && eVal) {
    summaryStartDate = new Date(sVal);
    summaryEndDate = new Date(eVal);
    summaryEndDate.setHours(23, 59, 59);

    const fmtStart = summaryStartDate.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    const fmtEnd = summaryEndDate.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    document.getElementById(
      "currentRangeDisplay"
    ).innerText = `${fmtStart} - ${fmtEnd}`;

    calculateSummary();
    closeModal("modalDateFilter");
  } else {
    alert("Please select both start and end dates");
  }
}

function resetDates() {
  document.getElementById("sumStart").value = new Date()
    .toISOString()
    .split("T")[0];
  document.getElementById("sumEnd").value = new Date()
    .toISOString()
    .split("T")[0];
  summaryStartDate = null;
  summaryEndDate = null;
  document.getElementById("currentRangeDisplay").innerText = "All Time";
  calculateSummary();
}

function refreshSummaryGroupDropdown() {
  const sel = document.getElementById("summaryGroupFilter");
  if (!sel) return;

  const existing = sel.value || "__all__";

  const groups = Array.from(
    new Set(entries.map((e) => (e.group || "").trim()).filter(Boolean))
  ).sort();
  sel.innerHTML =
    `<option value="__all__">All Groups</option>` +
    groups
      .map((g) => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`)
      .join("");
  // restore selection
  if ([...sel.options].some((o) => o.value === existing)) sel.value = existing;
  else sel.value = "__all__";
}

function refreshListGroupDropdown() {
  const sel = document.getElementById("listGroupFilter");
  if (!sel) return;

  const existing = sel.value || "__all__";
  const groups = Array.from(
    new Set(entries.map((e) => (e.group || "").trim()).filter(Boolean))
  ).sort();
  sel.innerHTML =
    `<option value="__all__">All Groups</option>` +
    groups
      .map((g) => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`)
      .join("");

  if ([...sel.options].some((o) => o.value === existing)) sel.value = existing;
  else sel.value = "__all__";
}

function calculateSummary() {
  // Read summary group from dropdown if exists
  const sel = document.getElementById("summaryGroupFilter");
  if (sel) summaryGroup = sel.value || "__all__";

  let data = entries;

  // Apply date filter
  if (summaryStartDate && summaryEndDate) {
    data = data.filter((x) => {
      const d = new Date(x.date);
      return d >= summaryStartDate && d <= summaryEndDate;
    });
  }

  // Apply group filter
  if (summaryGroup && summaryGroup !== "__all__") {
    data = data.filter((x) => (x.group || "").trim() === summaryGroup);
  }

  const paidTotals = {};
  const consTotals = {};
  const debts = {};

  data.forEach((entry) => {
    const price = parseFloat(entry.price);
    const payers = (entry.paidBy || "")
      .split(/[,&|]+/)
      .map(cleanPersonName)
      .filter((n) => n);
    const consumers = (entry.consumedBy || "")
      .split(/[,&|]+/)
      .map(cleanPersonName)
      .filter((n) => n);
    if (payers.length === 0 || consumers.length === 0 || !(price > 0)) return;

    const amountPerPayer = price / payers.length;
    const amountPerConsumer = price / consumers.length;

    payers.forEach((p) => {
      paidTotals[p] = (paidTotals[p] || 0) + amountPerPayer;
    });
    consumers.forEach((c) => {
      consTotals[c] = (consTotals[c] || 0) + amountPerConsumer;
    });

    const debtPerPayer = amountPerConsumer / payers.length;
    consumers.forEach((c) => {
      payers.forEach((p) => {
        if (c !== p) {
          if (!debts[c]) debts[c] = {};
          debts[c][p] = (debts[c][p] || 0) + debtPerPayer;
        }
      });
    });
  });

  document.getElementById("paidArea").innerHTML = renderMap(paidTotals);
  document.getElementById("consumedArea").innerHTML = renderMap(consTotals);

  // Simplify pairwise debts
  const settlements = [];
  const people = Array.from(
    new Set([...Object.keys(paidTotals), ...Object.keys(consTotals)])
  );
  for (let i = 0; i < people.length; i++) {
    for (let j = i + 1; j < people.length; j++) {
      const p1 = people[i],
        p2 = people[j];
      const d1 = (debts[p1] && debts[p1][p2]) || 0;
      const d2 = (debts[p2] && debts[p2][p1]) || 0;
      const net = d1 - d2;
      if (net > 0.01) settlements.push({ from: p1, to: p2, amt: net });
      else if (net < -0.01) settlements.push({ from: p2, to: p1, amt: -net });
    }
  }
  document.getElementById("settlementArea").innerHTML = (() => {
    const ctx = _summaryContextKey();
    const paidMap = loadSettlementPaidMap();
    const paidForCtx = paidMap?.[ctx] || {};

    if (!settlements.length) {
      return `
      <div style="display:flex; gap:10px; margin-bottom:10px;">
        <button class="btn btn-outline btn-small" type="button" id="btnMarkAllPaid">
          <i class="fas fa-check"></i> Mark All Paid
        </button>
        <button class="btn btn-primary btn-small" type="button" id="btnArchiveSettled">
          <i class="fas fa-archive"></i> Archive (Mark Settled)
        </button>
      </div>
      <div style="text-align:center; color:#94a3b8;">All Settled</div>
    `;
    }

    const header = `
    <div style="display:flex; gap:10px; margin-bottom:10px;">
      <button class="btn btn-outline btn-small" type="button" id="btnMarkAllPaid">
        <i class="fas fa-check"></i> Mark All Paid
      </button>
      <button class="btn btn-primary btn-small" type="button" id="btnArchiveSettled">
        <i class="fas fa-archive"></i> Archive (Mark Settled)
      </button>
    </div>
  `;

    const rows = settlements
      .map((s) => {
        const k = `${cleanPersonName(s.from)}__${cleanPersonName(s.to)}`;
        const isPaid = !!paidForCtx[k];

        return `
      <div class="settle-item ${
        isPaid ? "settle-paid" : ""
      }" data-settle-key="${escapeAttr(k)}">
        <div class="settle-left">
          <i class="fas fa-check-circle"></i>
          <div style="min-width:0;">
            <div>${escapeHtml(s.from)} pays ${escapeHtml(
          s.to
        )} <b>${formatCurrency(s.amt)}</b></div>
            ${
              isPaid
                ? `<div style="margin-top:4px;"><span class="badge-paid">Paid</span></div>`
                : ``
            }
          </div>
        </div>

        <button class="btn btn-outline btn-small btn-toggle-paid" type="button">
          ${isPaid ? "Undo" : "Paid"}
        </button>
      </div>
    `;
      })
      .join("");

    return header + rows;
  })();
  wireSettlementButtons(settlements);
}

function wireSettlementButtons(settlements) {
  const area = document.getElementById("settlementArea");
  if (!area) return;

  // Paid/Undo per line
  area.querySelectorAll(".btn-toggle-paid").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      const row = btn.closest("[data-settle-key]");
      if (!row) return;

      const key = row.getAttribute("data-settle-key");
      if (!key) return;

      toggleSettlementPaid(key);
      calculateSummary(); // refresh badge/button text
    });
  });

  // Mark all paid
  const btnAll = area.querySelector("#btnMarkAllPaid");
  if (btnAll) {
    btnAll.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      const keys = settlements.map(
        (s) => `${cleanPersonName(s.from)}__${cleanPersonName(s.to)}`
      );
      markAllSettlementsPaid(keys);
      calculateSummary();
    });
  }

  // Archive (Mark as Settled)
  const archBtn = area.querySelector("#btnArchiveSettled");
  if (archBtn) {
    archBtn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      await markCurrentAsSettled(); // your function (already async with uiConfirm)
    });
  }
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function setDateTimeLocalNow(inputId) {
  const el = document.getElementById(inputId);
  if (!el) return;

  const now = new Date();
  now.setSeconds(0, 0);

  const yyyy = now.getFullYear();
  const mm = pad2(now.getMonth() + 1);
  const dd = pad2(now.getDate());
  const hh = pad2(now.getHours());
  const mi = pad2(now.getMinutes());

  el.value = `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

document.getElementById("inpDate").addEventListener("input", () => {
  console.trace(
    "inpDate changed to:",
    document.getElementById("inpDate").value
  );
});

// =====================
// --- CRUD FUNCTIONS ---
// =====================
function openEntryModal() {
  document.getElementById("modalTitle").innerText = "Add Expense";
  document.getElementById("entryId").value = "";

  document.getElementById("inpItem").value = "";
  document.getElementById("inpPrice").value = "";

  const grp = document.getElementById("inpGroup");
  if (grp) grp.value = "";

  document.getElementById("inpPaid").value = "";
  document.getElementById("inpConsumed").value = "";
  renderNameDropdownLists();
  const cPanel = document.getElementById("consumedPanel");
  if (cPanel) cPanel.classList.add("hidden");

  document.getElementById("inpDesc").value = "";
  document.getElementById("editTools").classList.add("hidden");

  document.getElementById("modalEntry").classList.add("active");

  // ✅ set NOW immediately
  setDateTimeLocalNow("inpDate");

  // ✅ set NOW again after everything finishes (prevents overwrite)
  setTimeout(() => setDateTimeLocalNow("inpDate"), 50);
}

function editEntry(id) {
  const e = entries.find((x) => x.id === id);
  if (!e) return;
  document.getElementById("modalTitle").innerText = "Edit Expense";
  document.getElementById("entryId").value = e.id;
  document.getElementById("inpDate").value = isoToLocalDateTimeValue(e.date);

  document.getElementById("inpItem").value = e.item || "";
  document.getElementById("inpPrice").value = e.price ?? "";
  const grp = document.getElementById("inpGroup");
  if (grp) grp.value = e.group || "";
  document.getElementById("inpPaid").value = e.paidBy || "";
  document.getElementById("inpConsumed").value = e.consumedBy || "";
  renderNameDropdownLists();
  document.getElementById("inpDesc").value = e.desc || "";
  document.getElementById("editTools").classList.remove("hidden");
  document.getElementById("modalEntry").classList.add("active");
}

function isoToLocalDateTimeValue(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return "";

  const pad2 = (n) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function saveEntry() {
  const id = document.getElementById("entryId").value;
  const dateStr = document.getElementById("inpDate").value;
  const item = document.getElementById("inpItem").value.trim();
  const price = parseFloat(document.getElementById("inpPrice").value);
  const group = titleCaseWords(
    document.getElementById("inpGroup")?.value || ""
  ).trim();

  const paidBy = cleanPersonName(
    document.getElementById("inpPaid").value || ""
  );

  const consumedBy = (document.getElementById("inpConsumed").value || "")
    .split(",")
    .map(cleanPersonName)
    .filter((n) => n)
    .join(", ");

  const desc = document.getElementById("inpDesc").value;

  if (!dateStr || !item || isNaN(price) || !paidBy || !consumedBy) {
    alert("Please fill in Date, Item, Price, and Names.");
    return;
  }

  // Ensure catalog learns any new names
  const _names = new Set(loadNamesCatalog());
  if (paidBy) _names.add(cleanPersonName(paidBy));
  (consumedBy || "")
    .split(",")
    .map(cleanPersonName)
    .filter(Boolean)
    .forEach((n) => _names.add(n));
  saveNamesCatalog([..._names]);

  const obj = {
    id: id ? parseInt(id) : Date.now(),
    date: new Date(dateStr).toISOString(),
    item,
    price,
    paidBy,
    consumedBy,
    group,
    desc,
  };

  if (id) {
    const idx = entries.findIndex((x) => x.id == id);
    if (idx > -1) entries[idx] = obj;
  } else {
    entries.push(obj);
  }

  persist();
  refreshSummaryGroupDropdown();
  refreshListGroupDropdown();
  closeModal("modalEntry");
  renderList();
}

function deleteEntry() {
  if (!confirm("Delete record?")) return;
  const idStr = (document.getElementById("entryId").value || "").trim();
  if (!idStr) {
    alert("No record selected.");
    return;
  }
  const id = parseInt(idStr);
  entries = entries.filter((x) => x.id !== id);
  persist();
  refreshSummaryGroupDropdown();
  refreshListGroupDropdown();
  closeModal("modalEntry");
  renderList();
}

// Copy button: open a centered date picker modal (mobile friendly)
let _copySourceId = null;

function triggerCopy() {
  const idVal = document.getElementById("entryId").value;
  if (!idVal) {
    alert("Open a record first, then tap Copy.");
    return;
  }

  _copySourceId = parseInt(idVal);

  const picker = document.getElementById("copyDatePicker");
  if (picker) {
    picker.value = new Date().toISOString().split("T")[0];
  }

  // ✅ Open Copy Date modal
  document.getElementById("modalCopyDate").classList.add("active");
}

function confirmCopyWithDate() {
  const picker = document.getElementById("copyDatePicker");
  const dateVal = picker ? picker.value : "";
  if (!dateVal) {
    alert("Please select a date.");
    return;
  }

  const src = entries.find((x) => x.id == _copySourceId);
  if (!src) {
    alert("Could not find the record to copy.");
    closeModal("modalCopyDate");
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

  closeModal("modalCopyDate");
  closeModal("modalEntry");

  // Open the copied record so user can edit and then tap Save Record
  editEntry(newId);

  // tiny feedback
  alert("Copied! You can edit and Save Record.");
  closeModal("modalCopyDate");
  closeModal("modalEntry");
}

// Kept for backward compatibility (HTML still has #copyDateInput)
function finishCopy() {
  // legacy; no-op
}

// =====================
// --- SETTLE / ARCHIVE ---
// =====================
async function markCurrentAsSettled() {
  const data = getSummaryFilteredEntries();
  if (!data.length) {
    alert("No records in the current Summary filter to settle.");
    return;
  }

  const start = summaryStartDate
    ? new Date(summaryStartDate).toISOString()
    : null;
  const end = summaryEndDate ? new Date(summaryEndDate).toISOString() : null;
  const grp = summaryGroup || "__all__";
  const total = data.reduce((s, e) => s + parseFloat(e.price || 0), 0);

  const ok = await uiConfirm({
    title: "Mark as settled?",
    sub: "This will archive these records and remove them from active data",
    message: "Do you want to archive these records and start fresh?",
    okText: "Mark as Settled",
    cancelText: "Cancel",
    detailsHtml: `
      <div style="display:flex; justify-content:space-between; gap:10px;">
        <div><b>Records:</b> ${data.length}</div>
        <div><b>Total:</b> ${formatCurrency(total)}</div>
      </div>
      <div style="margin-top:8px; color:#64748b; font-size:.85rem;">
        This will archive these records and remove them from the active list.
      </div>
    `,
  });
  if (!ok) return;

  const batch = {
    id: Date.now(),
    createdAt: new Date().toISOString(),
    start,
    end,
    group: grp,
    count: data.length,
    total,
    entries: data,
  };

  const batches = loadSettledBatches();
  batches.unshift(batch);
  saveSettledBatches(batches);

  const idSet = new Set(data.map((x) => x.id));
  entries = entries.filter((e) => !idSet.has(e.id));

  persist();
  refreshSummaryGroupDropdown();
  refreshListGroupDropdown();
  renderList();
  calculateSummary();

  await syncBackupIfConnected();

  // ✅ If Drive connected, auto-backup after archiving
  try {
    const token = gapi?.client?.getToken?.()
      ? gapi.client.getToken().access_token
      : null;
    if (token) {
      const fileId = await findLatestBackupFileId(token);
      await uploadBackupMultipart(token, fileId);
    }
  } catch (e) {
    console.warn("Auto-backup after archive failed:", e);
  }

  alert("Settled! The records were archived and removed from active data.");
}

// =====================
// --- SETTLED HISTORY UI ---
// =====================
function openSettledHistoryModal() {
  renderSettledHistory();
  const modal = document.getElementById("modalSettledHistory");
  if (modal) modal.classList.add("active");
}

function renderSettledHistory() {
  const holder = document.getElementById("settledHistoryList");
  if (!holder) return;
  const batches = loadSettledBatches();

  if (!batches.length) {
    holder.innerHTML =
      '<div style="text-align:center; color:#94a3b8; padding:12px;">No settled batches yet.</div>';
    return;
  }

  holder.innerHTML = batches
    .map((b) => {
      const dt = new Date(b.createdAt || "").toLocaleString();
      const grp = b.group && b.group !== "__all__" ? b.group : "All Groups";
      const range =
        b.start && b.end
          ? `${new Date(b.start).toLocaleDateString()} → ${new Date(
              b.end
            ).toLocaleDateString()}`
          : "All Time";

      return `
      <div class="card" style="padding:12px;">
        <div style="display:flex; justify-content:space-between; gap:10px; align-items:flex-start;">
          <div style="flex:1; min-width:0;">
            <div style="font-weight:800;">${escapeHtml(grp)}</div>
            <div style="color:#64748b; font-size:.85rem; margin-top:2px;">
              ${escapeHtml(range)} • ${escapeHtml(dt)}
            </div>
            <div style="margin-top:6px; font-size:.92rem;">
              <b>${b.count || 0}</b> records • <b>${formatCurrency(
        b.total || 0
      )}</b>
            </div>
          </div>
          <div style="display:flex; gap:8px; flex-shrink:0;">
            <button class="btn btn-copy btn-small" type="button" onclick="restoreSettledBatch(${
              b.id
            })"><i class="fas fa-rotate-left"></i></button>
            <button class="btn btn-danger btn-small" type="button" onclick="deleteSettledBatch(${
              b.id
            })"><i class="fas fa-trash"></i></button>
          </div>
        </div>
      </div>
    `;
    })
    .join("");
}

async function restoreSettledBatch(batchId) {
  const batches = loadSettledBatches();
  const idx = batches.findIndex((b) => b.id === batchId);
  if (idx === -1) {
    alert("Settled batch not found.");
    return;
  }
  const b = batches[idx];

  const ok = await uiConfirm({
    title: "Restore settled batch?",
    sub: "This will move records back to active data",
    message: "Do you want to restore this batch?",
    okText: "Restore",
    cancelText: "Cancel",
    detailsHtml: `
      <div style="display:flex; justify-content:space-between; gap:10px;">
        <div><b>Records:</b> ${b.count || 0}</div>
        <div><b>Total:</b> ${formatCurrency(b.total || 0)}</div>
      </div>
    `,
  });
  if (!ok) return;

  entries = [...entries, ...(b.entries || [])];
  batches.splice(idx, 1);
  saveSettledBatches(batches);

  persist();
  refreshSummaryGroupDropdown();
  refreshListGroupDropdown();
  renderList();
  calculateSummary();
  renderSettledHistory();

  await syncBackupIfConnected();

  alert("Restored! The records are back in active data.");
}

async function deleteSettledBatch(batchId) {
  const batches = loadSettledBatches();
  const idx = batches.findIndex((b) => b.id === batchId);
  if (idx === -1) {
    alert("Settled batch not found.");
    return;
  }
  const b = batches[idx];

  const ok = await uiConfirm({
    title: "Delete settled batch?",
    sub: "This cannot be undone",
    message: "Do you want to permanently delete this settled batch?",
    okText: "Delete",
    cancelText: "Cancel",
    detailsHtml: `
      <div style="display:flex; justify-content:space-between; gap:10px;">
        <div><b>Records:</b> ${b.count || 0}</div>
        <div><b>Total:</b> ${formatCurrency(b.total || 0)}</div>
      </div>
    `,
  });
  if (!ok) return;

  batches.splice(idx, 1);
  saveSettledBatches(batches);
  renderSettledHistory();

  await syncBackupIfConnected();

  alert("Deleted from Settled History.");
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
  const lines = csvText.split("\n");
  let count = 0;
  const startIndex = lines[0]?.toLowerCase().includes("date") ? 1 : 0;

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const matches = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g);
    const cols = matches
      ? matches.map((m) => m.replace(/^"|"$/g, ""))
      : line.split(",");

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
          paidBy: paidBy
            .split(/[,&|]+/)
            .map(cleanPersonName)
            .filter(Boolean)
            .join(", "),
          consumedBy: consumedBy
            .split(/[,&|]+/)
            .map(cleanPersonName)
            .filter(Boolean)
            .join(", "),
          group: titleCaseWords(group),
          desc: desc.trim(),
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

function xmlEscape(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function sheetXml(name, rows) {
  // rows = array of arrays
  const safeName = xmlEscape(name).slice(0, 31); // Excel sheet name max ~31 chars
  const rowXml = rows
    .map((r) => {
      const cells = r
        .map(
          (c) => `<Cell><Data ss:Type="String">${xmlEscape(c)}</Data></Cell>`
        )
        .join("");
      return `<Row>${cells}</Row>`;
    })
    .join("");

  return `
    <Worksheet ss:Name="${safeName}">
      <Table>
        ${rowXml}
      </Table>
    </Worksheet>
  `;
}

function computeSummaryForExport(data) {
  const paidTotals = {};
  const consTotals = {};
  const debts = {};

  data.forEach((entry) => {
    const price = parseFloat(entry.price || 0);
    const payers = (entry.paidBy || "")
      .split(/[,&|]+/)
      .map(cleanPersonName)
      .filter(Boolean);

    const consumers = (entry.consumedBy || "")
      .split(/[,&|]+/)
      .map(cleanPersonName)
      .filter(Boolean);

    if (payers.length === 0 || consumers.length === 0 || !(price > 0)) return;

    const amountPerPayer = price / payers.length;
    const amountPerConsumer = price / consumers.length;

    payers.forEach(
      (p) => (paidTotals[p] = (paidTotals[p] || 0) + amountPerPayer)
    );
    consumers.forEach(
      (c) => (consTotals[c] = (consTotals[c] || 0) + amountPerConsumer)
    );

    const debtPerPayer = amountPerConsumer / payers.length;
    consumers.forEach((c) => {
      payers.forEach((p) => {
        if (c !== p) {
          if (!debts[c]) debts[c] = {};
          debts[c][p] = (debts[c][p] || 0) + debtPerPayer;
        }
      });
    });
  });

  // Simplify pairwise debts -> settlements
  const settlements = [];
  const people = Array.from(
    new Set([...Object.keys(paidTotals), ...Object.keys(consTotals)])
  );

  for (let i = 0; i < people.length; i++) {
    for (let j = i + 1; j < people.length; j++) {
      const p1 = people[i],
        p2 = people[j];
      const d1 = (debts[p1] && debts[p1][p2]) || 0;
      const d2 = (debts[p2] && debts[p2][p1]) || 0;
      const net = d1 - d2;

      if (net > 0.01) settlements.push({ from: p1, to: p2, amt: net });
      else if (net < -0.01) settlements.push({ from: p2, to: p1, amt: -net });
    }
  }

  return { paidTotals, consTotals, settlements };
}

function executeExport(type) {
  // Backward compatibility (if any old button still calls "share")
  if (type === "share") type = "sharexls";

  const sVal = document.getElementById("expStart").value;
  const eVal = document.getElementById("expEnd").value;

  let data = entries;

  // Filter by date range (if provided)
  if (sVal && eVal) {
    const s = new Date(sVal);
    const e = new Date(eVal);
    e.setHours(23, 59, 59, 999);

    data = entries.filter((x) => {
      const d = new Date(x.date);
      return d >= s && d <= e;
    });
  }

  // ===== Helpers for XLS (Excel XML) =====
  function xmlEscape(v) {
    return String(v ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function sheetXml(name, rows) {
    const safeName = xmlEscape(name).slice(0, 31);
    const rowXml = rows
      .map((r) => {
        const cells = r
          .map(
            (c) => `<Cell><Data ss:Type="String">${xmlEscape(c)}</Data></Cell>`
          )
          .join("");
        return `<Row>${cells}</Row>`;
      })
      .join("");

    return `
      <Worksheet ss:Name="${safeName}">
        <Table>${rowXml}</Table>
      </Worksheet>
    `;
  }

  function computeSummaryForExport(data) {
    const paidTotals = {};
    const consTotals = {};
    const debts = {};

    data.forEach((entry) => {
      const price = parseFloat(entry.price || 0);
      const payers = (entry.paidBy || "")
        .split(/[,&|]+/)
        .map(cleanPersonName)
        .filter(Boolean);

      const consumers = (entry.consumedBy || "")
        .split(/[,&|]+/)
        .map(cleanPersonName)
        .filter(Boolean);

      if (payers.length === 0 || consumers.length === 0 || !(price > 0)) return;

      const amountPerPayer = price / payers.length;
      const amountPerConsumer = price / consumers.length;

      payers.forEach(
        (p) => (paidTotals[p] = (paidTotals[p] || 0) + amountPerPayer)
      );
      consumers.forEach(
        (c) => (consTotals[c] = (consTotals[c] || 0) + amountPerConsumer)
      );

      const debtPerPayer = amountPerConsumer / payers.length;
      consumers.forEach((c) => {
        payers.forEach((p) => {
          if (c !== p) {
            if (!debts[c]) debts[c] = {};
            debts[c][p] = (debts[c][p] || 0) + debtPerPayer;
          }
        });
      });
    });

    // Pairwise simplify -> settlements
    const settlements = [];
    const people = Array.from(
      new Set([...Object.keys(paidTotals), ...Object.keys(consTotals)])
    );

    for (let i = 0; i < people.length; i++) {
      for (let j = i + 1; j < people.length; j++) {
        const p1 = people[i],
          p2 = people[j];
        const d1 = (debts[p1] && debts[p1][p2]) || 0;
        const d2 = (debts[p2] && debts[p2][p1]) || 0;
        const net = d1 - d2;

        if (net > 0.01) settlements.push({ from: p1, to: p2, amt: net });
        else if (net < -0.01) settlements.push({ from: p2, to: p1, amt: -net });
      }
    }

    return { paidTotals, consTotals, settlements };
  }

  // ===== Build rows =====
  const recordsRows = [
    [
      "Date",
      "Time",
      "Item",
      "Price",
      "Paid By",
      "Consumed By",
      "Group",
      "Description",
    ],
    ...data
      .slice()
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .map((r) => {
        const dt = new Date(r.date);
        const dateStr = dt.toLocaleDateString();
        const timeStr = dt.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });
        return [
          dateStr,
          timeStr,
          r.item || "",
          String(parseFloat(r.price || 0).toFixed(2)),
          r.paidBy || "",
          r.consumedBy || "",
          r.group || "",
          r.desc || "",
        ];
      }),
  ];

  const totalAmount = data.reduce((s, e) => s + parseFloat(e.price || 0), 0);
  const { paidTotals, consTotals, settlements } = computeSummaryForExport(data);

  const summaryRows = [
    ["Export Range", `${sVal || "All"}  →  ${eVal || "All"}`],
    ["Records Count", String(data.length)],
    ["Total", formatCurrency(totalAmount)],
    [""],
    ["WHO PAID", ""],
    ["Name", "Amount"],
    ...Object.keys(paidTotals)
      .sort()
      .map((k) => [k, formatCurrency(paidTotals[k])]),
    [""],
    ["WHO CONSUMED", ""],
    ["Name", "Amount"],
    ...Object.keys(consTotals)
      .sort()
      .map((k) => [k, formatCurrency(consTotals[k])]),
  ];

  const settlementRows = [
    ["From", "To", "Amount"],
    ...settlements.map((s) => [s.from, s.to, formatCurrency(s.amt)]),
  ];

  // ===== Excel XML workbook =====
  const workbookXml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook
  xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:html="http://www.w3.org/TR/REC-html40">

  ${sheetXml("Records", recordsRows)}
  ${sheetXml("Summary", summaryRows)}
  ${sheetXml("Settlements", settlementRows)}

</Workbook>`;

  const blob = new Blob([workbookXml], {
    type: "application/vnd.ms-excel;charset=utf-8",
  });

  const filename = `expenses_${sVal || "all"}_${eVal || "all"}.xls`;

  // ===== SHARE XLS or DOWNLOAD fallback =====
  const file = new File([blob], filename, { type: blob.type });

  if (
    type === "sharexls" &&
    navigator.share &&
    navigator.canShare &&
    navigator.canShare({ files: [file] })
  ) {
    navigator.share({
      files: [file],
      title: "Expense Export",
      text: "Expense export (Excel)",
    });
  } else {
    // download fallback
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  closeModal("modalExport");
}

// =====================
// --- LOCAL STORAGE ---
// =====================
function persist() {
  localStorage.setItem("expense_data_v7", JSON.stringify(entries));
  populateNamesAndGroups();
}

function populateNamesAndGroups() {
  // People names now handled via names catalog dropdowns
  const names = new Set();
  const groups = new Set();

  entries.forEach((e) => {
    (e.paidBy || "").split(",").forEach((x) => {
      const v = x.trim();
      if (v) names.add(v);
    });
    (e.consumedBy || "").split(",").forEach((x) => {
      const v = x.trim();
      if (v) names.add(v);
    });
    const g = (e.group || "").trim();
    if (g) groups.add(g);
  });

  const namesList = document.getElementById("namesList");
  if (namesList) namesList.innerHTML = "";

  const groupsList = document.getElementById("groupsList");
  if (groupsList)
    groupsList.innerHTML = [...groups]
      .sort()
      .map((g) => `<option value="${escapeHtml(g)}">`)
      .join("");
}

// =====================
// --- MODAL & UI ---
// =====================
function closeModal(id) {
  document.getElementById(id).classList.remove("active");
}

function clearAllData() {
  if (confirm("Permanently delete all local data?")) {
    entries = [];
    persist();
    refreshSummaryGroupDropdown();
    refreshListGroupDropdown();
    renderList();
  }
}

function switchView(id) {
  document
    .querySelectorAll(".view-section")
    .forEach((v) => v.classList.remove("active"));
  document
    .querySelectorAll(".nav-item")
    .forEach((b) => b.classList.remove("active"));

  if (id === "list") {
    document.getElementById("viewList").classList.add("active");
    document.getElementById("btnList").classList.add("active");
    renderList();
  } else if (id === "summary") {
    document.getElementById("viewSummary").classList.add("active");
    document.getElementById("btnSum").classList.add("active");
    refreshSummaryGroupDropdown();
    refreshListGroupDropdown();
    calculateSummary();
  } else {
    document.getElementById("viewSettings").classList.add("active");
    document.getElementById("btnSet").classList.add("active");
  }
}

function openExportModal() {
  document.getElementById("modalExport").classList.add("active");
}

// HTML uses onclick="handleAuthClick()"
function handleAuthClick() {
  // If Google scripts are still loading, retry and inform user
  if (!gisInited || !gapiInited) {
    document.getElementById("syncStatus").innerText =
      "Loading Google libraries... try again in a second.";
    checkGoogleLoaded();
    setTimeout(() => {
      if (!gisInited || !gapiInited)
        alert("Google libraries are still loading. Please try again.");
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
  const statusEl = document.getElementById("syncStatus");

  const haveGis =
    typeof google !== "undefined" && google.accounts && google.accounts.oauth2;
  const haveGapi = typeof gapi !== "undefined";

  if (haveGis && haveGapi) {
    gisLoaded();
    gapiLoaded();
    return;
  }

  _googleLoadAttempts++;
  if (statusEl) {
    statusEl.innerHTML =
      '<i class="fas fa-circle-notch fa-spin"></i> Loading Google scripts...';
  }

  // After ~12 seconds, stop looping and show a helpful message
  if (_googleLoadAttempts > 24) {
    if (statusEl) {
      statusEl.innerHTML =
        '<span style="color:#b91c1c; font-weight:600;">Google scripts failed to load.</span><br><span style="font-size:0.85rem; color:#64748b;">Check your internet, disable ad-blockers for this site, and ensure apis.google.com is not blocked.</span>';
    }
    // Still show the connect button (user can retry by reloading)
    const controls = document.getElementById("driveControls");
    if (controls) controls.classList.remove("hidden");
    return;
  }

  setTimeout(checkGoogleLoaded, 500);
}

function gapiLoaded() {
  gapi.load("client", async () => {
    try {
      await gapi.client.init({
        apiKey: API_KEY,
        discoveryDocs: [DISCOVERY_DOC],
      });
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

      localStorage.setItem(DRIVE_LOGIN_KEY, "1");
      document.getElementById("syncStatus").classList.add("active");
      document.getElementById("syncStatus").innerHTML =
        '<span style="color:green">Connected to Drive</span>';
      document.getElementById("driveControls").classList.add("hidden");
      document.getElementById("driveActions").classList.remove("hidden");

      // Manual only: no auto-restore / auto-backup on login
    },
  });

  gisInited = true;
  updateDriveUI();
}

function updateDriveUI() {
  if (!(gapiInited && gisInited)) return;

  const hasToken = !!(
    gapi.client &&
    gapi.client.getToken &&
    gapi.client.getToken()
  );
  const wasConnected = localStorage.getItem(DRIVE_LOGIN_KEY) === "1";

  if (hasToken) {
    document.getElementById("syncStatus").classList.add("active");
    document.getElementById("syncStatus").innerHTML =
      '<span style="color:green">Connected to Drive</span>';
    document.getElementById("driveControls").classList.add("hidden");
    document.getElementById("driveActions").classList.remove("hidden");
  } else {
    document.getElementById("syncStatus").classList.remove("active");
    document.getElementById("syncStatus").innerText = wasConnected
      ? "Reconnect to Drive (session expired)."
      : "Ready to connect.";
    document.getElementById("driveControls").classList.remove("hidden");
    document.getElementById("driveActions").classList.add("hidden");
  }
}

async function loginDrive() {
  if (!tokenClient) {
    alert("Google sign-in is not ready yet. Refresh and try again.");
    return;
  }
  // Force account picker on mobile so user sees the dialog
  tokenClient.requestAccessToken({ prompt: "select_account" });
}

async function findLatestBackupFileId(token) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=name="${BACKUP_FILENAME}"&orderBy=modifiedTime desc&fields=files(id,name,modifiedTime)&pageSize=1`,
    { headers: { Authorization: "Bearer " + token } }
  );
  const data = await res.json();
  if (!data.files || data.files.length === 0) return null;
  return data.files[0].id;
}

function setDriveButtonLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.classList.toggle("loading", !!loading);
  const sp = btn.querySelector(".btn-spinner");
  if (sp) sp.classList.toggle("hidden", !loading);
}

async function uploadBackupMultipart(token, fileIdOrNull) {
  const payload = buildBackupPayload();
  const blob = new Blob([JSON.stringify(payload)], {
    type: "application/json",
  });
  const metadata = { name: BACKUP_FILENAME, mimeType: "application/json" };

  const form = new FormData();
  form.append(
    "metadata",
    new Blob([JSON.stringify(metadata)], { type: "application/json" })
  );
  form.append("file", blob);

  const url = fileIdOrNull
    ? `https://www.googleapis.com/upload/drive/v3/files/${fileIdOrNull}?uploadType=multipart`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;

  const method = fileIdOrNull ? "PATCH" : "POST";

  const res = await fetch(url, {
    method,
    headers: { Authorization: "Bearer " + token },
    body: form,
  });

  return res.ok;
}

async function backupToDrive() {
  setDriveButtonLoading("btnBackupDrive", true);
  try {
    const token = gapi.client.getToken()
      ? gapi.client.getToken().access_token
      : null;
    if (!token) {
      alert("Not logged in!");
      return;
    }

    const fileId = await findLatestBackupFileId(token);
    const ok = await uploadBackupMultipart(token, fileId);

    if (ok) alert("Backup saved to Google Drive!");
    else alert("Drive backup failed.");
  } catch (e) {
    console.error(e);
    alert("Drive backup failed.");
  } finally {
    setDriveButtonLoading("btnBackupDrive", false);
  }
}

async function restoreFromDrive(silent = false) {
  if (!silent) setDriveButtonLoading("btnRestoreDrive", true);

  try {
    const token = gapi.client.getToken()
      ? gapi.client.getToken().access_token
      : null;

    if (!token) {
      if (!silent) alert("Not logged in!");
      return false;
    }

    const fileId = await findLatestBackupFileId(token);
    if (!fileId) {
      if (!silent) alert("No backup found.");
      return false;
    }

    const fileRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      { headers: { Authorization: "Bearer " + token } }
    );

    const text = await fileRes.text();
    const parsed = JSON.parse(text);

    // Accept old backups (array) and new backups (object)
    if (!(Array.isArray(parsed) || (parsed && typeof parsed === "object"))) {
      if (!silent) alert("Backup file is invalid.");
      return false;
    }

    // ✅ Restore entries + settled batches + paid-map + templates + names
    applyBackupPayload(parsed);

    // ✅ Normalize entries shape AFTER applyBackupPayload
    entries = (entries || []).map((e) => ({
      id: e.id ?? Date.now(),
      date: e.date ?? new Date().toISOString(),
      item: e.item ?? "",
      price: e.price ?? 0,
      paidBy: e.paidBy ?? "",
      consumedBy: e.consumedBy ?? "",
      group: e.group ?? "",
      desc: e.desc ?? "",
    }));

    // ✅ If backup is new format, normalize settled batches too (optional but safer)
    const batches = loadSettledBatches?.() || [];
    if (Array.isArray(batches) && saveSettledBatches) {
      const normalized = batches.map((b) => ({
        id: b.id ?? Date.now(),
        createdAt: b.createdAt ?? new Date().toISOString(),
        start: b.start ?? null,
        end: b.end ?? null,
        group: b.group ?? "__all__",
        count: b.count ?? (Array.isArray(b.entries) ? b.entries.length : 0),
        total: b.total ?? 0,
        entries: Array.isArray(b.entries) ? b.entries : [],
      }));
      saveSettledBatches(normalized);
    }

    persist();
    refreshSummaryGroupDropdown();
    refreshListGroupDropdown();
    renderList();
    calculateSummary(); // ✅ IMPORTANT (refresh settlement section)

    if (!silent) alert("Backup restored!");
    return true;
  } catch (e) {
    console.error(e);
    if (!silent) alert("Drive restore failed.");
    return false;
  } finally {
    if (!silent) setDriveButtonLoading("btnRestoreDrive", false);
  }
}

async function autoBackupIfConnected() {
  /* manual only */
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
  const holder = document.getElementById("templatesList");
  if (!holder) return;

  const templates = loadTemplates();
  if (templates.length === 0) {
    holder.innerHTML =
      '<div style="text-align:center; color:#94a3b8; padding:10px;">No templates yet.</div>';
    return;
  }

  holder.innerHTML = templates
    .map((t, idx) => {
      const title = escapeHtml(t.name || "Template " + (idx + 1));
      const subtitle = `${escapeHtml(t.item || "")} • ${formatCurrency(
        t.price || 0
      )} • ${escapeHtml(t.group || "No Group")}`;
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
    .join("");
}

function openTemplatesModal() {
  const modal = document.getElementById("modalTemplates");
  if (!modal) return;
  document.getElementById("tplName").value = "";
  renderTemplatesList();
  modal.classList.add("active");
}

function saveCurrentAsTemplate() {
  const name = (document.getElementById("tplName").value || "").trim();
  if (!name) {
    alert("Please enter a template name.");
    return;
  }

  // Use current fields from the entry modal if present; otherwise use empty.
  const tpl = {
    name,
    item: (document.getElementById("inpItem")?.value || "").trim(),
    price: parseFloat(document.getElementById("inpPrice")?.value || "0") || 0,
    group: (document.getElementById("inpGroup")?.value || "").trim(),
    paidBy: (document.getElementById("inpPaid")?.value || "").trim(),
    consumedBy: (document.getElementById("inpConsumed")?.value || "").trim(),
    desc: (document.getElementById("inpDesc")?.value || "").trim(),
  };

  const templates = loadTemplates();
  templates.push(tpl);
  saveTemplates(templates);
  renderTemplatesList();
  alert("Template saved.");
}

function applyTemplate(idx) {
  const templates = loadTemplates();
  const t = templates[idx];
  if (!t) return;

  // Open entry modal and apply
  openEntryModal();

  if (t.item) document.getElementById("inpItem").value = t.item;
  if (t.price) document.getElementById("inpPrice").value = t.price;
  if (t.group) document.getElementById("inpGroup").value = t.group;
  if (t.paidBy) document.getElementById("inpPaid").value = t.paidBy;
  if (t.consumedBy) document.getElementById("inpConsumed").value = t.consumedBy;
  if (t.desc) document.getElementById("inpDesc").value = t.desc;

  closeModal("modalTemplates");
}

function deleteTemplate(idx) {
  if (!confirm("Delete this template?")) return;
  const templates = loadTemplates();
  templates.splice(idx, 1);
  saveTemplates(templates);
  renderTemplatesList();
}

let _namePickerMode = "paid"; // 'paid' | 'consumed'

function openNamePicker(mode) {
  _namePickerMode = mode;
// Prevent keyboard from opening
document.activeElement?.blur();
  // title + hints
  const title = document.getElementById("namePickerTitle");
  const hint = document.getElementById("namePickerHint");
  const doneBtn = document.getElementById("namePickerDoneBtn");

  if (mode === "paid") {
    if (title) title.textContent = "Paid By";
    if (hint) hint.textContent = "Select one person";
    if (doneBtn) doneBtn.style.display = "none"; // single select closes immediately
  } else {
    if (title) title.textContent = "Consumed By";
    if (hint) hint.textContent = "Select one or more people";
    if (doneBtn) doneBtn.style.display = "inline-flex";
  }

  // reset inputs
  const s = document.getElementById("namePickerSearch");
  const n = document.getElementById("namePickerNew");
  if (s) s.value = "";
  if (n) n.value = "";

  renderNamePickerList();

  const modal = document.getElementById("modalNamePicker");
  if (modal) modal.classList.add("active");

 
}
window.openNamePicker = openNamePicker;

function closeNamePicker() {
  const modal = document.getElementById("modalNamePicker");
  if (modal) modal.classList.remove("active");

  // Update the small display labels on your form
  renderNameDropdownLists();
}

function namePickerAddNew() {
  const inp = document.getElementById("namePickerNew");
  if (!inp) return;

  const name = cleanPersonName(inp.value || "");
  if (!name) return;

  const names = loadNamesCatalog();
  names.push(name);
  saveNamesCatalog(names);

  // auto-select the newly added name
  if (_namePickerMode === "paid") {
    document.getElementById("inpPaid").value = name;
    closeNamePicker();
  } else {
    // add to consumed list
    let arr = (document.getElementById("inpConsumed").value || "")
      .split(",")
      .map(cleanPersonName)
      .filter(Boolean);

    if (!arr.includes(name)) arr.push(name);
    document.getElementById("inpConsumed").value = arr.join(", ");
    renderNamePickerList();
  }

  inp.value = "";
}

function renderNamePickerList() {
  const holder = document.getElementById("namePickerList");
  if (!holder) return;

  const q = (document.getElementById("namePickerSearch")?.value || "")
    .trim()
    .toLowerCase();
  const names = loadNamesCatalog().filter(
    (n) => !q || n.toLowerCase().includes(q)
  );

  const paidHidden = document.getElementById("inpPaid");
  const consHidden = document.getElementById("inpConsumed");

  const selectedPaid = cleanPersonName(paidHidden?.value || "");
  const selectedCons = new Set(
    (consHidden?.value || "").split(",").map(cleanPersonName).filter(Boolean)
  );

  if (names.length === 0) {
    holder.innerHTML = `<div style="text-align:center; color:#94a3b8; padding:18px;">No names found.</div>`;
    return;
  }

  holder.innerHTML = names
    .map((n) => {
      const isPaid =
        _namePickerMode === "paid" && cleanPersonName(n) === selectedPaid;
      const isCons =
        _namePickerMode === "consumed" && selectedCons.has(cleanPersonName(n));

      const inputHtml =
        _namePickerMode === "paid"
          ? `<input type="radio" name="pickerPaid" ${
              isPaid ? "checked" : ""
            } />`
          : `<input type="checkbox" ${isCons ? "checked" : ""} />`;

      return `
  <div class="name-pick-row" data-name="${encodeURIComponent(n)}">
    <div class="left">
      ${inputHtml}
      <div style="min-width:0;">
        <div class="nm">${escapeHtml(n)}</div>
        <div class="sub">${
          _namePickerMode === "paid"
            ? "Tap to set as payer"
            : "Tap to include/exclude"
        }</div>
      </div>
    </div>

    <button class="name-del-btn" type="button" title="Delete name" aria-label="Delete name">
      <i class="fas fa-times"></i>
    </button>
  </div>
`;
    })
    .join("");
}

function namePickerToggle(name) {
  const n = cleanPersonName(name);

  if (_namePickerMode === "paid") {
    document.getElementById("inpPaid").value = n;
    closeNamePicker(); // single select closes immediately
    return;
  }

  // consumed: toggle checkbox
  let arr = (document.getElementById("inpConsumed").value || "")
    .split(",")
    .map(cleanPersonName)
    .filter(Boolean);

  if (arr.includes(n)) arr = arr.filter((x) => x !== n);
  else arr.push(n);

  document.getElementById("inpConsumed").value = arr.join(", ");
  renderNamePickerList();
}



document.addEventListener("DOMContentLoaded", () => {
  const list = document.getElementById("namePickerList");
  if (!list) return;

  list.addEventListener("click", async (e) => {
    const delBtn = e.target.closest(".name-del-btn");
    const row = e.target.closest(".name-pick-row");
    if (!row) return;

    // Prevent other global click handlers from interfering
    e.preventDefault();
    e.stopPropagation();

    const raw = row.getAttribute("data-name") || "";
    const name = decodeURIComponent(raw || "");

    // Delete
    if (delBtn) {
      const { activeCount, archivedCount } = getAllNamesUsedCounts(name);

      if (activeCount > 0 || archivedCount > 0) {
        const msg =
          `You can't delete "${cleanPersonName(name)}" because it is used.\n\n` +
          `Active records: ${activeCount}\nArchived records: ${archivedCount}`;

        if (typeof uiConfirm === "function") {
          await uiConfirm({ title: "Can't delete", message: msg, okText: "OK" });
        } else {
          alert(msg);
        }
        return;
      }

      let ok = true;
      if (typeof uiConfirm === "function") {
        ok = await uiConfirm({
          title: "Delete name?",
          message: `Delete "${cleanPersonName(name)}" from the list?`,
          sub: "This name is not used in any record.",
          okText: "Delete",
          cancelText: "Cancel",
        });
      } else {
        ok = confirm(`Delete "${cleanPersonName(name)}"?`);
      }

      if (!ok) return;

      removeNameFromCatalog(name);
      renderNamePickerList();
      renderNameDropdownLists();
      return;
    }

    // Select name
    namePickerToggle(name);
  });
});

document.addEventListener("focusin", (e) => {
  if (!e.target.closest("#modalNamePicker")) return;
  if (e.target.matches("input[type='text'], input[type='search']") && e.target.hasAttribute("readonly")) {
    e.target.blur();
  }
});

Object.assign(window, {
  markCurrentAsSettled,
  openSettledHistoryModal,
  renderSettledHistory,
  restoreSettledBatch,
  deleteSettledBatch,
  uiConfirmClose,
  toggleSettlementPaid,
  markAllSettlementsPaid,
  openNamePicker,
  closeNamePicker,
  namePickerAddNew,
  renderNamePickerList,
  namePickerToggle,

  // keep your existing exports
  switchView,
  setListPeriod,
  shiftListDate,
  openListDatePicker,
  onListDatePicked,
  openMonthPicker,
  shiftMonthPicker,
  pickMonth,
  openEntryModal,
  saveEntry,
  editEntry,
  deleteEntry,
  triggerCopy,
  confirmCopyWithDate,
  openTemplatesModal,
  saveCurrentAsTemplate,
  applyTemplate,
  deleteTemplate,
  backupToDrive,
  restoreFromDrive,
  handleAuthClick,
  openDateModal,
  applyDateFilter,
  resetDates,
  openExportModal,
  executeExport,
  clearAllData,
  closeModal,

  setSettlementPaid,
  markAllSettlementsPaid,
  markCurrentAsSettled,
  restoreSettledBatch,
  deleteSettledBatch,
});
