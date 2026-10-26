const express = require('express');
const { all, get } = require('../db/database');
const { ApiError } = require('../utils/errors');
const { requireRole } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { ah } = require('../utils/helpers');
const alertService = require('../services/alertService');

const router = express.Router();
const LECTURE = ['admin', 'gestionnaire', 'responsable'];

router.get(
  '/',
  requireRole(...LECTURE),
  ah(async (req, res) => {
    const { statut, type, search } = req.query;
    const where = [];
    const args = [];
    if (statut) { where.push('al.statut = ?'); args.push(statut); }
    if (type) { where.push('al.type = ?'); args.push(type); }
    if (search) {
      where.push('(a.nom LIKE ? OR a.reference LIKE ? OR al.message LIKE ?)');
      const s = `%${search}%`;
      args.push(s, s, s);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = all(
      `SELECT al.*, a.reference, a.nom AS article_nom, a.unite, a.emplacement, a.prix_unitaire,
              a.fournisseur_id, f.nom AS fournisseur_nom, f.email AS fournisseur_email,
              c.nom AS categorie_nom,
              COALESCE(u.prenom || ' ' || u.nom, '-') AS declarant
       FROM alertes al
       JOIN articles a ON a.id = al.article_id
       LEFT JOIN fournisseurs f ON f.id = a.fournisseur_id
       LEFT JOIN categories c ON c.id = a.categorie_id
       LEFT JOIN users u ON u.id = al.user_id
       ${clause}
       ORDER BY CASE al.statut WHEN 'ACTIVE' THEN 0 ELSE 1 END,
                CASE al.type WHEN 'RUPTURE' THEN 0 ELSE 1 END,
                al.created_at DESC
       LIMIT 500`,
      args
    );
    res.json({ rows, stats: alertService.stats() });
  })
);

router.get(
  '/count',
  requireRole(...LECTURE),
  ah(async (req, res) => {
    res.json(alertService.stats());
  })
);

router.post(
  '/:id/resoudre',
  requireRole(...LECTURE),
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const alert = get('SELECT * FROM alertes WHERE id = ?', [id]);
    if (!alert) throw new ApiError(404, 'Alerte introuvable');
    const ok = alertService.resolve(id, req.user.id, req.body?.motif || null);
    if (!ok) throw new ApiError(400, 'Cette alerte est déjà résolue');
    audit({ user: req.user, ip: req.ip }, 'ALERTE_RESOLUE', 'alertes', id, { article_id: alert.article_id });
    res.json({ ok: true, alert: get('SELECT * FROM alertes WHERE id = ?', [id]) });
  })
);

router.post(
  '/check',
  requireRole(...LECTURE),
  ah(async (req, res) => {
    const creees = alertService.evaluateAll(false);
    audit({ user: req.user, ip: req.ip }, 'ALERTE_CONTROLEE', 'alertes', null, { nouvelles: creees });
    res.json({ ok: true, nouvelles_alertes: creees, stats: alertService.stats() });
  })
);

module.exports = { router };
