const state = {
  currentSheet: 'DASHBOARD',
  data: [], headers: [], filteredData: [], indexedData: [], filteredIndexed: [],
  page: 0, pageSize: 25, editingRow: null, fournisseursData: [],
  currentUserEmail: "chargement...", isAdmin: false
};

const ADMIN_EMAIL = "kpstrategy09@gmail.com"; 

const comparatorState = {
  selections: [null, null, null, null, null],
  notes: { 'Qualité technique': [null, null, null, null, null], 'Délai': [null, null, null, null, null], 'Garantie': [null, null, null, null, null], 'SAV': [null, null, null, null, null], 'Pièces détachées': [null, null, null, null, null], 'Logistique': [null, null, null, null, null], 'Expérience': [null, null, null, null, null], 'Conditions de paiement': [null, null, null, null, null] },
  ponderation: { 'Prix': 0.25, 'Qualité technique': 0.20, 'Délai': 0.15, 'Garantie': 0.10, 'SAV': 0.10, 'Pièces détachées': 0.05, 'Logistique': 0.05, 'Expérience': 0.05, 'Conditions de paiement': 0.05 },
  taux: null
};

let pingInterval = null;
let chartFournisseursInstance = null;
let chartProjetsInstance = null;

document.addEventListener('DOMContentLoaded', () => { bindEvents(); });

function bindEvents() {
  document.addEventListener('click', (e) => {
    const navBtn = e.target.closest('.nav-btn');
    if (navBtn && !navBtn.classList.contains('sub-btn')) {
      e.preventDefault();
      const sheetKey = navBtn.getAttribute('data-sheet');
      if (sheetKey) switchSheet(sheetKey);
    }
  });

  const $ = id => document.getElementById(id);
  if ($('login-btn')) $('login-btn').addEventListener('click', login);
  if ($('logout-btn')) $('logout-btn').addEventListener('click', logout);
  if ($('add-btn')) $('add-btn').addEventListener('click', () => openModal(null));
  if ($('refresh-btn')) $('refresh-btn').addEventListener('click', onRefresh);
  if ($('search-input')) $('search-input').addEventListener('input', onSearch);
  if ($('modal-close')) $('modal-close').addEventListener('click', closeModal);
  if ($('cancel-btn')) $('cancel-btn').addEventListener('click', closeModal);
  if ($('nav-prev-btn')) $('nav-prev-btn').addEventListener('click', () => document.querySelector('.table-wrapper').scrollBy({ left: -300, behavior: 'smooth' }));
  if ($('nav-next-btn')) $('nav-next-btn').addEventListener('click', () => document.querySelector('.table-wrapper').scrollBy({ left: 300, behavior: 'smooth' }));
  
  // GESTION DU MENU MOBILE
  const mobileBtn = document.getElementById('mobile-menu-btn');
  const sidebar = document.getElementById('sidebar');
  if (mobileBtn && sidebar) {
    mobileBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      sidebar.classList.toggle('open');
    });
    
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (window.innerWidth <= 768) sidebar.classList.remove('open');
      });
    });
  }
}

function onRefresh() {
  if (state.currentSheet === 'DASHBOARD') {
    loadDashboard();
  } else if (state.currentSheet === 'COMPARATEUR') {
    refreshFournisseursCache().then(initComparator);
  } else if (state.currentSheet === 'RELANCES') {
    loadRelancesView();
  } else {
    loadSheet();
  }
  showToast('🔄 Données actualisées', 'success');
}

window.quickFilter = function(sheetKey, filterStr) {
  switchSheet(sheetKey).then(() => {
    setTimeout(() => {
      document.getElementById('search-input').value = filterStr;
      onSearch();
    }, 300);
  });
};

async function login() {
  const status = document.getElementById('login-status');
  const overlay = document.getElementById('loading-overlay');
  const btn = document.getElementById('login-btn');
  
  btn.classList.add('hidden');
  overlay.classList.remove('hidden');
  status.textContent = '';

  try {
    await sheetsAPI.init();
    try {
      const res = await fetch(`https://www.googleapis.com/oauth2/v3/userinfo?access_token=${sheetsAPI.token}`);
      const data = await res.json();
      if (data && data.email) state.currentUserEmail = data.email;
      else throw new Error("Email absent");
    } catch (e) {
      try {
        const base64Url = sheetsAPI.token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
        state.currentUserEmail = JSON.parse(jsonPayload).email || "utilisateur@inconnu.com";
      } catch (err) { state.currentUserEmail = "utilisateur@inconnu.com"; }
    }
    
    document.getElementById('user-email').textContent = state.currentUserEmail;
    if (state.currentUserEmail.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
      state.isAdmin = true;
      document.getElementById('admin-section').classList.remove('hidden');
    } else {
      state.isAdmin = false;
      document.getElementById('admin-section').classList.add('hidden');
    }

    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');

    await refreshFournisseursCache();
    updatePresence();
    if (pingInterval) clearInterval(pingInterval);
    pingInterval = setInterval(updatePresence, 15000);
    
    await switchSheet('DASHBOARD');
  } catch (err) { 
    status.textContent = 'Erreur : ' + (err.message || JSON.stringify(err)); 
    btn.classList.remove('hidden');
    overlay.classList.add('hidden');
  }
}

function logout() {
  if (pingInterval) clearInterval(pingInterval);
  if (sheetsAPI.token) google.accounts.oauth2.revoke(sheetsAPI.token, () => {});
  location.reload();
}

async function logActivity(module, action, details) {
  try {
    const now = new Date();
    const row = [now.toLocaleDateString('fr-FR'), now.toLocaleTimeString('fr-FR'), state.currentUserEmail, module, action, details];
    await sheetsAPI.appendRow(CONFIG.SHEETS.LOGS, row);
  } catch (e) {}
}

