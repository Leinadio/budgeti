import { test, expect } from "vitest";
import { getDb } from "../../src/db/index";
import { upsertAccount } from "../../src/db/repositories/accounts";
import { insertRecurringGroup, insertLine } from "../../src/db/repositories/groups";
import { listBudgetAmounts, setBudgetAmount } from "../../src/db/repositories/budget-amounts";
import { listLineAmounts, setLineAmount, deleteLineAmount } from "../../src/db/repositories/line-amounts";
import { listOverspendDecisions, setOverspendDecision, getOverspendDecision } from "../../src/db/repositories/overspend-decisions";
import { toDatedLineAmounts, lineAmountInForce } from "../../src/lib/history";
import { lineWrites, undoWrites } from "../../src/lib/overspend-writes";

function freshDb() {
  const db = getDb(":memory:");
  db.prepare(`INSERT INTO accounts (id, name) VALUES ('a1', 'CIC')`).run();
  db.prepare(
    `INSERT INTO groups (id, account_id, name, direction, kind, monthly_amount) VALUES (1, 'a1', 'Courses', 'out', 'envelope', 300)`,
  ).run();
  return db;
}

test("budget_amounts : upsert et lecture triée", () => {
  const db = freshDb();
  setBudgetAmount(db, 1, "2026-08", 400);
  setBudgetAmount(db, 1, "2026-10", 450);
  setBudgetAmount(db, 1, "2026-08", 410); // upsert : remplace le montant d'août
  expect(listBudgetAmounts(db)).toEqual([
    { groupId: 1, effectiveMonth: "2026-08", amount: 410 },
    { groupId: 1, effectiveMonth: "2026-10", amount: 450 },
  ]);
});

test("budget_amounts : provision groupe 0 (non catégorisés) sans FK", () => {
  const db = freshDb();
  setBudgetAmount(db, 0, "2026-08", 400);
  expect(listBudgetAmounts(db)).toEqual([{ groupId: 0, effectiveMonth: "2026-08", amount: 400 }]);
});

test("overspend_decisions : upsert par (compte, groupe, mois), groupId 0 = non catégorisés", () => {
  const db = freshDb();
  setOverspendDecision(db, { accountId: "a1", groupId: 1, month: "2026-07", decision: "exceptional", decidedAt: "2026-08-01T10:00:00Z", writes: null });
  setOverspendDecision(db, { accountId: "a1", groupId: 0, month: "2026-07", decision: "exceptional", decidedAt: "2026-08-01T10:00:00Z", writes: null });
  setOverspendDecision(db, { accountId: "a1", groupId: 1, month: "2026-07", decision: "permanent", decidedAt: "2026-08-02T10:00:00Z", writes: null });
  const rows = listOverspendDecisions(db, "a1");
  expect(rows).toHaveLength(2);
  expect(rows.find((r) => r.groupId === 1)?.decision).toBe("permanent"); // le dernier choix gagne
  expect(rows.find((r) => r.groupId === 0)?.decision).toBe("exceptional");
  expect(listOverspendDecisions(db, "autre")).toHaveLength(0);
});

test("une décision garde la trace de ses écritures", () => {
  const db = getDb(":memory:");
  upsertAccount(db, { id: "a1", name: "CIC", iban_masked: null, balance: 0, currency: "EUR", last_synced: null });
  const writes = [{ target: "line" as const, id: 101, month: "2026-08", amount: 151.84, before: null }];
  setOverspendDecision(db, { accountId: "a1", groupId: 13, month: "2026-07", decision: "permanent", decidedAt: "2026-07-29T10:00:00Z", writes });
  expect(getOverspendDecision(db, "a1", 13, "2026-07")?.writes).toEqual(writes);
});

test("une décision exceptionnelle n'écrit rien", () => {
  const db = getDb(":memory:");
  upsertAccount(db, { id: "a1", name: "CIC", iban_masked: null, balance: 0, currency: "EUR", last_synced: null });
  setOverspendDecision(db, { accountId: "a1", groupId: 13, month: "2026-07", decision: "exceptional", decidedAt: "2026-07-29T10:00:00Z", writes: null });
  expect(getOverspendDecision(db, "a1", 13, "2026-07")?.writes).toBeNull();
});

test("une hausse permanente sur une ligne prend effet au mois suivant, et s'annule", () => {
  const db = getDb(":memory:");
  upsertAccount(db, { id: "a1", name: "CIC", iban_masked: null, balance: 0, currency: "EUR", last_synced: null });
  const gid = insertRecurringGroup(db, "a1", "Abonnements", "out", null, "2026-01", null);
  const lid = insertLine(db, gid, "Direct Assurance voiture", 81.84, 5);
  setLineAmount(db, lid, "2026-01", 81.84);

  const writes = lineWrites("2026-07", [{ lineId: lid, amount: 151.84, before: null }]);
  for (const w of writes) setLineAmount(db, w.id, w.month, w.amount);
  let datedLines = toDatedLineAmounts(listLineAmounts(db));
  expect(lineAmountInForce(lid, "2026-07", datedLines)).toBeCloseTo(81.84, 2);
  expect(lineAmountInForce(lid, "2026-08", datedLines)).toBeCloseTo(151.84, 2);

  const enPlace = (w: typeof writes[number]) =>
    (toDatedLineAmounts(listLineAmounts(db))[w.id] ?? []).find((e) => e.effectiveMonth === w.month)?.amount ?? null;
  const { remove } = undoWrites(writes, enPlace);
  for (const w of remove) deleteLineAmount(db, w.id, w.month);
  datedLines = toDatedLineAmounts(listLineAmounts(db));
  expect(lineAmountInForce(lid, "2026-08", datedLines)).toBeCloseTo(81.84, 2);
});
