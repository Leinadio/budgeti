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
import { isGroupAlive, type Group } from "../../../src/lib/forecast";

let db: Database.Database;
beforeEach(() => {
  db = freshDb();
  vi.mocked(revalidatePath).mockClear();
});

// Le budget que le tableau AFFICHE pour ce mois : hors de sa durée de vie, un groupe
// vaut 0 quel que soit son montant daté. C'est la composition de src/lib/history.ts
// (rowFor) — la refaire ici évite de croire une plage respectée alors que seul le
// montant l'était.
const budgetVu = (g: Group, month: string, dated: ReturnType<typeof toDatedBudgets>) =>
  isGroupAlive(g, month) ? budgetInForce(g, month, dated, {}) : 0;

// Le Group tel que le calcul le lit, reconstruit depuis la ligne réellement écrite :
// les bornes viennent de la base, c'est ce qu'on veut vérifier.
const groupOf = (name: string): Group => {
  const row = listGroups(db).find((g) => g.name === name)!;
  expect(row).toBeDefined();
  return {
    id: row.id, accountId: "a1", name: row.name, direction: "out", kind: row.kind,
    monthlyAmount: null, lines: [], startMonth: row.startMonth, endMonth: row.endMonth,
  };
};

test("une enveloppe sans fin a son montant lisible dès son mois de départ, et 0 avant", async () => {
  await createGroup({ accountId: "a1", kind: "envelope", name: "Activités", amount: 250, startMonth: "2026-03", period: "from" });

  const g = groupOf("Activités");
  expect(g.endMonth).toBeNull();
  const dated = toDatedBudgets(listBudgetAmounts(db));
  expect(budgetVu(g, "2026-02", dated)).toBe(0);
  expect(budgetVu(g, "2026-03", dated)).toBe(250);
  expect(budgetVu(g, "2027-01", dated)).toBe(250);
});

// « De mars à mai » : le groupe vit trois mois et disparaît, sans qu'on ait à revenir
// le supprimer à la main.
test("une enveloppe bornée ne compte que dans sa plage", async () => {
  await createGroup({ accountId: "a1", kind: "envelope", name: "Stage", amount: 120, startMonth: "2026-03", endMonth: "2026-05", period: "range" });

  const g = groupOf("Stage");
  expect([g.startMonth, g.endMonth]).toEqual(["2026-03", "2026-05"]);
  const dated = toDatedBudgets(listBudgetAmounts(db));
  expect(budgetVu(g, "2026-02", dated)).toBe(0);
  expect(budgetVu(g, "2026-03", dated)).toBe(120);
  expect(budgetVu(g, "2026-05", dated)).toBe(120);
  expect(budgetVu(g, "2026-06", dated)).toBe(0);
});

test("une enveloppe d'un seul mois commence et finit au même mois", async () => {
  await createGroup({ accountId: "a1", kind: "envelope", name: "Vacances", amount: 800, startMonth: "2026-08", period: "single" });

  const g = groupOf("Vacances");
  expect([g.startMonth, g.endMonth]).toEqual(["2026-08", "2026-08"]);
  const dated = toDatedBudgets(listBudgetAmounts(db));
  expect(budgetVu(g, "2026-08", dated)).toBe(800);
  expect(budgetVu(g, "2026-09", dated)).toBe(0);
});

// Une plage qui finit avant de commencer ne décrit aucun mois vécu : rien n'est créé.
test("refuse une fin antérieure au départ", async () => {
  await createGroup({ accountId: "a1", kind: "envelope", name: "Impossible", amount: 50, startMonth: "2026-08", endMonth: "2026-05", period: "range" });

  expect(listGroups(db).find((g) => g.name === "Impossible")).toBeUndefined();
});

test("un récurrent créé n'a aucune entrée de groupe", async () => {
  await createGroup({ accountId: "a1", kind: "recurring", name: "Abonnements", amount: null, startMonth: "2026-03", period: "from" });

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
