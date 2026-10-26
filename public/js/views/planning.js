import { get, post, download } from '../api.js';
import { esc, fmtN, fmtAr, fmtDate, fmtQ, table, statutBadge, toast, confirmDialog, hasPerm } from '../ui.js';

let data = null;

async function refresh(auto = false) {
  if (!auto) {
    const ok = await confirmDialog('Recalculer le plan d’approvisionnement à partir de la consommation des 6 derniers mois ?', { danger: false, confirmLabel: 'Actualiser' });
    if (!ok) return;
  }
  toast('Calcul en cours...', 'warning', 1500);
  data = await post('/planning/refresh', {});
  draw();
}

async function createOrders() {
  const ids = [...document.querySelectorAll('[data-cb]:checked')].map((cb) => Number(cb.dataset.cb));
  if (!ids.length) return toast('Sélectionnez au moins un besoin', 'warning');
  const ok = await confirmDialog(`Créer ${ids.length} ligne(s) de commande ? Un brouillon de bon de commande sera généré par fournisseur.`, { confirmLabel: 'Générer' });
  if (!ok) return;
  try {
    const res = await post('/planning/commandes', { article_ids: ids });
    toast(`${res.commandes.length} bon(s) de commande créé(s) : ${res.commandes.map((c) => c.numero).join(', ')}`);
    data = { rows: res.rows, totaux: res.totaux, parametres: res.parametres };
    draw();
  } catch (e) { toast(e.message, 'error'); }
}

function draw() {
  const rows = data.rows;
  const t = data.totaux;

  document.getElementById('pl-stats').innerHTML = `
    <div class="card kpi"><div class="ico bg-red">▲</div><div><div class="lib">Priorité haute</div>
      <div class="val">${fmtN(t.HAUTE)}</div><div class="sub">à commander immédiatement</div></div></div>
    <div class="card kpi"><div class="ico bg-orange">◆</div><div><div class="lib">Priorité moyenne</div>
      <div class="val">${fmtN(t.MOYENNE)}</div><div class="sub">à surveiller</div></div></div>
    <div class="card kpi"><div class="ico bg-blue">≡</div><div><div class="lib">Besoins bas</div>
      <div class="val">${fmtN(t.BASSE)}</div><div class="sub">planifiés</div></div></div>
    <div class="card kpi"><div class="ico bg-green">Ar</div><div><div class="lib">Montant estimé</div>
      <div class="val">${fmtAr(t.montant)}</div><div class="sub">horizon ${data.parametres.horizon} mois · délai ${data.parametres.delai} j</div></div></div>`;

  document.getElementById('pl-table').innerHTML = table({
    columns: [
      {
        key: 'cb',
        label: '',
        render: (r) =>
          r.statut === 'A_COMMANDER'
            ? `<input type="checkbox" data-cb="${r.article_id}">`
            : '',
      },
      { key: 'priorite', label: 'Priorité', render: (r) => statutBadge(r.priorite) },
      { key: 'article', label: 'Article', render: (r) => `<b>${esc(r.article_nom)}</b> <span class="muted">${esc(r.reference)}</span><div class="muted" style="font-size:11.5px">${esc(r.raison)}</div>` },
      { key: 'fournisseur', label: 'Fournisseur', render: (r) => esc(r.fournisseur_nom || '-') },
      { key: 'stock', label: 'Stock', num: true, render: (r) => `${fmtQ(r.stock)}<div class="muted" style="font-size:11px">seuil ${fmtQ(r.seuil_alerte)}</div>` },
      { key: 'conso_mensuelle', label: 'Conso./mois', num: true, render: (r) => fmtQ(r.conso_mensuelle) },
      { key: 'jours_couverture', label: 'Couverture', num: true, render: (r) => (r.jours_couverture >= 9999 ? '∞' : `${fmtN(r.jours_couverture)} j`) },
      { key: 'quantite_suggeree', label: 'Qté suggérée', num: true, render: (r) => `<b>${fmtN(r.quantite_suggeree)}</b> ${esc(r.unite)}` },
      { key: 'montant_estime', label: 'Montant', num: true, render: (r) => fmtAr(r.montant_estime) },
      { key: 'besoin_le', label: 'Commander avant', render: (r) => `<b>${fmtDate(r.besoin_le)}</b>` },
      { key: 'statut', label: 'Statut', render: (r) => statutBadge(r.statut) },
    ],
    rows,
    empty: 'Aucun besoin de réapprovisionnement : les stocks sont suffisants',
    actions: (r) => (r.commande_numero ? `<a href="#/orders" class="badge info">${esc(r.commande_numero)}</a>` : '<span class="muted">—</span>'),
  });

  const cbAll = document.getElementById('pl-all');
  if (cbAll) {
    cbAll.onchange = () => {
      document.querySelectorAll('[data-cb]').forEach((cb) => { cb.checked = cbAll.checked; });
    };
  }
}

export default {
  key: 'planning',
  title: 'Approvisionnements',
  icon: '◉',
  section: 'Achats',
  roles: ['admin', 'gestionnaire', 'responsable'],
  async render(container) {
    const canManage = hasPerm(userSession(), 'planning:manage');
    data = await get('/planning');
    container.innerHTML = `
      <div class="grid grid-4 mb" id="pl-stats"></div>
      <div class="toolbar no-print">
        <span class="hint">Besoins classés par priorité selon la consommation, le seuil et le délai fournisseur.</span>
        <div class="spacer"></div>
        <button class="btn" id="pl-export">Exporter CSV</button>
        ${canManage ? '<button class="btn" id="pl-refresh">↺ Actualiser le calcul</button>' : ''}
        ${canManage ? '<button class="btn btn-primary" id="pl-order">.CreateCommandes sélectionnées</button>' : ''}
      </div>
      <div class="card">
        <div class="card-header">
          <label class="hint"><input type="checkbox" id="pl-all"> Tout sélectionner</label>
          <h3>${data.rows.length} besoin(s)</h3>
        </div>
        <div class="card-body tight" id="pl-table"></div>
      </div>`;
    draw();
    document.getElementById('pl-export').onclick = () => download('/planning/export', 'approvisionnements.csv');
    const r = document.getElementById('pl-refresh');
    if (r) r.onclick = () => refresh(false);
    const o = document.getElementById('pl-order');
    if (o) { o.textContent = 'Générer les bons de commande'; o.onclick = createOrders; }
  },
};

function userSession() {
  return JSON.parse(sessionStorage.getItem('user') || '{}');
}
