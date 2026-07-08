import type Database from "better-sqlite3";

export type GroupLineRow = {
  id: number;
  name: string;
  amount: number;
  day: number;
  keyword: string;
};

export type GroupRow = {
  id: number;
  accountId: string;
  name: string;
  direction: "in" | "out";
  kind: "envelope" | "recurring";
  monthlyAmount: number | null;
  keywords: string[];
  lines: GroupLineRow[];
};

export function listGroups(db: Database.Database): GroupRow[] {
  const groups = db
    .prepare(
      `SELECT id, account_id AS accountId, name, direction, kind, monthly_amount AS monthlyAmount
       FROM groups ORDER BY name`,
    )
    .all() as Omit<GroupRow, "keywords" | "lines">[];
  const kwStmt = db.prepare(`SELECT keyword FROM group_keywords WHERE group_id = ? ORDER BY id`);
  const lineStmt = db.prepare(
    `SELECT id, name, amount, day, keyword FROM group_lines WHERE group_id = ? ORDER BY id`,
  );
  return groups.map((g) => ({
    ...g,
    keywords: (kwStmt.all(g.id) as { keyword: string }[]).map((r) => r.keyword),
    lines: lineStmt.all(g.id) as GroupLineRow[],
  }));
}

export function insertEnvelopeGroup(
  db: Database.Database,
  accountId: string,
  name: string,
  direction: "in" | "out",
  monthlyAmount: number,
): number {
  const info = db
    .prepare(
      `INSERT INTO groups (account_id, name, direction, kind, monthly_amount) VALUES (?, ?, ?, 'envelope', ?)`,
    )
    .run(accountId, name, direction, monthlyAmount);
  return Number(info.lastInsertRowid);
}

export function insertRecurringGroup(
  db: Database.Database,
  accountId: string,
  name: string,
  direction: "in" | "out",
): number {
  const info = db
    .prepare(
      `INSERT INTO groups (account_id, name, direction, kind, monthly_amount) VALUES (?, ?, ?, 'recurring', NULL)`,
    )
    .run(accountId, name, direction);
  return Number(info.lastInsertRowid);
}

export function deleteGroup(db: Database.Database, id: number): void {
  db.prepare(`DELETE FROM groups WHERE id = ?`).run(id);
}

export function addKeyword(db: Database.Database, groupId: number, keyword: string): void {
  db.prepare(
    `INSERT INTO group_keywords (group_id, keyword)
     SELECT ?, ? WHERE NOT EXISTS (
       SELECT 1 FROM group_keywords WHERE group_id = ? AND keyword = ?
     )`,
  ).run(groupId, keyword, groupId, keyword);
}

export function insertLine(
  db: Database.Database,
  groupId: number,
  name: string,
  amount: number,
  day: number,
  keyword: string,
): void {
  db.prepare(
    `INSERT INTO group_lines (group_id, name, amount, day, keyword) VALUES (?, ?, ?, ?, ?)`,
  ).run(groupId, name, amount, day, keyword);
}

export function deleteLine(db: Database.Database, id: number): void {
  db.prepare(`DELETE FROM group_lines WHERE id = ?`).run(id);
}
