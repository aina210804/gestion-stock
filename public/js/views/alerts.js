import { get, post } from '../api.js';
import { esc, fmtN, fmtDate, table, statutBadge, toast, debounce, confirmDialog, badge } from '../ui.js';

const state = { statut: 'ACTIVE', type: '', search: '' };

async function load() {
  const params = new URLSearchParams();
  Object.entries(state).forEach(([k, v]) => v && params.set(k, v));
  const [data, resolues] = await Promise.all([
    get(`/alerts?${params}`),
    get('/alerts?statut=RESOLUE&limit=1'),
  ]);
  const s = data.stats;

  document.getElementById('al-stats').innerHTML = `
    <div class="card kpi"><div class="ico bg-red">⊘</div><div>
      <div class="lib">Ruptures de stock</div><div class="val">${fmtN(s.rupture)}</div>
      <div class="sub">${fmtN(s.articlesRupture)} article(s) à zéro</div></div></div>
    <div class="card kpi"><div class="ico bg-orange">⚠</div><div>
      <div class="lib">Stock bas (actifs)</div><div class="val">${fmtN(s.bas)}</div>
      <div class="sub">${fmtN(s.articlesBas)} article(s) sous le seuil</div></div></div>
    <div class="card kpi"><div class="ico bg-green">✓</div><div>
      <div class="lib">Alertes résolues</div><div class="val">${fmtN(resolues.total)}</div>
      <div class="sub">historique des traitements</div></div></div>`;

  document.getElementById('al-table').innerHTML = table({
    columns: [
      { key: 'created_at', label: 'Date', render: (r) => fmtDate(r.created_at) },
      { key: 'type', label: 'Type', render: (r) => statutBadge(r.type) },
      { key: 'article', label: 'Article', render: (r) => `<b>${esc(r.article_nom)}</b> <span class="muted">${esc(r.reference)}</span>` },
      { key: 'message', label: 'Message' },
      { key: 'stock', label: 'Stock / seuil', num: true, render: (r) => `${fmtN(r.stock)} / ${fmtN(r.seuil)}` },
      { key: 'fournisseur', label: 'Fournisseur', render: (r) => esc(r.fournisseur_nom || '-') },
      { key: 'email_envoye', label: 'E-mail', render: (r) => (r.email_envoye ? badge('envoyé', 'ok') : badge('—', 'neutral')) },
      { key: 'statut', label: 'Statut', render: (r) => statutBadge(r.statut) },
    ],
    rows: data.rows,
    empty: 'Aucune alerte',
    actions: (r) => (r.statut === 'ACTIVE' ? `<button class="btn btn-sm btn-success" data-res="${r.id}">Résoudre</button>` : '<span class="muted">—</span>'),
  });

  document.getElementById('al-table').querySelectorAll('[data-res]').forEach((b) => {
    b.onclick = async () => {
      if (!(await confirmDialog('Marquer cette alerte comme résolue ?'))) return;
      try {
        await post(`/alerts/${b.dataset.res}/resoudre`);
        toast('Alerte résolue');
        await load();
      } catch (e) { toast(e.message, 'error'); }
    };
  });
}

export default {
  key: 'alerts',
  title: 'Alertes de stock',
  icon: '⚠',
  section: 'Stock',
  roles: ['admin', 'gestionnaire', 'responsable'],
  async render(container) {
    container.innerHTML = `
      <div class="grid grid-3 mb" id="al-stats"></div>
      <div class="toolbar no-print">
        <select class="select" id="al-statut">
          <option value="ACTIVE">Actives</option>
          <option value="RESOLUE">Résolues</option>
          <option value="">Toutes</option>
        </select>
        <select class="select" id="al-type">
          <option value="">Tous types</option>
          <option value="RUPTURE">Rupture</option>
          <option value="STOCK_BAS">Stock bas</option>
        </select>
        <input class="input search" id="al-search" placeholder="Article, message...">
        <div class="spacer"></div>
        <button class="btn" id="al-check">Recontrôler le stock</button>
      </div>
      <div class="card"><div class="card-body tight" id="al-table"></div></div>`;

    document.getElementById('al-statut').onchange = (e) => { state.statut = e.target.value; load(); };
    document.getElementById('al-type').onchange = (e) => { state.type = e.target.value; load(); };
    document.getElementById('al-search').oninput = debounce((e) => { state.search = e.target.value; load(); }, 350);
    document.getElementById('al-check').onclick = async (e) => {
      e.target.disabled = true;
      try {
        const r = await post('/alerts/check');
        toast(r.nouvelles_alertes ? `${r.nouvelles_alertes} nouvelle(s) alerte(s)` : 'Stock à jour : aucune nouvelle alerte');
        await load();
      } catch (err) { toast(err.message, 'error'); }
      e.target.disabled = false;
    };
    await load();
  },
};
