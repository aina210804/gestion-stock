import { get, post } from '../api.js';
import { esc, fmtDateTime, table, badge, toast, debounce, hasPerm, fmtN } from '../ui.js';

const state = { statut: '', type: '', search: '' };

async function load() {
  const params = new URLSearchParams();
  Object.entries(state).forEach(([k, v]) => v && params.set(k, v));
  const [data, mode] = await Promise.all([get(`/notifications?${params}`), get('/notifications/mode')]);

  document.getElementById('nt-stats').innerHTML = `
    <div class="card kpi"><div class="ico ${mode.smtp_configure ? 'bg-green' : 'bg-orange'}">${mode.smtp_configure ? '✉' : '☲'}</div>
      <div><div class="lib">Mode d’envoi</div>
      <div class="val" style="font-size:17px">${mode.smtp_configure ? 'SMTP réel' : 'Simulation'}</div>
      <div class="sub">${esc(mode.message)}</div></div></div>
    <div class="card kpi"><div class="ico bg-green">✓</div><div><div class="lib">E-mails envoyés</div>
      <div class="val">${fmtN(data.stats.envoyes)}</div><div class="sub">via ${esc(mode.smtp_host || 'aucun serveur SMTP')}</div></div></div>
    <div class="card kpi"><div class="ico bg-grey">▤</div><div><div class="lib">Journalisés</div>
      <div class="val">${fmtN(data.total)}</div><div class="sub">destinataire : ${esc(mode.destinataire_alertes || '-')}</div></div></div>`;

  document.getElementById('nt-table').innerHTML = table({
    columns: [
      { key: 'created_at', label: 'Date', render: (r) => fmtDateTime(r.created_at) },
      { key: 'type', label: 'Type', render: (r) => badge(r.type, 'info') },
      { key: 'destinataire', label: 'Destinataire' },
      { key: 'sujet', label: 'Sujet', render: (r) => `<b>${esc(r.sujet)}</b><div class="muted" style="font-size:11.5px;white-space:pre-line">${esc(String(r.corps).slice(0, 110))}${String(r.corps).length > 110 ? '…' : ''}</div>` },
      { key: 'statut', label: 'Statut', render: (r) => (r.statut === 'ERREUR' ? badge('erreur', 'danger') : r.statut === 'ENVOYE' ? badge('envoyé', 'ok') : badge('simulé', 'neutral')) },
      { key: 'erreur', label: 'Erreur', render: (r) => (r.erreur ? `<span style="color:#dc2626;font-size:12px">${esc(r.erreur)}</span>` : '<span class="muted">-</span>') },
    ],
    rows: data.rows,
    empty: 'Aucune notification',
  });
}

export default {
  key: 'notifications',
  title: 'Notifications e-mail',
  icon: '✉',
  section: 'Administration',
  roles: ['admin', 'gestionnaire', 'responsable'],
  async render(container) {
    const user = JSON.parse(sessionStorage.getItem('user') || '{}');
    container.innerHTML = `
      <div class="grid grid-3 mb" id="nt-stats"></div>
      <div class="toolbar no-print">
        <select class="select" id="nt-statut">
          <option value="">Tous statuts</option>
          <option value="ENVOYE">Envoyés</option>
          <option value="SIMULE">Simulés</option>
          <option value="ERREUR">Erreurs</option>
        </select>
        <select class="select" id="nt-type">
          <option value="">Tous types</option>
          <option value="ALERTE_STOCK">Alerte de stock</option>
          <option value="BON_COMMANDE">Bon de commande</option>
          <option value="TEST">Test</option>
          <option value="SYSTEME">Système</option>
        </select>
        <input class="input search" id="nt-search" placeholder="Sujet, destinataire...">
        <div class="spacer"></div>
        ${hasPerm(user, '*') ? `
          <button class="btn" id="nt-check">Vérifier la configuration SMTP</button>
          <button class="btn btn-primary" id="nt-test">Envoyer un e-mail de test</button>` : ''}
      </div>
      <div class="card mb" id="nt-warning" hidden></div>
      <div class="card"><div class="card-body tight" id="nt-table"></div></div>`;

    const warn = document.getElementById('nt-warning');
    const data0 = await get('/notifications/mode');
    if (!data0.smtp_configure) {
      warn.hidden = false;
      warn.innerHTML = `<div class="card-body" style="display:flex;gap:12px;align-items:center">
        <span class="badge warn">mode simulation</span>
        <span class="hint">${esc(data0.message)}</span></div>`;
    } else if (!data0.smtp_pass_renseigne || !data0.from) {
      warn.hidden = false;
      warn.innerHTML = `<div class="card-body" style="display:flex;gap:12px;align-items:center">
        <span class="badge danger">configuration incomplète</span>
        <span class="hint">${esc(data0.message)}</span></div>`;
    }

    const checkBtn = document.getElementById('nt-check');
    if (checkBtn) {
      checkBtn.onclick = async () => {
        checkBtn.disabled = true;
        checkBtn.textContent = 'Connexion au serveur...';
        try {
          const r = await post('/notifications/verifier', {});
          toast(r.message, r.ok ? 'success' : 'error', 5000);
        } catch (e) { toast(e.message, 'error'); }
        checkBtn.disabled = false;
        checkBtn.textContent = 'Vérifier la configuration SMTP';
      };
    }

    document.getElementById('nt-statut').onchange = (e) => { state.statut = e.target.value; load(); };
    document.getElementById('nt-type').onchange = (e) => { state.type = e.target.value; load(); };
    document.getElementById('nt-search').oninput = debounce((e) => { state.search = e.target.value; load(); }, 350);
    const btn = document.getElementById('nt-test');
    if (btn) {
      btn.onclick = async () => {
        btn.disabled = true;
        try {
          const r = await post('/notifications/test', {});
          toast(`E-mail ${r.mode === 'SMTP' ? 'envoyé' : 'simulé'} vers ${r.notification.destinataire}`);
          await load();
        } catch (e) { toast(e.message, 'error'); }
        btn.disabled = false;
      };
    }
    await load();
  },
};
