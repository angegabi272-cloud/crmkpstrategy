/* KP Strategy 360° — Accès Google Sheets (multi-utilisateurs, multi-appareils)
   - jamais de réécriture complète d'une feuille (plus d'écrasement entre utilisateurs)
   - lignes retrouvées par leur ID au moment de l'écriture (pas par un index périmé)
   - cache court + regroupement des lectures (batchGet) pour respecter les quotas Google
   - nouvelle tentative automatique (429 / 5xx / réseau) et renouvellement du jeton */
const sleep = ms => new Promise(r => setTimeout(r, ms));

class GoogleSheetsAPI {
  constructor(config) {
    this.config = config;
    this.token = null;
    this.tokenExpiry = 0;
    this.tokenClient = null;
    this.onSessionExpired = null;
    this._preload = null;
    this._authWaiter = null;
    this._refreshing = null;
    this._expiredNotified = false;
    this.lanes = { main: Promise.resolve(), bg: Promise.resolve() };
    this.sheetIdsCache = {};
    this.cache = {};
    this.inflight = {};
    this.presenceRow = null;
    this.presencePings = 0;
  }

  /* ---------- CHARGEMENT & AUTHENTIFICATION ---------- */

  _loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = true; s.onload = resolve;
      s.onerror = () => reject(new Error('Chargement impossible : ' + src + ' (vérifiez la connexion Internet)'));
      document.head.appendChild(s);
    });
  }

  // À appeler dès l'ouverture de la page : ainsi le clic sur « Se connecter »
  // ouvre la fenêtre Google immédiatement (indispensable sur iPhone/iPad et Android).
  preload() {
    if (!this._preload) {
      this._preload = (async () => {
        await Promise.all([
          this._loadScript('https://apis.google.com/js/api.js'),
          this._loadScript('https://accounts.google.com/gsi/client')
        ]);
        await new Promise((res, rej) => gapi.load('client', {
          callback: res, onerror: rej, timeout: 15000,
          ontimeout: () => rej(new Error('Délai dépassé au chargement de Google'))
        }));
        await gapi.client.init({
          apiKey: this.config.API_KEY,
          discoveryDocs: ['https://sheets.googleapis.com/$discovery/rest?version=v4']
        });
        this.tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: this.config.CLIENT_ID,
          scope: this.config.SCOPES,
          callback: r => this._onToken(r),
          error_callback: e => this._onAuthError(e)
        });
      })().catch(e => { this._preload = null; throw e; });
    }
    return this._preload;
  }

  isReady() { return !!this.tokenClient; }

  _onToken(resp) {
    const w = this._authWaiter; this._authWaiter = null;
    if (resp.error) { if (w) w.reject(new Error(resp.error_description || resp.error)); return; }
    this.token = resp.access_token;
    this.tokenExpiry = Date.now() + ((resp.expires_in || 3600) - 120) * 1000;
    this._expiredNotified = false;
    gapi.client.setToken({ access_token: this.token });
    if (w) w.resolve();
  }

  _onAuthError(err) {
    const w = this._authWaiter; this._authWaiter = null;
    const t = err && err.type;
    const msg = t === 'popup_closed' ? 'Fenêtre de connexion fermée avant la fin.'
      : t === 'popup_failed_to_open' ? 'Fenêtre bloquée : autorisez les pop-ups pour ce site puis réessayez.'
      : 'Connexion Google impossible. Ouvrez le lien dans Chrome ou Safari (pas dans WhatsApp/Facebook).';
    if (w) w.reject(new Error(msg));
  }

  signIn() {
    return new Promise((resolve, reject) => {
      this._authWaiter = { resolve, reject };
      this.tokenClient.requestAccessToken({ prompt: '' });
    });
  }

  async _ensureToken() {
    if (this.token && Date.now() < this.tokenExpiry) return;
    if (!this._refreshing) this._refreshing = this.signIn().finally(() => { this._refreshing = null; });
    await this._refreshing;
  }

  _expired() {
    if (this.onSessionExpired && !this._expiredNotified) { this._expiredNotified = true; this.onSessionExpired(); }
  }

  /* ---------- OUTILS ---------- */

  // Exécute un appel Google avec renouvellement du jeton et nouvelles tentatives
  async _call(fn) {
    let delay = 1000, lastErr;
    for (let i = 0; i < 5; i++) {
      try { await this._ensureToken(); } catch (e) { this._expired(); throw e; }
      try { return await fn(); }
      catch (e) {
        lastErr = e;
        const err = e && e.result && e.result.error;
        const code = (err && err.code) || (e && e.status);
        const reason = (err && err.errors && err.errors[0] && err.errors[0].reason) || '';
        if (code === 401) { this.tokenExpiry = 0; continue; }
        const transient = code === 429 || code >= 500 || /rateLimit|quota|backendError/i.test(reason) || (!code && !err);
        if (!transient) throw this._friendly(e);
        await sleep(delay + Math.random() * 500);
        delay = Math.min(delay * 2, 16000);
      }
    }
    throw this._friendly(lastErr);
  }

  _friendly(e) {
    const err = e && e.result && e.result.error;
    const code = err && err.code;
    let msg = (err && err.message) || (e && e.message) || 'Erreur réseau';
    if (code === 403) msg = "Accès refusé : ce compte Google n'a pas accès au classeur. Demandez à l'administrateur de le partager en « Éditeur ».";
    else if (code === 429) msg = 'Trop de requêtes en même temps, réessayez dans quelques secondes.';
    const out = new Error(msg); out.code = code; return out;
  }

  _err(code, message) { const e = new Error(message); e.code = code; return e; }

  // Deux voies : « main » (actions de l'utilisateur) et « bg » (présence, journal) pour ne jamais se bloquer
  _enqueue(taskFn, lane = 'main') {
    const run = this.lanes[lane].then(taskFn, taskFn);
    this.lanes[lane] = run.catch(() => {});
    return run;
  }

  _col(i) { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  _invalidate(name) { delete this.cache[name]; }

  async _getSheetId(name) {
    if (this.sheetIdsCache[name] === undefined) {
      const r = await this._call(() => gapi.client.sheets.spreadsheets.get({
        spreadsheetId: this.config.SPREADSHEET_ID, fields: 'sheets.properties(sheetId,title)'
      }));
      r.result.sheets.forEach(s => { this.sheetIdsCache[s.properties.title] = s.properties.sheetId; });
    }
    return this.sheetIdsCache[name];
  }

  // Crée en une seule fois les feuilles / en-têtes manquants (à appeler une fois après la connexion)
  async ensureAllSheets(schemas, additions = {}) {
    const sid = this.config.SPREADSHEET_ID;
    const names = Object.keys(this.config.SHEETS).map(k => this.config.SHEETS[k]);
    const load = async () => {
      const r = await this._call(() => gapi.client.sheets.spreadsheets.get({ spreadsheetId: sid, fields: 'sheets.properties(sheetId,title)' }));
      this.sheetIdsCache = {};
      r.result.sheets.forEach(s => { this.sheetIdsCache[s.properties.title] = s.properties.sheetId; });
    };
    await load();
    const missing = names.filter(n => this.sheetIdsCache[n] === undefined);
    if (missing.length) {
      try {
        await this._call(() => gapi.client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: sid,
          resource: { requests: missing.map(title => ({ addSheet: { properties: { title } } })) }
        }));
      } catch (e) { /* un autre utilisateur vient peut-être de les créer */ }
      await load();
    }
    const heads = await this._call(() => gapi.client.sheets.spreadsheets.values.batchGet({
      spreadsheetId: sid, ranges: names.map(n => `${n}!1:1`)
    }));
    const data = [];
    (heads.result.valueRanges || []).forEach((vr, i) => {
      const n = names[i];
      const hdr = (vr.values && vr.values[0]) || [];
      if (!hdr[0] && schemas[n]) data.push({ range: `${n}!A1`, values: [schemas[n]] });
      else if (additions[n]) {
        const have = hdr.map(h => (h || '').toString().toLowerCase().trim());
        const miss = additions[n].filter(col => !have.includes(col.toLowerCase()));
        if (miss.length) data.push({ range: `${n}!${this._col(hdr.length)}1`, values: [miss] });
      }
    });
    if (data.length) {
      await this._call(() => gapi.client.sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: sid, resource: { valueInputOption: 'RAW', data }
      }));
    }
  }

  /* ---------- LECTURE ---------- */

  async readSheet(name, opts = {}) {
    const ttl = this.config.CACHE_MS || 15000;
    const c = this.cache[name];
    if (!opts.fresh && c && Date.now() - c.t < ttl) return c.v;
    if (!opts.fresh && this.inflight[name]) return this.inflight[name];
    const p = this._call(() => gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId: this.config.SPREADSHEET_ID, range: `${name}!A:AZ`
    })).then(r => {
      const v = r.result.values || [];
      this.cache[name] = { v, t: Date.now() };
      return v;
    }).finally(() => { delete this.inflight[name]; });
    this.inflight[name] = p;
    return p;
  }

  // Plusieurs feuilles en UNE seule requête
  async batchRead(names, opts = {}) {
    const ttl = this.config.CACHE_MS || 15000, now = Date.now();
    const need = opts.fresh ? names : names.filter(n => !(this.cache[n] && now - this.cache[n].t < ttl));
    if (need.length) {
      const r = await this._call(() => gapi.client.sheets.spreadsheets.values.batchGet({
        spreadsheetId: this.config.SPREADSHEET_ID, ranges: need.map(n => `${n}!A:AZ`)
      }));
      (r.result.valueRanges || []).forEach((vr, i) => { this.cache[need[i]] = { v: vr.values || [], t: Date.now() }; });
    }
    return names.map(n => (this.cache[n] ? this.cache[n].v : []));
  }

  /* ---------- RETROUVER UNE LIGNE (par ID, au moment de l'écriture) ---------- */

  _sig(row) {
    const a = (row || []).map(c => (c == null ? '' : String(c)));
    while (a.length && a[a.length - 1] === '') a.pop();
    return a.join('\u241F');
  }

  _locate(all, original) {
    const key = original && original[0] != null ? String(original[0]).trim() : '';
    const target = this._sig(original);
    const cand = [];
    for (let i = 1; i < all.length; i++) {
      const r = all[i] || [];
      if (key ? String(r[0] || '').trim() === key : this._sig(r) === target) cand.push(i);
    }
    if (!cand.length) return null;
    const exact = cand.find(i => this._sig(all[i]) === target);
    const idx = exact !== undefined ? exact : cand[0];
    return { index: idx, row: all[idx] || [], exact: exact !== undefined };
  }

  /* ---------- ÉCRITURE ---------- */

  appendRow(name, row, opts = {}) {
    return this._enqueue(async () => {
      const r = await this._call(() => gapi.client.sheets.spreadsheets.values.append({
        spreadsheetId: this.config.SPREADSHEET_ID, range: `${name}!A1`,
        valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', resource: { values: [row] }
      }));
      this._invalidate(name);
      return r.result;
    }, opts.background ? 'bg' : 'main');
  }

  // Modifie UNE ligne. Refuse si quelqu'un d'autre l'a modifiée entre-temps (sauf force).
  updateRow(name, original, values, opts = {}) {
    return this._enqueue(async () => {
      const all = await this.readSheet(name, { fresh: true });
      const loc = this._locate(all, original);
      if (!loc) throw this._err('ROW_NOT_FOUND', 'Cette ligne a été supprimée ou modifiée par un autre utilisateur. La liste va être actualisée.');
      if (!opts.force && !loc.exact) throw this._err('ROW_CONFLICT', 'Cette ligne vient d’être modifiée par un autre utilisateur.');
      await this._call(() => gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId: this.config.SPREADSHEET_ID, range: `${name}!A${loc.index + 1}`,
        valueInputOption: 'RAW', resource: { values: [values] }
      }));
      this._invalidate(name);
    });
  }

  // Modifie seulement certaines colonnes (par nom d'en-tête) : ne touche pas au reste de la ligne.
  patchRow(name, original, changes) {
    return this._enqueue(async () => {
      const all = await this.readSheet(name, { fresh: true });
      const loc = this._locate(all, original);
      if (!loc) throw this._err('ROW_NOT_FOUND', 'Cette ligne a été supprimée par un autre utilisateur.');
      const headers = all[0] || [];
      const newRow = loc.row.slice(), data = [];
      Object.keys(changes).forEach(h => {
        const i = headers.findIndex(x => (x || '').toString().toLowerCase().trim() === h.toLowerCase());
        if (i < 0) return;
        const v = typeof changes[h] === 'function' ? changes[h](loc.row[i] || '') : changes[h];
        newRow[i] = v;
        data.push({ range: `${name}!${this._col(i)}${loc.index + 1}`, values: [[v]] });
      });
      if (data.length) {
        await this._call(() => gapi.client.sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: this.config.SPREADSHEET_ID, resource: { valueInputOption: 'RAW', data }
        }));
      }
      this._invalidate(name);
      return newRow;
    });
  }

  deleteRowByMatch(name, original) {
    return this._enqueue(async () => {
      const all = await this.readSheet(name, { fresh: true });
      const loc = this._locate(all, original);
      if (!loc) return { alreadyDeleted: true };
      const sheetId = await this._getSheetId(name);
      if (sheetId === undefined) throw new Error(`Feuille ${name} introuvable`);
      await this._call(() => gapi.client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.config.SPREADSHEET_ID,
        resource: { requests: [{ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: loc.index, endIndex: loc.index + 1 } } }] }
      }));
      this._invalidate(name);
      return { deleted: true };
    });
  }

  // Présence : 1 seule écriture par battement (la ligne est mémorisée)
  ping(email) {
    return this._enqueue(async () => {
      const name = this.config.SHEETS.PRESENCE, sid = this.config.SPREADSHEET_ID, now = new Date().toISOString();
      if (this.presenceRow === null || ++this.presencePings % 20 === 0) {
        const all = await this.readSheet(name, { fresh: true });
        const i = all.findIndex((r, k) => k > 0 && r[0] === email);
        this.presenceRow = i > 0 ? i + 1 : null;
      }
      if (this.presenceRow !== null) {
        const row = this.presenceRow;
        await this._call(() => gapi.client.sheets.spreadsheets.values.update({
          spreadsheetId: sid, range: `${name}!A${row}:B${row}`, valueInputOption: 'RAW', resource: { values: [[email, now]] }
        }));
        return;
      }
      const r = await this._call(() => gapi.client.sheets.spreadsheets.values.append({
        spreadsheetId: sid, range: `${name}!A1`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', resource: { values: [[email, now]] }
      }));
      const m = /!A(\d+)/.exec((r.result.updates && r.result.updates.updatedRange) || '');
      this.presenceRow = m ? parseInt(m[1], 10) : null;
      this._invalidate(name);
    }, 'bg');
  }
}

window.sheetsAPI = new GoogleSheetsAPI(CONFIG);
