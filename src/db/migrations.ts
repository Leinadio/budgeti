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
//
// ATTENTION : le marqueur de version est `monthly_amount`, et cette migration DÉTRUIT
// les groupes quand elle ne le trouve pas. Il a longtemps été `kind` — jusqu'à ce que
// cette colonne disparaisse (migrateDropGroupKind) : la base rouverte se serait crue en
// v1 et aurait effacé tous les groupes au redémarrage suivant. Ne jamais retirer
// `monthly_amount` sans changer ce marqueur d'abord. C'est le genre de mine qu'une base
// « :memory: » ne fait jamais sauter (voir tests/db/migration-drop-group-kind.test.ts).
export function migrateGroupsV2(db: Database.Database): void {
  const gcols = db.prepare("PRAGMA table_info(groups)").all() as { name: string }[];
  if (!gcols.some((c) => c.name === "monthly_amount")) {
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

// Ajoute la colonne ignored : une transaction non comptabilisée est retirée de
// tous les calculs (dépenses, budgets, soldes, prévisionnel). À ne pas confondre
// avec excluded, qui la force en « non catégorisé » mais la garde comptée.
// Idempotent.
export function migrateTransactionIgnored(db: Database.Database): void {
  const cols = db.prepare("PRAGMA table_info(transactions)").all() as { name: string }[];
  if (cols.some((c) => c.name === "ignored")) return;
  db.exec(`ALTER TABLE transactions ADD COLUMN ignored INTEGER NOT NULL DEFAULT 0`);
}

// Ajoute la colonne line_id : rattachement manuel d'une transaction à une ligne
// précise d'un groupe récurrent (ex. « Direct Assurance voiture »). Idempotent.
export function migrateTransactionLineId(db: Database.Database): void {
  const cols = db.prepare("PRAGMA table_info(transactions)").all() as { name: string }[];
  if (cols.some((c) => c.name === "line_id")) return;
  db.exec(`ALTER TABLE transactions ADD COLUMN line_id INTEGER REFERENCES group_lines(id) ON DELETE SET NULL`);
}

// Ajoute les colonnes de saisie manuelle : manual (1 = saisie main) et note
// (commentaire, reçoit le libellé manuel après fusion). Idempotent.
//
// Elle ajoutait aussi income_kind, la classe de revenu d'une transaction saisie à la
// main. Cette colonne est restée à NULL sur toutes les lignes : la classe venait du
// groupe, pas de la transaction. Elle a été retirée (migrateDropIncomeKind) — la
// rajouter ici la ferait revenir à chaque démarrage.
export function migrateTransactionManualFields(db: Database.Database): void {
  const cols = db.prepare("PRAGMA table_info(transactions)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "manual"))
    db.exec(`ALTER TABLE transactions ADD COLUMN manual INTEGER NOT NULL DEFAULT 0`);
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

// Retire la classe de revenu, des groupes comme des transactions. « Principale » et
// « supplémentaire » promettaient deux comportements et n'en disaient qu'un : ce revenu
// se reproduit, ou non. Sa durée le dit mieux, et dit en plus de quels mois il s'agit.
//
// ATTENTION : deux migrations ajoutaient cette colonne quand elles ne la trouvaient pas
// (migrateGroupIncomeKind, supprimée ; migrateTransactionManualFields, amputée). Toute
// migration qui la rajouterait la ferait revenir au démarrage suivant, indéfiniment —
// c'est ce que vérifie tests/db/migration-drop-income-kind.test.ts, sur une vraie base
// sur disque rouverte plusieurs fois.
export function migrateDropIncomeKind(db: Database.Database): void {
  for (const table of ["groups", "transactions"]) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (cols.some((c) => c.name === "income_kind")) {
      db.exec(`ALTER TABLE ${table} DROP COLUMN income_kind`);
    }
  }
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

// Durée de vie d'une ligne de récurrent : mêmes bornes que pour un groupe. Un
// abonnement résilié s'arrête sans emporter le récurrent qui le porte, et une ligne
// posée pour un seul mois ne traîne pas sur les suivants.
//
// Aucune reprise pour les lignes existantes : sans bornes, elles restent permanentes,
// ce qu'elles étaient. Leur début, lui, se lit déjà dans leur suite de montants datés
// (lineStarted) — leur inventer ici un mois de départ les ferait naître ailleurs que
// là où le tableau les montre naître. Idempotent.
export function migrateLineLifespan(db: Database.Database) {
  const cols = db.prepare("PRAGMA table_info(group_lines)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "start_month"))
    db.exec(`ALTER TABLE group_lines ADD COLUMN start_month TEXT`);
  if (!cols.some((c) => c.name === "end_month"))
    db.exec(`ALTER TABLE group_lines ADD COLUMN end_month TEXT`);
}

// Retire la nature d'un groupe (« enveloppe » / « récurrent »). Elle ne décidait plus
// rien : le budget, le dépassement, la prévision et le rattachement se règlent tous sur
// un fait — la dépense a-t-elle des sous-postes. Deux mots qui promettaient deux
// comportements et n'en donnaient qu'un valaient moins que rien : ils faisaient croire
// à un choix au moment de créer une dépense.
//
// À passer APRÈS toutes les migrations qui lisent encore la colonne. Idempotent.
export function migrateDropGroupKind(db: Database.Database): void {
  const cols = db.prepare("PRAGMA table_info(groups)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "kind")) return;
  db.exec(`ALTER TABLE groups DROP COLUMN kind`);
}

// Retire le jour du mois des sous-postes. Il ne pilotait plus rien : aucun calcul ne
// le comparait à une date, et la frise d'échéances qu'il triait n'était plus affichée.
// Maintenant que n'importe quelle dépense peut avoir des sous-postes, le demander
// n'aurait aucun sens — « Boulangerie, le combien ? ». Idempotent.
export function migrateDropLineDay(db: Database.Database): void {
  const cols = db.prepare("PRAGMA table_info(group_lines)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "day")) return;
  db.exec(`ALTER TABLE group_lines DROP COLUMN day`);
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

// Table des notifications fermées d'une croix. Idempotent.
export function migrateDismissedNotifications(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS dismissed_notifications (
    id TEXT PRIMARY KEY,
    dismissed_at TEXT NOT NULL
  )`);
}

// Ajoute la LIGNE à la clé d'une décision de dépassement. Un récurrent n'a pas de
// budget à lui : ce sont ses lignes qui en portent un, donc c'est chaque ligne qui
// déborde, et c'est sur elle que la décision se prend. Sans line_id dans la clé,
// trancher Sosh Internet ferait taire Sosh Mobile.
//
// line_id = 0 signifie « le groupe lui-même » (une enveloppe, ou les non catégorisés) —
// même convention que group_id = 0 ailleurs dans ce schéma, et surtout PAS NULL : SQLite
// tient deux NULL pour distincts dans une contrainte d'unicité, ce qui laisserait
// s'empiler des doublons sur une même enveloppe au lieu de remplacer sa décision.
//
// Les décisions déjà prises restent au niveau du groupe (line_id = 0) : celles des
// enveloppes et des non catégorisés gardent tout leur sens. Idempotent.
export function migrateOverspendDecisionLine(db: Database.Database): void {
  const cols = db.prepare(`PRAGMA table_info(overspend_decisions)`).all() as { name: string }[];
  if (cols.some((c) => c.name === "line_id")) return;
  db.transaction(() => {
    db.exec(`
      CREATE TABLE overspend_decisions_lined (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id TEXT NOT NULL REFERENCES accounts(id),
        group_id INTEGER NOT NULL,
        line_id INTEGER NOT NULL DEFAULT 0,
        month TEXT NOT NULL,
        decision TEXT NOT NULL CHECK (decision IN ('exceptional', 'permanent')),
        decided_at TEXT NOT NULL,
        writes TEXT,
        UNIQUE(account_id, group_id, line_id, month)
      );
      INSERT INTO overspend_decisions_lined (id, account_id, group_id, line_id, month, decision, decided_at, writes)
        SELECT id, account_id, group_id, 0, month, decision, decided_at, writes FROM overspend_decisions;
      DROP TABLE overspend_decisions;
      ALTER TABLE overspend_decisions_lined RENAME TO overspend_decisions;
    `);
  })();
}

// Ajoute la PORTÉE aux montants datés : un montant vaut soit à partir de son mois
// (« ongoing »), soit pour son seul mois (« once »). Avant, la seconde sémantique
// était bricolée à l'écriture — appliquer un montant « ce mois seulement » posait EN
// PLUS une restauration de l'ancien montant au mois suivant. Cette écriture touchait
// un mois que personne n'avait demandé à changer, et se relisait ensuite comme un
// changement qu'on n'avait jamais fait. La portée dans la donnée rend cette béquille
// inutile : un montant ponctuel s'écrit une fois, dans son mois.
//
// L'unicité passe de (cible, mois) à (cible, mois, portée) : les deux portées peuvent
// coexister au même mois — relever durablement à partir de juillet ET faire une
// exception pour juillet. Sans ça, appliquer l'une effacerait silencieusement l'autre,
// et les mois suivants retomberaient sur un montant plus ancien que le bon.
//
// Tout ce qui est déjà en base devient « ongoing » : c'était la seule sémantique
// possible jusqu'ici, la reclasser autrement changerait des chiffres déjà affichés.
// Idempotent : la présence de la colonne suffit à savoir que c'est fait.
export function migrateBudgetAmountScope(db: Database.Database): void {
  const aScope = (table: string) =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === "scope");
  if (aScope("budget_amounts") && aScope("line_amounts")) return;
  db.transaction(() => {
    if (!aScope("budget_amounts")) {
      db.exec(`
        CREATE TABLE budget_amounts_scoped (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          group_id INTEGER NOT NULL,
          effective_month TEXT NOT NULL,
          amount REAL NOT NULL,
          scope TEXT NOT NULL DEFAULT 'ongoing',
          UNIQUE(group_id, effective_month, scope)
        );
        INSERT INTO budget_amounts_scoped (id, group_id, effective_month, amount, scope)
          SELECT id, group_id, effective_month, amount, 'ongoing' FROM budget_amounts;
        DROP TABLE budget_amounts;
        ALTER TABLE budget_amounts_scoped RENAME TO budget_amounts;
      `);
    }
    if (!aScope("line_amounts")) {
      db.exec(`
        CREATE TABLE line_amounts_scoped (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          line_id INTEGER NOT NULL REFERENCES group_lines(id) ON DELETE CASCADE,
          effective_month TEXT NOT NULL,
          amount REAL NOT NULL,
          scope TEXT NOT NULL DEFAULT 'ongoing',
          UNIQUE(line_id, effective_month, scope)
        );
        INSERT INTO line_amounts_scoped (id, line_id, effective_month, amount, scope)
          SELECT id, line_id, effective_month, amount, 'ongoing' FROM line_amounts;
        DROP TABLE line_amounts;
        ALTER TABLE line_amounts_scoped RENAME TO line_amounts;
      `);
    }
  })();
}

// Matérialise les montants « de base » en première entrée datée, au mois de
// départ du groupe : chaque enveloppe dans budget_amounts, chaque ligne de
// récurrent dans line_amounts. Après passage, plus aucun calcul n'a besoin de
// groups.monthly_amount ni de group_lines.amount.
//
// Idempotent, mais pas seulement par l'unicité (group_id, effective_month) /
// (line_id, effective_month) : cette migration tourne à CHAQUE démarrage
// (getDb), pas une seule fois. Si elle ne vérifiait que « pas d'entrée pile à
// ce mois-là », une ligne ou un groupe déjà repris (dont la première entrée
// datée est à un mois différent de start_month — ex. une ligne ajoutée en
// cours d'année) se ferait réinjecter à chaque redémarrage une entrée
// rétroactive à start_month, avec la valeur COURANTE de monthly_amount /
// group_lines.amount — colonnes qui ne sont plus la source de vérité mais que
// certaines actions continuent d'écrire (editGroupLine, portée « once »
// incluse). La condition est donc « ce groupe/cette ligne n'a AUCUNE entrée
// datée du tout » (WHERE NOT EXISTS), pas « pas d'entrée à ce mois précis » :
// dès qu'une entrée existe, la reprise est faite pour de bon et la migration
// n'a plus jamais rien à y faire.
export function migrateSeedDatedAmounts(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS line_amounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      line_id INTEGER NOT NULL REFERENCES group_lines(id) ON DELETE CASCADE,
      effective_month TEXT NOT NULL,
      amount REAL NOT NULL,
      UNIQUE(line_id, effective_month)
    );
  `);
  db.transaction(() => {
    db.exec(`
      INSERT OR IGNORE INTO budget_amounts (group_id, effective_month, amount)
        SELECT g.id, COALESCE(g.start_month, '2000-01'), COALESCE(g.monthly_amount, 0)
        FROM groups g
        WHERE NOT EXISTS (SELECT 1 FROM group_lines l WHERE l.group_id = g.id)
          AND NOT EXISTS (SELECT 1 FROM budget_amounts b WHERE b.group_id = g.id);
      INSERT OR IGNORE INTO line_amounts (line_id, effective_month, amount)
        SELECT l.id, COALESCE(g.start_month, '2000-01'), l.amount
        FROM group_lines l JOIN groups g ON g.id = l.group_id
        WHERE NOT EXISTS (SELECT 1 FROM line_amounts la WHERE la.line_id = l.id);
    `);
  })();
  // Un montant daté posé sur un groupe QUI A DES SOUS-POSTES est un vestige : il n'est
  // plus lu (son budget est la somme de ses sous-postes). On le signale sans y toucher ;
  // la base réelle n'en contient aucun.
  const vestiges = db
    .prepare(
      `SELECT COUNT(*) AS n FROM budget_amounts b
       WHERE EXISTS (SELECT 1 FROM group_lines l WHERE l.group_id = b.group_id)`,
    )
    .get() as { n: number };
  if (vestiges.n > 0) {
    console.warn(
      `[budgets] ${vestiges.n} montant(s) daté(s) posé(s) sur une dépense découpée sont ignorés : ` +
        `son budget est la somme de ses sous-postes. À reporter à la main sur les sous-postes concernés.`,
    );
  }
}

// Ajoute la colonne writes (trace des montants posés par une décision
// « permanent »), pour pouvoir annuler exactement. Idempotent.
export function migrateOverspendWrites(db: Database.Database): void {
  const cols = db.prepare("PRAGMA table_info(overspend_decisions)").all() as { name: string }[];
  if (cols.some((c) => c.name === "writes")) return;
  db.exec(`ALTER TABLE overspend_decisions ADD COLUMN writes TEXT`);
}

// Ajoute la colonne comment : la note libre que l'utilisateur pose sous le libellé
// d'une transaction. Une colonne à elle, et non la réutilisation de note : note
// reçoit le libellé de la saisie manuelle lors d'une fusion (mergeTransactions),
// un commentaire écrit à la main y serait écrasé sans prévenir.
//
// custom_label est l'ancien nom de cette même colonne, du temps où elle devait
// remplacer le libellé plutôt que le commenter. Renommée si on la trouve : la
// colonne est neuve et la sémantique la même (un texte libre de l'utilisateur),
// donc rien à convertir. Idempotent.
export function migrateTransactionComment(db: Database.Database): void {
  const cols = db.prepare("PRAGMA table_info(transactions)").all() as { name: string }[];
  if (cols.some((c) => c.name === "comment")) return;
  if (cols.some((c) => c.name === "custom_label")) {
    db.exec(`ALTER TABLE transactions RENAME COLUMN custom_label TO comment`);
    return;
  }
  db.exec(`ALTER TABLE transactions ADD COLUMN comment TEXT`);
}
