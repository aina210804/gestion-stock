import { get, post, download } from '../api.js';
import { esc, fmtN, fmtAr, fmtDate, fmtQ, table, statutBadge, modal, closeModal, formModal, confirmDialog, toast, hasPerm, debounce, badge } from '../ui.js';

const user = () => JSON.parse(sessionStorage.getItem('user') || '{}');
const state = { statut: '', search: '' };

/* ---------- Création ---------- */
async function createOrder() {
  const [frns, arts] = await Promise.all([get('/suppliers?limit=200'), get('/articles?actif=1&limit=500')]);
  const lines = [];

  const draw = () => {
    const root = document.getElementById('modal-root');
    const sel = root.querySelector('#oc-fournisseur');
    const frnId = sel ? Number(sel.value) || 0 : 0;
    const dispo = frnId ? arts.rows.filter((a) => a.fournisseur_id === frnId) : arts.rows;
    const artSel = root.querySelector('#oc-article');
    if (artSel) {
      artSel.innerHTML = `<option value="">— Choisir un article —</option>${dispo
        .map((a) => `<option value="${a.id}">${esc(a.reference)} · ${esc(a.nom)} (stock ${fmtQ(a.stock)})</option>`)
        .join('')}`;
    }
    const total = lines.reduce((s, l) => s + l.quantite * l.prix_unitaire, 0);
    root.querySelector('#oc-lines').innerHTML = lines.length
      ? `<table class="table"><thead><tr><th>Article</th><th class="num">Qté</th><th class="num">Prix unit.</th><th class="num">Montant</th><th></th></tr></thead>
         <tbody>${lines
           .map(
             (l, i) => `<tr>
               <td>${esc(l.reference)} · ${esc(l.nom)}</td>
               <td class="num">${fmtN(l.quantite)}</td>
               <td class="num">${fmtAr(l.prix_unitaire)}</td>
               <td class="num"><b>${fmtAr(l.quantite * l.prix_unitaire)}</b></td>
               <td class="actions"><button class="btn btn-sm btn-danger" data-rm="${i}">✕</button></td>
             </tr>`
           )
           .join('')}</tbody></table>`
      : '<div class="empty">Aucune ligne — choisissez un article ci-dessous</div>';
    root.querySelector('#oc-total').innerHTML = `<b>${fmtAr(total)}</b>`;
    root.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { lines.splice(Number(b.dataset.rm), 1); draw(); }));
    const add = root.querySelector('#oc-add');
    if (add) {
      add.disabled = lines.length === 0;
      add.onclick = () => {
        const a = arts.rows.find((x) => x.id === Number(root.querySelector('#oc-article').value));
        const q = Number(root.querySelector('#oc-qte').value);
        if (!a) return toast('Choisissez un article', 'warning');
        if (!q || q <= 0) return toast('Quantité invalide', 'warning');
        const exist = lines.find((l) => l.article_id === a.id);
        if (exist) exist.quantite += q;
        else lines.push({ article_id: a.id, reference: a.reference, nom: a.nom, quantite: q, prix_unitaire: a.prix_unitaire });
        root.querySelector('#oc-qte').value = 1;
        draw();
      };
    }
    if (sel) sel.onchange = draw;
  };

  modal({
    title: 'Nouveau bon de commande',
    wide: true,
    body: `
      <div class="form-grid">
        <div class="form-group"><label class="field-label">Fournisseur</label>
          <select class="select" id="oc-fournisseur" style="width:100%">
            <option value="">— Choisir —</option>
            ${frns.rows.map((f) => `<option value="${f.id}">${esc(f.nom)}</option>`).join('')}
          </select></div>
        <div class="form-group"><label class="field-label">Date de livraison prévue</label>
          <input class="input" type="date" id="oc-livraison" style="width:100%"></div>
      </div>
      <div class="form-grid">
        <div class="form-group"><label class="field-label">Article</label><select class="select" id="oc-article" style="width:100%"></select></div>
        <div class="form-group"><label class="field-label">Quantité</label>
          <div style="display:flex;gap:8px">
            <input class="input" type="number" id="oc-qte" value="1" min="1" style="width:100px">
            <button class="btn" id="oc-add" type="button">Ajouter la ligne</button>
          </div></div>
      </div>
      <div id="oc-lines"></div>
      <div class="stat-line" style="border-top:1px solid var(--border);margin-top:10px">
        <span>Total du bon de commande</span><span id="oc-total"></span>
      </div>
      <div class="form-group mt"><label class="field-label">Notes</label><input class="input" id="oc-notes" style="width:100%" placeholder="Conditions de livraison..."></div>`,
    footer: `<button class="btn" id="oc-cancel">Annuler</button>
             <button class="btn btn-primary" id="oc-create">Créer le brouillon</button>`,
    onOpen(root) {
      draw();
      root.querySelector('#oc-cancel').onclick = closeModal;
      root.querySelector('#oc-create').onclick = async () => {
        const frnId = Number(root.querySelector('#oc-fournisseur').value) || null;
        if (!frnId) return toast('Choisissez un fournisseur', 'warning');
        if (!lines.length) return toast('Ajoutez au moins une ligne', 'warning');
        try {
          const o = await post('/orders', {
            fournisseur_id: frnId,
            dateLivraison: root.querySelector('#oc-livraison').value || null,
            notes: root.querySelector('#oc-notes').value,
            items: lines.map((l) => ({ article_id: l.article_id, quantite: l.quantite, prix_unitaire: l.prix_unitaire })),
          });
          toast(`${o.numero} créé (${fmtAr(o.total)})`);
          closeModal();
          await load();
        } catch (e) { toast(e.message, 'error'); }
      };
    },
  });
}

