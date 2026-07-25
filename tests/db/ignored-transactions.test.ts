import { expect, test } from "vitest";
import Database from "better-sqlite3";
import { getDb } from "../../src/db/index";
import { migrateTransactionIgnored } from "../../src/db/migrations";
import { upsertAccount } from "../../src/db/repositories/accounts";
import {
  listTransactions,
  setTransactionIgnored,
  setTransactionGroup,
  upsertTransaction,
} from "../../src/db/repositories/transactions";
import { insertEnvelopeGroup } from "../../src/db/repositories/groups";

function seed() {
  const db = getDb(":memory:");
  upsertAccount(db, { id: "a1", name: "CIC", iban_masked: null, balance: 0, currency: "EUR", last_synced: null });
  upsertTransaction(db, { id: "t1", account_id: "a1", date: "2026-07-01", amount: -30, label: "COURSES", category_id: null });
  upsertTransaction(db, { id: "t2", account_id: "a1", date: "2026-07-02", amount: -70, label: "REMBOURSEMENT PRET AMI", category_id: null });
  return db;
}

test("migrateTransactionIgnored ajoute la colonne à une base existante, sans toucher aux données", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE transactions (id TEXT PRIMARY KEY, amount REAL NOT NULL, excluded INTEGER NOT NULL DEFAULT 0);
    INSERT INTO transactions (id, amount, excluded) VALUES ('t1', -30, 1);
  `);
  migrateTransactionIgnored(db);
  migrateTransactionIgnored(db); // idempotent
  const cols = db.prepare("PRAGMA table_info(transactions)").all() as { name: string }[];
  expect(cols.some((c) => c.name === "ignored")).toBe(true);
  expect(db.prepare("SELECT ignored, excluded FROM transactions WHERE id='t1'").get()).toEqual({ ignored: 0, excluded: 1 });
});

test("listTransactions masque les transactions non comptabilisées par défaut", () => {
  const db = seed();
  setTransactionIgnored(db, "t2", true);
  expect(listTransactions(db).map((t) => t.id)).toEqual(["t1"]);
});

test("listTransactions les rend avec includeIgnored, marquées ignored", () => {
  const db = seed();
  setTransactionIgnored(db, "t2", true);
  const rows = listTransactions(db, { includeIgnored: true });
  expect(rows).toHaveLength(2);
  expect(rows.find((t) => t.id === "t2")!.ignored).toBe(true);
  expect(rows.find((t) => t.id === "t1")!.ignored).toBe(false);
});

test("setTransactionIgnored est réversible", () => {
  const db = seed();
  setTransactionIgnored(db, "t2", true);
  setTransactionIgnored(db, "t2", false);
  expect(listTransactions(db).map((t) => t.id)).toEqual(["t2", "t1"]);
});

test("une transaction non comptabilisée ne pèse plus sur le total du mois", () => {
  const db = seed();
  const total = () => listTransactions(db, { month: "2026-07" }).reduce((s, t) => s + t.amount, 0);
  expect(total()).toBe(-100);
  setTransactionIgnored(db, "t2", true);
  expect(total()).toBe(-30);
});

test("une transaction non comptabilisée garde son rattachement de groupe", () => {
  const db = seed();
  const gid = insertEnvelopeGroup(db, "a1", "Courses", "out", 200, null, "2000-01", null);
  setTransactionGroup(db, "t2", gid);
  setTransactionIgnored(db, "t2", true);
  setTransactionIgnored(db, "t2", false);
  expect(listTransactions(db).find((t) => t.id === "t2")!.groupId).toBe(gid);
});
