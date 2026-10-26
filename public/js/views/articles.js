import { get, post, put, del } from '../api.js';
import { esc, fmtN, fmtAr, fmtDate, fmtQ, table, statutBadge, modal, closeModal, formModal, confirmDialog, toast, hasPerm, debounce } from '../ui.js';

let user = null;

const stockBar = (a) => {
  const max = Math.max(a.stock_cible || a.seuil_alerte * 3, a.stock, 1);
  const pct = Math.min(100, (a.stock / max) * 100);
  const color = a.stock <= 0 ? '#dc2626' : a.stock <= a.seuil_alerte ? '#d97706' : '#16a34a';
  return `<div class="progress" style="width:90px" title="Seuil : ${a.seuil_alerte}"><span style="width:${pct}%;background:${color}"></span></div>`;
};

async function articleForm(cats, frns, article = null) {
  formModal({
    title: article ? `Modifier ${article.reference}` : 'Nouvel article',
    wide: true,
    submitLabel: article ? 'Enregistrer' : 'Créer',
    fields: [
      { name: 'reference', label: 'Référence', value: article?.reference, required: true, placeholder: 'ART-016' },
      { name: 'nom', label: 'Désignation', value: article?.nom, required: true },
      { name: 'categorie_id', label: 'Catégorie', type: 'select', value: article?.categorie_id || '', options: cats.map((c) => ({ value: c.id, label: c.nom })), placeholder: '— Aucune —' },
      { name: 'fournisseur_id', label: 'Fournisseur', type: 'select', value: article?.fournisseur_id || '', options: frns.map((f) => ({ value: f.id, label: f.nom })), placeholder: '— Aucun —' },
      { name: 'unite', label: 'Unité', value: article?.unite || 'unité' },
      { name: 'prix_unitaire', label: 'Prix unitaire (Ar)', type: 'number', step: '0.01', min: 0, value: article?.prix_unitaire ?? '', required: true },
      { name: 'seuil_alerte', label: "Seuil d'alerte", type: 'number', min: 0, value: article?.seuil_alerte ?? 10, required: true },
      { name: 'stock_cible', label: 'Stock cible (objectif)', type: 'number', min: 0, value: article?.stock_cible ?? '' },
      ...(article ? [] : [{ name: 'stock_initial', label: 'Stock initial', type: 'number', min: 0, value: 0 }]),
      { name: 'emplacement', label: 'Emplacement', value: article?.emplacement || '' },
      { name: 'description', label: 'Description', type: 'textarea', value: article?.description || '', span: 2 },
    ],
    async onSubmit(data) {
      const payload = {
        ...data,
        categorie_id: data.categorie_id ? Number(data.categorie_id) : null,
        fournisseur_id: data.fournisseur_id ? Number(data.fournisseur_id) : null,
        prix_unitaire: Number(data.prix_unitaire) || 0,
        seuil_alerte: Number(data.seuil_alerte) || 0,
        stock_cible: data.stock_cible ? Number(data.stock_cible) : null,
        stock_initial: Number(data.stock_initial) || 0,
      };
      if (article) await put(`/articles/${article.id}`, payload);
      else await post('/articles', payload);
      toast(article ? 'Article modifié' : 'Article créé');
      await load();
    },
  });
}

async function articleDetail(id) {
  const a = await get(`/articles/${id}`);
  const rows = a.mouvements || [];
  modal({
    title: `${a.reference} · ${a.nom}`,
    wide: true,
    body: `
      <div class="detail-grid mb">
        <div><div class="k">Statut</div><div class="v">${statutBadge(a.stock <= 0 ? 'RUPTURE' : a.stock <= a.seuil_alerte ? 'STOCK_BAS' : 'OK')}</div></div>
        <div><div class="k">Stock actuel</div><div class="v">${fmtQ(a.stock)} ${esc(a.unite)}</div></div>
        <div><div class="k">Seuil d'alerte</div><div class="v">${fmtQ(a.seuil_alerte)} ${esc(a.unite)}</div></div>
        <div><div class="k">Prix unitaire</div><div class="v">${fmtAr(a.prix_unitaire)}</div></div>
        <div><div class="k">Valeur du stock</div><div class="v">${fmtAr(a.stock * a.prix_unitaire)}</div></div>
        <div><div class="k">Catégorie</div><div class="v">${esc(a.categorie_nom || '-')}</div></div>
        <div><div class="k">Fournisseur</div><div class="v">${esc(a.fournisseur_nom || '-')}</div></div>
        <div><div class="k">Emplacement</div><div class="v">${esc(a.emplacement || '-')}</div></div>
      </div>
      ${a.description ? `<p class="hint">${esc(a.description)}</p>` : ''}
      <div class="section-title">Derniers mouvements</div>
      ${table({
        columns: [
          { key: 'date', label: 'Date', render: (r) => fmtDate(r.date) },
          { key: 'type', label: 'Type', render: (r) => statutBadge(r.type) },
          { key: 'quantite', label: 'Qté', num: true, render: (r) => fmtN(r.quantite) },
          { key: 'stock_apres', label: 'Stock', num: true, render: (r) => fmtN(r.stock_apres) },
          { key: 'motif', label: 'Motif' },
        ],
        rows,
        empty: 'Aucun mouvement',
      })}
      ${a.alertes && a.alertes.length ? `<div class="section-title">Alertes</div>${a.alertes
        .map((al) => `<div class="list-item"><div class="grow">${esc(al.message)}</div>${statutBadge(al.statut)}</div>`)
        .join('')}` : ''}`,
    footer: `<button class="btn" id="ad-close">Fermer</button>`,
    onOpen(root) {
      root.querySelector('#ad-close').onclick = closeModal;
    },
  });
}

