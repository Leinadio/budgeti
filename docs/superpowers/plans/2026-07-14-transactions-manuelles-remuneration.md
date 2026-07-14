# Transactions manuelles + rémunération principale/supplémentaire — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre la saisie manuelle de transactions (entrée/sortie), le rapprochement assisté avec les lignes bancaires synchronisées, et une analyse mensuelle rémunération principale vs supplémentaire dans l'onglet Historique.

**Architecture:** Trois colonnes ajoutées à `transactions` (`manual`, `income_kind`, `note`) plus une table `reconcile_ignored`, via migrations idempotentes. Le repository gagne des fonctions d'insertion/édition/suppression manuelle, de détection de doublons et de fusion. Une fonction pure `monthRemuneration` calcule l'analyse par mois. Les server actions restent des enveloppes minces au-dessus de fonctions testées. L'UI (Sheet d'ajout, bandeau de rapprochement, encart Historique) suit les patterns existants (contrôles natifs + server actions + `router.refresh()`).

**Tech Stack:** Next.js 16 (App Router, server actions), React 19, TypeScript, better-sqlite3, Vitest, shadcn/ui (Sheet, Badge, Table, Button).

## Global Constraints

- Français partout dans l'UI et les libellés. Pas d'emoji ni de symbole décoratif.
- Migrations idempotentes basées sur `PRAGMA table_info` / `CREATE TABLE IF NOT EXISTS`, appelées dans `getDb()` (`src/db/index.ts`).
- Les tests utilisent des DB `:memory:` via `getDb(":memory:")` ou `new Database(":memory:")`. Rappel : ils ne voient pas certains bugs runtime (dossier `data/`, mots réservés) ; vérifier en lançant le vrai serveur.
- Montants en euros signés : sortie négative, entrée positive.
- Rattachement 100 % manuel via `resolveOwnership` (aucune détection par mot-clé).
- Il n'existe pas de harnais de test de composants React (pas de testing-library). Les tâches UI se vérifient par `npx tsc --noEmit` puis contrôle manuel dans le serveur de dev.
- `id` d'une transaction manuelle : `manual:` + `randomUUID()` (import `node:crypto`).
- Commits fréquents, un par tâche, format Conventional Commits.

---

### Task 1: Migrations et schéma (colonnes manual/income_kind/note + table reconcile_ignored)

**Files:**
- Modify: `src/db/schema.sql`
- Modify: `src/db/migrations.ts`
- Modify: `src/db/index.ts`
- Test: `tests/db/migration.test.ts`

**Interfaces:**
- Produces: `migrateTransactionManualFields(db: Database.Database): void`, `migrateReconcileIgnored(db: Database.Database): void`. Après `getDb()`, la table `transactions` possède les colonnes `manual` (INTEGER NOT NULL DEFAULT 0), `income_kind` (TEXT), `note` (TEXT), et la table `reconcile_ignored (manual_id TEXT, synced_id TEXT, PRIMARY KEY(manual_id, synced_id))` existe.

- [ ] **Step 1: Écrire le test de migration qui échoue**

Ajouter à la fin de `tests/db/migration.test.ts` :

```ts
import { migrateTransactionManualFields, migrateReconcileIgnored } from "../../src/db/migrations";

test("migrateTransactionManualFields adds manual/income_kind/note idempotently", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE transactions (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL, date TEXT NOT NULL,
      amount REAL NOT NULL, label TEXT NOT NULL, category_id INTEGER
    );
    INSERT INTO transactions (id, account_id, date, amount, label, category_id)
      VALUES ('t1', 'a1', '2026-07-01', -10, 'CARREFOUR', NULL);
  `);
  migrateTransactionManualFields(db);
  const cols = db.prepare("PRAGMA table_info(transactions)").all() as { name: string }[];
  expect(cols.some((c) => c.name === "manual")).toBe(true);
  expect(cols.some((c) => c.name === "income_kind")).toBe(true);
  expect(cols.some((c) => c.name === "note")).toBe(true);
  // valeur par défaut appliquée à la ligne existante
  expect(db.prepare("SELECT manual FROM transactions WHERE id='t1'").get()).toEqual({ manual: 0 });
  // idempotent : deuxième passage sans erreur
  migrateTransactionManualFields(db);
  expect(db.prepare("SELECT COUNT(*) AS n FROM transactions").get()).toEqual({ n: 1 });
});

test("migrateReconcileIgnored creates the table idempotently", () => {
  const db = new Database(":memory:");
  migrateReconcileIgnored(db);
  migrateReconcileIgnored(db);
  db.prepare("INSERT INTO reconcile_ignored (manual_id, synced_id) VALUES ('m1', 's1')").run();
  expect(db.prepare("SELECT COUNT(*) AS n FROM reconcile_ignored").get()).toEqual({ n: 1 });
});
```

- [ ] **Step 2: Lancer le test, vérifier l'échec**

Run: `npx vitest run tests/db/migration.test.ts`
Expected: FAIL (`migrateTransactionManualFields` / `migrateReconcileIgnored` non exportés).

- [ ] **Step 3: Ajouter les migrations**

Ajouter à la fin de `src/db/migrations.ts` :

```ts
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
```

- [ ] **Step 4: Mettre à jour le schéma neuf**

Dans `src/db/schema.sql`, remplacer le bloc `CREATE TABLE ... transactions (...)` par :

```sql
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,             -- Enable Banking id, ou "manual:<uuid>" pour une saisie
  account_id TEXT NOT NULL REFERENCES accounts(id),
  date TEXT NOT NULL,              -- YYYY-MM-DD
  amount REAL NOT NULL,            -- signed euros: debit negative, credit positive
  label TEXT NOT NULL,             -- raw bank label ou libellé saisi
  category_id INTEGER REFERENCES categories(id),
  group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
  line_id INTEGER REFERENCES group_lines(id) ON DELETE SET NULL,
  excluded INTEGER NOT NULL DEFAULT 0,  -- 1 = forcé « non catégorisé »
  manual INTEGER NOT NULL DEFAULT 0,    -- 1 = saisie manuelle
  income_kind TEXT,                     -- 'principal' | 'supplementary' | NULL
  note TEXT                             -- commentaire ; libellé manuel après fusion
);
```

Puis ajouter, après le bloc `group_keywords`, à la fin du fichier :

```sql
CREATE TABLE IF NOT EXISTS reconcile_ignored (
  manual_id TEXT NOT NULL,
  synced_id TEXT NOT NULL,
  PRIMARY KEY (manual_id, synced_id)
);
```

- [ ] **Step 5: Brancher les migrations dans getDb**

Dans `src/db/index.ts`, mettre à jour l'import et l'appel :

```ts
import { migrateBudgets, migrateAccountCustomName, migrateGroupsV2, migrateTransactionExcluded, migrateTransactionLineId, migrateTransactionManualFields, migrateReconcileIgnored } from "./migrations";
```

Puis après `migrateTransactionLineId(db);` :

```ts
  migrateTransactionManualFields(db);
  migrateReconcileIgnored(db);
