// Le verrou des mois passés, vu depuis les actions serveur (src/app/historique/
// actions.ts) réellement appelées, base en mémoire (voir ./setup).
//
// L'écran masquera ce qui n'est pas modifiable, mais ça ne suffit pas : rien
// n'empêche d'appeler une action serveur directement. C'est ici que la règle est
// tenue. Chaque test avance l'horloge après freshDb pour rendre un mois clos —
// freshDb la fige à NOW_MONTH, où tous les mois manipulés sont encore ouverts.
import { beforeEach, describe, expect, test, vi } from "vitest";
import type Database from "better-sqlite3";
import { freshDb, at } from "./setup";
import {
  setGroupAmount, setUncatProvision, removeGroupAmount, removeLineAmount,
  addGroupLine, editGroupLine, setGroupLineAmount,
} from "../../../src/app/historique/actions";
import { revalidatePath } from "next/cache";
import { insertEnvelopeGroup, insertRecurringGroup } from "../../../src/db/repositories/groups";
import { listBudgetAmounts, setBudgetAmount } from "../../../src/db/repositories/budget-amounts";
import { listLineAmounts } from "../../../src/db/repositories/line-amounts";
import { toDatedBudgets, toDatedLineAmounts, lineAmountInForce } from "../../../src/lib/history";

let db: Database.Database;
beforeEach(() => {
  db = freshDb();
  vi.mocked(revalidatePath).mockClear();
  // Nous sommes en juillet 2026 : tout mois d'avant est clos.
  vi.setSystemTime(new Date("2026-07-15T12:00:00Z"));
});

// Montants d'un groupe en base, par mois d'effet, pour vérifier qu'une action
// refusée n'a bien rien écrit du tout.
const amountsOf = (groupId: number) =>
  (toDatedBudgets(listBudgetAmounts(db))[groupId] ?? []).map((e) => [e.effectiveMonth, e.amount]);

describe("setGroupAmount", () => {
  test("refuse d'écrire dans un mois clos", async () => {
    const gid = insertEnvelopeGroup(db, "a1", "Courses", "out", 300, null, "2026-01", null);
    setBudgetAmount(db, gid, "2026-01", 300);

    await setGroupAmount(gid, "2026-03", 350, "ongoing");

    expect(amountsOf(gid)).toEqual([["2026-01", 300]]);
  });

  // « ce mois seulement » écrit deux entrées, dont une au mois suivant : refusée,
  // elle ne doit pas non plus laisser cette seconde entrée derrière elle.
  test("refuse aussi « ce mois seulement » dans un mois clos, sans rien laisser au mois suivant", async () => {
    const gid = insertEnvelopeGroup(db, "a1", "Courses", "out", 300, null, "2026-01", null);
    setBudgetAmount(db, gid, "2026-01", 300);

    await setGroupAmount(gid, "2026-03", 350, "once");

    expect(amountsOf(gid)).toEqual([["2026-01", 300]]);
  });

  test("accepte le mois courant", async () => {
    const gid = insertEnvelopeGroup(db, "a1", "Courses", "out", 300, null, "2026-01", null);
    setBudgetAmount(db, gid, "2026-01", 300);

    await setGroupAmount(gid, "2026-07", 350, "ongoing");

    expect(amountsOf(gid)).toEqual([["2026-01", 300], ["2026-07", 350]]);
  });

  test("accepte un mois futur", async () => {
    const gid = insertEnvelopeGroup(db, "a1", "Courses", "out", 300, null, "2026-01", null);
    setBudgetAmount(db, gid, "2026-01", 300);

    await setGroupAmount(gid, "2026-09", 350, "ongoing");

    expect(amountsOf(gid)).toEqual([["2026-01", 300], ["2026-09", 350]]);
  });

  // Le panneau se resynchronise sur ce qu'elle renvoie : un refus doit rendre la
  // vie du budget telle qu'elle est vraiment en base, pas le montant refusé.
  test("un refus renvoie la vie du budget inchangée", async () => {
    const gid = insertEnvelopeGroup(db, "a1", "Courses", "out", 300, null, "2026-01", null);
    setBudgetAmount(db, gid, "2026-01", 300);

    const changes = await setGroupAmount(gid, "2026-03", 350, "ongoing");

    expect(changes).toEqual([{ month: "2026-01", amount: 300, isStart: true, scope: "ongoing" }]);
  });
});

describe("setUncatProvision", () => {
  test("refuse d'écrire dans un mois clos", async () => {
    setBudgetAmount(db, 0, "2026-01", 100);

    await setUncatProvision("2026-03", 150, "ongoing");

    expect(amountsOf(0)).toEqual([["2026-01", 100]]);
  });

  test("accepte le mois courant", async () => {
    setBudgetAmount(db, 0, "2026-01", 100);

    await setUncatProvision("2026-07", 150, "ongoing");

    expect(amountsOf(0)).toEqual([["2026-01", 100], ["2026-07", 150]]);
  });
});

