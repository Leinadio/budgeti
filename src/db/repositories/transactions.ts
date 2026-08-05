import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

export type TxnRow = {
  id: string;
  account_id: string;
  date: string;
  amount: number;
  label: string;
  category_id: number | null;
};

export type TxnView = {
  date: string;
  amount: number;
  label: string;
  id: string;
  accountId: string;
  accountLabel: string;
  groupId: number | null;
  lineId: number | null;
  excluded: boolean;
  ignored: boolean;
  manual: boolean;
  incomeKind: "principal" | "supplementary" | null;
  note: string | null;
  // Commentaire libre de l'utilisateur, affiché sous le libellé (cf. src/lib/txn-comment.ts).
  comment: string | null;
};

export type ReconcileSuggestion = { manual: TxnView; synced: TxnView };

export function upsertTransaction(db: Database.Database, t: TxnRow): number {
  const result = db.prepare(
    `INSERT OR IGNORE INTO transactions (id, account_id, date, amount, label, category_id)
     VALUES (@id, @account_id, @date, @amount, @label, @category_id)`,
  ).run(t);
  return result.changes;
}

// Somme des montants non comptabilisés, par compte. Le solde renvoyé par la banque
// les contient forcément : ce sont de vraies opérations, elles ont bien été encaissées.
// Il faut donc les retrancher AVANT d'ancrer le moindre calcul, sinon les soldes
// reconstruits sont décalés d'autant — la chaîne rembobine des mouvements dont ces
// opérations sont absentes, à partir d'un solde qui, lui, les contient.
export function sumIgnoredByAccount(db: Database.Database): Record<string, number> {
  const rows = db
    .prepare(
      `SELECT account_id AS accountId, COALESCE(SUM(amount), 0) AS total
       FROM transactions WHERE ignored = 1 GROUP BY account_id`,
    )
    .all() as { accountId: string; total: number }[];
  return Object.fromEntries(rows.map((r) => [r.accountId, r.total]));
}

// Les transactions non comptabilisées sont masquées par défaut : tous les écrans
// de calcul (tableau de bord, prévisionnel, historique) les ignorent ainsi sans
// rien avoir à filtrer. Seul l'écran Transactions passe includeIgnored pour
// pouvoir les afficher et les réactiver.
export function listTransactions(
  db: Database.Database,
  filter?: { month?: string; includeIgnored?: boolean },
): TxnView[] {
  let sql =
    `SELECT t.id, t.date, t.amount, t.label, t.group_id AS groupId, t.line_id AS lineId, t.excluded AS excluded,
            t.ignored AS ignored, t.manual AS manual, t.income_kind AS incomeKind, t.note AS note,
            t.comment AS comment,
            t.account_id AS accountId,
            COALESCE(COALESCE(a.custom_name, a.name) || ' ' || a.iban_masked, COALESCE(a.custom_name, a.name)) AS accountLabel
     FROM transactions t
     LEFT JOIN accounts a ON a.id = t.account_id`;
  const clauses: string[] = [];
  const params: Record<string, string | number> = {};
  if (filter?.month) {
    clauses.push("substr(t.date,1,7) = @month");
    params.month = filter.month;
  }
  if (!filter?.includeIgnored) clauses.push("t.ignored = 0");
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  sql += " ORDER BY t.date DESC";
  const stmt = db.prepare(sql);
  // better-sqlite3 refuse un objet de paramètres quand la requête n'en attend aucun.
  const rows = (Object.keys(params).length ? stmt.all(params) : stmt.all()) as (Omit<TxnView, "excluded" | "ignored" | "manual" | "incomeKind"> & { excluded: number; ignored: number; manual: number; incomeKind: string | null })[];
  return rows.map((r) => ({
    ...r,
    excluded: r.excluded === 1,
    ignored: r.ignored === 1,
    manual: r.manual === 1,
    incomeKind: r.incomeKind === "principal" || r.incomeKind === "supplementary" ? r.incomeKind : null,
  }));
}

// groupId non nul => rattachement manuel ; lineId => ligne récurrente précise
// (implique son groupe parent) ; excluded => forcé « non catégorisé ».
// Les cas sont mutuellement exclusifs : un groupe explicite lève l'exclusion,
// et choisir un groupe sans ligne remet line_id à NULL.
export function setTransactionGroup(
  db: Database.Database,
  id: string,
  groupId: number | null,
  excluded = false,
  lineId: number | null = null,
): void {
  db.prepare("UPDATE transactions SET group_id = ?, line_id = ?, excluded = ? WHERE id = ?").run(
    groupId,
    lineId,
    excluded ? 1 : 0,
    id,
  );
}

// Date d'une transaction (YYYY-MM-DD), null si elle n'existe pas. Sert à savoir de
// quel mois elle relève avant de la rattacher à un groupe.
export function getTransactionDate(db: Database.Database, id: string): string | null {
  const row = db.prepare(`SELECT date FROM transactions WHERE id = ?`).get(id) as { date: string } | undefined;
  return row ? row.date : null;
}

// Pose (ou retire, avec null) le commentaire d'une transaction. Rien d'autre n'est
// touché : le commentaire s'ajoute au libellé de la banque, il ne le remplace pas.
export function setTransactionComment(db: Database.Database, id: string, comment: string | null): void {
  db.prepare("UPDATE transactions SET comment = ? WHERE id = ?").run(comment, id);
}

