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
  id TEXT PRIMARY KEY,             -- Enable Banking entry_reference / transaction id
  account_id TEXT NOT NULL REFERENCES accounts(id),
  date TEXT NOT NULL,              -- YYYY-MM-DD
  amount REAL NOT NULL,            -- signed euros: debit negative, credit positive
  label TEXT NOT NULL,             -- raw bank label
  category_id INTEGER REFERENCES categories(id),
  group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL
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
  monthly_amount REAL
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
