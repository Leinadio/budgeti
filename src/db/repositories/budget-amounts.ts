import type Database from "better-sqlite3";

export type BudgetAmount = { groupId: number; effectiveMonth: string; amount: number };

export function listBudgetAmounts(db: Database.Database): BudgetAmount[] {
  return (
    db
      .prepare(`SELECT group_id AS groupId, effective_month AS effectiveMonth, amount FROM budget_amounts ORDER BY group_id, effective_month`)
      .all() as BudgetAmount[]
  );
}

export function setBudgetAmount(db: Database.Database, groupId: number, effectiveMonth: string, amount: number): void {
  db.prepare(
    `INSERT INTO budget_amounts (group_id, effective_month, amount) VALUES (?, ?, ?)
     ON CONFLICT(group_id, effective_month) DO UPDATE SET amount = excluded.amount`,
  ).run(groupId, effectiveMonth, amount);
}
