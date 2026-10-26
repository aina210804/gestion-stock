const express = require('express');
const { all, get, run, tx } = require('../db/database');
const { ApiError } = require('../utils/errors');
const { requireRole } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { ah, page, round2 } = require('../utils/helpers');

const router = express.Router();
const ECRITURE = ['admin', 'gestionnaire'];
const LECTURE = ['admin', 'gestionnaire', 'responsable'];

// ---------- Catégories ----------
router.get(
  '/categories',
  requireRole(...LECTURE),
  ah(async (req, res) => {
    const rows = all(
      `SELECT c.*, (SELECT COUNT(*) FROM articles a WHERE a.categorie_id = c.id) AS nb_articles
       FROM categories c ORDER BY c.nom`
    );
    res.json({ rows });
  })
);

router.post(
  '/categories',
  requireRole(...ECRITURE),
  ah(async (req, res) => {
    const { nom, description } = req.body || {};
    if (!nom || !String(nom).trim()) throw new ApiError(400, 'Le nom de la catégorie est obligatoire');
    if (get('SELECT id FROM categories WHERE lower(nom) = ?', [String(nom).trim().toLowerCase()])) {
      throw new ApiError(400, 'Cette catégorie existe déjà');
    }
    const r = run('INSERT INTO categories (nom, description) VALUES (?,?)', [String(nom).trim(), description || null]);
    audit({ user: req.user, ip: req.ip }, 'CATEGORIE_CREEE', 'categories', r.lastInsertRowid, { nom });
    res.status(201).json(get('SELECT * FROM categories WHERE id = ?', [r.lastInsertRowid]));
  })
);

router.put(
  '/categories/:id',
  requireRole(...ECRITURE),
  ah(async (req, res) => {
    const id = Number(req.params.id);
    if (!get('SELECT id FROM categories WHERE id = ?', [id])) throw new ApiError(404, 'Catégorie introuvable');
    const { nom, description } = req.body || {};
    if (!nom || !String(nom).trim()) throw new ApiError(400, 'Le nom de la catégorie est obligatoire');
    run('UPDATE categories SET nom = ?, description = ? WHERE id = ?', [String(nom).trim(), description || null, id]);
    audit({ user: req.user, ip: req.ip }, 'CATEGORIE_MODIFIEE', 'categories', id, { nom });
    res.json(get('SELECT * FROM categories WHERE id = ?', [id]));
  })
);

router.delete(
  '/categories/:id',
  requireRole(...ECRITURE),
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const cat = get('SELECT * FROM categories WHERE id = ?', [id]);
    if (!cat) throw new ApiError(404, 'Catégorie introuvable');
    const nb = get('SELECT COUNT(*) AS n FROM articles WHERE categorie_id = ?', [id]).n;
    if (nb > 0) throw new ApiError(400, `Impossible : ${nb} article(s) sont rattachés à cette catégorie`);
    run('DELETE FROM categories WHERE id = ?', [id]);
    audit({ user: req.user, ip: req.ip }, 'CATEGORIE_SUPPRIMEE', 'categories', id, { nom: cat.nom });
    res.json({ ok: true });
  })
);

