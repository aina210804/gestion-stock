const express = require('express');
const { all, get } = require('../db/database');
const { requireRole } = require('../middleware/auth');
const { ah, page, toCSV } = require('../utils/helpers');

const router = express.Router();

router.get(
  '/',
  requireRole('admin', 'responsable'),
  ah(async (req, res) => {
    const { search, action, user_id, debut, fin } = req.query;
    const { limit, offset } = page(req.query.limit, req.query.offset);
    const where = [];
    const args = [];
    if (search) {
      where.push('(l.action LIKE ? OR l.entite LIKE ? OR l.details LIKE ? OR l.matricule LIKE ?)');
      const s = `%${search}%`;
      args.push(s, s, s, s);
    }
    if (action) { where.push('l.action = ?'); args.push(action); }
    if (user_id) { where.push('l.user_id = ?'); args.push(user_id); }
    if (debut) { where.push('l.created_at >= ?'); args.push(`${debut} 00:00:00`); }
    if (fin) { where.push('l.created_at <= ?'); args.push(`${fin} 23:59:59`); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = get(`SELECT COUNT(*) AS n FROM audit_logs l ${clause}`, args).n;
    const rows = all(
      `SELECT l.*, u.nom AS user_nom, u.prenom AS user_prenom, u.role AS user_role
       FROM audit_logs l
       LEFT JOIN users u ON u.id = l.user_id
       ${clause}
       ORDER BY l.id DESC
       LIMIT ? OFFSET ?`,
      [...args, limit, offset]
    );
    res.json({ total, rows });
  })
);

router.get(
  '/actions',
  requireRole('admin', 'responsable'),
  ah(async (req, res) => {
    const rows = all('SELECT action, COUNT(*) AS nb FROM audit_logs GROUP BY action ORDER BY action');
    res.json({ rows });
  })
);

router.get(
  '/export',
  requireRole('admin', 'responsable'),
  ah(async (req, res) => {
    const rows = all(
      `SELECT l.created_at AS date, l.action, l.entite, l.entite_id, COALESCE(l.matricule,'') AS matricule,
              COALESCE(u.prenom || ' ' || u.nom, '') AS utilisateur, l.details, l.ip
       FROM audit_logs l LEFT JOIN users u ON u.id = l.user_id
       ORDER BY l.id DESC LIMIT 5000`
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="journal_traçabilite.csv"`);
    res.send(toCSV(rows));
  })
);

router.get(
  '/stats',
  requireRole('admin', 'responsable'),
  ah(async (req, res) => {
    const parUtilisateur = all(
      `SELECT COALESCE(matricule, 'ANONYME') AS matricule, COUNT(*) AS nb
       FROM audit_logs GROUP BY matricule ORDER BY nb DESC LIMIT 10`
    );
    const parJour = all(
      `SELECT date(created_at) AS jour, COUNT(*) AS nb FROM audit_logs
       WHERE created_at >= date('now','localtime','-30 day')
       GROUP BY jour ORDER BY jour`
    );
    res.json({ parUtilisateur, parJour, total: get('SELECT COUNT(*) AS n FROM audit_logs').n });
  })
);

module.exports = { router };