// Marque une transaction comme non comptabilisée (ou la remet dans les calculs).
// Son rattachement de groupe est conservé : la réactiver la remet où elle était.
export function setTransactionIgnored(db: Database.Database, id: string, ignored: boolean): void {
  db.prepare("UPDATE transactions SET ignored = ? WHERE id = ?").run(ignored ? 1 : 0, id);
}

export type ManualTxnInput = {
  accountId: string;
  date: string; // YYYY-MM-DD
  amount: number; // signé
  label: string;
  groupId: number | null;
  lineId: number | null;
  incomeKind: "principal" | "supplementary" | null;
};

// Insère une transaction saisie à la main. id préfixé "manual:", manual = 1.
export function insertManualTransaction(db: Database.Database, input: ManualTxnInput): string {
  const id = `manual:${randomUUID()}`;
  db.prepare(
    `INSERT INTO transactions (id, account_id, date, amount, label, category_id, group_id, line_id, excluded, manual, income_kind, note)
     VALUES (@id, @account_id, @date, @amount, @label, NULL, @group_id, @line_id, 0, 1, @income_kind, NULL)`,
  ).run({
    id,
    account_id: input.accountId,
    date: input.date,
    amount: input.amount,
    label: input.label,
    group_id: input.groupId,
    line_id: input.lineId,
    income_kind: input.incomeKind,
  });
  return id;
}

// Édite une transaction manuelle (garde-fou : n'agit que sur manual = 1).
export function updateManualTransaction(
  db: Database.Database,
  id: string,
  input: Omit<ManualTxnInput, "accountId">,
): void {
  db.prepare(
    `UPDATE transactions SET date=@date, amount=@amount, label=@label, group_id=@group_id, line_id=@line_id, income_kind=@income_kind
     WHERE id=@id AND manual=1`,
  ).run({
    id,
    date: input.date,
    amount: input.amount,
    label: input.label,
    group_id: input.groupId,
    line_id: input.lineId,
    income_kind: input.incomeKind,
  });
}

// Supprime une transaction manuelle (garde-fou : n'agit que sur manual = 1).
export function deleteManualTransaction(db: Database.Database, id: string): void {
  db.prepare("DELETE FROM transactions WHERE id=? AND manual=1").run(id);
}

// Écart en jours entre deux dates "YYYY-MM-DD" (UTC, pur calendaire).
function dayDiff(a: string, b: string): number {
  const da = Date.parse(a + "T00:00:00Z");
  const db2 = Date.parse(b + "T00:00:00Z");
  return Math.round((da - db2) / 86_400_000);
}

// Paires (manuelle, synchronisée) probablement identiques : même compte, même
// montant, dates à windowDays près, non déjà écartées.
export function findReconcileSuggestions(db: Database.Database, windowDays = 5): ReconcileSuggestion[] {
  const all = listTransactions(db);
  const manuals = all.filter((t) => t.manual);
  const synced = all.filter((t) => !t.manual);
  const ignored = new Set(
    (db.prepare("SELECT manual_id, synced_id FROM reconcile_ignored").all() as { manual_id: string; synced_id: string }[])
      .map((r) => `${r.manual_id}|${r.synced_id}`),
  );
  const out: ReconcileSuggestion[] = [];
  for (const m of manuals) {
    for (const s of synced) {
      if (s.accountId !== m.accountId) continue;
      if (s.amount !== m.amount) continue;
      if (Math.abs(dayDiff(m.date, s.date)) > windowDays) continue;
      if (ignored.has(`${m.id}|${s.id}`)) continue;
      out.push({ manual: m, synced: s });
    }
  }
  return out;
}

// Fusionne une saisie manuelle dans sa vraie ligne bancaire : on garde la ligne
// bancaire, on lui reporte groupe/ligne/étiquette de la manuelle, son libellé va
// dans note, puis la manuelle est supprimée. Atomique.
export function mergeTransactions(
  db: Database.Database,
  { syncedId, manualId }: { syncedId: string; manualId: string },
): void {
  const run = db.transaction(() => {
    const m = db
      .prepare("SELECT label, group_id AS groupId, line_id AS lineId, income_kind AS incomeKind FROM transactions WHERE id=? AND manual=1")
      .get(manualId) as { label: string; groupId: number | null; lineId: number | null; incomeKind: string | null } | undefined;
    if (!m) return;
    const res = db.prepare(
      `UPDATE transactions SET group_id=@group_id, line_id=@line_id, income_kind=@income_kind, note=@note
       WHERE id=@id AND manual=0`,
    ).run({ id: syncedId, group_id: m.groupId, line_id: m.lineId, income_kind: m.incomeKind, note: m.label });
    if (res.changes === 0) return; // cible synchronisée introuvable : on ne supprime pas la saisie manuelle
    db.prepare("DELETE FROM transactions WHERE id=? AND manual=1").run(manualId);
  });
  run();
}

// Mémorise une paire écartée (« ce n'est pas la même »).
export function ignoreMatch(db: Database.Database, manualId: string, syncedId: string): void {
  db.prepare("INSERT OR IGNORE INTO reconcile_ignored (manual_id, synced_id) VALUES (?, ?)").run(manualId, syncedId);
}
