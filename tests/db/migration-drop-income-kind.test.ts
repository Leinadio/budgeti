// La classe de revenu (« principale » / « supplémentaire ») disparaît de la base. Elle
// ne décide plus rien : ce qui distingue un revenu qui se reproduit d'un revenu
// exceptionnel, c'est sa durée, comme pour une dépense.
//
// Ce test ouvre une VRAIE base sur disque, plusieurs fois de suite, parce que c'est là
// qu'est le danger. Deux migrations AJOUTENT cette colonne quand elles ne la trouvent
// pas (migrateGroupIncomeKind pour les groupes, migrateTransactionManualFields pour les
// transactions) : la retirer sans les retirer aussi la ferait revenir au démarrage
// suivant, indéfiniment. Une base « :memory: », jetée après chaque test, ne montrerait
// jamais ce va-et-vient.
import { afterEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb } from "../../src/db/index";
import { upsertAccount } from "../../src/db/repositories/accounts";
import { insertGroup, insertLine, listGroups } from "../../src/db/repositories/groups";
import { upsertTransaction, listTransactions } from "../../src/db/repositories/transactions";

let dossier: string | null = null;

function chemin(): string {
  dossier = mkdtempSync(join(tmpdir(), "budget-income-kind-"));
  return join(dossier, "test.db");
}

afterEach(() => {
  if (dossier) rmSync(dossier, { recursive: true, force: true });
  dossier = null;
});

// Une base garnie comme la vraie : un compte, un revenu, une dépense découpée, et une
// transaction rattachée.
function baseGarnie(path: string) {
  const db = getDb(path);
  upsertAccount(db, { id: "a1", name: "CIC", iban_masked: null, balance: 0, currency: "EUR", last_synced: null });
  insertGroup(db, "a1", "Rémunération dirigeant", "in", 650, "2026-01", null);
  const gid = insertGroup(db, "a1", "Courses", "out", 400, "2026-01", null);
  insertLine(db, gid, "Boulangerie", 50);
  upsertTransaction(db, { id: "t1", account_id: "a1", date: "2026-01-05", amount: -20, label: "BOULANGERIE", category_id: null });
  db.close();
}

const colonnes = (path: string, table: string): string[] => {
  const db = getDb(path);
  const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
  db.close();
  return cols;
};

test("retire la classe de revenu des groupes", () => {
  const path = chemin();
  baseGarnie(path);
  expect(colonnes(path, "groups")).not.toContain("income_kind");
});

test("retire la classe de revenu des transactions", () => {
  const path = chemin();
  baseGarnie(path);
  expect(colonnes(path, "transactions")).not.toContain("income_kind");
});

// Le vrai risque : la colonne que l'on retire, et qu'une autre migration remet en place
// au démarrage suivant sans un mot.
test("ne la fait pas revenir en rouvrant la base", () => {
  const path = chemin();
  baseGarnie(path);
  getDb(path).close(); // deuxième passage complet des migrations
  expect(colonnes(path, "groups")).not.toContain("income_kind");
  expect(colonnes(path, "transactions")).not.toContain("income_kind");
});

test("garde les groupes, leurs sous-postes et les transactions en rouvrant la base", () => {
  const path = chemin();
  baseGarnie(path);

  const db = getDb(path);
  const groupes = listGroups(db);
  const txns = listTransactions(db);
  db.close();

  expect(groupes.map((g) => g.name).sort()).toEqual(["Courses", "Rémunération dirigeant"]);
  expect(groupes.find((g) => g.name === "Courses")!.lines.map((l) => l.name)).toEqual(["Boulangerie"]);
  expect(txns.map((t) => t.id)).toEqual(["t1"]);
});

test("supporte d'être rouverte encore et encore", () => {
  const path = chemin();
  baseGarnie(path);

  getDb(path).close();
  getDb(path).close();
  const db = getDb(path);
  const groupes = listGroups(db);
  db.close();

  expect(groupes).toHaveLength(2);
});
