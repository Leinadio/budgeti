import { expect, test } from "vitest";
import Database from "better-sqlite3";
import { getDb } from "../../src/db/index";
import { migrateSeedDatedAmounts } from "../../src/db/migrations";
import { upsertAccount } from "../../src/db/repositories/accounts";
import { insertEnvelopeGroup, insertRecurringGroup, insertLine } from "../../src/db/repositories/groups";
import { listBudgetAmounts, setBudgetAmount } from "../../src/db/repositories/budget-amounts";
import { listLineAmounts } from "../../src/db/repositories/line-amounts";

// getDb applique déjà migrateSeedDatedAmounts : on part donc d'une base propre
// et on rappelle la migration pour vérifier l'idempotence.
function seed() {
  const db = getDb(":memory:");
  upsertAccount(db, { id: "a1", name: "CIC", iban_masked: null, balance: 0, currency: "EUR", last_synced: null });
  return db;
}

test("une enveloppe créée reçoit son montant comme première entrée datée", () => {
  const db = seed();
  const gid = insertEnvelopeGroup(db, "a1", "Activités", "out", 250, null, "2026-03", null);
  migrateSeedDatedAmounts(db);
  expect(listBudgetAmounts(db)).toEqual([{ groupId: gid, effectiveMonth: "2026-03", amount: 250 }]);
});

test("une ligne de récurrent reçoit son montant au mois de départ de son groupe", () => {
  const db = seed();
  const gid = insertRecurringGroup(db, "a1", "Abonnements", "out", null, "2026-03", null);
  const lid = insertLine(db, gid, "Spotify", 12.14, 12);
  migrateSeedDatedAmounts(db);
  expect(listLineAmounts(db)).toEqual([{ lineId: lid, effectiveMonth: "2026-03", amount: 12.14 }]);
  // Le groupe récurrent n'a AUCUN montant à lui.
  expect(listBudgetAmounts(db).filter((b) => b.groupId === gid)).toEqual([]);
});

test("un groupe sans mois de départ retombe sur 2000-01", () => {
  const db = seed();
  db.prepare(
    `INSERT INTO groups (account_id, name, direction, kind, monthly_amount, start_month) VALUES ('a1', 'Vieux', 'out', 'envelope', 42, NULL)`,
  ).run();
  const gid = db.prepare(`SELECT id FROM groups WHERE name = 'Vieux'`).get() as { id: number };
  migrateSeedDatedAmounts(db);
  expect(listBudgetAmounts(db)).toContainEqual({ groupId: gid.id, effectiveMonth: "2000-01", amount: 42 });
});

test("une enveloppe sans montant reçoit 0", () => {
  const db = seed();
  db.prepare(
    `INSERT INTO groups (account_id, name, direction, kind, monthly_amount, start_month) VALUES ('a1', 'Vide', 'out', 'envelope', NULL, '2026-01')`,
  ).run();
  const gid = db.prepare(`SELECT id FROM groups WHERE name = 'Vide'`).get() as { id: number };
  migrateSeedDatedAmounts(db);
  expect(listBudgetAmounts(db)).toContainEqual({ groupId: gid.id, effectiveMonth: "2026-01", amount: 0 });
});

test("la migration n'écrase pas une entrée déjà posée au mois de départ", () => {
  const db = seed();
  const gid = insertEnvelopeGroup(db, "a1", "Activités", "out", 250, null, "2026-03", null);
  setBudgetAmount(db, gid, "2026-03", 999);
  migrateSeedDatedAmounts(db);
  expect(listBudgetAmounts(db)).toEqual([{ groupId: gid, effectiveMonth: "2026-03", amount: 999 }]);
});

test("la migration est idempotente", () => {
  const db = seed();
  const gid = insertRecurringGroup(db, "a1", "Abonnements", "out", null, "2026-03", null);
  insertLine(db, gid, "Spotify", 12.14, 12);
  migrateSeedDatedAmounts(db);
  migrateSeedDatedAmounts(db);
  migrateSeedDatedAmounts(db);
  expect(listLineAmounts(db)).toHaveLength(1);
});

test("la provision des non catégorisés (groupe 0) n'est pas touchée", () => {
  const db = seed();
  setBudgetAmount(db, 0, "2026-07", 30);
  migrateSeedDatedAmounts(db);
  expect(listBudgetAmounts(db)).toEqual([{ groupId: 0, effectiveMonth: "2026-07", amount: 30 }]);
});

test("la migration tourne sur une base qui n'a pas encore line_amounts", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE groups (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT, name TEXT, direction TEXT, kind TEXT, monthly_amount REAL, start_month TEXT, end_month TEXT);
    CREATE TABLE group_lines (id INTEGER PRIMARY KEY AUTOINCREMENT, group_id INTEGER, name TEXT, amount REAL, day INTEGER, keyword TEXT);
    CREATE TABLE budget_amounts (id INTEGER PRIMARY KEY AUTOINCREMENT, group_id INTEGER NOT NULL, effective_month TEXT NOT NULL, amount REAL NOT NULL, UNIQUE(group_id, effective_month));
    INSERT INTO groups (account_id, name, direction, kind, monthly_amount, start_month) VALUES ('a1', 'Activités', 'out', 'envelope', 250, '2026-03');
  `);
  expect(() => migrateSeedDatedAmounts(db)).not.toThrow();
});
