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
  label: string;
  id: string;
  accountId: string;
  accountLabel: string;
  groupId: number | null;
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
  filter?: { month?: string },
): TxnView[] {
  let sql =
    `SELECT t.id, t.date, t.amount, t.label, t.group_id AS groupId,
            t.account_id AS accountId,
            COALESCE(COALESCE(a.custom_name, a.name) || ' ' || a.iban_masked, COALESCE(a.custom_name, a.name)) AS accountLabel
     FROM transactions t
     LEFT JOIN accounts a ON a.id = t.account_id`;
  const clauses: string[] = [];
  const params: Record<string, string | number> = {};
  if (filter?.month) {
    clauses.push("substr(t.date,1,7) = @month");
    params.month = filter.month;
  }
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  sql += " ORDER BY t.date DESC";
  const stmt = db.prepare(sql);
  return (clauses.length ? stmt.all(params) : stmt.all()) as TxnView[];
}

export function setTransactionGroup(db: Database.Database, id: string, groupId: number | null): void {
  db.prepare("UPDATE transactions SET group_id = ? WHERE id = ?").run(groupId, id);
}
