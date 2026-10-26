const express = require('express');
const { all, get } = require('../db/database');
const { ApiError } = require('../utils/errors');
const { requireRole } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { ah, page } = require('../utils/helpers');
const mailService = require('../services/mailService');

const router = express.Router();
const LECTURE = ['admin', 'gestionnaire', 'responsable'];

router.get(
  '/',
  requireRole(...LECTURE),
  ah(async (req, res) => {
    const { type, statut, search } = req.query;
    const { limit, offset } = page(req.query.limit, req.query.offset);
    const where = [];
    const args = [];
    if (type) { where.push('type = ?'); args.push(type); }
    if (statut) { where.push('statut = ?'); args.push(statut); }
    if (search) {
      where.push('(sujet LIKE ? OR destinataire LIKE ? OR corps LIKE ?)');
      const s = `%${search}%`;
      args.push(s, s, s);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = get(`SELECT COUNT(*) AS n FROM notifications ${clause}`, args).n;
    const rows = all(`SELECT * FROM notifications ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`, [...args, limit, offset]);
    const stats = {
      total,
      envoyes: get("SELECT COUNT(*) AS n FROM notifications WHERE statut = 'ENVOYE'").n,
      simules: get("SELECT COUNT(*) AS n FROM notifications WHERE statut = 'SIMULE'").n,
      erreurs: get("SELECT COUNT(*) AS n FROM notifications WHERE statut = 'ERREUR'").n,
      smtp_configure: mailService.modeInfo().smtp_configure,
    };
    res.json({ total, rows, stats });
  })
);

router.get(
  '/mode',
  requireRole(...LECTURE),
  ah(async (req, res) => {
    res.json(mailService.modeInfo());
  })
);

// Teste réellement la connexion au serveur SMTP (bouton de configuration)
router.post(
  '/verifier',
  requireRole('admin'),
  ah(async (req, res) => {
    const result = await mailService.verifier();
    audit({ user: req.user, ip: req.ip }, 'SMTP_VERIFIE', 'notifications', null, {
      ok: result.ok,
      host: result.config ? result.config.host : null,
    });
    res.json(result);
  })
);

router.post(
  '/test',
  requireRole('admin'),
  ah(async (req, res) => {
    const dest = req.body?.destinataire || mailService.setting('EMAIL_ALERTES') || mailService.modeInfo().from || req.user.email;
    if (!dest) throw new ApiError(400, 'Aucun destinataire');
    const r = await mailService.sendMail({
      to: dest,
      subject: '[Gestion de stock] Test de notification',
      text: `Bonjour ${req.user.prenom},\n\nCeci est un e-mail de test envoyé depuis l'application de gestion de stock.\n\nDate : ${new Date().toLocaleString('fr-FR')}\n\nCordialement,\nL'application.`,
      type: 'TEST',
      userId: req.user.id,
    });
    audit({ user: req.user, ip: req.ip }, 'EMAIL_TEST', 'notifications', r ? r.id : null, { destinataire: dest });
    res.json({ ok: true, notification: r, mode: mailService.modeInfo().smtp_configure ? (mailService.modeInfo().provider || 'SMTP') : 'SIMULATION' });
  })
);

module.exports = { router };
