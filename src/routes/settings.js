const express = require('express');
const { all, get, run } = require('../db/database');
const { ApiError } = require('../utils/errors');
const { requireRole, requireAuth } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { ah } = require('../utils/helpers');

const router = express.Router();

router.get(
  '/',
  requireAuth,
  ah(async (req, res) => {
    const rows = all('SELECT * FROM settings ORDER BY cle');
    res.json({ rows });
  })
);

router.put(
  '/',
  requireRole('admin'),
  ah(async (req, res) => {
    const valeurs = req.body || {};
    const cles = Object.keys(valeurs);
    if (cles.length === 0) throw new ApiError(400, 'Aucune valeur à enregistrer');
    for (const cle of cles) {
      const row = get('SELECT * FROM settings WHERE cle = ?', [cle]);
      if (!row) continue;
      run('UPDATE settings SET valeur = ? WHERE cle = ?', [String(valeurs[cle]), cle]);
    }
    audit({ user: req.user, ip: req.ip }, 'PARAMETRES_MODIFIES', 'settings', null, { cles });
    res.json({ rows: all('SELECT * FROM settings ORDER BY cle') });
  })
);

router.get(
  '/info',
  requireAuth,
  ah(async (req, res) => {
    const societe = get("SELECT valeur FROM settings WHERE cle = 'SOCIETE'");
    res.json({
      application: 'Gestion de stock des consommables',
      version: '1.0.0',
      societe: societe ? societe.valeur : '',
      moteur: 'Node.js + Express + SQLite (node:sqlite)',
      date: new Date().toISOString(),
    });
  })
);

module.exports = { router };
