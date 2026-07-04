import { expect, test } from "vitest";
import { getDb } from "../../src/db/index";
import { ensureCategory, listCategories } from "../../src/db/repositories/categories";
import { upsertTransaction, listTransactions } from "../../src/db/repositories/transactions";
import { upsertAccount, totalBalance } from "../../src/db/repositories/accounts";
import { setSetting, getSetting } from "../../src/db/repositories/settings";

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
