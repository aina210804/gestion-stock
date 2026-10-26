const { all, get } = require('../db/database');
const { monthsAgo, fmtDate, round2, pad } = require('../utils/helpers');

function consumptionByArticle(months = 6) {
  const start = fmtDate(monthsAgo(months));
  return all(
    `SELECT a.id, a.reference, a.nom, a.unite, a.prix_unitaire, a.stock, a.seuil_alerte, a.stock_cible,
            COALESCE(SUM(CASE WHEN m.type IN ('SORTIE','CORRECTION') THEN m.quantite ELSE 0 END), 0) AS conso_totale,
            COUNT(CASE WHEN m.type = 'SORTIE' THEN 1 END) AS nb_sorties,
            COALESCE(SUM(CASE WHEN m.type = 'ENTREE' THEN m.cout ELSE 0 END), 0) AS achats
     FROM articles a
     LEFT JOIN mouvements m ON m.article_id = a.id AND m.date >= ?
     WHERE a.actif = 1
     GROUP BY a.id
     ORDER BY a.nom`,
    [start]
  );
}

function monthlySeries(months = 6) {
  const start = fmtDate(monthsAgo(months));
  return all(
    `SELECT substr(date, 1, 7) AS mois,
            COALESCE(SUM(CASE WHEN type = 'ENTREE' THEN cout ELSE 0 END), 0) AS achats,
            COALESCE(SUM(CASE WHEN type IN ('SORTIE','CORRECTION') THEN quantite ELSE 0 END), 0) AS sorties,
            COUNT(CASE WHEN type = 'SORTIE' THEN 1 END) AS nb_mouvements
     FROM mouvements
     WHERE date >= ?
     GROUP BY mois
     ORDER BY mois`,
    [start]
  );
}

function monthlyBreakdown(months = 6) {
  const start = fmtDate(monthsAgo(months));
  return all(
    `SELECT a.id AS article_id, a.nom AS article, a.reference, substr(m.date, 1, 7) AS mois,
            COALESCE(SUM(CASE WHEN m.type IN ('SORTIE','CORRECTION') THEN m.quantite ELSE 0 END), 0) AS conso
     FROM mouvements m
     JOIN articles a ON a.id = m.article_id
     WHERE m.date >= ? AND m.type IN ('SORTIE','CORRECTION')
     GROUP BY a.id, mois
     ORDER BY a.nom, mois`,
    [start]
  );
}

// Régression linéaire simple (moindres carrés) sur les mois observés
function regression(values) {
  const n = values.length;
  if (n === 0) return { a: 0, b: 0 };
  if (n === 1) return { a: values[0], b: 0 };
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  values.forEach((y, x) => {
    sx += x; sy += y; sxy += x * y; sxx += x * x;
  });
  const denom = n * sxx - sx * sx;
  const b = denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
  const a = (sy - b * sx) / n;
  return { a, b };
}

function buildForecast({ months = 6, horizon = null } = {}) {
  const horizons = horizon ? [horizon] : [3, 6, 12];
  const consos = consumptionByArticle(months);
  const breakdown = monthlyBreakdown(months);
  const serie = monthlySeries(months);

  const nbMois = Math.max(months, 1);
  const series = new Map();
  for (const row of breakdown) {
    if (!series.has(row.article_id)) series.set(row.article_id, new Map());
    series.get(row.article_id).set(row.mois, row.conso);
  }

  const moisCibles = [];
  const d = new Date();
  d.setDate(1);
  for (let i = months - 1; i >= 0; i--) {
    const x = new Date(d);
    x.setMonth(d.getMonth() - i);
    moisCibles.push(`${x.getFullYear()}-${pad(x.getMonth() + 1)}`);
  }

  const articles = consos.map((c) => {
    const map = series.get(c.id) || new Map();
    const valeurs = moisCibles.map((m) => map.get(m) || 0);
    const { a, b } = regression(valeurs);
    const consoMensuelle = c.conso_totale / nbMois;
    const consoJour = consoMensuelle / 30;
    const coutMensuel = consoMensuelle * c.prix_unitaire;
    const projections = {};
    for (const h of horizons) {
      const idx = valeurs.length - 1 + h;
      const qte = Math.max(0, Math.round(a + b * idx));
      const qteLineaire = Math.round(consoMensuelle * h);
      const quantite = Math.max(qte, 0) || qteLineaire;
      projections[h] = { quantite, cout: round2(quantite * c.prix_unitaire) };
    }
    const moisCritique = consoJour > 0 && c.stock > 0 ? Math.floor(c.stock / consoJour) : c.stock <= 0 ? 0 : null;
    return {
      article_id: c.id,
      reference: c.reference,
      nom: c.nom,
      unite: c.unite,
      prix_unitaire: c.prix_unitaire,
      stock: c.stock,
      seuil_alerte: c.seuil_alerte,
      conso_totale: c.conso_totale,
      nb_sorties: c.nb_sorties,
      conso_mensuelle: round2(consoMensuelle),
      conso_jour: round2(consoJour),
      cout_mensuel: round2(coutMensuel),
      tendance: round2(b),
      serie_mensuelle: valeurs,
      mois_critique: moisCritique,
      projections,
      projection_cout: round2(horizons.reduce((s, h) => s + projections[h].cout, 0) / horizons.length),
    };
  });

  const totaux = {
    cout_mensuel: round2(articles.reduce((s, x) => s + x.cout_mensuel, 0)),
    conso_mensuelle: round2(articles.reduce((s, x) => s + x.conso_mensuelle, 0)),
    projections: {},
    achats_periode: round2(serie.reduce((s, x) => s + x.achats, 0)),
  };
  for (const h of horizons) {
    totaux.projections[h] = round2(articles.reduce((s, x) => s + x.projections[h].cout, 0));
  }

  return {
    mois_analyse: months,
    horizons,
    debut: moisCibles[0],
    fin: moisCibles[moisCibles.length - 1],
    serie: serie.map((s) => ({ ...s, achats: round2(s.achats) })),
    mois_cibles: moisCibles,
    articles,
    totaux,
  };
}

function consumptionRanking(months = 6) {
  return buildForecast({ months }).articles
    .slice()
    .sort((x, y) => y.cout_mensuel - x.cout_mensuel);
}

module.exports = { buildForecast, consumptionByArticle, monthlySeries, monthlyBreakdown, regression, consumptionRanking };
