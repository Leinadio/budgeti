// L'édition des mois passés, vue depuis les actions serveur (src/app/historique/
// actions.ts) réellement appelées, base en mémoire (voir ./setup).
//
// Un mois écoulé n'est pas figé : on y corrige un budget après coup, exactement
// comme sur le mois courant. Chaque test avance l'horloge après freshDb pour que
// les mois manipulés soient bien derrière — freshDb la fige à NOW_MONTH.
//
// Ce qui reste refusé n'a rien à voir avec le calendrier : un mois mal formé
// n'entre pas en base, et le montant de départ d'une frise ne se retire pas.
import { beforeEach, describe, expect, test, vi } from "vitest";
import type Database from "better-sqlite3";
import { freshDb, at } from "./setup";
import { setGroupAmount, setUncatProvision, removeGroupAmount, removeLineAmount, addGroupLine, editGroupLine, setGroupLineAmount } from "../../../src/app/historique/actions";
import { revalidatePath } from "next/cache";
import { insertGroup } from "../../../src/db/repositories/groups";
import { listBudgetAmounts, setBudgetAmount } from "../../../src/db/repositories/budget-amounts";
import { listLineAmounts } from "../../../src/db/repositories/line-amounts";
import { toDatedBudgets, toDatedLineAmounts, lineAmountInForce } from "../../../src/lib/history";

let db: Database.Database;
beforeEach(() => {
  db = freshDb();
  vi.mocked(revalidatePath).mockClear();
  // Nous sommes en juillet 2026 : tout mois d'avant est derrière nous.
  vi.setSystemTime(new Date("2026-07-15T12:00:00Z"));
});

// Montants d'un groupe en base, par mois d'effet, pour vérifier ce qu'une action a
// réellement écrit.
const amountsOf = (groupId: number) =>
  (toDatedBudgets(listBudgetAmounts(db))[groupId] ?? []).map((e) => [e.effectiveMonth, e.amount]);

describe("setGroupAmount", () => {
  test("écrit dans un mois passé", async () => {
    const gid = insertGroup(db, "a1", "Courses", "out", 300, null, "2026-01", null);
    setBudgetAmount(db, gid, "2026-01", 300);

    await setGroupAmount(gid, "2026-03", 350, "ongoing");

    expect(amountsOf(gid)).toEqual([["2026-01", 300], ["2026-03", 350]]);
  });

  test("écrit aussi « ce mois seulement » dans un mois passé", async () => {
    const gid = insertGroup(db, "a1", "Courses", "out", 300, null, "2026-01", null);
    setBudgetAmount(db, gid, "2026-01", 300);

    await setGroupAmount(gid, "2026-03", 350, "once");

    expect(amountsOf(gid)).toEqual([["2026-01", 300], ["2026-03", 350]]);
    expect(listBudgetAmounts(db).find((b) => b.groupId === gid && b.effectiveMonth === "2026-03")?.scope).toBe("once");
  });

  test("accepte le mois courant", async () => {
    const gid = insertGroup(db, "a1", "Courses", "out", 300, null, "2026-01", null);
    setBudgetAmount(db, gid, "2026-01", 300);

    await setGroupAmount(gid, "2026-07", 350, "ongoing");

    expect(amountsOf(gid)).toEqual([["2026-01", 300], ["2026-07", 350]]);
  });

  test("accepte un mois futur", async () => {
    const gid = insertGroup(db, "a1", "Courses", "out", 300, null, "2026-01", null);
    setBudgetAmount(db, gid, "2026-01", 300);

    await setGroupAmount(gid, "2026-09", 350, "ongoing");

    expect(amountsOf(gid)).toEqual([["2026-01", 300], ["2026-09", 350]]);
  });

  // Le seul refus qui subsiste : un mois qui n'est pas une clé « YYYY-MM ». Il ne
  // doit pas entrer en base, où il se comparerait n'importe comment aux autres.
  test("refuse un mois mal formé", async () => {
    const gid = insertGroup(db, "a1", "Courses", "out", 300, null, "2026-01", null);
    setBudgetAmount(db, gid, "2026-01", 300);

    await setGroupAmount(gid, "mars 2026", 350, "ongoing");

    expect(amountsOf(gid)).toEqual([["2026-01", 300]]);
  });

  // Le panneau se resynchronise sur ce qu'elle renvoie : la vie du budget rendue
  // doit inclure le montant qu'on vient de poser sur le mois passé.
  test("renvoie la vie du budget à jour après une écriture dans le passé", async () => {
    const gid = insertGroup(db, "a1", "Courses", "out", 300, null, "2026-01", null);
    setBudgetAmount(db, gid, "2026-01", 300);

    const changes = await setGroupAmount(gid, "2026-03", 350, "ongoing");

    expect(changes).toEqual([
      { month: "2026-01", amount: 300, isStart: true, scope: "ongoing" },
      { month: "2026-03", amount: 350, isStart: false, scope: "ongoing" },
    ]);
  });
});

