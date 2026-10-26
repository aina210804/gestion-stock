const express = require('express');
const bcrypt = require('bcryptjs');
const { all, get, run, tx } = require('../db/database');
const { ApiError } = require('../utils/errors');
const { requireRole } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { ah, page, fmtDate } = require('../utils/helpers');

const router = express.Router();
router.use(requireRole('admin'));

const ROLES = ['admin', 'gestionnaire', 'responsable'];

function nextMatricule(role) {
  const prefix = role === 'admin' ? 'ADM' : role === 'gestionnaire' ? 'STK' : 'RES';
  const n = get('SELECT COALESCE(MAX(id), 0) + 1 AS n FROM users').n;
  return `${prefix}-${String(n).padStart(4, '0')}`;
}

function validate(data) {
  if (!data.nom || !String(data.nom).trim()) throw new ApiError(400, 'Le nom est obligatoire');
  if (!data.prenom || !String(data.prenom).trim()) throw new ApiError(400, 'Le prénom est obligatoire');
  if (!data.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) throw new ApiError(400, 'Adresse e-mail invalide');
  if (!ROLES.includes(data.role)) throw new ApiError(400, 'Rôle invalide');
}

router.get(
  '/',
  ah(async (req, res) => {
    const { search, role, actif } = req.query;
    const { limit, offset } = page(req.query.limit, req.query.offset);
    const where = [];
    const args = [];
    if (search) {
      where.push('(nom LIKE ? OR prenom LIKE ? OR email LIKE ? OR matricule LIKE ?)');
      const s = `%${search}%`;
      args.push(s, s, s, s);
    }
    if (role) { where.push('role = ?'); args.push(role); }
    if (actif !== undefined && actif !== '') { where.push('actif = ?'); args.push(Number(actif)); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = get(`SELECT COUNT(*) AS n FROM users ${clause}`, args).n;
    const rows = all(
      `SELECT id, matricule, nom, prenom, date_naissance, role, poste, email, actif, last_login, created_at
       FROM users ${clause}
       ORDER BY actif DESC, nom, prenom LIMIT ? OFFSET ?`,
      [...args, limit, offset]
    );
    res.json({ total, rows });
  })
);

router.get(
  '/roles',
  ah(async (req, res) => {
    res.json({
      roles: [
        { code: 'admin', libelle: 'Administrateur', droits: 'Tous les droits (paramètres, utilisateurs, sécurité)' },
        { code: 'gestionnaire', libelle: 'Gestionnaire de stock', droits: 'Articles, entrées/sorties, inventaires, fournisseurs, préparation des commandes' },
        { code: 'responsable', libelle: 'Responsable', droits: 'Supervision, validation des commandes, rapports, traçabilité' },
      ],
    });
  })
);

router.post(
  '/',
  ah(async (req, res) => {
    const data = req.body || {};
    validate(data);
    const emailExistant = get('SELECT id FROM users WHERE lower(email) = ?', [String(data.email).toLowerCase()]);
    if (emailExistant) throw new ApiError(400, 'Cette adresse e-mail est déjà utilisée');
    if (!data.motDePasse || String(data.motDePasse).length < 6) throw new ApiError(400, 'Mot de passe requis (6 caractères minimum)');

    const matricule = data.matricule ? String(data.matricule).trim() : nextMatricule(data.role);
    if (get('SELECT id FROM users WHERE matricule = ?', [matricule])) throw new ApiError(400, `Le matricule ${matricule} existe déjà`);

    const res2 = run(
      `INSERT INTO users (matricule, nom, prenom, date_naissance, role, poste, email, password_hash, actif)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        matricule, data.nom.trim(), data.prenom.trim(), data.date_naissance || null,
        data.role, data.poste || null, String(data.email).trim().toLowerCase(),
        bcrypt.hashSync(data.motDePasse, 10), data.actif === false ? 0 : 1,
      ]
    );
    audit({ user: req.user, ip: req.ip }, 'UTILISATEUR_CREE', 'users', res2.lastInsertRowid, { matricule, role: data.role });
    res.status(201).json(get('SELECT id, matricule, nom, prenom, role, poste, email, actif FROM users WHERE id = ?', [res2.lastInsertRowid]));
  })
);

router.put(
  '/:id',
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const u = get('SELECT * FROM users WHERE id = ?', [id]);
    if (!u) throw new ApiError(404, 'Utilisateur introuvable');
    const data = req.body || {};
    validate({ ...u, ...data });

    if (data.email) {
      const dup = get('SELECT id FROM users WHERE lower(email) = ? AND id <> ?', [String(data.email).toLowerCase(), id]);
      if (dup) throw new ApiError(400, 'Cette adresse e-mail est déjà utilisée');
    }
    if (id === req.user.id && data.role && data.role !== 'admin') {
      throw new ApiError(400, 'Vous ne pouvez pas retirer votre propre droit administrateur');
    }

    const champs = {
      nom: data.nom !== undefined ? String(data.nom).trim() : u.nom,
      prenom: data.prenom !== undefined ? String(data.prenom).trim() : u.prenom,
      date_naissance: data.date_naissance !== undefined ? data.date_naissance || null : u.date_naissance,
      role: data.role || u.role,
      poste: data.poste !== undefined ? data.poste : u.poste,
      email: data.email !== undefined ? String(data.email).trim().toLowerCase() : u.email,
      actif: data.actif !== undefined ? (data.actif ? 1 : 0) : u.actif,
    };
    if (champs.actif === 0 && id === req.user.id) throw new ApiError(400, 'Vous ne pouvez pas désactiver votre propre compte');

    run(
      'UPDATE users SET nom = ?, prenom = ?, date_naissance = ?, role = ?, poste = ?, email = ?, actif = ? WHERE id = ?',
      [champs.nom, champs.prenom, champs.date_naissance, champs.role, champs.poste, champs.email, champs.actif, id]
    );
    if (data.motDePasse) {
      if (String(data.motDePasse).length < 6) throw new ApiError(400, 'Mot de passe trop court (6 caractères minimum)');
      run('UPDATE users SET password_hash = ? WHERE id = ?', [bcrypt.hashSync(data.motDePasse, 10), id]);
    }
    audit({ user: req.user, ip: req.ip }, 'UTILISATEUR_MODIFIE', 'users', id, { matricule: u.matricule });
    res.json(get('SELECT id, matricule, nom, prenom, date_naissance, role, poste, email, actif, last_login FROM users WHERE id = ?', [id]));
  })
);

router.delete(
  '/:id',
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const u = get('SELECT * FROM users WHERE id = ?', [id]);
    if (!u) throw new ApiError(404, 'Utilisateur introuvable');
    if (id === req.user.id) throw new ApiError(400, 'Impossible de supprimer votre propre compte');

    const nbAdmins = get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND actif = 1").n;
    if (u.role === 'admin' && nbAdmins <= 1) throw new ApiError(400, 'Impossible de désactiver le dernier administrateur');

    const trace = get(
      'SELECT (SELECT COUNT(*) FROM mouvements WHERE user_id = ?) + (SELECT COUNT(*) FROM bons_commande WHERE created_by = ?) AS n',
      [id, id]
    ).n;

    if (trace > 0) {
      run('UPDATE users SET actif = 0 WHERE id = ?', [id]);
      audit({ user: req.user, ip: req.ip }, 'UTILISATEUR_DESACTIVE', 'users', id, { matricule: u.matricule, motif: 'opérations historiques' });
      return res.json({ ok: true, desactive: true, message: 'Compte désactivé (des opérations sont liées à cet utilisateur)' });
    }

    tx(() => {
      run('DELETE FROM users WHERE id = ?', [id]);
    });
    audit({ user: req.user, ip: req.ip }, 'UTILISATEUR_SUPPRIME', 'users', id, { matricule: u.matricule });
    return res.json({ ok: true, supprime: true });
  })
);

router.post(
  '/:id/mot-de-passe',
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const u = get('SELECT * FROM users WHERE id = ?', [id]);
    if (!u) throw new ApiError(404, 'Utilisateur introuvable');
    const mdp = req.body?.motDePasse;
    if (!mdp || String(mdp).length < 6) throw new ApiError(400, 'Mot de passe requis (6 caractères minimum)');
    run('UPDATE users SET password_hash = ? WHERE id = ?', [bcrypt.hashSync(mdp, 10), id]);
    audit({ user: req.user, ip: req.ip }, 'MOT_DE_PASSE_REINITIALISE', 'users', id, { matricule: u.matricule });
    res.json({ ok: true, message: `Mot de passe réinitialisé pour ${u.matricule}` });
  })
);

module.exports = { router, fmtDate };
