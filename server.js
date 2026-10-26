require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const { getDb, DB_PATH } = require('./src/db/database');
const { insertIfEmpty } = require('./src/db/seed');
const alertService = require('./src/services/alertService');
const planningService = require('./src/services/planningService');
const { ApiError } = require('./src/utils/errors');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || 'localhost';
const PUBLIC_DIR = path.join(__dirname, 'public');

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    name: 'stock.sid',
    secret: process.env.SESSION_SECRET || 'secret-dev-a-changer',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: String(process.env.SESSION_SECURE) === '1',
      maxAge: (Number(process.env.SESSION_MAX_HOURS) || 8) * 3600 * 1000,
    },
  })
);

// ---------- API ----------
app.use('/api/auth', require('./src/routes/auth').router);
app.use('/api/users', require('./src/routes/users').router);
app.use('/api/articles', require('./src/routes/articles').router);
app.use('/api/movements', require('./src/routes/movements').router);
app.use('/api/inventory', require('./src/routes/inventory').router);
app.use('/api/suppliers', require('./src/routes/suppliers').router);
app.use('/api/orders', require('./src/routes/orders').router);
app.use('/api/alerts', require('./src/routes/alerts').router);
app.use('/api/dashboard', require('./src/routes/dashboard').router);
app.use('/api/forecast', require('./src/routes/forecast').router);
app.use('/api/planning', require('./src/routes/planning').router);
app.use('/api/reports', require('./src/routes/reports').router);
app.use('/api/audit', require('./src/routes/audit').router);
app.use('/api/notifications', require('./src/routes/notifications').router);
app.use('/api/settings', require('./src/routes/settings').router);

app.use('/api', (req, res) => res.status(404).json({ error: 'Route API introuvable' }));

// ---------- Front ----------
app.use(express.static(PUBLIC_DIR));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  return res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// ---------- Erreurs ----------
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Corps de requête JSON invalide' });
  }
  console.error('[erreur]', err && err.stack ? err.stack : err);
  return res.status(500).json({ error: 'Erreur interne du serveur' });
});

function start() {
  getDb();
  const cree = insertIfEmpty();
  if (cree) console.log('[db] Base initialisée avec les données de démonstration');
  alertService.evaluateAll(false);
  planningService.refresh();
  app.listen(PORT, HOST, () => {
    console.log('----------------------------------------------');
    console.log('  Gestion de stock des consommables');
    console.log(`  URL       : http://${HOST}:${PORT}`);
    console.log(`  Base      : ${DB_PATH}`);
    console.log('  Comptes   : admin@entreprise.local / admin123');
    console.log('              stock@entreprise.local / stock123');
    console.log('              resp@entreprise.local  / resp123');
    console.log('----------------------------------------------');
  });
}

start();

module.exports = { app, start };
