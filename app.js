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
const OUI_NON = ['Oui', 'Non', 'Sur demande'];
const SUPPLIER_SELECTS = {
  'Devise': ['FCFA', 'EUR', 'USD', 'CNY', 'GBP', 'INR', 'AED'],
  'Incoterm': ['EXW', 'FCA', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'],
  'Pièces détachées': OUI_NON, 'Installation': OUI_NON, 'Formation': OUI_NON, 'SAV': OUI_NON, 'SBLC': OUI_NON, 'LC': OUI_NON
};
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
  notes: { 'Prix': [null, null, null, null, null], 'Capacité de production': [null, null, null, null, null], 'Qualité technique': [null, null, null, null, null], 'Délai': [null, null, null, null, null], 'Garantie': [null, null, null, null, null], 'SAV': [null, null, null, null, null], 'Pièces détachées': [null, null, null, null, null], 'Logistique': [null, null, null, null, null], 'Expérience': [null, null, null, null, null], 'Conditions de paiement': [null, null, null, null, null] },
  ponderation: { 'Prix': 0.20, 'Qualité technique': 0.20, 'Délai': 0.15, 'Garantie': 0.10, 'SAV': 0.10, 'Pièces détachées': 0.05, 'Logistique': 0.05, 'Expérience': 0.05, 'Conditions de paiement': 0.05, 'Capacité de production': 0.05 },
  taux: null,
  recoFor: null, recoEdited: {}, recoText: {}, last: null
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

async function morphLoginToApp() {
  const ls = $id('login-screen'), appEl = $id('app');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  appEl.classList.remove('hidden');
  if (!reduce) { appEl.classList.add('morph-in'); ls.classList.add('morph-out'); await new Promise(r => setTimeout(r, 750)); }
  ls.classList.add('hidden'); ls.classList.remove('morph-out');
  if (window.loginScene) window.loginScene.stop();
  setTimeout(() => appEl.classList.remove('morph-in'), 900);
}

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

    await morphLoginToApp();

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

    container.classList.toggle('animate-cards', !state.silent);
    container.querySelectorAll('.stat-card').forEach((c, i) => c.style.setProperty('--i', Math.min(i, 20)));

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

    // ---- Statistiques & analyses : fournisseurs, projets, EPC, trade finance, ingénieurs ----
    dashAnalysis('analysis-fournisseurs', 'FOURNISSEURS', dataFournisseurs);
    dashAnalysis('analysis-projets', 'PROJETS', dataProjets);

    const dEpc = dashDistribution(dataEpc, ['Type', 'Zone', 'Pays']);
    dashChart('chartEpc', 'doughnut', dEpc ? dEpc.labels : [], dEpc ? dEpc.values : [], 'EPC');
    dashAnalysis('analysis-epc', 'EPC', dataEpc);

    const tfCols = ['Financement import', 'Financement export', 'Crédit documentaire', 'SBLC'];
    const tfNames = ['financement import', 'financement export', 'crédit documentaire (LC)', 'SBLC'];
    const isYes = v => { const s = String(v == null ? '' : v).trim().toLowerCase(); return s !== '' && !/^(non|no|n|0|-)$/.test(s); };
    const tfValues = tfCols.map(col => { const i = getColIndex(dataTradeFin.headers, col); return i < 0 ? 0 : dataTradeFin.rows.filter(r => isYes(r[i])).length; });
    dashChart('chartTradeFin', 'bar', ['Import', 'Export', 'Crédit doc. (LC)', 'SBLC'], tfValues, 'Organismes');
    const tfMax = Math.max(...tfValues);
    dashAnalysis('analysis-tradefin', 'TRADE_FINANCE', dataTradeFin, tfMax > 0 ? [`Produit le plus proposé : <b>${tfNames[tfValues.indexOf(tfMax)]}</b> (${tfMax} organisme(s) sur ${dataTradeFin.rows.length}).`] : []);

    const dIng = dashDistribution(dataIngenieurs, ['Spécialité', 'Domaine', 'Pays']);
    dashChart('chartIngenieurs', 'doughnut', dIng ? dIng.labels : [], dIng ? dIng.values : [], 'Ingénieurs');
    const iDispo = getColIndex(dataIngenieurs.headers, 'Disponibilité');
    const nDispo = iDispo < 0 ? 0 : dataIngenieurs.rows.filter(r => { const s = String(r[iDispo] || ''); return /disponible|oui/i.test(s) && !/indispon|non/i.test(s); }).length;
    dashAnalysis('analysis-ingenieurs', 'INGENIEURS', dataIngenieurs, iDispo >= 0 && dataIngenieurs.rows.length ? [`<b>${nDispo}</b> expert(s) marqué(s) disponible(s) sur ${dataIngenieurs.rows.length}.`] : []);

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

const SUPPLIER_GROUPS = [
  ['Identification du fournisseur', ['ID', 'Entreprise', 'Pays', 'Contact', 'Email', 'Téléphone', 'Site Web', 'Spécialité', 'Catégorie', 'Statut', 'Commentaires', 'Source info', 'Date dernière vérif', 'Statut vérif']],
  ['Équipement et prix', ['Nom équipement', 'Prix indicatif', 'Devise', 'Capacité production']],
  ['Livraison et logistique', ['Délai livraison', 'Nb conteneurs', 'Nb camions acheminement', 'Incoterm']],
  ['Garanties et services', ['Garantie', 'Pièces détachées', 'Installation', 'Formation', 'SAV', 'Certification']],
  ['Conditions de paiement', ['Conditions paiement', 'SBLC', 'LC']],
  ['Notes d’évaluation (sur 10)', ['*Note ']]
];
function supplierFieldOrder(headers) {
  const norm = s => String(s || '').toLowerCase().trim();
  const place = h => {
    const n = norm(h);
    for (let gi = 0; gi < SUPPLIER_GROUPS.length; gi++) {
      const list = SUPPLIER_GROUPS[gi][1];
      const pi = list.findIndex(x => x.startsWith('*') ? n.startsWith(norm(x.slice(1))) : norm(x) === n);
      if (pi >= 0) return [gi, list[pi].startsWith('*') ? 0 : pi];
    }
    return [SUPPLIER_GROUPS.length, 0];
  };
  const out = headers.map((h, i) => { const [gi, pi] = place(h); return { h, i, gi, pi }; });
  out.sort((a, b) => a.gi - b.gi || a.pi - b.pi || a.i - b.i);
  return out.map(o => ({ h: o.h, i: o.i, g: o.gi < SUPPLIER_GROUPS.length ? SUPPLIER_GROUPS[o.gi][0] : 'Autres informations' }));
}

function openModal(sourceIndex) {
  state.editingRow = sourceIndex;
  document.getElementById('modal-title').textContent = sourceIndex === null ? 'Ajouter une entrée' : 'Modifier l\'entrée';
  const fields = document.getElementById('form-fields'); fields.innerHTML = '';

  const idPrefix = state.currentSheet === 'FOURNISSEURS' ? 'F' : state.currentSheet === 'CONTACTS' ? 'C' : state.currentSheet === 'PROJETS' ? 'P' : 'ID';

  const order = state.currentSheet === 'FOURNISSEURS' ? supplierFieldOrder(state.headers) : state.headers.map((h, i) => ({ h, i, g: null }));
  let lastGroup = null;
  order.forEach(({ h: header, i: idx, g: grp }) => {
    if (grp && grp !== lastGroup) { const t = document.createElement('div'); t.className = 'form-section-title'; t.textContent = grp; fields.appendChild(t); lastGroup = grp; }
    const group = document.createElement('div'); group.className = 'form-group';
    const label = document.createElement('label'); label.textContent = header; label.htmlFor = `field-${idx}`;
    
    let input;
    if ((state.currentSheet === 'FOURNISSEURS' && SUPPLIER_SELECTS[header]) || header === 'Statut vérification' || header === 'Catégorie' || header === 'Type' || header === 'Type acteur' || header === 'Statut' || header === 'Priorité' || header === 'Type garantie' || header === 'Type organisme') {
      input = document.createElement('select');
      input.innerHTML = `<option value="">-- Choisir --</option>`;
      const options = (state.currentSheet === 'FOURNISSEURS' && SUPPLIER_SELECTS[header]) ? SUPPLIER_SELECTS[header]
        : header === 'Catégorie' 
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
  ['Statut vérification', 'Statut', 'Priorité', 'Catégorie', 'Type', 'Type acteur', 'Spécialité', 'Domaine', 'Type Trade Finance', 'Zone', 'Pays', 'Secteur', 'Type organisme', 'Responsable'].forEach(k => {
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
  const aE = rptAnalyse('EPC', epc.headers, epc.rows), aT = rptAnalyse('TRADE_FINANCE', tf.headers, tf.rows), aI = rptAnalyse('INGENIEURS', ing.headers, ing.rows);
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
  const bdAll = (A, total) => A.breakdowns.length
    ? A.breakdowns.slice(0, 2).map(b => `<div style="margin:10px 0 4px;font-weight:700;font-size:13px;color:#000;">Par ${esc(b.col)}</div>${rptBreakdown(b.col, b.items, total)}`).join('')
    : rptNote('Aucune donnée disponible pour cette répartition.');
  html += rptSection('6. EPC / Ingénierie', rptNote(`${epc.rows.length} entreprise(s) EPC / ingénierie référencée(s) ; fiches complétées à ${aE.completion} %.`) + bdAll(aE, epc.rows.length));
  html += rptSection('7. Trade Finance', rptNote(`${tf.rows.length} partenaire(s) financier(s) référencé(s) ; fiches complétées à ${aT.completion} %.`) + bdAll(aT, tf.rows.length));
  html += rptSection('8. Ingénieurs et experts', rptNote(`${ing.rows.length} ingénieur(s) / expert(s) référencé(s) ; fiches complétées à ${aI.completion} %.`) + bdAll(aI, ing.rows.length));
  html += rptSection('9. Analyse et points d’attention', notes.map(t => rptNote(t)).join(''));
  html += rptSection('10. Comment lire ce rapport', rptNote('Les titres et en-têtes de tableaux sont en turquoise ; les lignes alternent gris et blanc. Les chiffres viennent du classeur Google Sheets de KP Strategy au moment de la génération du rapport.'));
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

    await renderReportPdf({ label, bodyHtml, count, filename: `Rapport_KP_${module}_${new Date().toISOString().slice(0, 10)}.pdf`, logo });
    $id('report-modal').classList.add('hidden');

  } catch (err) {
    alert('Erreur lors de la génération du PDF : ' + err.message);
  } finally {
    if (holder && holder.parentNode) holder.parentNode.removeChild(holder);
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}

/* ---------- Recommandation du cabinet : texte écrit automatiquement selon les résultats ---------- */
const cmpFmtNum = n => Math.round(n).toLocaleString('fr-FR');

function buildRecommendation({ selected, crit, scores, recoIdx, getField, sumPond, memeDevise, prix }) {
  const rec = selected[recoIdx], nom = rec.data.nom;
  const fmt = n => (Math.round(n * 10) / 10).toString().replace('.', ',');
  const yes = v => /^(oui|yes|disponible|inclus|vrai)/i.test(String(v || '').trim());
  const no = v => /^(non|no$|indisponible|aucun)/i.test(String(v || '').trim());
  const f = name => String(getField(rec.data, name) || '').trim();
  const avantages = [], inconvenients = [], risques = [], just = [];
  const rivals = selected.map((s, i) => ({ s, i, sc: scores[i] })).filter(x => x.i !== recoIdx);
  const rivalsScored = rivals.filter(x => x.sc !== null).sort((a, b) => b.sc - a.sc);
  const myScore = scores[recoIdx];
  const hasNote = n => n !== null && n !== undefined;

  // Justification
  if (rivalsScored.length) just.push(`• ${nom} obtient le meilleur score global : ${fmt(myScore)}/100, contre ${fmt(rivalsScored[0].sc)}/100 pour ${rivalsScored[0].s.data.nom} (écart de ${fmt(myScore - rivalsScored[0].sc)} point(s)).`);
  else just.push(`• ${nom} est le seul fournisseur évalué (${fmt(myScore)}/100) : la recommandation repose uniquement sur sa propre évaluation.`);

  const gains = crit.map(c => {
    const mine = c.notes[rec.pos];
    const others = rivals.map(r => c.notes[r.s.pos]).filter(hasNote);
    if (!hasNote(mine) || !others.length) return null;
    const avg = others.reduce((a, b) => a + b, 0) / others.length;
    return { c, mine, avg, gain: (mine - avg) * (c.pond || 0) };
  }).filter(Boolean).filter(g => g.gain > 0).sort((a, b) => b.gain - a.gain).slice(0, 3);
  if (gains.length) just.push(`• Il se distingue surtout sur : ${gains.map(g => `${g.c.key} (${fmt(g.mine)}/10 contre ${fmt(g.avg)}/10 en moyenne chez les autres)`).join(' ; ')}.`);

  // Prix (comparés seulement si toutes les offres sont dans la même devise)
  const devise = f('Devise');
  const myPrix = prix[recoIdx];
  const rivalPrix = rivals.map(r => ({ nom: r.s.data.nom, p: prix[r.i] })).filter(x => x.p !== null && x.p !== undefined);
  if (memeDevise && myPrix && rivalPrix.length) {
    const minRival = rivalPrix.reduce((a, b) => (b.p < a.p ? b : a));
    const avgRival = rivalPrix.reduce((a, b) => a + b.p, 0) / rivalPrix.length;
    if (myPrix <= minRival.p) {
      avantages.push(`Prix indicatif le plus bas des offres comparées : ${cmpFmtNum(myPrix)} ${devise}${avgRival > myPrix ? ` (${Math.round((avgRival - myPrix) * 100 / avgRival)} % de moins que la moyenne des autres offres)` : ''}.`);
      just.push(`• Son prix indicatif (${cmpFmtNum(myPrix)} ${devise}) est le plus bas des offres comparées.`);
    } else {
      inconvenients.push(`Prix indicatif supérieur de ${Math.round((myPrix - minRival.p) * 100 / minRival.p)} % à l’offre la moins chère (${minRival.nom}).`);
    }
  }

  // Notes par critère
  crit.forEach(c => {
    if (c.key === 'Prix' && memeDevise) return;
    const mine = c.notes[rec.pos];
    if (!hasNote(mine)) return;
    const others = rivals.map(r => ({ nom: r.s.data.nom, n: c.notes[r.s.pos] })).filter(x => hasNote(x.n));
    const best = others.length ? others.reduce((a, b) => (b.n > a.n ? b : a)) : null;
    if (mine >= 7) avantages.push(`${c.key} : ${fmt(mine)}/10${best && mine > best.n ? ' (meilleure note du comparatif)' : ''}.`);
    if (mine <= 5 || (best && best.n - mine >= 2)) inconvenients.push(`${c.key} : ${fmt(mine)}/10${best && best.n > mine ? `, inférieur à ${best.nom} (${fmt(best.n)}/10)` : ''}.`);
    if (mine <= 4 && ['Garantie', 'SAV', 'Pièces détachées', 'Délai', 'Logistique'].includes(c.key)) risques.push(`${c.key} faible (${fmt(mine)}/10) : risque de retard, de panne mal couverte ou de difficulté après la livraison.`);
  });

  // Données de la fiche fournisseur
  [['Installation', 'l’installation'], ['Formation', 'la formation'], ['SAV', 'le service après-vente'], ['Pièces détachées', 'les pièces détachées']].forEach(([k, noun]) => {
    const v = f(k);
    if (yes(v)) avantages.push(`Propose ${noun}.`);
    else if (no(v)) inconvenients.push(`Ne propose pas ${noun}.`);
    else if (/demande/i.test(v)) risques.push(`${noun.charAt(0).toUpperCase() + noun.slice(1)} uniquement sur demande : conditions à préciser.`);
  });
  const g = f('Garantie');
  if (g && !no(g)) avantages.push(`Garantie : ${g}.`);
  else if (no(g)) inconvenients.push('Aucune garantie annoncée.');
  else risques.push('Durée et conditions de garantie non renseignées : à confirmer avant la commande.');
  if (f('Certification')) avantages.push(`Certification : ${f('Certification')}.`);
  else risques.push('Certification non renseignée : conformité des équipements à vérifier.');
  if (f('Délai livraison')) avantages.push(`Délai de livraison annoncé : ${f('Délai livraison')}.`);
  if (yes(f('SBLC')) || yes(f('LC'))) avantages.push('Garantie de paiement possible (SBLC / LC).');
  else risques.push('Garantie de paiement (SBLC / LC) non confirmée : prévoir un mode de sécurisation du paiement.');
  if (f('Incoterm')) avantages.push(`Incoterm précisé : ${f('Incoterm')}.`);
  else risques.push('Incoterm non précisé : responsabilités de transport, d’assurance et de dédouanement à clarifier.');

  // Risques liés à la qualité de la comparaison
  const nonEval = crit.filter(c => !hasNote(c.notes[rec.pos])).map(c => c.key);
  if (nonEval.length) risques.push(`Critère(s) non évalué(s) pour ce fournisseur : ${nonEval.join(', ')}. Le score est calculé sur les seuls critères notés.`);
  if (rivalsScored.length && myScore - rivalsScored[0].sc < 5) risques.push(`Écart faible avec ${rivalsScored[0].s.data.nom} (${fmt(myScore - rivalsScored[0].sc)} point(s)) : le classement pourrait s’inverser avec d’autres pondérations ; une négociation est conseillée.`);
  if (Math.abs(sumPond - 1) > 0.001) risques.push(`Les pondérations ne totalisent pas 1 (total ${fmt(sumPond)}) : interpréter le score avec prudence.`);
  if (!memeDevise) risques.push('Les offres sont dans des devises différentes : les prix ne sont pas directement comparables sans taux de conversion.');
  if (rivals.some(r => r.sc === null)) risques.push('Certains fournisseurs concurrents n’ont aucune note : la comparaison est incomplète.');

  const list = (arr, empty) => (arr.length ? arr.map(t => '• ' + t).join('\n') : empty);
  return {
    justif: just.join('\n'),
    avantages: list(avantages, '• Aucun avantage marqué ne ressort : complétez les fiches fournisseurs et les notes.'),
    inconvenients: list(inconvenients, '• Aucun inconvénient notable d’après les notes saisies.'),
    risques: list(risques, '• Aucun risque majeur identifié d’après les données renseignées.')
  };
}

window.markRecoEdited = function (k, el) { comparatorState.recoEdited[k] = true; comparatorState.recoText[k] = el.value; };
window.resetReco = function () { comparatorState.recoEdited = {}; comparatorState.recoText = {}; renderComparison(); };

/* ---------- Export PDF commun (en-tête avec logo, pied de page, numéros de page) ---------- */
async function renderReportPdf({ label, bodyHtml, count = null, filename, logo = '', subtitle = '' }) {
  const now = new Date();
  const printDiv = document.createElement('div');
  printDiv.style.cssText = 'width:1050px;padding:16px;font-family:Arial,sans-serif;color:#000;background:#fff;';
  printDiv.innerHTML = `
      <table style="width:100%;border-collapse:collapse;border-bottom:3px solid ${RPT.TURQ};margin-bottom:10px;"><tr>
        <td style="width:240px;padding:0 0 10px 0;border:none;">${logo ? `<img src="${logo}" style="height:64px;" alt="KP Strategy">` : ''}</td>
        <td style="padding:0 0 10px 0;border:none;text-align:right;color:#000;">
          <div style="font-size:24px;font-weight:700;color:#000;">Rapport : ${esc(label)}</div>
          <div style="font-size:11px;color:#000;margin-top:4px;">Généré le ${now.toLocaleDateString('fr-FR')} à ${now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} par ${esc(state.currentUserEmail)}${count !== null ? ' - ' + count + ' enregistrement(s)' : ''}${subtitle ? ' - ' + esc(subtitle) : ''}</div>
        </td>
      </tr></table>
      ${bodyHtml}
      <div style="margin-top:16px;padding-top:8px;border-top:1px solid ${RPT.LINE};font-size:10px;color:#000;text-align:center;">KP Strategy SARL - Votre accompagnement 360° - Douala, Cameroun</div>`;

  // Mesure hors écran pour adapter la netteté si le rapport est très long (limite des navigateurs)
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-100000px;top:0;';
  holder.appendChild(printDiv);
  document.body.appendChild(holder);
  try {
    const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const hpx = printDiv.offsetHeight || 1;
    const scale = Math.max(0.5, Math.min(2, 15000 / hpx, mobile ? Math.sqrt(14e6 / (1050 * hpx)) : 99));
    if (scale < 1.3) showToast('Rapport très long : netteté réduite. Filtrez par dates ou réduisez le nombre de lignes pour des titres plus nets.', 'success');
    const opt = {
      margin: [10, 8, 12, 8],
      filename,
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
  } finally {
    if (holder.parentNode) holder.parentNode.removeChild(holder);
  }
}

/* ---------- Rapport du comparateur ---------- */
async function generateComparatorReport() {
  const L = comparatorState.last;
  if (!L || !L.selected || !L.selected.length) { showToast('Sélectionnez au moins un fournisseur à comparer', 'error'); return; }
  const btns = document.querySelectorAll('#comparator-view .btn-primary');
  btns.forEach(b => { b.disabled = true; });
  try {
    const logo = await loadLogoDataUrl();
    const names = L.selected.map(s => s.data.nom);
    const nl2br = t => esc(t).replace(/\n/g, '<br>');
    const fmt = n => (Math.round(n * 10) / 10).toString().replace('.', ',');
    const projet = $id('cmp-projet').value.trim() || 'Non précisé';
    const d = $id('cmp-date').value ? new Date($id('cmp-date').value) : new Date();
    const resp = $id('cmp-responsable').value.trim() || state.currentUserEmail;
    const w1 = Math.round(74 / names.length) + '%';

    let html = rptSection('1. Objet du rapport', rptNote(`Ce rapport compare <b>${names.length}</b> offre(s) de fournisseurs pour le projet : <b>${esc(projet)}</b>. Date de comparaison : ${esc(d.toLocaleDateString('fr-FR'))}. Responsable : ${esc(resp)}. Fournisseurs comparés : ${names.map(esc).join(', ')}.`));

    html += rptSection('2. Identification et données techniques',
      rptNote('Ce tableau reprend, pour chaque fournisseur, les informations saisies dans sa fiche : équipement, prix, délais, garanties, services associés et conditions commerciales. Un tiret signifie que l’information n’est pas renseignée.') +
      rptTable(['Critère', ...names], L.tableData.map(t => [t.label, ...t.values.map(v => (v === '' || v == null) ? '-' : v)]), 11, ['26%', ...names.map(() => w1)]));

    const evalRows = L.criteresEval.map(c => [c.key, ...L.selected.map(s => { const n = c.notes[s.pos]; return n === null || n === undefined ? '-' : fmt(n) + ' / 10'; }), fmt(c.pond || 0)]);
    evalRows.push(['SCORE GLOBAL / 100', ...L.scores.map(sc => sc === null ? '-' : fmt(sc)), 'Total ' + fmt(L.sumPond)]);
    html += rptSection('3. Évaluation pondérée',
      rptNote('Chaque critère est noté sur 10. La pondération indique l’importance du critère (le total doit faire 1). Le score global sur 100 est la moyenne pondérée des notes multipliée par 10. La note « Prix » est calculée automatiquement : l’offre la moins chère reçoit 10, la plus chère 0 (uniquement si toutes les offres sont dans la même devise).') +
      rptTable(['Critère', ...names, 'Pondération'], evalRows, 11, ['24%', ...names.map(() => Math.round(62 / names.length) + '%'), '14%']));

    const ranking = L.selected.map((s, i) => ({ nom: s.data.nom, sc: L.scores[i] })).sort((a, b) => (b.sc === null ? -1 : b.sc) - (a.sc === null ? -1 : a.sc));
    html += rptSection('4. Classement',
      rptTable(['Rang', 'Fournisseur', 'Score / 100', 'Barre'], ranking.map((r, i) => [i + 1, r.nom, r.sc === null ? '-' : fmt(r.sc), { html: `<div style="background:${RPT.TURQ};height:10px;width:${Math.max(r.sc || 0, 2)}%;"></div>` }]), 11, ['10%', '40%', '14%', '36%']));

    if (L.rec && L.autoReco) {
      const eff = k => comparatorState.recoEdited[k] ? comparatorState.recoText[k] : L.autoReco[k];
      html += rptSection('5. Recommandation du cabinet',
        rptNote(`Fournisseur recommandé : <b>${esc(L.rec.data.nom)}</b> - score final : <b>${fmt(L.maxScore)} / 100</b>.`) +
        [['Justification', 'justif'], ['Avantages', 'avantages'], ['Inconvénients', 'inconvenients'], ['Risques identifiés', 'risques']].map(([t, k]) =>
          `<div style="margin:10px 0 4px;font-weight:700;font-size:13px;color:#000;">${t}</div>${rptNote(nl2br(eff(k)))}`).join(''));
    } else {
      html += rptSection('5. Recommandation du cabinet', rptNote('Aucune recommandation : les notes sont incomplètes. Renseignez les notes dans les fiches fournisseurs ou dans le tableau d’évaluation.'));
    }
    html += rptSection('6. Comment lire ce rapport', rptNote('Les titres et en-têtes de tableaux sont en turquoise ; les lignes alternent gris et blanc. Les textes de la recommandation sont générés automatiquement à partir des notes, des prix et des informations des fiches, puis peuvent être corrigés par le consultant avant l’export. Le rapport reflète les données au moment de sa génération.'));

    await renderReportPdf({ label: 'Comparaison des fournisseurs', bodyHtml: html, filename: `Comparaison_Fournisseurs_${new Date().toISOString().slice(0, 10)}.pdf`, logo, subtitle: 'Projet : ' + projet });
  } catch (err) {
    alert('Erreur lors de la génération du rapport : ' + err.message);
  } finally {
    btns.forEach(b => { b.disabled = false; });
  }
}

/* ---------- Dashboard : statistiques & analyses (graphique + commentaire) ---------- */
const DASH_COLORS = ['#00d2ff', '#2ed573', '#f2c94c', '#ff9f43', '#a29bfe', '#ff4757', '#7f8c8d', '#bdc3c7'];
const dashCharts = {};

function dashChart(id, type, labels, values, label) {
  const ctx = document.getElementById(id);
  if (!ctx) return;
  if (dashCharts[id]) dashCharts[id].destroy();
  dashCharts[id] = new Chart(ctx, {
    type,
    data: { labels, datasets: [{ label, data: values, backgroundColor: DASH_COLORS, borderWidth: 0, borderRadius: type === 'bar' ? 6 : 0 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: type !== 'bar', labels: { color: '#e2e8f0' } } },
      scales: type === 'bar' ? {
        y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.1)' }, ticks: { color: '#94a3b8', precision: 0 } },
        x: { ticks: { color: '#94a3b8' }, grid: { display: false } }
      } : undefined
    }
  });
}

function dashDistribution(data, cols, top = 6) {
  for (const col of cols) {
    const i = getColIndex(data.headers, col);
    if (i < 0) continue;
    const m = {};
    data.rows.forEach(r => { const v = String(r[i] == null ? '' : r[i]).trim(); if (v) m[v] = (m[v] || 0) + 1; });
    const arr = Object.entries(m).sort((a, b) => b[1] - a[1]);
    if (!arr.length) continue;
    const head = arr.slice(0, top), rest = arr.slice(top).reduce((a, x) => a + x[1], 0);
    if (rest) head.push(['Autres', rest]);
    return { col, labels: head.map(x => x[0]), values: head.map(x => x[1]) };
  }
  return null;
}

function dashAnalysis(id, module, data, extraLines = []) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!data.rows.length) { el.innerHTML = '<p>Aucune donnée enregistrée pour le moment.</p>'; return; }
  const A = rptAnalyse(module, data.headers, data.rows);
  const lines = [`<b>${data.rows.length}</b> enregistrement(s), fiches complétées à <b>${A.completion} %</b>.`];
  A.breakdowns.slice(0, 2).forEach(b => {
    const [k, n] = b.items[0];
    lines.push(`Par ${esc(b.col)} : « ${esc(k)} » domine (${n} sur ${data.rows.length}, ${Math.round(n * 100 / data.rows.length)} %).`);
  });
  A.notes.forEach(t => lines.push(t));
  extraLines.forEach(t => lines.push(t));
  el.innerHTML = lines.map(t => `<p>${t}</p>`).join('');
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

  const sblcLc = f => [getField(f, 'SBLC') ? 'SBLC : ' + getField(f, 'SBLC') : '', getField(f, 'LC') ? 'LC : ' + getField(f, 'LC') : ''].filter(Boolean).join(' / ');
  const valueOf = (r, s) => (r.key === 'id') ? s.data.id : (r.key === 'nom') ? s.data.nom : (r.key === 'SBLC_LC') ? sblcLc(s.data) : getField(s.data, r.key);

  const idRows = [
    { label: 'ID Fournisseur', key: 'id' }, { label: 'Entreprise', key: 'nom' },
    { label: "Nom de l'équipement", key: 'Nom équipement' }, { label: 'Prix indicatif', key: 'Prix indicatif' },
    { label: 'Devise', key: 'Devise' }, { label: 'Capacité de production', key: 'Capacité production' },
    { label: 'Délai de livraison', key: 'Délai livraison' }, { label: 'Garantie', key: 'Garantie' },
    { label: 'Disponibilité pièces détachées', key: 'Pièces détachées' }, { label: 'Installation disponible', key: 'Installation' },
    { label: 'Formation disponible', key: 'Formation' }, { label: 'Service après-vente', key: 'SAV' },
    { label: 'Nb conteneurs estimé', key: 'Nb conteneurs' }, { label: 'Conditions de paiement', key: 'Conditions paiement' },
    { label: 'Incoterm', key: 'Incoterm' }, { label: 'Certification', key: 'Certification' },
    { label: 'SBLC / LC', key: 'SBLC_LC' }, { label: 'Nb camions acheminement', key: 'Nb camions acheminement' }
  ];

  let html = `<table class="comparator-table comparator-ident"><thead><tr><th>Critère</th>`;
  selected.forEach(s => { html += `<th><i class="fa-solid fa-building"></i> ${esc(s.data.nom)}</th>`; });
  html += `</tr></thead><tbody>`;
  idRows.forEach(r => {
    html += `<tr><td><strong>${r.label}</strong></td>`;
    selected.forEach(s => {
      const v = valueOf(r, s);
      html += `<td>${esc(v) || '-'}</td>`;
    });
    html += `</tr>`;
  });
  html += `</tbody></table>`;
  resultsContainer.innerHTML = html;

  const prixNumeriques = selected.map(s => parseFloat((getField(s.data, 'Prix indicatif') || '').toString().replace(/\s/g, '').replace(',', '.').replace(/[^\d.]/g, '')) || null);
  const prixValides = prixNumeriques.filter(p => p !== null);
  const prixMin = prixValides.length ? Math.min(...prixValides) : null;
  const prixMax = prixValides.length ? Math.max(...prixValides) : null;

  const notesPrix = prixNumeriques.map(p => {
    if (p === null || prixMin === null || prixMax === null) return null;
    if (prixMax === prixMin) return 10;
    return Math.round(((prixMax - p) / (prixMax - prixMin)) * 100) / 10;
  });

  const devises = new Set(selected.map(s => (getField(s.data, 'Devise') || '').toString().trim().toUpperCase()).filter(Boolean));
  const memeDevise = devises.size <= 1;

  const criteresEval = [
    { key: 'Prix', pond: comparatorState.ponderation['Prix'], notes: memeDevise ? notesPrix : comparatorState.notes['Prix'], auto: memeDevise },
    { key: 'Qualité technique', pond: comparatorState.ponderation['Qualité technique'], notes: comparatorState.notes['Qualité technique'], auto: false },
    { key: 'Délai', pond: comparatorState.ponderation['Délai'], notes: comparatorState.notes['Délai'], auto: false },
    { key: 'Garantie', pond: comparatorState.ponderation['Garantie'], notes: comparatorState.notes['Garantie'], auto: false },
    { key: 'SAV', pond: comparatorState.ponderation['SAV'], notes: comparatorState.notes['SAV'], auto: false },
    { key: 'Pièces détachées', pond: comparatorState.ponderation['Pièces détachées'], notes: comparatorState.notes['Pièces détachées'], auto: false },
    { key: 'Logistique', pond: comparatorState.ponderation['Logistique'], notes: comparatorState.notes['Logistique'], auto: false },
    { key: 'Expérience', pond: comparatorState.ponderation['Expérience'], notes: comparatorState.notes['Expérience'], auto: false },
    { key: 'Conditions de paiement', pond: comparatorState.ponderation['Conditions de paiement'], notes: comparatorState.notes['Conditions de paiement'], auto: false },
    { key: 'Capacité de production', pond: comparatorState.ponderation['Capacité de production'], notes: comparatorState.notes['Capacité de production'], auto: false }
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

  let evalHtml = `<div class="eval-hint">Les notes sont reprises automatiquement de la fiche de chaque fournisseur (colonnes « Note ... »). Vous pouvez les ajuster ici pour une comparaison ponctuelle.</div>${memeDevise ? '' : '<div class="eval-hint" style="color:var(--accent)">Les offres sont dans des devises différentes : la note « Prix » n’est pas calculée automatiquement, saisissez-la manuellement.</div>'}<table class="comparator-table comparator-eval"><thead><tr><th>Critère</th>`;
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

  const tableData = idRows.map(r => ({ label: r.label, values: selected.map(s => valueOf(r, s)) }));
  comparatorState.last = { selected, tableData, criteresEval, scores, maxScore, sumPond, memeDevise, rec: null, autoReco: null };

  if (maxScore !== null) {
    const recoIdx = scores.findIndex(sc => sc === maxScore);
    const rec = selected[recoIdx];
    const autoReco = buildRecommendation({ selected, crit: criteresEval, scores, recoIdx, getField, sumPond, memeDevise, prix: prixNumeriques });
    if (comparatorState.recoFor !== rec.data.id) { comparatorState.recoFor = rec.data.id; comparatorState.recoEdited = {}; comparatorState.recoText = {}; }
    comparatorState.last.rec = rec;
    comparatorState.last.autoReco = autoReco;
    const val = k => comparatorState.recoEdited[k] ? comparatorState.recoText[k] : autoReco[k];
    const area = (k, label, rows) => `<div class="reco-item full"><label>${label}</label><textarea id="reco-${k}" rows="${rows}" oninput="markRecoEdited('${k}', this)">${esc(val(k))}</textarea></div>`;
    recoContainer.innerHTML = `
      <div class="reco-grid">
        <div class="reco-item"><label>Fournisseur recommandé</label><strong>${esc(rec.data.nom)}</strong></div>
        <div class="reco-item"><label>Score final</label><strong>${maxScore} / 100</strong></div>
        ${area('justif', 'Justification', 4)}${area('avantages', 'Avantages', 5)}${area('inconvenients', 'Inconvénients', 5)}${area('risques', 'Risques identifiés', 5)}
        <div class="reco-item full reco-actions">
          <button type="button" class="btn-secondary" onclick="resetReco()"><i class="fa-solid fa-wand-magic-sparkles"></i> Régénérer automatiquement</button>
          <button type="button" class="btn-primary" onclick="generateComparatorReport()"><i class="fa-solid fa-file-pdf"></i> Rapport PDF</button>
        </div>
      </div>`;
  } else {
    recoContainer.innerHTML = '<div class="empty-state"><i class="fa-solid fa-award"></i><p>Complétez les notes (dans les fiches fournisseurs ou ci-dessus) pour obtenir une recommandation.</p></div>';
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