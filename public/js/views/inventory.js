import { get, post, put, del } from '../api.js';
import { esc, fmtN, fmtDate, fmtQ, table, statutBadge, modal, closeModal, confirmDialog, toast, hasPerm, badge } from '../ui.js';

const user = () => JSON.parse(sessionStorage.getItem('user') || '{}');

let currentId = null;

async function saveCounts(root) {
  const items = [...root.querySelectorAll('[data-art]')].map((inp) => ({
    article_id: Number(inp.dataset.art),
    qte_reelle: Number(inp.value),
  }));
  await post(`/inventory/sessions/${currentId}/items`, { items });
  toast('Comptages enregistrés');
}

function ecartColor(e) {
  if (e === 0) return '#16a34a';
  return e > 0 ? '#0891b2' : '#dc2626';
}

async function openSession(id) {
  currentId = id;
  const s = await get(`/inventory/sessions/${id}`);
  const ouvert = s.statut === 'OUVERT' && hasPerm(user(), 'inventory:write');
  const ecartValeur = s.synthese.valeur_ecart;

  modal({
    title: `${s.reference} · ${fmtDate(s.date_inventaire)} ${statutBadge(s.statut)}`,
    wide: true,
    body: `
      <div class="detail-grid mb">
        <div><div class="k">Articles inventorés</div><div class="v">${s.synthese.nb_articles}</div></div>
        <div><div class="k">Écarts constatés</div><div class="v" style="color:${s.synthese.nb_ecarts ? '#d97706' : '#16a34a'}">${s.synthese.nb_ecarts}</div></div>
        <div><div class="k">Manquant / surplus</div><div class="v">${fmtN(s.synthese.ecart_negatif)} / +${fmtN(s.synthese.ecart_positif)}</div></div>
        <div><div class="k">Valeur de l’écart</div><div class="v">${fmtQ(ecartValeur)} Ar</div></div>
        <div><div class="k">Créé par</div><div class="v">${esc(s.matricule || '-')} ${esc(s.user_prenom || '')}</div></div>
      </div>
      ${s.notes ? `<p class="hint">${esc(s.notes)}</p>` : ''}
      <div class="table-wrap" style="max-height:52vh;overflow:auto">
        <table class="table">
          <thead><tr>
            <th>Article</th><th>Emplacement</th><th class="num">Stock théorique</th>
            <th class="num">Quantité réelle</th><th class="num">Écart</th><th>Statut</th>
          </tr></thead>
          <tbody>
            ${s.items
              .map((i) => {
                const e = Number(i.ecart);
                return `<tr>
                  <td><b>${esc(i.article_nom)}</b><div class="muted" style="font-size:11.5px">${esc(i.reference)}</div></td>
                  <td class="muted">${esc(i.emplacement || '-')}</td>
                  <td class="num">${fmtQ(i.qte_theorique)}</td>
                  <td class="num">${
                    ouvert
                      ? `<input class="input" type="number" min="0" value="${i.qte_reelle}" data-art="${i.article_id}"
                           data-theo="${i.qte_theorique}" style="width:96px;text-align:right">`
                      : fmtQ(i.qte_reelle)
                  }</td>
                  <td class="num" data-ecart="${i.article_id}" style="font-weight:700;color:${ecartColor(e)}">${e > 0 ? '+' : ''}${fmtN(e)}</td>
                  <td>${i.corrige ? badge('corrigé', 'ok') : e === 0 ? badge('conforme', 'neutral') : badge('écart', 'warn')}</td>
                </tr>`;
              })
              .join('')}
          </tbody>
        </table>
      </div>`,
    footer: `
      <button class="btn" id="iv-close">Fermer</button>
      ${ouvert ? `
        ${s.statut === 'OUVERT' ? `<button class="btn btn-danger" id="iv-del">Supprimer</button>` : ''}
        <button class="btn" id="iv-save">Enregistrer les comptages</button>
        <button class="btn btn-primary" id="iv-close-session">Clôturer &amp; appliquer les corrections</button>` : ''}`,
    onOpen(root) {
      root.querySelector('#iv-close').onclick = closeModal;

      root.querySelectorAll('[data-art]').forEach((inp) => {
        inp.addEventListener('input', () => {
          const theo = Number(inp.dataset.theo);
          const val = Number(inp.value || 0);
          const cell = root.querySelector(`[data-ecart="${inp.dataset.art}"]`);
          const e = val - theo;
          cell.textContent = `${e > 0 ? '+' : ''}${e}`;
          cell.style.color = ecartColor(e);
        });
      });

      const saveBtn = root.querySelector('#iv-save');
      if (saveBtn) saveBtn.onclick = async () => {
        saveBtn.disabled = true;
        try { await saveCounts(root); } catch (e) { toast(e.message, 'error'); }
        saveBtn.disabled = false;
      };

      const delBtn = root.querySelector('#iv-del');
      if (delBtn) delBtn.onclick = async () => {
        if (!(await confirmDialog('Supprimer cette session d’inventaire ?'))) return;
        try {
          await del(`/inventory/sessions/${id}`);
          toast('Session supprimée');
          closeModal();
          await load();
        } catch (e) { toast(e.message, 'error'); }
      };

      const closeBtn = root.querySelector('#iv-close-session');
      if (closeBtn) closeBtn.onclick = async () => {
        const nb = root.querySelectorAll('[data-art]').length;
        if (!(await confirmDialog(`Clôturer l'inventaire ${s.reference} ? Les écarts (${nb} articles contrôlés) seront appliqués au stock par des mouvements de correction.`, { confirmLabel: 'Clôturer' }))) return;
        closeBtn.disabled = true;
        try {
          await saveCounts(root);
          const res = await post(`/inventory/sessions/${id}/cloture`);
          toast(res.message);
          closeModal();
          await load();
        } catch (e) {
          toast(e.message, 'error');
          closeBtn.disabled = false;
        }
      };
    },
  });
}

