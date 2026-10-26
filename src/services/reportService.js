const { all, get } = require('../db/database');
const { monthsAgo, fmtDate, round2 } = require('../utils/helpers');
const { buildForecast } = require('./forecastService');

function periode(filters = {}) {
  const months = Number(filters.months) || 6;
  const debut = filters.debut || fmtDate(monthsAgo(months));
  const fin = filters.fin || fmtDate(new Date());
  return { debut, fin, months };
}

function rapportStock(filters = {}) {
  const rows = all(
    `SELECT a.reference, a.nom, c.nom AS categorie, f.nom AS fournisseur, a.unite, a.stock, a.seuil_alerte,
            a.prix_unitaire, ROUND(a.stock * a.prix_unitaire, 2) AS valeur_stock, a.emplacement,
            CASE WHEN a.stock <= 0 THEN 'RUPTURE'
                 WHEN a.stock <= a.seuil_alerte THEN 'STOCK BAS'
                 ELSE 'OK' END AS statut,
            a.actif
     FROM articles a
     LEFT JOIN categories c ON c.id = a.categorie_id
     LEFT JOIN fournisseurs f ON f.id = a.fournisseur_id
     ${filters.actif ? 'WHERE a.actif = 1' : ''}
     ORDER BY statut = 'RUPTURE' DESC, a.stock * a.prix_unitaire DESC, a.nom`
  );
  const summary = {
    nb_articles: rows.length,
    valeur_totale: round2(rows.reduce((s, r) => s + r.valeur_stock, 0)),
    ruptures: rows.filter((r) => r.statut === 'RUPTURE').length,
    stock_bas: rows.filter((r) => r.statut === 'STOCK BAS').length,
    quantite_totale: rows.reduce((s, r) => s + r.stock, 0),
  };
  const columns = [
    { key: 'reference', label: 'Référence' },
    { key: 'nom', label: 'Article' },
    { key: 'categorie', label: 'Catégorie' },
    { key: 'fournisseur', label: 'Fournisseur' },
    { key: 'unite', label: 'Unité' },
    { key: 'stock', label: 'Stock' },
    { key: 'seuil_alerte', label: 'Seuil' },
    { key: 'prix_unitaire', label: 'Prix unitaire' },
    { key: 'valeur_stock', label: 'Valeur stock' },
    { key: 'emplacement', label: 'Emplacement' },
    { key: 'statut', label: 'Statut' },
  ];
  return { rows, columns, summary, titre: 'État des stocks' };
}

function rapportConsommation(filters = {}) {
  const { debut, fin, months } = periode(filters);
  const rows = all(
    `SELECT a.reference, a.nom, a.unite, a.prix_unitaire,
            SUM(CASE WHEN m.type = 'SORTIE' THEN m.quantite ELSE 0 END) AS sorties,
            SUM(CASE WHEN m.type = 'CORRECTION' THEN m.quantite ELSE 0 END) AS corrections,
            COUNT(CASE WHEN m.type = 'SORTIE' THEN 1 END) AS nb_sorties,
            ROUND(SUM(CASE WHEN m.type IN ('SORTIE','CORRECTION') THEN m.quantite ELSE 0 END) * a.prix_unitaire, 2) AS cout_conso
     FROM mouvements m
     JOIN articles a ON a.id = m.article_id
     WHERE m.date >= ? AND m.date <= ? AND m.type IN ('SORTIE','CORRECTION')
     GROUP BY a.id
     ORDER BY cout_conso DESC`,
    [`${debut} 00:00:00`, `${fin} 23:59:59`]
  );
  const total = round2(rows.reduce((s, r) => s + r.cout_conso, 0));
  rows.forEach((r) => { r.part_pct = total > 0 ? round2((r.cout_conso / total) * 100) : 0; r.moyenne_mensuelle = round2((Number(r.sorties) + Number(r.corrections)) / Math.max(months, 1)); });
  const summary = {
    debut, fin, mois: months,
    nb_articles: rows.length,
    cout_total: total,
    quantite_totale: rows.reduce((s, r) => s + r.sorties + r.corrections, 0),
    top: rows.slice(0, 5).map((r) => r.nom),
  };
  const columns = [
    { key: 'reference', label: 'Référence' },
    { key: 'nom', label: 'Article' },
    { key: 'unite', label: 'Unité' },
    { key: 'sorties', label: 'Sorties' },
    { key: 'corrections', label: 'Corrections' },
    { key: 'nb_sorties', label: 'Nb mouvements' },
    { key: 'moyenne_mensuelle', label: 'Moyenne/mois' },
    { key: 'cout_conso', label: 'Coût consommation' },
    { key: 'part_pct', label: 'Part %' },
  ];
  return { rows, columns, summary, titre: 'Consommation par article' };
}