async function categoriesModal() {
  const cats = await get('/articles/categories');
  modal({
    title: 'Catégories d’articles',
    body: `
      <div id="cat-list">${cats.rows
        .map(
          (c) => `<div class="list-item" data-id="${c.id}">
            <div class="grow"><b>${esc(c.nom)}</b><div class="muted" style="font-size:12px">${esc(c.description || '')} · ${c.nb_articles} article(s)</div></div>
            ${hasPerm(user, 'articles:write') ? `<button class="btn btn-sm" data-edit="${c.id}">Modifier</button>
            <button class="btn btn-sm btn-danger" data-del="${c.id}">Suppr.</button>` : ''}
          </div>`
        )
        .join('')}</div>
      ${hasPerm(user, 'articles:write') ? `
      <div class="section-title">Ajouter une catégorie</div>
      <div class="form-grid">
        <div class="form-group"><label class="field-label">Nom *</label><input class="input" id="cat-nom" style="width:100%"></div>
        <div class="form-group"><label class="field-label">Description</label><input class="input" id="cat-desc" style="width:100%"></div>
      </div>` : ''}`,
    footer: `<button class="btn" id="cat-close">Fermer</button>
             ${hasPerm(user, 'articles:write') ? '<button class="btn btn-primary" id="cat-add">Ajouter</button>' : ''}`,
    onOpen(root) {
      root.querySelector('#cat-close').onclick = closeModal;
      const add = root.querySelector('#cat-add');
      if (add) {
        add.onclick = async () => {
          const nom = root.querySelector('#cat-nom').value.trim();
          if (!nom) return toast('Nom requis', 'warning');
          try {
            await post('/articles/categories', { nom, description: root.querySelector('#cat-desc').value });
            toast('Catégorie ajoutée');
            closeModal();
            categoriesModal();
            await load();
          } catch (e) {
            toast(e.message, 'error');
          }
        };
      }
      root.querySelectorAll('[data-edit]').forEach((btn) => {
        btn.onclick = () => {
          const c = cats.rows.find((x) => x.id === Number(btn.dataset.edit));
          formModal({
            title: 'Modifier la catégorie',
            fields: [
              { name: 'nom', label: 'Nom', value: c.nom, required: true },
              { name: 'description', label: 'Description', value: c.description || '' },
            ],
            onSubmit: async (data) => {
              await put(`/articles/categories/${c.id}`, data);
              toast('Catégorie modifiée');
              closeModal();
              categoriesModal();
              await load();
            },
          });
        };
      });
      root.querySelectorAll('[data-del]').forEach((btn) => {
        btn.onclick = async () => {
          if (!(await confirmDialog('Supprimer cette catégorie ?'))) return;
          try {
            await del(`/articles/categories/${btn.dataset.del}`);
            toast('Catégorie supprimée');
            closeModal();
            categoriesModal();
            await load();
          } catch (e) {
            toast(e.message, 'error');
          }
        };
      });
    },
  });
}

const state = { search: '', categorie_id: '', statut: '', actif: '1' };
let catsCache = [];
let frnsCache = [];

