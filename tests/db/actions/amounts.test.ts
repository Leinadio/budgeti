// Teste setGroupAmount, setUncatProvision, removeGroupAmount et removeLineAmount
// (src/app/historique/actions.ts) réellement appelées, base en mémoire (voir ./setup).
import { beforeEach, describe, expect, test, vi } from "vitest";
import type Database from "better-sqlite3";
import { freshDb, at } from "./setup";
import { setGroupAmount, setUncatProvision, removeGroupAmount, removeLineAmount, addGroupLine, setGroupLineAmount, spreadGroupAmount, spreadUncatProvision, spreadGroupLineAmount } from "../../../src/app/historique/actions";
import { revalidatePath } from "next/cache";
import { insertGroup } from "../../../src/db/repositories/groups";
import { listBudgetAmounts, setBudgetAmount } from "../../../src/db/repositories/budget-amounts";
import { listLineAmounts } from "../../../src/db/repositories/line-amounts";
import { toDatedBudgets, toDatedLineAmounts, budgetInForce, lineAmountInForce, provisionInForce } from "../../../src/lib/history";
import type { Group } from "../../../src/lib/forecast";

let db: Database.Database;
beforeEach(() => {
  db = freshDb();
  vi.mocked(revalidatePath).mockClear();
});

test("setGroupAmount « à partir de ce mois » vaut pour les mois suivants", async () => {
  const gid = insertGroup(db, "a1", "Courses", "out", 300, "2026-01", null);
  setBudgetAmount(db, gid, "2026-01", 300);

  await setGroupAmount(gid, "2026-06", 350, "ongoing");

  const g: Group = { id: gid, accountId: "a1", name: "Courses", direction: "out", monthlyAmount: null, lines: [], startMonth: "2026-01", endMonth: null };
  const dated = toDatedBudgets(listBudgetAmounts(db));
  expect(budgetInForce(g, "2026-05", dated, {})).toBe(300);
  expect(budgetInForce(g, "2026-06", dated, {})).toBe(350);
  expect(budgetInForce(g, "2027-01", dated, {})).toBe(350);
});

// « Ce mois seulement » n'écrit plus qu'UNE entrée, dans son mois, avec sa portée.
// Avant, une restauration de l'ancien montant était posée au mois SUIVANT : une
// écriture dans un mois que personne n'avait demandé à changer, qui se relisait
// ensuite dans la frise comme un changement jamais fait.
test("setGroupAmount « ce mois seulement » ne vaut que pour son mois, sans rien écrire au mois suivant", async () => {
  const gid = insertGroup(db, "a1", "Courses", "out", 300, "2026-01", null);
  setBudgetAmount(db, gid, "2026-01", 300);

  await setGroupAmount(gid, "2026-06", 350, "once");

  // Une seule écriture ajoutée, à son mois, marquée ponctuelle. Rien en 2026-07.
  expect(listBudgetAmounts(db).filter((b) => b.groupId === gid)).toEqual([
    { groupId: gid, effectiveMonth: "2026-01", amount: 300, scope: "ongoing" },
    { groupId: gid, effectiveMonth: "2026-06", amount: 350, scope: "once" },
  ]);
  const g: Group = { id: gid, accountId: "a1", name: "Courses", direction: "out", monthlyAmount: null, lines: [], startMonth: "2026-01", endMonth: null };
  const dated = toDatedBudgets(listBudgetAmounts(db));
  expect(budgetInForce(g, "2026-06", dated, {})).toBe(350);
  expect(budgetInForce(g, "2026-07", dated, {})).toBe(300);
});

// Le montant permanent qui commence le même mois doit survivre à l'exception : sans
// portée dans la clé, l'un écraserait l'autre et juillet retomberait sur 300.
test("setGroupAmount garde le permanent et l'exception du même mois côte à côte", async () => {
  const gid = insertGroup(db, "a1", "Courses", "out", 300, "2026-01", null);
  setBudgetAmount(db, gid, "2026-01", 300);

  await setGroupAmount(gid, "2026-06", 320, "ongoing");
  await setGroupAmount(gid, "2026-06", 500, "once");

  const g: Group = { id: gid, accountId: "a1", name: "Courses", direction: "out", monthlyAmount: null, lines: [], startMonth: "2026-01", endMonth: null };
  const dated = toDatedBudgets(listBudgetAmounts(db));
  expect(budgetInForce(g, "2026-06", dated, {})).toBe(500);
  expect(budgetInForce(g, "2026-07", dated, {})).toBe(320);
});

