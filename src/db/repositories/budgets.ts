import type Database from "better-sqlite3";
import { ensureCategory } from "./categories";

export type BudgetRow = { category: string; month: string; limit: number };

export function listBudgets(db: Database.Database): BudgetRow[] {
  return db
    .prepare(
      // "limit" is a SQL reserved word — the alias must be quoted.
      `SELECT c.name AS category, b.month AS month, b.limit_amount AS "limit" FROM budgets b JOIN categories c ON c.id = b.category_id`,
    )
    .all() as BudgetRow[];
}

export function setBudget(db: Database.Database, category: string, month: string, limit: number): void {
  const categoryId = ensureCategory(db, category);
  db.prepare(
    `INSERT INTO budgets (category_id, month, limit_amount) VALUES (?, ?, ?)
     ON CONFLICT(category_id, month) DO UPDATE SET limit_amount = excluded.limit_amount`,
  ).run(categoryId, month, limit);
}
