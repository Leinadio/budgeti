import type Database from "better-sqlite3";

export type TxnRow = {
  id: string;
  account_id: string;
  date: string;
  amount: number;
  label: string;
  category_id: number | null;
};

export type TxnView = {
  date: string;
  amount: number;
  category: string | null;
  label: string;
  id: string;
  accountId: string;
  accountLabel: string;
};

export function upsertTransaction(db: Database.Database, t: TxnRow): number {
  const result = db.prepare(
    `INSERT OR IGNORE INTO transactions (id, account_id, date, amount, label, category_id)
     VALUES (@id, @account_id, @date, @amount, @label, @category_id)`,
  ).run(t);
  return result.changes;
}

export function listTransactions(
  db: Database.Database,
  filter?: { month?: string; category?: string },
): TxnView[] {
  let sql =
    `SELECT t.id, t.date, t.amount, t.label, c.name AS category,
            t.account_id AS accountId,
            COALESCE(a.name || ' ' || a.iban_masked, a.name) AS accountLabel
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id
     LEFT JOIN accounts a ON a.id = t.account_id`;
  const clauses: string[] = [];
  const params: Record<string, string | number> = {};
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
  const stmt = db.prepare(sql);
  return (clauses.length ? stmt.all(params) : stmt.all()) as TxnView[];
}

export function uncategorized(db: Database.Database): TxnRow[] {
  return db.prepare("SELECT * FROM transactions WHERE category_id IS NULL").all() as TxnRow[];
}

export function setTransactionCategory(db: Database.Database, id: string, categoryId: number): void {
  db.prepare("UPDATE transactions SET category_id = ? WHERE id = ?").run(categoryId, id);
}
