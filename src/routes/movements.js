const express = require('express');
const { all, get } = require('../db/database');
const { ApiError } = require('../utils/errors');
const { requireRole } = require('../middleware/auth');
const { ah, page, toCSV } = require('../utils/helpers');
const movementService = require('../services/movementService');

const router = express.Router();
const LECTURE = ['admin', 'gestionnaire', 'responsable'];
const ECRITURE = ['admin', 'gestionnaire'];

router.get(
  '/',
  requireRole(...LECTURE),
  ah(async (req, res) => {
    const { limit, offset } = page(req.query.limit, req.query.offset);
    const result = movementService.listMovements({ ...req.query, limit, offset });
    res.json(result);
  })
);

router.get(
  '/export',
  requireRole(...LECTURE),
  ah(async (req, res) => {
    const result = movementService.listMovements({ ...req.query, limit: 500, offset: 0 });
    const rows = result.rows.map((r) => ({
      date: r.date,
      type: r.type,
      reference: r.article_reference,
      article: r.article_nom,
      quantite: r.quantite,
      stock_apres: r.stock_apres,
      prix_unitaire: r.prix_unitaire,
      cout: r.cout,
      motif: r.motif,
      reference_doc: r.reference_doc,
      utilisateur: r.matricule ? `${r.matricule} ${r.user_prenom} ${r.user_nom}` : '',
    }));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="mouvements_${Date.now()}.csv"`);
    res.send(toCSV(rows));
  })
);

router.get(
  '/types',
  requireRole(...LECTURE),
  ah(async (req, res) => {
    res.json({
      types: [
        { code: 'ENTREE', libelle: 'Entrée (réception / achat)', sens: '+', roles: ECRITURE },
        { code: 'SORTIE', libelle: 'Sortie (consommation)', sens: '-', roles: ECRITURE },
        { code: 'CORRECTION', libelle: 'Correction d’inventaire', sens: '±', roles: ['admin'] },
      ],
      motifs_sortie: ['Consommation bureau', 'Réunion / événement', 'Réapprovisionnement locaux', 'Usage courant - administration', 'Atelier formation', 'Accueil visiteurs', 'Autre'],
    });
  })
);

router.post(
  '/',
  requireRole(...ECRITURE),
  ah(async (req, res) => {
    const d = req.body || {};
    if (d.type === 'CORRECTION' && req.user.role !== 'admin') {
      throw new ApiError(403, 'Seul un administrateur peut saisir une correction manuelle (utilisez l’inventaire)');
    }
    const mv = movementService.createMovement(
      {
        articleId: Number(d.article_id),
        type: d.type,
        quantite: Number(d.quantite),
        prixUnitaire: d.prix_unitaire,
        motif: d.motif || null,
        referenceDoc: d.reference_doc || null,
        date: d.date || null,
      },
      req.user,
      { ip: req.ip }
    );
    const article = get('SELECT reference, nom, stock, unite, seuil_alerte FROM articles WHERE id = ?', [mv.article_id]);
    res.status(201).json({ mouvement: mv, article });
  })
);

router.get(
  '/stats',
  requireRole(...LECTURE),
  ah(async (req, res) => {
    const mois = `${new Date().toISOString().slice(0, 7)}%`;
    const stats = get(
      `SELECT
         COALESCE(SUM(CASE WHEN type='ENTREE' THEN quantite END),0) AS entrees,
         COALESCE(SUM(CASE WHEN type='SORTIE' THEN quantite END),0) AS sorties,
         COALESCE(SUM(CASE WHEN type='CORRECTION' THEN quantite END),0) AS corrections,
         COALESCE(SUM(CASE WHEN type='ENTREE' THEN cout END),0) AS achats,
         COALESCE(SUM(CASE WHEN type='SORTIE' THEN cout END),0) AS consommation,
         COUNT(*) AS nb
       FROM mouvements WHERE date LIKE ?`,
      [mois]
    );
    const derniers = all(
      `SELECT m.*, a.nom AS article_nom, a.reference, u.matricule, u.nom AS user_nom, u.prenom AS user_prenom
       FROM mouvements m JOIN articles a ON a.id = m.article_id
       LEFT JOIN users u ON u.id = m.user_id
       ORDER BY m.date DESC, m.id DESC LIMIT 8`
    );
    res.json({ mois: stats, derniers });
  })
);

module.exports = { router };
