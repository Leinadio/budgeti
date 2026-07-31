import type Database from "better-sqlite3";
import type { BudgetWrite } from "../../lib/overspend-writes";

// group_id = 0 désigne les Non catégorisés du compte.
// lineId : la ligne de récurrent qui déborde, null pour une enveloppe et pour les non
// catégorisés. Stocké 0 en base (voir migrateOverspendDecisionLine), rendu null ici :
// « pas de ligne » est une absence, pas un identifiant.
export type OverspendDecision = {
  accountId: string;
  groupId: number;
  lineId: number | null;
  month: string; // YYYY-MM
  decision: "exceptional" | "permanent";
  decidedAt: string; // ISO datetime
  writes: BudgetWrite[] | null; // montants posés par la décision, pour l'annuler
};

// Ligne brute lue en base : writes est encore du JSON, à désérialiser.
// Ligne brute : line_id vaut 0 pour « pas de ligne », writes est encore du JSON.
type Row = Omit<OverspendDecision, "writes" | "lineId"> & { lineId: number; writesJson: string | null };

// `writes` est une colonne libre (TEXT), pas contrainte par le schéma : un JSON
// corrompu ne doit jamais faire planter la lecture (listOverspendDecisions est
// appelé au chargement de /historique — une ligne corrompue ne doit pas casser
// toute la page). On rend null dans ce cas, comme si rien n'avait été posé.
function hydrate(row: Row): OverspendDecision {
  const { writesJson, lineId, ...rest } = row;
  let writes: BudgetWrite[] | null = null;
  if (writesJson) {
    try {
      writes = JSON.parse(writesJson) as BudgetWrite[];
    } catch {
      writes = null;
    }
  }
  return { ...rest, lineId: lineId === 0 ? null : lineId, writes };
}

export function listOverspendDecisions(db: Database.Database, accountId: string): OverspendDecision[] {
  const rows = db
    .prepare(
      `SELECT account_id AS accountId, group_id AS groupId, line_id AS lineId, month, decision, decided_at AS decidedAt, writes AS writesJson
       FROM overspend_decisions WHERE account_id = ? ORDER BY month, group_id, line_id`,
    )
    .all(accountId) as Row[];
  return rows.map(hydrate);
}

// Lit la décision existante pour un dépassement donné, ou null si non tranché.
export function getOverspendDecision(
  db: Database.Database, accountId: string, groupId: number, lineId: number | null, month: string,
): OverspendDecision | null {
  const row = db
    .prepare(
      `SELECT account_id AS accountId, group_id AS groupId, line_id AS lineId, month, decision, decided_at AS decidedAt, writes AS writesJson
       FROM overspend_decisions WHERE account_id = ? AND group_id = ? AND line_id = ? AND month = ?`,
    )
    .get(accountId, groupId, lineId ?? 0, month) as Row | undefined;
  return row ? hydrate(row) : null;
}

export function setOverspendDecision(db: Database.Database, d: OverspendDecision): void {
  db.prepare(
    `INSERT INTO overspend_decisions (account_id, group_id, line_id, month, decision, decided_at, writes) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_id, group_id, line_id, month) DO UPDATE SET decision = excluded.decision, decided_at = excluded.decided_at, writes = excluded.writes`,
  ).run(d.accountId, d.groupId, d.lineId ?? 0, d.month, d.decision, d.decidedAt, d.writes ? JSON.stringify(d.writes) : null);
}

// Annule une décision : la ligne disparaît, le dépassement redevient « à trancher ».
export function deleteOverspendDecision(
  db: Database.Database, accountId: string, groupId: number, lineId: number | null, month: string,
): void {
  db.prepare(`DELETE FROM overspend_decisions WHERE account_id = ? AND group_id = ? AND line_id = ? AND month = ?`)
    .run(accountId, groupId, lineId ?? 0, month);
}
