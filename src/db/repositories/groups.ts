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

// Nature d'un groupe (enveloppe ou récurrent), ou null s'il n'existe pas. Le
// groupe 0 (non catégorisés) n'a pas de ligne dans `groups` : c'est à
// l'appelant de le traiter comme une enveloppe (il a une provision, pas des lignes).
export function getGroupKind(db: Database.Database, id: number): "envelope" | "recurring" | null {
  const row = db.prepare(`SELECT kind FROM groups WHERE id = ?`).get(id) as { kind: "envelope" | "recurring" } | undefined;
  return row ? row.kind : null;
}

// Durée de vie d'un groupe (mois de départ / de fin, null = sans borne de ce
// côté), ou null s'il n'existe pas. Sert à refuser d'y rattacher une transaction
// d'un mois où il ne vit pas.
export function getGroupLifespan(
  db: Database.Database,
  id: number,
): { startMonth: string | null; endMonth: string | null } | null {
  const row = db
    .prepare(`SELECT start_month AS startMonth, end_month AS endMonth FROM groups WHERE id = ?`)
    .get(id) as { startMonth: string | null; endMonth: string | null } | undefined;
  return row ?? null;
}

// Groupe auquel appartient une ligne, null si la ligne n'existe pas. Sert à vérifier
// qu'un couple (groupe, ligne) est cohérent avant de l'écrire sur une transaction.
export function getLineGroupId(db: Database.Database, lineId: number): number | null {
  const row = db.prepare(`SELECT group_id AS groupId FROM group_lines WHERE id = ?`).get(lineId) as { groupId: number } | undefined;
  return row ? row.groupId : null;
}

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

// Écrit aussi group_lines.amount, la colonne héritée que plus aucun calcul de budget
// ne lit (les montants vivent dans line_amounts, datés). Plus appelée par l'app :
// modifier une ligne ne touche plus qu'à son nom et son jour (renameLine ci-dessous),
// son montant se fixe depuis sa case du tableau. Gardée parce que la migration de
// reprise doit continuer de bien se comporter face à des bases où cette colonne porte
// un montant périmé — ce que vérifie tests/db/seed-dated-amounts.test.ts.
export function updateLine(
  db: Database.Database,
  id: number,
  name: string,
  amount: number,
  day: number,
): void {
  db.prepare(`UPDATE group_lines SET name = ?, amount = ?, day = ? WHERE id = ?`).run(name, amount, day, id);
}

// Nom et jour d'une ligne : ses deux seules propriétés qui valent pour tous les mois.
// Ne touche pas à group_lines.amount, pour ne pas y laisser un montant périmé.
export function renameLine(db: Database.Database, id: number, name: string, day: number): void {
  db.prepare(`UPDATE group_lines SET name = ?, day = ? WHERE id = ?`).run(name, day, id);
}

export function deleteLine(db: Database.Database, id: number): void {
  db.prepare(`DELETE FROM group_lines WHERE id = ?`).run(id);
}
