import type Database from "better-sqlite3";

// group_id = 0 désigne les Non catégorisés du compte.
export type OverspendDecision = {
  accountId: string;
  groupId: number;
  month: string; // YYYY-MM
  decision: "exceptional" | "permanent";
  decidedAt: string; // ISO datetime
};

export function listOverspendDecisions(db: Database.Database, accountId: string): OverspendDecision[] {
  return (
    db
      .prepare(
        `SELECT account_id AS accountId, group_id AS groupId, month, decision, decided_at AS decidedAt
         FROM overspend_decisions WHERE account_id = ? ORDER BY month, group_id`,
      )
      .all(accountId) as OverspendDecision[]
  );
}

export function setOverspendDecision(db: Database.Database, d: OverspendDecision): void {
  db.prepare(
    `INSERT INTO overspend_decisions (account_id, group_id, month, decision, decided_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(account_id, group_id, month) DO UPDATE SET decision = excluded.decision, decided_at = excluded.decided_at`,
  ).run(d.accountId, d.groupId, d.month, d.decision, d.decidedAt);
}