async function load() {
  const data = await get('/inventory/sessions');
  document.getElementById('inv-table').innerHTML = table({
    columns: [
      { key: 'reference', label: 'Référence', render: (r) => `<b>${esc(r.reference)}</b>` },
      { key: 'date_inventaire', label: 'Date', render: (r) => fmtDate(r.date_inventaire) },
      { key: 'statut', label: 'Statut', render: (r) => statutBadge(r.statut) },
      { key: 'nb_articles', label: 'Articles', num: true },
      { key: 'nb_ecarts', label: 'Écarts', num: true, render: (r) => (r.nb_ecarts ? `<span style="color:#d97706;font-weight:700">${r.nb_ecarts}</span>` : '0') },
      { key: 'ecart_total', label: 'Écart total (qtés)', num: true, render: (r) => (r.ecart_total ? `<span style="color:#dc2626">${fmtN(r.ecart_total)}</span>` : '0') },
      { key: 'user', label: 'Créé par', render: (r) => (r.matricule ? `${badge(r.matricule, 'neutral')} ${esc(r.user_prenom)} ${esc(r.user_nom)}` : '-') },
      { key: 'notes', label: 'Notes', render: (r) => `<span class="muted">${esc(r.notes || '-')}</span>` },
    ],
    rows: data.rows,
    empty: 'Aucun inventaire',
    actions: (r) => `<button class="btn btn-sm" data-open="${r.id}">Ouvrir</button>`,
  });
  document.getElementById('inv-table').querySelectorAll('[data-open]').forEach(
    (b) => (b.onclick = () => openSession(Number(b.dataset.open)))
  );
}

export default {
  key: 'inventory',
  title: 'Inventaire & corrections',
  icon: '☑',
  section: 'Stock',
  roles: ['admin', 'gestionnaire', 'responsable'],
  async render(container) {
    const canWrite = hasPerm(user(), 'inventory:write');
    container.innerHTML = `
      <div class="toolbar no-print">
        <span class="hint">Vérification des quantités réelles et correction des écarts.</span>
        <div class="spacer"></div>
        ${canWrite ? '<button class="btn btn-primary" id="inv-new">+ Nouvel inventaire</button>' : ''}
      </div>
      <div class="card"><div class="card-body tight" id="inv-table"></div></div>`;

    const btn = document.getElementById('inv-new');
    if (btn) {
      btn.onclick = async () => {
        btn.disabled = true;
        try {
          const s = await post('/inventory/sessions', { notes: `Inventaire du ${new Date().toLocaleDateString('fr-FR')}` });
          toast('Session créée : saisissez les quantités réelles');
          await load();
          openSession(s.id);
        } catch (e) {
          toast(e.message, 'error');
        }
        btn.disabled = false;
      };
    }
    await load();
  },
};
