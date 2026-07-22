import type Database from "better-sqlite3";

export type GroupLineRow = {
  id: number;
  name: string;
  amount: number;
  day: number;
};

export type GroupRow = {
  id: number;
  accountId: string;
  name: string;
  direction: "in" | "out";
  kind: "envelope" | "recurring";
  monthlyAmount: number | null;
  incomeKind: "principal" | "supplementary" | null;
  startMonth: string | null;
  endMonth: string | null;
  lines: GroupLineRow[];
};

export function listGroups(db: Database.Database): GroupRow[] {
  const groups = db
    .prepare(
      `SELECT id, account_id AS accountId, name, direction, kind, monthly_amount AS monthlyAmount,
              income_kind AS incomeKind, start_month AS startMonth, end_month AS endMonth
       FROM groups ORDER BY name`,
    )
    .all() as (Omit<GroupRow, "lines" | "incomeKind"> & { incomeKind: string | null })[];
  const lineStmt = db.prepare(
    `SELECT id, name, amount, day FROM group_lines WHERE group_id = ? ORDER BY id`,
  );
  return groups.map((g) => ({
    ...g,
    incomeKind: g.incomeKind === "principal" || g.incomeKind === "supplementary" ? g.incomeKind : null,
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
  startMonth: string,
  endMonth: string | null,
): number {
  const info = db
    .prepare(
      `INSERT INTO groups (account_id, name, direction, kind, monthly_amount, income_kind, start_month, end_month)
       VALUES (?, ?, ?, 'envelope', ?, ?, ?, ?)`,
    )
    .run(accountId, name, direction, monthlyAmount, incomeKind, startMonth, endMonth);
  return Number(info.lastInsertRowid);
}

export function insertRecurringGroup(
  db: Database.Database,
  accountId: string,
  name: string,
  direction: "in" | "out",
  incomeKind: "principal" | "supplementary" | null = null,
  startMonth: string,
  endMonth: string | null,
): number {
  const info = db
    .prepare(
      `INSERT INTO groups (account_id, name, direction, kind, monthly_amount, income_kind, start_month, end_month)
       VALUES (?, ?, ?, 'recurring', NULL, ?, ?, ?)`,
    )
    .run(accountId, name, direction, incomeKind, startMonth, endMonth);
  return Number(info.lastInsertRowid);
}

// Vrai si le compte possède déjà une rémunération de ce type (principal / supplémentaire).
export function hasIncomeGroup(
  db: Database.Database,
  accountId: string,
  incomeKind: "principal" | "supplementary",
): boolean {
  const row = db
    .prepare(`SELECT 1 FROM groups WHERE account_id = ? AND income_kind = ? LIMIT 1`)
    .get(accountId, incomeKind);
  return row !== undefined;
}

export function deleteGroup(db: Database.Database, id: number): void {
  // budget_amounts.group_id n'a plus de FK ON DELETE CASCADE (retirée pour laisser
  // vivre la provision du groupe 0 « non catégorisés », jamais supprimé) : on purge
  // donc à la main les budgets datés du groupe supprimé.
  db.prepare(`DELETE FROM budget_amounts WHERE group_id = ?`).run(id);
  db.prepare(`DELETE FROM groups WHERE id = ?`).run(id);
}

export function renameGroup(db: Database.Database, id: number, name: string): void {
  db.prepare(`UPDATE groups SET name = ? WHERE id = ?`).run(name, id);
}

// La colonne group_lines.keyword est NOT NULL (héritée de l'ancien matching par
// mot-clé, désormais mort) : on y écrit '' en dur pour ne pas violer la contrainte,
// sans l'exposer dans la signature publique.
export function insertLine(
  db: Database.Database,
  groupId: number,
  name: string,
  amount: number,
  day: number,
): number {
  const info = db
    .prepare(
      `INSERT INTO group_lines (group_id, name, amount, day, keyword) VALUES (?, ?, ?, ?, '')`,
    )
    .run(groupId, name, amount, day);
  return Number(info.lastInsertRowid);
}

export function updateLine(
  db: Database.Database,
  id: number,
  name: string,
  amount: number,
  day: number,
): void {
  db.prepare(`UPDATE group_lines SET name = ?, amount = ?, day = ? WHERE id = ?`).run(name, amount, day, id);
}

export function deleteLine(db: Database.Database, id: number): void {
  db.prepare(`DELETE FROM group_lines WHERE id = ?`).run(id);
}
