const bcrypt = require('bcryptjs');
const { all, run, get, bool } = require('./database');

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DATE_FMT = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const DATETIME_FMT = (d, h = 9, m = 0) => `${DATE_FMT(d)} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;

const DEFAULT_SETTINGS = [
  ['SOCIETE', 'Entreprise Fenarana', "Nom de l'entreprise"],
  ['EMAIL_ALERTES', 'stock@entreprise.local', 'Destinataire des alertes de stock'],
  ['HORIZON_PREVISION_MOIS', '6', 'Horizon de prévision des dépenses (mois)'],
  ['DELAI_FOURNISSEUR_JOURS', '7', 'Délai de livraison fournisseur (jours)'],
  ['MARGE_ALERTE_JOURS', '5', 'Marge d’alerte pour la planification (jours)'],
];

const CATEGORIES = [
  ['Papeterie', 'Articles de bureau et d’écriture'],
  ['Hygiène', 'Produits d’hygiène et de toilette'],
  ['Épicerie', 'Boissons et produits d’épicerie'],
  ['Entretien', 'Produits d’entretien et de nettoyage'],
  ['Fournitures bureautiques', 'Équipements et fournitures techniques'],
];

const FOURNISSEURS = [
  ['SARL Papeterie Plus', 'Miora Andria', 'contact@papeterieplus.mg', '034 11 22 33', '12 rue du Commerce', 'Antananarivo', 'Livraison 48h, paiement 30 jours'],
  ['Distrib Océan', 'Tojo Ramanandraibe', 'ventes@distribocean.mg', '032 44 55 66', 'Zone industrielle', 'Antananarivo', 'Spécialiste hygiène / entretien'],
  ['Épicerie Centrale SARL', 'Nivo Rasoanaivo', 'commandes@epiceriecentrale.mg', '020 22 33 44', 'Avenue de l’Indépendance', 'Antananarivo', 'Grossiste alimentaire'],
  ['TechBureau', 'Lova Hery', 'support@techbureau.mg', '034 77 88 99', 'Immeuble Alpha', 'Antananarivo', 'Fournitures informatiques'],
];

const USERS = [
  {
    matricule: 'ADM-0001', nom: 'RAZAFY', prenom: 'Karim', date_naissance: '1985-04-12',
    role: 'admin', poste: 'Directeur des opérations', email: 'admin@entreprise.local', password: 'admin123',
  },
  {
    matricule: 'STK-0002', nom: 'RANA', prenom: 'Hélène', date_naissance: '1992-09-30',
    role: 'gestionnaire', poste: 'Gestionnaire de stock', email: 'stock@entreprise.local', password: 'stock123',
  },
  {
    matricule: 'RES-0003', nom: 'PIERRE', prenom: 'Jean', date_naissance: '1978-01-25',
    role: 'responsable', poste: 'Responsable administratif', email: 'resp@entreprise.local', password: 'resp123',
  },
];

// reference, nom, description, categorie, fournisseur, unite, prix, seuil, cible, emplacement, freq (prob/jour), qtyMax
const ARTICLES = [
  ['ART-001', 'Papier A4 80g', 'Ramette 500 feuilles', 'Papeterie', 'SARL Papeterie Plus', 'ramette', 4500, 20, 120, 'Réserve A - B1', 0.45, 6],
  ['ART-002', 'Stylo bille bleu', 'Stylo à bille pointe fine', 'Papeterie', 'SARL Papeterie Plus', 'unité', 500, 50, 250, 'Réserve A - B2', 0.35, 10],
  ['ART-003', 'Papier hygiénique', 'Rouleau 200m', 'Hygiène', 'Distrib Océan', 'rouleau', 800, 40, 180, 'Réserve B - C1', 0.5, 12],
  ['ART-004', 'Savon liquide 500ml', 'Savon mains antibactérien', 'Hygiène', 'Distrib Océan', 'bouteille', 2500, 15, 70, 'Réserve B - C2', 0.3, 6],
  ['ART-005', 'Sucre 1kg', 'Sucre blanc en paquet', 'Épicerie', 'Épicerie Centrale SARL', 'paquet', 1800, 20, 90, 'Réserve D - E1', 0.4, 10],
  ['ART-006', 'Café moulu 250g', 'Café arabica', 'Épicerie', 'Épicerie Centrale SARL', 'paquet', 4500, 10, 50, 'Réserve D - E2', 0.4, 6],
  ['ART-007', 'Eau minérale 1,5L', 'Pack de bouteilles', 'Épicerie', 'Épicerie Centrale SARL', 'bouteille', 1200, 30, 150, 'Réserve D - E3', 0.6, 24],
  ['ART-008', 'Multi-usage 1L', 'Spray nettoyant toutes surfaces', 'Entretien', 'Distrib Océan', 'bouteille', 3200, 10, 45, 'Réserve B - C3', 0.25, 6],
  ['ART-009', 'Détergent linge 2L', 'Liquide vaisselle/linge', 'Entretien', 'Distrib Océan', 'bidon', 6500, 8, 35, 'Réserve B - C4', 0.2, 4],
  ['ART-010', 'Gants ménagers', 'Paire de gants caoutchouc', 'Entretien', 'Distrib Océan', 'paire', 1500, 20, 70, 'Réserve B - C5', 0.2, 8],
  ['ART-011', 'Agrafeuse bureau', 'Agrafeuse métallique format 24/6', 'Fournitures bureautiques', 'TechBureau', 'unité', 8000, 3, 12, 'Bureau - Tiroir 3', 0.05, 2],
  ['ART-012', 'Tonnerre HP 85A', 'Cartouche toner noir', 'Fournitures bureautiques', 'TechBureau', 'unité', 35000, 2, 8, 'Bureau - Étagère T', 0.08, 2],
  ['ART-013', 'Crayon à papier', 'Crayon HB boîte de 12', 'Papeterie', 'SARL Papeterie Plus', 'boîte', 3000, 15, 60, 'Réserve A - B3', 0.15, 4],
  ['ART-014', 'Serviettes papier', 'Paquet 250 serviettes', 'Hygiène', 'Distrib Océan', 'paquet', 2200, 15, 60, 'Réserve B - C6', 0.3, 6],
  ['ART-015', 'Thé en sachet 100g', 'Boîte de sachets de thé', 'Épicerie', 'Épicerie Centrale SARL', 'boîte', 5200, 8, 30, 'Réserve D - E4', 0.2, 4],
];

function insertIfEmpty() {
  const userCount = get('SELECT COUNT(*) AS n FROM users').n;
  if (userCount > 0) return false;

  for (const [cle, valeur, libelle] of DEFAULT_SETTINGS) {
    run('INSERT OR IGNORE INTO settings (cle, valeur, libelle) VALUES (?, ?, ?)', [cle, valeur, libelle]);
  }

  for (const [nom, description] of CATEGORIES) {
    run('INSERT INTO categories (nom, description) VALUES (?, ?)', [nom, description]);
  }

  for (const f of FOURNISSEURS) {
    run(
      'INSERT INTO fournisseurs (nom, contact, email, telephone, adresse, ville, notes) VALUES (?,?,?,?,?,?,?)',
      f
    );
  }

  for (const u of USERS) {
    run(
      `INSERT INTO users (matricule, nom, prenom, date_naissance, role, poste, email, password_hash, actif)
       VALUES (?,?,?,?,?,?,?,?,1)`,
      [u.matricule, u.nom, u.prenom, u.date_naissance, u.role, u.poste, u.email, bcrypt.hashSync(u.password, 10)]
    );
  }

  for (const a of ARTICLES) {
    const [ref, nom, desc, cat, frn, unite, prix, seuil, cible, empl] = a;
    run(
      `INSERT INTO articles (reference, nom, description, categorie_id, fournisseur_id, unite, stock, seuil_alerte,
                             stock_cible, prix_unitaire, emplacement, actif)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,1)`,
      [
        ref, nom, desc,
        get('SELECT id FROM categories WHERE nom = ?', [cat]).id,
        get('SELECT id FROM fournisseurs WHERE nom = ?', [frn]).id,
        unite, cible, seuil, cible, prix, empl,
      ]
    );
  }

  generateHistory();
  return true;
}

function generateHistory() {
  const rng = mulberry32(20261026);
  const adminId = get('SELECT id FROM users WHERE role = ?', ['admin']).id;
  const gestionnaireId = get('SELECT id FROM users WHERE role = ?', ['gestionnaire']).id;
  const articles = all('SELECT * FROM articles');
  const meta = new Map(ARTICLES.map((a) => [a[0], { freq: a[10], qtyMax: a[11] }]));
  const stock = new Map(articles.map((a) => [a.id, a.stock]));

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let d = 150; d >= 1; d--) {
    const day = new Date(today);
    day.setDate(today.getDate() - d);
    const jour = day.getDay();
    if (jour === 0) continue; // dimanche : pas de consommation

    for (const art of articles) {
      const m = meta.get(art.reference);
      if (!m || !m.freq) continue;
      if (rng() > m.freq) continue;

      let qte = 1 + Math.floor(rng() * m.qtyMax);
      let reste = stock.get(art.id);

      if (reste <= 0) continue;
      if (qte > reste) qte = reste;

      reste -= qte;
      stock.set(art.id, reste);

      run(
        `INSERT INTO mouvements (article_id, type, quantite, stock_apres, motif, user_id, date, created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
        [
          art.id, 'SORTIE', qte, reste,
          pickMotif(rng),
          rng() > 0.5 ? gestionnaireId : adminId,
          DATETIME_FMT(day, 8 + Math.floor(rng() * 9), Math.floor(rng() * 60)),
          DATETIME_FMT(day, 8 + Math.floor(rng() * 9), Math.floor(rng() * 60)),
        ]
      );

      if (reste <= art.seuil_alerte) {
        const achat = Math.max((art.stock_cible || art.seuil_alerte * 3) - reste, art.seuil_alerte * 2);
        reste += achat;
        stock.set(art.id, reste);
        run(
          `INSERT INTO mouvements (article_id, type, quantite, stock_apres, prix_unitaire, cout, motif, reference_doc, user_id, date, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [
            art.id, 'ENTREE', achat, reste,
            round2(art.prix_unitaire * (0.95 + rng() * 0.1)),
            round2(achat * art.prix_unitaire),
            `Réapprovisionnement - ${art.reference}`,
            `BC-${String(1000 + Math.floor(rng() * 900))}`,
            adminId,
            DATETIME_FMT(day, 10, Math.floor(rng() * 60)),
            DATETIME_FMT(day, 10, Math.floor(rng() * 60)),
          ]
        );
      }
    }
  }

  for (const [id, q] of stock) {
    run('UPDATE articles SET stock = ? WHERE id = ?', [q, id]);
  }

  forceLowStock(articles, stock, adminId);

  seedBonCommande(adminId, gestionnaireId);
  seedInventaire(adminId);
  seedNotifications(adminId);
  seedAudit(adminId);
}

// Simule des consommations récentes pour déclencher quelques alertes de démonstration
function forceLowStock(articles, stock, userId) {
  const cibles = [
    ['ART-012', 'rupture'],
    ['ART-006', 'bas'],
    ['ART-001', 'bas'],
    ['ART-015', 'bas'],
  ];
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  for (const [ref, mode] of cibles) {
    const art = articles.find((a) => a.reference === ref);
    if (!art) continue;
    const actuel = stock.get(art.id);
    const cible = mode === 'rupture' ? 0 : Math.max(art.seuil_alerte - 3, 1);
    const aRetirer = actuel - cible;
    if (aRetirer <= 0) continue;
    const reste = cible;
    stock.set(art.id, reste);
    const dt = `${DATE_FMT(yesterday)} 16:${String(10 + Math.floor(aRetirer % 40)).padStart(2, '0')}:00`;
    run(
      `INSERT INTO mouvements (article_id, type, quantite, stock_apres, motif, user_id, date, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [art.id, 'SORTIE', aRetirer, reste, 'Consommation imminente - clôture mensuelle', userId, dt, dt]
    );
    run('UPDATE articles SET stock = ? WHERE id = ?', [reste, art.id]);
  }
}

