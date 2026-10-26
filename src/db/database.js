const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DB_PATH = path.isAbsolute(process.env.DB_PATH || '')
  ? process.env.DB_PATH
  : path.join(ROOT, process.env.DB_PATH || path.join('data', 'stock.db'));

let db = null;

function getDb() {
  if (db) return db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  return db;
}

function all(sql, params = []) {
  return getDb().prepare(sql).all(...params).map((r) => ({ ...r }));
}

function get(sql, params = []) {
  const row = getDb().prepare(sql).get(...params);
  return row ? { ...row } : null;
}

function run(sql, params = []) {
  const info = getDb().prepare(sql).run(...params);
  return { changes: Number(info.changes), lastInsertRowid: Number(info.lastInsertRowid) };
}

let txDepth = 0;

// Transaction ré-entrant : un tx() imbriqué s'exécute dans la transaction englobante
function tx(fn) {
  const database = getDb();
  if (txDepth > 0) return fn();
  txDepth += 1;
  database.exec('BEGIN');
  try {
    const result = fn();
    database.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      database.exec('ROLLBACK');
    } catch (e) {
      /* ignore */
    }
    throw err;
  } finally {
    txDepth -= 1;
  }
}

const bool = (v) => (v ? 1 : 0);

module.exports = { getDb, all, get, run, tx, bool, DB_PATH, ROOT };
