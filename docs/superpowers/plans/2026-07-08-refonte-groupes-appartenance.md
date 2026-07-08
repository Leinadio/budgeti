# Refonte des groupes (appartenance unique) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unifier le classement des dépenses autour de groupes typés (enveloppe / récurrents) avec mots-clés multiples, rattachement manuel, et appartenance unique d'une transaction ; retirer les catégories et règles.

**Architecture:** Le groupe porte un type et (enveloppe) un montant mensuel ; les mots-clés d'enveloppe vivent dans `group_keywords`, les récurrents gardent leurs lignes datées. La transaction porte un `group_id` de rattachement manuel. Une fonction pure `resolveOwnership` donne le groupe propriétaire (manuel > mot-clé unique > ambiguë/none), consommée par le prévisionnel et l'écran Transactions.

**Tech Stack:** Next.js (App Router, TypeScript, React), SQLite via better-sqlite3, Vitest, shadcn/ui.

## Global Constraints

- App locale mono-utilisateur, SQLite `data/budget.db`. Données bancaires jamais hors machine.
- Français sans emoji ni symbole décoratif.
- Requêtes SQL paramétrées. `foreign_keys = ON` déjà activé dans `getDb`.
- Matching mot-clé : `label.toLowerCase().includes(keyword.toLowerCase())`. Signe cohérent avec le sens : groupe `out` -> débits (`amount < 0`), `in` -> crédits (`amount > 0`). Même compte.
- Appartenance unique : une transaction appartient à au plus un groupe. Ordre : manuel (`transaction.group_id`) ; sinon groupe dont un mot-clé matche si UN seul ; sinon `ambiguous` (plusieurs) ou `none` (aucun).
- Migration idempotente dans `getDb`, sur le modèle de `migrateBudgets`. Clean slate sur les groupes ; comptes/soldes/transactions conservés.
- Composant `Table` de shadcn : pas de `TableFooter`.
- Vérification finale en lançant le vrai serveur (les DB `:memory:` ne voient pas certains bugs runtime — cf. CLAUDE.md).

---

## Ordre et découpage

1. Schéma + migration (clean slate groupes, `transactions.group_id`)
2. Repository groupes (types, mots-clés, lignes)
3. Repository transactions (`group_id`, `setTransactionGroup`)
4. Lib `ownership` (résolution d'appartenance)
5. Lib `forecast` (refonte sur l'appartenance)
6. Écran Groupes (création selon type, mots-clés, lignes)
7. Écran Transactions (menu Groupe + appartenance) + Prévisionnel/Tableau de bord
8. Retrait des catégories/règles + nettoyage

Tâches 1 à 5 additives. Les tâches 6-7 réécrivent des écrans ; la 8 retire l'ancien monde. `tsc` peut rester rouge sur des écrans consommateurs jusqu'à leur tâche (documenté par tâche).

---

### Task 1: Schéma + migration (clean slate groupes + group_id)

**Files:**
- Modify: `src/db/schema.sql`
- Modify: `src/db/migrations.ts` (ajouter `migrateGroupsV2`)
- Modify: `src/db/index.ts` (appel dans `getDb`)
- Test: `tests/db/migration.test.ts`, `tests/db/schema.test.ts`

**Interfaces:**
- Produces: colonnes `groups.kind`, `groups.monthly_amount`, table `group_keywords`, colonne `transactions.group_id` ; `migrateGroupsV2(db)`.

- [ ] **Step 1: Tests migration + schéma (rouge)**

Ajouter à `tests/db/migration.test.ts` (import `Database` déjà présent) :

```ts
import { migrateGroupsV2 } from "../../src/db/migrations";

test("migrateGroupsV2 resets groups to the new schema and adds transactions.group_id", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL, balance REAL NOT NULL DEFAULT 0);
    CREATE TABLE transactions (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, date TEXT, amount REAL, label TEXT);
    CREATE TABLE groups (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL, name TEXT NOT NULL, direction TEXT NOT NULL);
    CREATE TABLE group_lines (id INTEGER PRIMARY KEY AUTOINCREMENT, group_id INTEGER NOT NULL, name TEXT, amount REAL, day INTEGER, keyword TEXT);
    INSERT INTO groups (account_id, name, direction) VALUES ('a1', 'Vieux', 'out');
  `);
  migrateGroupsV2(db);
  const gcols = (db.prepare("PRAGMA table_info(groups)").all() as { name: string }[]).map((c) => c.name);
  expect(gcols).toContain("kind");
  expect(gcols).toContain("monthly_amount");
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((t) => t.name);
  expect(tables).toContain("group_keywords");
  const tcols = (db.prepare("PRAGMA table_info(transactions)").all() as { name: string }[]).map((c) => c.name);
  expect(tcols).toContain("group_id");
  // clean slate : l'ancien groupe a disparu
  expect(db.prepare("SELECT COUNT(*) AS n FROM groups").get()).toEqual({ n: 0 });
  // idempotent
  migrateGroupsV2(db);
  expect((db.prepare("PRAGMA table_info(transactions)").all() as { name: string }[]).filter((c) => c.name === "group_id")).toHaveLength(1);
});
```

Dans `tests/db/schema.test.ts`, ajouter `"group_keywords"` à la liste attendue :

```ts
  for (const t of ["accounts", "categories", "rules", "transactions", "budgets", "settings", "recurring_payments", "groups", "group_lines", "group_keywords"]) {
    expect(tables).toContain(t);
  }
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run tests/db/migration.test.ts tests/db/schema.test.ts`
Expected: FAIL — `migrateGroupsV2` non exporté ; `group_keywords` absente.

- [ ] **Step 3: Mettre à jour le schéma**

Dans `src/db/schema.sql` :

Table `transactions` : ajouter la colonne `group_id` après `category_id` :

```sql
  category_id INTEGER REFERENCES categories(id),
  group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL
```

Remplacer la définition de `groups` par :

```sql
CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  name TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  kind TEXT NOT NULL CHECK (kind IN ('envelope', 'recurring')),
  monthly_amount REAL
);
```

Ajouter après `group_lines` :

```sql
CREATE TABLE IF NOT EXISTS group_keywords (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL
);
```

- [ ] **Step 4: Écrire la migration**

Ajouter à la fin de `src/db/migrations.ts` :

```ts
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
```

- [ ] **Step 5: Appeler dans getDb**

Dans `src/db/index.ts`, importer et appeler après `migrateAccountCustomName(db);` :

```ts
import { migrateBudgets, migrateAccountCustomName, migrateGroupsV2 } from "./migrations";
```
```ts
  migrateGroupsV2(db);
