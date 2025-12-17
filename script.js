 // --- CURRENCY CONSTANT ---
        const CURRENCY_SYMBOL = 'SR '; 

        // --- GOOGLE CONFIGURATION ---
        const CLIENT_ID = '974172105806-e5erlmsl4tfp9n8pleuu8ii30vsru2il.apps.googleusercontent.com'; 
        const API_KEY = 'AIzaSyA1Dqnkj0hzNXUZYCpBAKOFKgUr5QhWlBM';
        
        const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';
        const SCOPES = 'https://www.googleapis.com/auth/drive.file';

        // --- STATE ---
        let entries = JSON.parse(localStorage.getItem('expense_data_v7')) || [];
        let tokenClient;
        let gapiInited = false;
        let gisInited = false;
        let summaryStartDate = null;
        let summaryEndDate = null;

        document.addEventListener('DOMContentLoaded', () => {
            renderList();
            populateNames();
            // Pre-fill date modals
            const today = new Date().toISOString().split('T')[0];
            document.getElementById('sumStart').value = today;
            document.getElementById('sumEnd').value = today;
            

                checkGoogleLoaded();
            
        });

        // --- CORE LOGIC ---
        function cleanName(str) {
            return str ? str.trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : "";
        }
        
        function formatCurrency(amount) {
            return CURRENCY_SYMBOL + parseFloat(amount).toFixed(2);
        }

        function renderList() {
            const container = document.getElementById('listContainer');
            const search = document.getElementById('searchInput').value.toLowerCase();
            const type = document.getElementById('searchType').value;
            
            let data = [...entries].sort((a,b) => new Date(b.date) - new Date(a.date));
            
            if(search) {
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

            const total = data.reduce((s,e) => s + parseFloat(e.price), 0);
            document.getElementById('headerTotal').innerText = formatCurrency(total);

            if(data.length === 0) {
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

        // --- SUMMARY LOGIC ---
        function openDateModal() {
            document.getElementById('modalDateFilter').classList.add('active');
        }

        function applyDateFilter() {
            const sVal = document.getElementById('sumStart').value;
            const eVal = document.getElementById('sumEnd').value;
            
            if(sVal && eVal) {
                summaryStartDate = new Date(sVal);
                summaryEndDate = new Date(eVal);
                summaryEndDate.setHours(23,59,59);
                
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
            
            if(summaryStartDate && summaryEndDate) {
                data = entries.filter(x => { 
                    const d = new Date(x.date); 
                    return d >= summaryStartDate && d <= summaryEndDate; 
                });
            }

            const paidTotals = {};
            const consTotals = {};
            
            // Pairwise Debt Matrix: debts[Debtor][Creditor] = Amount
            // This ensures strict relationships without ghost payers
            const debts = {};

            data.forEach(entry => {
                const price = parseFloat(entry.price);
                const payers = entry.paidBy.split(/[,&|]+/).map(n => cleanName(n)).filter(n=>n);
                const consumers = entry.consumedBy.split(/[,&|]+/).map(n => cleanName(n)).filter(n=>n);
                
                if(payers.length === 0 || consumers.length === 0) return;

                const amountPerPayer = price / payers.length;
                const amountPerConsumer = price / consumers.length;

                // 1. Populate Global Stats
                payers.forEach(p => {
                    paidTotals[p] = (paidTotals[p] || 0) + amountPerPayer;
                });
                consumers.forEach(c => {
                    consTotals[c] = (consTotals[c] || 0) + amountPerConsumer;
                });

                // 2. Populate Pairwise Debts
                // Rule: Each Consumer owes Each Payer part of the bill
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

            // 3. Simplify Pairwise Debts (Strictly A <-> B)
            const settlements = [];
            const people = Array.from(new Set([...Object.keys(paidTotals), ...Object.keys(consTotals)]));

            for (let i = 0; i < people.length; i++) {
                for (let j = i + 1; j < people.length; j++) {
                    const p1 = people[i];
                    const p2 = people[j];

                    // Check debt p1 -> p2
                    const d1 = (debts[p1] && debts[p1][p2]) || 0;
                    // Check debt p2 -> p1
                    const d2 = (debts[p2] && debts[p2][p1]) || 0;

                    const net = d1 - d2;
                    if (net > 0.01) {
                        settlements.push({ from: p1, to: p2, amt: net });
                    } else if (net < -0.01) {
                        settlements.push({ from: p2, to: p1, amt: -net });
                    }
                }
            }

            document.getElementById('settlementArea').innerHTML = settlements.length
                ? settlements.map(s => `<div class="settle-item"><i class="fas fa-check-circle"></i> ${s.from} pays ${s.to} <b>${formatCurrency(s.amt)}</b></div>`).join('')
                : `<div style="text-align:center; color:#94a3b8;">All Settled</div>`;
        }

        function renderMap(map) {
            return Object.keys(map).sort().map(k => {
                if(map[k] < 0.01) return '';
                return `<div class="stat-row"><span>${k}</span><span>${formatCurrency(map[k])}</span></div>`;
            }).join('') || '<div style="text-align:center; color:#ccc">-</div>';
        }

        // --- CSV IMPORT LOGIC ---
        function handleFileSelect(input) {
            const file = input.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = function(e) {
                const text = e.target.result;
                importCSV(text);
                input.value = ""; // Reset
            };
            reader.readAsText(file);
        }

        function importCSV(csvText) {
            const lines = csvText.split('\n');
            let count = 0;
            const startIndex = lines[0].toLowerCase().includes('date') ? 1 : 0;

            for(let i=startIndex; i<lines.length; i++) {
                const line = lines[i].trim();
                if(!line) continue;
                const matches = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g); 
                const cols = matches ? matches.map(m => m.replace(/^"|"$/g, '')) : line.split(',');

                if(cols.length >= 4) {
                    const d = new Date(cols[0]);
                    const item = cols[1] || "Imported Item";
                    const price = parseFloat(cols[2]) || 0;
                    const paidBy = cols[3] || "Unknown";
                    const consumedBy = cols[4] || "Unknown";
                    const desc = cols[5] || "";

                    if(!isNaN(d.getTime()) && price > 0) {
                        entries.push({
                            id: Date.now() + count, 
                            date: d.toISOString(),
                            item: item.trim(),
                            price: price,
                            paidBy: cleanName(paidBy),
                            consumedBy: consumedBy.split(/[,&|]+/).map(n=>cleanName(n)).join(', '),
                            desc: desc.trim()
                        });
                        count++;
                    }
                }
            }

            if(count > 0) {
                persist();
                alert(`Successfully imported ${count} records!`);
                renderList();
            } else {
                alert("Failed to import. Check CSV format.");
            }
        }

        // --- CRUD (Existing) ---
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
            if(!e) return;
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
            const paidRaw = document.getElementById('inpPaid').value;
            const paidBy = paidRaw.split(/[,&|]+/).map(n => cleanName(n)).filter(n=>n).join(', ');
            const consRaw = document.getElementById('inpConsumed').value;
            const consumedBy = consRaw.split(/[,&|]+/).map(n => cleanName(n)).filter(n=>n).join(', ');
            const desc = document.getElementById('inpDesc').value;

            if(!dateStr || !item || isNaN(price) || !paidBy || !consumedBy) {
                alert("Please fill in Date, Item, Price, and Names.");
                return;
            }

            const obj = { id: id ? parseInt(id) : Date.now(), date: new Date(dateStr).toISOString(), item, price, paidBy, consumedBy, desc };

            if(id) {
                const idx = entries.findIndex(x => x.id == id);
                if(idx > -1) entries[idx] = obj;
            } else {
                entries.push(obj);
            }

            persist();
            closeModal('modalEntry');
            renderList();
        }

        function deleteEntry() {
            if(!confirm("Delete record?")) return;
            const id = parseInt(document.getElementById('entryId').value);
            entries = entries.filter(x => x.id !== id);
            persist();
            closeModal('modalEntry');
            renderList();
        }

        function triggerCopy() { try{document.getElementById('copyDateInput').showPicker()}catch(e){document.getElementById('copyDateInput').click()} }
        function finishCopy() {
            const val = document.getElementById('copyDateInput').value;
            if(!val) return;
            const d = new Date(val); d.setHours(12,0,0);
            const e = entries.find(x => x.id == document.getElementById('entryId').value);
            if(e) {
                const copy = {...e, id: Date.now(), date: d.toISOString()};
                entries.push(copy);
                persist();
                alert("Copied!");
                closeModal('modalEntry');
                renderList();
            }
        }

        // --- GOOGLE DRIVE & UTILS (Existing) ---
        function checkGoogleLoaded() { if (typeof google !== 'undefined' && typeof gapi !== 'undefined') { gisLoaded(); gapiLoaded(); } else { setTimeout(checkGoogleLoaded, 500); } }
        function gapiLoaded() { gapi.load('client', async () => { await gapi.client.init({ apiKey: API_KEY, discoveryDocs: [DISCOVERY_DOC] }); gapiInited = true; updateDriveUI(); }); }
        function gisLoaded() { tokenClient = google.accounts.oauth2.initTokenClient({ client_id: CLIENT_ID, scope: SCOPES, callback: '', }); gisInited = true; updateDriveUI(); }
        function updateDriveUI() { if(gapiInited && gisInited) { document.getElementById('syncStatus').innerText = "Ready to connect."; document.getElementById('driveControls').classList.remove('hidden'); document.getElementById('driveActions').classList.add('hidden'); } }
        function handleAuthClick() { tokenClient.callback = async (resp) => { if (resp.error) throw resp; document.getElementById('syncStatus').innerHTML = '<span style="color:green">Connected to Drive</span>'; document.getElementById('syncStatus').classList.add('active'); document.getElementById('driveControls').classList.add('hidden'); document.getElementById('driveActions').classList.remove('hidden'); }; if (gapi.client.getToken() === null) { tokenClient.requestAccessToken({prompt: 'consent'}); } else { tokenClient.requestAccessToken({prompt: ''}); } }
        async function backupToDrive() { try { const data = JSON.stringify(entries); const fileMetadata = { 'name': 'expense_manager_backup.json', 'mimeType': 'application/json' }; const q = "name = 'expense_manager_backup.json' and trashed = false"; const response = await gapi.client.drive.files.list({ q: q, fields: 'files(id, name)' }); const files = response.result.files; if (files && files.length > 0) { const fileId = files[0].id; await gapi.client.request({ path: '/upload/drive/v3/files/' + fileId, method: 'PATCH', params: { uploadType: 'media' }, body: data }); alert("Backup Updated Successfully!"); } else { const form = new FormData(); form.append('metadata', new Blob([JSON.stringify(fileMetadata)], {type: 'application/json'})); form.append('file', new Blob([data], {type: 'application/json'})); await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', { method: 'POST', headers: new Headers({'Authorization': 'Bearer ' + gapi.client.getToken().access_token}), body: form }); alert("Backup Created Successfully!"); } } catch (err) { console.error(err); alert("Backup failed. Check console."); } }
        async function restoreFromDrive() { if(!confirm("This will overwrite current local data. Continue?")) return; try { const q = "name = 'expense_manager_backup.json' and trashed = false"; const response = await gapi.client.drive.files.list({ q: q, fields: 'files(id, name)' }); const files = response.result.files; if (files && files.length > 0) { const fileId = files[0].id; const result = await gapi.client.drive.files.get({ fileId: fileId, alt: 'media' }); entries = result.result; if(typeof entries === 'string') entries = JSON.parse(entries); persist(); alert("Data restored!"); renderList(); } else { alert("No backup file found in Drive."); } } catch (err) { console.error(err); alert("Restore failed."); } }
        
        function persist() { localStorage.setItem('expense_data_v7', JSON.stringify(entries)); populateNames(); }
        function populateNames() { const s = new Set(); entries.forEach(e => { e.paidBy.split(',').forEach(x=>s.add(x.trim())); e.consumedBy.split(',').forEach(x=>s.add(x.trim())); }); document.getElementById('namesList').innerHTML = [...s].map(n=>`<option value="${n}">`).join(''); }
        function closeModal(id) { document.getElementById(id).classList.remove('active'); }
        function escapeHtml(t) { return (t||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
        function clearAllData() { if(confirm("Permanently delete all local data?")) { entries = []; persist(); renderList(); } }
        function switchView(id) { document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active')); document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active')); if(id==='list') { document.getElementById('viewList').classList.add('active'); document.getElementById('btnList').classList.add('active'); renderList(); } else if(id==='summary') { document.getElementById('viewSummary').classList.add('active'); document.getElementById('btnSum').classList.add('active'); calculateSummary(); } else { document.getElementById('viewSettings').classList.add('active'); document.getElementById('btnSet').classList.add('active'); } }
        function openExportModal() { document.getElementById('modalExport').classList.add('active'); }
        function executeExport(type) { const sVal = document.getElementById('expStart').value; const eVal = document.getElementById('expEnd').value; let data = entries; if(sVal && eVal) { const s=new Date(sVal); const e=new Date(eVal); e.setHours(23,59); data=entries.filter(x=>{const d=new Date(x.date); return d>=s && d<=e}); } let csv = "Date,Item,Price,PaidBy,ConsumedBy,Description\n"; data.forEach(r => csv += `${new Date(r.date).toLocaleDateString()},"${r.item}",${r.price},"${r.paidBy}","${r.consumedBy}","${r.desc||''}"\n`); const file = new File([csv], "expenses.csv", {type:'text/csv'}); if(type==='share' && navigator.canShare && navigator.canShare({files:[file]})) navigator.share({files:[file]}); else { const a=document.createElement('a'); a.href=URL.createObjectURL(file); a.download='expenses.csv'; a.click(); } closeModal('modalExport'); }
    
