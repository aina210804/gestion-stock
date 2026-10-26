import { get, download } from '../api.js';
import { esc, fmtN, fmtAr, fmtQ, fmtDate, table, toast } from '../ui.js';

const state = { code: 'stock', months: 6, debut: '', fin: '' };

function fmtVal(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? fmtN(v) : fmtQ(v);
  return v ?? '-';
}

async function load() {
  const params = new URLSearchParams();
  if (state.debut) params.set('debut', state.debut);
  if (state.fin) params.set('fin', state.fin);
  if (state.months) params.set('months', state.months);
  if (state.type) params.set('type', state.type);

  const data = await get(`/reports/${state.code}/apercu?${params}`);
  const cols = data.colonnes || data.columns;

  const summary = Object.entries(data.summary || {})
    .filter(([, v]) => v === null || typeof v !== 'object')
    .map(
      ([k, v]) => `<div class="card kpi" style="padding:13px 15px"><div>
        <div class="lib">${esc(k.replace(/_/g, ' '))}</div>
        <div class="val" style="font-size:17px">${typeof v === 'number' && (k.includes('cout') || k.includes('achats') || k.includes('consommation') || k.includes('montant') || k.includes('valeur')) ? fmtAr(v) : fmtVal(v)}</div>
      </div></div>`
    )
    .join('');

  document.getElementById('rp-summary').innerHTML = summary || '';
  document.getElementById('rp-print-title').innerHTML = `
    <h3>${esc(data.titre)}</h3>
    <div class="muted">${esc(data.societe || '')} · période du ${fmtDate(data.debut || data.summary?.debut)} au ${fmtDate(data.fin || data.summary?.fin)} ·
    généré le ${fmtDate(data.genere_le)} par ${esc(data.genere_par || '-')}</div>`;

  document.getElementById('rp-table').innerHTML = table({
    columns: cols.map((c) => ({
      key: c.key,
      label: c.label,
      num: typeof (data.rows[0] || {})[c.key] === 'number',
      render: (r) => {
        const v = r[c.key];
        if (v === null || v === undefined || v === '') return '<span class="muted">-</span>';
        if (typeof v === 'number' && /cout|montant|valeur|achats|consommation|prix/i.test(c.key)) return fmtAr(v);
        if (typeof v === 'number') return fmtQ(v);
        if (/statut|type|priorite/i.test(c.key)) return `<span class="badge neutral">${esc(String(v))}</span>`;
        return esc(v);
      },
    })),
    rows: data.rows,
    empty: 'Aucune donnée pour cette période',
  });

  document.getElementById('rp-count').innerHTML = `<b>${data.rows.length}</b> ligne(s) · ${esc(data.titre)}`;
}

export default {
  key: 'reports',
  title: 'Rapports & statistiques',
  icon: '◫',
  section: 'Analyse',
  roles: ['admin', 'gestionnaire', 'responsable'],
  async render(container) {
    const meta = await get('/reports');
    container.innerHTML = `
      <div class="print-header" id="rp-print-title"></div>
      <div class="toolbar no-print">
        <select class="select" id="rp-code">
          ${meta.rapports.map((r) => `<option value="${r.code}">${esc(r.libelle)}</option>`).join('')}
        </select>
        <select class="select" id="rp-months">
          <option value="1">1 mois</option>
          <option value="3">3 mois</option>
          <option value="6" selected>6 mois</option>
          <option value="12">12 mois</option>
        </select>
        <input class="input" type="date" id="rp-debut" title="Date de début">
        <span class="hint">au</span>
        <input class="input" type="date" id="rp-fin" title="Date de fin">
        <div class="spacer"></div>
        <button class="btn" id="rp-csv">Exporter CSV</button>
        <button class="btn btn-primary" id="rp-print">Imprimer</button>
      </div>
      <div class="grid grid-4 mb" id="rp-summary"></div>
      <div class="card">
        <div class="card-header"><h3 id="rp-count"></h3></div>
        <div class="card-body tight" id="rp-table"></div>
      </div>`;

    document.getElementById('rp-code').onchange = (e) => { state.code = e.target.value; load().catch((err) => toast(err.message, 'error')); };
    document.getElementById('rp-months').onchange = (e) => { state.months = Number(e.target.value); state.debut = ''; state.fin = ''; document.getElementById('rp-debut').value = ''; document.getElementById('rp-fin').value = ''; load().catch((err) => toast(err.message, 'error')); };
    document.getElementById('rp-debut').onchange = (e) => { state.debut = e.target.value; load().catch((err) => toast(err.message, 'error')); };
    document.getElementById('rp-fin').onchange = (e) => { state.fin = e.target.value; load().catch((err) => toast(err.message, 'error')); };
    document.getElementById('rp-csv').onclick = () => {
      const p = new URLSearchParams({ months: state.months });
      if (state.debut) p.set('debut', state.debut);
      if (state.fin) p.set('fin', state.fin);
      download(`/reports/${state.code}?format=csv&${p}`, `${state.code}.csv`);
    };
    document.getElementById('rp-print').onclick = () => window.print();
    await load();
  },
};
