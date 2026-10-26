export const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const fmtN = (n, d = 0) =>
  Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });

export const fmtAr = (n) => fmtN(Math.round(Number(n || 0))) + ' Ar';

export const fmtDate = (s) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '-');

export const fmtDateTime = (s) => (s ? String(s).slice(0, 16).replace(' ', ' à ') : '-');

export const fmtQ = (q) => (Number.isInteger(Number(q)) ? fmtN(q) : fmtN(q, 2));

export function toast(message, type = 'success', ms = 3200) {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

export function closeModal() {
  document.getElementById('modal-root').innerHTML = '';
}

export function modal({ title, body, footer = '', wide = false, onOpen }) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-backdrop" data-close="1">
      <div class="modal ${wide ? 'wide' : ''}" role="dialog">
        <div class="modal-header">
          <h3>${title}</h3>
          <button class="btn-icon" data-close="1" title="Fermer">✕</button>
        </div>
        <div class="modal-body">${body}</div>
        ${footer ? `<div class="modal-footer">${footer}</div>` : ''}
      </div>
    </div>`;
  root.querySelectorAll('[data-close]').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (e.target === el) closeModal();
    });
  });
  if (onOpen) onOpen(root);
  return root;
}

export function confirmDialog(message, { title = 'Confirmation', confirmLabel = 'Confirmer', danger = true } = {}) {
  return new Promise((resolve) => {
    modal({
      title,
      body: `<p style="margin:0;font-size:14px">${esc(message)}</p>`,
      footer: `
        <button class="btn" id="cf-no">Annuler</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="cf-yes">${esc(confirmLabel)}</button>`,
      onOpen(root) {
        root.querySelector('#cf-no').onclick = () => { closeModal(); resolve(false); };
        root.querySelector('#cf-yes').onclick = () => { closeModal(); resolve(true); };
      },
    });
  });
}

// Génère un formulaire en modale. fields = [{name,label,type,value,options,required,placeholder,step,min,span}]
export function formModal({ title, fields, submitLabel = 'Enregistrer', onSubmit, wide = false }) {
  const html = fields
    .map((f) => {
      const val = f.value ?? '';
      const req = f.required ? 'required' : '';
      let control = '';
      if (f.type === 'select') {
        const opts = (f.options || [])
          .map((o) => {
            const v = o.value ?? o;
            const l = o.label ?? o;
            return `<option value="${esc(v)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(l)}</option>`;
          })
          .join('');
        control = `<select class="select" name="${f.name}" ${req} style="width:100%">${f.placeholder ? `<option value="">${esc(f.placeholder)}</option>` : ''}${opts}</select>`;
      } else if (f.type === 'textarea') {
        control = `<textarea class="input" name="${f.name}" rows="3" style="width:100%" ${req}>${esc(val)}</textarea>`;
      } else {
        control = `<input class="input" type="${f.type || 'text'}" name="${f.name}" value="${esc(val)}"
          ${req} placeholder="${esc(f.placeholder || '')}" ${f.step ? `step="${f.step}"` : ''} ${f.min !== undefined ? `min="${f.min}"` : ''}
          ${f.readonly ? 'readonly' : ''} style="width:100%">`;
      }
      return `<div class="form-group" ${f.span ? `style="grid-column:span ${f.span}"` : ''}>
        <label class="field-label">${esc(f.label)}${f.required ? ' *' : ''}</label>${control}
      </div>`;
    })
    .join('');

  modal({
    title,
    wide,
    body: `<form id="fm-form"><div class="form-grid">${html}</div>
      <div class="form-error-inline" id="fm-error" hidden></div></form>`,
    footer: `<button class="btn" id="fm-cancel">Annuler</button>
             <button class="btn btn-primary" id="fm-submit">${esc(submitLabel)}</button>`,
    onOpen(root) {
      const form = root.querySelector('#fm-form');
      const errEl = root.querySelector('#fm-error');
      const submit = async () => {
        const data = {};
        new FormData(form).forEach((v, k) => {
          data[k] = v;
        });
        root.querySelector('#fm-submit').disabled = true;
        try {
          await onSubmit(data, form);
          closeModal();
        } catch (err) {
          errEl.textContent = err.message;
          errEl.hidden = false;
          root.querySelector('#fm-submit').disabled = false;
        }
      };
      root.querySelector('#fm-submit').onclick = (e) => { e.preventDefault(); submit(); };
      root.querySelector('#fm-cancel').onclick = closeModal;
      form.onsubmit = (e) => { e.preventDefault(); submit(); };
      const first = form.querySelector('input:not([readonly]), select, textarea');
      if (first) first.focus();
    },
  });
}

// table({columns:[{key,label,num,render}], rows, empty, actions(row)->html, onRowClick})
export function table({ columns, rows, empty = 'Aucune donnée', actions = null }) {
  if (!rows || rows.length === 0) return `<div class="empty">${empty}</div>`;
  const head = columns.map((c) => `<th class="${c.num ? 'num' : ''}">${esc(c.label)}</th>`).join('');
  const act = actions ? '<th class="num">Actions</th>' : '';
  const body = rows
    .map((r) => {
      const cells = columns
        .map((c) => {
          const content = c.render ? c.render(r) : esc(r[c.key]);
          return `<td class="${c.num ? 'num' : ''}">${content}</td>`;
        })
        .join('');
      const a = actions ? `<td class="actions">${actions(r)}</td>` : '';
      return `<tr data-id="${r.id ?? ''}">${cells}${a}</tr>`;
    })
    .join('');
  return `<div class="table-wrap"><table class="table"><thead><tr>${head}${act}</tr></thead><tbody>${body}</tbody></table></div>`;
}

export function badge(text, kind) {
  return `<span class="badge ${kind}">${esc(text)}</span>`;
}

export const statutBadge = (s) => {
  const map = {
    RUPTURE: 'danger', STOCK_BAS: 'warn', BAS: 'warn', OK: 'ok',
    BROUILLON: 'neutral', VALIDEE: 'info', PARTIELLE: 'warn', RECUE: 'ok', ANNULEE: 'danger',
    ACTIVE: 'danger', RESOLUE: 'ok',
    HAUTE: 'danger', MOYENNE: 'warn', BASSE: 'info',
    A_COMMANDER: 'warn', EN_COMMANDE: 'info', TRAITE: 'ok',
    ENTREE: 'ok', SORTIE: 'warn', CORRECTION: 'violet',
    OUVERT: 'info', CLOTURE: 'neutral',
    admin: 'violet', gestionnaire: 'info', responsable: 'ok',
  };
  return badge((s || '').toString().replace(/_/g, ' '), map[s] || 'neutral');
};

export function hasPerm(user, perm) {
  if (!user) return false;
  if (user.permissions.includes('*')) return true;
  return user.permissions.includes(perm);
}

export const debounce = (fn, ms = 300) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
};

export function fieldSelect(values, label = 'Tous') {
  return values;
}