/* ---------- Détail / actions ---------- */
async function receiveOrder(order) {
  const reste = order.items.filter((i) => i.quantite_recue < i.quantite);
  if (!reste.length) return toast('Rien à recevoir', 'warning');
  formModal({
    title: `Réception ${order.numero}`,
    submitLabel: 'Valider la réception',
    fields: reste.map((i) => ({
      name: String(i.article_id),
      label: `${i.article_nom} — commandé ${i.quantite}, déjà reçu ${i.quantite_recue}`,
      type: 'number',
      min: 0,
      value: i.quantite - i.quantite_recue,
      required: true,
    })),
    async onSubmit(data) {
      const items = reste.map((i) => ({ article_id: i.article_id, quantite: Number(data[String(i.article_id)]) || 0 }));
      await post(`/orders/${order.id}/recevoir`, { items });
      toast('Réception enregistrée : le stock a été mis à jour');
      await load();
    },
  });
}

async function orderDetail(id) {
  const o = await get(`/orders/${id}`);
  const canValidate = hasPerm(user(), 'orders:validate');
  const canReceive = hasPerm(user(), 'orders:receive');
  const canCreate = hasPerm(user(), 'orders:create');

  modal({
    title: `${o.numero} · ${esc(o.fournisseur_nom || 'Sans fournisseur')}`,
    wide: true,
    body: `
      <div class="detail-grid mb">
        <div><div class="k">Statut</div><div class="v">${statutBadge(o.statut)}</div></div>
        <div><div class="k">Date de commande</div><div class="v">${fmtDate(o.date_commande)}</div></div>
        <div><div class="k">Livraison prévue</div><div class="v">${fmtDate(o.date_livraison_prevue)}</div></div>
        <div><div class="k">Total</div><div class="v">${fmtAr(o.total)}</div></div>
        <div><div class="k">Créé par</div><div class="v">${esc(o.createur_matricule || '-')} ${esc(o.createur_prenom || '')} ${esc(o.createur_nom || '')}</div></div>
        <div><div class="k">Validé par</div><div class="v">${esc(o.validateur_prenom || '-')} ${esc(o.validateur_nom || '')}</div></div>
      </div>
      ${o.notes ? `<p class="hint">${esc(o.notes)}</p>` : ''}
      <table class="table">
        <thead><tr><th>Article</th><th class="num">Commandé</th><th class="num">Reçu</th><th class="num">Reste</th><th class="num">Prix</th><th class="num">Montant</th></tr></thead>
        <tbody>${o.items
          .map((i) => `<tr>
            <td><b>${esc(i.article_nom)}</b><div class="muted" style="font-size:11.5px">${esc(i.article_reference)}</div></td>
            <td class="num">${fmtN(i.quantite)}</td>
            <td class="num">${fmtN(i.quantite_recue)}</td>
            <td class="num">${fmtN(i.quantite - i.quantite_recue)}</td>
            <td class="num">${fmtAr(i.prix_unitaire)}</td>
            <td class="num"><b>${fmtAr(i.montant)}</b></td>
          </tr>`)
          .join('')}</tbody>
      </table>
      ${o.mouvements.length ? `<div class="section-title">Entrées générées</div>${o.mouvements
        .map((m) => `<div class="list-item"><div class="grow">${fmtDate(m.date)} · ${esc(m.article_nom)}</div><div>+${fmtN(m.quantite)}</div></div>`)
        .join('')}` : ''}`,
    footer: `
      <button class="btn" id="od-close">Fermer</button>
      <button class="btn" id="od-export">Exporter CSV</button>
      ${['BROUILLON', 'VALIDEE', 'PARTIELLE'].includes(o.statut) && canCreate ? '<button class="btn btn-danger" id="od-cancel">Annuler</button>' : ''}
      ${o.statut === 'BROUILLON' && canValidate ? '<button class="btn btn-warning" id="od-validate">Valider</button>' : ''}
      ${['VALIDEE', 'PARTIELLE'].includes(o.statut) && canReceive ? '<button class="btn btn-success" id="od-receive">Réceptionner</button>' : ''}`,
    onOpen(root) {
      root.querySelector('#od-close').onclick = closeModal;
      root.querySelector('#od-export').onclick = () => download(`/orders/${o.id}/export`, `${o.numero}.csv`);
      const v = root.querySelector('#od-validate');
      if (v) v.onclick = async () => {
        if (!(await confirmDialog(`Valider le bon de commande ${o.numero} ?`))) return;
        try {
          await post(`/orders/${o.id}/valider`);
          toast('Commande validée');
          closeModal();
          await load();
          orderDetail(o.id);
        } catch (e) { toast(e.message, 'error'); }
      };
      const r = root.querySelector('#od-receive');
      if (r) r.onclick = () => { closeModal(); receiveOrder(o); };
      const c = root.querySelector('#od-cancel');
      if (c) c.onclick = async () => {
        if (!(await confirmDialog(`Annuler le bon de commande ${o.numero} ?`))) return;
        try {
          await post(`/orders/${o.id}/annuler`);
          toast('Commande annulée');
          closeModal();
          await load();
        } catch (e) { toast(e.message, 'error'); }
      };
    },
  });
}

