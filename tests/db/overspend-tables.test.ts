import { test, expect } from "vitest";
import { getDb } from "../../src/db/index";
import { listBudgetAmounts, setBudgetAmount } from "../../src/db/repositories/budget-amounts";
import { listOverspendDecisions, setOverspendDecision } from "../../src/db/repositories/overspend-decisions";

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

test("overspend_decisions : upsert par (compte, groupe, mois), groupId 0 = non catégorisés", () => {
  const db = freshDb();
  setOverspendDecision(db, { accountId: "a1", groupId: 1, month: "2026-07", decision: "exceptional", decidedAt: "2026-08-01T10:00:00Z" });
  setOverspendDecision(db, { accountId: "a1", groupId: 0, month: "2026-07", decision: "exceptional", decidedAt: "2026-08-01T10:00:00Z" });
  setOverspendDecision(db, { accountId: "a1", groupId: 1, month: "2026-07", decision: "permanent", decidedAt: "2026-08-02T10:00:00Z" });
  const rows = listOverspendDecisions(db, "a1");
  expect(rows).toHaveLength(2);
  expect(rows.find((r) => r.groupId === 1)?.decision).toBe("permanent"); // le dernier choix gagne
  expect(rows.find((r) => r.groupId === 0)?.decision).toBe("exceptional");
  expect(listOverspendDecisions(db, "autre")).toHaveLength(0);
});
