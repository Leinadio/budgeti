// Une ligne de récurrent a maintenant sa propre durée de vie, comme un groupe : un
// abonnement résilié s'arrête sans emporter le groupe qui le porte. Deux colonnes
// ajoutées à group_lines, et rien de changé pour les lignes déjà en base — elles
// restent sans bornes, donc permanentes, exactement ce qu'elles étaient.
import { expect, test } from "vitest";
import Database from "better-sqlite3";
import { migrateLineLifespan } from "../../src/db/migrations";

// Base au schéma d'AVANT la migration : group_lines sans bornes de mois.
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

test("ajoute les deux bornes de mois à group_lines", () => {
  const db = dbAvant();

  migrateLineLifespan(db);

  expect(colonnes(db)).toContain("start_month");
  expect(colonnes(db)).toContain("end_month");
});

// Rien à reprendre : une ligne d'avant n'a jamais eu de fin, et son début se lit
// déjà dans sa suite de montants datés (lineStarted). Lui inventer un mois de
// départ ici la ferait naître ailleurs que là où le tableau la montre naître.
test("laisse les lignes existantes sans bornes", () => {
  const db = dbAvant();

  migrateLineLifespan(db);

  expect(db.prepare(`SELECT start_month AS s, end_month AS e FROM group_lines`).get()).toEqual({ s: null, e: null });
});

test("repasser la migration ne casse rien", () => {
  const db = dbAvant();

  migrateLineLifespan(db);
  migrateLineLifespan(db);

  expect(colonnes(db).filter((c) => c === "start_month")).toHaveLength(1);
});