describe("setUncatProvision", () => {
  test("écrit dans un mois passé", async () => {
    setBudgetAmount(db, 0, "2026-01", 100);

    await setUncatProvision("2026-03", 150, "ongoing");

    expect(amountsOf(0)).toEqual([["2026-01", 100], ["2026-03", 150]]);
  });

  test("accepte le mois courant", async () => {
    setBudgetAmount(db, 0, "2026-01", 100);

    await setUncatProvision("2026-07", 150, "ongoing");

    expect(amountsOf(0)).toEqual([["2026-01", 100], ["2026-07", 150]]);
  });

  test("refuse un mois mal formé", async () => {
    setBudgetAmount(db, 0, "2026-01", 100);

    await setUncatProvision("2026", 150, "ongoing");

    expect(amountsOf(0)).toEqual([["2026-01", 100]]);
  });
});

describe("removeGroupAmount", () => {
  // La corbeille est la face arrière de l'édition : un montant posé par erreur sur
  // un mois passé doit pouvoir en repartir.
  test("retire un changement posé dans un mois passé", async () => {
    const gid = insertGroup(db, "a1", "Courses", "out", 300, null, "2026-01", null);
    setBudgetAmount(db, gid, "2026-01", 300);
    setBudgetAmount(db, gid, "2026-03", 350);

    const changes = await removeGroupAmount(gid, "2026-03");

    expect(amountsOf(gid)).toEqual([["2026-01", 300]]);
    expect(changes).toEqual([{ month: "2026-01", amount: 300, isStart: true, scope: "ongoing" }]);
  });

  test("accepte de retirer un changement du mois courant", async () => {
    const gid = insertGroup(db, "a1", "Courses", "out", 300, null, "2026-01", null);
    setBudgetAmount(db, gid, "2026-01", 300);
    setBudgetAmount(db, gid, "2026-07", 350);

    await removeGroupAmount(gid, "2026-07");

    expect(amountsOf(gid)).toEqual([["2026-01", 300]]);
  });

  // Ce refus-là n'est pas une affaire de calendrier : sans montant de départ, les
  // mois qui le précédaient n'auraient plus de budget du tout.
  test("refuse toujours de retirer le montant de départ, même dans le passé", async () => {
    const gid = insertGroup(db, "a1", "Courses", "out", 300, null, "2026-01", null);
    setBudgetAmount(db, gid, "2026-01", 300);
    setBudgetAmount(db, gid, "2026-03", 350);

    await removeGroupAmount(gid, "2026-01");

    expect(amountsOf(gid)).toEqual([["2026-01", 300], ["2026-03", 350]]);
  });
});

