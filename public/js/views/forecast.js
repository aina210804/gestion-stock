import { get, download } from '../api.js';
import { esc, fmtN, fmtAr, fmtQ, fmtDate, table, badge, toast } from '../ui.js';
import { lineChart, hBars } from '../charts.js';

const state = { months: 6 };

async function load() {
  const [f, serie] = await Promise.all([get(`/forecast?months=${state.months}`), get('/dashboard/series')]);
  const t = f.totaux;

  document.getElementById('fc-stats').innerHTML = `
    <div class="card kpi"><div class="ico bg-blue">Ar</div><div><div class="lib">Coût de consommation / mois</div>
      <div class="val">${fmtAr(t.cout_mensuel)}</div><div class="sub">moyenne sur ${f.mois_analyse} mois</div></div></div>
    <div class="card kpi"><div class="ico bg-cyan">◔</div><div><div class="lib">Projection à 3 mois</div>
      <div class="val">${fmtAr(t.projections[3])}</div><div class="sub">estimation des dépenses</div></div></div>
    <div class="card kpi"><div class="ico bg-orange">◑</div><div><div class="lib">Projection à 6 mois</div>
      <div class="val">${fmtAr(t.projections[6])}</div><div class="sub">horizon de planification</div></div></div>
    <div class="card kpi"><div class="ico bg-violet">◕</div><div><div class="lib">Projection à 12 mois</div>
      <div class="val">${fmtAr(t.projections[12])}</div><div class="sub">budget prévisionnel</div></div></div>`;

  lineChart(document.getElementById('fc-chart'), {
    labels: serie.mois.map((m) => m.mois.slice(5) + '/' + m.mois.slice(2, 4)),
    series: [
      { name: 'Valeur consommée', color: '#d97706', data: serie.mois.map((m) => m.consommation) },
      { name: 'Achats (entrées)', color: '#2f6fed', data: serie.mois.map((m) => m.achats) },
    ],
    yFmt: (v) => (v >= 1000000 ? (v / 1000000).toFixed(1) + ' M' : fmtN(Math.round(v / 1000)) + ' k'),
  });

  hBars(
    document.getElementById('fc-top'),
    f.articles.slice().sort((a, b) => b.cout_mensuel - a.cout_mensuel).slice(0, 8).map((a) => ({ label: a.nom, value: a.cout_mensuel })),
    { fmt: (v) => fmtAr(v) }
  );

  document.getElementById('fc-table').innerHTML = table({
    columns: [
      { key: 'reference', label: 'Référence', render: (r) => `<b>${esc(r.reference)}</b>` },
      { key: 'nom', label: 'Article' },
      { key: 'stock', label: 'Stock', num: true, render: (r) => fmtQ(r.stock) },
      { key: 'conso_totale', label: `Conso. ${state.months} mois`, num: true },
      { key: 'conso_mensuelle', label: 'Conso./mois', num: true },
      { key: 'conso_jour', label: 'Conso./jour', num: true, render: (r) => fmtQ(r.conso_jour) },
      { key: 'cout_mensuel', label: 'Coût/mois', num: true, render: (r) => `<b>${fmtAr(r.cout_mensuel)}</b>` },
      { key: 'p3', label: 'Besoin 3 mois', num: true, render: (r) => fmtN(r.projections[3].quantite) },
      { key: 'p6', label: 'Besoin 6 mois', num: true, render: (r) => fmtN(r.projections[6].quantite) },
      { key: 'p12', label: 'Besoin 12 mois', num: true, render: (r) => fmtN(r.projections[12].quantite) },
      {
        key: 'mois_critique',
        label: 'Rupture estimée',
        render: (r) => (r.mois_critique === null ? badge('jamais', 'ok') : r.mois_critique <= 15 ? badge(`${r.mois_critique} j`, 'danger') : r.mois_critique <= 45 ? badge(`${r.mois_critique} j`, 'warn') : badge(`${r.mois_critique} j`, 'info')),
      },
    ],
    rows: f.articles,
    empty: 'Aucune donnée de consommation',
  });

  document.getElementById('fc-title').innerHTML =
    `Prévisions sur <b>${f.mois_analyse} mois</b> (${fmtDate(f.debut + '-01')} → ${fmtDate(f.fin + '-01')})`;
}

export default {
  key: 'forecast',
  title: 'Prévision des dépenses',
  icon: '◈',
  section: 'Analyse',
  roles: ['admin', 'gestionnaire', 'responsable'],
  async render(container) {
    container.innerHTML = `
      <div class="toolbar no-print">
        <label class="hint">Période analysée</label>
        <select class="select" id="fc-months">
          <option value="3">3 mois</option>
          <option value="6" selected>6 mois</option>
          <option value="12">12 mois</option>
          <option value="24">24 mois</option>
        </select>
        <span class="hint" id="fc-title"></span>
        <div class="spacer"></div>
        <button class="btn" id="fc-export">Exporter CSV</button>
      </div>
      <div class="grid grid-4 mb" id="fc-stats"></div>
      <div class="grid grid-2 mb">
        <div class="card"><div class="card-header"><h3>Historique : achats vs consommation (6 mois)</h3></div>
          <div class="card-body"><div id="fc-chart"></div></div></div>
        <div class="card"><div class="card-header"><h3>Top 8 articles (coût mensuel)</h3></div>
          <div class="card-body"><div id="fc-top"></div></div></div>
      </div>
      <div class="card"><div class="card-header"><h3>Détail par article</h3></div>
        <div class="card-body tight" id="fc-table"></div></div>`;

    document.getElementById('fc-months').onchange = async (e) => {
      state.months = Number(e.target.value);
      try {
        await load();
      } catch (err) { toast(err.message, 'error'); }
    };
    document.getElementById('fc-export').onclick = () => download(`/forecast/export?months=${state.months}`, 'previsions.csv');
    await load();
  },
};
