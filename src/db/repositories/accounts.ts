import type Database from "better-sqlite3";
import { getSetting, setSetting } from "./settings";

export type Account = {
  id: string;
  name: string;
  iban_masked: string | null;
  balance: number;
  currency: string;
  last_synced: string | null;
  custom_name: string | null;
};

export function upsertAccount(db: Database.Database, a: Omit<Account, "custom_name">): void {
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

export function setAccountAlias(db: Database.Database, id: string, alias: string | null): void {
  db.prepare("UPDATE accounts SET custom_name = ? WHERE id = ?").run(alias, id);
}

export function deleteAccount(db: Database.Database, id: string): void {
  db.transaction(() => {
    db.prepare("DELETE FROM transactions WHERE account_id = ?").run(id);
    db.prepare("DELETE FROM groups WHERE account_id = ?").run(id);
    db.prepare("DELETE FROM accounts WHERE id = ?").run(id);
    const raw = getSetting(db, "account_uids");
    if (raw) {
      const uids = (JSON.parse(raw) as string[]).filter((u) => u !== id);
      setSetting(db, "account_uids", JSON.stringify(uids));
    }
  })();
}
