PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  matricule     TEXT UNIQUE NOT NULL,
  nom           TEXT NOT NULL,
  prenom        TEXT NOT NULL,
  date_naissance TEXT,
  role          TEXT NOT NULL CHECK (role IN ('admin','gestionnaire','responsable')),
  poste         TEXT,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  actif         INTEGER NOT NULL DEFAULT 1,
  last_login    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nom         TEXT UNIQUE NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS fournisseurs (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  nom       TEXT NOT NULL,
  contact   TEXT,
  email     TEXT,
  telephone TEXT,
  adresse   TEXT,
  ville     TEXT,
  notes     TEXT,
  actif     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS articles (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  reference      TEXT UNIQUE NOT NULL,
  nom            TEXT NOT NULL,
  description    TEXT,
  categorie_id   INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  fournisseur_id INTEGER REFERENCES fournisseurs(id) ON DELETE SET NULL,
  unite          TEXT NOT NULL DEFAULT 'unité',
  stock          INTEGER NOT NULL DEFAULT 0,
  seuil_alerte   INTEGER NOT NULL DEFAULT 0,
  stock_cible    INTEGER,
  prix_unitaire  REAL NOT NULL DEFAULT 0,
  emplacement    TEXT,
  actif          INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS inventory_sessions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  reference      TEXT UNIQUE NOT NULL,
  date_inventaire TEXT NOT NULL DEFAULT (date('now','localtime')),
  statut         TEXT NOT NULL DEFAULT 'OUVERT' CHECK (statut IN ('OUVERT','CLOTURE')),
  notes          TEXT,
  user_id        INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id     INTEGER NOT NULL REFERENCES inventory_sessions(id) ON DELETE CASCADE,
  article_id     INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  qte_theorique  INTEGER NOT NULL DEFAULT 0,
  qte_reelle     INTEGER NOT NULL DEFAULT 0,
  ecart          INTEGER NOT NULL DEFAULT 0,
  corrige        INTEGER NOT NULL DEFAULT 0,
  UNIQUE (session_id, article_id)
);

CREATE TABLE IF NOT EXISTS bons_commande (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  numero        TEXT UNIQUE NOT NULL,
  fournisseur_id INTEGER REFERENCES fournisseurs(id),
  date_commande TEXT NOT NULL DEFAULT (date('now','localtime')),
  date_livraison_prevue TEXT,
  statut        TEXT NOT NULL DEFAULT 'BROUILLON' CHECK (statut IN ('BROUILLON','VALIDEE','PARTIELLE','RECUE','ANNULEE')),
  total         REAL NOT NULL DEFAULT 0,
  notes         TEXT,
  created_by    INTEGER REFERENCES users(id),
  validated_by  INTEGER REFERENCES users(id),
  validated_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS bons_commande_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  commande_id     INTEGER NOT NULL REFERENCES bons_commande(id) ON DELETE CASCADE,
  article_id      INTEGER NOT NULL REFERENCES articles(id),
  quantite        INTEGER NOT NULL,
  quantite_recue  INTEGER NOT NULL DEFAULT 0,
  prix_unitaire   REAL NOT NULL DEFAULT 0,
  montant         REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS mouvements (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id    INTEGER NOT NULL REFERENCES articles(id),
  type          TEXT NOT NULL CHECK (type IN ('ENTREE','SORTIE','CORRECTION')),
  quantite      INTEGER NOT NULL,
  stock_apres   INTEGER,
  prix_unitaire REAL,
  cout          REAL,
  motif         TEXT,
  reference_doc TEXT,
  inventaire_id INTEGER REFERENCES inventory_sessions(id),
  commande_id   INTEGER REFERENCES bons_commande(id),
  user_id       INTEGER REFERENCES users(id),
  date          TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS alertes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id   INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  type         TEXT NOT NULL CHECK (type IN ('RUPTURE','STOCK_BAS')),
  message      TEXT NOT NULL,
  stock        INTEGER,
  seuil        INTEGER,
  statut       TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (statut IN ('ACTIVE','RESOLUE')),
  email_envoye INTEGER NOT NULL DEFAULT 0,
  user_id      INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  resolved_at  TEXT,
  resolved_by  INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS approvisionnements (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id        INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  quantite_suggeree INTEGER NOT NULL DEFAULT 0,
  priorite          TEXT NOT NULL DEFAULT 'BASSE' CHECK (priorite IN ('HAUTE','MOYENNE','BASSE')),
  besoin_le         TEXT,
  jours_couverture  INTEGER,
  conso_mensuelle   REAL NOT NULL DEFAULT 0,
  raison            TEXT,
  statut            TEXT NOT NULL DEFAULT 'A_COMMANDER' CHECK (statut IN ('A_COMMANDER','EN_COMMANDE','TRAITE')),
  commande_id       INTEGER REFERENCES bons_commande(id),
  created_at        TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (article_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  destinataire TEXT NOT NULL,
  sujet       TEXT NOT NULL,
  corps       TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'SYSTEME',
  statut      TEXT NOT NULL DEFAULT 'SIMULE' CHECK (statut IN ('ENVOYE','SIMULE','ERREUR')),
  erreur      TEXT,
  user_id     INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   INTEGER REFERENCES users(id),
  matricule TEXT,
  action    TEXT NOT NULL,
  entite    TEXT,
  entite_id INTEGER,
  details   TEXT,
  ip        TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS settings (
  cle   TEXT PRIMARY KEY,
  valeur TEXT,
  libelle TEXT
);

CREATE INDEX IF NOT EXISTS idx_mouvements_article ON mouvements(article_id, date);
CREATE INDEX IF NOT EXISTS idx_mouvements_type ON mouvements(type, date);
CREATE INDEX IF NOT EXISTS idx_alertes_statut ON alertes(statut, type);
CREATE INDEX IF NOT EXISTS idx_articles_stock ON articles(stock, seuil_alerte);
CREATE INDEX IF NOT EXISTS idx_audit_date ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_date ON notifications(created_at);