describe("addGroupLine", () => {
  test("crée une ligne dans un mois passé", async () => {
    const gid = insertGroup(db, "a1", "Abonnements", "out", 0, null, "2026-01", null);

    const lid = await addGroupLine(gid, "Netflix", 15, "2026-03");

    expect(lid).toBeGreaterThan(0);
    expect(lineAmountInForce(lid, "2026-03", toDatedLineAmounts(listLineAmounts(db)))).toBe(15);
  });

  test("accepte de créer une ligne au mois courant", async () => {
    const gid = insertGroup(db, "a1", "Abonnements", "out", 0, null, "2026-01", null);

    const lid = await addGroupLine(gid, "Netflix", 15, "2026-07");

    expect(lid).toBeGreaterThan(0);
    expect(lineAmountInForce(lid, "2026-07", toDatedLineAmounts(listLineAmounts(db)))).toBe(15);
  });

  test("refuse un mois mal formé", async () => {
    const gid = insertGroup(db, "a1", "Abonnements", "out", 0, null, "2026-01", null);

    const lid = await addGroupLine(gid, "Netflix", 15, "bientôt");

    expect(lid).toBe(-1);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM group_lines`).get()).toEqual({ n: 0 });
  });
});

describe("setGroupLineAmount", () => {
  test("modifie le montant d'une ligne dans un mois passé", async () => {
    const gid = insertGroup(db, "a1", "Abonnements", "out", 0, null, "2026-01", null);
    at("2026-01");
    const lid = await addGroupLine(gid, "Spotify", 10, "2026-01");
    at("2026-07");

    await setGroupLineAmount(lid, "2026-03", 12, "ongoing");

    const datedLines = toDatedLineAmounts(listLineAmounts(db));
    expect(lineAmountInForce(lid, "2026-03", datedLines)).toBe(12);
    expect(lineAmountInForce(lid, "2026-07", datedLines)).toBe(12);
  });

  test("accepte le mois courant", async () => {
    const gid = insertGroup(db, "a1", "Abonnements", "out", 0, null, "2026-01", null);
    at("2026-01");
    const lid = await addGroupLine(gid, "Spotify", 10, "2026-01");
    at("2026-07");

    await setGroupLineAmount(lid, "2026-07", 12, "ongoing");

    expect(lineAmountInForce(lid, "2026-07", toDatedLineAmounts(listLineAmounts(db)))).toBe(12);
  });

  // Renommer une ligne n'a pas de mois : ce sont des propriétés qui valent pour tous
  // les mois. Rien à discuter côté calendrier, hier comme aujourd'hui.
  test("renommer une ligne reste possible, quel que soit le calendrier", async () => {
    const gid = insertGroup(db, "a1", "Abonnements", "out", 0, null, "2026-01", null);
    at("2026-01");
    const lid = await addGroupLine(gid, "Spotify", 10, "2026-01");
    at("2026-07");

    await editGroupLine(lid, "Spotify Famille");

    expect(db.prepare(`SELECT name FROM group_lines WHERE id = ?`).get(lid)).toEqual({ name: "Spotify Famille" });
  });
});

describe("removeLineAmount", () => {
  test("retire un montant posé dans un mois passé", async () => {
    const gid = insertGroup(db, "a1", "Abonnements", "out", 0, null, "2026-01", null);
    at("2026-01");
    const lid = await addGroupLine(gid, "Spotify", 10, "2026-01");
    at("2026-07");
    await setGroupLineAmount(lid, "2026-07", 12, "ongoing");
    at("2026-09");

    const changes = await removeLineAmount(lid, "2026-07");

    expect(lineAmountInForce(lid, "2026-07", toDatedLineAmounts(listLineAmounts(db)))).toBe(10);
    expect(changes).toEqual([{ month: "2026-01", amount: 10, isStart: true, scope: "ongoing" }]);
  });

  test("accepte de retirer un montant du mois courant", async () => {
    const gid = insertGroup(db, "a1", "Abonnements", "out", 0, null, "2026-01", null);
    at("2026-01");
    const lid = await addGroupLine(gid, "Spotify", 10, "2026-01");
    at("2026-07");
    await setGroupLineAmount(lid, "2026-07", 12, "ongoing");

    await removeLineAmount(lid, "2026-07");

    expect(lineAmountInForce(lid, "2026-07", toDatedLineAmounts(listLineAmounts(db)))).toBe(10);
  });
});