```

- [ ] **Step 6: Lancer les tests, vérifier le succès**

Run: `npx vitest run tests/db/migration.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/db/schema.sql src/db/migrations.ts src/db/index.ts tests/db/migration.test.ts
git commit -m "feat(db): colonnes manual/income_kind/note et table reconcile_ignored"
```

---

### Task 2: Repository — insertion manuelle et lecture étendue

**Files:**
- Modify: `src/db/repositories/transactions.ts`
- Test: `tests/db/manual-transactions.test.ts` (créer)

**Interfaces:**
- Consumes: `getDb`, `upsertAccount`.
- Produces:
  - `TxnView` étendu de `manual: boolean`, `incomeKind: "principal" | "supplementary" | null`, `note: string | null`.
  - `type ManualTxnInput = { accountId: string; date: string; amount: number; label: string; groupId: number | null; lineId: number | null; incomeKind: "principal" | "supplementary" | null }`.
  - `insertManualTransaction(db: Database.Database, input: ManualTxnInput): string` — renvoie l'id généré (`manual:<uuid>`), `manual = 1`.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `tests/db/manual-transactions.test.ts` :

```ts
import { expect, test } from "vitest";
import { getDb } from "../../src/db/index";
import { upsertAccount } from "../../src/db/repositories/accounts";
import { insertManualTransaction, listTransactions } from "../../src/db/repositories/transactions";

function seed() {
  const db = getDb(":memory:");
  upsertAccount(db, { id: "a1", name: "CIC", iban_masked: null, balance: 0, currency: "EUR", last_synced: null });
  return db;
}

test("insertManualTransaction stores a manual row and lists it back", () => {
  const db = seed();
  const id = insertManualTransaction(db, {
    accountId: "a1", date: "2026-07-01", amount: 652.09, label: "Rémunération juillet",
    groupId: null, lineId: null, incomeKind: "principal",
  });
  expect(id.startsWith("manual:")).toBe(true);
  const rows = listTransactions(db);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    id, amount: 652.09, label: "Rémunération juillet",
    manual: true, incomeKind: "principal", note: null,
  });
});
```

- [ ] **Step 2: Lancer le test, vérifier l'échec**

Run: `npx vitest run tests/db/manual-transactions.test.ts`
Expected: FAIL (`insertManualTransaction` non exporté ; `manual`/`incomeKind` absents de `TxnView`).

- [ ] **Step 3: Étendre TxnView, la lecture et ajouter l'insertion**

Dans `src/db/repositories/transactions.ts`, ajouter en haut :

```ts
import { randomUUID } from "node:crypto";
```

Étendre `TxnView` :

```ts
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
  manual: boolean;
  incomeKind: "principal" | "supplementary" | null;
  note: string | null;
};
```

Dans `listTransactions`, remplacer le `SELECT` et le mapping final. La clause `SELECT` devient :

```ts
  let sql =
    `SELECT t.id, t.date, t.amount, t.label, t.group_id AS groupId, t.line_id AS lineId, t.excluded AS excluded,
            t.manual AS manual, t.income_kind AS incomeKind, t.note AS note,
            t.account_id AS accountId,
            COALESCE(COALESCE(a.custom_name, a.name) || ' ' || a.iban_masked, COALESCE(a.custom_name, a.name)) AS accountLabel
     FROM transactions t
     LEFT JOIN accounts a ON a.id = t.account_id`;
```

Et le mapping :

```ts
  const rows = (clauses.length ? stmt.all(params) : stmt.all()) as (Omit<TxnView, "excluded" | "manual" | "incomeKind"> & { excluded: number; manual: number; incomeKind: string | null })[];
  return rows.map((r) => ({
    ...r,
    excluded: r.excluded === 1,
    manual: r.manual === 1,
    incomeKind: r.incomeKind === "principal" || r.incomeKind === "supplementary" ? r.incomeKind : null,
  }));
```

Ajouter le type et la fonction d'insertion :

```ts
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
```

- [ ] **Step 4: Lancer le test, vérifier le succès**

Run: `npx vitest run tests/db/manual-transactions.test.ts`
Expected: PASS.

- [ ] **Step 5: Vérifier la non-régression et les types**

Run: `npx vitest run tests/db/repositories.test.ts && npx tsc --noEmit`
Expected: PASS, aucune erreur de type.

- [ ] **Step 6: Commit**

```bash
git add src/db/repositories/transactions.ts tests/db/manual-transactions.test.ts
git commit -m "feat(db): insertManualTransaction et TxnView étendu (manual/income_kind/note)"
```

---

### Task 3: Repository — édition, suppression, étiquetage

**Files:**
- Modify: `src/db/repositories/transactions.ts`
- Test: `tests/db/manual-transactions.test.ts`

**Interfaces:**
- Consumes: `insertManualTransaction`, `listTransactions`, `ManualTxnInput`.
- Produces:
  - `updateManualTransaction(db, id: string, input: Omit<ManualTxnInput, "accountId">): void` — n'agit que sur `manual = 1`.
  - `deleteManualTransaction(db, id: string): void` — n'agit que sur `manual = 1`.
  - `setIncomeKind(db, id: string, kind: "principal" | "supplementary" | null): void`.

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter à `tests/db/manual-transactions.test.ts` :

```ts
import { updateManualTransaction, deleteManualTransaction, setIncomeKind } from "../../src/db/repositories/transactions";
import { upsertTransaction } from "../../src/db/repositories/transactions";

test("updateManualTransaction edits a manual row, ignores synced rows", () => {
  const db = seed();
  const id = insertManualTransaction(db, {
    accountId: "a1", date: "2026-07-01", amount: 100, label: "brouillon",
    groupId: null, lineId: null, incomeKind: "principal",
  });
  updateManualTransaction(db, id, {
    date: "2026-07-02", amount: 200, label: "corrigé", groupId: null, lineId: null, incomeKind: "supplementary",
  });
  const t = listTransactions(db).find((x) => x.id === id)!;
  expect(t).toMatchObject({ date: "2026-07-02", amount: 200, label: "corrigé", incomeKind: "supplementary" });

  // une ligne synchronisée n'est pas modifiée
  upsertTransaction(db, { id: "bank1", account_id: "a1", date: "2026-07-01", amount: -50, label: "BANK", category_id: null });
  updateManualTransaction(db, "bank1", { date: "2000-01-01", amount: 999, label: "hack", groupId: null, lineId: null, incomeKind: null });
  expect(listTransactions(db).find((x) => x.id === "bank1")).toMatchObject({ date: "2026-07-01", amount: -50, label: "BANK" });
});

test("deleteManualTransaction removes only manual rows", () => {
  const db = seed();
  const id = insertManualTransaction(db, {
    accountId: "a1", date: "2026-07-01", amount: 10, label: "x", groupId: null, lineId: null, incomeKind: null,
  });
  upsertTransaction(db, { id: "bank1", account_id: "a1", date: "2026-07-01", amount: -50, label: "BANK", category_id: null });
  deleteManualTransaction(db, "bank1"); // refusé (non manuel)
  expect(listTransactions(db)).toHaveLength(2);
  deleteManualTransaction(db, id);
  expect(listTransactions(db).map((t) => t.id)).toEqual(["bank1"]);
});

