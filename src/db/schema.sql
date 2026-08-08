CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,             -- Enable Banking account uid
  name TEXT NOT NULL,
  iban_masked TEXT,
  balance REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EUR',
  last_synced TEXT,                -- ISO datetime
  custom_name TEXT                 -- alias utilisateur ; NULL = utiliser name
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword TEXT NOT NULL,           -- matched case-insensitively against label
  category_id INTEGER NOT NULL REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,             -- Enable Banking id, ou "manual:<uuid>" pour une saisie
  account_id TEXT NOT NULL REFERENCES accounts(id),
  date TEXT NOT NULL,              -- YYYY-MM-DD
  amount REAL NOT NULL,            -- signed euros: debit negative, credit positive
  label TEXT NOT NULL,             -- raw bank label ou libellé saisi
  category_id INTEGER REFERENCES categories(id),
  group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
  line_id INTEGER REFERENCES group_lines(id) ON DELETE SET NULL,
  excluded INTEGER NOT NULL DEFAULT 0,  -- 1 = forcé « non catégorisé »
  ignored INTEGER NOT NULL DEFAULT 0,   -- 1 = non comptabilisée (invisible pour tout calcul)
  manual INTEGER NOT NULL DEFAULT 0,    -- 1 = saisie manuelle
  income_kind TEXT,                     -- 'principal' | 'supplementary' | NULL
  note TEXT,                            -- libellé de la saisie manuelle, conservé après fusion
  comment TEXT                          -- commentaire libre de l'utilisateur, affiché sous le libellé
);

CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  monthly_limit REAL NOT NULL,
  UNIQUE(category_id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS recurring_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  keyword TEXT NOT NULL,            -- matché insensiblement à la casse contre le libellé
  expected_amount REAL NOT NULL    -- montant mensuel prévu, euros positifs
);

CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  name TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  -- Vestige : plus lu par aucun calcul de budget (la vérité est dans budget_amounts).
  -- Sert AUSSI de marqueur de version à migrateGroupsV2, qui détruit les groupes quand
  -- il ne le trouve pas : ne pas retirer sans changer ce marqueur d'abord.
  -- Conservé parce que les INSERT existants le remplissent encore ; ne pas s'en servir.
  monthly_amount REAL,
  income_kind TEXT,                -- 'principal' | 'supplementary' | NULL (revenu)
  start_month TEXT,                -- 'YYYY-MM' : mois de départ (invisible avant)
  end_month TEXT                   -- 'YYYY-MM' ou NULL : dernier mois (NULL = permanent)
);

CREATE TABLE IF NOT EXISTS group_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- Vestige, comme groups.monthly_amount : le budget d'une ligne vit dans
  -- line_amounts. Encore lu par listGroups (affichage) et par la reprise de données.
  amount REAL NOT NULL,
  day INTEGER,
  keyword TEXT NOT NULL,
  start_month TEXT,                -- 'YYYY-MM' ou NULL : premier mois (NULL = pas de borne)
  end_month TEXT                   -- 'YYYY-MM' ou NULL : dernier mois (NULL = permanente)
);

CREATE TABLE IF NOT EXISTS group_keywords (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reconcile_ignored (
  manual_id TEXT NOT NULL,
  synced_id TEXT NOT NULL,
  PRIMARY KEY (manual_id, synced_id)
);

-- Budgets datés : montant d'un groupe à partir d'un mois donné. SEULE source de
-- vérité du budget d'une enveloppe. Le montant en vigueur pour un mois M est celui
-- de la ligne au plus grand effective_month <= M ; sans ligne applicable, le montant
-- est 0 — on ne retombe sur AUCUN montant de base (cf. src/lib/budget-in-force.ts).
-- La reprise de données (migrateSeedDatedAmounts) garantit une entrée au mois de
-- départ de chaque enveloppe, et chaque création en pose une aussitôt.
-- group_id = 0 = non catégorisés (provision) ; pas de FK volontairement (comme overspend_decisions).
CREATE TABLE IF NOT EXISTS budget_amounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  effective_month TEXT NOT NULL,   -- YYYY-MM
  amount REAL NOT NULL,
  -- Portée : 'ongoing' = vaut à partir de ce mois et pour les suivants ; 'once' = ne
  -- vaut que pour ce mois. Les deux peuvent coexister au même mois (relever durablement
  -- à partir de juillet ET faire une exception pour juillet), d'où la portée dans la
  -- clé d'unicité — sinon écrire l'une effacerait l'autre.
  scope TEXT NOT NULL DEFAULT 'ongoing',
  UNIQUE(group_id, effective_month, scope)
);

-- VESTIGE : plus lue ni écrite par l'application. Un dépassement ne se tranche plus,
-- il se signale ; relever un budget pour la suite est un geste à part, fait à la main
-- dans les cases des mois concernés. La table survit pour ne pas détruire l'historique
-- des décisions déjà prises ; elle peut être supprimée sans conséquence.
-- Décision de l'utilisateur sur un dépassement (un groupe x un mois).
-- group_id = 0 désigne les Non catégorisés du compte (pas de FK volontairement).
-- L'absence de ligne = non tranché. Le dernier choix gagne (upsert).
CREATE TABLE IF NOT EXISTS overspend_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  group_id INTEGER NOT NULL,       -- 0 = non catégorisés
  -- Ligne de récurrent qui déborde ; 0 = le groupe lui-même (enveloppe, non
  -- catégorisés). Un récurrent n'a pas de budget à lui : ce sont ses lignes qui en
  -- portent un, donc chaque ligne se tranche séparément. 0 et non NULL : SQLite tient
  -- deux NULL pour distincts dans une contrainte d'unicité.
  line_id INTEGER NOT NULL DEFAULT 0,
  month TEXT NOT NULL,             -- YYYY-MM
  decision TEXT NOT NULL CHECK (decision IN ('exceptional', 'permanent')),
  decided_at TEXT NOT NULL,        -- ISO datetime
  writes TEXT,                     -- JSON des écritures posées (BudgetWrite[]), NULL si aucune
  UNIQUE(account_id, group_id, line_id, month)
);

-- Montants datés d'une ligne de récurrent. Même règle que budget_amounts : le
-- montant en vigueur au mois M est celui de la ligne au plus grand
-- effective_month <= M. Le budget d'un récurrent est la somme de ses lignes.
-- ON DELETE CASCADE : supprimer une ligne emporte son historique.
CREATE TABLE IF NOT EXISTS line_amounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  line_id INTEGER NOT NULL REFERENCES group_lines(id) ON DELETE CASCADE,
  effective_month TEXT NOT NULL,   -- YYYY-MM
  amount REAL NOT NULL,
  -- Portée : 'ongoing' = vaut à partir de ce mois et pour les suivants ; 'once' = ne
  -- vaut que pour ce mois. Les deux peuvent coexister au même mois (relever durablement
  -- à partir de juillet ET faire une exception pour juillet), d'où la portée dans la
  -- clé d'unicité — sinon écrire l'une effacerait l'autre.
  scope TEXT NOT NULL DEFAULT 'ongoing',
  UNIQUE(line_id, effective_month, scope)
);

-- Notifications fermées d'une croix par l'utilisateur. L'identité est celle que
-- construit overspendNotifications (« compte::cible::mois ») : on écarte par identité,
-- pas par montant, pour qu'un dépassement qui continue de grossir ne fasse pas
-- reparaître une notification déjà écartée.
CREATE TABLE IF NOT EXISTS dismissed_notifications (
  id TEXT PRIMARY KEY,
  dismissed_at TEXT NOT NULL   -- ISO datetime
);
