const CONFIG = {
  SPREADSHEET_ID: '1VJtkuH8UPWUSa2IV79NXovWaFV8XQmaLJ9jNRmo5LnA',
  API_KEY: 'AIzaSyBz69fTFoHAPZbmpOo4WROWfpABiYjv3N4',
  CLIENT_ID: '1078594296294-jj8sebovm4ok6l7hh760cg664tt5tpks.apps.googleusercontent.com',
  SCOPES: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email',
  PRESENCE_MS: 60000,   // battement de présence (1 écriture / minute / utilisateur)
  REFRESH_MS: 60000,    // actualisation automatique des données
  CACHE_MS: 15000,      // cache de lecture (limite les appels Google)
  SHEETS: {
    DASHBOARD: 'DASHBOARD', CONTACTS: 'CONTACTS', FOURNISSEURS: 'FOURNISSEURS',
    COMPARATEUR: 'COMPARATEUR', ACTUALISATION: 'ACTUALISATION', EPC: 'EPC',
    TRADE_FINANCE: 'TRADE_FINANCE', GARANTIES: 'GARANTIES', INGENIEURS: 'INGENIEURS',
    INTERACTIONS: 'INTERACTIONS', PROJETS: 'PROJETS', RELANCES: 'RELANCES',
    UTILISATEURS: 'UTILISATEURS', LOGS: 'LOGS', PRESENCE: 'PRESENCE'
  }
};

