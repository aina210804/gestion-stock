import { get } from '../api.js';
import { esc, fmtN, fmtAr, fmtDate, statutBadge, table, badge } from '../ui.js';
import { lineChart, hBars, donut } from '../charts.js';

export default {
  key: 'dashboard',
  title: 'Tableau de bord',
  icon: '▦',
  section: 'Pilotage',
  roles: ['admin', 'gestionnaire', 'responsable'],
  async render(container) {
    const [d, alertes, mouvs] = await Promise.all([
      get('/dashboard'),
      get('/alerts?statut=ACTIVE&limit=6'),
      get('/movements?limit=6'),
    ]);
    const k = d.kpis;
    const variation = k.mois.variation_pct;

    container.innerHTML = `
      <div class="print-header"><h2>Tableau de bord</h2></div>
      <div class="grid grid-4 mb">
        <div class="card kpi">
          <div class="ico bg-blue">▤</div>
          <div><div class="lib">Valeur du stock</div><div class="val">${fmtAr(k.stock.valeur)}</div>
          <div class="sub">${fmtN(k.stock.articles)} articles · ${fmtN(k.stock.unites)} unités</div></div>
        </div>
        <div class="card kpi">
          <div class="ico bg-red">⚠</div>
          <div><div class="lib">Alertes actives</div><div class="val">${fmtN(d.alertes.total)}</div>
          <div class="sub">${d.alertes.rupture} rupture(s) · ${d.alertes.bas} stock bas</div></div>
        </div>
        <div class="card kpi">
          <div class="ico bg-green">↓</div>
          <div><div class="lib">Consommation du mois</div><div class="val">${fmtAr(k.mois.consommation)}</div>
          <div class="sub">${variation > 0 ? '▲' : '▼'} ${fmtN(Math.abs(variation), 1)} % vs mois précédent</div></div>
        </div>
        <div class="card kpi">
          <div class="ico bg-orange">▧</div>
          <div><div class="lib">Commandes en cours</div><div class="val">${fmtN(k.commandes.ouvertes)}</div>
          <div class="sub">Engagé : ${fmtAr(k.commandes.montant_engage)}</div></div>
        </div>
      </div>

      <div class="grid grid-3 mb">
        <div class="card" style="grid-column:span 2">
          <div class="card-header"><h3>Mouvements des 30 derniers jours</h3></div>
          <div class="card-body"><div id="ch-mouvements"></div></div>
        </div>
        <div class="card">
          <div class="card-header"><h3>État des stocks</h3></div>
          <div class="card-body"><div id="ch-etat"></div></div>
        </div>
      </div>

      <div class="grid grid-3">
        <div class="card" style="grid-column:span 2">
          <div class="card-header"><h3>Top consommation (6 mois, valeur)</h3></div>
          <div class="card-body"><div id="ch-top"></div></div>
        </div>
        <div class="card">
          <div class="card-header"><h3>Dépenses mensuelles</h3></div>
          <div class="card-body"><div id="ch-depenses"></div></div>
        </div>
      </div>

      <div class="grid grid-2 mt">
        <div class="card">
          <div class="card-header"><h3>Alertes récentes</h3><a href="#/alerts" class="btn btn-sm btn-ghost">Tout voir</a></div>
          <div class="card-body tight" id="list-alertes"></div>
        </div>
        <div class="card">
          <div class="card-header"><h3>Approvisionnements prioritaires</h3><a href="#/planning" class="btn btn-sm btn-ghost">Planifier</a></div>
          <div class="card-body tight" id="list-planning"></div>
        </div>
      </div>

      <div class="card mt">
        <div class="card-header"><h3>Derniers mouvements</h3><a href="#/movements" class="btn btn-sm btn-ghost">Historique</a></div>
        <div class="card-body tight" id="list-mouvements"></div>
      </div>`;

    lineChart(container.querySelector('#ch-mouvements'), {
      labels: d.series.mouvements30.map((m) => fmtDate(m.jour).slice(0, 5)),
      series: [
        { name: 'Sorties (qtés)', color: '#dc2626', data: d.series.mouvements30.map((m) => m.sorties) },
        { name: 'Entrées (qtés)', color: '#16a34a', data: d.series.mouvements30.map((m) => m.entrees) },
      ],
    });

    const etatMap = { Rupture: '#dc2626', 'Stock bas': '#d97706', Suffisant: '#16a34a' };
    const etat = ['Rupture', 'Stock bas', 'Suffisant'].map((lib) => ({
      label: lib,
      color: etatMap[lib],
      value: (d.series.etat.find((e) => e.libelle === lib) || {}).n || 0,
    }));
    donut(container.querySelector('#ch-etat'), etat, {
      center: String(k.stock.articles),
      sub: 'articles actifs',
    });

    hBars(
      container.querySelector('#ch-top'),
      d.series.topConsommation.map((t) => ({ label: t.nom, value: t.cout })),
      { fmt: (v) => fmtAr(v) }
    );

    lineChart(container.querySelector('#ch-depenses'), {
      height: 200,
      labels: d.series.mois.map((m) => m.mois.slice(5) + '/' + m.mois.slice(2, 4)),
      series: [
        { name: 'Achats (entrées)', color: '#2f6fed', data: d.series.mois.map((m) => m.achats) },
        { name: 'Valeur consommée', color: '#d97706', data: d.series.mois.map((m) => m.consommation) },
      ],
      yFmt: (v) => (v >= 1000000 ? (v / 1000000).toFixed(1) + ' M' : fmtN(Math.round(v / 1000)) + ' k'),
    });

    container.querySelector('#list-alertes').innerHTML = alertes.rows.length
      ? alertes.rows
          .slice(0, 6)
          .map(
            (a) => `<div class="list-item" style="padding:11px 16px">
              <div class="grow"><b>${esc(a.article_nom)}</b> <span class="muted">(${esc(a.reference)})</span>
                <div class="muted" style="font-size:12px">${esc(a.message)}</div></div>
              ${statutBadge(a.type)}
            </div>`
          )
          .join('')
      : '<div class="empty">Aucune alerte active</div>';

    container.querySelector('#list-planning').innerHTML = d.planning.top.length
      ? d.planning.top
          .map(
            (p) => `<div class="list-item" style="padding:11px 16px">
              <div class="grow"><b>${esc(p.article_nom)}</b>
                <div class="muted" style="font-size:12px">Besoin le ${fmtDate(p.besoin_le)} · ${esc(p.raison)}</div></div>
              <div class="right"><div>${fmtN(p.quantite_suggeree)}</div><div class="muted" style="font-size:11.5px">${fmtAr(p.montant_estime)}</div></div>
            </div>`
          )
          .join('')
      : '<div class="empty">Aucun besoin détecté</div>';

    container.querySelector('#list-mouvements').innerHTML = table({
      columns: [
        { key: 'date', label: 'Date', render: (r) => fmtDate(r.date) },
        { key: 'type', label: 'Type', render: (r) => statutBadge(r.type) },
        { key: 'article_nom', label: 'Article', render: (r) => `<b>${esc(r.article_nom)}</b> <span class="muted">${esc(r.article_reference)}</span>` },
        {
          key: 'quantite',
          label: 'Quantité',
          num: true,
          render: (r) => `${r.type === 'SORTIE' ? '-' : r.type === 'ENTREE' ? '+' : ''}${fmtN(r.quantite)}`,
        },
        { key: 'stock_apres', label: 'Stock après', num: true, render: (r) => fmtN(r.stock_apres) },
        {
          key: 'user',
          label: 'Opérateur',
          render: (r) => (r.matricule ? `${esc(r.matricule)} · ${esc(r.user_prenom)} ${esc(r.user_nom)}` : '<span class="muted">-</span>'),
        },
      ],
      rows: mouvs.rows,
      empty: 'Aucun mouvement',
    });
    void badge;
  },
};