async function updatePresence() {
  if (!state.currentUserEmail || state.currentUserEmail.includes("inconnu")) return;
  try {
    const values = await sheetsAPI.readSheet(CONFIG.SHEETS.PRESENCE);
    let foundIndex = -1;
    if (values && values.length > 1) {
      for (let i = 1; i < values.length; i++) {
        if (values[i][0] === state.currentUserEmail) { foundIndex = i; break; }
      }
    }
    const nowStr = new Date().toISOString();
    if (foundIndex !== -1) {
      await gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId: CONFIG.SPREADSHEET_ID,
        range: `${CONFIG.SHEETS.PRESENCE}!A${foundIndex + 1}:B${foundIndex + 1}`,
        valueInputOption: 'RAW',
        resource: { values: [[state.currentUserEmail, nowStr]] }
      });
    } else {
      await sheetsAPI.appendRow(CONFIG.SHEETS.PRESENCE, [state.currentUserEmail, nowStr]);
    }
  } catch (e) {}
}

async function syncContactToSheet(entreprise, contactName, email, phone, country) {
  if (!entreprise || entreprise.trim() === '') return;
  try {
    const contacts = await sheetsAPI.readSheet(CONFIG.SHEETS.CONTACTS);
    let contactExists = false, rowIndex = -1;
    if (contacts && contacts.length > 1) {
      for (let i = 1; i < contacts.length; i++) {
        if ((contacts[i][2] || '').toString().toLowerCase().trim() === entreprise.toLowerCase().trim()) {
          contactExists = true; rowIndex = i; break;
        }
      }
    }
    const nowStr = new Date().toISOString().split('T')[0];
    if (contactExists) {
      await gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId: CONFIG.SPREADSHEET_ID,
        range: `${CONFIG.SHEETS.CONTACTS}!N${rowIndex + 1}`,
        valueInputOption: 'RAW',
        resource: { values: [[nowStr]] }
      });
    } else {
      const newRow = [`C-${Date.now()}`, 'Auto-Généré', entreprise, contactName || '', '', '', country || '', '', '', email || '', phone || '', '', 'Synchronisation auto', nowStr, 'À vérifier', 'Normale', '', ''];
      await sheetsAPI.appendRow(CONFIG.SHEETS.CONTACTS, newRow);
    }
  } catch (e) {}
}

async function refreshFournisseursCache() {
  try {
    const fournisseurs = await sheetsAPI.readSheet(CONFIG.SHEETS.FOURNISSEURS);
    if (fournisseurs && fournisseurs.length > 1) {
      const headers = fournisseurs[0];
      const findIdx = name => headers.findIndex(h => (h || '').toString().toLowerCase().trim() === name.toLowerCase());
      const iId = findIdx('ID'); const iNom = findIdx('Entreprise'); const iPays = findIdx('Pays');
      const iContact = findIdx('Contact'); const iPrix = findIdx('Prix indicatif'); const iDevise = findIdx('Devise');

      state.fournisseursData = fournisseurs.slice(1).filter(row => row.some(c => c)).map((row, i) => ({
        id: iId >= 0 ? (row[iId] || `F-${i+1}`) : `F-${i+1}`,
        nom: iNom >= 0 ? (row[iNom] || 'Inconnu') : (row[1] || 'Inconnu'),
        pays: iPays >= 0 ? (row[iPays] || '-') : (row[2] || '-'),
        contact: iContact >= 0 ? (row[iContact] || '-') : (row[3] || '-'),
        prix: iPrix >= 0 ? (row[iPrix] || 'Non renseigné') : (row[11] || 'Non renseigné'),
        devise: iDevise >= 0 ? (row[iDevise] || '') : '', raw: row, headers: headers
      }));
    } else { state.fournisseursData = []; }
  } catch (e) { state.fournisseursData = []; }
}

async function switchSheet(sheetKey) {
  if (['UTILISATEURS', 'LOGS', 'PRESENCE'].includes(sheetKey) && !state.isAdmin) {
    showToast("Accès refusé : Droits administrateur requis.", "error");
    return;
  }

  state.currentSheet = sheetKey;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-sheet') === sheetKey));

  const views = ['dashboard-view', 'table-view', 'comparator-view'];
  views.forEach(id => { const el = document.getElementById(id); if (el) el.classList.add('hidden'); });

  if (sheetKey === 'DASHBOARD') {
    document.getElementById('dashboard-view').classList.remove('hidden');
    await loadDashboard();
  } else if (sheetKey === 'COMPARATEUR') {
    document.getElementById('comparator-view').classList.remove('hidden');
    await refreshFournisseursCache();
    initComparator();
  } else if (sheetKey === 'RELANCES') {
    document.getElementById('table-view').classList.remove('hidden');
    document.getElementById('page-title').textContent = 'Relances';
    document.getElementById('search-input').value = '';
    await loadRelancesView();
  } else {
    document.getElementById('table-view').classList.remove('hidden');
    const btn = document.querySelector(`.nav-btn[data-sheet="${sheetKey}"]`);
    document.getElementById('page-title').textContent = btn ? btn.textContent.trim() : sheetKey;
    document.getElementById('page-subtitle').textContent = `Module : ${sheetKey}`;
    document.getElementById('search-input').value = '';
    await loadSheet();
  }
}

function getColIndex(headers, colName) {
  return headers.findIndex(h => (h || '').toString().toLowerCase().trim() === colName.toLowerCase());
}

