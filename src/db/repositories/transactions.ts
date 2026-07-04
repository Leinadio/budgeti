import type Database from "better-sqlite3";

export type TxnRow = {
  id: string;
  account_id: string;
  date: string;
  amount: number;
  label: string;
  category_id: number | null;
};

export type TxnView = { date: string; amount: number; category: string | null; label: string; id: string };

export function upsertTransaction(db: Database.Database, t: TxnRow): void {
  db.prepare(
    `INSERT OR IGNORE INTO transactions (id, account_id, date, amount, label, category_id)
     VALUES (@id, @account_id, @date, @amount, @label, @category_id)`,
  ).run(t);
}

export function listTransactions(
  db: Database.Database,
  filter?: { month?: string; category?: string },
): TxnView[] {
  let sql =
    "SELECT t.id, t.date, t.amount, t.label, c.name AS category FROM transactions t LEFT JOIN categories c ON c.id = t.category_id";
  const clauses: string[] = [];
  const params: Record<string, string> = {};
  if (filter?.month) {
    clauses.push("substr(t.date,1,7) = @month");
    params.month = filter.month;
  }
  if (filter?.category) {
    clauses.push("c.name = @category");
    params.category = filter.category;
  }
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  sql += " ORDER BY t.date DESC";
  return db.prepare(sql).all(params) as TxnView[];
}

export function uncategorized(db: Database.Database): TxnRow[] {
  return db.prepare("SELECT * FROM transactions WHERE category_id IS NULL").all() as TxnRow[];
}

export function setTransactionCategory(db: Database.Database, id: string, categoryId: number): void {
  db.prepare("UPDATE transactions SET category_id = ? WHERE id = ?").run(categoryId, id);
}
