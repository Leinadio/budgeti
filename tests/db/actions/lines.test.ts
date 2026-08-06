// Teste addGroupLine et editGroupLine (src/app/historique/actions.ts) réellement
// appelées, base en mémoire (voir ./setup).
import { beforeEach, expect, test, vi } from "vitest";
import type Database from "better-sqlite3";
import { freshDb, at } from "./setup";
import { addGroupLine, editGroupLine, setGroupLineAmount } from "../../../src/app/historique/actions";
import { revalidatePath } from "next/cache";
import { insertRecurringGroup } from "../../../src/db/repositories/groups";
import { listLineAmounts } from "../../../src/db/repositories/line-amounts";
import { toDatedLineAmounts, lineAmountInForce } from "../../../src/lib/history";

let db: Database.Database;
let gid: number;
beforeEach(() => {
  db = freshDb();
  vi.mocked(revalidatePath).mockClear();
  gid = insertRecurringGroup(db, "a1", "Abonnements", "out", null, "2026-01", null);
});

test("une ligne ajoutée compte à partir du mois donné, pas rétroactivement", async () => {
  const lid = await addGroupLine(gid, "Netflix", 15, 8, "2026-06");

  const datedLines = toDatedLineAmounts(listLineAmounts(db));
  expect(lineAmountInForce(lid, "2026-05", datedLines)).toBe(0);
  expect(lineAmountInForce(lid, "2026-06", datedLines)).toBe(15);
  expect(lineAmountInForce(lid, "2026-12", datedLines)).toBe(15);
});

// La durée d'une ligne se choisit à l'ajout, comme celle d'un groupe. Le mois de
// départ reste celui du tableau où le panneau a été ouvert : c'est déjà de là que la
// ligne compte, et c'est le mois qu'on avait sous les yeux.
const bornes = (db: Database.Database, lid: number) =>
  db.prepare(`SELECT start_month AS start, end_month AS fin FROM group_lines WHERE id = ?`).get(lid);

test("une ligne est permanente par défaut : elle commence au mois donné et ne finit pas", async () => {
  const lid = await addGroupLine(gid, "Spotify", 10, 1, "2026-06");

  expect(bornes(db, lid)).toEqual({ start: "2026-06", fin: null });
});

test("une ligne « ce mois seulement » commence et finit au mois donné", async () => {
  const lid = await addGroupLine(gid, "Assurance vacances", 40, 1, "2026-06", "single");

  expect(bornes(db, lid)).toEqual({ start: "2026-06", fin: "2026-06" });
});

test("une ligne « d'un mois à un autre » garde ses deux bornes", async () => {
  const lid = await addGroupLine(gid, "Stage", 200, 1, "2026-06", "range", "2026-09");

  expect(bornes(db, lid)).toEqual({ start: "2026-06", fin: "2026-09" });
});

// Même refus que pour un groupe (cf. groupPeriod) : une plage qui ne dépasse pas son
// mois de départ n'entre pas en base, quel que soit l'appelant. Masquer le mois dans
// le formulaire n'empêche pas d'appeler l'action directement.
test("refuse une plage qui finit avant d'avoir commencé, sans rien créer", async () => {
  expect(await addGroupLine(gid, "Stage", 200, 1, "2026-06", "range", "2026-06")).toBe(-1);
  expect(await addGroupLine(gid, "Stage", 200, 1, "2026-06", "range", "2026-03")).toBe(-1);

  expect(db.prepare(`SELECT COUNT(*) AS n FROM group_lines`).get()).toEqual({ n: 0 });
});

// editGroupLine ne porte plus que le nom et le jour, qui valent pour tous les mois.
// Le montant a quitté ce chemin : il se modifie depuis la case « Budget dép. » de la
// ligne, au mois de sa colonne (setGroupLineAmount, plus bas).
test("editGroupLine change le nom et le jour, pour tous les mois", async () => {
  const lid = await addGroupLine(gid, "Spotify", 10, 3, "2026-01");

  await editGroupLine(lid, "Spotify Famille", 15);

  expect(db.prepare(`SELECT name, day FROM group_lines WHERE id = ?`).get(lid)).toEqual({ name: "Spotify Famille", day: 15 });
});

test("editGroupLine ne touche à aucun montant daté", async () => {
  const lid = await addGroupLine(gid, "Spotify", 10, 3, "2026-01");

  await editGroupLine(lid, "Spotify Famille", 15);

  expect(listLineAmounts(db)).toEqual([{ lineId: lid, effectiveMonth: "2026-01", amount: 10, scope: "ongoing" }]);
});

test("editGroupLine refuse un nom vide", async () => {
  const lid = await addGroupLine(gid, "Spotify", 10, 3, "2026-01");

  await editGroupLine(lid, "   ", 15);

  expect(db.prepare(`SELECT name, day FROM group_lines WHERE id = ?`).get(lid)).toEqual({ name: "Spotify", day: 3 });
});

// Le montant d'une ligne se modifie désormais depuis sa case « Budget dép. », qui
// ne connaît ni son nom ni son jour : ceux-là valent pour tous les mois et se
// changent depuis « Gérer le groupe ». D'où une action qui ne touche qu'au montant.
test("setGroupLineAmount « à partir de ce mois » vaut pour les mois suivants, sans toucher au nom ni au jour", async () => {
  const lid = await addGroupLine(gid, "Spotify", 10, 3, "2026-01");

  await setGroupLineAmount(lid, "2026-07", 12, "ongoing");

  const datedLines = toDatedLineAmounts(listLineAmounts(db));
  expect(lineAmountInForce(lid, "2026-06", datedLines)).toBe(10);
  expect(lineAmountInForce(lid, "2026-07", datedLines)).toBe(12);
  expect(lineAmountInForce(lid, "2027-01", datedLines)).toBe(12);
  expect(db.prepare(`SELECT name, day FROM group_lines WHERE id = ?`).get(lid)).toEqual({ name: "Spotify", day: 3 });
});

test("setGroupLineAmount « ce mois seulement » ne vaut que pour son mois, sans rien écrire au mois suivant", async () => {
  const lid = await addGroupLine(gid, "Spotify", 10, 3, "2026-01");

  await setGroupLineAmount(lid, "2026-07", 25, "once");

  const datedLines = toDatedLineAmounts(listLineAmounts(db));
  expect(lineAmountInForce(lid, "2026-07", datedLines)).toBe(25);
  expect(lineAmountInForce(lid, "2026-08", datedLines)).toBe(10);
  // Aucune écriture au mois suivant : la portée suffit à borner l'exception.
  expect(listLineAmounts(db).some((l) => l.lineId === lid && l.effectiveMonth === "2026-08")).toBe(false);
});

test("setGroupLineAmount écrit dans un mois passé", async () => {
  const lid = await addGroupLine(gid, "Spotify", 10, 3, "2026-01");
  at("2026-07");

  await setGroupLineAmount(lid, "2026-03", 99, "ongoing");

  expect(lineAmountInForce(lid, "2026-03", toDatedLineAmounts(listLineAmounts(db)))).toBe(99);
});

test("setGroupLineAmount renvoie la vie du montant à jour de la ligne", async () => {
  const lid = await addGroupLine(gid, "Spotify", 10, 3, "2026-01");

  const changes = await setGroupLineAmount(lid, "2026-07", 12, "ongoing");

  expect(changes).toEqual([
    { month: "2026-01", amount: 10, isStart: true, scope: "ongoing" },
    { month: "2026-07", amount: 12, isStart: false, scope: "ongoing" },
  ]);
});

