class GoogleSheetsAPI {
  constructor(config) {
    this.config = config;
    this.token = null;
    this.tokenClient = null;
    this.gapiLoaded = false;
  }

  async init() {
    await this.loadGapi();
    await this.loadGis();
    await this.authenticate();
  }

  loadGapi() {
    return new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = 'https://apis.google.com/js/api.js';
      script.onload = () => {
        gapi.load('client', async () => {
          await gapi.client.init({
            apiKey: this.config.API_KEY,
            discoveryDocs: ['https://sheets.googleapis.com/$discovery/rest?version=v4'],
          });
          this.gapiLoaded = true;
          resolve();
        });
      };
      document.body.appendChild(script);
    });
  }

  loadGis() {
    return new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.onload = () => resolve();
      document.body.appendChild(script);
    });
  }

  authenticate() {
    return new Promise((resolve, reject) => {
      this.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: this.config.CLIENT_ID,
        scope: this.config.SCOPES,
        callback: (response) => {
          if (response.error) reject(response);
          else {
            this.token = response.access_token;
            gapi.client.setToken({ access_token: this.token });
            resolve();
          }
        },
      });
      this.tokenClient.requestAccessToken({ prompt: 'consent' });
    });
  }

  async readSheet(sheetName) {
    try {
      const response = await gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: this.config.SPREADSHEET_ID,
        range: `${sheetName}!A:AZ`,
      });
      return response.result.values || [];
    } catch (error) {
      console.error(`Erreur lecture ${sheetName}:`, error);
      throw error;
    }
  }

  async writeSheet(sheetName, values) {
    try {
      await gapi.client.sheets.spreadsheets.values.clear({
        spreadsheetId: this.config.SPREADSHEET_ID,
        range: `${sheetName}!A:AZ`,
      });
      const response = await gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId: this.config.SPREADSHEET_ID,
        range: `${sheetName}!A1`,
        valueInputOption: 'RAW',
        resource: { values },
      });
      return response.result;
    } catch (error) {
      console.error(`Erreur écriture ${sheetName}:`, error);
      throw error;
    }
  }

  async appendRow(sheetName, row) {
    try {
      const response = await gapi.client.sheets.spreadsheets.values.append({
        spreadsheetId: this.config.SPREADSHEET_ID,
        range: `${sheetName}!A1`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        resource: { values: [row] },
      });
      return response.result;
    } catch (error) {
      console.error(`Erreur ajout ${sheetName}:`, error);
      throw error;
    }
  }

  async deleteRow(sheetName, rowIndex) {
    try {
      const spreadsheet = await gapi.client.sheets.spreadsheets.get({
        spreadsheetId: this.config.SPREADSHEET_ID,
      });
      const sheet = spreadsheet.result.sheets.find(s => s.properties.title === sheetName);
      if (!sheet) throw new Error(`Feuille ${sheetName} introuvable`);

      const response = await gapi.client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.config.SPREADSHEET_ID,
        resource: {
          requests: [{
            deleteDimension: {
              range: { sheetId: sheet.properties.sheetId, dimension: 'ROWS', startIndex: rowIndex, endIndex: rowIndex + 1 },
            },
          }],
        },
      });
      return response.result;
    } catch (error) {
      console.error(`Erreur suppression ${sheetName}:`, error);
      throw error;
    }
  }
}

window.sheetsAPI = new GoogleSheetsAPI(CONFIG);