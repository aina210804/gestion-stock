import { get, post } from './api.js';
import { esc, toast } from './ui.js';

import dashboard from './views/dashboard.js';
import articles from './views/articles.js';
import movements from './views/movements.js';
import inventory from './views/inventory.js';
import alerts from './views/alerts.js';
import suppliers from './views/suppliers.js';
import orders from './views/orders.js';
import planning from './views/planning.js';
import forecast from './views/forecast.js';
import reports from './views/reports.js';
import notifications from './views/notifications.js';
import users from './views/users.js';
import audit from './views/audit.js';
import settings from './views/settings.js';

const VIEWS = [
  dashboard, articles, movements, inventory, alerts,
  suppliers, orders, planning,
  forecast, reports,
  notifications, users, audit, settings,
];

let user = null;

function visibleViews() {
  return VIEWS.filter((v) => v.roles.includes(user.role));
}

function buildNav() {
  const nav = document.getElementById('nav');
  const groups = {};
  visibleViews().forEach((v) => {
    (groups[v.section] = groups[v.section] || []).push(v);
  });
  nav.innerHTML = Object.entries(groups)
    .map(
      ([section, items]) => `
      <div class="nav-section">${esc(section)}</div>
      ${items
        .map(
          (v) => `<a class="nav-item" href="#/${v.key}" data-key="${v.key}">
            <span class="ico">${v.icon}</span><span>${esc(v.title)}</span>
            <span class="nav-count" data-count="${v.key}" hidden></span>
          </a>`
        )
        .join('')}`
    )
    .join('');
}

async function refreshBadges() {
  try {
    const s = await get('/alerts/count');
    const total = Number(s.total) || 0;
    const badgeTop = document.getElementById('alerts-badge');
    badgeTop.hidden = total === 0;
    badgeTop.textContent = `⚠ ${total} alerte(s)`;
    const badgeNav = document.querySelector('[data-count="alerts"]');
    if (badgeNav) {
      badgeNav.hidden = total === 0;
      badgeNav.textContent = total;
    }
  } catch (e) { /* session expirée */ }
}

async function route() {
  const hash = location.hash.replace(/^#\/?/, '') || 'dashboard';
  const [key, param] = hash.split('/');
  const view = VIEWS.find((v) => v.key === key);
  const content = document.getElementById('content');
  const title = document.getElementById('page-title');

  document.querySelectorAll('.nav-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.key === key);
  });

  if (!view || !view.roles.includes(user.role)) {
    title.textContent = 'Accès refusé';
    content.innerHTML = `<div class="card"><div class="empty">
      Vous n’avez pas les droits nécessaires pour accéder à cette page.<br>
      <a href="#/dashboard">Retour au tableau de bord</a></div></div>`;
    return;
  }

  title.textContent = view.title;
  content.innerHTML = '<div class="empty">Chargement...</div>';
  try {
    await view.render(content, param);
  } catch (err) {
    content.innerHTML = `<div class="card"><div class="empty">
      <b>Erreur de chargement</b><br>${esc(err.message)}<br><br>
      <button class="btn" onclick="location.reload()">Réessayer</button></div></div>`;
  }
  window.scrollTo({ top: 0 });
}

async function init() {
  try {
    const me = await get('/auth/me');
    user = me.user;
  } catch (e) {
    return; // redirection déjà effectuée
  }
  sessionStorage.setItem('user', JSON.stringify(user));
  document.getElementById('sidebar-user').innerHTML = `
    <div><b style="color:#fff">${esc(user.prenom)} ${esc(user.nom)}</b></div>
    <div class="role">${esc(user.matricule)} · ${esc(user.role)}</div>`;
  document.getElementById('topbar-user').textContent = `${user.prenom} ${user.nom}`;

  buildNav();
  await refreshBadges();
  setInterval(refreshBadges, 60000);

  window.addEventListener('hashchange', route);
  await route();
}

document.getElementById('btn-logout').onclick = async () => {
  try { await post('/auth/logout'); } catch (e) { /* ignore */ }
  sessionStorage.removeItem('user');
  location.href = '/';
};

document.getElementById('toggle-sidebar').onclick = () => {
  document.getElementById('sidebar').classList.toggle('open');
};

document.getElementById('nav')?.addEventListener('click', () => {
  document.getElementById('sidebar').classList.remove('open');
});

init();