function rapportDepenses(filters = {}) {
  const { debut, fin, months } = periode(filters);
  const parMois = all(
    `SELECT substr(date, 1, 7) AS mois,
            ROUND(SUM(CASE WHEN type = 'ENTREE' THEN cout ELSE 0 END), 2) AS achats,
            ROUND(SUM(CASE WHEN type = 'ENTREE' THEN quantite ELSE 0 END), 0) AS articles_recus,
            ROUND(SUM(CASE WHEN type = 'SORTIE' THEN cout ELSE 0 END), 2) AS consommation,
            COUNT(CASE WHEN type = 'ENTREE' THEN 1 END) AS nb_achats
     FROM mouvements
     WHERE date >= ? AND date <= ?
     GROUP BY mois ORDER BY mois`,
    [`${debut} 00:00:00`, `${fin} 23:59:59`]
  );
  const parFournisseur = all(
    `SELECT f.nom AS fournisseur, COUNT(DISTINCT b.id) AS nb_commandes,
            ROUND(COALESCE(SUM(DISTINCT b.total), 0), 2) AS montant_commandes
     FROM bons_commande b
     LEFT JOIN fournisseurs f ON f.id = b.fournisseur_id
     WHERE b.date_commande >= ? AND b.date_commande <= ? AND b.statut NOT IN ('ANNULEE')
     GROUP BY f.nom ORDER BY montant_commandes DESC`,
    [debut, fin]
  );
  const rows = parMois.map((r) => ({ ...r, economie: round2(r.achats - r.consommation) }));
  const summary = {
    debut, fin, mois: months,
    total_achats: round2(rows.reduce((s, r) => s + r.achats, 0)),
    total_consommation: round2(rows.reduce((s, r) => s + r.consommation, 0)),
    moyenne_mensuelle: round2(rows.reduce((s, r) => s + r.achats, 0) / Math.max(rows.length, 1)),
    nb_commandes: parFournisseur.reduce((s, r) => s + r.nb_commandes, 0),
    fournisseurs: parFournisseur,
  };
  const columns = [
    { key: 'mois', label: 'Mois' },
    { key: 'achats', label: 'Achats (entrées)' },
    { key: 'articles_recus', label: 'Articles reçus' },
    { key: 'nb_achats', label: 'Nb entrées' },
    { key: 'consommation', label: 'Valeur consommée' },
    { key: 'economie', label: 'Écart achats/consommation' },
  ];
  return { rows, columns, summary, titre: 'Dépenses' };
}

function rapportMouvements(filters = {}) {
  const { debut, fin } = periode(filters);
  const rows = all(
    `SELECT m.date, m.type, a.reference, a.nom AS article, m.quantite, m.stock_apres,
            m.prix_unitaire, m.cout, m.motif, m.reference_doc,
            COALESCE(u.matricule, '-') AS matricule, COALESCE(u.prenom || ' ' || u.nom, '-') AS utilisateur
     FROM mouvements m
     JOIN articles a ON a.id = m.article_id
     LEFT JOIN users u ON u.id = m.user_id
     WHERE m.date >= ? AND m.date <= ? ${filters.type ? 'AND m.type = ?' : ''}
     ORDER BY m.date DESC, m.id DESC
     LIMIT 2000`,
    filters.type ? [`${debut} 00:00:00`, `${fin} 23:59:59`, filters.type] : [`${debut} 00:00:00`, `${fin} 23:59:59`]
  );
  const summary = {
    debut, fin,
    nb: rows.length,
    entrees: rows.filter((r) => r.type === 'ENTREE').length,
    sorties: rows.filter((r) => r.type === 'SORTIE').length,
    corrections: rows.filter((r) => r.type === 'CORRECTION').length,
    cout_entrees: round2(rows.filter((r) => r.type === 'ENTREE').reduce((s, r) => s + (r.cout || 0), 0)),
  };
  const columns = [
    { key: 'date', label: 'Date' },
    { key: 'type', label: 'Type' },
    { key: 'reference', label: 'Référence' },
    { key: 'article', label: 'Article' },
    { key: 'quantite', label: 'Quantité' },
    { key: 'stock_apres', label: 'Stock après' },
    { key: 'prix_unitaire', label: 'Prix unitaire' },
    { key: 'cout', label: 'Coût' },
    { key: 'motif', label: 'Motif' },
    { key: 'reference_doc', label: 'Réf. document' },
    { key: 'matricule', label: 'Matricule' },
    { key: 'utilisateur', label: 'Utilisateur' },
  ];
  return { rows, columns, summary, titre: 'Mouvements de stock' };
}

