// Teste createGroup (src/app/historique/actions.ts) réellement appelée, base en
// mémoire (voir ./setup).
import { beforeEach, expect, test, vi } from "vitest";
import type Database from "better-sqlite3";
import { freshDb } from "./setup";
import { createGroup } from "../../../src/app/historique/actions";
import { ORIGIN_MONTH } from "../../../src/lib/group-period";
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
    id: row.id, accountId: "a1", name: row.name, direction: "out",
    monthlyAmount: null, lines: [], startMonth: row.startMonth, endMonth: row.endMonth,
  };
};

test("une enveloppe sans fin a son montant lisible dès son mois de départ, et 0 avant", async () => {
  await createGroup({ accountId: "a1", name: "Activités", amount: 250, startMonth: "2026-03", period: "from" });

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
  await createGroup({ accountId: "a1", name: "Stage", amount: 120, startMonth: "2026-03", endMonth: "2026-05", period: "range" });

  const g = groupOf("Stage");
  expect([g.startMonth, g.endMonth]).toEqual(["2026-03", "2026-05"]);
  const dated = toDatedBudgets(listBudgetAmounts(db));
  expect(budgetVu(g, "2026-02", dated)).toBe(0);
  expect(budgetVu(g, "2026-03", dated)).toBe(120);
  expect(budgetVu(g, "2026-05", dated)).toBe(120);
  expect(budgetVu(g, "2026-06", dated)).toBe(0);
});

test("une enveloppe d'un seul mois commence et finit au même mois", async () => {
  await createGroup({ accountId: "a1", name: "Vacances", amount: 800, startMonth: "2026-08", period: "single" });

  const g = groupOf("Vacances");
  expect([g.startMonth, g.endMonth]).toEqual(["2026-08", "2026-08"]);
  const dated = toDatedBudgets(listBudgetAmounts(db));
  expect(budgetVu(g, "2026-08", dated)).toBe(800);
  expect(budgetVu(g, "2026-09", dated)).toBe(0);
});

// Une plage qui finit avant de commencer ne décrit aucun mois vécu : rien n'est créé.
test("refuse une fin antérieure au départ", async () => {
  await createGroup({ accountId: "a1", name: "Impossible", amount: 50, startMonth: "2026-08", endMonth: "2026-05", period: "range" });

  expect(listGroups(db).find((g) => g.name === "Impossible")).toBeUndefined();
});

// Une dépense naît plate, donc avec un montant à elle — zéro si on n'en donne pas.
// C'est ce montant qui s'affichera dans sa case, et qu'on ira corriger. Il cessera
// d'être lu le jour où on la découpe en sous-postes.
test("une dépense créée sans montant part de zéro", async () => {
  await createGroup({ accountId: "a1", name: "Abonnements", amount: null, startMonth: "2026-03", period: "from" });

  const row = listGroups(db).find((g) => g.name === "Abonnements")!;
  expect(row).toBeDefined();
  expect(listBudgetAmounts(db).filter((b) => b.groupId === row.id)).toEqual([
    { groupId: row.id, effectiveMonth: "2026-03", amount: 0, scope: "ongoing" },
  ]);
});

// --- Les revenus se créent comme les dépenses -------------------------------
// Avant, un compte avait droit à exactement deux revenus, nommés d'office
// « Rémunération principale » et « Rémunération supplémentaire », permanents tous les
// deux, et le formulaire ne demandait qu'un montant. C'était trop étroit pour ce qu'on
// reçoit vraiment : un salaire, une rémunération extra, un don d'ami en août.
//
// Un revenu est donc devenu un groupe comme un autre, au sens près : son nom, son
// montant et sa durée se demandent dans le même formulaire que ceux d'une dépense.
test("un revenu se crée avec son nom, son montant et sa durée", async () => {
  await createGroup({ accountId: "a1", name: "Rémunération principale", amount: 2500, startMonth: ORIGIN_MONTH, period: "from", direction: "in" });

  const row = listGroups(db).find((g) => g.name === "Rémunération principale")!;
  expect(row).toBeDefined();
  expect(row.direction).toBe("in");
  expect([row.startMonth, row.endMonth]).toEqual([ORIGIN_MONTH, null]);
  expect(listBudgetAmounts(db).filter((b) => b.groupId === row.id)).toEqual([
    { groupId: row.id, effectiveMonth: ORIGIN_MONTH, amount: 2500, scope: "ongoing" },
  ]);
});

// Le plafond de deux tombe : c'est lui qui obligeait à entasser onze virements de
// natures différentes derrière un seul nom.
test("plusieurs revenus cohabitent sur un même compte", async () => {
  await createGroup({ accountId: "a1", name: "Rémunération dirigeant", amount: 650, startMonth: "2026-01", period: "from", direction: "in" });
  await createGroup({ accountId: "a1", name: "Rémunération extra", amount: 500, startMonth: "2026-01", period: "from", direction: "in" });

  expect(listGroups(db).filter((g) => g.direction === "in").map((g) => g.name).sort()).toEqual([
    "Rémunération dirigeant", "Rémunération extra",
  ]);
});

// Le scénario qui remplace l'ancienne « rémunération supplémentaire » : un revenu qui
// ne se reproduit pas se dit par sa durée, et disparaît de lui-même le mois suivant.
test("un revenu d'un seul mois ne vaut que ce mois", async () => {
  await createGroup({ accountId: "a1", name: "Don d'ami", amount: 300, startMonth: "2026-08", period: "single", direction: "in" });

  const row = listGroups(db).find((g) => g.name === "Don d'ami")!;
  const g: Group = {
    id: row.id, accountId: "a1", name: row.name, direction: "in",
    monthlyAmount: null, lines: [], startMonth: row.startMonth, endMonth: row.endMonth,
  };
  const dated = toDatedBudgets(listBudgetAmounts(db));
  expect(budgetVu(g, "2026-07", dated)).toBe(0);
  expect(budgetVu(g, "2026-08", dated)).toBe(300);
  expect(budgetVu(g, "2026-09", dated)).toBe(0);
});

// Le sens ne se devine pas : sans direction, on crée une dépense, comme avant.
test("sans direction, le groupe créé est une dépense", async () => {
  await createGroup({ accountId: "a1", name: "Courses", amount: 400, startMonth: "2026-01", period: "from" });

  expect(listGroups(db).find((g) => g.name === "Courses")!.direction).toBe("out");
});
