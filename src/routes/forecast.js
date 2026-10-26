const express = require('express');
const { requireRole } = require('../middleware/auth');
const { ah, toCSV, fmtDate } = require('../utils/helpers');
const forecastService = require('../services/forecastService');

const router = express.Router();
const LECTURE = ['admin', 'gestionnaire', 'responsable'];

router.get(
  '/',
  requireRole(...LECTURE),
  ah(async (req, res) => {
    const months = Math.min(Math.max(Number(req.query.months) || 6, 1), 36);
    const horizon = req.query.horizon ? Number(req.query.horizon) : null;
    res.json(forecastService.buildForecast({ months, horizon }));
  })
);

router.get(
  '/ranking',
  requireRole(...LECTURE),
  ah(async (req, res) => {
    const months = Math.min(Math.max(Number(req.query.months) || 6, 1), 36);
    res.json({ rows: forecastService.consumptionRanking(months), mois: months });
  })
);

router.get(
  '/export',
  requireRole(...LECTURE),
  ah(async (req, res) => {
    const months = Math.min(Math.max(Number(req.query.months) || 6, 1), 36);
    const f = forecastService.buildForecast({ months });
    const rows = f.articles.map((a) => ({
      reference: a.reference,
      article: a.nom,
      stock: a.stock,
      conso_mensuelle: a.conso_mensuelle,
      conso_jour: a.conso_jour,
      cout_mensuel: a.cout_mensuel,
      besoin_3_mois: a.projections[3] ? a.projections[3].quantite : '',
      besoin_6_mois: a.projections[6] ? a.projections[6].quantite : '',
      besoin_12_mois: a.projections[12] ? a.projections[12].quantite : '',
      mois_critique: a.mois_critique === null ? 'illimité' : a.mois_critique,
    }));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="previsions_${fmtDate(new Date())}.csv"`);
    res.send(toCSV(rows));
  })
);

module.exports = { router };