test("setIncomeKind tags any income row, including a synced one", () => {
  const db = seed();
  upsertTransaction(db, { id: "bank1", account_id: "a1", date: "2026-07-01", amount: 652.09, label: "VIREMENT", category_id: null });
  setIncomeKind(db, "bank1", "principal");
  expect(listTransactions(db).find((x) => x.id === "bank1")!.incomeKind).toBe("principal");
  setIncomeKind(db, "bank1", null);
  expect(listTransactions(db).find((x) => x.id === "bank1")!.incomeKind).toBeNull();
});
```

- [ ] **Step 2: Lancer les tests, vérifier l'échec**

Run: `npx vitest run tests/db/manual-transactions.test.ts`
Expected: FAIL (fonctions non exportées).

- [ ] **Step 3: Ajouter les fonctions**

Dans `src/db/repositories/transactions.ts` :

```ts
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

// Étiquette une entrée principale/supplémentaire (ou retire l'étiquette).
export function setIncomeKind(
  db: Database.Database,
  id: string,
  kind: "principal" | "supplementary" | null,
): void {
  db.prepare("UPDATE transactions SET income_kind=? WHERE id=?").run(kind, id);
}
```

- [ ] **Step 4: Lancer les tests, vérifier le succès**

Run: `npx vitest run tests/db/manual-transactions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/repositories/transactions.ts tests/db/manual-transactions.test.ts
git commit -m "feat(db): édition/suppression manuelle et étiquetage income_kind"
```

---

### Task 4: Repository — détection des rapprochements possibles

**Files:**
- Modify: `src/db/repositories/transactions.ts`
- Test: `tests/db/manual-transactions.test.ts`

**Interfaces:**
- Consumes: `listTransactions`, `insertManualTransaction`, `upsertTransaction`.
- Produces:
  - `type ReconcileSuggestion = { manual: TxnView; synced: TxnView }`.
  - `findReconcileSuggestions(db, windowDays?: number): ReconcileSuggestion[]` — défaut 5 jours ; paire = même `accountId`, même `amount`, `|date manuelle − date synchro| ≤ windowDays`, non présente dans `reconcile_ignored`.

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter à `tests/db/manual-transactions.test.ts` :

```ts
import { findReconcileSuggestions } from "../../src/db/repositories/transactions";

test("findReconcileSuggestions matches by account, amount and date window", () => {
  const db = seed();
  upsertAccount(db, { id: "a2", name: "Livret", iban_masked: null, balance: 0, currency: "EUR", last_synced: null });
  const m = insertManualTransaction(db, {
    accountId: "a1", date: "2026-07-01", amount: 652.09, label: "Rémunération", groupId: null, lineId: null, incomeKind: "principal",
  });
  // candidat valide : même compte, même montant, 3 jours plus tard
  upsertTransaction(db, { id: "bank_ok", account_id: "a1", date: "2026-07-04", amount: 652.09, label: "VIR SEPA", category_id: null });
  // hors fenêtre (10 jours)
  upsertTransaction(db, { id: "bank_far", account_id: "a1", date: "2026-07-11", amount: 652.09, label: "VIR", category_id: null });
  // autre montant
  upsertTransaction(db, { id: "bank_amt", account_id: "a1", date: "2026-07-02", amount: 100, label: "VIR", category_id: null });
  // autre compte
  upsertTransaction(db, { id: "bank_acc", account_id: "a2", date: "2026-07-02", amount: 652.09, label: "VIR", category_id: null });

  const sugg = findReconcileSuggestions(db);
  expect(sugg).toHaveLength(1);
  expect(sugg[0].manual.id).toBe(m);
  expect(sugg[0].synced.id).toBe("bank_ok");
});

test("findReconcileSuggestions skips ignored pairs", () => {
  const db = seed();
  const m = insertManualTransaction(db, {
    accountId: "a1", date: "2026-07-01", amount: 50, label: "top-up", groupId: null, lineId: null, incomeKind: "supplementary",
  });
  upsertTransaction(db, { id: "bank_ok", account_id: "a1", date: "2026-07-02", amount: 50, label: "VIR", category_id: null });
  expect(findReconcileSuggestions(db)).toHaveLength(1);
  db.prepare("INSERT INTO reconcile_ignored (manual_id, synced_id) VALUES (?, ?)").run(m, "bank_ok");
  expect(findReconcileSuggestions(db)).toHaveLength(0);
});
```

- [ ] **Step 2: Lancer le test, vérifier l'échec**

Run: `npx vitest run tests/db/manual-transactions.test.ts`
Expected: FAIL (`findReconcileSuggestions` non exporté).

- [ ] **Step 3: Ajouter la détection**

Dans `src/db/repositories/transactions.ts` :

```ts
export type ReconcileSuggestion = { manual: TxnView; synced: TxnView };

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
```

- [ ] **Step 4: Lancer le test, vérifier le succès**

Run: `npx vitest run tests/db/manual-transactions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/repositories/transactions.ts tests/db/manual-transactions.test.ts
git commit -m "feat(db): findReconcileSuggestions (rapprochement compte/montant/fenêtre)"
```

---

### Task 5: Repository — fusion et écartement

**Files:**
- Modify: `src/db/repositories/transactions.ts`
- Test: `tests/db/manual-transactions.test.ts`

**Interfaces:**
- Consumes: `insertManualTransaction`, `upsertTransaction`, `listTransactions`, `findReconcileSuggestions`.
- Produces:
  - `mergeTransactions(db, args: { syncedId: string; manualId: string }): void` — copie `group_id`/`line_id`/`income_kind` de la manuelle sur la synchro, met `note` de la synchro au libellé manuel, supprime la manuelle. Atomique.
  - `ignoreMatch(db, manualId: string, syncedId: string): void`.

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter à `tests/db/manual-transactions.test.ts` :

```ts
import { mergeTransactions, ignoreMatch } from "../../src/db/repositories/transactions";
import { insertEnvelopeGroup } from "../../src/db/repositories/groups";

test("mergeTransactions keeps the bank row, carries tagging, notes the manual label", () => {
  const db = seed();
  const gid = insertEnvelopeGroup(db, "a1", "Rémunération", "in", 652.09);
  const m = insertManualTransaction(db, {
    accountId: "a1", date: "2026-07-01", amount: 652.09, label: "Rémunération juillet",
    groupId: gid, lineId: null, incomeKind: "principal",
  });
  upsertTransaction(db, { id: "bank1", account_id: "a1", date: "2026-07-03", amount: 652.09, label: "VIR SEPA RECU", category_id: null });

  mergeTransactions(db, { syncedId: "bank1", manualId: m });

  const rows = listTransactions(db);
  expect(rows.map((t) => t.id)).toEqual(["bank1"]); // la manuelle a disparu
  expect(rows[0]).toMatchObject({
    id: "bank1", label: "VIR SEPA RECU", groupId: gid, incomeKind: "principal", note: "Rémunération juillet", manual: false,
  });
});

