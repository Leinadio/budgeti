import { expect, test } from "vitest";
import { getDb } from "../../src/db/index";
import { upsertAccount } from "../../src/db/repositories/accounts";
import { insertEnvelopeGroup, insertRecurringGroup, insertLine } from "../../src/db/repositories/groups";
import { listBudgetAmounts, setBudgetAmount } from "../../src/db/repositories/budget-amounts";
import { listLineAmounts, setLineAmount } from "../../src/db/repositories/line-amounts";
import { onceBudgetWrites, toDatedBudgets, toDatedLineAmounts, budgetInForce, lineAmountInForce } from "../../src/lib/history";
import type { Group } from "../../src/lib/forecast";

function seed() {
  const db = getDb(":memory:");
  upsertAccount(db, { id: "a1", name: "CIC", iban_masked: null, balance: 0, currency: "EUR", last_synced: null });
  return db;
}

test("une enveloppe créée est immédiatement lisible à son mois de départ", () => {
  const db = seed();
  const gid = insertEnvelopeGroup(db, "a1", "Activités", "out", 250, null, "2026-03", null);
  // getDb a déjà lancé la reprise ; ici c'est la création qui doit poser l'entrée.
  // "use server" empêche d'appeler createGroup (actions.ts) directement depuis
  // Vitest : cet appel reproduit donc son corps (insertEnvelopeGroup +
  // setBudgetAmount) plutôt que de contourner le test. Le retirer casserait
  // l'assertion pour de bon, quel que soit le contenu de actions.ts, puisque
  // rien d'autre dans ce test n'écrit l'entrée datée.
  setBudgetAmount(db, gid, "2026-03", 250);
  const g: Group = { id: gid, accountId: "a1", name: "Activités", direction: "out", kind: "envelope", monthlyAmount: null, lines: [], startMonth: "2026-03", endMonth: null };
  const dated = toDatedBudgets(listBudgetAmounts(db));
  expect(budgetInForce(g, "2026-02", dated, {})).toBe(0);
  expect(budgetInForce(g, "2026-03", dated, {})).toBe(250);
  expect(budgetInForce(g, "2027-01", dated, {})).toBe(250);
});

test("une ligne ajoutée en cours de route ne compte qu'à partir de son mois", () => {
  const db = seed();
  const gid = insertRecurringGroup(db, "a1", "Abonnements", "out", null, "2026-01", null);
  const l1 = insertLine(db, gid, "Spotify", 10, 3);
  setLineAmount(db, l1, "2026-01", 10);
  const l2 = insertLine(db, gid, "Netflix", 15, 8);
  setLineAmount(db, l2, "2026-06", 15);
  const g: Group = {
    id: gid, accountId: "a1", name: "Abonnements", direction: "out", kind: "recurring",
    monthlyAmount: null, startMonth: "2026-01", endMonth: null,
    lines: [{ id: l1, name: "Spotify", amount: 10, day: 3 }, { id: l2, name: "Netflix", amount: 15, day: 8 }],
  };
  const datedLines = toDatedLineAmounts(listLineAmounts(db));
  expect(budgetInForce(g, "2026-05", {}, datedLines)).toBe(10);
  expect(budgetInForce(g, "2026-06", {}, datedLines)).toBe(25);
});

test("« ce mois seulement » sur une ligne restaure le montant au mois suivant", () => {
  const db = seed();
  const gid = insertRecurringGroup(db, "a1", "Abonnements", "out", null, "2026-01", null);
  const lid = insertLine(db, gid, "Spotify", 10, 3);
  setLineAmount(db, lid, "2026-01", 10);
  const existantes = toDatedLineAmounts(listLineAmounts(db))[lid] ?? [];
  const { writes } = onceBudgetWrites(existantes, "2026-07", 25);
  for (const w of writes) setLineAmount(db, lid, w.effectiveMonth, w.amount);
  const datedLines = toDatedLineAmounts(listLineAmounts(db));
  expect(lineAmountInForce(lid, "2026-06", datedLines)).toBe(10);
  expect(lineAmountInForce(lid, "2026-07", datedLines)).toBe(25);
  expect(lineAmountInForce(lid, "2026-08", datedLines)).toBe(10);
});

test("« ce mois seulement » n'écrase pas un changement déjà prévu au mois suivant", () => {
  const db = seed();
  const gid = insertRecurringGroup(db, "a1", "Abonnements", "out", null, "2026-01", null);
  const lid = insertLine(db, gid, "Spotify", 10, 3);
  setLineAmount(db, lid, "2026-01", 10);
  setLineAmount(db, lid, "2026-08", 30); // hausse permanente déjà décidée
  const existantes = toDatedLineAmounts(listLineAmounts(db))[lid] ?? [];
  const { writes } = onceBudgetWrites(existantes, "2026-07", 25);
  for (const w of writes) setLineAmount(db, lid, w.effectiveMonth, w.amount);
  const datedLines = toDatedLineAmounts(listLineAmounts(db));
  expect(lineAmountInForce(lid, "2026-07", datedLines)).toBe(25);
  expect(lineAmountInForce(lid, "2026-08", datedLines)).toBe(30);
});
