import { expect, test } from "vitest";
import Database from "better-sqlite3";
import { migrateBudgets, migrateAccountCustomName, migrateGroupsV2, migrateTransactionManualFields, migrateReconcileIgnored } from "../../src/db/migrations";

test("migrateBudgets converts old month-keyed table, keeping latest month per category", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE);
    CREATE TABLE budgets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL REFERENCES categories(id),
      month TEXT NOT NULL,
      limit_amount REAL NOT NULL,
      UNIQUE(category_id, month)
    );
    INSERT INTO categories (id, name) VALUES (1, 'Courses'), (2, 'Transport');
    INSERT INTO budgets (category_id, month, limit_amount) VALUES
      (1, '2026-06', 300), (1, '2026-07', 400), (2, '2026-07', 100);
  `);
  migrateBudgets(db);
  const cols = db.prepare("PRAGMA table_info(budgets)").all() as { name: string }[];
  expect(cols.some((c) => c.name === "month")).toBe(false);
  expect(cols.some((c) => c.name === "monthly_limit")).toBe(true);
  const rows = db.prepare("SELECT category_id, monthly_limit FROM budgets ORDER BY category_id").all();
  expect(rows).toEqual([
    { category_id: 1, monthly_limit: 400 }, // dernier mois: 2026-07
    { category_id: 2, monthly_limit: 100 },
  ]);
});

test("migrateBudgets is a no-op on the new schema", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE);
    CREATE TABLE budgets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL REFERENCES categories(id),
      monthly_limit REAL NOT NULL,
      UNIQUE(category_id)
    );
    INSERT INTO categories (id, name) VALUES (1, 'Courses');
    INSERT INTO budgets (category_id, monthly_limit) VALUES (1, 400);
  `);
  migrateBudgets(db);
  const rows = db.prepare("SELECT category_id, monthly_limit FROM budgets").all();
  expect(rows).toEqual([{ category_id: 1, monthly_limit: 400 }]);
});

test("migrateAccountCustomName adds the column to an old accounts table, idempotent", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, iban_masked TEXT,
      balance REAL NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'EUR', last_synced TEXT
    );
    INSERT INTO accounts (id, name, balance) VALUES ('a1', 'CIC', 100);
  `);
  migrateAccountCustomName(db);
  let cols = db.prepare("PRAGMA table_info(accounts)").all() as { name: string }[];
  expect(cols.some((c) => c.name === "custom_name")).toBe(true);
  // valeur par défaut NULL
  expect(db.prepare("SELECT custom_name FROM accounts WHERE id='a1'").get()).toEqual({ custom_name: null });
  // idempotent : deuxième passage sans erreur
  migrateAccountCustomName(db);
  cols = db.prepare("PRAGMA table_info(accounts)").all() as { name: string }[];
  expect(cols.filter((c) => c.name === "custom_name")).toHaveLength(1);
});

test("migrateGroupsV2 resets groups to the new schema and adds transactions.group_id", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL, balance REAL NOT NULL DEFAULT 0);
    CREATE TABLE transactions (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, date TEXT, amount REAL, label TEXT);
    CREATE TABLE groups (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL, name TEXT NOT NULL, direction TEXT NOT NULL);
    CREATE TABLE group_lines (id INTEGER PRIMARY KEY AUTOINCREMENT, group_id INTEGER NOT NULL, name TEXT, amount REAL, day INTEGER, keyword TEXT);
    INSERT INTO groups (account_id, name, direction) VALUES ('a1', 'Vieux', 'out');
  `);
  migrateGroupsV2(db);
  const gcols = (db.prepare("PRAGMA table_info(groups)").all() as { name: string }[]).map((c) => c.name);
  expect(gcols).toContain("kind");
  expect(gcols).toContain("monthly_amount");
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((t) => t.name);
  expect(tables).toContain("group_keywords");
  const tcols = (db.prepare("PRAGMA table_info(transactions)").all() as { name: string }[]).map((c) => c.name);
  expect(tcols).toContain("group_id");
  // clean slate : l'ancien groupe a disparu
  expect(db.prepare("SELECT COUNT(*) AS n FROM groups").get()).toEqual({ n: 0 });
  // idempotent
  migrateGroupsV2(db);
  expect((db.prepare("PRAGMA table_info(transactions)").all() as { name: string }[]).filter((c) => c.name === "group_id")).toHaveLength(1);
});