test("ignoreMatch records a dismissed pair so it is no longer suggested", () => {
  const db = seed();
  const m = insertManualTransaction(db, {
    accountId: "a1", date: "2026-07-01", amount: 50, label: "top-up", groupId: null, lineId: null, incomeKind: "supplementary",
  });
  upsertTransaction(db, { id: "bank1", account_id: "a1", date: "2026-07-02", amount: 50, label: "VIR", category_id: null });
  ignoreMatch(db, m, "bank1");
  expect(findReconcileSuggestions(db)).toHaveLength(0);
  // idempotent : deuxième écartement sans erreur
  ignoreMatch(db, m, "bank1");
  expect(db.prepare("SELECT COUNT(*) AS n FROM reconcile_ignored").get()).toEqual({ n: 1 });
});
```

- [ ] **Step 2: Lancer les tests, vérifier l'échec**

Run: `npx vitest run tests/db/manual-transactions.test.ts`
Expected: FAIL (`mergeTransactions` / `ignoreMatch` non exportés).

- [ ] **Step 3: Ajouter fusion et écartement**

Dans `src/db/repositories/transactions.ts` :

```ts
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
    db.prepare(
      `UPDATE transactions SET group_id=@group_id, line_id=@line_id, income_kind=@income_kind, note=@note
       WHERE id=@id AND manual=0`,
    ).run({ id: syncedId, group_id: m.groupId, line_id: m.lineId, income_kind: m.incomeKind, note: m.label });
    db.prepare("DELETE FROM transactions WHERE id=? AND manual=1").run(manualId);
  });
  run();
}

// Mémorise une paire écartée (« ce n'est pas la même »).
export function ignoreMatch(db: Database.Database, manualId: string, syncedId: string): void {
  db.prepare("INSERT OR IGNORE INTO reconcile_ignored (manual_id, synced_id) VALUES (?, ?)").run(manualId, syncedId);
}
```

- [ ] **Step 4: Lancer les tests, vérifier le succès**

Run: `npx vitest run tests/db/manual-transactions.test.ts && npx tsc --noEmit`
Expected: PASS, aucune erreur de type.

- [ ] **Step 5: Commit**

```bash
git add src/db/repositories/transactions.ts tests/db/manual-transactions.test.ts
git commit -m "feat(db): mergeTransactions et ignoreMatch"
```

---

### Task 6: Lib pure — analyse mensuelle rémunération

**Files:**
- Modify: `src/lib/forecast.ts` (ajout du champ optionnel `incomeKind` à `Txn`)
- Create: `src/lib/remuneration.ts`
- Test: `tests/lib/remuneration.test.ts`

**Interfaces:**
- Consumes: `Group`, `Txn` (de `forecast.ts`), `resolveOwnership` (de `ownership.ts`).
- Produces:
  - `Txn` gagne `incomeKind?: "principal" | "supplementary" | null`.
  - `type MonthRemuneration = { month: string; principal: number; supplementary: number; expenses: number; balanceVsPrincipal: number; balanceVsTotal: number; suggestedNextPrincipal: number }`.
  - `monthRemuneration(groups: Group[], txns: Txn[], month: string): MonthRemuneration`.

Définition métier : pour le mois donné, seules les transactions rattachées à un groupe comptent (cohérent avec la grille). Entrée (groupe `in`) marquée `supplementary` → supplémentaire, sinon → principal. Sortie (groupe `out`) → dépenses. `balanceVsPrincipal = principal − expenses`, `balanceVsTotal = principal + supplementary − expenses`, `suggestedNextPrincipal = principal + supplementary`.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `tests/lib/remuneration.test.ts` :

```ts
import { expect, test } from "vitest";
import { monthRemuneration } from "../../src/lib/remuneration";
import type { Group, Txn } from "../../src/lib/forecast";

const remun: Group = {
  id: 1, accountId: "a1", name: "Rémunération", direction: "in", kind: "envelope",
  monthlyAmount: null, keywords: [], lines: [],
};
const courses: Group = {
  id: 2, accountId: "a1", name: "Courses", direction: "out", kind: "envelope",
  monthlyAmount: 652.09, keywords: [], lines: [],
};

function txn(p: Partial<Txn> & { id: string; date: string; amount: number; groupId: number | null }): Txn {
  return { label: "x", accountId: "a1", excluded: false, lineId: null, incomeKind: null, ...p };
}

test("splits principal vs supplementary and computes both readings", () => {
  const txns: Txn[] = [
    txn({ id: "t1", date: "2026-07-01", amount: 652.09, groupId: 1, incomeKind: "principal" }),
    txn({ id: "t2", date: "2026-07-15", amount: 47.91, groupId: 1, incomeKind: "supplementary" }),
    txn({ id: "t3", date: "2026-07-15", amount: -700, groupId: 2 }),
  ];
  const r = monthRemuneration([remun, courses], txns, "2026-07");
  expect(r.principal).toBeCloseTo(652.09, 2);
  expect(r.supplementary).toBeCloseTo(47.91, 2);
  expect(r.expenses).toBeCloseTo(700, 2);
  expect(r.balanceVsPrincipal).toBeCloseTo(-47.91, 2);
  expect(r.balanceVsTotal).toBeCloseTo(0, 2);
  expect(r.suggestedNextPrincipal).toBeCloseTo(700, 2);
});

test("untagged income counts as principal; other months and uncategorized ignored", () => {
  const txns: Txn[] = [
    txn({ id: "t1", date: "2026-07-01", amount: 800, groupId: 1, incomeKind: null }), // non étiqueté -> principal
    txn({ id: "t2", date: "2026-06-01", amount: 500, groupId: 1, incomeKind: "principal" }), // autre mois
    txn({ id: "t3", date: "2026-07-10", amount: -30, groupId: null }), // non catégorisé -> ignoré
  ];
  const r = monthRemuneration([remun, courses], txns, "2026-07");
  expect(r.principal).toBeCloseTo(800, 2);
  expect(r.supplementary).toBe(0);
  expect(r.expenses).toBe(0);
});
```

- [ ] **Step 2: Lancer le test, vérifier l'échec**

Run: `npx vitest run tests/lib/remuneration.test.ts`
Expected: FAIL (`monthRemuneration` inexistant).

- [ ] **Step 3: Ajouter le champ incomeKind à Txn**

Dans `src/lib/forecast.ts`, dans le type `Txn`, ajouter après `excluded?: boolean;` :

```ts
  incomeKind?: "principal" | "supplementary" | null;
```

- [ ] **Step 4: Créer la fonction pure**

Créer `src/lib/remuneration.ts` :

```ts
import { resolveOwnership, type OwnableGroup, type OwnedTxn } from "./ownership";
import type { Group, Txn } from "./forecast";

