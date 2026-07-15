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
  incomeKind: "principal" | "supplementary" | null;
  keywords: string[];
  lines: GroupLineRow[];
};

export function listGroups(db: Database.Database): GroupRow[] {
  const groups = db
    .prepare(
      `SELECT id, account_id AS accountId, name, direction, kind, monthly_amount AS monthlyAmount, income_kind AS incomeKind
       FROM groups ORDER BY name`,
    )
    .all() as (Omit<GroupRow, "keywords" | "lines" | "incomeKind"> & { incomeKind: string | null })[];
  const kwStmt = db.prepare(`SELECT keyword FROM group_keywords WHERE group_id = ? ORDER BY id`);
  const lineStmt = db.prepare(
    `SELECT id, name, amount, day, keyword FROM group_lines WHERE group_id = ? ORDER BY id`,
  );
  return groups.map((g) => ({
    ...g,
    incomeKind: g.incomeKind === "principal" || g.incomeKind === "supplementary" ? g.incomeKind : null,
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
  incomeKind: "principal" | "supplementary" | null = null,
): number {
  const info = db
    .prepare(
      `INSERT INTO groups (account_id, name, direction, kind, monthly_amount, income_kind) VALUES (?, ?, ?, 'envelope', ?, ?)`,
    )
    .run(accountId, name, direction, monthlyAmount, incomeKind);
  return Number(info.lastInsertRowid);
}

export function insertRecurringGroup(
  db: Database.Database,
  accountId: string,
  name: string,
  direction: "in" | "out",
  incomeKind: "principal" | "supplementary" | null = null,
): number {
  const info = db
    .prepare(
      `INSERT INTO groups (account_id, name, direction, kind, monthly_amount, income_kind) VALUES (?, ?, ?, 'recurring', NULL, ?)`,
    )
    .run(accountId, name, direction, incomeKind);
  return Number(info.lastInsertRowid);
}

export function deleteGroup(db: Database.Database, id: number): void {
  db.prepare(`DELETE FROM groups WHERE id = ?`).run(id);
}

export function updateGroup(
  db: Database.Database,
  id: number,
  name: string,
  direction: "in" | "out",
  monthlyAmount: number | null,
): void {
  db.prepare(
    `UPDATE groups SET name = ?, direction = ?, monthly_amount = ? WHERE id = ?`,
  ).run(name, direction, monthlyAmount, id);
}

export function addKeyword(db: Database.Database, groupId: number, keyword: string): void {
  db.prepare(
    `INSERT INTO group_keywords (group_id, keyword)
     SELECT ?, ? WHERE NOT EXISTS (
       SELECT 1 FROM group_keywords WHERE group_id = ? AND keyword = ?
     )`,
  ).run(groupId, keyword, groupId, keyword);
}

// Renomme un mot-clé existant, sauf si le nouveau libellé existe déjà dans le groupe.
export function updateKeyword(
  db: Database.Database,
  groupId: number,
  oldKeyword: string,
  newKeyword: string,
): void {
  db.prepare(
    `UPDATE group_keywords SET keyword = ? WHERE group_id = ? AND keyword = ?
     AND NOT EXISTS (
       SELECT 1 FROM group_keywords WHERE group_id = ? AND keyword = ?
     )`,
  ).run(newKeyword, groupId, oldKeyword, groupId, newKeyword);
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

export function updateLine(
  db: Database.Database,
  id: number,
  name: string,
  amount: number,
  day: number,
  keyword: string,
): void {
  db.prepare(
    `UPDATE group_lines SET name = ?, amount = ?, day = ?, keyword = ? WHERE id = ?`,
  ).run(name, amount, day, keyword, id);
}

export function deleteLine(db: Database.Database, id: number): void {
  db.prepare(`DELETE FROM group_lines WHERE id = ?`).run(id);
}
