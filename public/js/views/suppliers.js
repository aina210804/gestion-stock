import { get, post, put, del } from '../api.js';
import { esc, fmtAr, fmtN, table, modal, closeModal, formModal, confirmDialog, toast, hasPerm, debounce, badge } from '../ui.js';

const user = () => JSON.parse(sessionStorage.getItem('user') || '{}');
const state = { search: '' };

function supplierForm(f = null) {
  formModal({
    title: f ? `Modifier ${f.nom}` : 'Nouveau fournisseur',
    fields: [
      { name: 'nom', label: 'Raison sociale', value: f?.nom, required: true },
      { name: 'contact', label: 'Contact', value: f?.contact || '' },
      { name: 'email', label: 'E-mail', type: 'email', value: f?.email || '' },
      { name: 'telephone', label: 'Téléphone', value: f?.telephone || '' },
      { name: 'adresse', label: 'Adresse', value: f?.adresse || '' },
      { name: 'ville', label: 'Ville', value: f?.ville || '' },
      { name: 'notes', label: 'Notes', type: 'textarea', value: f?.notes || '', span: 2 },
    ],
    async onSubmit(data) {
      if (f) await put(`/suppliers/${f.id}`, data);
      else await post('/suppliers', data);
      toast(f ? 'Fournisseur modifié' : 'Fournisseur créé');
      await load();
    },
  });
}

async function detail(id) {
  const f = await get(`/suppliers/${id}`);
  modal({
    title: f.nom,
    wide: true,
    body: `
      <div class="detail-grid mb">
        <div><div class="k">Contact</div><div class="v">${esc(f.contact || '-')}</div></div>
        <div><div class="k">E-mail</div><div class="v">${esc(f.email || '-')}</div></div>
        <div><div class="k">Téléphone</div><div class="v">${esc(f.telephone || '-')}</div></div>
        <div><div class="k">Ville</div><div class="v">${esc(f.ville || '-')}</div></div>
        <div><div class="k">Articles fournis</div><div class="v">${f.articles.length}</div></div>
        <div><div class="k">Montant commandé</div><div class="v">${fmtAr(f.commandes.reduce((s, c) => s + c.total, 0))}</div></div>
      </div>
      ${f.notes ? `<p class="hint">${esc(f.notes)}</p>` : ''}
      <div class="section-title">Articles référencés</div>
      ${table({
        columns: [
          { key: 'reference', label: 'Référence' },
          { key: 'nom', label: 'Article' },
          { key: 'stock', label: 'Stock', num: true },
          { key: 'prix_unitaire', label: 'Prix', num: true, render: (r) => fmtAr(r.prix_unitaire) },
        ],
        rows: f.articles,
        empty: 'Aucun article',
      })}
      <div class="section-title">Commandes récentes</div>
      ${table({
        columns: [
          { key: 'numero', label: 'N°' },
          { key: 'date_commande', label: 'Date' },
          { key: 'statut', label: 'Statut', render: (r) => badge(r.statut, 'info') },
          { key: 'total', label: 'Total', num: true, render: (r) => fmtAr(r.total) },
        ],
        rows: f.commandes,
        empty: 'Aucune commande',
      })}`,
    footer: '<button class="btn" id="sf-close">Fermer</button>',
    onOpen(root) { root.querySelector('#sf-close').onclick = closeModal; },
  });
}

async function load() {
  const params = new URLSearchParams({ limit: 200 });
  if (state.search) params.set('search', state.search);
  const data = await get(`/suppliers?${params}`);
  document.getElementById('fr-table').innerHTML = table({
    columns: [
      { key: 'nom', label: 'Fournisseur', render: (r) => `<b>${esc(r.nom)}</b>${r.actif ? '' : ' <span class="badge neutral">archivé</span>'}<div class="muted" style="font-size:11.5px">${esc(r.ville || '')} ${esc(r.telephone || '')}</div>` },
      { key: 'contact', label: 'Contact', render: (r) => `${esc(r.contact || '-')}${r.email ? `<div class="muted" style="font-size:11.5px">${esc(r.email)}</div>` : ''}` },
      { key: 'nb_articles', label: 'Articles', num: true },
      { key: 'nb_commandes', label: 'Commandes', num: true },
      { key: 'montant_total', label: 'Montant cumulé', num: true, render: (r) => `<b>${fmtAr(r.montant_total)}</b>` },
    ],
    rows: data.rows,
    empty: 'Aucun fournisseur',
    actions: (r) => `<button class="btn btn-sm" data-view="${r.id}">Voir</button>
      ${hasPerm(user(), 'suppliers:write') ? `<button class="btn btn-sm" data-edit="${r.id}">Modifier</button>
      <button class="btn btn-sm btn-danger" data-del="${r.id}">Suppr.</button>` : ''}`,
  });
  document.getElementById('fr-count').innerHTML = `<b>${data.total}</b> fournisseur(s)`;
  const box = document.getElementById('fr-table');
  box.querySelectorAll('[data-view]').forEach((b) => (b.onclick = () => detail(Number(b.dataset.view))));
  box.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => supplierForm(data.rows.find((r) => r.id === Number(b.dataset.edit)))));
  box.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async () => {
      if (!(await confirmDialog('Archiver / supprimer ce fournisseur ?'))) return;
      try {
        const r = await del(`/suppliers/${b.dataset.del}`);
        toast(r.message || 'Fournisseur supprimé');
        await load();
      } catch (e) { toast(e.message, 'error'); }
    };
  });
}

export default {
  key: 'suppliers',
  title: 'Fournisseurs',
  icon: '⌂',
  section: 'Achats',
  roles: ['admin', 'gestionnaire', 'responsable'],
  async render(container) {
    const canWrite = hasPerm(user(), 'suppliers:write');
    container.innerHTML = `
      <div class="toolbar no-print">
        <input class="input search" id="fr-search" placeholder="Nom, contact, ville...">
        <div class="spacer"></div>
        ${canWrite ? '<button class="btn btn-primary" id="fr-new">+ Nouveau fournisseur</button>' : ''}
      </div>
      <div class="card"><div class="card-header"><h3 id="fr-count"></h3></div>
      <div class="card-body tight" id="fr-table"></div></div>`;
    document.getElementById('fr-search').oninput = debounce((e) => { state.search = e.target.value; load(); }, 350);
    const btn = document.getElementById('fr-new');
    if (btn) btn.onclick = () => supplierForm();
    await load();
  },
};