```

- [ ] **Step 6: Vérifier le succès**

Run: `npx vitest run tests/db/migration.test.ts tests/db/schema.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/db/schema.sql src/db/migrations.ts src/db/index.ts tests/db/migration.test.ts tests/db/schema.test.ts
git commit -m "feat: schéma refonte groupes (kind, monthly_amount, group_keywords, transactions.group_id) + migration clean slate"
```

---

### Task 2: Repository groupes

**Files:**
- Modify: `src/db/repositories/groups.ts` (réécriture)
- Test: `tests/db/repositories.test.ts` (remplacer les tests groupes existants)

**Interfaces:**
- Produces:
  - `GroupLineRow = { id, name, amount, day: number, keyword }`
  - `GroupRow = { id, accountId, name, direction: "in"|"out", kind: "envelope"|"recurring", monthlyAmount: number|null, keywords: string[], lines: GroupLineRow[] }`
  - `listGroups(db): GroupRow[]`
  - `insertEnvelopeGroup(db, accountId, name, direction, monthlyAmount): number`
  - `insertRecurringGroup(db, accountId, name, direction): number`
  - `deleteGroup(db, id): void`
  - `addKeyword(db, groupId, keyword): void`
  - `insertLine(db, groupId, name, amount, day: number, keyword): void`
  - `deleteLine(db, id): void`

- [ ] **Step 1: Réécrire les tests groupes (rouge)**

Dans `tests/db/repositories.test.ts`, remplacer la ligne d'import des groupes existante :

```ts
import { listGroups, insertGroup, deleteGroup, insertLine, deleteLine, getGroupDirection } from "../../src/db/repositories/groups";
```

par :

```ts
import {
  listGroups,
  insertEnvelopeGroup,
  insertRecurringGroup,
  deleteGroup,
  addKeyword,
  insertLine,
  deleteLine,
} from "../../src/db/repositories/groups";
```

Remplacer les deux tests groupes existants (`group + lines insert, list nested, delete line` et `deleteGroup cascades to its lines`, plus tout test utilisant `insertGroup`/`getGroupDirection`) par :

```ts
test("envelope group: keywords add/list/remove", () => {
  const db = getDb(":memory:");
  upsertAccount(db, { id: "a1", name: "CIC", iban_masked: null, balance: 0, currency: "EUR", last_synced: null });
  const gid = insertEnvelopeGroup(db, "a1", "Courses", "out", 300);
  addKeyword(db, gid, "CARREFOUR");
  addKeyword(db, gid, "LECLERC");
  const g = listGroups(db)[0];
  expect(g).toMatchObject({ id: gid, accountId: "a1", name: "Courses", direction: "out", kind: "envelope", monthlyAmount: 300 });
  expect(g.keywords.sort()).toEqual(["CARREFOUR", "LECLERC"]);
  expect(g.lines).toEqual([]);
  // la suppression d'un groupe emporte ses mots-clés (cascade)
  deleteGroup(db, gid);
  expect(db.prepare("SELECT COUNT(*) AS n FROM group_keywords").get()).toEqual({ n: 0 });
});

