const { all, get, run } = require('../db/database');
const { fmtDate, addDays, round2 } = require('../utils/helpers');
const forecastService = require('./forecastService');
const mailService = require('./mailService');
const orderService = require('./orderService');
const { audit } = require('../middleware/audit');

function params() {
  return {
    horizon: parseInt(mailService.setting('HORIZON_PREVISION_MOIS', '6'), 10) || 6,
    delai: parseInt(mailService.setting('DELAI_FOURNISSEUR_JOURS', '7'), 10) || 7,
    marge: parseInt(mailService.setting('MARGE_ALERTE_JOURS', '5'), 10) || 5,
  };
}


function refresh(ctx = {}) {
  const { horizon, delai, marge } = params();
  const mois = Math.max(horizon, 3);
  const f = forecastService.buildForecast({ months: mois, horizon });
  const now = new Date();
  const besoin = new Map();

  for (const a of f.articles) {
    const stockCible = Number(a.stock_cible) > 0 ? Number(a.stock_cible) : Math.max(a.seuil_alerte * 3, 0);
    let quantite = Math.max(0, Math.ceil(a.conso_mensuelle * horizon + stockCible - a.stock));
    if (a.stock <= a.seuil_alerte && quantite <= 0) quantite = Math.max(stockCible - a.stock, a.seuil_alerte * 2, 1);
    if (quantite <= 0) continue;

    const jours = a.conso_jour > 0 ? Math.floor(a.stock / a.conso_jour) : 9999;
    let priorite = 'BASSE';
    let raison = `Réapprovisionnement planifié (couverture ${jours >= 9999 ? 'illimitée' : jours + ' jours'})`;

    if (a.stock <= 0) {
      priorite = 'HAUTE';
      raison = 'Rupture de stock';
    } else if (a.stock <= a.seuil_alerte) {
      priorite = 'HAUTE';
      raison = `Stock sous le seuil d'alerte (${a.seuil_alerte} ${a.unite})`;
    } else if (jours <= delai) {
      priorite = 'HAUTE';
      raison = `Couverture de ${jours} jour(s) ≤ délai fournisseur (${delai} j)`;
    } else if (jours <= delai + marge) {
      priorite = 'MOYENNE';
      raison = `Couverture de ${jours} jour(s) proche du délai fournisseur (${delai} j)`;
    }

    const besoinLe = fmtDate(addDays(now, Math.max(0, jours - delai)));
    besoin.set(a.article_id, {
      article_id: a.article_id,
      quantite_suggeree: quantite,
      priorite,
      besoin_le: besoinLe,
      jours_couverture: Math.min(jours, 9999),
      conso_mensuelle: round2(a.conso_mensuelle),
      raison,
    });
  }

  const existantes = all('SELECT * FROM approvisionnements');
  const existantesIds = new Set(existantes.map((e) => e.article_id));

  for (const e of existantes) {
    if (besoin.has(e.article_id)) continue;
    if (e.statut === 'A_COMMANDER') {
      run('DELETE FROM approvisionnements WHERE id = ?', [e.id]);
    } else if (e.statut === 'EN_COMMANDE') {
      run(
        `UPDATE approvisionnements SET quantite_suggeree = 0, priorite = 'BASSE', raison = 'Commande en cours', updated_at = datetime('now','localtime') WHERE id = ?`,
        [e.id]
      );
    }
  }

  for (const [, b] of besoin) {
    const existante = existantesIds.has(b.article_id);
    if (!existante) {
      run(
        `INSERT INTO approvisionnements (article_id, quantite_suggeree, priorite, besoin_le, jours_couverture, conso_mensuelle, raison, statut, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,'A_COMMANDER', datetime('now','localtime'), datetime('now','localtime'))`,
        [b.article_id, b.quantite_suggeree, b.priorite, b.besoin_le, b.jours_couverture, b.conso_mensuelle, b.raison]
      );
    } else {
      run(
        `UPDATE approvisionnements
         SET quantite_suggeree = ?, priorite = ?, besoin_le = ?, jours_couverture = ?, conso_mensuelle = ?, raison = ?,
             statut = CASE WHEN statut = 'EN_COMMANDE' THEN 'EN_COMMANDE'
                           WHEN statut = 'TRAITE' THEN 'A_COMMANDER'
                           ELSE statut END,
             updated_at = datetime('now','localtime')
         WHERE article_id = ?`,
        [b.quantite_suggeree, b.priorite, b.besoin_le, b.jours_couverture, b.conso_mensuelle, b.raison, b.article_id]
      );
    }
  }

  if (ctx.user) audit(ctx, 'PLANNING_RAFAIRCHI', 'approvisionnements', null, { besoins: besoin.size });
  return { ...params(), besoins: besoin.size };
}