async function loadDashboard() {
  const container = document.getElementById('dashboard-stats');
  if (!container) return;
  container.innerHTML = '<div class="loading"><i class="fa-solid fa-spinner fa-spin"></i> Analyse des données...</div>';
  
  try {
    const fetchData = async (sheetName) => {
      try {
        if (typeof sheetsAPI.ensureSheet === 'function') {
          await sheetsAPI.ensureSheet(sheetName, SCHEMAS[sheetName] || []);
        }
        const values = await sheetsAPI.readSheet(sheetName);
        if (!values || values.length < 1) return { headers: [], rows: [] };
        return { headers: values[0], rows: values.slice(1).filter(r => r.some(c => c)) };
      } catch (e) { return { headers: [], rows: [] }; }
    };

    const [dataContacts, dataFournisseurs, dataEpc, dataIngenieurs, dataTradeFin, dataGaranties, dataRelances, dataProjets] = await Promise.all([
      fetchData(CONFIG.SHEETS.CONTACTS), fetchData(CONFIG.SHEETS.FOURNISSEURS), fetchData(CONFIG.SHEETS.EPC),
      fetchData(CONFIG.SHEETS.INGENIEURS), fetchData(CONFIG.SHEETS.TRADE_FINANCE), fetchData(CONFIG.SHEETS.GARANTIES),
      fetchData(CONFIG.SHEETS.RELANCES), fetchData(CONFIG.SHEETS.PROJETS)
    ]);

    const countWhere = (data, colName, keyword) => {
      const idx = getColIndex(data.headers, colName);
      if (idx === -1) return 0;
      return data.rows.filter(r => (r[idx] || '').toString().toLowerCase().includes(keyword.toLowerCase())).length;
    };

    const totalContacts = dataContacts.rows.length;
    const contactsVerifies = countWhere(dataContacts, 'Statut vérification', 'vérifié') + countWhere(dataContacts, 'Statut vérification', 'valide');
    const contactsAfficher = totalContacts - contactsVerifies;
    const contactsEnNegociation = countWhere(dataContacts, 'Priorité', 'négociation') + countWhere(dataContacts, 'Statut vérification', 'négociation');
    
    const totalProjets = dataProjets.rows.length;
    const projetsEnCours = countWhere(dataProjets, 'Statut', 'cours') + countWhere(dataProjets, 'Statut', 'exécution');
    const projetsRecherche = countWhere(dataProjets, 'Statut', 'recherche') + countWhere(dataProjets, 'Statut', 'financement');

    const totalFournisseurs = dataFournisseurs.rows.length;
    const fSoja = countWhere(dataFournisseurs, 'Catégorie', 'soja') + countWhere(dataFournisseurs, 'Spécialité', 'soja');
    const fBle = countWhere(dataFournisseurs, 'Catégorie', 'blé') + countWhere(dataFournisseurs, 'Spécialité', 'blé');
    const fMais = countWhere(dataFournisseurs, 'Catégorie', 'maïs') + countWhere(dataFournisseurs, 'Spécialité', 'maïs');
    const fRiz = countWhere(dataFournisseurs, 'Catégorie', 'riz') + countWhere(dataFournisseurs, 'Spécialité', 'riz');
    const fCable = countWhere(dataFournisseurs, 'Catégorie', 'câble') + countWhere(dataFournisseurs, 'Spécialité', 'câble');
    const fMachines = countWhere(dataFournisseurs, 'Catégorie', 'machine') + countWhere(dataFournisseurs, 'Spécialité', 'machine');
    const fOM = countWhere(dataFournisseurs, 'Catégorie', 'maintenance') + countWhere(dataFournisseurs, 'Spécialité', 'maintenance') + countWhere(dataFournisseurs, 'Catégorie', 'om');

    let relancesRetard = 0;
    const today = new Date(); today.setHours(0,0,0,0);
    const idxRelanceDate = getColIndex(dataRelances.headers, 'Date Prévue');
    const idxRelanceStatut = getColIndex(dataRelances.headers, 'Statut');
    if (idxRelanceDate !== -1) {
      dataRelances.rows.forEach(row => {
        const statut = idxRelanceStatut !== -1 ? (row[idxRelanceStatut] || '').toString().toLowerCase() : '';
        if (statut.includes('fait') || statut.includes('terminé') || statut.includes('clos')) return;
        const d = new Date(row[idxRelanceDate]);
        if (!isNaN(d)) { d.setHours(0,0,0,0); if (d < today) relancesRetard++; }
      });
    }

    const createCard = (title, val, sheetTarget, filterStr = '') => `
      <div class="stat-card" onclick="switchSheet('${sheetTarget}'); if('${filterStr}') { setTimeout(() => { document.getElementById('search-input').value='${filterStr}'; onSearch(); }, 300); }">
        <div class="stat-title">${title}</div>
        <div class="stat-value">${val}</div>
      </div>
    `;

    const createSubCard = (title, sheetTarget, filterStr, subItems = []) => {
      let subHtml = `<div class="stat-sub-grid">`;
      subItems.forEach(item => { subHtml += `<div class="stat-sub-item"><span class="stat-sub-val ${item.alert ? 'alert' : ''}">${item.val}</span><span>${item.label}</span></div>`; });
      subHtml += `</div>`;
      return `
        <div class="stat-card" onclick="switchSheet('${sheetTarget}'); if('${filterStr}') { setTimeout(() => { document.getElementById('search-input').value='${filterStr}'; onSearch(); }, 300); }">
          <div class="stat-title">${title}</div>
          <div class="stat-value">${subItems.reduce((a, b) => a + (parseInt(b.val) || 0), 0)}</div>
          ${subHtml}
        </div>
      `;
    };

    container.innerHTML = `
      ${createCard('Total contacts', totalContacts, 'CONTACTS')}
      ${createCard('Fournisseurs', totalFournisseurs, 'FOURNISSEURS')}
      ${createCard('Entreprises EPC', dataEpc.rows.length, 'EPC')}
      ${createCard('Ingénieurs / Experts', dataIngenieurs.rows.length, 'INGENIEURS')}

      ${createCard('Partenaires Financiers', dataTradeFin.rows.length, 'TRADE_FINANCE')}
      ${createCard('Organismes de Garantie', dataGaranties.rows.length, 'GARANTIES')}
      ${createCard('Projets', totalProjets, 'PROJETS')}
      ${createCard('Relances en retard', relancesRetard, 'RELANCES', 'retard')}

      ${createCard('Contacts à jour', contactsVerifies, 'CONTACTS', 'vérifié')}
      ${createCard('Contacts à vérifier', contactsAfficher, 'CONTACTS', 'à vérifier')}
      ${createCard('Contacts en négociation', contactsEnNegociation, 'CONTACTS', 'négociation')}
      ${createCard('Projets en cours', projetsEnCours, 'PROJETS', 'cours')}

      ${createSubCard('Fournisseurs Soja', 'FOURNISSEURS', 'soja', [{val: fSoja, label:'Référencés'}])}
      ${createSubCard('Fournisseurs Blé', 'FOURNISSEURS', 'blé', [{val: fBle, label:'Référencés'}])}
      ${createSubCard('Fournisseurs Maïs', 'FOURNISSEURS', 'maïs', [{val: fMais, label:'Référencés'}])}
      ${createSubCard('Fournisseurs Riz', 'FOURNISSEURS', 'riz', [{val: fRiz, label:'Référencés'}])}
      ${createSubCard('Fournisseurs Câble', 'FOURNISSEURS', 'câble', [{val: fCable, label:'Référencés'}])}
      ${createSubCard('Opérateurs Maintenance', 'FOURNISSEURS', 'maintenance', [{val: fOM, label:'Référencés'}])}
      ${createSubCard('Fabricants de Machines', 'FOURNISSEURS', 'machine', [{val: fMachines, label:'Référencés'}])}
      ${createCard('Projets en recherche', projetsRecherche, 'PROJETS', 'recherche')}
    `;

    const ctxFournisseurs = document.getElementById('chartFournisseurs');
    if (ctxFournisseurs) {
      if (chartFournisseursInstance) chartFournisseursInstance.destroy();
      chartFournisseursInstance = new Chart(ctxFournisseurs, {
        type: 'doughnut',
        data: {
          labels: ['Soja', 'Blé', 'Maïs', 'Riz', 'Câble', 'Machines', 'Maintenance', 'Autres'],
          datasets: [{
            data: [fSoja, fBle, fMais, fRiz, fCable, fMachines, fOM, Math.max(0, totalFournisseurs - (fSoja+fBle+fMais+fRiz+fCable+fMachines+fOM))],
            backgroundColor: ['#00d2ff', '#2ed573', '#f2c94c', '#ff9f43', '#a29bfe', '#ff4757', '#7f8c8d', '#bdc3c7'],
            borderWidth: 0
          }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#e2e8f0' } } } }
      });
    }

    const ctxProjets = document.getElementById('chartProjets');
    if (ctxProjets) {
      if (chartProjetsInstance) chartProjetsInstance.destroy();
      chartProjetsInstance = new Chart(ctxProjets, {
        type: 'bar',
        data: {
          labels: ['En cours', 'Recherche', 'Autres'],
          datasets: [{
            label: 'Nombre de projets',
            data: [projetsEnCours, projetsRecherche, Math.max(0, totalProjets - projetsEnCours - projetsRecherche)],
            backgroundColor: ['#00d2ff', '#f2c94c', '#7f8c8d'],
            borderRadius: 6
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: { y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.1)' }, ticks: { color: '#94a3b8' } }, x: { ticks: { color: '#94a3b8' }, grid: { display: false } } },
          plugins: { legend: { display: false } }
        }
      });
    }

  } catch (err) { container.innerHTML = `<div class="error"><i class="fa-solid fa-triangle-exclamation"></i> Erreur : ${err.message}</div>`; }
}

window.filterDashboardCards = function() {
  const query = document.getElementById('dashboard-search').value.toLowerCase();
  const cards = document.querySelectorAll('.stat-card');
  cards.forEach(card => {
    const title = card.querySelector('.stat-title').textContent.toLowerCase();
    card.style.display = title.includes(query) ? 'flex' : 'none';
  });
};

window.openChoiceModal = function() {
  document.getElementById('choice-modal').classList.remove('hidden');
};

window.goToAdd = function(sheetKey) {
  document.getElementById('choice-modal').classList.add('hidden');
  switchSheet(sheetKey).then(() => {
    setTimeout(() => openModal(null), 500);
  });
};

async function loadSheet() {
  const sheetName = CONFIG.SHEETS[state.currentSheet];
  document.getElementById('loading').classList.remove('hidden');
  document.getElementById('error-box').classList.add('hidden');

  try {
    if (typeof sheetsAPI.ensureSheet === 'function') {
      await sheetsAPI.ensureSheet(sheetName, SCHEMAS[state.currentSheet] || []);
    }
    
    const values = await sheetsAPI.readSheet(sheetName);
    if (!values || values.length === 0) {
      state.headers = SCHEMAS[state.currentSheet] || [];
      state.data = []; state.indexedData = [];
    } else {
      state.headers = values[0];
      state.data = []; state.indexedData = [];
      values.slice(1).forEach((row, srcIdx) => {
        if (row.some(c => c)) { state.data.push(row); state.indexedData.push({ row, sourceIndex: srcIdx }); }
      });
    }
    state.page = 0; applyFilter();
  } catch (err) {
    document.getElementById('error-box').textContent = 'Erreur de chargement : ' + err.message;
    document.getElementById('error-box').classList.remove('hidden');
  } finally { document.getElementById('loading').classList.add('hidden'); }
}

async function loadRelancesView() {
  const sheetName = CONFIG.SHEETS.RELANCES;
  document.getElementById('loading').classList.remove('hidden');
  try {
    if (typeof sheetsAPI.ensureSheet === 'function') {
      await sheetsAPI.ensureSheet(sheetName, SCHEMAS['RELANCES'] || []);
    }
    const values = await sheetsAPI.readSheet(sheetName);
    state.headers = (values && values[0] && values[0].length) ? values[0] : (SCHEMAS.RELANCES || []);
    state.data = []; state.indexedData = [];
    if (values && values.length > 1) {
      values.slice(1).forEach((row, srcIdx) => {
        if (row.some(c => c)) { state.data.push(row); state.indexedData.push({ row, sourceIndex: srcIdx }); }
      });
    }
    const idxDate = getColIndex(state.headers, 'Date Prévue');
    if (idxDate !== -1) {
      state.indexedData.sort((a, b) => (new Date(a.row[idxDate] || 0).getTime() || 0) - (new Date(b.row[idxDate] || 0).getTime() || 0));
    }
    state.page = 0; applyFilter();
  } catch (err) {
    document.getElementById('error-box').textContent = 'Erreur : ' + err.message;
    document.getElementById('error-box').classList.remove('hidden');
  } finally { document.getElementById('loading').classList.add('hidden'); }
}

function applyFilter() {
  const q = document.getElementById('search-input').value.toLowerCase().trim();
  state.filteredIndexed = !q ? [...state.indexedData] : state.indexedData.filter(item => item.row.some(cell => (cell || '').toString().toLowerCase().includes(q)));
  state.filteredData = state.filteredIndexed.map(item => item.row);
  state.page = 0; render();
}

function render() { renderTable(); renderPagination(); }

function renderTable() {
  const thead = document.getElementById('table-head');
  const tbody = document.getElementById('table-body');
  thead.innerHTML = '';
  const trHead = document.createElement('tr');
  state.headers.forEach(h => { const th = document.createElement('th'); th.textContent = h; trHead.appendChild(th); });
  const thActions = document.createElement('th'); thActions.textContent = 'Actions'; thActions.style.textAlign = 'center'; trHead.appendChild(thActions);
  thead.appendChild(trHead);

  tbody.innerHTML = '';
  const start = state.page * state.pageSize;
  const slice = state.filteredIndexed.slice(start, start + state.pageSize);

  if (slice.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = state.headers.length + 1; td.textContent = 'Aucune donnée trouvée.'; td.style.textAlign = 'center'; td.style.padding = '40px'; td.style.color = '#999';
    tr.appendChild(td); tbody.appendChild(tr); return;
  }

  slice.forEach(({ row, sourceIndex }) => {
    const tr = document.createElement('tr');
    state.headers.forEach((header, colIdx) => {
      const td = document.createElement('td');
      let cellValue = row[colIdx] || '';
      if (header.toLowerCase().includes('statut') || header.toLowerCase().includes('priorité')) {
        const lowerVal = cellValue.toLowerCase();
        if (lowerVal.includes('retard') || lowerVal.includes('haute') || lowerVal.includes('urgent')) td.classList.add('status-retard');
        else if (lowerVal.includes('terminé') || lowerVal.includes('fait') || lowerVal.includes('validé')) td.classList.add('status-valide');
        else if (lowerVal.includes('attente') || lowerVal.includes('moyenne')) td.classList.add('status-attente');
      }
      td.textContent = cellValue; tr.appendChild(td);
    });

    const tdActions = document.createElement('td'); tdActions.className = 'actions-cell';
    tdActions.innerHTML = `<button class="edit-btn" title="Modifier" data-index="${sourceIndex}"><i class="fa-solid fa-pen-to-square"></i></button><button class="delete-btn" title="Supprimer" data-index="${sourceIndex}"><i class="fa-solid fa-trash"></i></button>`;
    tr.appendChild(tdActions); tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.edit-btn').forEach(btn => btn.addEventListener('click', () => openModal(parseInt(btn.dataset.index))));
  tbody.querySelectorAll('.delete-btn').forEach(btn => btn.addEventListener('click', () => onDelete(parseInt(btn.dataset.index))));
}

function renderPagination() {
  const el = document.getElementById('pagination'); el.innerHTML = '';
  const total = Math.ceil(state.filteredIndexed.length / state.pageSize);
  if (total <= 1) return;
  for (let i = 0; i < total; i++) {
    const btn = document.createElement('button'); btn.textContent = i + 1;
    if (i === state.page) btn.classList.add('active');
    btn.addEventListener('click', () => { state.page = i; render(); });
    el.appendChild(btn);
  }
}

function generateAutoId(prefix) {
  const timestamp = Date.now().toString().slice(-4);
  const random = Math.floor(Math.random() * 100).toString().padStart(2, '0');
  return `${prefix}-${timestamp}${random}`;
}

function openModal(sourceIndex) {
  state.editingRow = sourceIndex;
  document.getElementById('modal-title').textContent = sourceIndex === null ? 'Ajouter une entrée' : 'Modifier l\'entrée';
  const fields = document.getElementById('form-fields'); fields.innerHTML = '';

  const idPrefix = state.currentSheet === 'FOURNISSEURS' ? 'F' : state.currentSheet === 'CONTACTS' ? 'C' : state.currentSheet === 'PROJETS' ? 'P' : 'ID';

  state.headers.forEach((header, idx) => {
    const group = document.createElement('div'); group.className = 'form-group';
    const label = document.createElement('label'); label.textContent = header; label.htmlFor = `field-${idx}`;
    
    let input;
    if (header === 'Catégorie' || header === 'Type' || header === 'Type acteur' || header === 'Statut' || header === 'Priorité' || header === 'Type garantie' || header === 'Type organisme') {
      input = document.createElement('select');
      input.innerHTML = `<option value="">-- Choisir --</option>`;
      const options = header === 'Catégorie' 
        ? ['Soja', 'Blé', 'Maïs', 'Riz', 'Câble', 'Machines', 'Maintenance', 'OM', 'Autre']
        : header === 'Type acteur'
        ? ['Fournisseur', 'Partenaire Financier', 'EPC', 'Ingénieur', 'Organisme de Garantie', 'Client']
        : header === 'Statut' || header === 'Priorité'
        ? ['Actif', 'Inactif', 'En attente', 'Urgent', 'Haute', 'Moyenne', 'Basse', 'Terminé']
        : ['Bancaire', 'Assurance', 'SBLC', 'Crédit Documentaire'];
      options.forEach(opt => { input.innerHTML += `<option value="${opt}">${opt}</option>`; });
    } else {
      input = document.createElement('input');
      input.type = 'text';
    }
    
    input.id = `field-${idx}`;
    input.name = `field-${idx}`;

    if (header === 'ID' || header === 'ID Contact' || header === 'ID Projet' || header === 'ID Garantie' || header === 'ID Expert' || header === 'ID Relance') {
      if (sourceIndex === null) {
        input.value = generateAutoId(idPrefix);
      } else {
        const item = state.indexedData.find(it => it.sourceIndex === sourceIndex);
        if (item) input.value = item.row[idx] || '';
      }
    } else if (sourceIndex !== null) {
      const item = state.indexedData.find(it => it.sourceIndex === sourceIndex);
      if (item) input.value = item.row[idx] || '';
    }
    
    group.appendChild(label); group.appendChild(input); fields.appendChild(group);
  });
  document.getElementById('modal').classList.remove('hidden');
}

function closeModal() { 
  document.getElementById('modal').classList.add('hidden'); 
  state.editingRow = null; 
  if (state.currentSheet === 'DASHBOARD') {
    loadDashboard();
  }
}

async function onSave(e) {
  if (e) e.preventDefault();
  
  const values = [];
  for (let idx = 0; idx < state.headers.length; idx++) {
    const input = document.getElementById(`field-${idx}`);
    values.push(input ? input.value : '');
  }
  
  const sheetName = CONFIG.SHEETS[state.currentSheet];
  const actionType = state.editingRow === null ? 'Ajout' : 'Modification';
  
  const saveBtn = document.getElementById('save-btn');
  const originalText = saveBtn.innerHTML;
  saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Enregistrement...';
  saveBtn.disabled = true;

  try {
    if (state.editingRow === null) {
      await sheetsAPI.appendRow(sheetName, values);
    } else {
      const item = state.indexedData.find(it => it.sourceIndex === state.editingRow);
      if (!item) throw new Error('Ligne introuvable');
      item.row = values;
      const allRows = [state.headers, ...state.data];
      await sheetsAPI.writeSheet(sheetName, allRows);
    }
    
    closeModal();
    showToast('✅ Enregistré avec succès', 'success');

    setTimeout(async () => {
      try {
        await logActivity(state.currentSheet, actionType, values[1] || values[0] || 'Ligne sans nom');
        const modulesToSync = ['FOURNISSEURS', 'EPC', 'TRADE_FINANCE', 'GARANTIES'];
        if (modulesToSync.includes(state.currentSheet)) {
          await syncContactToSheet(values[1] || '', values[3] || '', values[4] || values[9] || '', values[5] || values[10] || '', values[2] || '');
        }
        if (state.currentSheet === 'FOURNISSEURS') await refreshFournisseursCache();
        if (state.currentSheet === 'RELANCES') await loadRelancesView();
        else if (state.currentSheet === 'DASHBOARD') await loadDashboard();
        else await loadSheet();
      } catch (err) { console.warn("Erreur en arrière-plan :", err); }
    }, 1500);

  } catch (err) {
    console.error(err);
    alert('Erreur d\'enregistrement :\n' + (err.result?.error?.message || err.message));
  } finally {
    saveBtn.innerHTML = originalText;
    saveBtn.disabled = false;
  }
}

async function onDelete(sourceIndex) {
  if (!confirm('Êtes-vous sûr de vouloir supprimer cette entrée ?')) return;
  const sheetName = CONFIG.SHEETS[state.currentSheet];
  try {
    const item = state.indexedData.find(it => it.sourceIndex === sourceIndex);
    const itemName = item ? (item.row[1] || item.row[0] || 'Inconnu') : 'Inconnu';
    await sheetsAPI.deleteRow(sheetName, sourceIndex + 1);
    showToast('🗑️ Entrée supprimée', 'success');
    await logActivity(state.currentSheet, 'Suppression', itemName);
    if (state.currentSheet === 'FOURNISSEURS') await refreshFournisseursCache();
    if (state.currentSheet === 'RELANCES') await loadRelancesView();
    else await loadSheet();
  } catch (err) { showToast('❌ Erreur : ' + err.message, 'error'); }
}

function onSearch() { applyFilter(); }
function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast'); toast.textContent = msg; toast.className = 'toast ' + type;
  toast.classList.remove('hidden'); setTimeout(() => toast.classList.add('hidden'), 3000);
}

function openReportModal() {
  document.getElementById('report-modal').classList.remove('hidden');
}

async function generatePDF() {
  const btn = document.getElementById('btn-generate-pdf');
  const originalText = btn.innerHTML;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Génération...';
  btn.disabled = true;

  const module = document.getElementById('report-module').value;
  const dateStart = document.getElementById('report-date-start').value;
  const dateEnd = document.getElementById('report-date-end').value;

  try {
    let dataToPrint = [];
    let headersToPrint = [];

    if (module === 'DASHBOARD') {
      const getRows = async (sheetName) => {
        const values = await sheetsAPI.readSheet(sheetName);
        return (values && values.length > 1) ? values.slice(1).filter(r => r.some(c => c)) : [];
      };
      const contacts = await getRows(CONFIG.SHEETS.CONTACTS);
      const fournisseurs = await getRows(CONFIG.SHEETS.FOURNISSEURS);
      const projets = await getRows(CONFIG.SHEETS.PROJETS);
      
      headersToPrint = ['Indicateur', 'Valeur'];
      dataToPrint = [
        ['Total Contacts', contacts.length],
        ['Total Fournisseurs', fournisseurs.length],
        ['Total Projets', projets.length],
        ['Date du rapport', new Date().toLocaleDateString('fr-FR')]
      ];
    } else {
      const values = await sheetsAPI.readSheet(CONFIG.SHEETS[module]);
      if (!values || values.length === 0) throw new Error("Aucune donnée à exporter.");
      
      headersToPrint = values[0];
      let rows = values.slice(1).filter(r => r.some(c => c));
      
      if (dateStart || dateEnd) {
        rows = rows.filter(row => {
          let dateRow = null;
          for (let i = 0; i < row.length; i++) {
            if (row[i] && !isNaN(Date.parse(row[i]))) { dateRow = new Date(row[i]); break; }
          }
          if (!dateRow) return true;
          if (dateStart && dateRow < new Date(dateStart)) return false;
          if (dateEnd && dateRow > new Date(dateEnd + 'T23:59:59')) return false;
          return true;
        });
      }
      dataToPrint = rows;
    }

    const printDiv = document.createElement('div');
    printDiv.style.padding = '20px';
    printDiv.style.fontFamily = 'Arial, sans-serif';
    printDiv.style.color = '#000';
    printDiv.style.background = '#fff';
    
    printDiv.innerHTML = `
      <div style="text-align:center; margin-bottom: 20px;">
        <h1 style="color: #1e3a5f; margin:0;">KP Strategy 360°</h1>
        <p style="color: #666; margin: 5px 0;">Rapport : ${module} - Généré le ${new Date().toLocaleDateString('fr-FR')}</p>
      </div>
      <table style="width:100%; border-collapse: collapse; font-size: 12px;">
        <thead>
          <tr style="background: #f0f4f8; color: #1e3a5f;">
            ${headersToPrint.map(h => `<th style="padding: 8px; border: 1px solid #ddd; text-align: left;">${h}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${dataToPrint.map(row => `<tr>${headersToPrint.map((_, i) => `<td style="padding: 8px; border: 1px solid #ddd;">${row[i] || ''}</td>`).join('')}</tr>`).join('')}
        </tbody>
      </table>
    `;

    const opt = {
      margin: 10,
      filename: `Rapport_KP_${module}_${new Date().toISOString().slice(0,10)}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
    };

    await html2pdf().set(opt).from(printDiv).save();
    document.getElementById('report-modal').classList.add('hidden');
    
  } catch (err) {
    alert('Erreur lors de la génération du PDF : ' + err.message);
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}

function initComparator() {
  const selectorsContainer = document.getElementById('comparator-selects');
  if (!selectorsContainer) return;
  selectorsContainer.innerHTML = '';

  if (state.fournisseursData.length === 0) {
    selectorsContainer.innerHTML = '<p class="error">Aucun fournisseur trouvé. Ajoutez-en dans le module Fournisseurs.</p>';
    document.getElementById('comparator-results').innerHTML = '';
    document.getElementById('comparator-eval-results').innerHTML = '';
    document.getElementById('comparator-reco-results').innerHTML = '';
    return;
  }

  for (let i = 0; i < 5; i++) {
    const wrapper = document.createElement('div'); wrapper.className = 'comparator-selector-item';
    const label = document.createElement('label'); label.textContent = `Fournisseur ${i + 1}`;
    const select = document.createElement('select'); select.id = `compare-select-${i}`;
    select.innerHTML = `<option value="">-- Aucun --</option>`;
    state.fournisseursData.forEach((f, index) => { select.innerHTML += `<option value="${index}">${f.id} — ${f.nom}</option>`; });
    if (comparatorState.selections[i] !== null) select.value = comparatorState.selections[i];
    select.addEventListener('change', (e) => { comparatorState.selections[i] = e.target.value === '' ? null : parseInt(e.target.value); renderComparison(); });
    wrapper.appendChild(label); wrapper.appendChild(select); selectorsContainer.appendChild(wrapper);
  }

  const tauxInput = document.getElementById('cmp-taux');
  if (tauxInput) { tauxInput.value = comparatorState.taux ?? ''; tauxInput.oninput = (e) => { comparatorState.taux = parseFloat(e.target.value) || null; renderComparison(); }; }
  const dateInput = document.getElementById('cmp-date'); if (dateInput && !dateInput.value) dateInput.value = new Date().toISOString().slice(0, 10);
  renderComparison();
}

function renderComparison() {
  const resultsContainer = document.getElementById('comparator-results');
  const evalContainer = document.getElementById('comparator-eval-results');
  const recoContainer = document.getElementById('comparator-reco-results');
  if(!resultsContainer) return;

  const selected = comparatorState.selections
    .map((idx, pos) => idx !== null && state.fournisseursData[idx] ? { pos, idx, data: state.fournisseursData[idx] } : null)
    .filter(Boolean);

  if (selected.length === 0) {
    resultsContainer.innerHTML = '<div class="empty-state"><i class="fa-solid fa-arrow-pointer"></i><p>En attente de sélection...</p></div>';
    evalContainer.innerHTML = '<div class="empty-state"><i class="fa-solid fa-list-check"></i><p>Sélectionnez des fournisseurs.</p></div>';
    recoContainer.innerHTML = '<div class="empty-state"><i class="fa-solid fa-award"></i><p>Aucune recommandation.</p></div>';
    return;
  }

  const getField = (f, name) => {
    if (!f || !f.headers) return '';
    const i = f.headers.findIndex(h => (h || '').toString().toLowerCase().trim() === name.toLowerCase());
    return i >= 0 ? f.raw[i] || '' : '';
  };

  const idRows = [
    { label: 'ID Fournisseur', key: 'id' }, { label: 'Entreprise', key: 'nom' },
    { label: "Nom de l'équipement", key: 'Nom équipement' }, { label: 'Prix indicatif', key: 'Prix indicatif' },
    { label: 'Devise', key: 'Devise' }, { label: 'Capacité de production', key: 'Capacité production' },
    { label: 'Délai de livraison', key: 'Délai livraison' }, { label: 'Garantie', key: 'Garantie' },
    { label: 'Disponibilité pièces détachées', key: 'Pièces détachées' }, { label: 'Installation disponible', key: 'Installation' },
    { label: 'Formation disponible', key: 'Formation' }, { label: 'Service après-vente', key: 'SAV' },
    { label: 'Nb conteneurs estimé', key: 'Nb conteneurs' }, { label: 'Conditions de paiement', key: 'Conditions paiement' },
    { label: 'Incoterm', key: 'Incoterm' }, { label: 'Certification', key: 'Certification' },
    { label: 'SBLC', key: 'SBLC' }, { label: 'Nb camions acheminement', key: 'Nb camions acheminement' }
  ];

  let html = `<table class="comparator-table comparator-ident"><thead><tr><th>Critère</th>`;
  selected.forEach(s => { html += `<th><i class="fa-solid fa-building"></i> ${s.data.nom}</th>`; });
  html += `</tr></thead><tbody>`;
  idRows.forEach(r => {
    html += `<tr><td><strong>${r.label}</strong></td>`;
    selected.forEach(s => {
      let v = (r.key === 'id') ? s.data.id : (r.key === 'nom') ? s.data.nom : getField(s.data, r.key);
      html += `<td>${v || '-'}</td>`;
    });
    html += `</tr>`;
  });
  html += `</tbody></table>`;
  resultsContainer.innerHTML = html;

  const prixNumeriques = selected.map(s => parseFloat((getField(s.data, 'Prix indicatif') || '').toString().replace(/[^\d.]/g, '')) || null);
  const prixValides = prixNumeriques.filter(p => p !== null);
  const prixMin = prixValides.length ? Math.min(...prixValides) : null;
  const prixMax = prixValides.length ? Math.max(...prixValides) : null;

  const notesPrix = prixNumeriques.map(p => {
    if (p === null || prixMin === null || prixMax === null) return null;
    if (prixMax === prixMin) return 10;
    return Math.round(((prixMax - p) / (prixMax - prixMin)) * 100) / 10;
  });

  const criteresEval = [
    { key: 'Prix', pond: comparatorState.ponderation['Prix'], notes: notesPrix, auto: true },
    { key: 'Qualité technique', pond: comparatorState.ponderation['Qualité technique'], notes: comparatorState.notes['Qualité technique'], auto: false },
    { key: 'Délai', pond: comparatorState.ponderation['Délai'], notes: comparatorState.notes['Délai'], auto: false },
    { key: 'Garantie', pond: comparatorState.ponderation['Garantie'], notes: comparatorState.notes['Garantie'], auto: false },
    { key: 'SAV', pond: comparatorState.ponderation['SAV'], notes: comparatorState.notes['SAV'], auto: false },
    { key: 'Pièces détachées', pond: comparatorState.ponderation['Pièces détachées'], notes: comparatorState.notes['Pièces détachées'], auto: false },
    { key: 'Logistique', pond: comparatorState.ponderation['Logistique'], notes: comparatorState.notes['Logistique'], auto: false },
    { key: 'Expérience', pond: comparatorState.ponderation['Expérience'], notes: comparatorState.notes['Expérience'], auto: false },
    { key: 'Conditions de paiement', pond: comparatorState.ponderation['Conditions de paiement'], notes: comparatorState.notes['Conditions de paiement'], auto: false }
  ];

  let evalHtml = `<table class="comparator-table comparator-eval"><thead><tr><th>Critère</th>`;
  selected.forEach(s => { evalHtml += `<th>${s.data.nom}</th>`; });
  evalHtml += `<th>Pondération</th></tr></thead><tbody>`;

  criteresEval.forEach((c, cIdx) => {
    evalHtml += `<tr><td><strong>${c.key}</strong></td>`;
    selected.forEach(s => {
      const pos = s.pos; const note = c.notes[pos];
      if (c.auto) { evalHtml += `<td class="auto-cell">${note !== null && note !== undefined ? note : '-'}</td>`; }
      else { evalHtml += `<td class="manual-cell"><input type="number" min="0" max="10" step="0.5" data-crit="${cIdx}" data-pos="${pos}" value="${note ?? ''}" onchange="updateNote('${c.key.replace(/'/g, "\\'")}', ${pos}, this.value)"></td>`; }
    });
    evalHtml += `<td class="pond-cell"><input type="number" min="0" max="1" step="0.01" value="${c.pond}" data-pond="${c.key}" onchange="updatePond('${c.key.replace(/'/g, "\\'")}', this.value)"></td></tr>`;
  });

  const scores = selected.map(s => {
    let total = 0, totalPond = 0;
    criteresEval.forEach(c => {
      const note = c.notes[s.pos]; const pond = c.pond || 0;
      if (note !== null && note !== undefined && !isNaN(note)) { total += note * pond; totalPond += pond; }
    });
    return totalPond > 0 ? Math.round((total / totalPond) * 10 * 10) / 10 : null;
  });

  const scoresValides = scores.filter(x => x !== null);
  const maxScore = scoresValides.length ? Math.max(...scoresValides) : null;

  evalHtml += `<tr class="score-row"><td><strong>SCORE GLOBAL / 100</strong></td>`;
  selected.forEach((s, i) => { evalHtml += `<td class="${maxScore !== null && scores[i] === maxScore ? 'best-value' : ''}">${scores[i] !== null ? scores[i] : '-'}</td>`; });
  const sumPond = criteresEval.reduce((a, c) => a + (c.pond || 0), 0);
  evalHtml += `<td class="pond-total" style="color:${Math.abs(sumPond - 1) < 0.001 ? 'var(--success)' : 'var(--danger)'}">Σ = ${sumPond.toFixed(2)}</td></tr>`;
  evalHtml += `</tbody></table>`;
  evalContainer.innerHTML = evalHtml;

  if (maxScore !== null) {
    const recoIdx = scores.findIndex(sc => sc === maxScore);
    const rec = selected[recoIdx];
    recoContainer.innerHTML = `
      <div class="reco-grid">
        <div class="reco-item"><label>Fournisseur recommandé</label><strong>${rec.data.nom}</strong></div>
        <div class="reco-item"><label>Score final</label><strong>${maxScore} / 100</strong></div>
        <div class="reco-item full"><label>Justification</label><textarea id="reco-justif" placeholder="Saisir la justification..."></textarea></div>
        <div class="reco-item full"><label>Avantages</label><textarea id="reco-avantages" placeholder="Saisir les avantages..."></textarea></div>
        <div class="reco-item full"><label>Inconvénients</label><textarea id="reco-inconvenients" placeholder="Saisir les inconvénients..."></textarea></div>
        <div class="reco-item full"><label>Risques identifiés</label><textarea id="reco-risques" placeholder="Saisir les risques..."></textarea></div>
      </div>
    `;
  } else {
    recoContainer.innerHTML = '<div class="empty-state"><i class="fa-solid fa-award"></i><p>Complétez les notes pour obtenir une recommandation.</p></div>';
  }
}

window.updateNote = function(critKey, pos, val) {
  const n = parseFloat(val);
  comparatorState.notes[critKey][pos] = isNaN(n) ? null : Math.max(0, Math.min(10, n));
  renderComparison();
};

window.updatePond = function(critKey, val) {
  const n = parseFloat(val);
  comparatorState.ponderation[critKey] = isNaN(n) ? 0 : Math.max(0, Math.min(1, n));
  renderComparison();
};
