const { all, get, run, tx } = require('../db/database');
const { ApiError } = require('../utils/errors');
const { round2, fmtDate, addDays } = require('../utils/helpers');
const movementService = require('./movementService');
const mailService = require('./mailService');
const { audit } = require('../middleware/audit');

function nextNumero() {
  const n = get('SELECT COALESCE(MAX(id), 0) + 1 AS n FROM bons_commande').n;
  return `BC-${String(n).padStart(4, '0')}`;
}

function create({ fournisseurId = null, items = [], notes = '', dateLivraison = null, statut = 'BROUILLON' }, user, ctx = {}) {
  if (!Array.isArray(items) || items.length === 0) throw new ApiError(400, 'Le bon de commande doit contenir au moins un article');

  return tx(() => {
    const lignes = items.map((it) => {
      const art = get('SELECT * FROM articles WHERE id = ?', [it.article_id]);
      if (!art) throw new ApiError(404, `Article introuvable (id ${it.article_id})`);
      const qte = Number(it.quantite);
      if (!Number.isFinite(qte) || qte <= 0) throw new ApiError(400, `Quantité invalide pour ${art.nom}`);
      const pu = Number(it.prix_unitaire) > 0 ? Number(it.prix_unitaire) : art.prix_unitaire;
      return { art, qte, pu, montant: round2(qte * pu) };
    });

    const fournisseur = fournisseurId || lignes[0].art.fournisseur_id || null;
    const total = round2(lignes.reduce((s, l) => s + l.montant, 0));
    const numero = nextNumero();

    const res = run(
      `INSERT INTO bons_commande (numero, fournisseur_id, date_commande, date_livraison_prevue, statut, total, notes, created_by)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        numero, fournisseur, fmtDate(),
        dateLivraison || fmtDate(addDays(new Date(), 15)),
        statut, total, notes || '', user ? user.id : null,
      ]
    );
    const orderId = res.lastInsertRowid;

    for (const l of lignes) {
      run(
        `INSERT INTO bons_commande_items (commande_id, article_id, quantite, quantite_recue, prix_unitaire, montant)
         VALUES (?,?,?,0,?,?)`,
        [orderId, l.art.id, l.qte, l.pu, l.montant]
      );
    }
    markPlanning(orderId, 'EN_COMMANDE');

    audit({ user, ip: ctx.ip }, 'COMMANDE_CREE', 'bons_commande', orderId, { numero, total, articles: lignes.length });
    return getOrder(orderId);
  });
}

function markPlanning(commandeId, statut) {
  if (statut === 'EN_COMMANDE') {
    run(
      `UPDATE approvisionnements SET statut = 'EN_COMMANDE', commande_id = ?, updated_at = datetime('now','localtime')
       WHERE article_id IN (SELECT article_id FROM bons_commande_items WHERE commande_id = ?)`,
      [commandeId, commandeId]
    );
  } else if (statut === 'A_COMMANDER') {
    run(
      `UPDATE approvisionnements SET statut = 'A_COMMANDER', commande_id = NULL, updated_at = datetime('now','localtime')
       WHERE commande_id = ? AND statut = 'EN_COMMANDE'`,
      [commandeId]
    );
  } else if (statut === 'TRAITE') {
    run(
      `UPDATE approvisionnements SET statut = 'TRAITE', updated_at = datetime('now','localtime')
       WHERE article_id IN (SELECT article_id FROM bons_commande_items WHERE commande_id = ?)`,
      [commandeId]
    );
  }
}

function validate(orderId, user, ctx = {}) {
  const order = getOrder(orderId);
  if (!order) throw new ApiError(404, 'Bon de commande introuvable');
  if (order.statut !== 'BROUILLON') throw new ApiError(400, `Seul un bon de commande « Brouillon » peut être validé (statut actuel : ${order.statut})`);

  run(
    `UPDATE bons_commande SET statut = 'VALIDEE', validated_by = ?, validated_at = datetime('now','localtime') WHERE id = ?`,
    [user.id, orderId]
  );
  markPlanning(orderId, 'EN_COMMANDE');
  const updated = getOrder(orderId);
  mailService.notifyOrder(updated, 'validé', user).catch(() => {});
  audit({ user, ip: ctx.ip }, 'COMMANDE_VALIDEE', 'bons_commande', orderId, { numero: order.numero });
  return updated;
}

function receive(orderId, receivedItems = [], user, ctx = {}) {
  const order = getOrder(orderId);
  if (!order) throw new ApiError(404, 'Bon de commande introuvable');
  if (!['VALIDEE', 'PARTIELLE'].includes(order.statut)) {
    throw new ApiError(400, `Réception impossible pour un bon de commande « ${order.statut} »`);
  }

  return tx(() => {
    let recues = 0;
    for (const ligne of order.items) {
      const saisie = (receivedItems.find((r) => Number(r.article_id) === ligne.article_id) || {}).quantite;
      const reste = ligne.quantite - ligne.quantite_recue;
      const qte = saisie === undefined || saisie === null || saisie === '' ? reste : Number(saisie);
      if (!Number.isFinite(qte) || qte <= 0) continue;
      if (qte > reste) throw new ApiError(400, `Quantité reçue supérieure à la quantité commandée pour ${ligne.article_nom}`);

      movementService.createMovement(
        {
          articleId: ligne.article_id,
          type: 'ENTREE',
          quantite: qte,
          prixUnitaire: ligne.prix_unitaire,
          motif: `Réception commande ${order.numero}`,
          referenceDoc: order.numero,
          commandeId: orderId,
        },
        user,
        ctx
      );

      run('UPDATE bons_commande_items SET quantite_recue = quantite_recue + ? WHERE id = ?', [qte, ligne.id]);
      recues += 1;
      const item = get('SELECT * FROM bons_commande_items WHERE id = ?', [ligne.id]);
      if (item.quantite_recue >= item.quantite) markPlanningArticle(ligne.article_id, 'TRAITE');
    }

    if (recues === 0) throw new ApiError(400, 'Aucune quantité à réceptionner');

    const reste = get(
      'SELECT COUNT(*) AS n FROM bons_commande_items WHERE commande_id = ? AND quantite_recue < quantite',
      [orderId]
    ).n;
    const statut = reste > 0 ? 'PARTIELLE' : 'RECUE';
    run('UPDATE bons_commande SET statut = ? WHERE id = ?', [statut, orderId]);

    const updated = getOrder(orderId);
    mailService.notifyOrder(updated, statut === 'RECUE' ? 'intégralement reçu' : 'partiellement reçu', user).catch(() => {});
    audit({ user, ip: ctx.ip }, 'COMMANDE_RECUE', 'bons_commande', orderId, { numero: order.numero, statut, lignes: recues });
    return updated;
  });
}

function markPlanningArticle(articleId, statut) {
  run('UPDATE approvisionnements SET statut = ?, updated_at = datetime(\'now\',\'localtime\') WHERE article_id = ?', [statut, articleId]);
}

function cancel(orderId, user, ctx = {}) {
  const order = getOrder(orderId);
  if (!order) throw new ApiError(404, 'Bon de commande introuvable');
  if (['RECUE', 'ANNULEE'].includes(order.statut)) throw new ApiError(400, `Impossible d'annuler un bon « ${order.statut} »`);
  run("UPDATE bons_commande SET statut = 'ANNULEE' WHERE id = ?", [orderId]);
  markPlanning(orderId, 'A_COMMANDER');
  mailService.notifyOrder(order, 'annulé', user).catch(() => {});
  audit({ user, ip: ctx.ip }, 'COMMANDE_ANNULEE', 'bons_commande', orderId, { numero: order.numero });
  return getOrder(orderId);
}

function getOrder(orderId) {
  const order = get(
    `SELECT b.*, f.nom AS fournisseur_nom, u.nom AS createur_nom, u.prenom AS createur_prenom, u.matricule AS createur_matricule,
            v.nom AS validateur_nom, v.prenom AS validateur_prenom
     FROM bons_commande b
     LEFT JOIN fournisseurs f ON f.id = b.fournisseur_id
     LEFT JOIN users u ON u.id = b.created_by
     LEFT JOIN users v ON v.id = b.validated_by
     WHERE b.id = ?`,
    [orderId]
  );
  if (!order) return null;
  order.items = all(
    `SELECT i.*, a.nom AS article_nom, a.reference AS article_reference, a.unite, a.stock AS stock_actuel
     FROM bons_commande_items i
     JOIN articles a ON a.id = i.article_id
     WHERE i.commande_id = ?
     ORDER BY a.nom`,
    [orderId]
  );
  order.mouvements = all(
    `SELECT m.id, m.date, m.quantite, a.nom AS article_nom
     FROM mouvements m JOIN articles a ON a.id = m.article_id
     WHERE m.commande_id = ? ORDER BY m.date`,
    [orderId]
  );
  return order;
}

function listOrders(filters = {}) {
  const { statut, fournisseur_id, search, limit = 50, offset = 0 } = filters;
  const where = [];
  const params = [];
  if (statut) { where.push('b.statut = ?'); params.push(statut); }
  if (fournisseur_id) { where.push('b.fournisseur_id = ?'); params.push(fournisseur_id); }
  if (search) {
    where.push('(b.numero LIKE ? OR f.nom LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = get(`SELECT COUNT(*) AS n FROM bons_commande b LEFT JOIN fournisseurs f ON f.id = b.fournisseur_id ${clause}`, params).n;
  const rows = all(
    `SELECT b.*, f.nom AS fournisseur_nom, u.nom AS createur_nom, u.prenom AS createur_prenom,
            (SELECT COUNT(*) FROM bons_commande_items i WHERE i.commande_id = b.id) AS nb_articles
     FROM bons_commande b
     LEFT JOIN fournisseurs f ON f.id = b.fournisseur_id
     LEFT JOIN users u ON u.id = b.created_by
     ${clause}
     ORDER BY b.id DESC
     LIMIT ? OFFSET ?`,
    [...params, Number(limit), Number(offset)]
  );
  return { total, rows };
}

module.exports = { create, validate, receive, cancel, getOrder, listOrders, nextNumero };