test("recurring group: dated lines summed, delete cascades", () => {
  const db = getDb(":memory:");
  upsertAccount(db, { id: "a1", name: "CIC", iban_masked: null, balance: 0, currency: "EUR", last_synced: null });
  const gid = insertRecurringGroup(db, "a1", "Abonnements", "out");
  insertLine(db, gid, "Spotify", 10, 3, "SPOTIFY");
  insertLine(db, gid, "Netflix", 15, 8, "NETFLIX");
  const g = listGroups(db)[0];
  expect(g).toMatchObject({ id: gid, name: "Abonnements", kind: "recurring", monthlyAmount: null });
  expect(g.keywords).toEqual([]);
  expect(g.lines.map((l) => [l.name, l.amount, l.day, l.keyword])).toEqual([
    ["Spotify", 10, 3, "SPOTIFY"],
    ["Netflix", 15, 8, "NETFLIX"],
  ]);
  deleteGroup(db, gid);
  expect(listGroups(db)).toHaveLength(0);
  expect(db.prepare("SELECT COUNT(*) AS n FROM group_lines").get()).toEqual({ n: 0 });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run tests/db/repositories.test.ts`
Expected: FAIL — fonctions non exportées.

- [ ] **Step 3: Réécrire le repository**

Remplacer intégralement `src/db/repositories/groups.ts` par :

```ts
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
  db.prepare(`INSERT INTO group_keywords (group_id, keyword) VALUES (?, ?)`).run(groupId, keyword);
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
```

- [ ] **Step 4: Vérifier le succès**

Run: `npx vitest run tests/db/repositories.test.ts`
Expected: PASS.

Note : `src/app/groupes/*` et `src/app/previsionnel/*` consomment encore l'ancien repo et ne compilent pas jusqu'aux tâches 6-7. C'est attendu.

- [ ] **Step 5: Commit**

```bash
git add src/db/repositories/groups.ts tests/db/repositories.test.ts
git commit -m "feat: repository groupes typés (enveloppe/récurrents, mots-clés)"
```

---

### Task 3: Repository transactions (group_id + setTransactionGroup)

**Files:**
- Modify: `src/db/repositories/transactions.ts`
- Test: `tests/db/repositories.test.ts` (ajouts)

**Interfaces:**
- Produces :
  - `TxnView` gagne `groupId: number | null` et perd `category`.
  - `setTransactionGroup(db, id: string, groupId: number | null): void`.

- [ ] **Step 1: Écrire le test (rouge)**

Ajouter à `tests/db/repositories.test.ts` (import : ajouter `setTransactionGroup` à l'import transactions existant `import { upsertTransaction, listTransactions } from "../../src/db/repositories/transactions";`) :

```ts
test("setTransactionGroup attaches and detaches", () => {
  const db = getDb(":memory:");
  upsertAccount(db, { id: "a1", name: "CIC", iban_masked: null, balance: 0, currency: "EUR", last_synced: null });
  const gid = insertEnvelopeGroup(db, "a1", "Courses", "out", 300);
  upsertTransaction(db, { id: "t1", account_id: "a1", date: "2026-07-01", amount: -30, label: "X", category_id: null });
  setTransactionGroup(db, "t1", gid);
  expect(listTransactions(db)[0].groupId).toBe(gid);
  setTransactionGroup(db, "t1", null);
  expect(listTransactions(db)[0].groupId).toBeNull();
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run tests/db/repositories.test.ts`
Expected: FAIL — `setTransactionGroup` non exporté ; `groupId` absent de `TxnView`.

- [ ] **Step 3: Mettre à jour le repository**

Dans `src/db/repositories/transactions.ts` :

Modifier `TxnView` : retirer `category`, ajouter `groupId` :

```ts
export type TxnView = {
  date: string;
  amount: number;
  label: string;
  id: string;
  accountId: string;
  accountLabel: string;
  groupId: number | null;
};
```

Dans `listTransactions`, remplacer la requête `SELECT` (retirer le join catégorie, ajouter `group_id`) :

```ts
  let sql =
    `SELECT t.id, t.date, t.amount, t.label, t.group_id AS groupId,
            t.account_id AS accountId,
            COALESCE(COALESCE(a.custom_name, a.name) || ' ' || a.iban_masked, COALESCE(a.custom_name, a.name)) AS accountLabel
     FROM transactions t
     LEFT JOIN accounts a ON a.id = t.account_id`;
```

Retirer le filtre `category` (le paramètre `filter.category` et la clause associée) — ne garder que `filter.month` :

```ts
export function listTransactions(
  db: Database.Database,
  filter?: { month?: string },
): TxnView[] {
  let sql = `...`; // (ci-dessus)
  const clauses: string[] = [];
  const params: Record<string, string | number> = {};
  if (filter?.month) {
    clauses.push("substr(t.date,1,7) = @month");
    params.month = filter.month;
  }
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  sql += " ORDER BY t.date DESC";
  const stmt = db.prepare(sql);
  return (clauses.length ? stmt.all(params) : stmt.all()) as TxnView[];
}
```

Retirer `setTransactionCategory` et `uncategorized` (dépendent de `category_id`, plus utilisés). Ajouter :

```ts
export function setTransactionGroup(db: Database.Database, id: string, groupId: number | null): void {
  db.prepare("UPDATE transactions SET group_id = ? WHERE id = ?").run(groupId, id);
}
```

`upsertTransaction` et `TxnRow` restent inchangés (le `INSERT` liste ses colonnes explicitement, `group_id` reste NULL par défaut).

- [ ] **Step 4: Vérifier le succès**

Run: `npx vitest run tests/db/repositories.test.ts`
Expected: PASS. (Les tests d'autres fichiers consommant `category` peuvent rester rouges jusqu'aux tâches suivantes ; ce fichier passe.)

- [ ] **Step 5: Commit**

```bash
git add src/db/repositories/transactions.ts tests/db/repositories.test.ts
git commit -m "feat: transactions.group_id + setTransactionGroup, retrait du join catégorie"
```

---

### Task 4: Lib ownership (résolution d'appartenance)

**Files:**
- Create: `src/lib/ownership.ts`
- Test: `tests/lib/ownership.test.ts`

**Interfaces:**
- Produces :
  - `OwnableGroup = { id, accountId, direction: "in"|"out", kind: "envelope"|"recurring", keywords: string[] }`
  - `OwnedTxn = { id, date, amount, label, accountId, groupId: number|null }`
  - `Ownership = { status: "manual"|"auto", groupId } | { status: "ambiguous" } | { status: "none" }`
  - `resolveOwnership(txn: OwnedTxn, groups: OwnableGroup[]): Ownership`

- [ ] **Step 1: Écrire les tests (rouge)**

Créer `tests/lib/ownership.test.ts` :

```ts
import { expect, test } from "vitest";
import { resolveOwnership, type OwnableGroup, type OwnedTxn } from "../../src/lib/ownership";

const courses: OwnableGroup = { id: 1, accountId: "a1", direction: "out", kind: "envelope", keywords: ["CARREFOUR", "LECLERC"] };
const abo: OwnableGroup = { id: 2, accountId: "a1", direction: "out", kind: "recurring", keywords: ["SPOTIFY"] };
const salaire: OwnableGroup = { id: 3, accountId: "a1", direction: "in", kind: "recurring", keywords: ["REMU"] };
const groups = [courses, abo, salaire];

function txn(p: Partial<OwnedTxn>): OwnedTxn {
  return { id: "t", date: "2026-07-01", amount: -10, label: "", accountId: "a1", groupId: null, ...p };
}

test("manual attachment wins", () => {
  expect(resolveOwnership(txn({ groupId: 2, label: "CARREFOUR" }), groups)).toEqual({ status: "manual", groupId: 2 });
});

test("single keyword match -> auto", () => {
  expect(resolveOwnership(txn({ label: "PAIEMENT CARREFOUR CITY" }), groups)).toEqual({ status: "auto", groupId: 1 });
});

test("multiple matches -> ambiguous", () => {
  const dup: OwnableGroup = { id: 4, accountId: "a1", direction: "out", kind: "envelope", keywords: ["CARREFOUR"] };
  expect(resolveOwnership(txn({ label: "CARREFOUR" }), [...groups, dup])).toEqual({ status: "ambiguous" });
});

test("no match -> none", () => {
  expect(resolveOwnership(txn({ label: "BOULANGERIE" }), groups)).toEqual({ status: "none" });
});

test("sign must match direction", () => {
  // crédit ne matche pas une enveloppe out
  expect(resolveOwnership(txn({ amount: 10, label: "CARREFOUR" }), groups)).toEqual({ status: "none" });
  // crédit matche un groupe in
  expect(resolveOwnership(txn({ amount: 2000, label: "VIR REMU" }), groups)).toEqual({ status: "auto", groupId: 3 });
});

test("other account is ignored", () => {
  expect(resolveOwnership(txn({ accountId: "a2", label: "CARREFOUR" }), groups)).toEqual({ status: "none" });
});

test("manual to a group of another account falls through to keyword", () => {
  const other: OwnableGroup = { id: 9, accountId: "a2", direction: "out", kind: "envelope", keywords: [] };
  expect(resolveOwnership(txn({ groupId: 9, label: "CARREFOUR" }), [...groups, other])).toEqual({ status: "auto", groupId: 1 });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run tests/lib/ownership.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter**

Créer `src/lib/ownership.ts` :

```ts
export type Direction = "in" | "out";

export type OwnableGroup = {
  id: number;
  accountId: string;
  direction: Direction;
  kind: "envelope" | "recurring";
  keywords: string[];
};

export type OwnedTxn = {
  id: string;
  date: string;
  amount: number;
  label: string;
  accountId: string;
  groupId: number | null;
};

export type Ownership =
  | { status: "manual"; groupId: number }
  | { status: "auto"; groupId: number }
  | { status: "ambiguous" }
  | { status: "none" };

export function resolveOwnership(txn: OwnedTxn, groups: OwnableGroup[]): Ownership {
  if (txn.groupId !== null) {
    const g = groups.find((x) => x.id === txn.groupId && x.accountId === txn.accountId);
    if (g) return { status: "manual", groupId: g.id };
  }
  const label = txn.label.toLowerCase();
  const matches = groups.filter((g) => {
    if (g.accountId !== txn.accountId) return false;
    const signOk = g.direction === "out" ? txn.amount < 0 : txn.amount > 0;
    if (!signOk) return false;
    return g.keywords.some((k) => label.includes(k.toLowerCase()));
  });
  if (matches.length === 1) return { status: "auto", groupId: matches[0].id };
  if (matches.length > 1) return { status: "ambiguous" };
  return { status: "none" };
}
```

- [ ] **Step 4: Vérifier le succès**

Run: `npx vitest run tests/lib/ownership.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ownership.ts tests/lib/ownership.test.ts
git commit -m "feat: lib ownership (résolution d'appartenance unique)"
```

---

### Task 5: Lib forecast (refonte sur l'appartenance)

**Files:**
- Modify: `src/lib/forecast.ts` (réécriture)
- Test: `tests/lib/forecast.test.ts` (réécriture)

**Interfaces:**
- Consumes: `resolveOwnership`, `OwnableGroup`, `OwnedTxn` (Task 4) ; `monthKey`.
- Produces:
  - `Group = { id, accountId, name, direction, kind: "envelope"|"recurring", monthlyAmount: number|null, keywords: string[], lines: {id,name,amount,day:number,keyword}[] }`
  - `Txn = { id, date, amount, label, accountId, groupId: number|null }`
  - `computeForecast(accountId, balance, groups: Group[], txns: Txn[], month): AccountForecast` (types `TimelineItem`, `GroupView`, `AccountForecast` conservés)

- [ ] **Step 1: Réécrire les tests (rouge)**

Remplacer intégralement `tests/lib/forecast.test.ts` par :

```ts
import { expect, test } from "vitest";
import { computeForecast, type Group, type Txn } from "../../src/lib/forecast";

const courses: Group = {
  id: 1, accountId: "a1", name: "Courses", direction: "out", kind: "envelope",
  monthlyAmount: 300, keywords: ["CARREFOUR", "LECLERC"], lines: [],
};
const abo: Group = {
  id: 2, accountId: "a1", name: "Abonnements", direction: "out", kind: "recurring",
  monthlyAmount: null, keywords: [],
  lines: [
    { id: 11, name: "Spotify", amount: 10, day: 3, keyword: "SPOTIFY" },
    { id: 12, name: "Netflix", amount: 15, day: 8, keyword: "NETFLIX" },
  ],
};
const salaire: Group = {
  id: 3, accountId: "a1", name: "Salaire", direction: "in", kind: "recurring",
  monthlyAmount: null, keywords: [],
  lines: [{ id: 31, name: "Rémunération", amount: 2000, day: 1, keyword: "REMU" }],
};

function tx(p: Partial<Txn>): Txn {
  return { id: "t", date: "2026-07-05", amount: -10, label: "", accountId: "a1", groupId: null, ...p };
}

test("envelope: spent via ownership, remaining floored, subtracted from current", () => {
  const txns = [tx({ id: "t1", amount: -120, label: "CARREFOUR CITY" }), tx({ id: "t2", amount: -30, label: "LECLERC" })];
  const f = computeForecast("a1", 1000, [courses], txns, "2026-07");
  // dépensé 150 / 300 -> reste 150
  expect(f.currentEstimate).toBe(850);
  const gv = f.groups.find((g) => g.id === 1)!;
  expect(gv.total).toBe(300);
  expect(gv.spent).toBe(150);
});

test("envelope overspend floored at 0", () => {
  const txns = [tx({ id: "t1", amount: -450, label: "CARREFOUR" })];
  const f = computeForecast("a1", 1000, [courses], txns, "2026-07");
  expect(f.currentEstimate).toBe(1000);
  expect(f.groups[0].spent).toBe(300);
});

test("recurring line unseen subtracted; seen ignored; timeline sorted", () => {
  const txns = [tx({ id: "t1", amount: -10, label: "PRLV SPOTIFY" })]; // Spotify vue
  const f = computeForecast("a1", 1000, [abo], txns, "2026-07");
  // Spotify vue -> ignorée ; Netflix non vue -> -15
  expect(f.currentEstimate).toBe(985);
  expect(f.timeline.map((i) => [i.day, i.name, i.seen])).toEqual([[3, "Spotify", true], [8, "Netflix", false]]);
});

test("recurring in-line added when unseen", () => {
  const f = computeForecast("a1", 500, [salaire], [], "2026-07");
  expect(f.currentEstimate).toBe(2500);
});

test("ambiguous transaction counts in no group", () => {
  const dup: Group = { ...courses, id: 4, name: "Courses2", keywords: ["CARREFOUR"] };
  const txns = [tx({ id: "t1", amount: -50, label: "CARREFOUR" })];
  const f = computeForecast("a1", 1000, [courses, dup], txns, "2026-07");
  // ambiguë -> non comptée : les deux enveloppes gardent reste plein (300 chacune)
  expect(f.currentEstimate).toBe(1000 - 300 - 300);
  expect(f.groups.find((g) => g.id === 1)!.spent).toBe(0);
});

test("manual attachment overrides keyword", () => {
  // "CARREFOUR" matcherait Courses, mais rattaché manuellement à l'enveloppe id 5
  const autre: Group = { id: 5, accountId: "a1", name: "Autre", direction: "out", kind: "envelope", monthlyAmount: 100, keywords: [], lines: [] };
  const txns = [tx({ id: "t1", amount: -40, label: "CARREFOUR", groupId: 5 })];
  const f = computeForecast("a1", 1000, [courses, autre], txns, "2026-07");
  expect(f.groups.find((g) => g.id === 5)!.spent).toBe(40); // compte dans Autre
  expect(f.groups.find((g) => g.id === 1)!.spent).toBe(0);  // pas dans Courses
});

test("next month starts from current estimate and applies full amounts", () => {
  const f = computeForecast("a1", 1000, [courses, abo, salaire], [], "2026-07");
  // courant : -300 (courses reste plein) -10 -15 (abo) +2000 (salaire) = 2675
  expect(f.currentEstimate).toBe(2675);
  // suivant : 2675 + (2000 - 10 - 15 - 300) = 4350
  expect(f.nextEstimate).toBe(4350);
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run tests/lib/forecast.test.ts`
Expected: FAIL — nouvelle signature/types.

- [ ] **Step 3: Réécrire la lib**

Remplacer intégralement `src/lib/forecast.ts` par :

```ts
import { monthKey } from "./money";
import { resolveOwnership, type OwnableGroup, type OwnedTxn } from "./ownership";

export type Direction = "in" | "out";

export type GroupLine = {
  id: number;
  name: string;
  amount: number;
  day: number;
  keyword: string;
};

export type Group = {
  id: number;
  accountId: string;
  name: string;
  direction: Direction;
  kind: "envelope" | "recurring";
  monthlyAmount: number | null;
  keywords: string[];
  lines: GroupLine[];
};

export type Txn = {
  id: string;
  date: string;
  amount: number;
  label: string;
  accountId: string;
  groupId: number | null;
};

export type TimelineItem = { day: number; name: string; amount: number; seen: boolean };

export type GroupView = {
  id: number;
  name: string;
  direction: Direction;
  total: number;
  spent: number;
};

export type AccountForecast = {
  accountId: string;
  balance: number;
  currentEstimate: number;
  nextEstimate: number;
  timeline: TimelineItem[];
  groups: GroupView[];
};

function toOwnable(g: Group): OwnableGroup {
  return {
    id: g.id,
    accountId: g.accountId,
    direction: g.direction,
    kind: g.kind,
    keywords: g.kind === "envelope" ? g.keywords : g.lines.map((l) => l.keyword),
  };
}

export function computeForecast(
  accountId: string,
  balance: number,
  groups: Group[],
  txns: Txn[],
  month: string,
): AccountForecast {
  const ownable = groups.map(toOwnable);
  // Transactions du mois de ce compte, avec leur groupe propriétaire résolu.
  const owned = txns
    .filter((t) => t.accountId === accountId && monthKey(t.date) === month)
    .map((t) => {
      const o: OwnedTxn = { id: t.id, date: t.date, amount: t.amount, label: t.label, accountId: t.accountId, groupId: t.groupId };
      const res = resolveOwnership(o, ownable);
      const ownerId = res.status === "manual" || res.status === "auto" ? res.groupId : null;
      return { t, ownerId };
    });

  const ownedBy = (gid: number) => owned.filter((o) => o.ownerId === gid).map((o) => o.t);

  let current = balance;
  let nextDelta = 0;
  const timeline: TimelineItem[] = [];
  const groupViews: GroupView[] = [];

  for (const g of groups) {
    const sign = g.direction === "in" ? 1 : -1;

    if (g.kind === "envelope") {
      const amount = g.monthlyAmount ?? 0;
      const spent = ownedBy(g.id).reduce((s, t) => s + Math.abs(t.amount), 0);
      const remaining = Math.max(0, amount - spent);
      current -= remaining;
      nextDelta -= amount;
      groupViews.push({ id: g.id, name: g.name, direction: g.direction, total: amount, spent: Math.min(spent, amount) });
    } else {
      const mine = ownedBy(g.id);
      let total = 0;
      let seenSum = 0;
      for (const line of g.lines) {
        total += line.amount;
        nextDelta += sign * line.amount;
        const kw = line.keyword.toLowerCase();
        const seen = mine.some((t) => t.label.toLowerCase().includes(kw));
        if (!seen) current += sign * line.amount;
        if (seen) seenSum += line.amount;
        timeline.push({ day: line.day, name: line.name, amount: sign * line.amount, seen });
      }
      groupViews.push({ id: g.id, name: g.name, direction: g.direction, total, spent: seenSum });
    }
  }

  timeline.sort((a, b) => a.day - b.day);
  return { accountId, balance, currentEstimate: current, nextEstimate: current + nextDelta, timeline, groups: groupViews };
}
```

- [ ] **Step 4: Vérifier le succès**

Run: `npx vitest run tests/lib/forecast.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/forecast.ts tests/lib/forecast.test.ts
git commit -m "feat: forecast refondu sur l'appartenance (enveloppes + récurrents)"
```

---

### Task 6: Écran Groupes (création selon type, mots-clés, lignes)

**Files:**
- Modify: `src/app/groupes/actions.ts` (réécriture)
- Modify: `src/app/groupes/page.tsx` (réécriture)

**Interfaces:**
- Consumes: `listGroups`, `insertEnvelopeGroup`, `insertRecurringGroup`, `deleteGroup`, `addKeyword`, `removeKeyword`, `insertLine`, `deleteLine` (Task 2) ; `listAccounts`, `accountDisplayName`, `formatEur`.

- [ ] **Step 1: Réécrire les actions**

Remplacer `src/app/groupes/actions.ts` par :

```ts
"use server";
import { db } from "../../db/index";
import {
  insertEnvelopeGroup,
  insertRecurringGroup,
  deleteGroup,
  addKeyword,
  insertLine,
  deleteLine,
} from "../../db/repositories/groups";
import { revalidatePath } from "next/cache";

function refresh() {
  revalidatePath("/groupes");
  revalidatePath("/previsionnel");
  revalidatePath("/transactions");
  revalidatePath("/");
}

export async function addGroup(formData: FormData) {
  const accountId = String(formData.get("accountId") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const direction = String(formData.get("direction") ?? "");
  const kind = String(formData.get("kind") ?? "");
  if (!accountId || !name || (direction !== "in" && direction !== "out")) return;
  if (kind === "envelope") {
    const parsed = Number.parseFloat(String(formData.get("monthlyAmount")));
    insertEnvelopeGroup(db(), accountId, name, direction, Number.isFinite(parsed) ? Math.abs(parsed) : 0);
  } else if (kind === "recurring") {
    insertRecurringGroup(db(), accountId, name, direction);
  } else {
    return;
  }
  refresh();
}

export async function removeGroup(formData: FormData) {
  const id = Number.parseInt(String(formData.get("id")), 10);
  if (Number.isFinite(id)) deleteGroup(db(), id);
  refresh();
}

export async function addGroupKeyword(formData: FormData) {
  const groupId = Number.parseInt(String(formData.get("groupId")), 10);
  const keyword = String(formData.get("keyword") ?? "").trim();
  if (Number.isFinite(groupId) && keyword) addKeyword(db(), groupId, keyword);
  refresh();
}

export async function addLine(formData: FormData) {
  const groupId = Number.parseInt(String(formData.get("groupId")), 10);
  if (!Number.isFinite(groupId)) return;
  const name = String(formData.get("name") ?? "").trim();
  const keyword = String(formData.get("keyword") ?? "").trim();
  if (!name || !keyword) return;
  const parsed = Number.parseFloat(String(formData.get("amount")));
  const amount = Number.isFinite(parsed) ? Math.abs(parsed) : 0;
  const dayParsed = Number.parseInt(String(formData.get("day")), 10);
  if (!Number.isFinite(dayParsed) || dayParsed < 1 || dayParsed > 31) return;
  insertLine(db(), groupId, name, amount, dayParsed, keyword);
  refresh();
}

export async function removeLine(formData: FormData) {
  const id = Number.parseInt(String(formData.get("id")), 10);
  if (Number.isFinite(id)) deleteLine(db(), id);
  refresh();
}
```

Note : un groupe récurrents exige un jour (1..31) par ligne — c'est le sens même du type. Les enveloppes n'ont pas de lignes datées.

- [ ] **Step 2: Réécrire la page**

Remplacer `src/app/groupes/page.tsx` par :

```tsx
import { db } from "../../db/index";
import { listGroups } from "../../db/repositories/groups";
import { listAccounts } from "../../db/repositories/accounts";
import { accountDisplayName } from "../../lib/account";
import { formatEur } from "../../lib/money";
import {
  addGroup, removeGroup, addGroupKeyword, addLine, removeLine,
} from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export const dynamic = "force-dynamic";

const selectClass = "border-input bg-background h-9 rounded-md border px-3 text-sm";

export default function GroupesPage() {
  const database = db();
  const accounts = listAccounts(database);
  const groups = listGroups(database);
  const accountName = (id: string) => {
    const a = accounts.find((acc) => acc.id === id);
    return a ? accountDisplayName(a) : id;
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Nouveau groupe</CardTitle>
        </CardHeader>
        <CardContent>
          {accounts.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Aucun compte. Synchronise d&apos;abord dans Réglages.
            </p>
          ) : (
            <form action={addGroup} className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="grp-name" className="font-normal">Nom</Label>
                <Input id="grp-name" name="name" placeholder="Ex: Courses" required />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="grp-account" className="font-normal">Compte</Label>
                <select id="grp-account" name="accountId" className={selectClass}>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{accountDisplayName(a)}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="grp-kind" className="font-normal">Type</Label>
                <select id="grp-kind" name="kind" className={selectClass}>
                  <option value="envelope">Enveloppe</option>
                  <option value="recurring">Récurrents</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="grp-direction" className="font-normal">Sens</Label>
                <select id="grp-direction" name="direction" className={selectClass}>
                  <option value="out">Sortie</option>
                  <option value="in">Entrée</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="grp-amount" className="font-normal">Montant € (enveloppe)</Label>
                <Input id="grp-amount" type="number" name="monthlyAmount" step="0.01" placeholder="0.00" className="max-w-32" />
              </div>
              <Button type="submit" size="sm">Ajouter</Button>
            </form>
          )}
        </CardContent>
      </Card>

      {groups.length === 0 && (
        <Card>
          <CardContent>
            <p className="text-muted-foreground text-sm">Aucun groupe défini.</p>
          </CardContent>
        </Card>
      )}

      {groups.map((g) => {
        const total = g.kind === "envelope" ? (g.monthlyAmount ?? 0) : g.lines.reduce((s, l) => s + l.amount, 0);
        return (
          <Card key={g.id}>
            <CardHeader className="flex-row items-baseline justify-between">
              <CardTitle>
                {g.name}{" "}
                <span className="text-muted-foreground text-sm font-normal">
                  {accountName(g.accountId)} · {g.direction === "in" ? "Entrée" : "Sortie"} · {g.kind === "envelope" ? "Enveloppe" : "Récurrents"}
                </span>
              </CardTitle>
              <span className="flex items-center gap-2">
                <span className="text-sm font-medium">{formatEur(total)}</span>
                <form action={removeGroup}>
                  <input type="hidden" name="id" value={g.id} />
                  <Button type="submit" size="sm" variant="ghost">Supprimer</Button>
                </form>
              </span>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {g.kind === "envelope" ? (
                <>
                  <div className="flex flex-wrap gap-2">
                    {g.keywords.length === 0 && (
                      <span className="text-muted-foreground text-sm">Aucun mot-clé.</span>
                    )}
                    {g.keywords.map((kw) => (
                      <span key={kw} className="text-sm">{kw}</span>
                    ))}
                  </div>
                  <form action={addGroupKeyword} className="flex items-end gap-2">
                    <input type="hidden" name="groupId" value={g.id} />
                    <div className="flex flex-col gap-1">
                      <Label className="font-normal">Mot-clé</Label>
                      <Input name="keyword" placeholder="Ex: CARREFOUR" required className="max-w-40" />
                    </div>
                    <Button type="submit" size="sm" variant="secondary">Ajouter le mot-clé</Button>
                  </form>
                </>
              ) : (
                <>
                  {g.lines.map((l) => (
                    <div key={l.id} className="flex items-center justify-between text-sm">
                      <span>
                        {l.name}
                        <span className="text-muted-foreground"> · {l.keyword} · le {l.day}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <span>{formatEur(l.amount)}</span>
                        <form action={removeLine}>
                          <input type="hidden" name="id" value={l.id} />
                          <Button type="submit" size="sm" variant="ghost">×</Button>
                        </form>
                      </span>
                    </div>
                  ))}
                  <form action={addLine} className="flex flex-wrap items-end gap-2 pt-2">
                    <input type="hidden" name="groupId" value={g.id} />
                    <div className="flex flex-col gap-1">
                      <Label className="font-normal">Nom</Label>
                      <Input name="name" placeholder="Ex: Spotify" required className="max-w-40" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label className="font-normal">Montant €</Label>
                      <Input type="number" name="amount" step="0.01" placeholder="0.00" className="max-w-28" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label className="font-normal">Jour</Label>
                      <Input type="number" name="day" min="1" max="31" placeholder="1-31" className="max-w-24" required />
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label className="font-normal">Mot-clé</Label>
                      <Input name="keyword" placeholder="Ex: SPOTIFY" required className="max-w-40" />
                    </div>
                    <Button type="submit" size="sm" variant="secondary">Ajouter la ligne</Button>
                  </form>
                </>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
```

Note : les mots-clés d'une enveloppe s'ajoutent via le formulaire ; ils sont listés en lecture seule. La suppression d'un mot-clé isolé est hors périmètre (pour corriger, supprimer et recréer le groupe). La suppression du groupe emporte ses mots-clés et lignes en cascade.

- [ ] **Step 3: Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: erreurs UNIQUEMENT dans `src/app/transactions/*` et `src/app/page.tsx`/`src/app/previsionnel/page.tsx` (consommateurs pas encore adaptés). Aucune erreur dans `src/app/groupes/*`.

- [ ] **Step 4: Commit**

```bash
git add src/app/groupes/
git commit -m "feat: écran Groupes typé (enveloppe: mots-clés ; récurrents: lignes datées)"
```

---

### Task 7: Écran Transactions (menu Groupe + appartenance) + Prévisionnel/Tableau de bord

**Files:**
- Create: `src/components/group-select-field.tsx`
- Modify: `src/app/transactions/actions.ts` (réécriture)
- Modify: `src/app/transactions/page.tsx` (réécriture)
- Modify: `src/app/previsionnel/page.tsx`
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `listGroups` (Task 2), `listTransactions`/`setTransactionGroup` (Task 3), `resolveOwnership`/`OwnableGroup` (Task 4), `computeForecast` (Task 5), `listAccounts`, `accountLabel`, `formatEur`, `monthKey`.

- [ ] **Step 1: Composant de sélection de groupe**

Créer `src/components/group-select-field.tsx` (client, auto-submit du formulaire parent au changement) :

```tsx
"use client";

type Opt = { id: number; name: string };

export function GroupSelectField({
  name, options, defaultValue,
}: { name: string; options: Opt[]; defaultValue: number | null }) {
  return (
    <select
      name={name}
      defaultValue={defaultValue === null ? "" : String(defaultValue)}
      className="border-input bg-background h-9 rounded-md border px-3 text-sm"
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
    >
      <option value="">Automatique</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>{o.name}</option>
      ))}
    </select>
  );
}
```

- [ ] **Step 2: Réécrire l'action Transactions**

Remplacer `src/app/transactions/actions.ts` par :

```ts
"use server";
import { db } from "../../db/index";
import { setTransactionGroup } from "../../db/repositories/transactions";
import { revalidatePath } from "next/cache";

export async function setGroup(formData: FormData) {
  const txnId = String(formData.get("txnId"));
  const raw = String(formData.get("group") ?? "");
  const groupId = raw === "" ? null : Number.parseInt(raw, 10);
  setTransactionGroup(db(), txnId, groupId !== null && Number.isFinite(groupId) ? groupId : null);
  revalidatePath("/transactions");
  revalidatePath("/previsionnel");
  revalidatePath("/");
}
```

- [ ] **Step 3: Réécrire la page Transactions**

Remplacer `src/app/transactions/page.tsx` par :

```tsx
import { db } from "../../db/index";
import { listTransactions, type TxnView } from "../../db/repositories/transactions";
import { listGroups } from "../../db/repositories/groups";
import { resolveOwnership, type OwnableGroup } from "../../lib/ownership";
import { formatEur } from "../../lib/money";
import { setGroup } from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { GroupSelectField } from "@/components/group-select-field";

export const dynamic = "force-dynamic";

export default function TransactionsPage() {
  const database = db();
  const txns = listTransactions(database);
  const groups = listGroups(database);
  const ownable: OwnableGroup[] = groups.map((g) => ({
    id: g.id, accountId: g.accountId, direction: g.direction, kind: g.kind,
    keywords: g.kind === "envelope" ? g.keywords : g.lines.map((l) => l.keyword),
  }));
  const groupName = (id: number) => groups.find((g) => g.id === id)?.name ?? "?";

  const statusLabel = (t: TxnView): string => {
    const res = resolveOwnership(
      { id: t.id, date: t.date, amount: t.amount, label: t.label, accountId: t.accountId, groupId: t.groupId },
      ownable,
    );
    if (res.status === "manual") return `${groupName(res.groupId)} (manuel)`;
    if (res.status === "auto") return `${groupName(res.groupId)} (auto)`;
    if (res.status === "ambiguous") return "à répartir";
    return "non budgétée";
  };

  const groupsOfAccount = (accountId: string) =>
    groups.filter((g) => g.accountId === accountId).map((g) => ({ id: g.id, name: g.name }));

  const byAccount = new Map<string, { label: string; items: TxnView[] }>();
  for (const t of txns) {
    const g = byAccount.get(t.accountId) ?? { label: t.accountLabel ?? "Compte", items: [] };
    g.items.push(t);
    byAccount.set(t.accountId, g);
  }

  return (
    <div className="flex flex-col gap-4">
      {byAccount.size === 0 && (
        <Card>
          <CardContent>
            <p className="text-muted-foreground text-sm">Aucune transaction. Va dans Réglages pour synchroniser.</p>
          </CardContent>
        </Card>
      )}
      {[...byAccount.entries()].map(([accountId, group]) => (
        <Card key={accountId}>
          <CardHeader>
            <CardTitle>{group.label}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Libellé</TableHead>
                  <TableHead>Groupe</TableHead>
                  <TableHead>Appartenance</TableHead>
                  <TableHead className="text-right">Montant</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.items.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="text-muted-foreground">{t.date}</TableCell>
                    <TableCell>{t.label}</TableCell>
                    <TableCell>
                      <form action={setGroup}>
                        <input type="hidden" name="txnId" value={t.id} />
                        <GroupSelectField name="group" options={groupsOfAccount(t.accountId)} defaultValue={t.groupId} />
                      </form>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{statusLabel(t)}</TableCell>
                    <TableCell className="text-right font-medium">{formatEur(t.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Adapter le Prévisionnel**

Dans `src/app/previsionnel/page.tsx`, remplacer la construction de `allTxns` pour inclure `id` et `groupId` (le nouveau `Txn` de forecast) :

```tsx
  const allTxns: Txn[] = listTransactions(database).map((t) => ({
    id: t.id,
    date: t.date,
    amount: t.amount,
    label: t.label,
    accountId: t.accountId,
    groupId: t.groupId,
  }));
```

Le reste (mapping `allGroups.filter(...) as Group[]`, appel `computeForecast`) reste valide car `GroupRow` est structurellement compatible avec le nouveau `Group` (mêmes champs `id, accountId, name, direction, kind, monthlyAmount, keywords, lines`).

- [ ] **Step 5: Adapter le Tableau de bord**

Dans `src/app/page.tsx`, la table des dernières transactions par compte affiche une colonne « catégorie ». La remplacer par le libellé de groupe résolu. En tête du composant, après `const allTxns = listTransactions(database);`, ajouter :

```tsx
  const groups = listGroups(database);
  const ownable = groups.map((g) => ({
    id: g.id, accountId: g.accountId, direction: g.direction, kind: g.kind,
    keywords: g.kind === "envelope" ? g.keywords : g.lines.map((l) => l.keyword),
  }));
  const groupCell = (t: (typeof allTxns)[number]) => {
    const res = resolveOwnership(
      { id: t.id, date: t.date, amount: t.amount, label: t.label, accountId: t.accountId, groupId: t.groupId },
      ownable,
    );
    if (res.status === "manual" || res.status === "auto") return groups.find((g) => g.id === res.groupId)?.name ?? "";
    if (res.status === "ambiguous") return "à répartir";
    return "";
  };
```

Ajouter les imports en tête de `src/app/page.tsx` :

```ts
import { listGroups } from "../db/repositories/groups";
import { resolveOwnership } from "../lib/ownership";
```

Dans la cellule qui affichait `{t.category ?? "À catégoriser"}`, mettre `{groupCell(t)}`.

- [ ] **Step 6: Vérifier compilation et suite complète**

Run: `npx tsc --noEmit && npm test`
Expected: aucune erreur ; tous les tests passent. (Si `tsc` signale encore l'ancien `CategorySelectField`/`RuleCheckboxField` ou `categories`, ce sera nettoyé en Task 8 ; à ce stade la page Transactions ne les référence plus.)

- [ ] **Step 7: Commit**

```bash
git add src/components/group-select-field.tsx src/app/transactions/ src/app/previsionnel/page.tsx src/app/page.tsx
git commit -m "feat: Transactions rattachées aux groupes + appartenance affichée ; prévisionnel/dashboard adaptés"
```

---

### Task 8: Retrait des catégories/règles + nettoyage

**Files:**
- Delete: `src/app/categories/` (page + éventuel actions), `src/components/category-select-field.tsx`, `src/components/rule-checkbox-field.tsx`, `src/db/repositories/categories.ts`, `src/db/repositories/rules.ts`
- Modify: `src/app/layout.tsx` (retirer le lien Catégories)
- Modify: tests référençant categories/rules

**Interfaces:**
- Consumes: rien. Suppression valide car plus aucune référence après Tasks 3 et 7.

- [ ] **Step 1: Retirer le lien de navigation**

Dans `src/app/layout.tsx`, supprimer l'entrée `{ href: "/categories", label: "Catégories" }` de `NAV`.

- [ ] **Step 2: Repérer les références restantes**

Run: `grep -rn -E "categories|rules|ensureCategory|setTransactionCategory|CategorySelectField|RuleCheckboxField|recategorize|uncategorized" src tests --include='*.ts' --include='*.tsx'`
Traiter chaque occurrence : retirer l'import/usage. Les fichiers à supprimer sont listés ci-dessous ; tout autre usage résiduel (par ex. un test) doit être retiré ou adapté.

- [ ] **Step 3: Supprimer les fichiers morts**

```bash
git rm -r src/app/categories
git rm src/components/category-select-field.tsx src/components/rule-checkbox-field.tsx \
       src/db/repositories/categories.ts src/db/repositories/rules.ts
```

Si des tests importent `categories`/`rules` (par ex. `tests/db/repositories.test.ts` importe `ensureCategory`, `listCategories`), retirer ces imports et les tests correspondants (le test `category ensure is idempotent`).

- [ ] **Step 4: Vérifier l'absence de références**

Run: `grep -rn -E "repositories/categories|repositories/rules|category-select-field|rule-checkbox-field|ensureCategory|setTransactionCategory|recategorize|uncategorized" src tests --include='*.ts' --include='*.tsx'`
Expected: aucune sortie.

- [ ] **Step 5: Vérifier compilation et suite complète**

Run: `npx tsc --noEmit && npm test`
Expected: aucune erreur ; tous les tests passent.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: retirer catégories/règles (écran, nav, repos, composants) remplacés par les groupes"
```

---

## Vérification runtime finale (après Task 8)

Les DB `:memory:` ne voient pas certains bugs runtime (cf. CLAUDE.md). Lancer le vrai serveur :

- [ ] `npm run dev`, ouvrir `/groupes` : créer une enveloppe (montant + mots-clés) et un groupe récurrents (lignes datées).
- [ ] Ouvrir `/transactions` : chaque ligne a un menu Groupe (Automatique + groupes du compte) et une colonne Appartenance (groupe auto/manuel, « à répartir », « non budgétée »). Rattacher une transaction à un groupe, vérifier que l'appartenance passe en « (manuel) ».
- [ ] Ouvrir `/previsionnel` : les montants reflètent l'appartenance (une dépense comptée une seule fois).
- [ ] La nav ne montre plus « Catégories ». Toutes les pages en 200, aucune erreur serveur.

## Self-review (auteur du plan)

- Couverture spec : schéma+migration clean slate + group_id (Task 1), repo groupes typés + mots-clés (Task 2), transactions group_id + setTransactionGroup (Task 3), ownership (Task 4), forecast refondu (Task 5), écran Groupes par type (Task 6), écran Transactions + prévisionnel/dashboard (Task 7), retrait catégories/règles (Task 8). Tous les points de la spec ont une tâche.
- Types cohérents : `Group`/`Txn` de forecast (Task 5) alignés sur `GroupRow` du repo (Task 2) et `TxnView` (Task 3) ; `OwnableGroup`/`OwnedTxn` (Task 4) construits de la même façon dans forecast, Transactions et dashboard ; `resolveOwnership` renvoie `groupId` seulement pour `manual`/`auto`.
- Pas de placeholder de code : chaque étape porte le code complet (les notes en prose des Tasks 6/7 signalent des états `tsc` transitoires attendus, pas des trous).
