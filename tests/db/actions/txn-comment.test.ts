// Poser un commentaire sur une transaction, via l'action serveur réellement
// appelée, base en mémoire (voir ./setup).
import { beforeEach, expect, test } from "vitest";
import type Database from "better-sqlite3";
import { freshDb } from "./setup";
import { setComment } from "../../../src/app/transactions/actions";
import { upsertTransaction, listTransactions } from "../../../src/db/repositories/transactions";

let db: Database.Database;
beforeEach(() => {
  db = freshDb();
  upsertTransaction(db, {
    id: "t1", account_id: "a1", date: "2025-01-10", amount: -42,
    label: "CB 0241 CARREFOUR MARKET 12/07", category_id: null,
  });
});

const t1 = () => listTransactions(db).find((t) => t.id === "t1")!;

test("le commentaire s'enregistre sans toucher au libellé de la banque", async () => {
  await setComment("t1", "Courses du week-end, remboursé par Marie");

  expect(t1().comment).toBe("Courses du week-end, remboursé par Marie");
  expect(t1().label).toBe("CB 0241 CARREFOUR MARKET 12/07");
});

test("un commentaire vidé revient à null", async () => {
  await setComment("t1", "À vérifier");
  await setComment("t1", "   ");

  expect(t1().comment).toBeNull();
});

test("les espaces de bord ne sont pas enregistrés", async () => {
  await setComment("t1", "  À vérifier  ");

  expect(t1().comment).toBe("À vérifier");
});
