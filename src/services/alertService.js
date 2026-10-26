const { all, get, run } = require('../db/database');
const mailService = require('./mailService');

function evaluateArticle(articleId, { notify = true, userId = null } = {}) {
  const art = get(
    `SELECT a.*, c.nom AS categorie_nom FROM articles a LEFT JOIN categories c ON c.id = a.categorie_id WHERE a.id = ?`,
    [articleId]
  );
  if (!art) return null;

  const type = art.stock <= 0 ? 'RUPTURE' : art.stock <= art.seuil_alerte ? 'STOCK_BAS' : null;
  const actives = all('SELECT * FROM alertes WHERE article_id = ? AND statut = ?', [art.id, 'ACTIVE']);

  if (!type) {
    for (const a of actives) resolve(a.id, userId, 'Stock réapprovisionné');
    return null;
  }

  const message =
    type === 'RUPTURE'
      ? `Rupture de stock : ${art.nom} (${art.stock} ${art.unite})`
      : `Stock bas : ${art.nom} - ${art.stock} ${art.unite} restants (seuil ${art.seuil_alerte})`;

  const existante = actives.find((a) => a.type === type) || actives[0];

  if (existante) {
    run('UPDATE alertes SET message = ?, stock = ?, seuil = ?, type = ? WHERE id = ?', [
      message, art.stock, art.seuil_alerte, type, existante.id,
    ]);
    return { ...existante, type, message, stock: art.stock };
  }

  const res = run(
    `INSERT INTO alertes (article_id, type, message, stock, seuil, statut, user_id) VALUES (?,?,?,?,?,'ACTIVE',?)`,
    [art.id, type, message, art.stock, art.seuil_alerte, userId]
  );

  if (notify) {
    mailService.sendStockAlert(art, { type, message }).then((r) => {
      if (r) run('UPDATE alertes SET email_envoye = 1 WHERE id = ?', [res.lastInsertRowid]);
    }).catch((err) => console.error('[alertes] envoi e-mail impossible :', err.message));
  }

  return { id: res.lastInsertRowid, type, message, stock: art.stock };
}

function resolve(alertId, userId = null, motif = null) {
  const alert = get('SELECT * FROM alertes WHERE id = ?', [alertId]);
  if (!alert || alert.statut !== 'ACTIVE') return false;
  run(
    `UPDATE alertes SET statut = 'RESOLUE', resolved_at = datetime('now','localtime'), resolved_by = ?, message = message || ? WHERE id = ?`,
    [userId, motif ? ` (${motif})` : '', alertId]
  );
  return true;
}

function evaluateAll(notify = false) {
  const actifs = all('SELECT id FROM articles WHERE actif = 1');
  let creees = 0;
  for (const a of actifs) {
    const r = evaluateArticle(a.id, { notify });
    if (r) creees += 1;
  }
  return creees;
}

function stats() {
  const rupture = get("SELECT COUNT(*) AS n FROM alertes WHERE statut = 'ACTIVE' AND type = 'RUPTURE'").n;
  const bas = get("SELECT COUNT(*) AS n FROM alertes WHERE statut = 'ACTIVE' AND type = 'STOCK_BAS'").n;
  const articlesRupture = get('SELECT COUNT(*) AS n FROM articles WHERE actif = 1 AND stock <= 0').n;
  const articlesBas = get('SELECT COUNT(*) AS n FROM articles WHERE actif = 1 AND stock > 0 AND stock <= seuil_alerte').n;
  return { rupture, bas, total: rupture + bas, articlesRupture, articlesBas };
}

module.exports = { evaluateArticle, evaluateAll, resolve, stats };