export type MonthRemuneration = {
  month: string;
  principal: number;
  supplementary: number;
  expenses: number;
  balanceVsPrincipal: number; // principal - dépenses
  balanceVsTotal: number; // principal + supplémentaire - dépenses
  suggestedNextPrincipal: number; // principal + supplémentaire
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

// Analyse d'un mois : principal vs supplémentaire reçus, dépenses, et les deux
// lectures. Seules les transactions rattachées à un groupe comptent.
export function monthRemuneration(groups: Group[], txns: Txn[], month: string): MonthRemuneration {
  const ownable = groups.map(toOwnable);
  const dirById = new Map(groups.map((g) => [g.id, g.direction] as const));
  let principal = 0;
  let supplementary = 0;
  let expenses = 0;
  for (const t of txns) {
    if (t.date.slice(0, 7) !== month) continue;
    const o: OwnedTxn = { id: t.id, date: t.date, amount: t.amount, label: t.label, accountId: t.accountId, groupId: t.groupId, excluded: t.excluded };
    const res = resolveOwnership(o, ownable);
    if (res.status !== "manual") continue;
    const dir = dirById.get(res.groupId);
    if (dir === "in") {
      if (t.incomeKind === "supplementary") supplementary += Math.abs(t.amount);
      else principal += Math.abs(t.amount);
    } else if (dir === "out") {
      expenses += Math.abs(t.amount);
    }
  }
  return {
    month,
    principal,
    supplementary,
    expenses,
    balanceVsPrincipal: principal - expenses,
    balanceVsTotal: principal + supplementary - expenses,
    suggestedNextPrincipal: principal + supplementary,
  };
}
```

- [ ] **Step 5: Lancer le test, vérifier le succès**

Run: `npx vitest run tests/lib/remuneration.test.ts && npx tsc --noEmit`
Expected: PASS, aucune erreur de type.

- [ ] **Step 6: Commit**

```bash
git add src/lib/forecast.ts src/lib/remuneration.ts tests/lib/remuneration.test.ts
git commit -m "feat(lib): monthRemuneration (analyse principal/supplémentaire par mois)"
```

---

### Task 7: Server actions et helper de formulaire

**Files:**
- Create: `src/lib/manual-txn.ts`
- Modify: `src/app/transactions/actions.ts`
- Test: `tests/lib/manual-txn.test.ts`

**Interfaces:**
- Consumes: `ManualTxnInput` (de `transactions.ts`), fonctions repo des tâches 2–5.
- Produces:
  - `type ManualFormInput = { accountId: string; date: string; direction: "in" | "out"; amount: number; label: string; groupId: number | null; lineId: number | null; incomeKind: "principal" | "supplementary" | null }`.
  - `isValidManualForm(f: ManualFormInput): boolean`.
  - `toManualInput(f: ManualFormInput): ManualTxnInput` — signe le montant selon le sens, force `incomeKind` à null pour une sortie et à `"principal"` par défaut pour une entrée, fournit un libellé par défaut si vide.
  - Server actions : `addTransaction(f)`, `editTransaction(id, f)`, `removeTransaction(id)`, `setIncomeKind(id, kind)`, `mergeTransaction(syncedId, manualId)`, `ignoreMatch(manualId, syncedId)`.

- [ ] **Step 1: Écrire le test du helper qui échoue**

Créer `tests/lib/manual-txn.test.ts` :

```ts
import { expect, test } from "vitest";
import { isValidManualForm, toManualInput, type ManualFormInput } from "../../src/lib/manual-txn";

const base: ManualFormInput = {
  accountId: "a1", date: "2026-07-01", direction: "in", amount: 652.09, label: "Rémunération",
  groupId: null, lineId: null, incomeKind: "principal",
};

test("toManualInput signs amount by direction and clears incomeKind for expenses", () => {
  expect(toManualInput(base).amount).toBeCloseTo(652.09, 2);
  const out = toManualInput({ ...base, direction: "out", amount: 30, incomeKind: "principal" });
  expect(out.amount).toBeCloseTo(-30, 2);
  expect(out.incomeKind).toBeNull();
});

test("toManualInput defaults incomeKind to principal and label when missing", () => {
  const r = toManualInput({ ...base, incomeKind: null, label: "  " });
  expect(r.incomeKind).toBe("principal");
  expect(r.label).toBe("Entrée manuelle");
});

test("isValidManualForm rejects bad date, zero and non-finite amounts, empty account", () => {
  expect(isValidManualForm(base)).toBe(true);
  expect(isValidManualForm({ ...base, date: "2026/07/01" })).toBe(false);
  expect(isValidManualForm({ ...base, amount: 0 })).toBe(false);
  expect(isValidManualForm({ ...base, amount: Number.NaN })).toBe(false);
  expect(isValidManualForm({ ...base, accountId: "" })).toBe(false);
});
```

- [ ] **Step 2: Lancer le test, vérifier l'échec**

Run: `npx vitest run tests/lib/manual-txn.test.ts`
Expected: FAIL (`src/lib/manual-txn.ts` inexistant).

- [ ] **Step 3: Créer le helper pur**

Créer `src/lib/manual-txn.ts` :

```ts
import type { ManualTxnInput } from "@/db/repositories/transactions";

export type ManualFormInput = {
  accountId: string;
  date: string; // YYYY-MM-DD
  direction: "in" | "out";
  amount: number; // positif tel que saisi
  label: string;
  groupId: number | null;
  lineId: number | null;
  incomeKind: "principal" | "supplementary" | null;
};

export function isValidManualForm(f: ManualFormInput): boolean {
  if (!f.accountId) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) return false;
  if (!Number.isFinite(f.amount) || f.amount === 0) return false;
  return true;
}

// Normalise le formulaire vers l'entrée repository : signe le montant, force
// income_kind (null pour une sortie, principal par défaut pour une entrée),
// libellé par défaut si vide.
export function toManualInput(f: ManualFormInput): ManualTxnInput {
  const magnitude = Math.abs(f.amount);
  const amount = f.direction === "in" ? magnitude : -magnitude;
  const label = f.label.trim() || (f.direction === "in" ? "Entrée manuelle" : "Sortie manuelle");
  const incomeKind = f.direction === "in" ? (f.incomeKind ?? "principal") : null;
  return { accountId: f.accountId, date: f.date, amount, label, groupId: f.groupId, lineId: f.lineId, incomeKind };
}
```

- [ ] **Step 4: Lancer le test, vérifier le succès**

Run: `npx vitest run tests/lib/manual-txn.test.ts`
Expected: PASS.

- [ ] **Step 5: Ajouter les server actions**

Remplacer le contenu de `src/app/transactions/actions.ts` par :

```ts
"use server";
import { db } from "../../db/index";
import {
  setTransactionGroup,
  insertManualTransaction,
  updateManualTransaction,
  deleteManualTransaction,
  setIncomeKind as setIncomeKindRepo,
  mergeTransactions,
  ignoreMatch as ignoreMatchRepo,
} from "../../db/repositories/transactions";
import { isValidManualForm, toManualInput, type ManualFormInput } from "@/lib/manual-txn";
import { revalidatePath } from "next/cache";

function revalidateAll() {
  revalidatePath("/transactions");
  revalidatePath("/previsionnel");
  revalidatePath("/historique");
  revalidatePath("/");
}

export async function setGroup(
  txnId: string,
  groupId: number | null,
  lineId: number | null = null,
) {
  const gid = groupId !== null && Number.isFinite(groupId) ? groupId : null;
  const lid = lineId !== null && Number.isFinite(lineId) ? lineId : null;
  setTransactionGroup(db(), txnId, gid, false, lid);
  revalidateAll();
}

export async function addTransaction(form: ManualFormInput) {
  if (!isValidManualForm(form)) return;
  insertManualTransaction(db(), toManualInput(form));
  revalidateAll();
}

export async function editTransaction(id: string, form: ManualFormInput) {
  if (!isValidManualForm(form)) return;
  const { accountId: _accountId, ...rest } = toManualInput(form);
  updateManualTransaction(db(), id, rest);
  revalidateAll();
}

export async function removeTransaction(id: string) {
  deleteManualTransaction(db(), id);
  revalidateAll();
}

export async function setIncomeKind(id: string, kind: "principal" | "supplementary" | null) {
  setIncomeKindRepo(db(), id, kind);
  revalidateAll();
}

export async function mergeTransaction(syncedId: string, manualId: string) {
  mergeTransactions(db(), { syncedId, manualId });
  revalidateAll();
}