test("setUncatProvision « à partir de ce mois » vaut pour les mois suivants (groupe 0, virtuel)", async () => {
  setBudgetAmount(db, 0, "2026-01", 100);

  await setUncatProvision("2026-06", 150, "ongoing");

  const dated = toDatedBudgets(listBudgetAmounts(db));
  expect((dated[0] ?? []).find((e) => e.effectiveMonth === "2026-06")?.amount).toBe(150);
  expect((dated[0] ?? []).find((e) => e.effectiveMonth === "2026-01")?.amount).toBe(100);
});

test("setUncatProvision « ce mois seulement » ne vaut que pour son mois", async () => {
  setBudgetAmount(db, 0, "2026-01", 100);

  await setUncatProvision("2026-06", 150, "once");

  const dated = toDatedBudgets(listBudgetAmounts(db));
  expect(provisionInForce(dated, "2026-06")).toBe(150);
  expect(provisionInForce(dated, "2026-07")).toBe(100);
  expect((dated[0] ?? []).some((e) => e.effectiveMonth === "2026-07")).toBe(false);
});

test("removeGroupAmount refuse de supprimer le montant de départ", async () => {
  const gid = insertGroup(db, "a1", "Courses", "out", 300, "2026-01", null);
  setBudgetAmount(db, gid, "2026-01", 300);

  await removeGroupAmount(gid, "2026-01");

  expect(listBudgetAmounts(db).filter((b) => b.groupId === gid)).toEqual([{ groupId: gid, effectiveMonth: "2026-01", amount: 300, scope: "ongoing" }]);
});

test("removeGroupAmount accepte de supprimer un changement postérieur au montant de départ", async () => {
  const gid = insertGroup(db, "a1", "Courses", "out", 300, "2026-01", null);
  setBudgetAmount(db, gid, "2026-01", 300);
  setBudgetAmount(db, gid, "2026-06", 350);

  await removeGroupAmount(gid, "2026-06");

  expect(listBudgetAmounts(db).filter((b) => b.groupId === gid)).toEqual([{ groupId: gid, effectiveMonth: "2026-01", amount: 300, scope: "ongoing" }]);
});

test("removeLineAmount refuse de supprimer le montant de départ d'une ligne", async () => {
  const gid = insertGroup(db, "a1", "Abonnements", "out", 0, "2026-01", null);
  const lid = await addGroupLine(gid, "Spotify", 10, "2026-01");

  await removeLineAmount(lid, "2026-01");

  expect(listLineAmounts(db).filter((l) => l.lineId === lid)).toEqual([{ lineId: lid, effectiveMonth: "2026-01", amount: 10, scope: "ongoing" }]);
});

test("removeLineAmount accepte de supprimer un changement postérieur au montant de départ d'une ligne", async () => {
  const gid = insertGroup(db, "a1", "Abonnements", "out", 0, "2026-01", null);
  const lid = await addGroupLine(gid, "Spotify", 10, "2026-01");
  await setGroupLineAmount(lid, "2026-06", 15, "ongoing");

  await removeLineAmount(lid, "2026-06");

  const datedLines = toDatedLineAmounts(listLineAmounts(db));
  expect(lineAmountInForce(lid, "2026-06", datedLines)).toBe(10); // retombe sur le montant de départ
});

// Le panneau « Gérer le groupe » garde son propre état (detail-sidebar.tsx :
// figé au clic) : router.refresh() ne le remplace pas. Ces actions renvoient donc
// la vie du budget à jour (Vie du budget affichée, champ montant), pour que le
// composant puisse la réafficher sans recalculer les écritures lui-même (une
// seconde fois, avec le risque de diverger de ce que le serveur vient de poser).
test("setGroupAmount renvoie la vie du budget à jour du groupe", async () => {
  const gid = insertGroup(db, "a1", "Courses", "out", 300, "2026-01", null);
  setBudgetAmount(db, gid, "2026-01", 300);

  const changes = await setGroupAmount(gid, "2026-06", 350, "ongoing");

  expect(changes).toEqual([
    { month: "2026-01", amount: 300, isStart: true, scope: "ongoing" },
    { month: "2026-06", amount: 350, isStart: false, scope: "ongoing" },
  ]);
});

