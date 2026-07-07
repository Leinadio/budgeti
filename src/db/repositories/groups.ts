import type Database from "better-sqlite3";

export type GroupLineRow = {
  id: number;
  name: string;
  amount: number;
  day: number | null;
  keyword: string;
};

export type GroupRow = {
  id: number;
  accountId: string;
  name: string;
  direction: "in" | "out";
  lines: GroupLineRow[];
};

export function listGroups(db: Database.Database): GroupRow[] {
  const groups = db
    .prepare(
      `SELECT id, account_id AS accountId, name, direction FROM groups ORDER BY name`,
    )
    .all() as Omit<GroupRow, "lines">[];
  const lineStmt = db.prepare(
    `SELECT id, name, amount, day, keyword FROM group_lines WHERE group_id = ? ORDER BY id`,
  );
  return groups.map((g) => ({
    ...g,
    lines: lineStmt.all(g.id) as GroupLineRow[],
  }));
}

export function insertGroup(
  db: Database.Database,
  accountId: string,
  name: string,
  direction: "in" | "out",
): number {
  const info = db
    .prepare(`INSERT INTO groups (account_id, name, direction) VALUES (?, ?, ?)`)
    .run(accountId, name, direction);
  return Number(info.lastInsertRowid);
}

export function deleteGroup(db: Database.Database, id: number): void {
  db.prepare(`DELETE FROM groups WHERE id = ?`).run(id);
}

export function insertLine(
  db: Database.Database,
  groupId: number,
  name: string,
  amount: number,
  day: number | null,
  keyword: string,
): void {
  db.prepare(
    `INSERT INTO group_lines (group_id, name, amount, day, keyword) VALUES (?, ?, ?, ?, ?)`,
  ).run(groupId, name, amount, day, keyword);
}

export function deleteLine(db: Database.Database, id: number): void {
  db.prepare(`DELETE FROM group_lines WHERE id = ?`).run(id);
}

export function getGroupDirection(
  db: Database.Database,
  id: number,
): "in" | "out" | null {
  const row = db
    .prepare(`SELECT direction FROM groups WHERE id = ?`)
    .get(id) as { direction: "in" | "out" } | undefined;
  return row ? row.direction : null;
}
