import type Database from "better-sqlite3";

export type LineAmount = { lineId: number; effectiveMonth: string; amount: number };

export function listLineAmounts(db: Database.Database): LineAmount[] {
  return db
    .prepare(
      `SELECT line_id AS lineId, effective_month AS effectiveMonth, amount
       FROM line_amounts ORDER BY line_id, effective_month`,
    )
    .all() as LineAmount[];
}

export function setLineAmount(db: Database.Database, lineId: number, effectiveMonth: string, amount: number): void {
  db.prepare(
    `INSERT INTO line_amounts (line_id, effective_month, amount) VALUES (?, ?, ?)
     ON CONFLICT(line_id, effective_month) DO UPDATE SET amount = excluded.amount`,
  ).run(lineId, effectiveMonth, amount);
}

// Retire une entrée datée (ex. annulation d'une hausse « permanent »).
export function deleteLineAmount(db: Database.Database, lineId: number, effectiveMonth: string): void {
  db.prepare(`DELETE FROM line_amounts WHERE line_id = ? AND effective_month = ?`).run(lineId, effectiveMonth);
}