test("removeGroupAmount renvoie la vie du budget à jour du groupe, y compris quand la suppression est refusée", async () => {
  const gid = insertGroup(db, "a1", "Courses", "out", 300, "2026-01", null);
  setBudgetAmount(db, gid, "2026-01", 300);
  setBudgetAmount(db, gid, "2026-06", 350);

  const changes = await removeGroupAmount(gid, "2026-06");
  expect(changes).toEqual([{ month: "2026-01", amount: 300, isStart: true, scope: "ongoing" }]);

  // Refusé (montant de départ) : la vie du budget renvoyée reste quand même à jour,
  // pour que le panneau ne se retrouve jamais désynchronisé après un refus silencieux.
  const apresRefus = await removeGroupAmount(gid, "2026-01");
  expect(apresRefus).toEqual([{ month: "2026-01", amount: 300, isStart: true, scope: "ongoing" }]);
});

test("removeLineAmount renvoie la vie du budget à jour de la ligne", async () => {
  const gid = insertGroup(db, "a1", "Abonnements", "out", 0, "2026-01", null);
  const lid = await addGroupLine(gid, "Spotify", 10, "2026-01");
  await setGroupLineAmount(lid, "2026-06", 15, "ongoing");

  const changes = await removeLineAmount(lid, "2026-06");

  expect(changes).toEqual([{ month: "2026-01", amount: 10, isStart: true, scope: "ongoing" }]);
});

// La suppression vise une entrée précise, portée comprise : retirer l'exception de
// juillet ne doit pas emporter le montant durable qui commence le même mois. Sans ça,
// les mois suivants retomberaient sur un montant plus ancien que le bon.
test("removeGroupAmount ne retire que la portée visée", async () => {
  const gid = insertGroup(db, "a1", "Courses", "out", 300, "2026-01", null);
  setBudgetAmount(db, gid, "2026-01", 300);
  await setGroupAmount(gid, "2026-06", 320, "ongoing");
  await setGroupAmount(gid, "2026-06", 500, "once");

  await removeGroupAmount(gid, "2026-06", "once");

  expect(listBudgetAmounts(db).filter((b) => b.groupId === gid)).toEqual([
    { groupId: gid, effectiveMonth: "2026-01", amount: 300, scope: "ongoing" },
    { groupId: gid, effectiveMonth: "2026-06", amount: 320, scope: "ongoing" },
  ]);
});

// Une exception ne sert de socle à personne : elle se retire toujours, même seule.
test("removeGroupAmount retire une exception même quand c'est la seule entrée", async () => {
  const gid = insertGroup(db, "a1", "Courses", "out", 300, "2026-01", null);
  await setGroupAmount(gid, "2026-06", 500, "once");

  await removeGroupAmount(gid, "2026-06", "once");

  expect(listBudgetAmounts(db).filter((b) => b.groupId === gid)).toEqual([]);
});

