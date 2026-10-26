const express = require('express');
const { requireRole } = require('../middleware/auth');
const { ah, toCSV } = require('../utils/helpers');
const planningService = require('../services/planningService');

const router = express.Router();
const LECTURE = ['admin', 'gestionnaire', 'responsable'];
const ECRITURE = ['admin', 'gestionnaire'];

router.get(
  '/',
  requireRole(...LECTURE),
  ah(async (req, res) => {
    res.json(planningService.list(req.query));
  })
);

router.get(
  '/export',
  requireRole(...LECTURE),
  ah(async (req, res) => {
    const data = planningService.list(req.query);
    const rows = data.rows.map((r) => ({
      priorite: r.priorite,
      reference: r.reference,
      article: r.article_nom,
      fournisseur: r.fournisseur_nom || '',
      stock: r.stock,
      seuil: r.seuil_alerte,
      conso_mensuelle: r.conso_mensuelle,
      quantite_suggeree: r.quantite_suggeree,
      montant_estime: r.montant_estime,
      besoin_le: r.besoin_le,
      jours_couverture: r.jours_couverture,
      statut: r.statut,
      raison: r.raison,
    }));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="approvisionnements.csv"`);
    res.send(toCSV(rows));
  })
);

router.post(
  '/refresh',
  requireRole(...ECRITURE),
  ah(async (req, res) => {
    const result = planningService.refresh({ user: req.user, ip: req.ip });
    res.json({ ok: true, ...result, ...planningService.list({}) });
  })
);

router.post(
  '/commandes',
  requireRole(...ECRITURE),
  ah(async (req, res) => {
    const articleIds = (req.body?.article_ids || []).map(Number).filter(Boolean);
    const result = planningService.createOrdersFromArticles(articleIds, req.user, { ip: req.ip });
    res.status(201).json({
      ok: true,
      commandes: result.orders.map((o) => ({ id: o.id, numero: o.numero, total: o.total, statut: o.statut, fournisseur: o.fournisseur_nom, articles: o.items.length })),
      ignores: result.ignored,
      ...planningService.list({}),
    });
  })
);

module.exports = { router };
