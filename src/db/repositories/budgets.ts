import type Database from "better-sqlite3";
import { ensureCategory } from "./categories";

export type BudgetRow = { category: string; limit: number };

export function listBudgets(db: Database.Database): BudgetRow[] {
  return db
    .prepare(
      // "limit" est un mot réservé SQL — l'alias doit être entre guillemets.
      `SELECT c.name AS category, b.monthly_limit AS "limit"
       FROM budgets b JOIN categories c ON c.id = b.category_id
       ORDER BY c.name`,
    )
    .all() as BudgetRow[];
}

export function setBudget(db: Database.Database, category: string, limit: number): void {
  const categoryId = ensureCategory(db, category);
  db.prepare(
    `INSERT INTO budgets (category_id, monthly_limit) VALUES (?, ?)
     ON CONFLICT(category_id) DO UPDATE SET monthly_limit = excluded.monthly_limit`,
  ).run(categoryId, limit);
}

export function deleteBudget(db: Database.Database, category: string): void {
  db.prepare(
    `DELETE FROM budgets WHERE category_id = (SELECT id FROM categories WHERE name = ?)`,
  ).run(category);
}
