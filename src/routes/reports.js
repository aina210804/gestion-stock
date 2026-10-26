const express = require('express');
const { all, get } = require('../db/database');
const { requireRole } = require('../middleware/auth');
const { ah, toCSV, fmtDate, monthsAgo } = require('../utils/helpers');
const reportService = require('../services/reportService');

const router = express.Router();
const LECTURE = ['admin', 'gestionnaire', 'responsable'];

const RAPPORTS = {
  stock: reportService.rapportStock,
  consommation: reportService.rapportConsommation,
  depenses: reportService.rapportDepenses,
  mouvements: reportService.rapportMouvements,
  approvisionnement: reportService.rapportApprovisionnement,
  alertes: reportService.rapportAlertes,
};

router.get(
  '/',
  requireRole(...LECTURE),
  ah(async (req, res) => {
    res.json({
      rapports: [
        { code: 'stock', libelle: 'État des stocks', description: 'Quantités, valeurs et alertes par article' },
        { code: 'consommation', libelle: 'Consommation', description: 'Quantités et coûts consommés par période' },
        { code: 'depenses', libelle: 'Dépenses', description: 'Achats, consommation et commandes par mois' },
        { code: 'mouvements', libelle: 'Mouvements de stock', description: 'Historique détaillé des entrées/sorties' },
        { code: 'approvisionnement', libelle: 'Prévisions', description: 'Consommation moyenne et projections' },
        { code: 'alertes', libelle: 'Alertes', description: 'Historique des alertes de stock' },
      ],
      periodes: [
        { code: '1', libelle: '1 mois' },
        { code: '3', libelle: '3 mois' },
        { code: '6', libelle: '6 mois (défaut)' },
        { code: '12', libelle: '12 mois' },
      ],
    });
  })
);

router.get(
  '/:code',
  requireRole(...LECTURE),
  ah(async (req, res) => {
    const builder = RAPPORTS[req.params.code];
    if (!builder) return res.status(404).json({ error: 'Rapport inconnu' });
    const result = builder(req.query);
    if (String(req.query.format) === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${req.params.code}_${fmtDate(new Date())}.csv"`);
      return res.send(toCSV(result.rows, result.columns.map((c) => c.key)));
    }
    return res.json({ ...result, colonnes: result.columns });
  })
);

router.get(
  '/:code/table',
  requireRole(...LECTURE),
  ah(async (req, res) => {
    const builder = RAPPORTS[req.params.code];
    if (!builder) return res.status(404).json({ error: 'Rapport inconnu' });
    res.json(builder(req.query));
  })
);

// Aperçu imprimable : renvoie les données nécessaires à la page d'impression
router.get(
  '/:code/apercu',
  requireRole(...LECTURE),
  ah(async (req, res) => {
    const builder = RAPPORTS[req.params.code];
    if (!builder) return res.status(404).json({ error: 'Rapport inconnu' });
    const result = builder(req.query);
    const societe = get("SELECT valeur FROM settings WHERE cle = 'SOCIETE'");
    res.json({
      ...result,
      societe: societe ? societe.valeur : 'Entreprise',
      genere_le: fmtDate(new Date()),
      genere_par: req.user ? `${req.user.prenom} ${req.user.nom} (${req.user.matricule})` : '-',
    });
  })
);

router.get(
  '/stats/global',
  requireRole(...LECTURE),
  ah(async (req, res) => {
    const debut = req.query.debut || fmtDate(monthsAgo(6));
    const fin = req.query.fin || fmtDate(new Date());
    res.json({
      kpis: reportService.kpis(),
      series: reportService.series(),
      periode: { debut, fin },
      totaux: {
        articles: get('SELECT COUNT(*) AS n FROM articles WHERE actif = 1').n,
        mouvements: get('SELECT COUNT(*) AS n FROM mouvements').n,
        commandes: get('SELECT COUNT(*) AS n FROM bons_commande').n,
        alertes: get('SELECT COUNT(*) AS n FROM alertes').n,
        utilisateurs: get('SELECT COUNT(*) AS n FROM users WHERE actif = 1').n,
        fournisseurs: get('SELECT COUNT(*) AS n FROM fournisseurs WHERE actif = 1').n,
      },
      derniers_utilisateurs: all(
        `SELECT matricule, nom, prenom, role, last_login FROM users WHERE actif = 1 ORDER BY last_login DESC LIMIT 5`
      ),
    });
  })
);

module.exports = { router };
