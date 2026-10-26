import { get, put, post } from '../api.js';
import { esc, toast, statutBadge, badge, fmtDateTime } from '../ui.js';

const LIBELLES = {
  SOCIETE: "Nom de l'entreprise",
  EMAIL_ALERTES: 'Destinataire des alertes e-mail',
  HORIZON_PREVISION_MOIS: 'Horizon de prévision (mois)',
  DELAI_FOURNISSEUR_JOURS: 'Délai de livraison fournisseur (jours)',
  MARGE_ALERTE_JOURS: "Marge d'alerte planification (jours)",
};

async function loadSettings() {
  const user = JSON.parse(sessionStorage.getItem('user') || '{}');
  const isAdmin = user.role === 'admin';
  const [{ rows }, info] = await Promise.all([get('/settings'), get('/settings/info')]);

  document.getElementById('st-form').innerHTML = rows
    .map(
      (s) => `<div class="form-group">
        <label class="field-label">${esc(LIBELLES[s.cle] || s.libelle || s.cle)}</label>
        <input class="input" style="width:100%" data-cle="${s.cle}" value="${esc(s.valeur)}" ${isAdmin ? '' : 'readonly'}>
        ${s.libelle ? `<div class="hint">${esc(s.libelle)}</div>` : ''}
      </div>`
    )
    .join('');

  document.getElementById('st-save').hidden = !isAdmin;
  document.getElementById('st-info').innerHTML = `
    <div class="stat-line"><span>Application</span><b>${esc(info.application)}</b></div>
    <div class="stat-line"><span>Version</span><b>${esc(info.version)}</b></div>
    <div class="stat-line"><span>Moteur</span><b>${esc(info.moteur)}</b></div>
    <div class="stat-line"><span>Entreprise</span><b>${esc(info.societe)}</b></div>`;
}

async function loadProfil() {
  const user = JSON.parse(sessionStorage.getItem('user') || '{}');
  document.getElementById('st-user').innerHTML = `
    <div class="detail-grid mb">
      <div><div class="k">Matricule</div><div class="v">${esc(user.matricule)}</div></div>
      <div><div class="k">Nom</div><div class="v">${esc(user.prenom)} ${esc(user.nom)}</div></div>
      <div><div class="k">E-mail</div><div class="v">${esc(user.email)}</div></div>
      <div><div class="k">Poste</div><div class="v">${esc(user.poste || '-')}</div></div>
      <div><div class="k">Rôle</div><div class="v">${statutBadge(user.role)}</div></div>
      <div><div class="k">Droits</div><div class="v" style="font-size:12px">${user.permissions.includes('*') ? 'Tous les droits' : user.permissions.length + ' droit(s)'}</div></div>
    </div>`;
  void fmtDateTime;
  void badge;
}

export default {
  key: 'settings',
  title: 'Paramètres',
  icon: '⚙',
  section: 'Administration',
  roles: ['admin', 'gestionnaire', 'responsable'],
  async render(container) {
    container.innerHTML = `
      <div class="grid grid-2">
        <div class="card">
          <div class="card-header"><h3>Mon profil</h3></div>
          <div class="card-body" id="st-user"></div>
        </div>
        <div class="card">
          <div class="card-header"><h3>Changer mon mot de passe</h3></div>
          <div class="card-body">
            <div class="form-group"><label class="field-label">Ancien mot de passe</label>
              <input class="input" type="password" id="pw-ancien" style="width:100%"></div>
            <div class="form-group"><label class="field-label">Nouveau mot de passe</label>
              <input class="input" type="password" id="pw-nouveau" style="width:100%" placeholder="6 caractères minimum"></div>
            <button class="btn btn-primary" id="pw-save">Mettre à jour</button>
          </div>
        </div>
      </div>

      <div class="card mt">
        <div class="card-header"><h3>Paramètres de l’application</h3></div>
        <div class="card-body">
          <div class="form-grid" id="st-form"></div>
          <button class="btn btn-primary" id="st-save">Enregistrer les paramètres</button>
        </div>
      </div>

      <div class="card mt">
        <div class="card-header"><h3>À propos</h3></div>
        <div class="card-body" id="st-info"></div>
      </div>`;

    document.getElementById('pw-save').onclick = async () => {
      try {
        await post('/auth/password', {
          ancien: document.getElementById('pw-ancien').value,
          nouveau: document.getElementById('pw-nouveau').value,
        });
        toast('Mot de passe modifié');
        document.getElementById('pw-ancien').value = '';
        document.getElementById('pw-nouveau').value = '';
      } catch (e) { toast(e.message, 'error'); }
    };

    document.getElementById('st-save').onclick = async () => {
      const body = {};
      document.querySelectorAll('[data-cle]').forEach((inp) => { body[inp.dataset.cle] = inp.value; });
      try {
        await put('/settings', body);
        toast('Paramètres enregistrés');
        await loadSettings();
      } catch (e) { toast(e.message, 'error'); }
    };

    await Promise.all([loadSettings(), loadProfil()]);
  },
};
