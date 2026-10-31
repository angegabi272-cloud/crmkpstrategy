const state = {
  currentSheet: 'DASHBOARD',
  data: [], headers: [], filteredData: [], indexedData: [], filteredIndexed: [],
  page: 0, pageSize: 25, editingRow: null, fournisseursData: [],
  currentUserEmail: "chargement...", isAdmin: false, contactFilter: null, silent: false, verifyIndex: null
};

const ADMIN_EMAIL = "kpstrategy09@gmail.com";

// Résultats possibles d'une vérification de contact (tout résultat sort le contact de « à vérifier »)
const VERIF_CHOICES = ['À jour', 'À jour (coordonnées modifiées)', 'En négociation', 'Injoignable', 'Coordonnées invalides'];
// Champs longs : affichés en zone de texte dans les formulaires
const LONG_FIELDS = ['Description', 'Risques & Observations', 'Historique Échanges', 'Historique échanges', 'Résumé', 'Commentaires', 'Références Hôtellerie', 'Références projets', 'Spécialités techniques', 'Conditions éligibilité', 'Conditions', 'Procédure demande'];
function isPendingStatus(v) {
  const s = (v || '').toString().toLowerCase().trim();
  return s === '' || /(^|\s)[àa]\s*v[ée]rifier/.test(s);
}
const $id = id => document.getElementById(id);
const esc = s => (s == null ? '' : String(s)).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
function setFieldValue(input, val) {
  if (input.tagName === 'SELECT' && val && ![...input.options].some(o => o.value === val)) {
    const o = document.createElement('option'); o.value = val; o.textContent = val; input.appendChild(o);
  }
  input.value = val;
} 

const comparatorState = {
  selections: [null, null, null, null, null],
  notes: { 'Qualité technique': [null, null, null, null, null], 'Délai': [null, null, null, null, null], 'Garantie': [null, null, null, null, null], 'SAV': [null, null, null, null, null], 'Pièces détachées': [null, null, null, null, null], 'Logistique': [null, null, null, null, null], 'Expérience': [null, null, null, null, null], 'Conditions de paiement': [null, null, null, null, null] },
  ponderation: { 'Prix': 0.25, 'Qualité technique': 0.20, 'Délai': 0.15, 'Garantie': 0.10, 'SAV': 0.10, 'Pièces détachées': 0.05, 'Logistique': 0.05, 'Expérience': 0.05, 'Conditions de paiement': 0.05 },
  taux: null
};

let pingInterval = null;
let refreshTimer = null;
let chartFournisseursInstance = null;
let chartProjetsInstance = null;

document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  sheetsAPI.onSessionExpired = () => { if (confirm('Votre session Google a expiré. Se reconnecter maintenant ?')) location.reload(); };
  sheetsAPI.preload().catch(e => console.warn('Préchargement Google :', e.message));
  window.addEventListener('offline', () => $id('offline-banner').classList.remove('hidden'));
  window.addEventListener('online', () => { $id('offline-banner').classList.add('hidden'); if (state.currentUserEmail.includes('@')) autoRefresh(); });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(() => {});
});

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
  sheetsAPI.cache = {};
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
    if (!sheetsAPI.isReady()) await sheetsAPI.preload();
    await sheetsAPI.signIn();
    await sheetsAPI.ensureAllSheets(SCHEMAS, SCHEMA_ADDITIONS);
    try {
      const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer ' + sheetsAPI.token } });
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
    pingInterval = setInterval(() => { if (document.visibilityState === 'visible') updatePresence(); }, CONFIG.PRESENCE_MS || 60000);
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(autoRefresh, CONFIG.REFRESH_MS || 60000);
    
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
    await sheetsAPI.appendRow(CONFIG.SHEETS.LOGS, row, { background: true });
  } catch (e) {}
}

async function updatePresence() {
  if (!state.currentUserEmail || state.currentUserEmail.includes('inconnu')) return;
  try { await sheetsAPI.ping(state.currentUserEmail); } catch (e) { console.warn('Présence :', e.message); }
}

