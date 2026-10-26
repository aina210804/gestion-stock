const { all, get, run, tx } = require('../db/database');
const { ApiError } = require('../utils/errors');
const { round2, fmtDateTime } = require('../utils/helpers');
const alertService = require('./alertService');
const { audit } = require('../middleware/audit');

function createMovement(payload, user, ctx = {}) {
  const { articleId, type, quantite, prixUnitaire = null, motif = null, referenceDoc = null, inventaireId = null, commandeId = null, date = null } = payload;

  if (!['ENTREE', 'SORTIE', 'CORRECTION'].includes(type)) {
    throw new ApiError(400, 'Type de mouvement invalide');
  }

  return tx(() => {
    const art = get('SELECT * FROM articles WHERE id = ?', [articleId]);
    if (!art) throw new ApiError(404, 'Article introuvable');

    const q = Number(quantite);
    if (!Number.isFinite(q) || q === 0) throw new ApiError(400, 'La quantité doit être différente de zéro');
    if (type !== 'CORRECTION' && q < 0) throw new ApiError(400, 'La quantité doit être positive');

    const delta = type === 'ENTREE' ? Math.abs(q) : type === 'SORTIE' ? -Math.abs(q) : q;
    const stockApres = art.stock + delta;
    if (stockApres < 0) {
      throw new ApiError(400, `Stock insuffisant pour "${art.nom}" : disponible ${art.stock} ${art.unite}, demandé ${Math.abs(q)} ${art.unite}`);
    }

    run('UPDATE articles SET stock = ? WHERE id = ?', [stockApres, art.id]);

    const pu =
      prixUnitaire !== null && prixUnitaire !== '' && Number.isFinite(Number(prixUnitaire))
        ? Number(prixUnitaire)
        : type === 'ENTREE'
          ? art.prix_unitaire
          : null;
    const cout = type === 'ENTREE' ? round2(Math.abs(q) * (pu || 0)) : delta < 0 ? round2(-delta * art.prix_unitaire) : 0;

    const res = run(
      `INSERT INTO mouvements (article_id, type, quantite, stock_apres, prix_unitaire, cout, motif, reference_doc,
                               inventaire_id, commande_id, user_id, date, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        art.id, type, type === 'CORRECTION' ? delta : Math.abs(q), stockApres, pu, cout,
        motif, referenceDoc, inventaireId, commandeId, user ? user.id : null, date || fmtDateTime(), fmtDateTime(),
      ]
    );

    alertService.evaluateArticle(art.id, { notify: true, userId: user ? user.id : null });

    audit({ user, ip: ctx.ip }, `MOUVEMENT_${type}`, 'mouvements', res.lastInsertRowid, {
      article: art.reference,
      quantite: type === 'CORRECTION' ? delta : Math.abs(q),
      stock_apres: stockApres,
      motif,
    });

    return get('SELECT * FROM mouvements WHERE id = ?', [res.lastInsertRowid]);
  });
}

function listMovements(filters = {}) {
  const { article_id, type, debut, fin, user_id, search, limit = 50, offset = 0 } = filters;
  const where = [];
  const params = [];
  if (article_id) { where.push('m.article_id = ?'); params.push(article_id); }
  if (type) { where.push('m.type = ?'); params.push(type); }
  if (debut) { where.push('m.date >= ?'); params.push(`${debut} 00:00:00`); }
  if (fin) { where.push('m.date <= ?'); params.push(`${fin} 23:59:59`); }
  if (user_id) { where.push('m.user_id = ?'); params.push(user_id); }
  if (search) {
    where.push('(a.nom LIKE ? OR a.reference LIKE ? OR m.motif LIKE ? OR m.reference_doc LIKE ?)');
    const s = `%${search}%`;
    params.push(s, s, s, s);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = get(`SELECT COUNT(*) AS n FROM mouvements m JOIN articles a ON a.id = m.article_id ${clause}`, params).n;
  const rows = all(
    `SELECT m.*, a.nom AS article_nom, a.reference AS article_reference, a.unite,
            u.nom AS user_nom, u.prenom AS user_prenom, u.matricule
     FROM mouvements m
     JOIN articles a ON a.id = m.article_id
     LEFT JOIN users u ON u.id = m.user_id
     ${clause}
     ORDER BY m.date DESC, m.id DESC
     LIMIT ? OFFSET ?`,
    [...params, Number(limit), Number(offset)]
  );
  return { total, rows };
}

module.exports = { createMovement, listMovements };
