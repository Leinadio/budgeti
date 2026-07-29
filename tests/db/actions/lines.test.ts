// Teste addGroupLine et editGroupLine (src/app/historique/actions.ts) réellement
// appelées, base en mémoire (voir ./setup).
import { beforeEach, expect, test, vi } from "vitest";
import type Database from "better-sqlite3";
import { freshDb } from "./setup";
import { addGroupLine, editGroupLine } from "../../../src/app/historique/actions";
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

test("une modification « à partir de ce mois » vaut pour les mois suivants", async () => {
  const lid = await addGroupLine(gid, "Spotify", 10, 3, "2026-01");

  await editGroupLine(lid, "Spotify", 3, "2026-07", 12, "ongoing");

  const datedLines = toDatedLineAmounts(listLineAmounts(db));
  expect(lineAmountInForce(lid, "2026-06", datedLines)).toBe(10);
  expect(lineAmountInForce(lid, "2026-07", datedLines)).toBe(12);
  expect(lineAmountInForce(lid, "2027-01", datedLines)).toBe(12);
});

test("une modification « ce mois seulement » restaure le montant précédent au mois suivant", async () => {
  const lid = await addGroupLine(gid, "Spotify", 10, 3, "2026-01");

  await editGroupLine(lid, "Spotify", 3, "2026-07", 25, "once");

  const datedLines = toDatedLineAmounts(listLineAmounts(db));
  expect(lineAmountInForce(lid, "2026-06", datedLines)).toBe(10);
  expect(lineAmountInForce(lid, "2026-07", datedLines)).toBe(25);
  expect(lineAmountInForce(lid, "2026-08", datedLines)).toBe(10);
});

test("le nom et le jour changent pour tous les mois, indépendamment de la portée du montant", async () => {
  const lid = await addGroupLine(gid, "Spotify", 10, 3, "2026-01");

  await editGroupLine(lid, "Spotify Famille", 15, "2026-07", 10, "ongoing");

  const row = db.prepare(`SELECT name, day FROM group_lines WHERE id = ?`).get(lid) as { name: string; day: number };
  expect(row).toEqual({ name: "Spotify Famille", day: 15 });
});

// Le panneau de gestion garde son propre état, figé au clic (voir amounts.test.ts
// pour le détail) : editGroupLine renvoie donc la vie du budget à jour de la
// ligne, pour que le panneau la réaffiche sans la recalculer lui-même.
test("editGroupLine renvoie la vie du budget à jour de la ligne", async () => {
  const lid = await addGroupLine(gid, "Spotify", 10, 3, "2026-01");

  const changes = await editGroupLine(lid, "Spotify", 3, "2026-07", 12, "ongoing");

  expect(changes).toEqual([
    { month: "2026-01", amount: 10, isStart: true },
    { month: "2026-07", amount: 12, isStart: false },
  ]);
});
