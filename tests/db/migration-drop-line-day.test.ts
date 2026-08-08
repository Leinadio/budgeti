// Le jour du mois d'un sous-poste disparaît. Il ne pilotait plus rien : aucun calcul
// ne le comparait à une date, il ne servait qu'à composer une phrase dans un panneau
// que plus personne n'affichait. Le demander à la création d'un sous-poste de dépense
// (« Boulangerie, le combien ? ») n'aurait eu aucun sens.
import { expect, test } from "vitest";
import Database from "better-sqlite3";
import { migrateDropLineDay } from "../../src/db/migrations";

// Base au schéma d'AVANT : group_lines porte encore son jour du mois.
function dbAvant(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE group_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      amount REAL NOT NULL,
      day INTEGER,
      keyword TEXT NOT NULL
    );
    INSERT INTO group_lines (group_id, name, amount, day, keyword) VALUES (1, 'Spotify', 10, 3, '');
  `);
  return db;
}

const colonnes = (db: Database.Database) =>
  (db.prepare(`PRAGMA table_info(group_lines)`).all() as { name: string }[]).map((c) => c.name);

test("retire la colonne du jour", () => {
  const db = dbAvant();

  migrateDropLineDay(db);

  expect(colonnes(db)).not.toContain("day");
});

// Seule la colonne s'en va : les sous-postes eux-mêmes restent, avec leur nom et
// leur montant. Une migration qui perdrait des lignes ferait disparaître des budgets.
test("garde les sous-postes intacts", () => {
  const db = dbAvant();

  migrateDropLineDay(db);

  expect(db.prepare(`SELECT name, amount FROM group_lines`).get()).toEqual({ name: "Spotify", amount: 10 });
});

test("repasser la migration ne casse rien", () => {
  const db = dbAvant();

  migrateDropLineDay(db);
  migrateDropLineDay(db);

  expect(colonnes(db)).not.toContain("day");
});
