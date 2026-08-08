import type Database from "better-sqlite3";

export type GroupLineRow = {
  id: number;
  name: string;
  amount: number;
  // Durée de vie de la ligne, comme celle d'un groupe : un abonnement résilié
  // s'arrête sans emporter le récurrent qui le porte. NULL des deux côtés = pas de
  // borne (les lignes d'avant cette colonne, et celles créées « permanentes »).
  startMonth: string | null;
  endMonth: string | null;
};

export type GroupRow = {
  id: number;
  accountId: string;
  name: string;
  direction: "in" | "out";
  monthlyAmount: number | null;
  startMonth: string | null;
  endMonth: string | null;
  lines: GroupLineRow[];
};

// Nature d'un groupe (enveloppe ou récurrent), ou null s'il n'existe pas. Le
// groupe 0 (non catégorisés) n'a pas de ligne dans `groups` : c'est à
// l'appelant de le traiter comme une enveloppe (il a une provision, pas des lignes).
// Nombre de sous-postes d'une dépense, ou null si le groupe n'existe pas. C'est ce
// nombre, et non une nature déclarée, qui dit si une transaction peut se poser
// directement sur le groupe (canAttachToGroup).
export function countGroupLines(db: Database.Database, id: number): number | null {
  const existe = db.prepare(`SELECT 1 FROM groups WHERE id = ?`).get(id);
  if (!existe) return null;
  const row = db.prepare(`SELECT COUNT(*) AS n FROM group_lines WHERE group_id = ?`).get(id) as { n: number };
  return row.n;
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

// Durée de vie d'une ligne de récurrent, ou null si la ligne n'existe pas. Sert à
// juger un changement de bornes : ce qu'on retire se lit par rapport à ce qui est.
export function getLineLifespan(
  db: Database.Database,
  id: number,
): { startMonth: string | null; endMonth: string | null } | null {
  const row = db
    .prepare(`SELECT start_month AS startMonth, end_month AS endMonth FROM group_lines WHERE id = ?`)
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
      `SELECT id, account_id AS accountId, name, direction, monthly_amount AS monthlyAmount,
              start_month AS startMonth, end_month AS endMonth
       FROM groups ORDER BY name`,
    )
    .all() as Omit<GroupRow, "lines">[];
  const lineStmt = db.prepare(
    `SELECT id, name, amount, start_month AS startMonth, end_month AS endMonth
     FROM group_lines WHERE group_id = ? ORDER BY id`,
  );
  return groups.map((g) => ({
    ...g,
    lines: lineStmt.all(g.id) as GroupLineRow[],
  }));
}

// Crée un groupe : une dépense, ou un revenu quand direction vaut « in ». Une seule
// fonction, et le sens est tout ce qui les sépare — un groupe naît plat, avec son
// montant à lui, et se découpe ensuite en sous-postes si on veut (c'est alors leur
// somme qui fait son budget).
export function insertGroup(
  db: Database.Database,
  accountId: string,
  name: string,
  direction: "in" | "out",
  monthlyAmount: number,
  startMonth: string,
  endMonth: string | null,
): number {
  const info = db
    .prepare(
      `INSERT INTO groups (account_id, name, direction, monthly_amount, start_month, end_month)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(accountId, name, direction, monthlyAmount, startMonth, endMonth);
  return Number(info.lastInsertRowid);
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

// Déplace les bornes d'un groupe déjà créé. Rien d'autre n'est touché : les montants
// datés survivent tels quels, y compris ceux des mois qui sortent de la vie du groupe.
// C'est ce qui rend le geste réversible — remettre la borne où elle était fait
// réapparaître les mois avec le budget qu'ils avaient.
export function setGroupLifespan(
  db: Database.Database,
  id: number,
  startMonth: string,
  endMonth: string | null,
): void {
  db.prepare(`UPDATE groups SET start_month = ?, end_month = ? WHERE id = ?`).run(startMonth, endMonth, id);
}

// Même chose pour une ligne de récurrent.
export function setLineLifespan(
  db: Database.Database,
  id: number,
  startMonth: string,
  endMonth: string | null,
): void {
  db.prepare(`UPDATE group_lines SET start_month = ?, end_month = ? WHERE id = ?`).run(startMonth, endMonth, id);
}

// La colonne group_lines.keyword est NOT NULL (héritée de l'ancien matching par
// mot-clé, désormais mort) : on y écrit '' en dur pour ne pas violer la contrainte,
// sans l'exposer dans la signature publique.
// Les bornes de mois sont optionnelles : sans elles, la ligne est permanente — ce
// que sont toutes les lignes créées avant qu'une durée puisse se choisir.
export function insertLine(
  db: Database.Database,
  groupId: number,
  name: string,
  amount: number,
  startMonth: string | null = null,
  endMonth: string | null = null,
): number {
  const info = db
    .prepare(
      `INSERT INTO group_lines (group_id, name, amount, keyword, start_month, end_month)
       VALUES (?, ?, ?, '', ?, ?)`,
    )
    .run(groupId, name, amount, startMonth, endMonth);
  return Number(info.lastInsertRowid);
}

// Écrit aussi group_lines.amount, la colonne héritée que plus aucun calcul de budget
// ne lit (les montants vivent dans line_amounts, datés). Plus appelée par l'app :
// modifier une ligne ne touche plus qu'à son nom (renameLine ci-dessous),
// son montant se fixe depuis sa case du tableau. Gardée parce que la migration de
// reprise doit continuer de bien se comporter face à des bases où cette colonne porte
// un montant périmé — ce que vérifie tests/db/seed-dated-amounts.test.ts.
export function updateLine(
  db: Database.Database,
  id: number,
  name: string,
  amount: number,
): void {
  db.prepare(`UPDATE group_lines SET name = ?, amount = ? WHERE id = ?`).run(name, amount, id);
}

// Le nom d'une ligne : sa seule propriété qui vaille pour tous les mois. Ne touche
// pas à group_lines.amount, pour ne pas y laisser un montant périmé.
export function renameLine(db: Database.Database, id: number, name: string): void {
  db.prepare(`UPDATE group_lines SET name = ? WHERE id = ?`).run(name, id);
}

export function deleteLine(db: Database.Database, id: number): void {
  db.prepare(`DELETE FROM group_lines WHERE id = ?`).run(id);
}
