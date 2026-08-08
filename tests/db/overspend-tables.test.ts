import { test, expect } from "vitest";
import { getDb } from "../../src/db/index";
import { listBudgetAmounts, setBudgetAmount } from "../../src/db/repositories/budget-amounts";

function freshDb() {
  const db = getDb(":memory:");
  db.prepare(`INSERT INTO accounts (id, name) VALUES ('a1', 'CIC')`).run();
  db.prepare(
    `INSERT INTO groups (id, account_id, name, direction, monthly_amount) VALUES (1, 'a1', 'Courses', 'out', 300)`,
  ).run();
  return db;
}

test("budget_amounts : upsert et lecture triée", () => {
  const db = freshDb();
  setBudgetAmount(db, 1, "2026-08", 400);
  setBudgetAmount(db, 1, "2026-10", 450);
  setBudgetAmount(db, 1, "2026-08", 410); // upsert : remplace le montant d'août
  expect(listBudgetAmounts(db)).toEqual([
    { groupId: 1, effectiveMonth: "2026-08", amount: 410, scope: "ongoing" },
    { groupId: 1, effectiveMonth: "2026-10", amount: 450, scope: "ongoing" },
  ]);
});

test("budget_amounts : provision groupe 0 (non catégorisés) sans FK", () => {
  const db = freshDb();
  setBudgetAmount(db, 0, "2026-08", 400);
  expect(listBudgetAmounts(db)).toEqual([{ groupId: 0, effectiveMonth: "2026-08", amount: 400, scope: "ongoing" }]);
});

// La colonne `writes` est une colonne libre (TEXT), pas contrainte par le schéma :
// une valeur corrompue (écriture concurrente, migration future ratée…) ne doit
// jamais faire planter la lecture. listOverspendDecisions est appelé au
// chargement de /historique : une seule ligne corrompue ne doit pas casser toute
// la page.