// ---------- Articles ----------
router.get(
  '/',
  requireRole(...LECTURE),
  ah(async (req, res) => {
    const { search, categorie_id, fournisseur_id, statut, actif } = req.query;
    const { limit, offset } = page(req.query.limit, req.query.offset);
    const where = [];
    const args = [];
    if (search) {
      where.push('(a.nom LIKE ? OR a.reference LIKE ? OR a.description LIKE ?)');
      const s = `%${search}%`;
      args.push(s, s, s);
    }
    if (categorie_id) { where.push('a.categorie_id = ?'); args.push(categorie_id); }
    if (fournisseur_id) { where.push('a.fournisseur_id = ?'); args.push(fournisseur_id); }
    if (actif !== undefined && actif !== '') { where.push('a.actif = ?'); args.push(Number(actif)); }
    if (statut === 'rupture') where.push('a.stock <= 0');
    if (statut === 'bas') where.push('a.stock > 0 AND a.stock <= a.seuil_alerte');
    if (statut === 'ok') where.push('a.stock > a.seuil_alerte');
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = get(`SELECT COUNT(*) AS n FROM articles a ${clause}`, args).n;
    const rows = all(
      `SELECT a.*, c.nom AS categorie_nom, f.nom AS fournisseur_nom,
              CASE WHEN a.stock <= 0 THEN 'RUPTURE'
                   WHEN a.stock <= a.seuil_alerte THEN 'BAS'
                   ELSE 'OK' END AS statut,
              ROUND(a.stock * a.prix_unitaire, 2) AS valeur_stock
       FROM articles a
       LEFT JOIN categories c ON c.id = a.categorie_id
       LEFT JOIN fournisseurs f ON f.id = a.fournisseur_id
       ${clause}
       ORDER BY CASE WHEN a.stock <= 0 THEN 0 WHEN a.stock <= a.seuil_alerte THEN 1 ELSE 2 END, a.nom
       LIMIT ? OFFSET ?`,
      [...args, limit, offset]
    );
    res.json({ total, rows });
  })
);

router.get(
  '/low-stock',
  requireRole(...LECTURE),
  ah(async (req, res) => {
    const rows = all(
      `SELECT a.*, c.nom AS categorie_nom, f.nom AS fournisseur_nom,
              CASE WHEN a.stock <= 0 THEN 'RUPTURE' ELSE 'BAS' END AS statut
       FROM articles a
       LEFT JOIN categories c ON c.id = a.categorie_id
       LEFT JOIN fournisseurs f ON f.id = a.fournisseur_id
       WHERE a.actif = 1 AND a.stock <= a.seuil_alerte
       ORDER BY a.stock * 1.0 / NULLIF(a.seuil_alerte, 0), a.nom`
    );
    res.json({ rows, total: rows.length });
  })
);

router.get(
  '/:id',
  requireRole(...LECTURE),
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const article = get(
      `SELECT a.*, c.nom AS categorie_nom, f.nom AS fournisseur_nom, f.email AS fournisseur_email, f.telephone AS fournisseur_tel
       FROM articles a
       LEFT JOIN categories c ON c.id = a.categorie_id
       LEFT JOIN fournisseurs f ON f.id = a.fournisseur_id
       WHERE a.id = ?`,
      [id]
    );
    if (!article) throw new ApiError(404, 'Article introuvable');
    article.mouvements = all(
      `SELECT m.*, u.matricule, u.nom AS user_nom, u.prenom AS user_prenom
       FROM mouvements m LEFT JOIN users u ON u.id = m.user_id
       WHERE m.article_id = ? ORDER BY m.date DESC LIMIT 30`,
      [id]
    );
    article.alertes = all('SELECT * FROM alertes WHERE article_id = ? ORDER BY created_at DESC LIMIT 20', [id]);
    res.json(article);
  })
);

function validateArticle(data, currentId = null) {
  if (!data.nom || !String(data.nom).trim()) throw new ApiError(400, 'Le nom de l’article est obligatoire');
  const ref = data.reference ? String(data.reference).trim() : null;
  if (!ref) throw new ApiError(400, 'La référence est obligatoire');
  const dup = currentId
    ? get('SELECT id FROM articles WHERE upper(reference) = ? AND id <> ?', [ref.toUpperCase(), currentId])
    : get('SELECT id FROM articles WHERE upper(reference) = ?', [ref.toUpperCase()]);
  if (dup) throw new ApiError(400, `La référence ${ref} est déjà utilisée`);
  if (Number(data.stock_initial) < 0) throw new ApiError(400, 'Le stock initial ne peut pas être négatif');
  if (Number(data.seuil_alerte) < 0) throw new ApiError(400, 'Le seuil d’alerte ne peut pas être négatif');
}