export async function ignoreMatch(manualId: string, syncedId: string) {
  ignoreMatchRepo(db(), manualId, syncedId);
  revalidateAll();
}
```

- [ ] **Step 6: Vérifier les types**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 7: Commit**

```bash
git add src/lib/manual-txn.ts src/app/transactions/actions.ts tests/lib/manual-txn.test.ts
git commit -m "feat(transactions): helper de formulaire et server actions manuelles"
```

---

### Task 8: UI — Sheet d'ajout/édition de transaction

**Files:**
- Create: `src/components/add-transaction-sheet.tsx`
- Modify: `src/components/transactions-browser.tsx`
- Modify: `src/app/transactions/page.tsx`

**Interfaces:**
- Consumes: `addTransaction`, `editTransaction` (actions), `ManualFormInput`.
- Produces: composant `AddTransactionSheet` avec props `{ accounts: { id: string; label: string }[]; groups: { id: number; name: string; accountId: string; direction: "in" | "out" }[]; edit?: { id: string; accountId: string; date: string; direction: "in" | "out"; amount: number; label: string; groupId: number | null; incomeKind: "principal" | "supplementary" | null } }`.
- `TransactionsBrowser` reçoit une nouvelle prop `accounts: { id: string; label: string }[]`.

Note : pas de harnais de test composant ; vérification par `npx tsc --noEmit` puis contrôle manuel.

- [ ] **Step 1: Créer le composant Sheet**

Créer `src/components/add-transaction-sheet.tsx` :

```tsx
"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil } from "lucide-react";
import { addTransaction, editTransaction } from "@/app/transactions/actions";
import type { ManualFormInput } from "@/lib/manual-txn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";

type AccountOpt = { id: string; label: string };
type GroupOpt = { id: number; name: string; accountId: string; direction: "in" | "out" };
type EditData = {
  id: string; accountId: string; date: string; direction: "in" | "out";
  amount: number; label: string; groupId: number | null; incomeKind: "principal" | "supplementary" | null;
};

