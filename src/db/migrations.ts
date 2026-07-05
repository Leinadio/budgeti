import type Database from "better-sqlite3";

// Convertit l'ancienne table budgets (category_id, month, limit_amount) vers le
// modèle récurrent (category_id UNIQUE, monthly_limit), en gardant le montant du
// mois le plus récent par catégorie. Idempotent : no-op si déjà au nouveau schéma.
export function migrateBudgets(db: Database.Database): void {
  const cols = db.prepare("PRAGMA table_info(budgets)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "month")) return;
  // Transaction : la reconstruction (create/insert/drop/rename) doit être atomique.
  // Un crash entre DROP et RENAME laisserait la base sans table budgets.
  db.transaction(() => {
    db.exec(`
      CREATE TABLE budgets_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category_id INTEGER NOT NULL REFERENCES categories(id),
        monthly_limit REAL NOT NULL,
        UNIQUE(category_id)
      );
      INSERT INTO budgets_new (category_id, monthly_limit)
        SELECT category_id, limit_amount FROM budgets b
        WHERE b.month = (SELECT MAX(month) FROM budgets b2 WHERE b2.category_id = b.category_id);
      DROP TABLE budgets;
      ALTER TABLE budgets_new RENAME TO budgets;
    `);
  })();
}
