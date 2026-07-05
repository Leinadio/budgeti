import { expect, test } from "vitest";
import { getDb } from "../../src/db/index";
import { ensureCategory, listCategories } from "../../src/db/repositories/categories";
import { upsertTransaction, listTransactions } from "../../src/db/repositories/transactions";
import { upsertAccount, totalBalance } from "../../src/db/repositories/accounts";
import { setSetting, getSetting } from "../../src/db/repositories/settings";
import { setBudget, listBudgets, deleteBudget } from "../../src/db/repositories/budgets";
import { listRecurring, insertRecurring, deleteRecurring } from "../../src/db/repositories/recurring";

test("category ensure is idempotent", () => {
  const db = getDb(":memory:");
  const a = ensureCategory(db, "Courses");
  const b = ensureCategory(db, "Courses");
  expect(a).toBe(b);
  expect(listCategories(db)).toHaveLength(1);
});

test("transaction upsert dedupes by id and lists back", () => {
  const db = getDb(":memory:");
  upsertAccount(db, { id: "acc1", name: "CIC", iban_masked: "***1234", balance: 500, currency: "EUR", last_synced: null });
  const t = { id: "tx1", account_id: "acc1", date: "2026-07-01", amount: -30, label: "CARREFOUR", category_id: null };
  upsertTransaction(db, t);
  upsertTransaction(db, t); // duplicate ignored
  expect(listTransactions(db)).toHaveLength(1);
  expect(totalBalance(db)).toBe(500);
});

test("settings round-trip", () => {
  const db = getDb(":memory:");
  setSetting(db, "balance_threshold", "200");
  expect(getSetting(db, "balance_threshold")).toBe("200");
  expect(getSetting(db, "missing")).toBeNull();
});

test("budget set and list round-trip (limit is a reserved word)", () => {
  const db = getDb(":memory:");
  setBudget(db, "Courses", 400);
  setBudget(db, "Courses", 450); // upsert sur la même catégorie
  const budgets = listBudgets(db);
  expect(budgets).toHaveLength(1);
  expect(budgets[0]).toEqual({ category: "Courses", limit: 450 });
});

test("budget delete removes the row", () => {
  const db = getDb(":memory:");
  setBudget(db, "Courses", 400);
  deleteBudget(db, "Courses");
  expect(listBudgets(db)).toHaveLength(0);
});

test("recurring payment insert, list, delete round-trip", () => {
  const db = getDb(":memory:");
  insertRecurring(db, "Spotify", "SPOTIFY", 12.14);
  insertRecurring(db, "iCloud", "ICLOUD", 9.99);
  let rows = listRecurring(db);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toEqual({ id: rows[0].id, name: "Spotify", keyword: "SPOTIFY", expected: 12.14 });
  deleteRecurring(db, rows[0].id);
  rows = listRecurring(db);
  expect(rows).toHaveLength(1);
  expect(rows[0].name).toBe("iCloud");
});