export function AddTransactionSheet({ accounts, groups, edit }: { accounts: AccountOpt[]; groups: GroupOpt[]; edit?: EditData }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [accountId, setAccountId] = useState(edit?.accountId ?? accounts[0]?.id ?? "");
  const [date, setDate] = useState(edit?.date ?? "");
  const [direction, setDirection] = useState<"in" | "out">(edit?.direction ?? "out");
  const [amount, setAmount] = useState(edit ? String(Math.abs(edit.amount)) : "");
  const [label, setLabel] = useState(edit?.label ?? "");
  const [groupId, setGroupId] = useState<number | null>(edit?.groupId ?? null);
  const [incomeKind, setIncomeKind] = useState<"principal" | "supplementary">(edit?.incomeKind ?? "principal");

  const groupChoices = groups.filter((g) => g.accountId === accountId && g.direction === direction);

  const submit = () => {
    const form: ManualFormInput = {
      accountId, date, direction, amount: Number(amount.replace(",", ".")),
      label, groupId, lineId: null, incomeKind: direction === "in" ? incomeKind : null,
    };
    startTransition(async () => {
      if (edit) await editTransaction(edit.id, form);
      else await addTransaction(form);
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {edit ? (
          <Button variant="ghost" size="sm"><Pencil className="size-4" />Modifier</Button>
        ) : (
          <Button size="sm"><Plus className="size-4" />Ajouter une transaction</Button>
        )}
      </SheetTrigger>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{edit ? "Modifier la transaction" : "Nouvelle transaction"}</SheetTitle>
          <SheetDescription>Saisie manuelle, en attente de synchronisation bancaire.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4 pb-6">
          <label className="flex flex-col gap-1 text-sm">
            Compte
            <select value={accountId} onChange={(e) => { setAccountId(e.target.value); setGroupId(null); }}
              className="border-input bg-background h-9 rounded-md border px-3 text-sm">
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          </label>

          <div className="flex gap-2">
            <Button type="button" variant={direction === "out" ? "default" : "outline"} size="sm"
              onClick={() => { setDirection("out"); setGroupId(null); }}>Sortie</Button>
            <Button type="button" variant={direction === "in" ? "default" : "outline"} size="sm"
              onClick={() => { setDirection("in"); setGroupId(null); }}>Entrée</Button>
          </div>

          <label className="flex flex-col gap-1 text-sm">
            Date
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Montant (€)
            <Input type="number" inputMode="decimal" min="0" step="0.01" placeholder="0,00"
              value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Libellé
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex. Rémunération juillet" />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Groupe
            <select value={groupId ?? ""} onChange={(e) => setGroupId(e.target.value ? Number(e.target.value) : null)}
              className="border-input bg-background h-9 rounded-md border px-3 text-sm">
              <option value="">Non catégorisé</option>
              {groupChoices.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>

          {direction === "in" && (
            <label className="flex flex-col gap-1 text-sm">
              Type de rémunération
              <select value={incomeKind} onChange={(e) => setIncomeKind(e.target.value as "principal" | "supplementary")}
                className="border-input bg-background h-9 rounded-md border px-3 text-sm">
                <option value="principal">Principale</option>
                <option value="supplementary">Supplémentaire</option>
              </select>
            </label>
          )}

          <Button onClick={submit} disabled={isPending || !accountId || !date || !amount}>
            {edit ? "Enregistrer" : "Ajouter"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 2: Passer accounts au browser et afficher le bouton d'ajout**

Dans `src/components/transactions-browser.tsx` :

Ajouter l'import :

```tsx
import { AddTransactionSheet } from "@/components/add-transaction-sheet";
```

Étendre la signature du composant :

```tsx
export function TransactionsBrowser({ transactions, groups, accounts }: { transactions: TxnView[]; groups: ClientGroup[]; accounts: { id: string; label: string }[] }) {
```

Construire la liste des groupes pour le formulaire (après `const ownable: OwnableGroup[] = groups;`) :

```tsx
  const formGroups = groups.map((g) => ({ id: g.id, name: g.name, accountId: g.accountId, direction: g.direction }));
```

Juste après l'ouverture `<div className="flex flex-col gap-4">` du `return` principal, insérer une barre d'action (avant la barre de filtres) :

```tsx
      <div className="flex justify-end">
        <AddTransactionSheet accounts={accounts} groups={formGroups} />
      </div>
```

Note : `ClientGroup` inclut déjà `accountId` et `direction` (via `OwnableGroup`).

Le garde `if (transactions.length === 0)` renvoie tôt : y ajouter aussi le bouton pour permettre une première saisie même sans transaction. Remplacer ce bloc par :

```tsx
  if (transactions.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex justify-end">
          <AddTransactionSheet accounts={accounts} groups={formGroups} />
        </div>
        <p className="text-muted-foreground text-sm">
          Aucune transaction synchronisée. Ajoute-en une à la main ou synchronise dans Réglages.
        </p>
      </div>
    );
  }
```

- [ ] **Step 3: Fournir accounts depuis la page**

Remplacer `src/app/transactions/page.tsx` par :

```tsx
import { db } from "../../db/index";
import { listTransactions } from "../../db/repositories/transactions";
import { listGroups } from "../../db/repositories/groups";
import { listAccounts } from "../../db/repositories/accounts";
import { accountLabel } from "../../lib/account";
import { TransactionsBrowser } from "@/components/transactions-browser";

export const dynamic = "force-dynamic";

export default function TransactionsPage() {
  const database = db();
  const transactions = listTransactions(database);
  const accounts = listAccounts(database).map((a) => ({ id: a.id, label: accountLabel(a) }));
  const groups = listGroups(database).map((g) => ({
    id: g.id,
    accountId: g.accountId,
    name: g.name,
    direction: g.direction,
    kind: g.kind,
    keywords: g.kind === "envelope" ? g.keywords : g.lines.map((l) => l.keyword),
    lines: g.kind === "recurring" ? g.lines.map((l) => ({ id: l.id, name: l.name })) : [],
  }));

  return <TransactionsBrowser transactions={transactions} groups={groups} accounts={accounts} />;
}
```

- [ ] **Step 4: Vérifier les types**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 5: Contrôle manuel**

Run: `npm run dev` puis ouvrir `/transactions`.
Expected: bouton « Ajouter une transaction » ; le Sheet s'ouvre ; ajouter une entrée de 652,09 sur le compte, groupe Rémunération, principale ; la ligne apparaît après refresh.

- [ ] **Step 6: Commit**

```bash
git add src/components/add-transaction-sheet.tsx src/components/transactions-browser.tsx src/app/transactions/page.tsx
git commit -m "feat(transactions): saisie manuelle via Sheet d'ajout"
```

---

### Task 9: UI — badges manuel/en attente, édition/suppression, commentaire fusionné

**Files:**
- Modify: `src/components/transactions-browser.tsx`
- Create: `src/components/manual-txn-actions.tsx`

**Interfaces:**
- Consumes: `removeTransaction` (action), `AddTransactionSheet` (mode édition), `Badge`.
- Produces: composant `ManualTxnActions` avec props `{ txn: TxnView; accounts: { id: string; label: string }[]; groups: { id: number; name: string; accountId: string; direction: "in" | "out" }[] }` (bouton Modifier + Supprimer).

Note : vérification par `npx tsc --noEmit` puis contrôle manuel.

- [ ] **Step 1: Créer le composant d'actions ligne**

Créer `src/components/manual-txn-actions.tsx` :

```tsx
"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import type { TxnView } from "@/db/repositories/transactions";
import { removeTransaction } from "@/app/transactions/actions";
import { AddTransactionSheet } from "@/components/add-transaction-sheet";
import { Button } from "@/components/ui/button";

type AccountOpt = { id: string; label: string };
type GroupOpt = { id: number; name: string; accountId: string; direction: "in" | "out" };

export function ManualTxnActions({ txn, accounts, groups }: { txn: TxnView; accounts: AccountOpt[]; groups: GroupOpt[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <span className="inline-flex items-center gap-1">
      <AddTransactionSheet
        accounts={accounts}
        groups={groups}
        edit={{
          id: txn.id, accountId: txn.accountId, date: txn.date,
          direction: txn.amount >= 0 ? "in" : "out", amount: txn.amount,
          label: txn.label, groupId: txn.groupId, incomeKind: txn.incomeKind,
        }}
      />
      <Button variant="ghost" size="sm" disabled={isPending}
        onClick={() => startTransition(async () => { await removeTransaction(txn.id); router.refresh(); })}>
        <Trash2 className="size-4" />
      </Button>
    </span>
  );
}
```

- [ ] **Step 2: Afficher badges, commentaire et actions dans le browser**

Dans `src/components/transactions-browser.tsx` :

Ajouter les imports :

```tsx
import { Badge } from "@/components/ui/badge";
import { ManualTxnActions } from "@/components/manual-txn-actions";
```

Créer un helper de rendu du libellé (avec badge et commentaire), à placer dans le composant, après `formGroups` :

```tsx
  const renderLabel = (t: TxnView) => (
    <span className="flex flex-col gap-0.5">
      <span className="flex items-center gap-1.5">
        <TruncatedText text={t.label} className="max-w-[380px]" />
        {t.manual && <Badge variant="outline">manuel · en attente</Badge>}
      </span>
      {t.note && <span className="text-muted-foreground text-xs">{t.note}</span>}
    </span>
  );
```

Dans les deux tables (vue filtrée et vue par mois), remplacer la cellule Libellé
`<TableCell><TruncatedText text={t.label} className="max-w-[380px]" /></TableCell>`
(et l'équivalent `max-w-[460px]`) par :

```tsx
                    <TableCell>{renderLabel(t)}</TableCell>
```

Ajouter une colonne d'actions. Dans chaque `<TableHeader>`, ajouter après la
colonne Montant :

```tsx
                <TableHead className="text-right"></TableHead>
```

Et dans chaque ligne de données, après la cellule Montant :

```tsx
                    <TableCell className="text-right">
                      {t.manual && <ManualTxnActions txn={t} accounts={accounts} groups={formGroups} />}
                    </TableCell>
```

Ajuster le `colSpan` de la ligne d'en-tête de mois (vue par mois) de `5` à `6`,
et le `colSpan` du message « Aucun résultat » (vue filtrée) de `6` à `7`.

- [ ] **Step 3: Vérifier les types**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 4: Contrôle manuel**

Run: `npm run dev` puis `/transactions`.
Expected: la ligne manuelle porte le badge « manuel · en attente », les boutons Modifier/Supprimer ; l'édition met à jour la ligne ; la suppression la retire ; une ligne bancaire n'a ni badge ni actions.

- [ ] **Step 5: Commit**

```bash
git add src/components/transactions-browser.tsx src/components/manual-txn-actions.tsx
git commit -m "feat(transactions): badge manuel, édition/suppression et commentaire fusionné"
```

---

### Task 10: UI — bandeau de rapprochement

**Files:**
- Create: `src/components/reconcile-banner.tsx`
- Modify: `src/app/transactions/page.tsx`

**Interfaces:**
- Consumes: `findReconcileSuggestions` (repo), `mergeTransaction`, `ignoreMatch` (actions), `formatEur`.
- Produces: composant `ReconcileBanner` avec prop `{ suggestions: { manual: { id: string; date: string; amount: number; label: string }; synced: { id: string; date: string; amount: number; label: string } }[] }`.

Note : vérification par `npx tsc --noEmit` puis contrôle manuel.

- [ ] **Step 1: Créer le composant bandeau**

Créer `src/components/reconcile-banner.tsx` :

```tsx
"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatEur } from "@/lib/money";
import { mergeTransaction, ignoreMatch } from "@/app/transactions/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type Line = { id: string; date: string; amount: number; label: string };
type Suggestion = { manual: Line; synced: Line };

export function ReconcileBanner({ suggestions }: { suggestions: Suggestion[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  if (suggestions.length === 0) return null;

  const act = (fn: () => Promise<void>) => startTransition(async () => { await fn(); router.refresh(); });

  return (
    <Card className="flex flex-col gap-3 p-4">
      <p className="text-sm font-medium">
        {suggestions.length} rapprochement{suggestions.length > 1 ? "s" : ""} possible{suggestions.length > 1 ? "s" : ""}
      </p>
      <ul className="flex flex-col gap-3">
        {suggestions.map((s) => (
          <li key={`${s.manual.id}|${s.synced.id}`} className="flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-sm">
            <span className="flex flex-col">
              <span>Saisie : {s.manual.label} · {s.manual.date} · <span className="tabular-nums">{formatEur(s.manual.amount)}</span></span>
              <span className="text-muted-foreground">Banque : {s.synced.label} · {s.synced.date} · <span className="tabular-nums">{formatEur(s.synced.amount)}</span></span>
            </span>
            <span className="flex gap-2">
              <Button size="sm" disabled={isPending} onClick={() => act(() => mergeTransaction(s.synced.id, s.manual.id))}>Fusionner</Button>
              <Button size="sm" variant="outline" disabled={isPending} onClick={() => act(() => ignoreMatch(s.manual.id, s.synced.id))}>Ce n&apos;est pas la même</Button>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
```

- [ ] **Step 2: Calculer les suggestions et afficher le bandeau**

Dans `src/app/transactions/page.tsx` :

Ajouter les imports :

```tsx
import { listTransactions, findReconcileSuggestions } from "../../db/repositories/transactions";
import { ReconcileBanner } from "@/components/reconcile-banner";
```

(remplacer l'import existant de `listTransactions` par la ligne ci-dessus.)

Après le calcul de `groups`, ajouter :

```tsx
  const suggestions = findReconcileSuggestions(database).map((s) => ({
    manual: { id: s.manual.id, date: s.manual.date, amount: s.manual.amount, label: s.manual.label },
    synced: { id: s.synced.id, date: s.synced.date, amount: s.synced.amount, label: s.synced.label },
  }));
```

Remplacer le `return` par :

```tsx
  return (
    <div className="flex flex-col gap-4">
      <ReconcileBanner suggestions={suggestions} />
      <TransactionsBrowser transactions={transactions} groups={groups} accounts={accounts} />
    </div>
  );
```

- [ ] **Step 3: Vérifier les types**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 4: Contrôle manuel**

Scénario : ajouter une saisie manuelle de +50 le 2026-07-01 sur un compte, puis
insérer (via synchro ou insertion directe en base de test) une ligne bancaire de
+50 à 2 jours d'écart. Ouvrir `/transactions`.
Expected: bandeau « 1 rapprochement possible ». « Fusionner » ne laisse que la
ligne bancaire, avec le libellé manuel en commentaire et l'étiquette reportée.
« Ce n'est pas la même » fait disparaître la suggestion et ne la repropose plus.

- [ ] **Step 5: Commit**

```bash
git add src/components/reconcile-banner.tsx src/app/transactions/page.tsx
git commit -m "feat(transactions): bandeau de rapprochement (fusionner / écarter)"
```

---

### Task 11: UI — encart rémunération dans l'Historique

**Files:**
- Create: `src/components/remuneration-summary.tsx`
- Modify: `src/app/historique/page.tsx`

**Interfaces:**
- Consumes: `monthRemuneration` (lib), `MonthRemuneration`, `formatEur`.
- Produces: composant `RemunerationSummary` avec prop `{ months: MonthRemuneration[] }` ; n'affiche que les mois ayant du revenu ou des dépenses.

Note : vérification par `npx tsc --noEmit` puis contrôle manuel.

- [ ] **Step 1: Créer l'encart**

Créer `src/components/remuneration-summary.tsx` :

```tsx
import type { MonthRemuneration } from "@/lib/remuneration";
import { formatEur } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const money = (n: number) => <span className="tabular-nums whitespace-nowrap">{formatEur(n)}</span>;
const signed = (n: number) => (
  <span className={cn("tabular-nums whitespace-nowrap", n < 0 && "text-red-600")}>{formatEur(n)}</span>
);

export function RemunerationSummary({ months }: { months: MonthRemuneration[] }) {
  const shown = months.filter((m) => m.principal + m.supplementary + m.expenses > 0);
  if (shown.length === 0) return null;
  return (
    <Card className="flex flex-col gap-3 p-4">
      <h3 className="font-semibold">Rémunération par mois</h3>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead></TableHead>
              {shown.map((m) => <TableHead key={m.month} className="text-right">{m.month}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="text-muted-foreground">Principal reçu</TableCell>
              {shown.map((m) => <TableCell key={m.month} className="text-right">{money(m.principal)}</TableCell>)}
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">Supplémentaire reçu</TableCell>
              {shown.map((m) => <TableCell key={m.month} className="text-right">{money(m.supplementary)}</TableCell>)}
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">Dépenses</TableCell>
              {shown.map((m) => <TableCell key={m.month} className="text-right">{money(m.expenses)}</TableCell>)}
            </TableRow>
            <TableRow>
              <TableCell>Solde face au principal</TableCell>
              {shown.map((m) => <TableCell key={m.month} className="text-right">{signed(m.balanceVsPrincipal)}</TableCell>)}
            </TableRow>
            <TableRow>
              <TableCell>Solde face au principal + supplémentaire</TableCell>
              {shown.map((m) => <TableCell key={m.month} className="text-right">{signed(m.balanceVsTotal)}</TableCell>)}
            </TableRow>
            <TableRow className="font-semibold">
              <TableCell>À te verser le mois prochain</TableCell>
              {shown.map((m) => <TableCell key={m.month} className="text-right">{money(m.suggestedNextPrincipal)}</TableCell>)}
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
```

- [ ] **Step 2: Calculer et afficher l'encart dans l'Historique**

Dans `src/app/historique/page.tsx` :

Ajouter les imports :

```tsx
import { monthRemuneration } from "../../lib/remuneration";
import { RemunerationSummary } from "@/components/remuneration-summary";
```

Étendre le mapping `allTxns` pour inclure `incomeKind` (ajouter le champ dans
l'objet retourné par `.map`) :

```tsx
    incomeKind: t.incomeKind,
```

Dans la boucle `accounts.map((a) => { ... })`, après le calcul de `forecast`,
ajouter :

```tsx
          const remunMonths = months.map((m) => monthRemuneration(groups, txns, m));
```

Dans le `return` de cette itération (le `<TabsContent>`), insérer l'encart juste
avant le bloc `<div className="flex justify-end">` :

```tsx
              <RemunerationSummary months={remunMonths} />
```

- [ ] **Step 3: Vérifier les types**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 4: Vérifier toute la suite de tests**

Run: `npm test`
Expected: PASS (aucune régression).

- [ ] **Step 5: Contrôle manuel**

Run: `npm run dev` puis `/historique`.
Expected: pour un compte avec rémunération et dépenses, l'encart montre principal,
supplémentaire, dépenses, les deux soldes (dépassement en rouge face au principal),
et « À te verser le mois prochain » = principal + supplémentaire. Exemple attendu
avec 652,09 principal, 47,91 supplémentaire, 700 de dépenses : solde face au
principal −47,91, solde face au total 0, à verser 700.

- [ ] **Step 6: Commit**

```bash
git add src/components/remuneration-summary.tsx src/app/historique/page.tsx
git commit -m "feat(historique): encart rémunération principal/supplémentaire par mois"
```

---

## Notes de fin

- Rappel CLAUDE.md : ne jamais lancer `git commit`/`add`/`push` sans demande explicite de l'utilisateur. Les étapes « Commit » de ce plan ne s'exécutent que si l'utilisateur a choisi une exécution qui les autorise.
- Après implémentation, vérifier au serveur réel (pas seulement en `:memory:`) : dossier `data/`, colonnes réellement migrées sur la base existante, comportement du bouton d'ajout et du bandeau de rapprochement.
- Hors périmètre (spec) : solde provisoire incluant les manuelles en attente ; rapprochement automatique sans confirmation ; étiquetage limité à un groupe « rémunération » désigné.