router.post(
  '/',
  requireRole(...ECRITURE),
  ah(async (req, res) => {
    const d = req.body || {};
    validateArticle(d);
    const stockInitial = Number(d.stock_initial) || 0;
    const id = tx(() => {
      const r = run(
        `INSERT INTO articles (reference, nom, description, categorie_id, fournisseur_id, unite, stock, seuil_alerte,
                               stock_cible, prix_unitaire, emplacement, actif)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          String(d.reference).trim(), String(d.nom).trim(), d.description || null,
          d.categorie_id || null, d.fournisseur_id || null, d.unite || 'unité',
          stockInitial, Number(d.seuil_alerte) || 0,
          d.stock_cible ? Number(d.stock_cible) : null,
          round2(Number(d.prix_unitaire) || 0), d.emplacement || null, d.actif === false ? 0 : 1,
        ]
      );
      if (stockInitial > 0) {
        run(
          `INSERT INTO mouvements (article_id, type, quantite, stock_apres, prix_unitaire, cout, motif, user_id)
           VALUES (?, 'ENTREE', ?, ?, ?, ?, 'Stock initial', ?)`,
          [r.lastInsertRowid, stockInitial, stockInitial, Number(d.prix_unitaire) || 0, round2(stockInitial * (Number(d.prix_unitaire) || 0)), req.user.id]
        );
      }
      return r.lastInsertRowid;
    });
    audit({ user: req.user, ip: req.ip }, 'ARTICLE_CREE', 'articles', id, { reference: d.reference, nom: d.nom });
    res.status(201).json(get('SELECT * FROM articles WHERE id = ?', [id]));
  })
);

router.put(
  '/:id',
  requireRole(...ECRITURE),
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const art = get('SELECT * FROM articles WHERE id = ?', [id]);
    if (!art) throw new ApiError(404, 'Article introuvable');
    const d = { ...art, ...req.body };
    validateArticle(d, id);
    if (req.body.stock !== undefined && Number(req.body.stock) !== art.stock) {
      throw new ApiError(400, 'Le stock ne peut pas être modifié ici : utilisez une entrée, une sortie ou un inventaire');
    }
    run(
      `UPDATE articles SET reference = ?, nom = ?, description = ?, categorie_id = ?, fournisseur_id = ?, unite = ?,
              seuil_alerte = ?, stock_cible = ?, prix_unitaire = ?, emplacement = ?, actif = ? WHERE id = ?`,
      [
        String(d.reference).trim(), String(d.nom).trim(), d.description || null,
        d.categorie_id || null, d.fournisseur_id || null, d.unite || 'unité',
        Number(d.seuil_alerte) || 0, d.stock_cible ? Number(d.stock_cible) : null,
        round2(Number(d.prix_unitaire) || 0), d.emplacement || null, d.actif === false ? 0 : 1, id,
      ]
    );
    audit({ user: req.user, ip: req.ip }, 'ARTICLE_MODIFIE', 'articles', id, { reference: art.reference });
    res.json(get('SELECT * FROM articles WHERE id = ?', [id]));
  })
);

router.delete(
  '/:id',
  requireRole(...ECRITURE),
  ah(async (req, res) => {
    const id = Number(req.params.id);
    const art = get('SELECT * FROM articles WHERE id = ?', [id]);
    if (!art) throw new ApiError(404, 'Article introuvable');
    const traces = get('SELECT COUNT(*) AS n FROM mouvements WHERE article_id = ?', [id]).n;
    if (traces > 0) {
      run('UPDATE articles SET actif = 0 WHERE id = ?', [id]);
      audit({ user: req.user, ip: req.ip }, 'ARTICLE_DESACTIVE', 'articles', id, { reference: art.reference });
      return res.json({ ok: true, desactive: true, message: 'Article archivé (il possède un historique de mouvements)' });
    }
    run('DELETE FROM articles WHERE id = ?', [id]);
    audit({ user: req.user, ip: req.ip }, 'ARTICLE_SUPPRIME', 'articles', id, { reference: art.reference });
    res.json({ ok: true });
  })
);

module.exports = { router, LECTURE, ECRITURE };
