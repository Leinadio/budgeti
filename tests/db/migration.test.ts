import { expect, test } from "vitest";
import Database from "better-sqlite3";
import { migrateBudgets, migrateAccountCustomName } from "../../src/db/migrations";

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
