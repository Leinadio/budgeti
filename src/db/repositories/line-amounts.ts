import type Database from "better-sqlite3";
import type { BudgetScope } from "../../lib/budget-in-force";

// Même modèle que budget_amounts : un montant daté porte sa portée. Voir
// src/db/repositories/budget-amounts.ts pour le détail du raisonnement.
export type LineAmount = { lineId: number; effectiveMonth: string; amount: number; scope: BudgetScope };

// Même tri que listBudgetAmounts : la règle avant l'exception (voir là-bas).
export function listLineAmounts(db: Database.Database): LineAmount[] {
  return db
    .prepare(
      `SELECT line_id AS lineId, effective_month AS effectiveMonth, amount, scope
       FROM line_amounts ORDER BY line_id, effective_month, CASE scope WHEN 'ongoing' THEN 0 ELSE 1 END`,
    )
    .all() as LineAmount[];
}

export function setLineAmount(
  db: Database.Database, lineId: number, effectiveMonth: string, amount: number, scope: BudgetScope = "ongoing",
): void {
  db.prepare(
    `INSERT INTO line_amounts (line_id, effective_month, amount, scope) VALUES (?, ?, ?, ?)
     ON CONFLICT(line_id, effective_month, scope) DO UPDATE SET amount = excluded.amount`,
  ).run(lineId, effectiveMonth, amount, scope);
}

// Retire une entrée datée (ex. annulation d'une hausse « permanent »), portée comprise.
export function deleteLineAmount(
  db: Database.Database, lineId: number, effectiveMonth: string, scope: BudgetScope = "ongoing",
): void {
  db.prepare(`DELETE FROM line_amounts WHERE line_id = ? AND effective_month = ? AND scope = ?`).run(lineId, effectiveMonth, scope);
}

// Même chose pour une ligne : voir deleteBudgetAmountsAfter pour le raisonnement.
export function deleteLineAmountsAfter(db: Database.Database, lineId: number, effectiveMonth: string): void {
  db.prepare(`DELETE FROM line_amounts WHERE line_id = ? AND effective_month > ?`).run(lineId, effectiveMonth);
}
