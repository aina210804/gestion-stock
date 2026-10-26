const express = require('express');
const { all, get, run, tx } = require('../db/database');
const { ApiError } = require('../utils/errors');
const { requireRole } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { ah, fmtDate } = require('../utils/helpers');
const movementService = require('../services/movementService');

const router = express.Router();
const LECTURE = ['admin', 'gestionnaire', 'responsable'];
const ECRITURE = ['admin', 'gestionnaire'];

function nextReference() {
  const n = get('SELECT COALESCE(MAX(id), 0) + 1 AS n FROM inventory_sessions').n;
  return `INV-${String(n).padStart(4, '0')}`;
}

router.get(
  '/sessions',
  requireRole(...LECTURE),
  ah(async (req, res) => {
    const rows = all(
      `SELECT s.*, u.nom AS user_nom, u.prenom AS user_prenom, u.matricule,
            (SELECT COUNT(*) FROM inventory_items i WHERE i.session_id = s.id) AS nb_articles,
            (SELECT SUM(CASE WHEN i.ecart <> 0 THEN 1 ELSE 0 END) FROM inventory_items i WHERE i.session_id = s.id) AS nb_ecarts,
            (SELECT COALESCE(SUM(ABS(i.ecart)), 0) FROM inventory_items i WHERE i.session_id = s.id) AS ecart_total
       FROM inventory_sessions s
       LEFT JOIN users u ON u.id = s.user_id
       ORDER BY s.id DESC`
    );
    res.json({ rows });
  })
);