function rapportApprovisionnement() {
  const f = buildForecast({ months: 6 });
  const rows = f.articles.map((a) => ({
    reference: a.reference,
    nom: a.nom,
    stock: a.stock,
    seuil_alerte: a.seuil_alerte,
    conso_mensuelle: a.conso_mensuelle,
    conso_jour: a.conso_jour,
    cout_mensuel: a.cout_mensuel,
    projection_3: a.projections[3] ? a.projections[3].quantite : 0,
    projection_6: a.projections[6] ? a.projections[6].quantite : 0,
    projection_12: a.projections[12] ? a.projections[12].quantite : 0,
    cout_projection_6: a.projections[6] ? a.projections[6].cout : 0,
    mois_critique: a.mois_critique,
  })).sort((x, y) => y.cout_mensuel - x.cout_mensuel);
  const summary = {
    cout_mensuel: f.totaux.cout_mensuel,
    projection_6_mois: f.totaux.projections[6],
    projection_12_mois: f.totaux.projections[12],
    achats_periode: f.totaux.achats_periode,
    debut: f.debut,
    fin: f.fin,
  };
  const columns = [
    { key: 'reference', label: 'Référence' },
    { key: 'nom', label: 'Article' },
    { key: 'stock', label: 'Stock' },
    { key: 'conso_mensuelle', label: 'Conso/mois' },
    { key: 'conso_jour', label: 'Conso/jour' },
    { key: 'cout_mensuel', label: 'Coût/mois' },
    { key: 'projection_3', label: 'Besoin 3 mois' },
    { key: 'projection_6', label: 'Besoin 6 mois' },
    { key: 'projection_12', label: 'Besoin 12 mois' },
    { key: 'cout_projection_6', label: 'Coût projection 6 mois' },
    { key: 'mois_critique', label: 'Rupture estimée (jours)' },
  ];
  return { rows, columns, summary, titre: 'Prévision des dépenses' };
}

function rapportAlertes(filters = {}) {
  const rows = all(
    `SELECT al.created_at, al.type, al.message, al.statut, al.stock, al.seuil,
            a.reference, a.nom AS article, a.emplacement,
            COALESCE(u.prenom || ' ' || u.nom, '-') AS declarant
     FROM alertes al
     JOIN articles a ON a.id = al.article_id
     LEFT JOIN users u ON u.id = al.user_id
     ${filters.statut ? 'WHERE al.statut = ?' : ''}
     ORDER BY al.created_at DESC
     LIMIT 2000`,
    filters.statut ? [filters.statut] : []
  );
  const summary = {
    nb: rows.length,
    actives: rows.filter((r) => r.statut === 'ACTIVE').length,
    resolues: rows.filter((r) => r.statut === 'RESOLUE').length,
    ruptures: rows.filter((r) => r.type === 'RUPTURE').length,
  };
  const columns = [
    { key: 'created_at', label: 'Date' },
    { key: 'type', label: 'Type' },
    { key: 'reference', label: 'Référence' },
    { key: 'article', label: 'Article' },
    { key: 'message', label: 'Message' },
    { key: 'statut', label: 'Statut' },
    { key: 'declarant', label: 'Déclaré par' },
  ];
  return { rows, columns, summary, titre: 'Alertes de stock' };
}

