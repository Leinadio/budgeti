// Teste createGroup et createRemuneration (src/app/historique/actions.ts) réellement
// appelées, base en mémoire (voir ./setup).
import { beforeEach, expect, test, vi } from "vitest";
import type Database from "better-sqlite3";
import { freshDb } from "./setup";
import { createGroup, createRemuneration } from "../../../src/app/historique/actions";
import { revalidatePath } from "next/cache";
import { listGroups } from "../../../src/db/repositories/groups";
import { listBudgetAmounts } from "../../../src/db/repositories/budget-amounts";
import { toDatedBudgets, budgetInForce } from "../../../src/lib/history";
import type { Group } from "../../../src/lib/forecast";

let db: Database.Database;
beforeEach(() => {
  db = freshDb();
  vi.mocked(revalidatePath).mockClear();
});

test("une enveloppe créée a son montant lisible dès son mois de départ, et 0 avant", async () => {
  await createGroup({ accountId: "a1", kind: "envelope", name: "Activités", amount: 250, startMonth: "2026-03", scope: "ongoing" });

  const row = listGroups(db).find((g) => g.name === "Activités")!;
  expect(row).toBeDefined();
  const g: Group = { id: row.id, accountId: "a1", name: row.name, direction: "out", kind: "envelope", monthlyAmount: null, lines: [], startMonth: "2026-03", endMonth: null };
  const dated = toDatedBudgets(listBudgetAmounts(db));
  expect(budgetInForce(g, "2026-02", dated, {})).toBe(0);
  expect(budgetInForce(g, "2026-03", dated, {})).toBe(250);
  expect(budgetInForce(g, "2027-01", dated, {})).toBe(250);
});

test("un récurrent créé n'a aucune entrée de groupe", async () => {
  await createGroup({ accountId: "a1", kind: "recurring", name: "Abonnements", amount: null, startMonth: "2026-03", scope: "ongoing" });

  const row = listGroups(db).find((g) => g.name === "Abonnements")!;
  expect(row).toBeDefined();
  expect(listBudgetAmounts(db).filter((b) => b.groupId === row.id)).toEqual([]);
});

test("une rémunération créée a son montant lisible dès son mois de départ (2000-01, portée permanente)", async () => {
  await createRemuneration("a1", "principal", 2500);

  const row = listGroups(db).find((g) => g.incomeKind === "principal")!;
  expect(row).toBeDefined();
  expect(row.startMonth).toBe("2000-01");
  expect(row.endMonth).toBeNull();
  expect(listBudgetAmounts(db).filter((b) => b.groupId === row.id)).toEqual([{ groupId: row.id, effectiveMonth: "2000-01", amount: 2500, scope: "ongoing" }]);
});

test("créer une rémunération déjà existante ne duplique rien", async () => {
  await createRemuneration("a1", "principal", 2500);
  await createRemuneration("a1", "principal", 3000); // no-op silencieux : une seule principale par compte

  const rows = listGroups(db).filter((g) => g.incomeKind === "principal");
  expect(rows).toHaveLength(1);
  expect(listBudgetAmounts(db).filter((b) => b.groupId === rows[0].id)).toEqual([{ groupId: rows[0].id, effectiveMonth: "2000-01", amount: 2500, scope: "ongoing" }]);
});