test("migrateTransactionManualFields adds manual/income_kind/note idempotently", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE transactions (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL, date TEXT NOT NULL,
      amount REAL NOT NULL, label TEXT NOT NULL, category_id INTEGER
    );
    INSERT INTO transactions (id, account_id, date, amount, label, category_id)
      VALUES ('t1', 'a1', '2026-07-01', -10, 'CARREFOUR', NULL);
  `);
  migrateTransactionManualFields(db);
  const cols = db.prepare("PRAGMA table_info(transactions)").all() as { name: string }[];
  expect(cols.some((c) => c.name === "manual")).toBe(true);
  expect(cols.some((c) => c.name === "income_kind")).toBe(true);
  expect(cols.some((c) => c.name === "note")).toBe(true);
  // valeur par défaut appliquée à la ligne existante
  expect(db.prepare("SELECT manual FROM transactions WHERE id='t1'").get()).toEqual({ manual: 0 });
  // idempotent : deuxième passage sans erreur
  migrateTransactionManualFields(db);
  expect(db.prepare("SELECT COUNT(*) AS n FROM transactions").get()).toEqual({ n: 1 });
});

test("migrateReconcileIgnored creates the table idempotently", () => {
  const db = new Database(":memory:");
  migrateReconcileIgnored(db);
  migrateReconcileIgnored(db);
  db.prepare("INSERT INTO reconcile_ignored (manual_id, synced_id) VALUES ('m1', 's1')").run();
  expect(db.prepare("SELECT COUNT(*) AS n FROM reconcile_ignored").get()).toEqual({ n: 1 });
});

import { migrateGroupIncomeKind } from "../../src/db/migrations";

test("migrateGroupIncomeKind adds income_kind to groups idempotently", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL, name TEXT NOT NULL,
      direction TEXT NOT NULL, kind TEXT NOT NULL, monthly_amount REAL
    );
    INSERT INTO groups (account_id, name, direction, kind, monthly_amount)
      VALUES ('a1', 'Courses', 'out', 'envelope', 300);
  `);
  migrateGroupIncomeKind(db);
  const cols = db.prepare("PRAGMA table_info(groups)").all() as { name: string }[];
  expect(cols.some((c) => c.name === "income_kind")).toBe(true);
  expect(db.prepare("SELECT income_kind FROM groups WHERE name='Courses'").get()).toEqual({ income_kind: null });
  migrateGroupIncomeKind(db); // idempotent
  expect(db.prepare("SELECT COUNT(*) AS n FROM groups").get()).toEqual({ n: 1 });
});

import { migrateRemunerationPrincipalToEnvelope } from "../../src/db/migrations";

function groupsSchemaWithIncomeKind(db: Database.Database) {
  db.exec(`
    CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL,
      name TEXT NOT NULL,
      direction TEXT NOT NULL,
      kind TEXT NOT NULL,
      monthly_amount REAL,
      income_kind TEXT
    );
    CREATE TABLE group_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      amount REAL NOT NULL,
      day INTEGER,
      keyword TEXT NOT NULL
    );
    INSERT INTO accounts (id, name) VALUES ('a1', 'Compte');
  `);
}

test("migrateRemunerationPrincipal convertit un récurrent principal en enveloppe (montant = somme des lignes)", () => {
  const db = new Database(":memory:");
  groupsSchemaWithIncomeKind(db);
  db.exec(`
    INSERT INTO groups (id, account_id, name, direction, kind, monthly_amount, income_kind)
      VALUES (1, 'a1', 'Rémunération principale', 'in', 'recurring', NULL, 'principal');
    INSERT INTO group_lines (group_id, name, amount, day, keyword) VALUES
      (1, 'Base', 500, 1, ''), (1, 'Prime', 152.09, 1, '');
  `);
  migrateRemunerationPrincipalToEnvelope(db);
  const g = db.prepare("SELECT kind, monthly_amount AS m FROM groups WHERE id = 1").get() as { kind: string; m: number };
  expect(g.kind).toBe("envelope");
  expect(g.m).toBeCloseTo(652.09, 2);
  const lines = db.prepare("SELECT COUNT(*) AS n FROM group_lines WHERE group_id = 1").get() as { n: number };
  expect(lines.n).toBe(0);
});

test("migrateRemunerationPrincipal est un no-op si déjà en enveloppe", () => {
  const db = new Database(":memory:");
  groupsSchemaWithIncomeKind(db);
  db.exec(`INSERT INTO groups (id, account_id, name, direction, kind, monthly_amount, income_kind)
    VALUES (1, 'a1', 'Rémunération principale', 'in', 'envelope', 2000, 'principal');`);
  migrateRemunerationPrincipalToEnvelope(db);
  const g = db.prepare("SELECT kind, monthly_amount AS m FROM groups WHERE id = 1").get() as { kind: string; m: number };
  expect(g.kind).toBe("envelope");
  expect(g.m).toBe(2000);
});