async function load() {
  const params = new URLSearchParams();
  if (state.search) params.set('search', state.search);
  if (state.categorie_id) params.set('categorie_id', state.categorie_id);
  if (state.statut) params.set('statut', state.statut);
  if (state.actif) params.set('actif', state.actif);
  const data = await get(`/articles?${params}`);
  const totalValeur = data.rows.reduce((s, r) => s + r.valeur_stock, 0);

  const tbody = document.getElementById('articles-table');
  tbody.innerHTML = table({
    columns: [
      { key: 'reference', label: 'Référence', render: (r) => `<b>${esc(r.reference)}</b>` },
      {
        key: 'nom',
        label: 'Article',
        render: (r) => `${esc(r.nom)}${r.actif ? '' : ' <span class="badge neutral">archivé</span>'}${
          r.description ? `<div class="muted" style="font-size:11.5px">${esc(r.description)}</div>` : ''
        }`,
      },
      { key: 'categorie_nom', label: 'Catégorie', render: (r) => esc(r.categorie_nom || '-') },
      { key: 'fournisseur_nom', label: 'Fournisseur', render: (r) => esc(r.fournisseur_nom || '-') },
      {
        key: 'stock',
        label: 'Stock',
        num: true,
        render: (r) => `<div style="display:flex;gap:8px;justify-content:flex-end;align-items:center">
          <span style="font-weight:600;${r.stock <= r.seuil_alerte ? 'color:#dc2626' : ''}">${fmtQ(r.stock)}</span>${stockBar(r)}</div>`,
      },
      { key: 'seuil_alerte', label: 'Seuil', num: true, render: (r) => fmtQ(r.seuil_alerte) },
      { key: 'prix_unitaire', label: 'Prix unit.', num: true, render: (r) => fmtAr(r.prix_unitaire) },
      { key: 'valeur_stock', label: 'Valeur', num: true, render: (r) => `<b>${fmtAr(r.valeur_stock)}</b>` },
      { key: 'statut', label: 'Statut', render: (r) => statutBadge(r.statut) },
    ],
    rows: data.rows,
    empty: 'Aucun article trouvé',
    actions: (r) => `<button class="btn btn-sm" data-view="${r.id}">Voir</button>
      ${hasPerm(user, 'articles:write') ? `<button class="btn btn-sm" data-edit="${r.id}">Modifier</button>
      <button class="btn btn-sm btn-danger" data-del="${r.id}">Suppr.</button>` : ''}`,
  });

  document.getElementById('articles-count').innerHTML =
    `<b>${data.total}</b> article(s) · valeur cumulée : <b>${fmtAr(totalValeur)}</b>`;

  tbody.querySelectorAll('[data-view]').forEach((b) => (b.onclick = () => articleDetail(Number(b.dataset.view))));
  tbody.querySelectorAll('[data-edit]').forEach(
    (b) => (b.onclick = () => articleForm(catsCache, frnsCache, data.rows.find((r) => r.id === Number(b.dataset.edit))))
  );
  tbody.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async () => {
      if (!(await confirmDialog('Archiver / supprimer cet article ?'))) return;
      try {
        const r = await del(`/articles/${b.dataset.del}`);
        toast(r.message || 'Article supprimé');
        await load();
      } catch (e) {
        toast(e.message, 'error');
      }
    };
  });
}

export default {
  key: 'articles',
  title: 'Articles & consommables',
  icon: '▣',
  section: 'Stock',
  roles: ['admin', 'gestionnaire', 'responsable'],
  async render(container) {
    user = JSON.parse(sessionStorage.getItem('user') || '{}');
    const [cats, frns] = await Promise.all([get('/articles/categories'), get('/suppliers?limit=200')]);
    catsCache = cats.rows;
    frnsCache = frns.rows;

    container.innerHTML = `
      <div class="toolbar no-print">
        <input class="input search" id="art-search" placeholder="Rechercher un article...">
        <select class="select" id="art-cat"><option value="">Toutes catégories</option>${catsCache
          .map((c) => `<option value="${c.id}">${esc(c.nom)}</option>`)
          .join('')}</select>
        <select class="select" id="art-statut">
          <option value="">Tous les statuts</option>
          <option value="rupture">En rupture</option>
          <option value="bas">Stock bas</option>
          <option value="ok">Stock suffisant</option>
        </select>
        <select class="select" id="art-actif">
          <option value="1">Actifs</option>
          <option value="">Tous</option>
        </select>
        <div class="spacer"></div>
        <button class="btn" id="btn-cats">Catégories</button>
        ${hasPerm(user, 'articles:write') ? '<button class="btn btn-primary" id="btn-new">+ Nouvel article</button>' : ''}
      </div>
      <div class="card"><div class="card-header"><h3 id="articles-count"></h3></div>
      <div class="card-body tight" id="articles-table"></div></div>`;

    document.getElementById('art-search').oninput = debounce((e) => {
      state.search = e.target.value;
      load();
    }, 350);
    document.getElementById('art-cat').onchange = (e) => { state.categorie_id = e.target.value; load(); };
    document.getElementById('art-statut').onchange = (e) => { state.statut = e.target.value; load(); };
    document.getElementById('art-actif').onchange = (e) => { state.actif = e.target.value; load(); };
    document.getElementById('btn-cats').onclick = categoriesModal;
    const btnNew = document.getElementById('btn-new');
    if (btnNew) btnNew.onclick = () => articleForm(catsCache, frnsCache);
    await load();
  },
};
