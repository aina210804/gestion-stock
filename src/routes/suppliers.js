const express = require('express');
const { all, get, run } = require('../db/database');
const { ApiError } = require('../utils/errors');
const { requireRole } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { ah, page, round2 } = require('../utils/helpers');

const router = express.Router();
const LECTURE = ['admin', 'gestionnaire', 'responsable'];
const ECRITURE = ['admin', 'gestionnaire'];

router.get(
  '/',
  requireRole(...LECTURE),
  ah(async (req, res) => {
    const { search, actif } = req.query;
    const { limit, offset } = page(req.query.limit, req.query.offset);
    const where = [];
    const args = [];
    if (search) {
      where.push('(f.nom LIKE ? OR f.contact LIKE ? OR f.email LIKE ? OR f.ville LIKE ?)');
      const s = `%${search}%`;
      args.push(s, s, s, s);
    }
    if (actif !== undefined && actif !== '') { where.push('f.actif = ?'); args.push(Number(actif)); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = get(`SELECT COUNT(*) AS n FROM fournisseurs f ${clause}`, args).n;
    const rows = all(
      `SELECT f.*,
              (SELECT COUNT(*) FROM articles a WHERE a.fournisseur_id = f.id) AS nb_articles,
              (SELECT COUNT(*) FROM bons_commande b WHERE b.fournisseur_id = f.id) AS nb_commandes,
              (SELECT COALESCE(SUM(total), 0) FROM bons_commande b WHERE b.fournisseur_id = f.id AND b.statut <> 'ANNULEE') AS montant_total
       FROM fournisseurs f
       ${clause}
       ORDER BY f.nom LIMIT ? OFFSET ?`,
      [...args, limit, offset]
    );
    res.json({ total, rows: rows.map((r) => ({ ...r, montant_total: round2(r.montant_total) })) });
  })
);

router.get(
  '/:id',
  requireRole(...LECTURE),
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const f = get('SELECT * FROM fournisseurs WHERE id = ?', [id]);
    if (!f) throw new ApiError(404, 'Fournisseur introuvable');
    f.articles = all('SELECT id, reference, nom, stock, prix_unitaire FROM articles WHERE fournisseur_id = ? ORDER BY nom', [id]);
    f.commandes = all(
      `SELECT b.id, b.numero, b.date_commande, b.statut, b.total
       FROM bons_commande b WHERE b.fournisseur_id = ? ORDER BY b.id DESC LIMIT 20`,
      [id]
    );
    res.json(f);
  })
);

function validate(data) {
  if (!data.nom || !String(data.nom).trim()) throw new ApiError(400, 'Le nom du fournisseur est obligatoire');
  if (data.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) throw new ApiError(400, 'Adresse e-mail invalide');
}

router.post(
  '/',
  requireRole(...ECRITURE),
  ah(async (req, res) => {
    const d = req.body || {};
    validate(d);
    const r = run(
      `INSERT INTO fournisseurs (nom, contact, email, telephone, adresse, ville, notes, actif)
       VALUES (?,?,?,?,?,?,?,?)`,
      [String(d.nom).trim(), d.contact || null, d.email || null, d.telephone || null, d.adresse || null, d.ville || null, d.notes || null, d.actif === false ? 0 : 1]
    );
    audit({ user: req.user, ip: req.ip }, 'FOURNISSEUR_CREE', 'fournisseurs', r.lastInsertRowid, { nom: d.nom });
    res.status(201).json(get('SELECT * FROM fournisseurs WHERE id = ?', [r.lastInsertRowid]));
  })
);

router.put(
  '/:id',
  requireRole(...ECRITURE),
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const f = get('SELECT * FROM fournisseurs WHERE id = ?', [id]);
    if (!f) throw new ApiError(404, 'Fournisseur introuvable');
    const d = { ...f, ...req.body };
    validate(d);
    run(
      `UPDATE fournisseurs SET nom = ?, contact = ?, email = ?, telephone = ?, adresse = ?, ville = ?, notes = ?, actif = ? WHERE id = ?`,
      [String(d.nom).trim(), d.contact || null, d.email || null, d.telephone || null, d.adresse || null, d.ville || null, d.notes || null, d.actif === false ? 0 : 1, id]
    );
    audit({ user: req.user, ip: req.ip }, 'FOURNISSEUR_MODIFIE', 'fournisseurs', id, { nom: d.nom });
    res.json(get('SELECT * FROM fournisseurs WHERE id = ?', [id]));
  })
);

router.delete(
  '/:id',
  requireRole(...ECRITURE),
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const f = get('SELECT * FROM fournisseurs WHERE id = ?', [id]);
    if (!f) throw new ApiError(404, 'Fournisseur introuvable');
    const lie = get(
      'SELECT (SELECT COUNT(*) FROM articles WHERE fournisseur_id = ?) + (SELECT COUNT(*) FROM bons_commande WHERE fournisseur_id = ?) AS n',
      [id, id]
    ).n;
    if (lie > 0) {
      run('UPDATE fournisseurs SET actif = 0 WHERE id = ?', [id]);
      audit({ user: req.user, ip: req.ip }, 'FOURNISSEUR_DESACTIVE', 'fournisseurs', id, { nom: f.nom });
      return res.json({ ok: true, desactive: true, message: 'Fournisseur archivé (des liens existent)' });
    }
    run('DELETE FROM fournisseurs WHERE id = ?', [id]);
    audit({ user: req.user, ip: req.ip }, 'FOURNISSEUR_SUPPRIME', 'fournisseurs', id, { nom: f.nom });
    res.json({ ok: true });
  })
);

module.exports = { router };