async function syncContactToSheet(entreprise, contactName, email, phone, country) {
  if (!entreprise || entreprise.trim() === '') return;
  try {
    const contacts = await sheetsAPI.readSheet(CONFIG.SHEETS.CONTACTS, { fresh: true });
    const today = new Date().toISOString().split('T')[0];
    const found = (contacts || []).find((r, i) => i > 0 && (r[2] || '').toString().toLowerCase().trim() === entreprise.toLowerCase().trim());
    if (found) await sheetsAPI.patchRow(CONFIG.SHEETS.CONTACTS, found, { 'Date dernière vérif': today });
    else await sheetsAPI.appendRow(CONFIG.SHEETS.CONTACTS, [`C-${Date.now()}`, 'Auto-Généré', entreprise, contactName || '', '', '', country || '', '', '', email || '', phone || '', '', 'Synchronisation auto', today, 'À vérifier', 'Normale', '', '']);
  } catch (e) { console.warn('Sync contact :', e.message); }
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
  state.contactFilter = null; updateFilterChip();
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
  if (!state.silent || !container.children.length) container.innerHTML = '<div class="loading"><i class="fa-solid fa-spinner fa-spin"></i> Analyse des données...</div>';
  
  try {
    const S = CONFIG.SHEETS;
    const toData = v => (!v || v.length < 1) ? { headers: [], rows: [] } : { headers: v[0], rows: v.slice(1).filter(r => r.some(c => c)) };
    const [dataContacts, dataFournisseurs, dataEpc, dataIngenieurs, dataTradeFin, dataGaranties, dataRelances, dataProjets] =
      (await sheetsAPI.batchRead([S.CONTACTS, S.FOURNISSEURS, S.EPC, S.INGENIEURS, S.TRADE_FINANCE, S.GARANTIES, S.RELANCES, S.PROJETS])).map(toData);

    const countWhere = (data, colName, keyword) => {
      const idx = getColIndex(data.headers, colName);
      if (idx === -1) return 0;
      return data.rows.filter(r => (r[idx] || '').toString().toLowerCase().includes(keyword.toLowerCase())).length;
    };

    const idxStatutV = getColIndex(dataContacts.headers, 'Statut vérification');
    const contactsAll = dataContacts.rows.length;
    const contactsVerifies = dataContacts.rows.filter(r => !isPendingStatus(r[idxStatutV])).length;
    const contactsAfficher = contactsAll - contactsVerifies;
    const totalContacts = contactsAfficher; // diminue à chaque contact vérifié
    
    
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

    const createContactCard = (title, val, mode, caption) => `
      <div class="stat-card" onclick="openContactsFilter('${mode}')">
        <div class="stat-title">${title}</div>
        <div class="stat-value">${val}</div>
        ${caption ? `<div class="stat-caption">${caption}</div>` : ''}
      </div>`;

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
      ${createContactCard('Total contacts', totalContacts, 'pending', 'sur ' + contactsAll + ' au total')}
      ${createCard('Fournisseurs', totalFournisseurs, 'FOURNISSEURS')}
      ${createCard('Entreprises EPC', dataEpc.rows.length, 'EPC')}
      ${createCard('Ingénieurs / Experts', dataIngenieurs.rows.length, 'INGENIEURS')}

      ${createCard('Partenaires Financiers', dataTradeFin.rows.length, 'TRADE_FINANCE')}
      ${createCard('Organismes de Garantie', dataGaranties.rows.length, 'GARANTIES')}
      ${createCard('Projets', totalProjets, 'PROJETS')}
      ${createCard('Relances en retard', relancesRetard, 'RELANCES', 'retard')}

      ${createContactCard('Contacts à jour', contactsVerifies, 'verified', '')}
      ${createContactCard('Contacts à vérifier', contactsAfficher, 'pending', '')}
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
  if (!state.silent) document.getElementById('loading').classList.remove('hidden');
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
    const kp = state.silent ? state.page : 0; applyFilter(); state.page = Math.min(kp, Math.max(0, Math.ceil(state.filteredIndexed.length / state.pageSize) - 1)); render();
  } catch (err) {
    document.getElementById('error-box').textContent = 'Erreur de chargement : ' + err.message;
    document.getElementById('error-box').classList.remove('hidden');
  } finally { document.getElementById('loading').classList.add('hidden'); }
}

async function loadRelancesView() {
  const sheetName = CONFIG.SHEETS.RELANCES;
  if (!state.silent) document.getElementById('loading').classList.remove('hidden');
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
    const kp = state.silent ? state.page : 0; applyFilter(); state.page = Math.min(kp, Math.max(0, Math.ceil(state.filteredIndexed.length / state.pageSize) - 1)); render();
  } catch (err) {
    document.getElementById('error-box').textContent = 'Erreur : ' + err.message;
    document.getElementById('error-box').classList.remove('hidden');
  } finally { document.getElementById('loading').classList.add('hidden'); }
}