async function load() {
  const params = new URLSearchParams();
  Object.entries(state).forEach(([k, v]) => v && params.set(k, v));
  const data = await get(`/orders?${params}`);
  const ouvertes = data.rows.filter((r) => ['BROUILLON', 'VALIDEE', 'PARTIELLE'].includes(r.statut));
  const recues = data.rows.filter((r) => r.statut === 'RECUE');
  const engage = ouvertes.filter((r) => r.statut !== 'BROUILLON').reduce((s, r) => s + r.total, 0);

  document.getElementById('bc-stats').innerHTML = `
    <div class="card kpi"><div class="ico bg-orange">▧</div><div><div class="lib">Commandes ouvertes</div>
      <div class="val">${fmtN(ouvertes.length)}</div><div class="sub">brouillons, validées ou partielles</div></div></div>
    <div class="card kpi"><div class="ico bg-blue">◉</div><div><div class="lib">Montant engagé</div>
      <div class="val">${fmtAr(engage)}</div><div class="sub">commandes validées</div></div></div>
    <div class="card kpi"><div class="ico bg-green">✓</div><div><div class="lib">Commandes reçues</div>
      <div class="val">${fmtN(recues.length)}</div><div class="sub">livrées intégralement</div></div></div>`;

  document.getElementById('bc-table').innerHTML = table({
    columns: [
      { key: 'numero', label: 'N°', render: (r) => `<b>${esc(r.numero)}</b>` },
      { key: 'date_commande', label: 'Date', render: (r) => fmtDate(r.date_commande) },
      { key: 'fournisseur', label: 'Fournisseur', render: (r) => esc(r.fournisseur_nom || '-') },
      { key: 'nb_articles', label: 'Articles', num: true },
      { key: 'total', label: 'Total', num: true, render: (r) => `<b>${fmtAr(r.total)}</b>` },
      { key: 'statut', label: 'Statut', render: (r) => statutBadge(r.statut) },
      { key: 'createur', label: 'Créé par', render: (r) => esc(r.createur_matricule || '-') },
    ],
    rows: data.rows,
    empty: 'Aucun bon de commande',
    actions: (r) => `<button class="btn btn-sm" data-view="${r.id}">Ouvrir</button>`,
  });
  document.getElementById('bc-count').innerHTML = `<b>${data.total}</b> bon(s) de commande`;
  document.getElementById('bc-table').querySelectorAll('[data-view]').forEach(
    (b) => (b.onclick = () => orderDetail(Number(b.dataset.view)))
  );
}

export default {
  key: 'orders',
  title: 'Bons de commande',
  icon: '≣',
  section: 'Achats',
  roles: ['admin', 'gestionnaire', 'responsable'],
  async render(container) {
    const canCreate = hasPerm(user(), 'orders:create');
    container.innerHTML = `
      <div class="grid grid-3 mb" id="bc-stats"></div>
      <div class="toolbar no-print">
        <select class="select" id="bc-statut">
          <option value="">Tous les statuts</option>
          <option value="BROUILLON">Brouillon</option>
          <option value="VALIDEE">Validée</option>
          <option value="PARTIELLE">Partiellement reçue</option>
          <option value="RECUE">Reçue</option>
          <option value="ANNULEE">Annulée</option>
        </select>
        <input class="input search" id="bc-search" placeholder="N° ou fournisseur...">
        <div class="spacer"></div>
        ${canCreate ? '<button class="btn btn-primary" id="bc-new">+ Nouveau bon de commande</button>' : ''}
      </div>
      <div class="card"><div class="card-header"><h3 id="bc-count"></h3></div>
      <div class="card-body tight" id="bc-table"></div></div>`;

    document.getElementById('bc-statut').onchange = (e) => { state.statut = e.target.value; load(); };
    document.getElementById('bc-search').oninput = debounce((e) => { state.search = e.target.value; load(); }, 350);
    const btn = document.getElementById('bc-new');
    if (btn) btn.onclick = createOrder;
    await load();
  },
};
