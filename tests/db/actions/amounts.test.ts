// Teste setGroupAmount, setUncatProvision, removeGroupAmount et removeLineAmount
// (src/app/historique/actions.ts) réellement appelées, base en mémoire (voir ./setup).
import { beforeEach, expect, test, vi } from "vitest";
import type Database from "better-sqlite3";
import { freshDb } from "./setup";
import { setGroupAmount, setUncatProvision, removeGroupAmount, removeLineAmount, addGroupLine, editGroupLine } from "../../../src/app/historique/actions";
import { revalidatePath } from "next/cache";
import { insertEnvelopeGroup, insertRecurringGroup } from "../../../src/db/repositories/groups";
import { listBudgetAmounts, setBudgetAmount } from "../../../src/db/repositories/budget-amounts";
import { listLineAmounts } from "../../../src/db/repositories/line-amounts";
import { toDatedBudgets, toDatedLineAmounts, budgetInForce, lineAmountInForce } from "../../../src/lib/history";
import type { Group } from "../../../src/lib/forecast";

let db: Database.Database;
beforeEach(() => {
  db = freshDb();
  vi.mocked(revalidatePath).mockClear();
});

test("setGroupAmount « à partir de ce mois » vaut pour les mois suivants", async () => {
  const gid = insertEnvelopeGroup(db, "a1", "Courses", "out", 300, null, "2026-01", null);
  setBudgetAmount(db, gid, "2026-01", 300);

  await setGroupAmount(gid, "2026-06", 350, "ongoing");

  const g: Group = { id: gid, accountId: "a1", name: "Courses", direction: "out", kind: "envelope", monthlyAmount: null, lines: [], startMonth: "2026-01", endMonth: null };
  const dated = toDatedBudgets(listBudgetAmounts(db));
  expect(budgetInForce(g, "2026-05", dated, {})).toBe(300);
  expect(budgetInForce(g, "2026-06", dated, {})).toBe(350);
  expect(budgetInForce(g, "2027-01", dated, {})).toBe(350);
});

test("setGroupAmount « ce mois seulement » restaure le montant précédent au mois suivant", async () => {
  const gid = insertEnvelopeGroup(db, "a1", "Courses", "out", 300, null, "2026-01", null);
  setBudgetAmount(db, gid, "2026-01", 300);

  await setGroupAmount(gid, "2026-06", 350, "once");

  const g: Group = { id: gid, accountId: "a1", name: "Courses", direction: "out", kind: "envelope", monthlyAmount: null, lines: [], startMonth: "2026-01", endMonth: null };
  const dated = toDatedBudgets(listBudgetAmounts(db));
  expect(budgetInForce(g, "2026-06", dated, {})).toBe(350);
  expect(budgetInForce(g, "2026-07", dated, {})).toBe(300);
});

test("setUncatProvision « à partir de ce mois » vaut pour les mois suivants (groupe 0, virtuel)", async () => {
  setBudgetAmount(db, 0, "2026-01", 100);

  await setUncatProvision("2026-06", 150, "ongoing");

  const dated = toDatedBudgets(listBudgetAmounts(db));
  expect((dated[0] ?? []).find((e) => e.effectiveMonth === "2026-06")?.amount).toBe(150);
  expect((dated[0] ?? []).find((e) => e.effectiveMonth === "2026-01")?.amount).toBe(100);
});

test("setUncatProvision « ce mois seulement » restaure le montant précédent au mois suivant", async () => {
  setBudgetAmount(db, 0, "2026-01", 100);

  await setUncatProvision("2026-06", 150, "once");

  const dated = toDatedBudgets(listBudgetAmounts(db));
  expect((dated[0] ?? []).find((e) => e.effectiveMonth === "2026-06")?.amount).toBe(150);
  expect((dated[0] ?? []).find((e) => e.effectiveMonth === "2026-07")?.amount).toBe(100);
});

test("removeGroupAmount refuse de supprimer le montant de départ", async () => {
  const gid = insertEnvelopeGroup(db, "a1", "Courses", "out", 300, null, "2026-01", null);
  setBudgetAmount(db, gid, "2026-01", 300);

  await removeGroupAmount(gid, "2026-01");

  expect(listBudgetAmounts(db).filter((b) => b.groupId === gid)).toEqual([{ groupId: gid, effectiveMonth: "2026-01", amount: 300 }]);
});

test("removeGroupAmount accepte de supprimer un changement postérieur au montant de départ", async () => {
  const gid = insertEnvelopeGroup(db, "a1", "Courses", "out", 300, null, "2026-01", null);
  setBudgetAmount(db, gid, "2026-01", 300);
  setBudgetAmount(db, gid, "2026-06", 350);

  await removeGroupAmount(gid, "2026-06");

  expect(listBudgetAmounts(db).filter((b) => b.groupId === gid)).toEqual([{ groupId: gid, effectiveMonth: "2026-01", amount: 300 }]);
});

test("removeLineAmount refuse de supprimer le montant de départ d'une ligne", async () => {
  const gid = insertRecurringGroup(db, "a1", "Abonnements", "out", null, "2026-01", null);
  const lid = await addGroupLine(gid, "Spotify", 10, 3, "2026-01");

  await removeLineAmount(lid, "2026-01");

  expect(listLineAmounts(db).filter((l) => l.lineId === lid)).toEqual([{ lineId: lid, effectiveMonth: "2026-01", amount: 10 }]);
});

test("removeLineAmount accepte de supprimer un changement postérieur au montant de départ d'une ligne", async () => {
  const gid = insertRecurringGroup(db, "a1", "Abonnements", "out", null, "2026-01", null);
  const lid = await addGroupLine(gid, "Spotify", 10, 3, "2026-01");
  await editGroupLine(lid, "Spotify", 3, "2026-06", 15, "ongoing");

  await removeLineAmount(lid, "2026-06");

  const datedLines = toDatedLineAmounts(listLineAmounts(db));
  expect(lineAmountInForce(lid, "2026-06", datedLines)).toBe(10); // retombe sur le montant de départ
});
