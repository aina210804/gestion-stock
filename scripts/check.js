// Vérification du projet : syntaxe de tous les fichiers + test fonctionnel sur base temporaire
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const tmp = path.join(require('os').tmpdir(), `stock-check-${Date.now()}`);
fs.mkdirSync(tmp, { recursive: true });
process.env.DB_PATH = path.join(tmp, 'check.db');

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'data') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith('.js')) acc.push(p);
  }
  return acc;
}

const PUBLIC_DIR = path.join(ROOT, 'public');
const files = walk(ROOT).filter((f) => !f.startsWith(PUBLIC_DIR));
let errors = 0;

console.log(`[check] ${files.length} fichiers JavaScript (backend)...`);
for (const f of files) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (err) {
    errors += 1;
    console.error(`[check][syntaxe] ${path.relative(ROOT, f)}\n${err.stderr}`);
  }
}

// Frontend : modules ES (contrôlés via une copie temporaire en .mjs)
const front = walk(PUBLIC_DIR).filter((f) => f.endsWith('.js'));
console.log(`[check] ${front.length} fichiers JavaScript (frontend)...`);
for (const f of front) {
  const tmpFile = path.join(tmp, `${path.basename(f)}.${Math.random().toString(36).slice(2)}.mjs`);
  fs.copyFileSync(f, tmpFile);
  try {
    execFileSync(process.execPath, ['--check', tmpFile], { stdio: 'pipe' });
  } catch (err) {
    errors += 1;
    console.error(`[check][syntaxe front] ${path.relative(ROOT, f)}\n${err.stderr}`);
  }
}

if (errors === 0) {
  console.log('[check] Syntaxe OK');
  try {
    const { insertIfEmpty } = require(path.join(ROOT, 'src', 'db', 'seed'));
    const alertService = require(path.join(ROOT, 'src', 'services', 'alertService'));
    const planningService = require(path.join(ROOT, 'src', 'services', 'planningService'));
    const forecastService = require(path.join(ROOT, 'src', 'services', 'forecastService'));
    const reportService = require(path.join(ROOT, 'src', 'services', 'reportService'));
    const movementService = require(path.join(ROOT, 'src', 'services', 'movementService'));
    const orderService = require(path.join(ROOT, 'src', 'services', 'orderService'));

    insertIfEmpty();
    alertService.evaluateAll(false);
    planningService.refresh();
    const k = reportService.kpis();
    const f = forecastService.buildForecast({ months: 6 });
    const p = planningService.list({});
    const s = reportService.series();

    console.log(`[check] Articles        : ${k.stock.articles} (valeur ${k.stock.valeur})`);
    console.log(`[check] Alertes         : ${k.alertes.ruptures} rupture(s), ${k.alertes.bas} stock bas`);
    console.log(`[check] Mouvements mois : ${k.mois.nb_mouvements}`);
    console.log(`[check] Prévision 6 mois: ${f.totaux.projections[6]}`);
    console.log(`[check] Planification   : ${p.rows.length} besoins (montant ${p.totaux.montant})`);
    console.log(`[check] Séries graphiques: ${s.mouvements30.length} jours, ${s.mois.length} mois`);
    void movementService;
    void orderService;

    const routes = ['auth', 'users', 'articles', 'movements', 'inventory', 'suppliers', 'orders', 'alerts', 'dashboard', 'forecast', 'planning', 'reports', 'audit', 'notifications', 'settings'];
    for (const r of routes) require(path.join(ROOT, 'src', 'routes', r));
    console.log(`[check] ${routes.length} routes chargées`);

    const bcrypt = require('bcryptjs');
    if (!bcrypt.compareSync('admin123', require(path.join(ROOT, 'src', 'db', 'database')).get("SELECT password_hash FROM users WHERE role = 'admin'").password_hash)) {
      throw new Error('Le mot de passe par défaut ne correspond pas');
    }
    console.log('[check] Authentification bcrypt OK');
    console.log('[check] ✅ Toutes les vérifications sont passées');
  } catch (err) {
    errors += 1;
    console.error('[check][fonctionnel] ÉCHEC :', err.message);
    if (err.stack) console.error(err.stack);
  }
}

try {
  fs.rmSync(tmp, { recursive: true, force: true });
} catch (e) { /* ignore */ }

process.exit(errors ? 1 : 0);
