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
  manual INTEGER NOT NULL DEFAULT 0,    -- 1 = saisie manuelle
  income_kind TEXT,                     -- 'principal' | 'supplementary' | NULL
  note TEXT                             -- commentaire ; libellé manuel après fusion
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
  kind TEXT NOT NULL CHECK (kind IN ('envelope', 'recurring')),
  monthly_amount REAL,
  income_kind TEXT,                -- 'principal' | 'supplementary' | NULL (revenu)
  start_month TEXT,                -- 'YYYY-MM' : mois de départ (invisible avant)
  end_month TEXT                   -- 'YYYY-MM' ou NULL : dernier mois (NULL = permanent)
);

CREATE TABLE IF NOT EXISTS group_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  amount REAL NOT NULL,
  day INTEGER,
  keyword TEXT NOT NULL
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

-- Budgets datés : montant d'un groupe à partir d'un mois donné. Le montant en
-- vigueur pour un mois M est celui de la ligne au plus grand effective_month <= M ;
-- sans ligne applicable, on retombe sur groups.monthly_amount.
-- group_id = 0 = non catégorisés (provision) ; pas de FK volontairement (comme overspend_decisions).
CREATE TABLE IF NOT EXISTS budget_amounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  effective_month TEXT NOT NULL,   -- YYYY-MM
  amount REAL NOT NULL,
  UNIQUE(group_id, effective_month)
);

-- Décision de l'utilisateur sur un dépassement (un groupe x un mois).
-- group_id = 0 désigne les Non catégorisés du compte (pas de FK volontairement).
-- L'absence de ligne = non tranché. Le dernier choix gagne (upsert).
CREATE TABLE IF NOT EXISTS overspend_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  group_id INTEGER NOT NULL,       -- 0 = non catégorisés
  month TEXT NOT NULL,             -- YYYY-MM
  decision TEXT NOT NULL CHECK (decision IN ('exceptional', 'permanent')),
  decided_at TEXT NOT NULL,        -- ISO datetime
  UNIQUE(account_id, group_id, month)
);