function pickMotif(rng) {
  const motifs = [
    'Consommation bureau', 'Réunion / événement', 'Réapprovisionnement locaux',
    'Usage courant - administration', 'Atelier formation', 'Accueil visiteurs',
  ];
  return motifs[Math.floor(rng() * motifs.length)];
}

const round2 = (n) => Math.round(n * 100) / 100;

function seedBonCommande(adminId, gestionnaireId) {
  const arts = all('SELECT * FROM articles LIMIT 6');
  const frns = all('SELECT * FROM fournisseurs');
  const today = new Date();

  const d = (offset) => {
    const x = new Date(today);
    x.setDate(x.getDate() + offset);
    const p = (n) => String(n).padStart(2, '0');
    return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
  };

  const bonValide = insert('BROUILLON', frns[0].id, arts.slice(0, 3), adminId, gestionnaireId, d(-10), d(-3), 'VALIDEE');
  const bonRecu = insert('VALIDEE', frns[1].id, arts.slice(3, 6), adminId, adminId, d(-40), d(-33), 'RECUE');
  insert('BROUILLON', frns[2].id, arts.slice(0, 2), gestionnaireId, null, d(1), d(8), 'BROUILLON');

  function insert(statut, fournisseur, items, createdBy, validatedBy, dateCmd, dateLiv, statutFinal) {
    const numero = `BC-${String(get('SELECT COALESCE(MAX(id),1000)+1 AS n FROM bons_commande').n).padStart(4, '0')}`;
    const total = items.reduce((s, a) => s + a.prix_unitaire * (a.seuil_alerte * 2 || 10), 0);
    const r = run(
      `INSERT INTO bons_commande (numero, fournisseur_id, date_commande, date_livraison_prevue, statut, total, notes, created_by, validated_by, validated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [numero, fournisseur, dateCmd, dateLiv, statutFinal, round2(total), '', createdBy, validatedBy, validatedBy ? dateCmd : null]
    );
    for (const a of items) {
      const qte = Math.max(a.seuil_alerte * 2, 10);
      run(
        `INSERT INTO bons_commande_items (commande_id, article_id, quantite, quantite_recue, prix_unitaire, montant)
         VALUES (?,?,?,?,?,?)`,
        [r.lastInsertRowid, a.id, qte, statutFinal === 'RECUE' ? qte : 0, a.prix_unitaire, round2(qte * a.prix_unitaire)]
      );
    }
    return r.lastInsertRowid;
  }
}

function seedInventaire(adminId) {
  const ref = `INV-${String(get('SELECT COALESCE(MAX(id),1000)+1 AS n FROM inventory_sessions').n).padStart(4, '0')}`;
  const r = run(
    'INSERT INTO inventory_sessions (reference, date_inventaire, statut, notes, user_id) VALUES (?,?,?,?,?)',
    [ref, new Date(Date.now() - 86400000 * 20).toISOString().slice(0, 10), 'CLOTURE', 'Inventaire tournant mensuel', adminId]
  );
  const articles = all('SELECT * FROM articles LIMIT 8');
  for (const a of articles) {
    const ecart = a.stock > 5 ? (Math.random() > 0.7 ? (Math.random() > 0.5 ? 1 : -1) : 0) : 0;
    run(
      `INSERT INTO inventory_items (session_id, article_id, qte_theorique, qte_reelle, ecart, corrige)
       VALUES (?,?,?,?,?,?)`,
      [r.lastInsertRowid, a.id, a.stock, a.stock - ecart, -ecart, ecart !== 0 ? 1 : 0]
    );
  }
}

function seedNotifications(adminId) {
  const rows = [
    ['stock@entreprise.local', 'Alerte de stock : ART-006 Café moulu 250g', 'Le stock de "Café moulu 250g" est passé sous le seuil d’alerte.', 'ALERTE_STOCK', 'ENVOYE'],
    ['stock@entreprise.local', 'Alerte de stock : ART-012 Tonnerre HP 85A', 'Rupture de stock : "Tonnerre HP 85A".', 'ALERTE_STOCK', 'ENVOYE'],
    ['resp@entreprise.local', 'Bon de commande BC-0002 validé', 'Le bon de commande BC-0002 a été validé et transmis au fournisseur.', 'BON_COMMANDE', 'ENVOYE'],
  ];
  const d = new Date(Date.now() - 86400000 * 3).toISOString().slice(0, 19).replace('T', ' ');
  for (const [to, sujet, corps, type, statut] of rows) {
    run('INSERT INTO notifications (destinataire, sujet, corps, type, statut, user_id, created_at) VALUES (?,?,?,?,?,?,?)', [to, sujet, corps, type, statut, adminId, d]);
  }
}

function seedAudit(adminId) {
  const rows = [
    ['LOGIN', 'users', adminId, '{"message":"Connexion initiale"}'],
    ['SEED', 'system', null, '{"message":"Initialisation de la base de données"}'],
  ];
  const d = new Date(Date.now() - 86400000 * 5).toISOString().slice(0, 19).replace('T', ' ');
  for (const [action, entite, eid, details] of rows) {
    run('INSERT INTO audit_logs (user_id, matricule, action, entite, entite_id, details, ip, created_at) VALUES (?,?,?,?,?,?,?,?)', [adminId, 'ADM-0001', action, entite, eid, details, '127.0.0.1', d]);
  }
}

module.exports = { insertIfEmpty, DEFAULT_SETTINGS, bool };
