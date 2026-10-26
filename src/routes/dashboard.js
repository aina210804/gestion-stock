const express = require('express');
const { requireRole } = require('../middleware/auth');
const { ah } = require('../utils/helpers');
const reportService = require('../services/reportService');
const forecastService = require('../services/forecastService');
const planningService = require('../services/planningService');
const alertService = require('../services/alertService');

const router = express.Router();
const LECTURE = ['admin', 'gestionnaire', 'responsable'];

router.get(
  '/',
  requireRole(...LECTURE),
  ah(async (req, res) => {
    const kpis = reportService.kpis();
    const series = reportService.series();
    const planning = planningService.list({ statut: 'A_COMMANDER' });
    res.json({
      kpis,
      series,
      alertes: alertService.stats(),
      planning: {
        nb: planning.rows.length,
        hautes: planning.totaux.HAUTE,
        montant: planning.totaux.montant,
        top: planning.rows.slice(0, 5),
      },
    });
  })
);

router.get(
  '/series',
  requireRole(...LECTURE),
  ah(async (req, res) => {
    res.json(reportService.series());
  })
);

router.get(
  '/mouvements-recents',
  requireRole(...LECTURE),
  ah(async (req, res) => {
    res.json(reportService.series().mouvements30.slice(-10));
  })
);

router.get(
  '/consommation-mensuelle',
  requireRole(...LECTURE),
  ah(async (req, res) => {
    const months = Number(req.query.months) || 6;
    const f = forecastService.buildForecast({ months });
    res.json({ serie: f.series || f.serie, mois: f.mois_cibles, totaux: f.totaux });
  })
);

module.exports = { router };
