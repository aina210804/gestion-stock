const express = require('express');
const { requireRole } = require('../middleware/auth');
const { ah, toCSV } = require('../utils/helpers');
const orderService = require('../services/orderService');

const router = express.Router();
const LECTURE = ['admin', 'gestionnaire', 'responsable'];
const ECRITURE = ['admin', 'gestionnaire'];
const VALIDATION = ['admin', 'responsable'];

router.get(
  '/',
  requireRole(...LECTURE),
  ah(async (req, res) => {
    const { limit, offset } = req.query;
    res.json(orderService.listOrders({ ...req.query, limit, offset }));
  })
);

router.get(
  '/:id',
  requireRole(...LECTURE),
  ah(async (req, res) => {
    const order = orderService.getOrder(Number(req.params.id));
    if (!order) return res.status(404).json({ error: 'Bon de commande introuvable' });
    return res.json(order);
  })
);

router.get(
  '/:id/export',
  requireRole(...LECTURE),
  ah(async (req, res) => {
    const order = orderService.getOrder(Number(req.params.id));
    if (!order) return res.status(404).json({ error: 'Bon de commande introuvable' });
    const rows = order.items.map((i) => ({
      numero: order.numero,
      fournisseur: order.fournisseur_nom || '',
      reference: i.article_reference,
      article: i.article_nom,
      quantite: i.quantite,
      quantite_recue: i.quantite_recue,
      prix_unitaire: i.prix_unitaire,
      montant: i.montant,
      statut: order.statut,
    }));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${order.numero}.csv"`);
    return res.send(toCSV(rows));
  })
);

router.post(
  '/',
  requireRole(...ECRITURE),
  ah(async (req, res) => {
    const order = orderService.create(req.body || {}, req.user, { ip: req.ip });
    res.status(201).json(order);
  })
);

router.post(
  '/:id/valider',
  requireRole(...VALIDATION),
  ah(async (req, res) => {
    res.json(orderService.validate(Number(req.params.id), req.user, { ip: req.ip }));
  })
);

router.post(
  '/:id/recevoir',
  requireRole(...ECRITURE),
  ah(async (req, res) => {
    const items = req.body?.items || [];
    res.json(orderService.receive(Number(req.params.id), items, req.user, { ip: req.ip }));
  })
);

router.post(
  '/:id/annuler',
  requireRole(...VALIDATION, ...ECRITURE),
  ah(async (req, res) => {
    res.json(orderService.cancel(Number(req.params.id), req.user, { ip: req.ip }));
  })
);

module.exports = { router };