function kpis() {
  const moisCourant = `${fmtDate(new Date()).slice(0, 7)}%`;
  const moisPrec = new Date();
  moisPrec.setMonth(moisPrec.getMonth() - 1);
  const moisPrecStr = `${fmtDate(moisPrec).slice(0, 7)}%`;

  const stock = get(
    `SELECT COUNT(*) AS articles, COALESCE(SUM(stock * prix_unitaire), 0) AS valeur,
            COALESCE(SUM(stock), 0) AS unites
     FROM articles WHERE actif = 1`
  );
  const alertes = {
    ruptures: get("SELECT COUNT(*) AS n FROM alertes WHERE statut = 'ACTIVE' AND type = 'RUPTURE'").n,
    bas: get("SELECT COUNT(*) AS n FROM alertes WHERE statut = 'ACTIVE' AND type = 'STOCK_BAS'").n,
    resolues_jour: get("SELECT COUNT(*) AS n FROM alertes WHERE statut = 'RESOLUE' AND date(resolved_at) = date('now','localtime')").n,
  };
  const mouvementsMois = get(
    `SELECT
       COALESCE(SUM(CASE WHEN type = 'ENTREE' THEN quantite END), 0) AS entrees_qte,
       COALESCE(SUM(CASE WHEN type = 'SORTIE' THEN quantite END), 0) AS sorties_qte,
       COALESCE(SUM(CASE WHEN type = 'ENTREE' THEN cout END), 0) AS entrees_valeur,
       COUNT(*) AS nb
     FROM mouvements WHERE date LIKE ?`,
    [moisCourant]
  );
  const consommationMois = get(
    `SELECT COALESCE(SUM(cout), 0) AS valeur, COUNT(*) AS nb
     FROM mouvements WHERE type = 'SORTIE' AND date LIKE ?`,
    [moisCourant]
  );
  const consommationPrec = get(
    `SELECT COALESCE(SUM(cout), 0) AS valeur FROM mouvements WHERE type = 'SORTIE' AND date LIKE ?`,
    [moisPrecStr]
  );
  const commandes = {
    ouvertes: get("SELECT COUNT(*) AS n FROM bons_commande WHERE statut IN ('BROUILLON','VALIDEE','PARTIELLE')").n,
    a_valider: get("SELECT COUNT(*) AS n FROM bons_commande WHERE statut = 'BROUILLON'").n,
    montant_engage: get("SELECT COALESCE(SUM(total),0) AS n FROM bons_commande WHERE statut IN ('VALIDEE','PARTIELLE')").n,
    recues_mois: get("SELECT COUNT(*) AS n FROM bons_commande WHERE statut = 'RECUE' AND date_commande LIKE ?", [moisCourant]).n,
  };
  const variation = consommationPrec.valeur > 0
    ? round2(((consommationMois.valeur - consommationPrec.valeur) / consommationPrec.valeur) * 100)
    : 0;

  return {
    stock: { articles: stock.articles, valeur: round2(stock.valeur), unites: stock.unites },
    alertes,
    mois: {
      entrees_qte: mouvementsMois.entrees_qte,
      sorties_qte: mouvementsMois.sorties_qte,
      entrees_valeur: round2(mouvementsMois.entrees_valeur),
      consommation: round2(consommationMois.valeur),
      consommation_precedente: round2(consommationPrec.valeur),
      variation_pct: variation,
      nb_mouvements: mouvementsMois.nb,
    },
    commandes,
  };
}

function series() {
  const jours = [...Array(30)].map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (29 - i));
    return fmtDate(d);
  });
  const parJour = all(
    `SELECT date(date) AS jour,
            COALESCE(SUM(CASE WHEN type = 'ENTREE' THEN quantite END), 0) AS entrees,
            COALESCE(SUM(CASE WHEN type = 'SORTIE' THEN quantite END), 0) AS sorties,
            COALESCE(SUM(CASE WHEN type = 'SORTIE' THEN cout END), 0) AS consommation
     FROM mouvements WHERE date >= ?
     GROUP BY jour`,
    [jours[0]]
  );
  const map = new Map(parJour.map((r) => [r.jour, r]));
  const mouvements30 = jours.map((j) => {
    const r = map.get(j) || {};
    return { jour: j, entrees: r.entrees || 0, sorties: r.sorties || 0, consommation: round2(r.consommation || 0) };
  });

  const mois = all(
    `SELECT substr(date, 1, 7) AS mois,
            ROUND(COALESCE(SUM(CASE WHEN type = 'ENTREE' THEN cout ELSE 0 END), 0), 2) AS achats,
            ROUND(COALESCE(SUM(CASE WHEN type = 'SORTIE' THEN cout ELSE 0 END), 0), 2) AS consommation
     FROM mouvements WHERE date >= ?
     GROUP BY mois ORDER BY mois`,
    [fmtDate(monthsAgo(6))]
  );

  const etat = all(
    `SELECT CASE WHEN stock <= 0 THEN 'Rupture'
                 WHEN stock <= seuil_alerte THEN 'Stock bas'
                 ELSE 'Suffisant' END AS libelle, COUNT(*) AS n
     FROM articles WHERE actif = 1 GROUP BY libelle`
  );

  const topConsommation = buildForecast({ months: 6 }).articles
    .slice()
    .sort((a, b) => b.cout_mensuel - a.cout_mensuel)
    .slice(0, 7)
    .map((a) => ({ nom: a.nom, reference: a.reference, cout: a.cout_mensuel, quantite: a.conso_mensuelle }));

  return { mouvements30, mois, etat, topConsommation };
}

module.exports = { rapportStock, rapportConsommation, rapportDepenses, rapportMouvements, rapportApprovisionnement, rapportAlertes, kpis, series, periode };