const SCHEMAS = {
  DASHBOARD: ['Indicateur', 'Valeur'],
  UTILISATEURS: ['Email', 'Role', 'Statut', 'Derniere Connexion', 'Derniere Action'],
  LOGS: ['Date', 'Heure', 'Utilisateur', 'Module', 'Action', 'Details'],
  PRESENCE: ['Email', 'Dernier Ping'],
  CONTACTS: ['ID Contact', 'Type acteur', 'Entreprise', 'Nom', 'Prénom', 'Fonction', 'Pays', 'Ville', 'Secteur', 'Email', 'Téléphone', 'Site web', 'Source info', 'Date dernière vérif', 'Statut vérification', 'Priorité', 'Projets associés', 'Historique échanges'],
  FOURNISSEURS: ['ID', 'Entreprise', 'Pays', 'Contact', 'Email', 'Téléphone', 'Site Web', 'Spécialité', 'Catégorie', 'Statut', 'Commentaires', 'Prix indicatif', 'Devise', 'Nom équipement', 'Capacité production', 'Délai livraison', 'Garantie', 'Pièces détachées', 'Installation', 'Formation', 'SAV', 'Nb conteneurs', 'Conditions paiement', 'Incoterm', 'Certification', 'SBLC', 'Nb camions acheminement', 'Source info', 'Date dernière vérif', 'Statut vérif', 'Note Qualité technique', 'Note Délai', 'Note Garantie', 'Note SAV', 'Note Pièces détachées', 'Note Logistique', 'Note Expérience', 'Note Conditions de paiement', 'LC', 'Note Capacité de production'],
  COMPARATEUR: ['Critère', 'Fournisseur 1', 'Fournisseur 2', 'Fournisseur 3', 'Fournisseur 4', 'Fournisseur 5', 'Pondération', 'Type'],
  ACTUALISATION: ['Contact', 'Entreprise', 'Téléphone', 'Email', 'Site web', 'Dernière vérification', 'Prochaine vérification', 'Jours depuis', 'Statut'],
  EPC: ['ID', 'Nom EPC', 'Pays', 'Type', 'Zone', 'Références Hôtellerie', 'Capacité', 'Financement', 'Modèle', 'Contact Email', 'Téléphone', 'Site', 'Priorité', 'Spécialités techniques', 'Certifications', 'Zones intervention', 'Références projets', 'Responsable technique'],
  TRADE_FINANCE: ['ID', 'Nom organisme', 'Pays', 'Type organisme', 'Type Trade Finance', 'Produit', 'Financement import', 'Financement export', 'Crédit documentaire', 'SBLC', 'Contact', 'Email', 'Téléphone', 'Site', 'Statut', 'Secteurs financés', 'Montant min', 'Montant max', 'Devise', 'Conditions éligibilité', 'Garanties exigées', 'Date vérification'],
  GARANTIES: ['ID Garantie', 'Nom organisme', 'Pays', 'Type organisme', 'Type garantie', 'Garantie bancaire', 'SBLC', 'Assurance', 'Montant couvert', 'Contact', 'Email', 'Téléphone', 'Site', 'Statut', 'Secteurs éligibles', 'Conditions', 'Procédure demande'],
  INGENIEURS: ['ID Expert', 'Nom', 'Prénom', 'Entreprise', 'Fonction', 'Spécialité', 'Domaine', 'Pays', 'Ville', 'Téléphone', 'Email', 'Expérience', 'Disponibilité', 'Statut', 'Compétences', 'Certifications'],
  INTERACTIONS: ['ID Interaction', 'Date', 'ID Contact', 'Entreprise', 'Type', 'Canal', 'Objet', 'Résumé', 'Résultat', 'Action suivante', 'Date relance', 'Responsable', 'Statut'],
  PROJETS: ['ID Projet', 'Nom Projet', 'Pays', 'Secteur', 'Coût Total (FCFA)', 'Besoin Financement', 'Financement Obtenu', 'Statut', 'Prochaine Action', 'Date Limite', 'Promoteur', 'Description', 'Apport Promoteur', 'Montant Restant', 'Financeurs Ciblés', 'Fournisseurs Associés', 'EPC Associés', 'Responsable Interne', 'Historique Échanges', 'Risques & Observations', 'Porteur du projet', 'Entreprise', 'Commentaires'],
  RELANCES: ['ID Relance', 'Entreprise', 'Contact', 'Objet', 'Date Prévue', 'Priorité', 'Responsable', 'Statut', 'Projet Associé', 'Type Interaction', 'Date Échange', 'Résultat']
};
// Colonnes ajoutées automatiquement à la fin des feuilles déjà existantes (sans toucher aux données).
// Si la feuille contient déjà la colonne sous un nom voisin (voir SCHEMA_ALIASES), elle est simplement renommée.
const SCHEMA_ADDITIONS = {
  PROJETS: ['Porteur du projet', 'Entreprise', 'Commentaires'],
  FOURNISSEURS: ['Nom équipement', 'Prix indicatif', 'Devise', 'Capacité production', 'Délai livraison', 'Garantie', 'Pièces détachées', 'Installation', 'Formation', 'SAV', 'Nb conteneurs', 'Conditions paiement', 'Incoterm', 'Certification', 'SBLC', 'LC', 'Nb camions acheminement',
    'Note Qualité technique', 'Note Délai', 'Note Garantie', 'Note SAV', 'Note Pièces détachées', 'Note Logistique', 'Note Expérience', 'Note Conditions de paiement', 'Note Capacité de production']
};

const SCHEMA_ALIASES = {
  FOURNISSEURS: {
    'Nom équipement': ["Nom de l'équipement", 'Équipement', 'Equipement', 'Nom equipement'],
    'Prix indicatif': ['Prix'],
    'Capacité production': ['Capacité de production', 'Capacite production', 'Capacité'],
    'Délai livraison': ['Délai de livraison', 'Delai livraison', 'Délai'],
    'Pièces détachées': ['Disponibilité pièces détachées', 'Disponibilité des pièces détachées', 'Pièces détachées disponibles'],
    'Installation': ['Installation disponible'],
    'Formation': ['Formation disponible'],
    'SAV': ['Service après-vente', 'Service après vente', 'SAV disponible'],
    'Nb conteneurs': ['Nb conteneurs estimé', 'Nombre de conteneurs', 'Nb conteneurs estimés'],
    'Conditions paiement': ['Conditions de paiement'],
    'Incoterm': ['Incoterms'],
    'Certification': ['Certifications'],
    'Nb camions acheminement': ['Nb camions', "Nb camions d'acheminement", 'Nombre de camions acheminement']
  }
};