// Le montant se pose d'abord pour le seul mois cliqué ; on demande ensuite si les mois
// suivants doivent le reprendre. Répondre oui rend ce montant durable à partir de ce
// mois — et retire l'exception qui le portait, devenue redondante : la garder laisserait
// deux entrées disant la même chose pour le même mois.
// Le montant se pose d'abord pour le seul mois cliqué ; on demande ensuite si les mois
// suivants doivent le reprendre. Répondre oui aligne VRAIMENT tous les mois suivants sur
// ce montant : les changements déjà posés plus tard sont supprimés, pas contournés.
// C'est destructeur et c'est voulu — « tous les mois suivants au même montant » ne
// souffre pas d'exception, sinon la réponse ne veut pas dire ce qu'elle dit.
describe("propager un montant aux mois suivants", () => {
  test("rend le montant durable et retire l'exception du mois", async () => {
    const gid = insertGroup(db, "a1", "Courses", "out", 300, "2026-01", null);
    setBudgetAmount(db, gid, "2026-01", 300);
    await setGroupAmount(gid, "2026-06", 350, "once");

    await spreadGroupAmount(gid, "2026-06", 350);

    expect(listBudgetAmounts(db).filter((b) => b.groupId === gid)).toEqual([
      { groupId: gid, effectiveMonth: "2026-01", amount: 300, scope: "ongoing" },
      { groupId: gid, effectiveMonth: "2026-06", amount: 350, scope: "ongoing" },
    ]);
    const g: Group = { id: gid, accountId: "a1", name: "Courses", direction: "out", monthlyAmount: null, lines: [], startMonth: "2026-01", endMonth: null };
    const dated = toDatedBudgets(listBudgetAmounts(db));
    expect(budgetInForce(g, "2026-06", dated, {})).toBe(350);
    expect(budgetInForce(g, "2026-09", dated, {})).toBe(350);
  });

  test("aligne les mois suivants même quand ils portaient déjà un montant à eux", async () => {
    const gid = insertGroup(db, "a1", "Courses", "out", 300, "2026-01", null);
    setBudgetAmount(db, gid, "2026-01", 300);
    setBudgetAmount(db, gid, "2026-09", 250);          // un changement durable prévu plus tard
    setBudgetAmount(db, gid, "2026-10", 100, "once");  // et une exception encore plus tard

    await spreadGroupAmount(gid, "2026-06", 350);

    const g: Group = { id: gid, accountId: "a1", name: "Courses", direction: "out", monthlyAmount: null, lines: [], startMonth: "2026-01", endMonth: null };
    const dated = toDatedBudgets(listBudgetAmounts(db));
    expect(budgetInForce(g, "2026-09", dated, {})).toBe(350);
    expect(budgetInForce(g, "2026-10", dated, {})).toBe(350);
    expect(listBudgetAmounts(db).filter((b) => b.groupId === gid)).toEqual([
      { groupId: gid, effectiveMonth: "2026-01", amount: 300, scope: "ongoing" },
      { groupId: gid, effectiveMonth: "2026-06", amount: 350, scope: "ongoing" },
    ]);
  });

  // Les mois d'AVANT ne bougent pas : la propagation regarde devant, quel que soit
  // le mois d'où elle part.
  test("ne touche à aucun mois antérieur", async () => {
    const gid = insertGroup(db, "a1", "Courses", "out", 300, "2026-01", null);
    setBudgetAmount(db, gid, "2026-01", 300);
    setBudgetAmount(db, gid, "2026-04", 320);

    await spreadGroupAmount(gid, "2026-06", 350);

    const g: Group = { id: gid, accountId: "a1", name: "Courses", direction: "out", monthlyAmount: null, lines: [], startMonth: "2026-01", endMonth: null };
    const dated = toDatedBudgets(listBudgetAmounts(db));
    expect(budgetInForce(g, "2026-02", dated, {})).toBe(300);
    expect(budgetInForce(g, "2026-05", dated, {})).toBe(320);
  });

  // Partir d'un mois passé ne change rien à la règle : le montant devient durable à
  // partir de là, et tout ce qui suit est effacé, y compris un changement futur.
  test("propage depuis un mois passé", async () => {
    const gid = insertGroup(db, "a1", "Courses", "out", 300, "2026-01", null);
    setBudgetAmount(db, gid, "2026-01", 300);
    setBudgetAmount(db, gid, "2026-09", 250);
    at("2026-07");

    await spreadGroupAmount(gid, "2026-03", 350);

    expect(listBudgetAmounts(db).filter((b) => b.groupId === gid)).toEqual([
      { groupId: gid, effectiveMonth: "2026-01", amount: 300, scope: "ongoing" },
      { groupId: gid, effectiveMonth: "2026-03", amount: 350, scope: "ongoing" },
    ]);
  });

  test("propage aussi le montant d'une ligne de récurrent, en écrasant ce qui suit", async () => {
    const gid = insertGroup(db, "a1", "Abonnements", "out", 0, "2026-01", null);
    const lid = await addGroupLine(gid, "Spotify", 10, "2026-01");
    await setGroupLineAmount(lid, "2026-09", 18, "ongoing");
    await setGroupLineAmount(lid, "2026-06", 25, "once");

    await spreadGroupLineAmount(lid, "2026-06", 25);

    const datedLines = toDatedLineAmounts(listLineAmounts(db));
    expect(lineAmountInForce(lid, "2026-06", datedLines)).toBe(25);
    expect(lineAmountInForce(lid, "2026-09", datedLines)).toBe(25);
    expect(listLineAmounts(db).filter((l) => l.lineId === lid && l.effectiveMonth > "2026-06")).toEqual([]);
  });

  test("propage aussi la provision des non catégorisés, en écrasant ce qui suit", async () => {
    setBudgetAmount(db, 0, "2026-01", 100);
    setBudgetAmount(db, 0, "2026-09", 200);
    await setUncatProvision("2026-06", 150, "once");

    await spreadUncatProvision("2026-06", 150);

    const dated = toDatedBudgets(listBudgetAmounts(db));
    expect(provisionInForce(dated, "2026-06")).toBe(150);
    expect(provisionInForce(dated, "2026-09")).toBe(150);
    expect((dated[0] ?? []).filter((e) => e.effectiveMonth > "2026-06")).toEqual([]);
  });
});
