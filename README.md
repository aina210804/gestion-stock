# Gestion de stock des consommables

Application web complète pour automatiser la gestion des consommables d'une entreprise :
articles, entrées/sorties, alertes, inventaire, fournisseurs, bons de commande,
prévision des dépenses, planification des approvisionnements, rapports et traçabilité.

**Pile technique :** Node.js + Express + SQLite (module intégré `node:sqlite`) + frontend HTML/CSS/JS pur.
Aucun service externe à installer (pas de MySQL, pas de compilateur, pas de CDN).

---

## 1. Installation

```bash
npm install        # dépendances (express, session, bcryptjs, nodemailer, dotenv)
npm start          # démarre le serveur sur http://localhost:3000
```

Options :

```bash
npm run dev        # redémarrage automatique à chaque modification
npm run init-db    # (ré)initialiser la base avec les données de démonstration
npm run init-db -- --reset   # supprimer puis recréer la base
npm run check      # vérifie la syntaxe de tous les fichiers + test fonctionnel
```

La base (`data/stock.db`) est créée et alimentée automatiquement au premier démarrage.

## 2. Comptes de démonstration

| Rôle | E-mail | Mot de passe | Droits |
|---|---|---|---|
| Administrateur | `admin@entreprise.local` | `admin123` | Tous les droits |
| Gestionnaire de stock | `stock@entreprise.local` | `stock123` | Articles, mouvements, inventaire, fournisseurs, préparation des commandes |
| Responsable | `resp@entreprise.local` | `resp123` | Supervision, validation des commandes, rapports, traçabilité |

Connexion par e-mail **ou** matricule (`ADM-0001`, `STK-0002`, `RES-0003`).

## 3. Configuration (fichier `.env`)

| Variable | Rôle |
|---|---|
| `PORT`, `HOST` | Adresse du serveur (3000 / localhost) |
| `DB_PATH` | Chemin de la base SQLite |
| `SESSION_SECRET`, `SESSION_MAX_HOURS` | Sécurité de session |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Envoi réel d'e-mails |
| `HORIZON_PREVISION_MOIS`, `DELAI_FOURNISSEUR_JOURS` | Paramètres métier par défaut |

> **Notifications e-mail :** si `SMTP_HOST` est vide, l'application fonctionne en **mode simulation**
> : chaque e-mail est journalisé dans la page « Notifications » (colonne statut = *simulé*).
> Renseignez `SMTP_HOST` (+ identifiants) pour un envoi réel via nodemailer.

## 4. Fonctionnalités

| Module | Détail |
|---|---|
| **Authentification** | Session sécurisée, bcrypt, rôles `admin` / `gestionnaire` / `responsable`, matricule, réinitialisation des mots de passe |
| **Articles** | Référence, catégorie, fournisseur, unité, stock, seuil d'alerte, stock cible, prix, emplacement, archivage |
| **Mouvements** | Entrées, sorties, corrections ; mise à jour du stock **transactionnelle**, coût, motif, opérateur |
| **Alertes** | Détection automatique rupture / stock bas après chaque mouvement, résolution, e-mail associé |
| **Inventaire** | Session = instantané des stocks, saisie des quantités réelles, écart, clôture → corrections automatiques |
| **Fournisseurs** | Fiche complète, articles rattachés, commandes et montants cumulés |
| **Bons de commande** | Création (manuelle ou depuis le plan), validation, réception partielle/totale → entrées de stock, annulation |
| **Prévisions** | Consommation moyenne, tendance (régression linéaire), projections 3/6/12 mois, coût estimé, rupture estimée |
| **Planification** | Besoins classés HAUTE / MOYENNE / BASSE selon seuil, délai fournisseur et couverture ; génération des bons par fournisseur |
| **Rapports** | Stock, consommation, dépenses, mouvements, prévisions, alertes → affichage, impression, export CSV |
| **Traçabilité** | Chaque opération écrite dans `audit_logs` (qui, quoi, quand, IP, détails) |
| **Notifications** | Journal des e-mails (alertes, commandes, tests) |

