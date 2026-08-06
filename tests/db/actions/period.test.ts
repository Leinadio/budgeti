// Modifier la durée de vie d'un groupe (ou d'une ligne) APRÈS coup, et savoir ce que
// ça coûte avant d'écrire. Teste setGroupPeriod / setLinePeriod / periodImpact
// (src/app/historique/actions.ts) réellement appelées, base en mémoire (voir ./setup).
import { beforeEach, expect, test, vi } from "vitest";
import type Database from "better-sqlite3";
import { freshDb, at } from "./setup";
import {
  setGroupPeriod, setLinePeriod, groupPeriodImpact, linePeriodImpact, addGroupLine,
} from "../../../src/app/historique/actions";
import { revalidatePath } from "next/cache";
import { insertEnvelopeGroup, insertRecurringGroup } from "../../../src/db/repositories/groups";
import { insertManualTransaction } from "../../../src/db/repositories/transactions";
import { listBudgetAmounts } from "../../../src/db/repositories/budget-amounts";
import { toDatedBudgets, amountInForce } from "../../../src/lib/history";

let db: Database.Database;
beforeEach(() => {
  db = freshDb();
  vi.mocked(revalidatePath).mockClear();
  at("2026-06");
});

const bornes = (table: "groups" | "group_lines", id: number) =>
  db.prepare(`SELECT start_month AS start, end_month AS fin FROM ${table} WHERE id = ?`).get(id);

const depenseEn = (mois: string, groupId: number, lineId: number | null = null) =>
  insertManualTransaction(db, {
    accountId: "a1", date: `${mois}-12`, amount: -30, label: "PRLV", groupId, lineId, incomeKind: null,
  });

test("pose une fin à un groupe permanent : c'est comme ça qu'on l'arrête", async () => {
  const gid = insertEnvelopeGroup(db, "a1", "Courses", "out", 300, null, "2026-01", null);

  await setGroupPeriod(gid, "2026-01", "2026-04");

  expect(bornes("groups", gid)).toEqual({ start: "2026-01", fin: "2026-04" });
});

test("retire la fin d'un groupe borné : il redevient permanent", async () => {
  const gid = insertEnvelopeGroup(db, "a1", "Courses", "out", 300, null, "2026-01", "2026-04");

  await setGroupPeriod(gid, "2026-01", null);

  expect(bornes("groups", gid)).toEqual({ start: "2026-01", fin: null });
});

// Un seul mois = début et fin au même endroit. Le formulaire ne demande alors pas de
// mois de fin (pas de « + »), mais l'action doit accepter les deux bornes égales.
test("accepte une durée d'un seul mois", async () => {
  const gid = insertEnvelopeGroup(db, "a1", "Cadeau", "out", 80, null, "2026-01", null);

  await setGroupPeriod(gid, "2026-04", "2026-04");

  expect(bornes("groups", gid)).toEqual({ start: "2026-04", fin: "2026-04" });
});

test("refuse une fin antérieure au début, et n'écrit rien", async () => {
  const gid = insertEnvelopeGroup(db, "a1", "Courses", "out", 300, null, "2026-01", null);

  await setGroupPeriod(gid, "2026-04", "2026-02");

  expect(bornes("groups", gid)).toEqual({ start: "2026-01", fin: null });
});

test("refuse un mois mal formé", async () => {
  const gid = insertEnvelopeGroup(db, "a1", "Courses", "out", 300, null, "2026-01", null);

  await setGroupPeriod(gid, "avril", null);

  expect(bornes("groups", gid)).toEqual({ start: "2026-01", fin: null });
});

// Rallonger par le début ouvre des mois où le groupe n'a jamais eu de montant : sans
// rien poser, ils s'afficheraient à zéro. Le montant demandé à l'écran se pose au
// nouveau mois de départ, et ne touche pas aux montants postérieurs.
test("rallonger par le début pose le montant donné sur les mois gagnés, sans écraser la suite", async () => {
  const gid = insertEnvelopeGroup(db, "a1", "Courses", "out", 300, null, "2026-04", null);
  await setGroupPeriod(gid, "2026-04", null, 300); // montant de départ, posé en avril

  await setGroupPeriod(gid, "2026-01", null, 250);

  const entries = toDatedBudgets(listBudgetAmounts(db))[gid] ?? [];
  expect(amountInForce(entries, "2026-02")).toBe(250);
  expect(amountInForce(entries, "2026-04")).toBe(300);
});