router.get(
  '/sessions/:id',
  requireRole(...LECTURE),
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const session = get(
      `SELECT s.*, u.nom AS user_nom, u.prenom AS user_prenom, u.matricule
       FROM inventory_sessions s LEFT JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
      [id]
    );
    if (!session) throw new ApiError(404, 'Session d’inventaire introuvable');
    session.items = all(
      `SELECT i.*, a.reference, a.nom AS article_nom, a.unite, a.emplacement, a.stock AS stock_actuel,
              a.prix_unitaire, c.nom AS categorie_nom
       FROM inventory_items i
       JOIN articles a ON a.id = i.article_id
       LEFT JOIN categories c ON c.id = a.categorie_id
       WHERE i.session_id = ?
       ORDER BY a.nom`,
      [id]
    );
    session.synthese = {
      nb_articles: session.items.length,
      nb_ecarts: session.items.filter((i) => i.ecart !== 0).length,
      ecart_positif: session.items.filter((i) => i.ecart > 0).reduce((s, i) => s + i.ecart, 0),
      ecart_negatif: session.items.filter((i) => i.ecart < 0).reduce((s, i) => s + i.ecart, 0),
      valeur_ecart: session.items.reduce((s, i) => s + Math.abs(i.ecart) * (i.prix_unitaire || 0), 0),
    };
    res.json(session);
  })
);

router.post(
  '/sessions',
  requireRole(...ECRITURE),
  ah(async (req, res) => {
    const articles = all('SELECT id, stock FROM articles WHERE actif = 1 ORDER BY nom');
    if (articles.length === 0) throw new ApiError(400, 'Aucun article actif à inventorier');

    const id = tx(() => {
      const r = run(
        `INSERT INTO inventory_sessions (reference, date_inventaire, statut, notes, user_id) VALUES (?,?, 'OUVERT', ?, ?)`,
        [nextReference(), fmtDate(), req.body?.notes || null, req.user.id]
      );
      for (const a of articles) {
        run(
          `INSERT INTO inventory_items (session_id, article_id, qte_theorique, qte_reelle, ecart, corrige)
           VALUES (?,?,?,?,?,0)`,
          [r.lastInsertRowid, a.id, a.stock, a.stock, 0]
        );
      }
      return r.lastInsertRowid;
    });
    audit({ user: req.user, ip: req.ip }, 'INVENTAIRE_CREE', 'inventory_sessions', id, { articles: articles.length });
    res.status(201).json(get('SELECT * FROM inventory_sessions WHERE id = ?', [id]));
  })
);

router.put(
  '/sessions/:id',
  requireRole(...ECRITURE),
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const s = get('SELECT * FROM inventory_sessions WHERE id = ?', [id]);
    if (!s) throw new ApiError(404, 'Session introuvable');
    if (s.statut !== 'OUVERT') throw new ApiError(400, 'Cette session est clôturée et ne peut plus être modifiée');
    run('UPDATE inventory_sessions SET notes = ? WHERE id = ?', [req.body?.notes || s.notes, id]);
    res.json(get('SELECT * FROM inventory_sessions WHERE id = ?', [id]));
  })
);

router.delete(
  '/sessions/:id',
  requireRole(...ECRITURE),
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const s = get('SELECT * FROM inventory_sessions WHERE id = ?', [id]);
    if (!s) throw new ApiError(404, 'Session introuvable');
    if (s.statut !== 'OUVERT') throw new ApiError(400, 'Seule une session ouverte peut être supprimée');
    run('DELETE FROM inventory_sessions WHERE id = ?', [id]);
    audit({ user: req.user, ip: req.ip }, 'INVENTAIRE_SUPPRIME', 'inventory_sessions', id, { reference: s.reference });
    res.json({ ok: true });
  })
);

router.post(
  '/sessions/:id/items',
  requireRole(...ECRITURE),
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const s = get('SELECT * FROM inventory_sessions WHERE id = ?', [id]);
    if (!s) throw new ApiError(404, 'Session introuvable');
    if (s.statut !== 'OUVERT') throw new ApiError(400, 'Cette session est clôturée');

    const { article_id, qte_reelle, items } = req.body || {};
    if (Array.isArray(items)) {
      for (const it of items) saveItem(id, Number(it.article_id), Number(it.qte_reelle));
      return res.json({ ok: true, maj: items.length });
    }
    saveItem(id, Number(article_id), Number(qte_reelle));
    return res.json({ ok: true });
  })
);

function saveItem(sessionId, articleId, qteReelle) {
  if (!Number.isFinite(qteReelle) || qteReelle < 0) throw new ApiError(400, 'Quantité réelle invalide');
  const item = get('SELECT * FROM inventory_items WHERE session_id = ? AND article_id = ?', [sessionId, articleId]);
  if (!item) throw new ApiError(404, 'Article non présent dans cette session d’inventaire');
  const art = get('SELECT stock FROM articles WHERE id = ?', [articleId]);
  const theorique = art.stock;
  run(
    'UPDATE inventory_items SET qte_theorique = ?, qte_reelle = ?, ecart = ? WHERE id = ?',
    [theorique, qteReelle, qteReelle - theorique, item.id]
  );
  return get('SELECT * FROM inventory_items WHERE id = ?', [item.id]);
}

router.post(
  '/sessions/:id/cloture',
  requireRole(...ECRITURE),
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const s = get('SELECT * FROM inventory_sessions WHERE id = ?', [id]);
    if (!s) throw new ApiError(404, 'Session introuvable');
    if (s.statut !== 'OUVERT') throw new ApiError(400, 'Cette session est déjà clôturée');

    const result = tx(() => {
      const items = all(
        `SELECT i.*, a.stock AS stock_actuel, a.reference, a.nom
         FROM inventory_items i JOIN articles a ON a.id = i.article_id
         WHERE i.session_id = ?`,
        [id]
      );
      let corrections = 0;
      for (const it of items) {
        const delta = Number(it.qte_reelle) - Number(it.stock_actuel);
        run('UPDATE inventory_items SET qte_theorique = ?, ecart = ? WHERE id = ?', [it.stock_actuel, delta, it.id]);
        if (delta !== 0) {
          movementService.createMovement(
            {
              articleId: it.article_id,
              type: 'CORRECTION',
              quantite: delta,
              motif: `Correction inventaire ${s.reference}`,
              referenceDoc: s.reference,
              inventaireId: id,
            },
            req.user,
            { ip: req.ip }
          );
          run('UPDATE inventory_items SET corrige = 1 WHERE id = ?', [it.id]);
          corrections += 1;
        }
      }
      run("UPDATE inventory_sessions SET statut = 'CLOTURE' WHERE id = ?", [id]);
      return { corrections, total: items.length };
    });

    audit({ user: req.user, ip: req.ip }, 'INVENTAIRE_CLOTURE', 'inventory_sessions', id, result);
    res.json({
      ok: true,
      ...result,
      message: `${result.corrections} correction(s) appliquée(s) sur ${result.total} article(s)`,
      session: get('SELECT * FROM inventory_sessions WHERE id = ?', [id]),
    });
  })
);

module.exports = { router };
