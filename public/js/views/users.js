import { get, post, put, del } from '../api.js';
import { esc, fmtDate, fmtDateTime, table, statutBadge, formModal, confirmDialog, toast, hasPerm, debounce, badge } from '../ui.js';

const state = { search: '', role: '' };

async function userForm(u = null) {
  const roles = await get('/users/roles');
  formModal({
    title: u ? `Modifier ${u.matricule}` : 'Nouvel utilisateur',
    fields: [
      { name: 'nom', label: 'Nom', value: u?.nom, required: true },
      { name: 'prenom', label: 'Prénom', value: u?.prenom, required: true },
      { name: 'matricule', label: 'Matricule', value: u?.matricule || '', placeholder: 'Généré automatiquement', readonly: !!u },
      { name: 'date_naissance', label: 'Date de naissance', type: 'date', value: u?.date_naissance || '' },
      { name: 'email', label: 'Adresse e-mail', type: 'email', value: u?.email, required: true },
      { name: 'poste', label: 'Poste', value: u?.poste || '' },
      {
        name: 'role',
        label: 'Rôle',
        type: 'select',
        value: u?.role || 'gestionnaire',
        required: true,
        options: roles.roles.map((r) => ({ value: r.code, label: r.libelle })),
      },
      { name: 'actif', label: 'Compte actif', type: 'select', value: u ? String(u.actif) : '1', options: [{ value: '1', label: 'Oui' }, { value: '0', label: 'Non' }] },
      { name: 'motDePasse', label: u ? 'Nouveau mot de passe (facultatif)' : 'Mot de passe *', type: 'password', placeholder: u ? 'Laisser vide pour ne pas changer' : '6 caractères minimum', required: !u },
    ],
    async onSubmit(data) {
      const payload = { ...data, actif: Number(data.actif) === 1 };
      if (u) await put(`/users/${u.id}`, payload);
      else await post('/users', payload);
      toast(u ? 'Utilisateur modifié' : 'Utilisateur créé');
      await load();
    },
  });
}

async function load() {
  const params = new URLSearchParams();
  if (state.search) params.set('search', state.search);
  if (state.role) params.set('role', state.role);
  const data = await get(`/users?${params}`);

  document.getElementById('us-table').innerHTML = table({
    columns: [
      { key: 'matricule', label: 'Matricule', render: (r) => badge(r.matricule, 'neutral') },
      { key: 'nom', label: 'Nom & prénom', render: (r) => `<b>${esc(r.nom)} ${esc(r.prenom)}</b><div class="muted" style="font-size:11.5px">${esc(r.email)}</div>` },
      { key: 'date_naissance', label: 'Naissance', render: (r) => fmtDate(r.date_naissance) },
      { key: 'poste', label: 'Poste', render: (r) => esc(r.poste || '-') },
      { key: 'role', label: 'Rôle', render: (r) => statutBadge(r.role) },
      { key: 'last_login', label: 'Dernière connexion', render: (r) => (r.last_login ? `<span title="${fmtDateTime(r.last_login)}">${fmtDateTime(r.last_login)}</span>` : '<span class="muted">jamais</span>') },
      { key: 'actif', label: 'État', render: (r) => (r.actif ? badge('actif', 'ok') : badge('désactivé', 'danger')) },
    ],
    rows: data.rows,
    empty: 'Aucun utilisateur',
    actions: (r) => `<button class="btn btn-sm" data-edit="${r.id}">Modifier</button>
      <button class="btn btn-sm" data-pwd="${r.id}">Mot de passe</button>
      <button class="btn btn-sm btn-danger" data-del="${r.id}">${r.actif ? 'Désactiver' : 'Supprimer'}</button>`,
  });

  const box = document.getElementById('us-table');
  box.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => userForm(data.rows.find((r) => r.id === Number(b.dataset.edit)))));
  box.querySelectorAll('[data-pwd]').forEach((b) => {
    b.onclick = () => {
      const u = data.rows.find((r) => r.id === Number(b.dataset.pwd));
      formModal({
        title: `Réinitialiser le mot de passe de ${u.matricule}`,
        fields: [{ name: 'motDePasse', label: 'Nouveau mot de passe', type: 'password', required: true, placeholder: '6 caractères minimum' }],
        submitLabel: 'Réinitialiser',
        async onSubmit(d) {
          await post(`/users/${u.id}/mot-de-passe`, d);
          toast('Mot de passe réinitialisé');
        },
      });
    };
  });
  box.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async () => {
      const u = data.rows.find((r) => r.id === Number(b.dataset.del));
      if (!(await confirmDialog(u.actif ? `Désactiver le compte ${u.matricule} ?` : `Supprimer définitivement ${u.matricule} ?`))) return;
      try {
        const res = await del(`/users/${u.id}`);
        toast(res.message || 'OK');
        await load();
      } catch (e) { toast(e.message, 'error'); }
    };
  });

  document.getElementById('us-count').innerHTML = `<b>${data.total}</b> utilisateur(s)`;
}

export default {
  key: 'users',
  title: 'Utilisateurs',
  icon: '☺',
  section: 'Administration',
  roles: ['admin'],
  async render(container) {
    container.innerHTML = `
      <div class="toolbar no-print">
        <input class="input search" id="us-search" placeholder="Nom, matricule, e-mail...">
        <select class="select" id="us-role">
          <option value="">Tous les rôles</option>
          <option value="admin">Administrateur</option>
          <option value="gestionnaire">Gestionnaire de stock</option>
          <option value="responsable">Responsable</option>
        </select>
        <div class="spacer"></div>
        <button class="btn btn-primary" id="us-new">+ Nouvel utilisateur</button>
      </div>
      <div class="card"><div class="card-header"><h3 id="us-count"></h3></div>
      <div class="card-body tight" id="us-table"></div></div>`;

    document.getElementById('us-search').oninput = debounce((e) => { state.search = e.target.value; load(); }, 350);
    document.getElementById('us-role').onchange = (e) => { state.role = e.target.value; load(); };
    document.getElementById('us-new').onclick = () => userForm();
    await load();
  },
};
