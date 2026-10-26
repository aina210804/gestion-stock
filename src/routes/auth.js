const express = require('express');
const bcrypt = require('bcryptjs');
const { get, run } = require('../db/database');
const { ApiError } = require('../utils/errors');
const { permissionsFor } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { ah } = require('../utils/helpers');

const router = express.Router();

function publicUser(u) {
  return {
    id: u.id,
    matricule: u.matricule,
    nom: u.nom,
    prenom: u.prenom,
    role: u.role,
    poste: u.poste,
    email: u.email,
    date_naissance: u.date_naissance,
    permissions: permissionsFor(u.role),
  };
}

router.post(
  '/login',
  ah(async (req, res) => {
    const { identifiant, motDePasse } = req.body || {};
    if (!identifiant || !motDePasse) throw new ApiError(400, 'Identifiant et mot de passe requis');

    const id = String(identifiant).trim().toLowerCase();
    const user = get('SELECT * FROM users WHERE lower(email) = ? OR lower(matricule) = ?', [id, id]);
    if (!user) throw new ApiError(401, 'Identifiant ou mot de passe incorrect');
    if (!bcrypt.compareSync(motDePasse, user.password_hash)) throw new ApiError(401, 'Identifiant ou mot de passe incorrect');
    if (!user.actif) throw new ApiError(403, 'Ce compte est désactivé');

    req.session.user = publicUser(user);
    run("UPDATE users SET last_login = datetime('now','localtime') WHERE id = ?", [user.id]);
    audit({ user: publicUser(user), ip: req.ip }, 'LOGIN', 'users', user.id, { email: user.email });
    res.json({ user: publicUser(user) });
  })
);

router.post(
  '/logout',
  ah(async (req, res) => {
    const user = req.session.user;
    req.session.destroy(() => {});
    if (user) audit({ user, ip: req.ip }, 'LOGOUT', 'users', user.id, null);
    res.json({ ok: true });
  })
);

router.get(
  '/me',
  ah(async (req, res) => {
    if (!req.session.user) throw new ApiError(401, 'Authentification requise');
    const u = get('SELECT * FROM users WHERE id = ?', [req.session.user.id]);
    if (!u || !u.actif) throw new ApiError(401, 'Compte introuvable ou désactivé');
    res.json({ user: publicUser(u) });
  })
);

router.post(
  '/password',
  ah(async (req, res) => {
    if (!req.session.user) throw new ApiError(401, 'Authentification requise');
    const { ancien, nouveau } = req.body || {};
    if (!ancien || !nouveau) throw new ApiError(400, 'Ancien et nouveau mot de passe requis');
    if (String(nouveau).length < 6) throw new ApiError(400, 'Le nouveau mot de passe doit contenir au moins 6 caractères');
    const u = get('SELECT * FROM users WHERE id = ?', [req.session.user.id]);
    if (!bcrypt.compareSync(ancien, u.password_hash)) throw new ApiError(400, 'Ancien mot de passe incorrect');
    run('UPDATE users SET password_hash = ? WHERE id = ?', [bcrypt.hashSync(nouveau, 10), u.id]);
    audit({ user: req.session.user, ip: req.ip }, 'MOT_DE_PASSE_CHANGE', 'users', u.id, null);
    res.json({ ok: true, message: 'Mot de passe modifié' });
  })
);

module.exports = { router, publicUser };