function list(filters = {}) {
  const { priorite, statut } = filters;
  const where = [];
  const args = [];
  if (priorite) { where.push('p.priorite = ?'); args.push(priorite); }
  if (statut) { where.push('p.statut = ?'); args.push(statut); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = all(
    `SELECT p.*, a.nom AS article_nom, a.reference, a.unite, a.stock, a.seuil_alerte, a.prix_unitaire,
            a.emplacement, c.nom AS categorie_nom, f.nom AS fournisseur_nom, f.id AS fournisseur_id,
            b.numero AS commande_numero
     FROM approvisionnements p
     JOIN articles a ON a.id = p.article_id
     LEFT JOIN categories c ON c.id = a.categorie_id
     LEFT JOIN fournisseurs f ON f.id = a.fournisseur_id
     LEFT JOIN bons_commande b ON b.id = p.commande_id
     ${clause}
     ORDER BY CASE p.priorite WHEN 'HAUTE' THEN 0 WHEN 'MOYENNE' THEN 1 ELSE 2 END,
              p.besoin_le, a.nom`,
    args
  ).map((r) => ({ ...r, montant_estime: round2(r.quantite_suggeree * r.prix_unitaire) }));
  const totaux = {
    HAUTE: rows.filter((r) => r.priorite === 'HAUTE').length,
    MOYENNE: rows.filter((r) => r.priorite === 'MOYENNE').length,
    BASSE: rows.filter((r) => r.priorite === 'BASSE').length,
    montant: round2(rows.reduce((s, r) => s + r.montant_estime, 0)),
  };
  return { rows, totaux, parametres: getParams() };
}

function getParams() {
  const p = params();
  return {
    horizon: p.horizon,
    delai: p.delai,
    marge: p.marge,
    montant_total: round2(
      all('SELECT p.*, a.prix_unitaire FROM approvisionnements p JOIN articles a ON a.id = p.article_id').reduce(
        (s, r) => s + r.quantite_suggeree * r.prix_unitaire,
        0
      )
    ),
  };
}

// Crée des brouillons de bons de commande groupés par fournisseur à partir d'articles demandés
function createOrdersFromArticles(articleIds, user, ctx = {}) {
  if (!Array.isArray(articleIds) || articleIds.length === 0) return { orders: [], ignored: [] };
  const placeholders = articleIds.map(() => '?').join(',');
  const rows = all(
    `SELECT p.*, a.nom, a.reference, a.prix_unitaire, a.fournisseur_id, a.stock, a.unite
     FROM approvisionnements p JOIN articles a ON a.id = p.article_id
     WHERE p.article_id IN (${placeholders}) AND p.statut = 'A_COMMANDER' AND p.quantite_suggeree > 0`,
    articleIds
  );
  const manquants = articleIds.filter((id) => !rows.some((r) => r.article_id === id));

  const groupes = new Map();
  for (const r of rows) {
    const key = r.fournisseur_id || 0;
    if (!groupes.has(key)) groupes.set(key, { fournisseurId: r.fournisseur_id, items: [] });
    groupes.get(key).items.push({
      article_id: r.article_id,
      quantite: r.quantite_suggeree,
      prix_unitaire: r.prix_unitaire,
    });
  }

  const orders = [];
  for (const [, g] of groupes) {
    const order = orderService.create(
      { fournisseurId: g.fournisseurId, items: g.items, notes: 'Généré depuis le plan d’approvisionnement' },
      user,
      ctx
    );
    orders.push(order);
  }
  return { orders, ignored: manquants };
}

module.exports = { refresh, list, createOrdersFromArticles, getParams, params };
