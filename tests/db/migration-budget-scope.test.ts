// La portée d'un montant daté (« vaut à partir de ce mois » / « vaut pour ce mois
// seulement ») vit désormais dans la colonne `scope` de budget_amounts et
// line_amounts. Cette migration l'ajoute et rend l'unicité par (cible, mois, portée) :
// les deux portées peuvent coexister au même mois — relever durablement à partir de
// juillet ET faire une exception pour juillet.
import { expect, test } from "vitest";
import Database from "better-sqlite3";
import { migrateBudgetAmountScope } from "../../src/db/migrations";
import { listBudgetAmounts, setBudgetAmount } from "../../src/db/repositories/budget-amounts";
import { listLineAmounts, setLineAmount } from "../../src/db/repositories/line-amounts";

// Base au schéma d'AVANT la migration : les deux tables sans colonne de portée.
function dbAvant(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE budget_amounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      effective_month TEXT NOT NULL,
      amount REAL NOT NULL,
      UNIQUE(group_id, effective_month)
    );
    CREATE TABLE group_lines (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
    CREATE TABLE line_amounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      line_id INTEGER NOT NULL REFERENCES group_lines(id) ON DELETE CASCADE,
      effective_month TEXT NOT NULL,
      amount REAL NOT NULL,
      UNIQUE(line_id, effective_month)
    );
  `);
  return db;
}

const colonnes = (db: Database.Database, table: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

test("ajoute la colonne de portée aux deux tables", () => {
  const db = dbAvant();

  migrateBudgetAmountScope(db);

  expect(colonnes(db, "budget_amounts")).toContain("scope");
  expect(colonnes(db, "line_amounts")).toContain("scope");
});

// Toutes les entrées d'avant valaient à partir de leur mois : c'était la seule
// sémantique. Les reclasser autrement changerait les chiffres déjà affichés.
test("les montants déjà en base deviennent des montants permanents", () => {
  const db = dbAvant();
  db.prepare(`INSERT INTO budget_amounts (group_id, effective_month, amount) VALUES (1, '2026-03', 250)`).run();
  db.prepare(`INSERT INTO group_lines (id, name) VALUES (11, 'Netflix')`).run();
  db.prepare(`INSERT INTO line_amounts (line_id, effective_month, amount) VALUES (11, '2026-03', 13.99)`).run();

  migrateBudgetAmountScope(db);

  expect(listBudgetAmounts(db)).toEqual([{ groupId: 1, effectiveMonth: "2026-03", amount: 250, scope: "ongoing" }]);
  expect(listLineAmounts(db)).toEqual([{ lineId: 11, effectiveMonth: "2026-03", amount: 13.99, scope: "ongoing" }]);
});

test("laisse coexister les deux portées au même mois, sans que l'une écrase l'autre", () => {
  const db = dbAvant();
  migrateBudgetAmountScope(db);

  setBudgetAmount(db, 1, "2026-07", 300, "ongoing");
  setBudgetAmount(db, 1, "2026-07", 500, "once");

  expect(listBudgetAmounts(db)).toEqual([
    { groupId: 1, effectiveMonth: "2026-07", amount: 300, scope: "ongoing" },
    { groupId: 1, effectiveMonth: "2026-07", amount: 500, scope: "once" },
  ]);
});

test("réécrire la même portée au même mois remplace le montant, sans doubler la ligne", () => {
  const db = dbAvant();
  migrateBudgetAmountScope(db);

  setBudgetAmount(db, 1, "2026-07", 300, "ongoing");
  setBudgetAmount(db, 1, "2026-07", 320, "ongoing");

  expect(listBudgetAmounts(db)).toEqual([{ groupId: 1, effectiveMonth: "2026-07", amount: 320, scope: "ongoing" }]);
});

test("même règle pour les montants de lignes", () => {
  const db = dbAvant();
  db.prepare(`INSERT INTO group_lines (id, name) VALUES (11, 'Netflix')`).run();
  migrateBudgetAmountScope(db);

  setLineAmount(db, 11, "2026-07", 10, "ongoing");
  setLineAmount(db, 11, "2026-07", 25, "once");
  setLineAmount(db, 11, "2026-07", 12, "ongoing");

  expect(listLineAmounts(db)).toEqual([
    { lineId: 11, effectiveMonth: "2026-07", amount: 12, scope: "ongoing" },
    { lineId: 11, effectiveMonth: "2026-07", amount: 25, scope: "once" },
  ]);
});

// La migration tourne à chaque démarrage : elle doit être sans effet la deuxième fois,
// et surtout ne pas reconstruire les tables en perdant leur contenu.
test("rejouer la migration ne change rien", () => {
  const db = dbAvant();
  db.prepare(`INSERT INTO budget_amounts (group_id, effective_month, amount) VALUES (1, '2026-03', 250)`).run();

  migrateBudgetAmountScope(db);
  setBudgetAmount(db, 1, "2026-07", 500, "once");
  migrateBudgetAmountScope(db);

  expect(listBudgetAmounts(db)).toEqual([
    { groupId: 1, effectiveMonth: "2026-03", amount: 250, scope: "ongoing" },
    { groupId: 1, effectiveMonth: "2026-07", amount: 500, scope: "once" },
  ]);
});

// La suppression vise une portée précise : retirer l'exception de juillet ne doit pas
// emporter le montant permanent qui commence le même mois.
test("supprimer une portée laisse l'autre en place", () => {
  const db = dbAvant();
  migrateBudgetAmountScope(db);
  setBudgetAmount(db, 1, "2026-07", 300, "ongoing");
  setBudgetAmount(db, 1, "2026-07", 500, "once");

  db.prepare(`DELETE FROM budget_amounts WHERE group_id = 1 AND effective_month = '2026-07' AND scope = 'once'`).run();

  expect(listBudgetAmounts(db)).toEqual([{ groupId: 1, effectiveMonth: "2026-07", amount: 300, scope: "ongoing" }]);
});