function applyFilter() {
  const q = document.getElementById('search-input').value.toLowerCase().trim();
  let base = state.indexedData;
  if (state.currentSheet === 'CONTACTS' && state.contactFilter) {
    const iS = getColIndex(state.headers, 'Statut vérification');
    base = base.filter(it => isPendingStatus(it.row[iS]) === (state.contactFilter === 'pending'));
  }
  state.filteredIndexed = !q ? [...base] : base.filter(item => item.row.some(cell => (cell || '').toString().toLowerCase().includes(q)));
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
        if (lowerVal.includes('retard') || lowerVal.includes('haute') || lowerVal.includes('urgent') || lowerVal.includes('injoignable') || lowerVal.includes('invalide')) td.classList.add('status-retard');
        else if (lowerVal.includes('terminé') || lowerVal.includes('fait') || lowerVal.includes('validé') || lowerVal.includes('à jour') || lowerVal.includes('vérifié')) td.classList.add('status-valide');
        else if (lowerVal.includes('attente') || lowerVal.includes('moyenne') || lowerVal.includes('à vérifier') || lowerVal.includes('négociation')) td.classList.add('status-attente');
      }
      td.textContent = cellValue; tr.appendChild(td);
    });

    const tdActions = document.createElement('td'); tdActions.className = 'actions-cell';
    tdActions.innerHTML = (state.currentSheet === 'CONTACTS' ? `<button class="verify-btn" title="Vérifier ce contact" data-index="${sourceIndex}"><i class="fa-solid fa-circle-check"></i></button>` : '') + `<button class="edit-btn" title="Modifier" data-index="${sourceIndex}"><i class="fa-solid fa-pen-to-square"></i></button><button class="delete-btn" title="Supprimer" data-index="${sourceIndex}"><i class="fa-solid fa-trash"></i></button>`;
    tr.appendChild(tdActions); tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.edit-btn').forEach(btn => btn.addEventListener('click', () => openModal(parseInt(btn.dataset.index))));
  tbody.querySelectorAll('.verify-btn').forEach(btn => btn.addEventListener('click', () => openVerifyModal(parseInt(btn.dataset.index))));
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
    if (header === 'Statut vérification' || header === 'Catégorie' || header === 'Type' || header === 'Type acteur' || header === 'Statut' || header === 'Priorité' || header === 'Type garantie' || header === 'Type organisme') {
      input = document.createElement('select');
      input.innerHTML = `<option value="">-- Choisir --</option>`;
      const options = header === 'Catégorie' 
        ? ['Soja', 'Blé', 'Maïs', 'Riz', 'Câble', 'Machines', 'Maintenance', 'OM', 'Autre']
        : header === 'Statut vérification'
        ? ['À vérifier', ...VERIF_CHOICES]
        : header === 'Type acteur'
        ? ['Fournisseur', 'Partenaire Financier', 'EPC', 'Ingénieur', 'Organisme de Garantie', 'Client']
        : header === 'Statut' && state.currentSheet === 'PROJETS'
        ? ['En recherche de financement', 'En cours', 'En exécution', 'En attente', 'Terminé', 'Suspendu']
        : header === 'Statut' || header === 'Priorité'
        ? ['Actif', 'Inactif', 'En attente', 'Urgent', 'Haute', 'Moyenne', 'Basse', 'Terminé']
        : ['Bancaire', 'Assurance', 'SBLC', 'LC', 'Crédit Documentaire'];
      options.forEach(opt => { input.innerHTML += `<option value="${opt}">${opt}</option>`; });
    } else {
      if (LONG_FIELDS.includes(header)) { input = document.createElement('textarea'); input.rows = 3; }
      else if (/^Note /.test(header)) { input = document.createElement('input'); input.type = 'number'; input.min = 0; input.max = 10; input.step = 0.5; input.placeholder = 'Note sur 10'; }
      else { input = document.createElement('input'); input.type = 'text'; }
    }
    
    input.id = `field-${idx}`;
    input.name = `field-${idx}`;

    if (header === 'ID' || header === 'ID Contact' || header === 'ID Projet' || header === 'ID Garantie' || header === 'ID Expert' || header === 'ID Relance') {
      if (sourceIndex === null) {
        input.value = generateAutoId(idPrefix);
      } else {
        const item = state.indexedData.find(it => it.sourceIndex === sourceIndex);
        if (item) setFieldValue(input, item.row[idx] || '');
      }
    } else if (sourceIndex === null && header === 'Statut vérification') {
      input.value = 'À vérifier';
    } else if (sourceIndex !== null) {
      const item = state.indexedData.find(it => it.sourceIndex === sourceIndex);
      if (item) setFieldValue(input, item.row[idx] || '');
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
  state.headers.forEach((h, i) => {
    if (/^Note /.test(h)) { const n = parseFloat(String(values[i]).replace(',', '.')); values[i] = isNaN(n) ? '' : Math.max(0, Math.min(10, n)); }
  });
  const actionType = state.editingRow === null ? 'Ajout' : 'Modification';
  const prevItem = state.editingRow === null ? null : state.indexedData.find(it => it.sourceIndex === state.editingRow);
  if (state.currentSheet === 'CONTACTS') {
    const iS = getColIndex(state.headers, 'Statut vérification'), iD = getColIndex(state.headers, 'Date dernière vérif');
    const wasPending = !prevItem || isPendingStatus(prevItem.row[iS]);
    if (iS >= 0 && iD >= 0 && wasPending && !isPendingStatus(values[iS])) values[iD] = new Date().toISOString().slice(0, 10);
  }
  
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
      try {
        await sheetsAPI.updateRow(sheetName, item.row, values);
      } catch (e) {
        if (e.code !== 'ROW_CONFLICT') throw e;
        if (!confirm('Cette ligne vient d’être modifiée par un autre utilisateur.\nÉcraser ses modifications avec les vôtres ?')) { const c = new Error('annulé'); c.code = 'CANCEL'; throw c; }
        await sheetsAPI.updateRow(sheetName, item.row, values, { force: true });
      }
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
    if (err.code === 'CANCEL') return;
    console.error(err);
    if (err.code === 'ROW_NOT_FOUND' || err.code === 'ROW_CONFLICT') { closeModal(); reloadCurrent(); }
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
    if (!item) throw new Error('Ligne introuvable');
    await sheetsAPI.deleteRowByMatch(sheetName, item.row);
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

function reloadCurrent() {
  if (state.currentSheet === 'DASHBOARD') return loadDashboard();
  if (state.currentSheet === 'RELANCES') return loadRelancesView();
  if (state.currentSheet === 'COMPARATEUR') return refreshFournisseursCache().then(initComparator);
  return loadSheet();
}

async function autoRefresh() {
  if (document.visibilityState !== 'visible' || !navigator.onLine) return;
  if (state.currentSheet === 'COMPARATEUR') return;
  if (!$id('modal').classList.contains('hidden') || !$id('verify-modal').classList.contains('hidden')) return;
  state.silent = true;
  try { await reloadCurrent(); } catch (e) { console.warn('Actualisation :', e.message); } finally { state.silent = false; }
}

/* ---------- Filtres contacts (cartes du tableau de bord) ---------- */
function updateFilterChip() {
  const chip = $id('filter-chip'); if (!chip) return;
  chip.classList.toggle('hidden', !state.contactFilter);
  const s = chip.querySelector('span');
  if (s) s.textContent = state.contactFilter === 'verified' ? 'Contacts à jour' : 'Contacts à vérifier';
}
window.openContactsFilter = async function (mode) { await switchSheet('CONTACTS'); state.contactFilter = mode; updateFilterChip(); applyFilter(); };
window.clearContactFilter = function () { state.contactFilter = null; updateFilterChip(); applyFilter(); };

/* ---------- Vérification d'un contact ---------- */
function openVerifyModal(sourceIndex) {
  const item = state.indexedData.find(it => it.sourceIndex === sourceIndex);
  if (!item) return;
  state.verifyIndex = sourceIndex;
  $id('verify-name').textContent = item.row[2] || item.row[3] || item.row[0] || 'Contact';
  $id('verify-choice').innerHTML = '<option value="">-- Choisir un résultat --</option>' + VERIF_CHOICES.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  $id('verify-note').value = '';
  $id('verify-modal').classList.remove('hidden');
}
function closeVerifyModal() { $id('verify-modal').classList.add('hidden'); state.verifyIndex = null; }

async function confirmVerify() {
  const item = state.indexedData.find(it => it.sourceIndex === state.verifyIndex);
  if (!item) return closeVerifyModal();
  const choice = $id('verify-choice').value;
  if (!choice) { showToast('Choisissez un résultat de vérification', 'error'); return; }
  const note = $id('verify-note').value.trim();
  const today = new Date().toISOString().slice(0, 10);
  const name = item.row[2] || item.row[3] || item.row[0] || '';
  const btn = $id('verify-confirm-btn'); btn.disabled = true;
  try {
    const changes = { 'Statut vérification': choice, 'Date dernière vérif': today };
    if (note) changes['Historique échanges'] = cur => (cur ? cur + ' | ' : '') + `${today} (${state.currentUserEmail}) : ${note}`;
    await sheetsAPI.patchRow(CONFIG.SHEETS.CONTACTS, item.row, changes);
    closeVerifyModal();
    showToast('✅ Contact vérifié : il passe dans « Contacts à jour »', 'success');
    logActivity('CONTACTS', 'Vérification', `${name} → ${choice}`);
    await loadSheet();
  } catch (e) {
    showToast('❌ ' + e.message, 'error');
    if (e.code === 'ROW_NOT_FOUND') { closeVerifyModal(); loadSheet(); }
  } finally { btn.disabled = false; }
}

/* ---------- Rapport PDF détaillé et expliqué (texte noir, tableaux turquoise / gris / blanc, logo) ---------- */
function openReportModal() { $id('report-modal').classList.remove('hidden'); }

const RPT = { TURQ: '#38bdc2', GREY: '#e9edf0', LINE: '#9aa7b0' };

const REPORT_INFO = {
  DASHBOARD: 'Ce rapport donne une vue d’ensemble de l’activité : combien de contacts, fournisseurs, projets et relances sont enregistrés, et où il faut agir en priorité.',
  CONTACTS: 'Ce rapport présente le carnet de contacts. Un contact est « à jour » dès qu’il a été vérifié (téléphone, e-mail, poste) ; sinon il reste « à vérifier ».',
  FOURNISSEURS: 'Ce rapport liste les fournisseurs référencés (produits, machines, maintenance) avec leurs conditions : prix indicatif, délais, garanties et service après-vente.',
  PROJETS: 'Ce rapport suit les projets : qui les porte, quelle entreprise est concernée, de quoi il s’agit, combien ils coûtent et où en est la recherche de financement.',
  EPC: 'Ce rapport présente les entreprises EPC / ingénierie (conception, fourniture, construction) avec leur type, leurs zones d’intervention et leurs références.',
  TRADE_FINANCE: 'Ce rapport présente les organismes de financement du commerce (banques, assureurs) et leurs produits : crédit documentaire, SBLC, financement import / export.',
  RELANCES: 'Ce rapport suit les relances à effectuer : auprès de qui, pour quel objet, à quelle date et avec quel niveau de priorité.',
  INGENIEURS: 'Ce rapport liste les ingénieurs et experts mobilisables, avec leur spécialité, leur disponibilité et leurs certifications.',
  GARANTIES: 'Ce rapport présente les organismes de garantie et les types de garanties disponibles (garantie bancaire, SBLC, assurance).',
  INTERACTIONS: 'Ce rapport retrace les échanges avec les contacts : date, canal, résumé, résultat et action suivante.'
};

const rptNum = v => { const n = parseFloat(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.').replace(/[^\d.\-]/g, '')); return isNaN(n) ? null : n; };
const rptFmt = n => Math.round(n).toLocaleString('fr-FR');
const rptBlank = v => String(v == null ? '' : v).trim() === '';

function rptSection(title, inner) {
  return `<div style="margin:18px 0 8px;font-size:17px;font-weight:700;color:#000;border-left:6px solid ${RPT.TURQ};padding:2px 0 2px 8px;">${esc(title)}</div>${inner}`;
}

// Le texte reçu est du HTML déjà sûr (les valeurs dynamiques sont échappées par l'appelant)
function rptNote(html) {
  return `<div style="background:${RPT.GREY};border:1px solid ${RPT.LINE};padding:8px 10px;margin:6px 0;font-size:12px;line-height:1.5;color:#000;">${html}</div>`;
}

function rptTable(headers, rows, fs = 11, widths = null) {
  const cg = widths ? `<colgroup>${widths.map(w => `<col style="width:${w};">`).join('')}</colgroup>` : '';
  const th = headers.map(h => `<th style="background:${RPT.TURQ};color:#000;padding:7px 6px;font-size:${Math.max(fs, 10) + 1}px;border:1px solid ${RPT.LINE};text-align:left;font-weight:700;">${esc(h)}</th>`).join('');
  const body = rows.map((row, r) => `<tr style="background:${r % 2 ? RPT.GREY : '#ffffff'};">${headers.map((_, i) => {
    const c = row[i];
    const txt = c && c.html !== undefined ? c.html : (c == null ? '' : esc(c));
    return `<td style="padding:6px;border:1px solid ${RPT.LINE};color:#000;word-break:break-word;vertical-align:top;">${txt}</td>`;
  }).join('')}</tr>`).join('');
  const fixed = widths || headers.length > 12;
  return `<table style="width:100%;border-collapse:collapse;font-size:${fs}px;color:#000;${fixed ? 'table-layout:fixed;' : ''}">${cg}<thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>`;
}

// Tableau très large : découpé en plusieurs parties pour que les titres restent lisibles
function rptWideTable(headers, rows) {
  if (headers.length <= 9) return rptTable(headers, rows, 11);
  const keys = [0, 1].filter(i => i < headers.length);
  const rest = headers.map((_, i) => i).filter(i => !keys.includes(i));
  const size = 6, parts = Math.ceil(rest.length / size);
  let out = rptNote('Ce module compte beaucoup de colonnes : le tableau est présenté en plusieurs parties pour rester lisible. Les deux premières colonnes sont répétées dans chaque partie.');
  for (let p = 0; p < parts; p++) {
    const cols = keys.concat(rest.slice(p * size, (p + 1) * size));
    out += `<div style="margin:12px 0 4px;font-weight:700;font-size:13px;color:#000;">Partie ${p + 1} sur ${parts}</div>` +
      rptTable(cols.map(i => headers[i]), rows.map(r => cols.map(i => r[i])), 11);
  }
  return out;
}

function rptBreakdown(title, items, total) {
  const rows = items.map(([k, n]) => {
    const p = total ? Math.round(n * 100 / total) : 0;
    return [k, n, p + ' %', { html: `<div style="background:${RPT.TURQ};height:10px;width:${Math.max(p, 2)}%;"></div>` }];
  });
  return rptTable([title, 'Nombre', 'Part', 'Barre'], rows, 11, ['38%', '12%', '12%', '38%']);
}

function rptFiches(headers, rows) {
  const titleCols = ['Nom Projet', 'Nom EPC', 'Nom organisme', 'Entreprise', 'Nom', 'Objet'];
  return rows.map((row, n) => {
    let ti = -1;
    for (const t of titleCols) { const i = getColIndex(headers, t); if (i >= 0 && !rptBlank(row[i])) { ti = i; break; } }
    const title = ti >= 0 ? row[ti] : (row[1] || row[0] || 'Fiche');
    const lines = headers.map((h, i) => ({ h, v: row[i] })).filter(x => !rptBlank(x.v)).map(x =>
      `<tr><td style="width:28%;background:${RPT.GREY};border:1px solid ${RPT.LINE};padding:5px 6px;font-weight:700;color:#000;vertical-align:top;">${esc(x.h)}</td><td style="background:#ffffff;border:1px solid ${RPT.LINE};padding:5px 6px;color:#000;word-break:break-word;white-space:pre-wrap;">${esc(x.v)}</td></tr>`).join('');
    return `<div class="fiche" style="margin:0 0 12px;"><table style="width:100%;border-collapse:collapse;font-size:12px;color:#000;"><tr><td colspan="2" style="background:${RPT.TURQ};border:1px solid ${RPT.LINE};padding:6px 8px;font-weight:700;font-size:15px;color:#000;">${n + 1}. ${esc(title)}</td></tr>${lines}</table></div>`;
  }).join('');
}

// Calcule chiffres clés, répartitions et commentaires automatiques
function rptAnalyse(module, headers, rows) {
  const total = rows.length;
  const idx = n => getColIndex(headers, n);
  const filled = rows.reduce((a, r) => a + headers.filter((_, i) => !rptBlank(r[i])).length, 0);
  const completion = total && headers.length ? Math.round(filled * 100 / (total * headers.length)) : 0;
  const kpis = [
    ['Nombre d’enregistrements', total, 'Nombre de lignes comprises dans ce rapport (après filtre par dates, s’il y en a un).'],
    ['Taux de complétion', completion + ' %', 'Part des cases renseignées. Plus il est proche de 100 %, plus les fiches sont complètes et exploitables.']
  ];
  const notes = [];

  if (module === 'CONTACTS') {
    const iS = idx('Statut vérification');
    const aJour = rows.filter(r => !isPendingStatus(r[iS])).length, pending = total - aJour;
    kpis.push(['Contacts à jour', aJour, 'Contacts déjà vérifiés, quel que soit le résultat de la vérification.']);
    kpis.push(['Contacts à vérifier', pending, 'Contacts qu’il reste à appeler ou contrôler. Ce chiffre baisse à chaque vérification.']);
    if (pending > 0) notes.push(`<b>${pending}</b> contact(s) restent à vérifier, soit ${Math.round(pending * 100 / total)} % du carnet : à traiter en priorité avant toute campagne de relance.`);
    else if (total) notes.push('Tous les contacts ont été vérifiés : le carnet est à jour.');
  }

  if (module === 'PROJETS') {
    const sum = n => { const i = idx(n); return i < 0 ? null : rows.reduce((a, r) => a + (rptNum(r[i]) || 0), 0); };
    const cout = sum('Coût Total (FCFA)'), besoin = sum('Besoin Financement'), obtenu = sum('Financement Obtenu'), apport = sum('Apport Promoteur');
    if (cout !== null) kpis.push(['Coût total des projets (FCFA)', rptFmt(cout), 'Somme des coûts estimés de tous les projets du rapport.']);
    if (apport !== null) kpis.push(['Apport des porteurs (FCFA)', rptFmt(apport), 'Part financée par les porteurs de projets eux-mêmes.']);
    if (besoin !== null) kpis.push(['Besoin de financement (FCFA)', rptFmt(besoin), 'Montant à trouver auprès de financeurs, hors apport des porteurs.']);
    if (obtenu !== null) kpis.push(['Financement obtenu (FCFA)', rptFmt(obtenu), 'Montants déjà accordés ou sécurisés.']);
    if (besoin && obtenu !== null) {
      kpis.push(['Taux de couverture du besoin', Math.round(obtenu * 100 / besoin) + ' %', 'Financement obtenu ÷ besoin de financement. À 100 %, les projets sont entièrement financés.']);
      notes.push(`Il reste environ <b>${rptFmt(Math.max(0, besoin - obtenu))} FCFA</b> à mobiliser pour couvrir le besoin de financement.`);
    }
  }

  if (module === 'RELANCES') {
    const iD = idx('Date Prévue'), iS = idx('Statut');
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const retard = rows.filter(r => {
      if (/fait|terminé|clos/.test(String(r[iS] == null ? '' : r[iS]).toLowerCase())) return false;
      const d = new Date(r[iD]); return !isNaN(d) && d < today;
    }).length;
    kpis.push(['Relances en retard', retard, 'Relances dont la date prévue est dépassée et qui ne sont pas terminées.']);
    if (retard) notes.push(`<b>${retard}</b> relance(s) sont en retard : à effectuer en premier.`);
  }

  if (total && completion < 60) {
    const worst = headers.map((h, i) => ({ h, n: rows.filter(r => rptBlank(r[i])).length })).filter(x => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 3)
      .map(x => `« ${esc(x.h)} » (${x.n} vide(s))`).join(', ');
    notes.push(`Les fiches sont encore peu complètes (${completion} %). Colonnes les moins renseignées : ${worst}.`);
  }

  const breakdowns = [];
  ['Statut vérification', 'Statut', 'Priorité', 'Catégorie', 'Type', 'Type acteur', 'Pays', 'Secteur', 'Type organisme', 'Responsable'].forEach(k => {
    if (breakdowns.length >= 4) return;
    const i = idx(k); if (i < 0) return;
    const m = {};
    rows.forEach(r => { const v = rptBlank(r[i]) ? '(non renseigné)' : String(r[i]).trim(); m[v] = (m[v] || 0) + 1; });
    const arr = Object.entries(m).sort((a, b) => b[1] - a[1]);
    if (arr.length === 1 && arr[0][0] === '(non renseigné)') return;
    breakdowns.push({ col: headers[i], items: arr.slice(0, 8), more: Math.max(0, arr.length - 8) });
  });
  return { kpis, notes, breakdowns, completion };
}

function buildModuleReport(module, headers, rows, useFiches, dateStart, dateEnd) {
  const A = rptAnalyse(module, headers, rows);
  const fmtD = d => new Date(d).toLocaleDateString('fr-FR');
  const periode = (dateStart || dateEnd)
    ? `Période : ${dateStart ? 'du ' + fmtD(dateStart) : ''} ${dateEnd ? 'au ' + fmtD(dateEnd) : ''}.`
    : 'Période : toutes les dates.';
  let n = 3;
  let html = rptSection('1. Objet du rapport', rptNote(`${esc(REPORT_INFO[module] || '')} ${periode}`));
  html += rptSection('2. Chiffres clés', rptTable(['Indicateur', 'Valeur', 'Explication'], A.kpis, 11, ['30%', '14%', '56%']));
  if (A.breakdowns.length) {
    html += rptSection(`${n++}. Répartition des données`,
      rptNote('Ces tableaux montrent combien d’enregistrements se trouvent dans chaque catégorie. La barre turquoise représente la part de chaque catégorie.') +
      A.breakdowns.map(b => `<div style="margin:10px 0 4px;font-weight:700;font-size:12px;color:#000;">Par ${esc(b.col)}</div>${rptBreakdown(b.col, b.items, rows.length)}${b.more ? `<div style="font-size:10px;color:#000;margin-top:2px;">... et ${b.more} autre(s) valeur(s) non affichée(s).</div>` : ''}`).join(''));
  }
  if (A.notes.length) html += rptSection(`${n++}. Analyse et points d’attention`, A.notes.map(t => rptNote(t)).join(''));
  html += rptSection(`${n++}. Détail des enregistrements`,
    rptNote(useFiches ? 'Chaque enregistrement est présenté sous forme de fiche : seules les informations renseignées sont affichées.'
      : 'Chaque ligne du tableau correspond à un enregistrement ; une case vide signifie que l’information n’est pas renseignée.') +
    (useFiches ? rptFiches(headers, rows) : rptWideTable(headers, rows)));
  html += rptSection(`${n++}. Comment lire ce rapport`,
    rptNote('Les titres et les en-têtes de tableaux sont en turquoise ; les lignes alternent gris et blanc pour faciliter la lecture. Les données viennent du classeur Google Sheets de KP Strategy au moment de la génération du rapport : elles peuvent changer si un collègue les modifie ensuite.'));
  return html;
}

async function buildDashboardReport() {
  const S = CONFIG.SHEETS;
  const raw = await sheetsAPI.batchRead([S.CONTACTS, S.FOURNISSEURS, S.EPC, S.INGENIEURS, S.TRADE_FINANCE, S.GARANTIES, S.RELANCES, S.PROJETS], { fresh: true });
  const [c, f, epc, ing, tf, g, rel, pr] = raw.map(v => (!v || v.length < 1) ? { headers: [], rows: [] } : { headers: v[0], rows: v.slice(1).filter(r => r.some(x => x)) });
  const aC = rptAnalyse('CONTACTS', c.headers, c.rows);
  const aP = rptAnalyse('PROJETS', pr.headers, pr.rows);
  const aR = rptAnalyse('RELANCES', rel.headers, rel.rows);
  const aF = rptAnalyse('FOURNISSEURS', f.headers, f.rows);
  const kv = (A, label) => { const k = A.kpis.find(x => x[0] === label); return k ? k[1] : 0; };
  const aJour = kv(aC, 'Contacts à jour'), pending = kv(aC, 'Contacts à vérifier'), retard = kv(aR, 'Relances en retard');

  const kpis = [
    ['Total contacts (restant à vérifier)', pending, 'Contacts pas encore vérifiés. Ce chiffre diminue à chaque vérification.'],
    ['Contacts à jour', aJour, 'Contacts vérifiés : leurs coordonnées sont confirmées.'],
    ['Contacts au total', c.rows.length, 'Carnet complet = contacts à vérifier + contacts à jour.'],
    ['Fournisseurs', f.rows.length, 'Fournisseurs référencés, toutes catégories confondues.'],
    ['Entreprises EPC / ingénierie', epc.rows.length, 'Entreprises capables de concevoir et réaliser des projets clés en main.'],
    ['Ingénieurs / experts', ing.rows.length, 'Experts techniques mobilisables.'],
    ['Partenaires financiers', tf.rows.length, 'Banques et organismes de financement du commerce.'],
    ['Organismes de garantie', g.rows.length, 'Organismes proposant garanties bancaires, SBLC ou assurances.'],
    ['Projets', pr.rows.length, 'Projets suivis par le cabinet.'],
    ['Relances en retard', retard, 'Relances dont la date est dépassée et non terminées : à traiter en priorité.']
  ];

  const notes = [];
  if (pending) notes.push(`<b>${pending}</b> contact(s) restent à vérifier sur ${c.rows.length} (${Math.round(pending * 100 / c.rows.length)} %).`);
  if (retard) notes.push(`<b>${retard}</b> relance(s) sont en retard.`);
  aP.notes.forEach(t => notes.push(t));
  if (!notes.length) notes.push('Aucun point d’attention particulier : les contacts sont vérifiés et aucune relance n’est en retard.');

  const bd = (A, col, total) => { const b = A.breakdowns.find(x => x.col === col); return b ? rptBreakdown(col, b.items, total) : rptNote('Aucune donnée disponible pour cette répartition.'); };

  let html = rptSection('1. Objet du rapport', rptNote(esc(REPORT_INFO.DASHBOARD)));
  html += rptSection('2. Chiffres clés', rptTable(['Indicateur', 'Valeur', 'Explication'], kpis, 11, ['30%', '14%', '56%']));
  html += rptSection('3. Contacts : état des vérifications', rptNote('Un contact vérifié passe de « à vérifier » à « à jour ». Le tableau ci-dessous détaille les résultats de vérification.') + bd(aC, 'Statut vérification', c.rows.length));
  html += rptSection('4. Projets et financement', rptNote('Ce tableau compare le coût des projets, l’apport des porteurs et les financements obtenus.') + rptTable(['Indicateur', 'Valeur', 'Explication'], aP.kpis, 11, ['30%', '14%', '56%']) + bd(aP, 'Statut', pr.rows.length));
  html += rptSection('5. Fournisseurs par catégorie', bd(aF, 'Catégorie', f.rows.length));
  html += rptSection('6. Analyse et points d’attention', notes.map(t => rptNote(t)).join(''));
  html += rptSection('7. Comment lire ce rapport', rptNote('Les titres et en-têtes de tableaux sont en turquoise ; les lignes alternent gris et blanc. Les chiffres viennent du classeur Google Sheets de KP Strategy au moment de la génération du rapport.'));
  return html;
}

async function loadLogoDataUrl() {
  try {
    const blob = await (await fetch('logo.png')).blob();
    return await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(''); r.readAsDataURL(blob); });
  } catch (e) { return ''; }
}

async function generatePDF() {
  const btn = $id('btn-generate-pdf');
  const originalText = btn.innerHTML;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Génération...';
  btn.disabled = true;

  const module = $id('report-module').value;
  const dateStart = $id('report-date-start').value;
  const dateEnd = $id('report-date-end').value;
  const layout = $id('report-layout').value;
  let holder = null;

  try {
    const logo = await loadLogoDataUrl();
    let label, bodyHtml, count = null;

    if (module === 'DASHBOARD') {
      label = 'Tableau de bord';
      bodyHtml = await buildDashboardReport();
    } else {
      const values = await sheetsAPI.readSheet(CONFIG.SHEETS[module], { fresh: true });
      if (!values || values.length === 0) throw new Error('Aucune donnée à exporter.');
      const headers = values[0];
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
      if (!rows.length) throw new Error('Aucune ligne ne correspond à la période choisie.');
      const useFiches = layout === 'fiches' || (layout === 'auto' && rows.length <= 40);
      if (useFiches && rows.length > 120 && !confirm(`${rows.length} fiches vont être générées : le PDF sera très long et la création peut être lente. Continuer ?`)) return;
      const navBtn = document.querySelector(`.nav-btn[data-sheet="${module}"]`);
      label = navBtn ? navBtn.textContent.trim() : module;
      count = rows.length;
      bodyHtml = buildModuleReport(module, headers, rows, useFiches, dateStart, dateEnd);
    }

    const now = new Date();
    const printDiv = document.createElement('div');
    printDiv.style.cssText = 'width:1050px;padding:16px;font-family:Arial,sans-serif;color:#000;background:#fff;';
    printDiv.innerHTML = `
      <table style="width:100%;border-collapse:collapse;border-bottom:3px solid ${RPT.TURQ};margin-bottom:10px;"><tr>
        <td style="width:240px;padding:0 0 10px 0;border:none;">${logo ? `<img src="${logo}" style="height:64px;" alt="KP Strategy">` : ''}</td>
        <td style="padding:0 0 10px 0;border:none;text-align:right;color:#000;">
          <div style="font-size:24px;font-weight:700;color:#000;">Rapport : ${esc(label)}</div>
          <div style="font-size:11px;color:#000;margin-top:4px;">Généré le ${now.toLocaleDateString('fr-FR')} à ${now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} par ${esc(state.currentUserEmail)}${count !== null ? ' - ' + count + ' enregistrement(s)' : ''}</div>
        </td>
      </tr></table>
      ${bodyHtml}
      <div style="margin-top:16px;padding-top:8px;border-top:1px solid ${RPT.LINE};font-size:10px;color:#000;text-align:center;">KP Strategy SARL - Votre accompagnement 360° - Douala, Cameroun</div>`;

    // Mesure hors écran pour adapter la netteté si le rapport est très long (limite des navigateurs)
    holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-100000px;top:0;';
    holder.appendChild(printDiv);
    document.body.appendChild(holder);
    const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const hpx = printDiv.offsetHeight || 1;
    let scale = 2;
    scale = Math.max(0.5, Math.min(2, 15000 / hpx, mobile ? Math.sqrt(14e6 / (1050 * hpx)) : 99));
    if (scale < 1.3) showToast('Rapport très long : netteté réduite. Filtrez par dates ou réduisez le nombre de lignes pour des titres plus nets.', 'success');

    const opt = {
      margin: [10, 8, 12, 8],
      filename: `Rapport_KP_${module}_${now.toISOString().slice(0, 10)}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale, useCORS: true, backgroundColor: '#ffffff' },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
      pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', '.fiche'] }
    };

    await html2pdf().set(opt).from(printDiv).toPdf().get('pdf').then(pdf => {
      const total = pdf.internal.getNumberOfPages(), w = pdf.internal.pageSize.getWidth(), h = pdf.internal.pageSize.getHeight();
      for (let i = 1; i <= total; i++) {
        pdf.setPage(i); pdf.setFontSize(8); pdf.setTextColor(0, 0, 0);
        pdf.text(`Page ${i} / ${total}`, w - 8, h - 5, { align: 'right' });
      }
    }).save();
    $id('report-modal').classList.add('hidden');

  } catch (err) {
    alert('Erreur lors de la génération du PDF : ' + err.message);
  } finally {
    if (holder && holder.parentNode) holder.parentNode.removeChild(holder);
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
    state.fournisseursData.forEach((f, index) => { select.innerHTML += `<option value="${index}">${esc(f.id)} — ${esc(f.nom)}</option>`; });
    if (comparatorState.selections[i] !== null) select.value = comparatorState.selections[i];
    select.addEventListener('change', (e) => { comparatorState.selections[i] = e.target.value === '' ? null : parseInt(e.target.value);
      Object.keys(comparatorState.notes).forEach(k => { comparatorState.notes[k][i] = null; }); renderComparison(); });
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
  selected.forEach(s => { html += `<th><i class="fa-solid fa-building"></i> ${esc(s.data.nom)}</th>`; });
  html += `</tr></thead><tbody>`;
  idRows.forEach(r => {
    html += `<tr><td><strong>${r.label}</strong></td>`;
    selected.forEach(s => {
      let v = (r.key === 'id') ? s.data.id : (r.key === 'nom') ? s.data.nom : getField(s.data, r.key);
      html += `<td>${esc(v) || '-'}</td>`;
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

  const parseNote = v => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isNaN(n) ? null : Math.max(0, Math.min(10, n)); };
  criteresEval.forEach(c => {
    if (c.auto) return;
    c.notes = [0, 1, 2, 3, 4].map(pos => {
      const manual = comparatorState.notes[c.key][pos];
      if (manual !== null && manual !== undefined) return manual;
      const sel = state.fournisseursData[comparatorState.selections[pos]];
      return sel ? parseNote(getField(sel, 'Note ' + c.key)) : null;
    });
  });

  let evalHtml = `<div class="eval-hint">Les notes sont reprises automatiquement de la fiche de chaque fournisseur (colonnes « Note ... »). Vous pouvez les ajuster ici pour une comparaison ponctuelle.</div><table class="comparator-table comparator-eval"><thead><tr><th>Critère</th>`;
  selected.forEach(s => { evalHtml += `<th>${esc(s.data.nom)}</th>`; });
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
        <div class="reco-item"><label>Fournisseur recommandé</label><strong>${esc(rec.data.nom)}</strong></div>
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