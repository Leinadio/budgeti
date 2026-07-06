import type Database from "better-sqlite3";

export type RecurringRow = { id: number; name: string; keyword: string; expected: number };

export function listRecurring(db: Database.Database): RecurringRow[] {
  return db
    .prepare(
      `SELECT id, name, keyword, expected_amount AS expected FROM recurring_payments ORDER BY id`,
    )
    .all() as RecurringRow[];
}

export function insertRecurring(
  db: Database.Database,
  name: string,
  keyword: string,
  expected: number,
): void {
  db.prepare(
    `INSERT INTO recurring_payments (name, keyword, expected_amount) VALUES (?, ?, ?)`,
  ).run(name, keyword, expected);
}

export function deleteRecurring(db: Database.Database, id: number): void {
  db.prepare(`DELETE FROM recurring_payments WHERE id = ?`).run(id);
}
