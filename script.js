// =====================
// --- CONSTANTS & STATE ---
// =====================
const DRIVE_LOGIN_KEY = 'drive_logged_in';
const CURRENCY_SYMBOL = 'SR ';

const CLIENT_ID = '974172105806-e5erlmsl4tfp9n8pleuu8ii30vsru2il.apps.googleusercontent.com';
const API_KEY = 'AIzaSyA1Dqn0hzNXUZYCpBAKOFKgUr5QhWlBM';
const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest?fields=kind,discoveryVersion,version';

const SCOPES = 'https://www.googleapis.com/auth/drive.file';

let entries = JSON.parse(localStorage.getItem('expense_data_v7')) || [];
let tokenClient;
let gapiInited = false;
let gisInited = false;
let summaryStartDate = null;
let summaryEndDate = null;

// =====================
// --- UTILITY FUNCTIONS ---
// =====================
function cleanName(str) {
    return str ? str.trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : "";
}

function formatCurrency(amount) {
    return CURRENCY_SYMBOL + parseFloat(amount).toFixed(2);
}

function escapeHtml(t) {
    return (t || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// =====================
// --- INIT ON DOM LOAD ---
// =====================
document.addEventListener('DOMContentLoaded', () => {
    renderList();
    populateNames();

    // Pre-fill date modals
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('sumStart').value = today;
    document.getElementById('sumEnd').value = today;

    checkGoogleLoaded();
});

// =====================
// --- RENDERING FUNCTIONS ---
// =====================
function renderList() {
    const container = document.getElementById('listContainer');
    const search = document.getElementById('searchInput').value.toLowerCase();
    const type = document.getElementById('searchType').value;

    let data = [...entries].sort((a, b) => new Date(b.date) - new Date(a.date));

    if (search) {
        data = data.filter(e => {
            const itemMatch = e.item.toLowerCase().includes(search);
            const paidMatch = e.paidBy.toLowerCase().includes(search);
            const consMatch = e.consumedBy.toLowerCase().includes(search);
            const priceMatch = e.price.toString().includes(search);

            if (type === 'all') return itemMatch || paidMatch || consMatch || priceMatch;
            if (type === 'item') return itemMatch;
            if (type === 'paid') return paidMatch;
            if (type === 'consumed') return consMatch;
            if (type === 'price') return priceMatch;
            return false;
        });
    }

    const total = data.reduce((s, e) => s + parseFloat(e.price), 0);
    document.getElementById('headerTotal').innerText = formatCurrency(total);

    if (data.length === 0) {
        container.innerHTML = `<div style="text-align:center; padding:40px; color:#94a3b8;">No records found.</div>`;
        return;
    }

    container.innerHTML = data.map(e => `
        <div class="card" onclick="editEntry(${e.id})">
            <div class="card-row-1">
                <span class="card-title">${escapeHtml(e.item)}</span>
                <span class="card-price">${formatCurrency(e.price)}</span>
            </div>
            <div class="card-row-2">
                <div class="card-meta">
                    <i class="far fa-calendar"></i>
                    <span>${new Date(e.date).toLocaleDateString(undefined, {month:'short', day:'numeric'})}</span>
                </div>
                <div class="card-meta">
                    <span class="pill">${escapeHtml(e.paidBy)}</span>
                    <i class="fas fa-arrow-right" style="font-size:0.7rem"></i>
                    <span style="max-width:80px; overflow:hidden; white-space:nowrap; text-overflow:ellipsis;">${escapeHtml(e.consumedBy)}</span>
                </div>
            </div>
        </div>
    `).join('');
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

        const fmtStart = summaryStartDate.toLocaleDateString(undefined, {month:'short', day:'numeric', year:'numeric'});
        const fmtEnd = summaryEndDate.toLocaleDateString(undefined, {month:'short', day:'numeric', year:'numeric'});
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
function calculateSummary() {
    let data = entries;

    if (summaryStartDate && summaryEndDate) {
        data = entries.filter(x => {
            const d = new Date(x.date);
            return d >= summaryStartDate && d <= summaryEndDate;
        });
    }

    const paidTotals = {};
    const consTotals = {};

    // Pairwise debts: debts[Debtor][Creditor] = Amount
    const debts = {};

    data.forEach(entry => {
        const price = parseFloat(entry.price);
        const payers = entry.paidBy.split(/[,&|]+/).map(n => cleanName(n)).filter(n => n);
        const consumers = entry.consumedBy.split(/[,&|]+/).map(n => cleanName(n)).filter(n => n);

        if (payers.length === 0 || consumers.length === 0) return;

        const amountPerPayer = price / payers.length;
        const amountPerConsumer = price / consumers.length;

        // Global totals
        payers.forEach(p => {
            paidTotals[p] = (paidTotals[p] || 0) + amountPerPayer;
        });
        consumers.forEach(c => {
            consTotals[c] = (consTotals[c] || 0) + amountPerConsumer;
        });

        // Pairwise debts
        const debtPerPayer = amountPerConsumer / payers.length;
        consumers.forEach(c => {
            payers.forEach(p => {
                if (c !== p) {
                    if (!debts[c]) debts[c] = {};
                    debts[c][p] = (debts[c][p] || 0) + debtPerPayer;
                }
            });
        });
    });function calculateSummary() {
    let data = entries;

    if (summaryStartDate && summaryEndDate) {
        data = entries.filter(x => {
            const d = new Date(x.date);
            return d >= summaryStartDate && d <= summaryEndDate;
        });
    }

    const groupMap = {}; // { "payerKey|consumerKey": [entries] }

    data.forEach(entry => {
        const payers = entry.paidBy.split(',').map(n => cleanName(n)).filter(n => n);
        const consumers = entry.consumedBy.split(',').map(n => cleanName(n)).filter(n => n);

        if (!payers.length || !consumers.length) return; // skip invalid

        const payerKey = payers.join(', ');
        const consumerKey = consumers.join(', ');

        const groupKey = `${payerKey}|${consumerKey}`; // unique group key

        if (!groupMap[groupKey]) groupMap[groupKey] = [];
        groupMap[groupKey].push(entry);
    });

    let groupIndex = 1;
    const settlementHtml = [];

    for (const [key, entries] of Object.entries(groupMap)) {
        const [payerKey, consumerKey] = key.split('|');
        settlementHtml.push(`<div class="group-title">Group ${groupIndex} - Paid by: ${payerKey}, Consumed by: ${consumerKey}</div>`);

        const debts = {};

        entries.forEach(e => {
            const price = parseFloat(e.price);
            const payers = e.paidBy.split(',').map(n => cleanName(n)).filter(n => n);
            const consumers = e.consumedBy.split(',').map(n => cleanName(n)).filter(n => n);

            const amountPerConsumer = price / consumers.length;
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

        // Render debts for this group
        const debtsHtml = [];
        Object.keys(debts).forEach(c => {
            Object.keys(debts[c]).forEach(p => {
                debtsHtml.push(`<div class="settle-item">${c} pays ${p} <b>${formatCurrency(debts[c][p])}</b></div>`);
            });
        });

        settlementHtml.push(debtsHtml.join(''));
        groupIndex++;
    }

    document.getElementById('settlementArea').innerHTML = settlementHtml.join('');
}


    // Render grouped settlements
    let html = '';
    Object.keys(groupMap).forEach((consKey, idx) => {
        html += `<div class="group">
                    <div class="group-title">Group ${idx + 1} - Consumed by: ${consKey}</div>
                    ${groupMap[consKey].map(s => `<div class="settle-item"><i class="fas fa-check-circle"></i> ${s.from} pays ${s.to} <b>${formatCurrency(s.amt)}</b></div>`).join('')}
                 </div>`;
    });

    document.getElementById('settlementArea').innerHTML = html || 
        `<div style="text-align:center; color:#94a3b8;">All Settled</div>`;
}



// =====================
// --- CRUD FUNCTIONS ---
// =====================
function openEntryModal() {
    document.getElementById('modalTitle').innerText = "Add Expense";
    document.getElementById('entryId').value = "";
    document.getElementById('inpDate').value = new Date().toISOString().slice(0,16);
    document.getElementById('inpItem').value = "";
    document.getElementById('inpPrice').value = "";
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
    document.getElementById('inpDate').value = e.date.slice(0,16);
    document.getElementById('inpItem').value = e.item;
    document.getElementById('inpPrice').value = e.price;
    document.getElementById('inpPaid').value = e.paidBy;
    document.getElementById('inpConsumed').value = e.consumedBy;
    document.getElementById('inpDesc').value = e.desc || "";
    document.getElementById('editTools').classList.remove('hidden');
    document.getElementById('modalEntry').classList.add('active');
}

function saveEntry() {
    const id = document.getElementById('entryId').value;
    const dateStr = document.getElementById('inpDate').value;
    const item = document.getElementById('inpItem').value.trim();
    const price = parseFloat(document.getElementById('inpPrice').value);
    const paidBy = document.getElementById('inpPaid').value.split(/[,&|]+/).map(cleanName).filter(n=>n).join(', ');
    const consumedBy = document.getElementById('inpConsumed').value.split(/[,&|]+/).map(cleanName).filter(n=>n).join(', ');
    const desc = document.getElementById('inpDesc').value;

    if (!dateStr || !item || isNaN(price) || !paidBy || !consumedBy) {
        alert("Please fill in Date, Item, Price, and Names.");
        return;
    }

    const obj = {
        id: id ? parseInt(id) : Date.now(),
        date: new Date(dateStr).toISOString(),
        item, price, paidBy, consumedBy, desc
    };

    if (id) {
        const idx = entries.findIndex(x => x.id == id);
        if (idx > -1) entries[idx] = obj;
    } else {
        entries.push(obj);
    }

    persist();
    closeModal('modalEntry');
    renderList();
}

function deleteEntry() {
    if (!confirm("Delete record?")) return;
    const id = parseInt(document.getElementById('entryId').value);
    entries = entries.filter(x => x.id !== id);
    persist();
    closeModal('modalEntry');
    renderList();
}

function finishCopy() {
    const val = document.getElementById('copyDateInput').value;
    if (!val) return;
    const d = new Date(val);
    d.setHours(12,0,0);
    const e = entries.find(x => x.id == document.getElementById('entryId').value);
    if (e) {
        const copy = {...e, id: Date.now(), date: d.toISOString()};
        entries.push(copy);
        persist();
        alert("Copied!");
        closeModal('modalEntry');
        renderList();
    }
}

// =====================
// --- CSV IMPORT/EXPORT ---
// =====================
function handleFileSelect(input) {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        importCSV(e.target.result);
        input.value = "";
    };
    reader.readAsText(file);
}

function importCSV(csvText) {
    const lines = csvText.split('\n');
    let count = 0;
    const startIndex = lines[0].toLowerCase().includes('date') ? 1 : 0;

    for (let i=startIndex;i<lines.length;i++){
        const line = lines[i].trim();
        if(!line) continue;
        const matches = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g);
        const cols = matches ? matches.map(m=>m.replace(/^"|"$/g,'')) : line.split(',');
        if(cols.length>=4){
            const d=new Date(cols[0]);
            const item = cols[1] || "Imported Item";
            const price=parseFloat(cols[2])||0;
            const paidBy=cols[3]||"Unknown";
            const consumedBy=cols[4]||"Unknown";
            const desc=cols[5]||"";

            if(!isNaN(d.getTime()) && price>0){
                entries.push({
                    id: Date.now()+count,
                    date: d.toISOString(),
                    item: item.trim(),
                    price,
                    paidBy: cleanName(paidBy),
                    consumedBy: consumedBy.split(/[,&|]+/).map(cleanName).join(', '),
                    desc: desc.trim()
                });
                count++;
            }
        }
    }

    if(count>0){
        persist();
        alert(`Successfully imported ${count} records!`);
        renderList();
    } else alert("Failed to import. Check CSV format.");
}

function executeExport(type){
    const sVal = document.getElementById('expStart').value;
    const eVal = document.getElementById('expEnd').value;
    let data = entries;
    if(sVal && eVal){
        const s=new Date(sVal);
        const e=new Date(eVal);
        e.setHours(23,59);
        data = entries.filter(x=>{
            const d=new Date(x.date);
            return d>=s && d<=e
        });
    }
    let csv = "Date,Item,Price,PaidBy,ConsumedBy,Description\n";
    data.forEach(r=>csv+=`${new Date(r.date).toLocaleDateString()},"${r.item}",${r.price},"${r.paidBy}","${r.consumedBy}","${r.desc||''}"\n`);
    const file = new File([csv],"expenses.csv",{type:'text/csv'});
    if(type==='share' && navigator.canShare && navigator.canShare({files:[file]})) navigator.share({files:[file]});
    else {
        const a=document.createElement('a');
        a.href=URL.createObjectURL(file);
        a.download='expenses.csv';
        a.click();
    }
    closeModal('modalExport');
}

// =====================
// --- LOCAL STORAGE ---
// =====================
function persist() {
    localStorage.setItem('expense_data_v7', JSON.stringify(entries));
    populateNames();
}

function populateNames() {
    const s = new Set();
    entries.forEach(e => {
        e.paidBy.split(',').forEach(x=>s.add(x.trim()));
        e.consumedBy.split(',').forEach(x=>s.add(x.trim()));
    });
    document.getElementById('namesList').innerHTML = [...s].map(n=>`<option value="${n}">`).join('');
}

// =====================
// --- MODAL & UI ---
// =====================
function closeModal(id){ document.getElementById(id).classList.remove('active'); }
function clearAllData(){ if(confirm("Permanently delete all local data?")){ entries=[]; persist(); renderList(); } }
function switchView(id){
    document.querySelectorAll('.view-section').forEach(v=>v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(b=>b.classList.remove('active'));
    if(id==='list'){ document.getElementById('viewList').classList.add('active'); document.getElementById('btnList').classList.add('active'); renderList();}
    else if(id==='summary'){ document.getElementById('viewSummary').classList.add('active'); document.getElementById('btnSum').classList.add('active'); calculateSummary();}
    else{ document.getElementById('viewSettings').classList.add('active'); document.getElementById('btnSet').classList.add('active'); }
}

function openExportModal(){ document.getElementById('modalExport').classList.add('active'); }

// =====================
// --- GOOGLE DRIVE ---
// =====================
function checkGoogleLoaded() {
    if (typeof google !== 'undefined' && typeof gapi !== 'undefined') {
        gisLoaded();
        gapiLoaded();
    } else {
        setTimeout(checkGoogleLoaded, 500);
    }
}

function gapiLoaded() {
    gapi.load('client', async ()=>{
        try {
            await gapi.client.init({apiKey: API_KEY, discoveryDocs:[DISCOVERY_DOC]});
            gapiInited=true;
            updateDriveUI();
        } catch(e){ console.error(e); alert("Failed to load Google API."); }
    });
}

function gisLoaded() {
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: async (resp)=>{
            if(resp.error) { console.error(resp); alert("Drive login failed."); return; }
            document.getElementById('syncStatus').innerHTML = '<span style="color:green">Connected to Drive</span>';
            document.getElementById('driveControls').classList.add('hidden');
            document.getElementById('driveActions').classList.remove('hidden');
        }
    });
    gisInited=true;
    updateDriveUI();
}

function updateDriveUI(){
    if(gapiInited && gisInited){
        document.getElementById('syncStatus').innerText = "Ready to connect.";
        document.getElementById('driveControls').classList.remove('hidden');
        document.getElementById('driveActions').classList.add('hidden');
    }
}

async function loginDrive(){
    if(!tokenClient) return;
    tokenClient.requestAccessToken();
}

async function backupToDrive(){
    const blob = new Blob([JSON.stringify(entries)], {type:'application/json'});
    const metadata = {
        name: 'expenses_backup.json',
        mimeType: 'application/json'
    };

    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], {type:'application/json'}));
    form.append('file', blob);

    try {
        const token = gapi.client.getToken() ? gapi.client.getToken().access_token : null;
        if(!token) { alert("Not logged in!"); return; }

        const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
            method:'POST',
            headers: { Authorization: 'Bearer '+token },
            body: form
        });
        if(res.ok) alert("Backup uploaded to Google Drive!");
        else alert("Drive backup failed.");
    } catch(e){ console.error(e); alert("Drive backup failed."); }
}

async function restoreFromDrive(){
    try {
        const token = gapi.client.getToken() ? gapi.client.getToken().access_token : null;
        if(!token) { alert("Not logged in!"); return; }

        const res = await fetch('https://www.googleapis.com/drive/v3/files?q=name="expenses_backup.json"&orderBy=modifiedTime desc&fields=files(id,name)',{
            headers:{Authorization:'Bearer '+token}
        });
        const data = await res.json();
        if(!data.files || data.files.length===0){ alert("No backup found."); return; }

        const fileId = data.files[0].id;
        const fileRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,{
            headers:{Authorization:'Bearer '+token}
        });
        const text = await fileRes.text();
        entries = JSON.parse(text);
        persist();
        renderList();
        alert("Backup restored!");
    } catch(e){ console.error(e); alert("Drive restore failed."); }
}
