import type Database from "better-sqlite3";

// Convertit l'ancienne table budgets (category_id, month, limit_amount) vers le
// modèle récurrent (category_id UNIQUE, monthly_limit), en gardant le montant du
// mois le plus récent par catégorie. Idempotent : no-op si déjà au nouveau schéma.
export function migrateBudgets(db: Database.Database): void {
  const cols = db.prepare("PRAGMA table_info(budgets)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "month")) return;
  // Transaction : la reconstruction (create/insert/drop/rename) doit être atomique.
  // Un crash entre DROP et RENAME laisserait la base sans table budgets.
  db.transaction(() => {
    db.exec(`
      CREATE TABLE budgets_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category_id INTEGER NOT NULL REFERENCES categories(id),
        monthly_limit REAL NOT NULL,
        UNIQUE(category_id)
      );
      INSERT INTO budgets_new (category_id, monthly_limit)
        SELECT category_id, limit_amount FROM budgets b
        WHERE b.month = (SELECT MAX(month) FROM budgets b2 WHERE b2.category_id = b.category_id);
      DROP TABLE budgets;
      ALTER TABLE budgets_new RENAME TO budgets;
    `);
  })();
}

// Ajoute la colonne custom_name (alias utilisateur) aux bases antérieures.
// Idempotent : no-op si la colonne existe déjà. Ne touche à aucune donnée.
export function migrateAccountCustomName(db: Database.Database): void {
  const cols = db.prepare("PRAGMA table_info(accounts)").all() as { name: string }[];
  if (cols.some((c) => c.name === "custom_name")) return;
  db.exec(`ALTER TABLE accounts ADD COLUMN custom_name TEXT`);
}

// Refonte des groupes : type (enveloppe/recurring) + montant mensuel + mots-clés,
// et rattachement manuel des transactions (group_id). Clean slate sur les groupes
// (comptes/transactions conservés). Idempotent.
export function migrateGroupsV2(db: Database.Database): void {
  const gcols = db.prepare("PRAGMA table_info(groups)").all() as { name: string }[];
  if (!gcols.some((c) => c.name === "kind")) {
    db.transaction(() => {
      db.exec(`
        DROP TABLE IF EXISTS group_keywords;
        DROP TABLE IF EXISTS group_lines;
        DROP TABLE IF EXISTS groups;
        CREATE TABLE groups (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          account_id TEXT NOT NULL REFERENCES accounts(id),
          name TEXT NOT NULL,
          direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
          kind TEXT NOT NULL CHECK (kind IN ('envelope', 'recurring')),
          monthly_amount REAL
        );
        CREATE TABLE group_lines (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          amount REAL NOT NULL,
          day INTEGER,
          keyword TEXT NOT NULL
        );
        CREATE TABLE group_keywords (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
          keyword TEXT NOT NULL
        );
      `);
    })();
  }
  const tcols = db.prepare("PRAGMA table_info(transactions)").all() as { name: string }[];
  if (!tcols.some((c) => c.name === "group_id")) {
    db.exec(`ALTER TABLE transactions ADD COLUMN group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL`);
  }
}

// Ajoute la colonne excluded : une transaction forcée « non catégorisé » est
// exclue de toute catégorisation (même si un mot-clé matcherait). Idempotent.
export function migrateTransactionExcluded(db: Database.Database): void {
  const cols = db.prepare("PRAGMA table_info(transactions)").all() as { name: string }[];
  if (cols.some((c) => c.name === "excluded")) return;
  db.exec(`ALTER TABLE transactions ADD COLUMN excluded INTEGER NOT NULL DEFAULT 0`);
}

// Ajoute la colonne line_id : rattachement manuel d'une transaction à une ligne
// précise d'un groupe récurrent (ex. « Direct Assurance voiture »). Idempotent.
export function migrateTransactionLineId(db: Database.Database): void {
  const cols = db.prepare("PRAGMA table_info(transactions)").all() as { name: string }[];
  if (cols.some((c) => c.name === "line_id")) return;
  db.exec(`ALTER TABLE transactions ADD COLUMN line_id INTEGER REFERENCES group_lines(id) ON DELETE SET NULL`);
}

// Ajoute les colonnes de saisie manuelle : manual (1 = saisie main), income_kind
// (principale/supplémentaire pour une entrée), note (commentaire, reçoit le libellé
// manuel après fusion). Idempotent.
export function migrateTransactionManualFields(db: Database.Database): void {
  const cols = db.prepare("PRAGMA table_info(transactions)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "manual"))
    db.exec(`ALTER TABLE transactions ADD COLUMN manual INTEGER NOT NULL DEFAULT 0`);
  if (!cols.some((c) => c.name === "income_kind"))
    db.exec(`ALTER TABLE transactions ADD COLUMN income_kind TEXT`);
  if (!cols.some((c) => c.name === "note"))
    db.exec(`ALTER TABLE transactions ADD COLUMN note TEXT`);
}

// Table des rapprochements écartés (« ce n'est pas la même ») : ne plus reproposer
// une paire (manuelle, synchronisée). Idempotent.
export function migrateReconcileIgnored(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS reconcile_ignored (
    manual_id TEXT NOT NULL,
    synced_id TEXT NOT NULL,
    PRIMARY KEY (manual_id, synced_id)
  )`);
}

// Ajoute income_kind aux groupes : classe une entrée en revenu « principal » ou
// « supplementary ». NULL pour une dépense ou un groupe non-revenu. Idempotent.
export function migrateGroupIncomeKind(db: Database.Database): void {
  const cols = db.prepare("PRAGMA table_info(groups)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "income_kind"))
    db.exec(`ALTER TABLE groups ADD COLUMN income_kind TEXT`);
}

// Convertit les rémunérations principales de l'ancien modèle (récurrent + lignes)
// vers une enveloppe portant un montant unique = somme des lignes, puis supprime
// ces lignes. Idempotent : ne cible que income_kind='principal' encore en 'recurring'.
export function migrateRemunerationPrincipalToEnvelope(db: Database.Database): void {
  const cols = db.prepare("PRAGMA table_info(groups)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "income_kind")) return;
  const rows = db
    .prepare(`SELECT id FROM groups WHERE income_kind = 'principal' AND kind = 'recurring'`)
    .all() as { id: number }[];
  if (rows.length === 0) return;
  db.transaction(() => {
    for (const { id } of rows) {
      const sum = (db.prepare(`SELECT COALESCE(SUM(amount), 0) AS s FROM group_lines WHERE group_id = ?`).get(id) as { s: number }).s;
      db.prepare(`UPDATE groups SET kind = 'envelope', monthly_amount = ? WHERE id = ?`).run(sum, id);
      db.prepare(`DELETE FROM group_lines WHERE group_id = ?`).run(id);
    }
  })();
}

// Durée de vie des groupes : mois de départ / de fin. Les groupes existants
// deviennent permanents et visibles partout (start_month très ancien).
export function migrateGroupLifespan(db: Database.Database) {
  const cols = db.prepare("PRAGMA table_info(groups)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "start_month"))
    db.exec(`ALTER TABLE groups ADD COLUMN start_month TEXT`);
  if (!cols.some((c) => c.name === "end_month"))
    db.exec(`ALTER TABLE groups ADD COLUMN end_month TEXT`);
  db.exec(`UPDATE groups SET start_month = '2000-01' WHERE start_month IS NULL`);
}

// Retire la FK sur budget_amounts.group_id : la provision « non catégorisés »
// (group_id = 0) n'a pas de ligne dans groups, la FK faisait échouer l'insertion.
// Même traitement que overspend_decisions (pas de FK volontairement). Idempotent :
// no-op si la FK a déjà été retirée (détecté via PRAGMA foreign_key_list).
export function migrateBudgetAmountsDropGroupFk(db: Database.Database): void {
  const fks = db.prepare("PRAGMA foreign_key_list(budget_amounts)").all() as { table: string }[];
  if (!fks.some((fk) => fk.table === "groups")) return;
  db.transaction(() => {
    db.exec(`
      CREATE TABLE budget_amounts_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER NOT NULL,
        effective_month TEXT NOT NULL,
        amount REAL NOT NULL,
        UNIQUE(group_id, effective_month)
      );
      INSERT INTO budget_amounts_new (id, group_id, effective_month, amount)
        SELECT id, group_id, effective_month, amount FROM budget_amounts;
      DROP TABLE budget_amounts;
      ALTER TABLE budget_amounts_new RENAME TO budget_amounts;
    `);
  })();
}