describe("removeGroupAmount", () => {
  test("refuse de retirer un changement posé dans un mois clos", async () => {
    const gid = insertEnvelopeGroup(db, "a1", "Courses", "out", 300, null, "2026-01", null);
    setBudgetAmount(db, gid, "2026-01", 300);
    setBudgetAmount(db, gid, "2026-03", 350);

    const changes = await removeGroupAmount(gid, "2026-03");

    expect(amountsOf(gid)).toEqual([["2026-01", 300], ["2026-03", 350]]);
    expect(changes).toEqual([
      { month: "2026-01", amount: 300, isStart: true, scope: "ongoing" },
      { month: "2026-03", amount: 350, isStart: false, scope: "ongoing" },
    ]);
  });

  test("accepte de retirer un changement du mois courant", async () => {
    const gid = insertEnvelopeGroup(db, "a1", "Courses", "out", 300, null, "2026-01", null);
    setBudgetAmount(db, gid, "2026-01", 300);
    setBudgetAmount(db, gid, "2026-07", 350);

    await removeGroupAmount(gid, "2026-07");

    expect(amountsOf(gid)).toEqual([["2026-01", 300]]);
  });
});

describe("addGroupLine", () => {
  test("refuse de créer une ligne dans un mois clos", async () => {
    const gid = insertRecurringGroup(db, "a1", "Abonnements", "out", null, "2026-01", null);

    const lid = await addGroupLine(gid, "Netflix", 15, 8, "2026-03");

    expect(lid).toBe(-1);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM group_lines`).get()).toEqual({ n: 0 });
  });

  test("accepte de créer une ligne au mois courant", async () => {
    const gid = insertRecurringGroup(db, "a1", "Abonnements", "out", null, "2026-01", null);

    const lid = await addGroupLine(gid, "Netflix", 15, 8, "2026-07");

    expect(lid).toBeGreaterThan(0);
    expect(lineAmountInForce(lid, "2026-07", toDatedLineAmounts(listLineAmounts(db)))).toBe(15);
  });
});

describe("setGroupLineAmount", () => {
  test("refuse de modifier le montant d'une ligne dans un mois clos", async () => {
    const gid = insertRecurringGroup(db, "a1", "Abonnements", "out", null, "2026-01", null);
    at("2026-01");
    const lid = await addGroupLine(gid, "Spotify", 10, 3, "2026-01");
    at("2026-07");

    await setGroupLineAmount(lid, "2026-03", 12, "ongoing");

    const datedLines = toDatedLineAmounts(listLineAmounts(db));
    expect(lineAmountInForce(lid, "2026-03", datedLines)).toBe(10);
    expect(lineAmountInForce(lid, "2026-07", datedLines)).toBe(10);
  });

  test("accepte le mois courant", async () => {
    const gid = insertRecurringGroup(db, "a1", "Abonnements", "out", null, "2026-01", null);
    at("2026-01");
    const lid = await addGroupLine(gid, "Spotify", 10, 3, "2026-01");
    at("2026-07");

    await setGroupLineAmount(lid, "2026-07", 12, "ongoing");

    expect(lineAmountInForce(lid, "2026-07", toDatedLineAmounts(listLineAmounts(db)))).toBe(12);
  });

  // Renommer une ligne n'a pas de mois : ce sont des propriétés qui valent pour tous
  // les mois, rien n'y est réécrit du passé. Le verrou ne s'y applique donc pas, même
  // depuis un mois où tout le reste est figé.
  test("renommer une ligne reste possible, quel que soit le calendrier", async () => {
    const gid = insertRecurringGroup(db, "a1", "Abonnements", "out", null, "2026-01", null);
    at("2026-01");
    const lid = await addGroupLine(gid, "Spotify", 10, 3, "2026-01");
    at("2026-07");

    await editGroupLine(lid, "Spotify Famille", 15);

    expect(db.prepare(`SELECT name, day FROM group_lines WHERE id = ?`).get(lid)).toEqual({ name: "Spotify Famille", day: 15 });
  });
});

describe("removeLineAmount", () => {
  test("refuse de retirer un montant posé dans un mois clos", async () => {
    const gid = insertRecurringGroup(db, "a1", "Abonnements", "out", null, "2026-01", null);
    at("2026-01");
    const lid = await addGroupLine(gid, "Spotify", 10, 3, "2026-01");
    at("2026-07");
    await setGroupLineAmount(lid, "2026-07", 12, "ongoing");
    at("2026-09");

    const changes = await removeLineAmount(lid, "2026-07");

    expect(lineAmountInForce(lid, "2026-07", toDatedLineAmounts(listLineAmounts(db)))).toBe(12);
    expect(changes).toEqual([
      { month: "2026-01", amount: 10, isStart: true, scope: "ongoing" },
      { month: "2026-07", amount: 12, isStart: false, scope: "ongoing" },
    ]);
  });

  test("accepte de retirer un montant du mois courant", async () => {
    const gid = insertRecurringGroup(db, "a1", "Abonnements", "out", null, "2026-01", null);
    at("2026-01");
    const lid = await addGroupLine(gid, "Spotify", 10, 3, "2026-01");
    at("2026-07");
    await setGroupLineAmount(lid, "2026-07", 12, "ongoing");

    await removeLineAmount(lid, "2026-07");

    expect(lineAmountInForce(lid, "2026-07", toDatedLineAmounts(listLineAmounts(db)))).toBe(10);
  });
});