// --- Ce que le changement coûte, avant de l'écrire --------------------------

test("annonce les mois perdus et les transactions qui repassent en non catégorisés", async () => {
  const gid = insertEnvelopeGroup(db, "a1", "Courses", "out", 300, null, "2026-01", null);
  await setGroupPeriod(gid, "2026-01", null, 300);
  depenseEn("2026-02", gid);
  depenseEn("2026-05", gid);
  depenseEn("2026-05", gid);

  const impact = await groupPeriodImpact(gid, "2026-01", "2026-04");

  expect(impact.months).toEqual(["2026-05", "2026-06"]);
  expect(impact.txns).toBe(2);
});

test("n'annonce rien quand on rallonge", async () => {
  const gid = insertEnvelopeGroup(db, "a1", "Courses", "out", 300, null, "2026-03", "2026-04");
  await setGroupPeriod(gid, "2026-03", "2026-04", 300);
  depenseEn("2026-03", gid);

  expect(await groupPeriodImpact(gid, "2026-01", null)).toEqual({ months: [], txns: 0 });
});

// Les mois à venir ne comptent pas : rien ne s'y est encore passé, les retirer
// n'enlève aucun chiffre déjà lu.
test("ne compte pas les mois futurs parmi les mois perdus", async () => {
  const gid = insertEnvelopeGroup(db, "a1", "Courses", "out", 300, null, "2026-01", null);
  await setGroupPeriod(gid, "2026-01", null, 300);

  const impact = await groupPeriodImpact(gid, "2026-01", "2026-06");

  expect(impact.months).toEqual([]);
});

// Les groupes hérités sont ancrés très loin en arrière (start_month = '2000-01', posé
// par la migration). Compter comme « perdus » les mois d'avant la première transaction
// du compte annoncerait des centaines de mois que l'app n'affiche nulle part : le
// décompte s'arrête donc au premier mois que la frise atteint.
test("ne remonte pas avant le premier mois de données du compte", async () => {
  const gid = insertEnvelopeGroup(db, "a1", "Courses", "out", 300, null, "2000-01", null);
  await setGroupPeriod(gid, "2000-01", null, 300);
  depenseEn("2026-02", gid);

  const impact = await groupPeriodImpact(gid, "2026-03", null);

  expect(impact.months).toEqual(["2026-02"]);
  expect(impact.txns).toBe(1);
});

// --- Les lignes d'un récurrent, même règle ----------------------------------

test("arrête une ligne de récurrent sans toucher au groupe", async () => {
  const gid = insertRecurringGroup(db, "a1", "Abonnements", "out", null, "2026-01", null);
  const lid = await addGroupLine(gid, "Spotify", 10, 1, "2026-01");

  await setLinePeriod(lid, "2026-01", "2026-03");

  expect(bornes("group_lines", lid)).toEqual({ start: "2026-01", fin: "2026-03" });
  expect(bornes("groups", gid)).toEqual({ start: "2026-01", fin: null });
});

test("annonce l'impact du raccourcissement d'une ligne", async () => {
  const gid = insertRecurringGroup(db, "a1", "Abonnements", "out", null, "2026-01", null);
  const lid = await addGroupLine(gid, "Spotify", 10, 1, "2026-01");
  depenseEn("2026-05", gid, lid);

  const impact = await linePeriodImpact(lid, "2026-01", "2026-03");

  // Avril est hors compte : la frise du compte commence à sa première transaction
  // (mai), et un mois que l'app n'affiche pas ne perd rien de visible.
  expect(impact.months).toEqual(["2026-05", "2026-06"]);
  expect(impact.txns).toBe(1);
});
