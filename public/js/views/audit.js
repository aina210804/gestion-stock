import { get, download } from '../api.js';
import { esc, fmtN, fmtDate, fmtDateTime, table, statutBadge, debounce, badge } from '../ui.js';
import { hBars } from '../charts.js';

const state = { search: '', action: '', debut: '', fin: '' };

async function load() {
  const params = new URLSearchParams();
  Object.entries(state).forEach(([k, v]) => v && params.set(k, v));
  const [data, stats] = await Promise.all([get(`/audit?${params}`), get('/audit/stats')]);

  document.getElementById('au-stats').innerHTML = `
    <div class="card kpi"><div class="ico bg-blue">≡</div><div><div class="lib">Opérations journalisées</div>
      <div class="val">${fmtN(stats.total)}</div><div class="sub">traçabilité complète</div></div></div>
    <div class="card kpi" style="grid-column:span 2"><div class="ico bg-cyan">☺</div><div style="flex:1">
      <div class="lib">Activité par utilisateur</div><div id="au-users" style="margin-top:8px"></div></div></div>`;

  hBars(
    document.getElementById('au-users'),
    stats.parUtilisateur.map((u) => ({ label: u.matricule, value: u.nb })),
    { color: ['#2f6fed', '#0891b2', '#7c3aed', '#16a34a', '#d97706'], fmt: (v) => `${fmtN(v)} opérations` }
  );

  document.getElementById('au-table').innerHTML = table({
    columns: [
      { key: 'created_at', label: 'Date / heure', render: (r) => `<div>${fmtDate(r.created_at)}</div><div class="muted" style="font-size:11.5px">${esc(String(r.created_at).slice(11))}</div>` },
      { key: 'action', label: 'Action', render: (r) => badge(r.action, 'info') },
      { key: 'entite', label: 'Entité', render: (r) => (r.entite ? `${esc(r.entite)}${r.entite_id ? ` <span class="muted">#${r.entite_id}</span>` : ''}` : '-') },
      { key: 'utilisateur', label: 'Utilisateur', render: (r) => (r.matricule ? `${badge(r.matricule, 'neutral')} ${esc(r.user_prenom || '')} ${esc(r.user_nom || '')}` : '<span class="muted">système</span>') },
      { key: 'details', label: 'Détails', render: (r) => `<span class="muted" style="font-size:12px">${esc(r.details || '-')}</span>` },
      { key: 'ip', label: 'IP', render: (r) => `<span class="muted">${esc(r.ip || '-')}</span>` },
    ],
    rows: data.rows,
    empty: 'Aucune opération',
  });
  document.getElementById('au-count').innerHTML = `<b>${data.total}</b> opération(s)`;
}

export default {
  key: 'audit',
  title: 'Journal de traçabilité',
  icon: '⚿',
  section: 'Administration',
  roles: ['admin', 'responsable'],
  async render(container) {
    container.innerHTML = `
      <div class="grid grid-3 mb" id="au-stats"></div>
      <div class="toolbar no-print">
        <input class="input" type="date" id="au-debut">
        <input class="input" type="date" id="au-fin">
        <input class="input search" id="au-search" placeholder="Action, entité, utilisateur...">
        <div class="spacer"></div>
        <button class="btn" id="au-export">Exporter CSV</button>
      </div>
      <div class="card"><div class="card-header"><h3 id="au-count"></h3></div>
      <div class="card-body tight" id="au-table"></div></div>`;

    document.getElementById('au-debut').onchange = (e) => { state.debut = e.target.value; load(); };
    document.getElementById('au-fin').onchange = (e) => { state.fin = e.target.value; load(); };
    document.getElementById('au-search').oninput = debounce((e) => { state.search = e.target.value; load(); }, 350);
    document.getElementById('au-export').onclick = () => download('/audit/export', 'journal-traçabilite.csv');
    void statutBadge;
    await load();
  },
};
