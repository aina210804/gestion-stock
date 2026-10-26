require('dotenv').config();
const fs = require('fs');
const { getDb, DB_PATH, all } = require('./database');
const { insertIfEmpty } = require('./seed');
const alertService = require('../services/alertService');
const planningService = require('../services/planning');

const reset = process.argv.includes('--reset');
const only = process.argv.includes('--only-seed');

if (reset && fs.existsSync(DB_PATH)) {
  fs.rmSync(DB_PATH);
  fs.rmSync(`${DB_PATH}-wal`, { force: true });
  fs.rmSync(`${DB_PATH}-shm`, { force: true });
  console.log('[db] Ancienne base supprimée');
}

getDb();
const cree = insertIfEmpty();
console.log(cree ? '[db] Création et alimentation de la base' : '[db] La base contient déjà des données (aucune modification)');
if (!only) {
  alertService.evaluateAll(false);
  planningService.refresh();
  console.log('[db] Alertes et planification calculées');
}
console.log(`[db] Base : ${DB_PATH}`);
console.log(`[db] ${all('SELECT COUNT(*) AS n FROM articles').n} articles, ${all('SELECT COUNT(*) AS n FROM mouvements').n} mouvements, ${all('SELECT COUNT(*) AS n FROM users').n} utilisateurs`);
