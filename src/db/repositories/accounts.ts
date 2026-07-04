import type Database from "better-sqlite3";

export type Account = {
  id: string;
  name: string;
  iban_masked: string | null;
  balance: number;
  currency: string;
  last_synced: string | null;
};

export function upsertAccount(db: Database.Database, a: Account): void {
  db.prepare(
    `INSERT INTO accounts (id, name, iban_masked, balance, currency, last_synced)
     VALUES (@id, @name, @iban_masked, @balance, @currency, @last_synced)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, iban_masked = excluded.iban_masked,
       balance = excluded.balance, currency = excluded.currency,
       last_synced = excluded.last_synced`,
  ).run(a);
}

export function listAccounts(db: Database.Database): Account[] {
  return db.prepare("SELECT * FROM accounts").all() as Account[];
}

export function totalBalance(db: Database.Database): number {
  const row = db.prepare("SELECT COALESCE(SUM(balance), 0) AS total FROM accounts").get() as { total: number };
  return row.total;
}
