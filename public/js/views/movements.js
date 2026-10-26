import { get, post, download } from '../api.js';
import { esc, fmtN, fmtAr, fmtDate, fmtQ, table, statutBadge, formModal, toast, hasPerm, debounce, badge } from '../ui.js';

const user = () => JSON.parse(sessionStorage.getItem('user') || '{}');
const state = { type: '', debut: '', fin: '', search: '' };

async function movementForm(type) {
  const [arts, types] = await Promise.all([get('/articles?actif=1&limit=500'), get('/movements/types')]);
  const options = arts.rows.map((a) => ({
    value: a.id,
    label: `${a.reference} · ${a.nom} (stock : ${fmtQ(a.stock)} ${a.unite})`,
  }));
  const motifs = types.motifs_sortie;

  formModal({
    title: type === 'ENTREE' ? 'Nouvelle entrée de stock' : 'Nouvelle sortie de stock',
    submitLabel: 'Enregistrer',
    fields: [
      { name: 'article_id', label: 'Article', type: 'select', options, required: true, placeholder: '— Choisir un article —' },
      { name: 'quantite', label: `Quantité ${type === 'ENTREE' ? 'reçue' : 'sortie'}`, type: 'number', min: 1, required: true, value: 1 },
      ...(type === 'ENTREE'
        ? [{ name: 'prix_unitaire', label: 'Prix unitaire (Ar, optionnel)', type: 'number', step: '0.01', min: 0, placeholder: 'Prix de l’article' }]
        : []),
      type === 'SORTIE'
        ? {
            name: 'motif',
            label: 'Motif',
            type: 'select',
            options: motifs,
            value: motifs[0],
            required: true,
          }
        : { name: 'motif', label: 'Motif', placeholder: 'Réapprovisionnement, don, retour...' },
      { name: 'reference_doc', label: 'Réf. document', placeholder: type === 'ENTREE' ? 'BC-0001' : 'Bon de sortie...' },
      { name: 'date', label: 'Date', type: 'date' },
    ],
    async onSubmit(data) {
      await post('/movements', {
        article_id: Number(data.article_id),
        type,
        quantite: Number(data.quantite),
        prix_unitaire: data.prix_unitaire ? Number(data.prix_unitaire) : null,
        motif: data.motif || null,
        reference_doc: data.reference_doc || null,
        date: data.date ? `${data.date} ${new Date().toTimeString().slice(0, 8)}` : null,
      });
      toast(`${type === 'ENTREE' ? 'Entrée' : 'Sortie'} enregistrée`);
      await load();
    },
  });
}

async function load() {
  const params = new URLSearchParams({ limit: 200 });
  Object.entries(state).forEach(([k, v]) => v && params.set(k, v));
  const data = await get(`/movements?${params}`);

  document.getElementById('mv-table').innerHTML = table({
    columns: [
      { key: 'date', label: 'Date', render: (r) => `<div>${fmtDate(r.date)}</div><div class="muted" style="font-size:11.5px">${esc(String(r.date).slice(11, 16))}</div>` },
      { key: 'type', label: 'Type', render: (r) => statutBadge(r.type) },
      { key: 'article', label: 'Article', render: (r) => `<b>${esc(r.article_nom)}</b> <span class="muted">${esc(r.article_reference)}</span>` },
      {
        key: 'quantite',
        label: 'Quantité',
        num: true,
        render: (r) => {
          const sign = r.type === 'SORTIE' ? '−' : r.type === 'ENTREE' ? '+' : '±';
          const color = r.type === 'SORTIE' ? '#dc2626' : r.type === 'ENTREE' ? '#16a34a' : '#7c3aed';
          return `<span style="color:${color};font-weight:700">${sign}${fmtN(r.quantite)}</span> <span class="muted">${esc(r.unite)}</span>`;
        },
      },
      { key: 'stock_apres', label: 'Stock après', num: true, render: (r) => fmtQ(r.stock_apres) },
      { key: 'cout', label: 'Coût', num: true, render: (r) => (r.cout ? fmtAr(r.cout) : '<span class="muted">-</span>') },
      { key: 'motif', label: 'Motif', render: (r) => `${esc(r.motif || '-')}${r.reference_doc ? `<div class="muted" style="font-size:11.5px">${esc(r.reference_doc)}</div>` : ''}` },
      { key: 'user', label: 'Opérateur', render: (r) => (r.matricule ? `${badge(r.matricule, 'neutral')} ${esc(r.user_prenom)} ${esc(r.user_nom)}` : '<span class="muted">-</span>') },
    ],
    rows: data.rows,
    empty: 'Aucun mouvement pour ces critères',
  });

  document.getElementById('mv-count').innerHTML = `<b>${data.total}</b> mouvement(s)`;
}

export default {
  key: 'movements',
  title: 'Entrées & sorties',
  icon: '⇄',
  section: 'Stock',
  roles: ['admin', 'gestionnaire', 'responsable'],
  async render(container) {
    const canWrite = hasPerm(user(), 'movements:write');
    container.innerHTML = `
      <div class="toolbar no-print">
        <input class="input" type="date" id="mv-debut">
        <input class="input" type="date" id="mv-fin">
        <select class="select" id="mv-type">
          <option value="">Tous les types</option>
          <option value="ENTREE">Entrées</option>
          <option value="SORTIE">Sorties</option>
          <option value="CORRECTION">Corrections</option>
        </select>
        <input class="input search" id="mv-search" placeholder="Article, motif, document...">
        <div class="spacer"></div>
        <button class="btn" id="mv-export">Exporter CSV</button>
        ${canWrite ? `
          <button class="btn btn-success" id="mv-in">+ Entrée</button>
          <button class="btn btn-warning" id="mv-out">− Sortie</button>` : ''}
      </div>
      <div class="card">
        <div class="card-header"><h3 id="mv-count"></h3></div>
        <div class="card-body tight" id="mv-table"></div>
      </div>`;

    document.getElementById('mv-debut').onchange = (e) => { state.debut = e.target.value; load(); };
    document.getElementById('mv-fin').onchange = (e) => { state.fin = e.target.value; load(); };
    document.getElementById('mv-type').onchange = (e) => { state.type = e.target.value; load(); };
    document.getElementById('mv-search').oninput = debounce((e) => { state.search = e.target.value; load(); }, 350);
    document.getElementById('mv-export').onclick = () =>
      download(`/movements/export?${new URLSearchParams(state)}`, `mouvements.csv`);
    if (canWrite) {
      document.getElementById('mv-in').onclick = () => movementForm('ENTREE');
      document.getElementById('mv-out').onclick = () => movementForm('SORTIE');
    }
    await load();
  },
};