## 5. Architecture

```
server.js                 Serveur Express : sessions, routes API, statique, erreurs
src/
  db/
    schema.sql            Schéma SQLite (15 tables)
    database.js           Accès SQL + transactions ré-entrantes
    seed.js               Données par défaut + 150 jours d'historique
    init.js               CLI de (ré)initialisation
  middleware/
    auth.js               requireAuth, requireRole, permissions par rôle
    audit.js              Journalisation des opérations
  services/               Logique métier (tout est calculé par requêtes SQL)
    movementService.js    Création de mouvements + alertes + audit
    alertService.js       Détection / résolution des alertes + e-mail
    orderService.js       Bons de commande (créer, valider, recevoir, annuler)
    planningService.js    Planification des approvisionnements
    forecastService.js    Prévision des dépenses (régression linéaire)
    reportService.js      KPI, séries graphiques, rapports
    mailService.js        Envoi SMTP / simulation + journal
  routes/                 15 routeurs REST (auth, users, articles, movements,
                          inventory, suppliers, orders, alerts, dashboard,
                          forecast, planning, reports, audit, notifications, settings)
public/
  index.html              Page de connexion
  app.html                Shell de l'application (sidebar + zone de contenu)
  css/style.css           Design system complet (impression comprise)
  js/                     api, ui (modales/tableaux/formulaires), charts (SVG)
  js/views/               1 vues métier (dashboard → paramètres)
scripts/check.js          Vérification syntaxe + test fonctionnel
```

**Principe :** toute l'agrégation (KPI, statistiques, coûts, moyennes, priorités)
est faite **côté serveur en requêtes SQL** ; le frontend ne fait qu'afficher.

## 6. Droits d'accès

| Action | admin | gestionnaire | responsable |
|---|:--:|:--:|:--:|
| Tableau de bord, rapports, prévisions | ✔ | ✔ | ✔ |
| Articles / fournisseurs : lecture | ✔ | ✔ | ✔ |
| Articles / fournisseurs : écriture | ✔ | ✔ | — |
| Entrées / sorties / inventaire | ✔ | ✔ | lecture |
| Créer un bon de commande | ✔ | ✔ | — |
| Valider un bon de commande | ✔ | — | ✔ |
| Réceptionner une commande | ✔ | ✔ | — |
| Paramètres, utilisateurs | ✔ | — | — |
| Journal de traçabilité | ✔ | — | ✔ |

## 7. API (aperçu)

Toutes les routes sont sous `/api` et exigent une session valide.

```
POST /api/auth/login | /logout | /password     GET /api/auth/me
GET|POST|PUT|DELETE  /api/users[/:id]          /api/users/:id/mot-de-passe
GET|POST|PUT|DELETE  /api/articles[/:id]       /api/articles/categories   /api/articles/low-stock
GET|POST             /api/movements            /api/movements/export      /api/movements/types
GET|POST|PUT|DELETE  /api/inventory/sessions[/:id]  .../items  .../cloture
GET|POST|PUT|DELETE  /api/suppliers[/:id]
GET|POST             /api/orders               /api/orders/:id/valider | recevoir | annuler
GET|POST             /api/alerts               /api/alerts/:id/resoudre   /api/alerts/check
GET                  /api/dashboard            /api/dashboard/series
GET                  /api/forecast             /api/forecast/ranking | export
GET|POST             /api/planning             /api/planning/refresh | commandes | export
GET                  /api/reports/:code        /api/reports/:code/apercu  ?format=csv
GET                  /api/audit                /api/audit/stats | export
GET|POST             /api/notifications        /api/notifications/test | mode
GET|PUT              /api/settings
```

## 8. Production

- Changez `SESSION_SECRET` et tous les mots de passe par défaut dans `.env`.
- Activez SMTP (`SMTP_HOST`) pour de vrais e-mails.
- Démarrez avec un gestionnaire de processus (PM2, NSSM, Docker) :
  `pm2 start server.js --name stock`.
- Le fichier `data/stock.db` contient toutes les données : sauvegardez-le régulièrement.
