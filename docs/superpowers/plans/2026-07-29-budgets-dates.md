# Budgets datés : implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** faire du budget d'un groupe une suite de montants datés, seule source de
vérité, avec les lignes de récurrent qui portent leur propre suite.

**Architecture:** `budget_amounts` porte la suite des enveloppes et du groupe 0
(provision des non catégorisés). Une nouvelle table `line_amounts`, de même forme,
porte celle des lignes de récurrent. Le budget d'un récurrent devient la somme de
ses lignes en vigueur au mois demandé. `groups.monthly_amount` et
`group_lines.amount` ne sont plus lus par aucun calcul.

**Tech Stack:** Next.js 15 (App Router, server actions), TypeScript, better-sqlite3,
Vitest, Tailwind + shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-07-29-budgets-dates-design.md`

## Global Constraints

- Réponses et commentaires de code en français.
- La logique de calcul vit dans `src/lib/`, testée dans `tests/lib/`. Rien de
  calculé dans un composant.
- TDD strict : écrire le test, le lancer, le VOIR échouer, puis implémenter.
- `npx vitest run` doit être vert avant de commencer chaque tâche et après chaque
  commit. État de départ : **273 tests, 23 fichiers, tous verts**.
- Ne jamais dire « c'est corrigé » sans la sortie de la commande sous les yeux.
- Les montants sont des euros positifs pour les budgets ; les transactions sont
  signées (dépense négative).
- Une clé de mois est une chaîne `YYYY-MM`. Le mois de départ par défaut d'un
  groupe hérité est `2000-01`.
- Tolérance de comparaison des montants dans les tests : égalité stricte sur des
  valeurs choisies pour ne pas produire d'erreur flottante, sinon
  `toBeCloseTo(x, 2)`.

---

### Task 1: Filet de sécurité — figer les budgets actuels

But : un test de caractérisation qui enregistre les budgets produits aujourd'hui
par `computeHistory`, sur un jeu de données calqué sur la vraie base. Ce test doit
rester vert de la première à la dernière tâche. C'est lui qui prouve que la
refonte ne change aucun chiffre.

Ce test passe dès son écriture : c'est normal, il décrit l'existant. L'étape 2
vérifie qu'il n'est pas creux en le faisant échouer volontairement.

**Files:**
- Test (créer) : `tests/lib/budget-baseline.test.ts`

**Interfaces:**
- Consumes : `computeHistory`, `budgetInForce` de `src/lib/history.ts` ;
  `Group`, `Txn` de `src/lib/forecast.ts` (signatures actuelles).
- Produces : rien pour les autres tâches. Fichier de test uniquement.

- [ ] **Step 1: Écrire le test de caractérisation**

```ts
// tests/lib/budget-baseline.test.ts
import { describe, it, expect } from "vitest";
import { computeHistory } from "../../src/lib/history";
import type { Group, Txn } from "../../src/lib/forecast";

// Jeu calqué sur la vraie base : deux récurrents (Abonnements, Impôts), trois
// enveloppes de dépense (Carburant, Activités, Vêtement) et une rémunération.
// Ce fichier fige les budgets tels qu'ils sortent AUJOURD'HUI. Aucune tâche de
// la refonte n'a le droit de le faire bouger.
const abonnements: Group = {
  id: 13, accountId: "a1", name: "Abonnements", direction: "out", kind: "recurring",
  monthlyAmount: null, startMonth: "2000-01", endMonth: null,
  lines: [
    { id: 101, name: "Direct Assurance voiture", amount: 81.84, day: 5 },
    { id: 102, name: "Sosh Internet", amount: 30.99, day: 8 },
    { id: 103, name: "Sosh Mobile", amount: 15.99, day: 8 },
    { id: 104, name: "Spotify", amount: 12.14, day: 12 },
    { id: 105, name: "iCloud", amount: 9.99, day: 15 },
    { id: 106, name: "Fitness Park", amount: 19.99, day: 20 },
  ],
};
const impots: Group = {
  id: 15, accountId: "a1", name: "Impôts", direction: "out", kind: "recurring",
  monthlyAmount: null, startMonth: "2000-01", endMonth: null,
  lines: [{ id: 110, name: "Prélèvement à la source", amount: 49, day: 15 }],
};
const carburant: Group = {
  id: 14, accountId: "a1", name: "Carburant voiture", direction: "out", kind: "envelope",
  monthlyAmount: 85, lines: [], startMonth: "2000-01", endMonth: null,
};
const activites: Group = {
  id: 16, accountId: "a1", name: "Activités", direction: "out", kind: "envelope",
  monthlyAmount: 250, lines: [], startMonth: "2000-01", endMonth: null,
};
const vetement: Group = {
  id: 17, accountId: "a1", name: "Vêtement", direction: "out", kind: "envelope",
  monthlyAmount: 0, lines: [], startMonth: "2000-01", endMonth: null,
};
const remuneration: Group = {
  id: 21, accountId: "a1", name: "Rémunération Principale", direction: "in", kind: "envelope",
  monthlyAmount: 652.09, lines: [], incomeKind: "principal", startMonth: "2000-01", endMonth: null,
};
const GROUPS = [abonnements, impots, carburant, activites, vetement, remuneration];

const txns: Txn[] = [
  { id: "t1", date: "2026-07-05", amount: -151.84, label: "DIRECT ASSURANCE", accountId: "a1", groupId: 13, lineId: 101 },
  { id: "t2", date: "2026-07-08", amount: -30.99, label: "SOSH INTERNET", accountId: "a1", groupId: 13, lineId: 102 },
  { id: "t3", date: "2026-07-12", amount: -12.14, label: "SPOTIFY", accountId: "a1", groupId: 13, lineId: 104 },
  { id: "t4", date: "2026-07-15", amount: -1.99, label: "ICLOUD", accountId: "a1", groupId: 13, lineId: 105 },
  { id: "t5", date: "2026-07-20", amount: -19, label: "FITNESS PARK", accountId: "a1", groupId: 13, lineId: 106 },
  { id: "t6", date: "2026-07-15", amount: -49, label: "DGFIP", accountId: "a1", groupId: 15, lineId: 110 },
  { id: "t7", date: "2026-07-03", amount: -92.71, label: "TOTAL", accountId: "a1", groupId: 14 },
  { id: "t8", date: "2026-07-10", amount: -468.19, label: "CINEMA", accountId: "a1", groupId: 16 },
];

const MONTHS = ["2026-07", "2026-08", "2026-09"];

// Budget attendu par groupe, pour chacun des trois mois.
const ATTENDU: Record<number, number[]> = {
  13: [170.94, 170.94, 170.94], // somme des six lignes
  15: [49, 49, 49],
  14: [85, 85, 85],
  16: [250, 250, 250],
  17: [0, 0, 0],
  21: [652.09, 652.09, 652.09],
};

// Budget attendu par ligne de récurrent, pour chacun des trois mois.
const ATTENDU_LIGNES: Record<number, number[]> = {
  101: [81.84, 81.84, 81.84],
  102: [30.99, 30.99, 30.99],
  103: [15.99, 15.99, 15.99],
  104: [12.14, 12.14, 12.14],
  105: [9.99, 9.99, 9.99],
  106: [19.99, 19.99, 19.99],
  110: [49, 49, 49],
};

function budgetsParGroupe() {
  const sections = computeHistory(GROUPS, txns, MONTHS, "2026-07");
  const out: Record<number, number[]> = {};
  const outLignes: Record<number, number[]> = {};
  for (const s of sections) {
    for (const r of s.rows) {
      out[r.id] = r.cells.map((c) => c.budgeted);
      for (const sr of r.subRows) outLignes[sr.id] = sr.cells.map((c) => c.budgeted);
    }
  }
  return { out, outLignes };
}

describe("budgets de référence (ne doivent jamais bouger)", () => {
  it("garde le budget de chaque groupe sur trois mois", () => {
    const { out } = budgetsParGroupe();
    for (const [id, attendu] of Object.entries(ATTENDU)) {
      attendu.forEach((v, i) => expect(out[Number(id)][i]).toBeCloseTo(v, 2));
    }
  });

  it("garde le budget de chaque ligne de récurrent sur trois mois", () => {
    const { outLignes } = budgetsParGroupe();
    for (const [id, attendu] of Object.entries(ATTENDU_LIGNES)) {
      attendu.forEach((v, i) => expect(outLignes[Number(id)][i]).toBeCloseTo(v, 2));
    }
  });

  it("garde le dépensé et le reste du mois écoulé", () => {
    const sections = computeHistory(GROUPS, txns, MONTHS, "2026-07");
    const ligne = (id: number) => sections.flatMap((s) => s.rows).find((r) => r.id === id)!;
    // Abonnements : 215,96 dépensés pour 170,94 budgétés, soit 45,02 de dépassement.
    expect(ligne(13).cells[0].depense).toBeCloseTo(215.96, 2);
    expect(ligne(13).cells[0].balance).toBeCloseTo(-45.02, 2);
    // Activités : 468,19 dépensés pour 250 budgétés.
    expect(ligne(16).cells[0].balance).toBeCloseTo(-218.19, 2);
  });
});
```

- [ ] **Step 2: Lancer le test et vérifier qu'il passe, puis qu'il mord**

Run : `npx vitest run tests/lib/budget-baseline.test.ts`
Expected : PASS, 3 tests.

Puis vérifier qu'il n'est pas creux : changer temporairement `monthlyAmount: 250`
en `251` sur `activites`, relancer, constater l'échec sur le groupe 16, remettre
`250`, relancer, constater le retour au vert. Ne PAS commiter la valeur modifiée.

- [ ] **Step 3: Commit**

```bash
git add tests/lib/budget-baseline.test.ts
git commit -m "test(budgets): figer les budgets actuels avant la refonte des montants datés"
```

---

### Task 2: Table `line_amounts` et son repository

**Files:**
- Modifier : `src/db/schema.sql` (à la fin, après `budget_amounts`)
- Créer : `src/db/repositories/line-amounts.ts`
- Test (créer) : `tests/db/line-amounts.test.ts`

**Interfaces:**
- Consumes : rien.
- Produces :
  - `type LineAmount = { lineId: number; effectiveMonth: string; amount: number }`
  - `listLineAmounts(db): LineAmount[]`
  - `setLineAmount(db, lineId: number, effectiveMonth: string, amount: number): void`
  - `deleteLineAmount(db, lineId: number, effectiveMonth: string): void`

- [ ] **Step 1: Écrire le test**

```ts
// tests/db/line-amounts.test.ts
import { expect, test } from "vitest";
import { getDb } from "../../src/db/index";
import { upsertAccount } from "../../src/db/repositories/accounts";
import { insertRecurringGroup, insertLine, deleteLine } from "../../src/db/repositories/groups";
import { listLineAmounts, setLineAmount, deleteLineAmount } from "../../src/db/repositories/line-amounts";

function seed() {
  const db = getDb(":memory:");
  upsertAccount(db, { id: "a1", name: "CIC", iban_masked: null, balance: 0, currency: "EUR", last_synced: null });
  const gid = insertRecurringGroup(db, "a1", "Abonnements", "out", null, "2026-01", null);
  const lid = insertLine(db, gid, "Spotify", 12.14, 12);
  return { db, gid, lid };
}

test("setLineAmount pose un montant daté, puis l'écrase au même mois", () => {
  const { db, lid } = seed();
  setLineAmount(db, lid, "2026-08", 13.5);
  expect(listLineAmounts(db)).toEqual([{ lineId: lid, effectiveMonth: "2026-08", amount: 13.5 }]);
  setLineAmount(db, lid, "2026-08", 14);
  expect(listLineAmounts(db)).toEqual([{ lineId: lid, effectiveMonth: "2026-08", amount: 14 }]);
});

test("listLineAmounts trie par ligne puis par mois croissant", () => {
  const { db, lid } = seed();
  setLineAmount(db, lid, "2026-09", 15);
  setLineAmount(db, lid, "2026-07", 12.14);
  expect(listLineAmounts(db).map((r) => r.effectiveMonth)).toEqual(["2026-07", "2026-09"]);
});

test("deleteLineAmount retire une seule entrée", () => {
  const { db, lid } = seed();
  setLineAmount(db, lid, "2026-07", 12.14);
  setLineAmount(db, lid, "2026-09", 15);
  deleteLineAmount(db, lid, "2026-09");
  expect(listLineAmounts(db).map((r) => r.effectiveMonth)).toEqual(["2026-07"]);
});

test("supprimer une ligne emporte son historique de montants", () => {
  const { db, lid } = seed();
  setLineAmount(db, lid, "2026-07", 12.14);
  deleteLine(db, lid);
  expect(listLineAmounts(db)).toEqual([]);
});
```

- [ ] **Step 2: Lancer le test et le voir échouer**

Run : `npx vitest run tests/db/line-amounts.test.ts`
Expected : FAIL — `Failed to resolve import "../../src/db/repositories/line-amounts"`.

- [ ] **Step 3: Ajouter la table au schéma**

Dans `src/db/schema.sql`, tout à la fin du fichier :

```sql
-- Montants datés d'une ligne de récurrent. Même règle que budget_amounts : le
-- montant en vigueur au mois M est celui de la ligne au plus grand
-- effective_month <= M. Le budget d'un récurrent est la somme de ses lignes.
-- ON DELETE CASCADE : supprimer une ligne emporte son historique.
CREATE TABLE IF NOT EXISTS line_amounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  line_id INTEGER NOT NULL REFERENCES group_lines(id) ON DELETE CASCADE,
  effective_month TEXT NOT NULL,   -- YYYY-MM
  amount REAL NOT NULL,
  UNIQUE(line_id, effective_month)
);
```

`schema.sql` est exécuté à chaque `getDb` avec des `CREATE TABLE IF NOT EXISTS` :
aucune migration séparée n'est nécessaire pour créer la table sur une base
existante.

- [ ] **Step 4: Écrire le repository**

```ts
// src/db/repositories/line-amounts.ts
import type Database from "better-sqlite3";

export type LineAmount = { lineId: number; effectiveMonth: string; amount: number };

export function listLineAmounts(db: Database.Database): LineAmount[] {
  return db
    .prepare(
      `SELECT line_id AS lineId, effective_month AS effectiveMonth, amount
       FROM line_amounts ORDER BY line_id, effective_month`,
    )
    .all() as LineAmount[];
}

export function setLineAmount(db: Database.Database, lineId: number, effectiveMonth: string, amount: number): void {
  db.prepare(
    `INSERT INTO line_amounts (line_id, effective_month, amount) VALUES (?, ?, ?)
     ON CONFLICT(line_id, effective_month) DO UPDATE SET amount = excluded.amount`,
  ).run(lineId, effectiveMonth, amount);
}

// Retire une entrée datée (ex. annulation d'une hausse « permanent »).
export function deleteLineAmount(db: Database.Database, lineId: number, effectiveMonth: string): void {
  db.prepare(`DELETE FROM line_amounts WHERE line_id = ? AND effective_month = ?`).run(lineId, effectiveMonth);
}
```

- [ ] **Step 5: Lancer le test et le voir passer**

Run : `npx vitest run tests/db/line-amounts.test.ts`
Expected : PASS, 4 tests.

Puis toute la suite : `npx vitest run` → 280 tests verts.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.sql src/db/repositories/line-amounts.ts tests/db/line-amounts.test.ts
git commit -m "feat(db): table line_amounts et son repository"
```

---

### Task 3: Reprise de données

But : matérialiser les montants existants en première entrée datée, au mois de
départ du groupe. Après passage, tous les groupes et toutes les lignes ont une
entrée, donc plus aucun calcul ne dépend d'un montant de base.

**Files:**
- Modifier : `src/db/migrations.ts` (ajouter la fonction à la fin)
- Modifier : `src/db/index.ts` (l'appeler en dernier dans `getDb`)
- Test (créer) : `tests/db/seed-dated-amounts.test.ts`

**Interfaces:**
- Consumes : `listBudgetAmounts` de `budget-amounts.ts`, `listLineAmounts` de
  `line-amounts.ts` (Task 2).
- Produces : `migrateSeedDatedAmounts(db: Database.Database): void`

- [ ] **Step 1: Écrire le test**

```ts
// tests/db/seed-dated-amounts.test.ts
import { expect, test } from "vitest";
import Database from "better-sqlite3";
import { getDb } from "../../src/db/index";
import { migrateSeedDatedAmounts } from "../../src/db/migrations";
import { upsertAccount } from "../../src/db/repositories/accounts";
import { insertEnvelopeGroup, insertRecurringGroup, insertLine } from "../../src/db/repositories/groups";
import { listBudgetAmounts, setBudgetAmount } from "../../src/db/repositories/budget-amounts";
import { listLineAmounts } from "../../src/db/repositories/line-amounts";

// getDb applique déjà migrateSeedDatedAmounts : on part donc d'une base propre
// et on rappelle la migration pour vérifier l'idempotence.
function seed() {
  const db = getDb(":memory:");
  upsertAccount(db, { id: "a1", name: "CIC", iban_masked: null, balance: 0, currency: "EUR", last_synced: null });
  return db;
}

test("une enveloppe créée reçoit son montant comme première entrée datée", () => {
  const db = seed();
  const gid = insertEnvelopeGroup(db, "a1", "Activités", "out", 250, null, "2026-03", null);
  migrateSeedDatedAmounts(db);
  expect(listBudgetAmounts(db)).toEqual([{ groupId: gid, effectiveMonth: "2026-03", amount: 250 }]);
});

test("une ligne de récurrent reçoit son montant au mois de départ de son groupe", () => {
  const db = seed();
  const gid = insertRecurringGroup(db, "a1", "Abonnements", "out", null, "2026-03", null);
  const lid = insertLine(db, gid, "Spotify", 12.14, 12);
  migrateSeedDatedAmounts(db);
  expect(listLineAmounts(db)).toEqual([{ lineId: lid, effectiveMonth: "2026-03", amount: 12.14 }]);
  // Le groupe récurrent n'a AUCUN montant à lui.
  expect(listBudgetAmounts(db).filter((b) => b.groupId === gid)).toEqual([]);
});

test("un groupe sans mois de départ retombe sur 2000-01", () => {
  const db = seed();
  db.prepare(
    `INSERT INTO groups (account_id, name, direction, kind, monthly_amount, start_month) VALUES ('a1', 'Vieux', 'out', 'envelope', 42, NULL)`,
  ).run();
  const gid = db.prepare(`SELECT id FROM groups WHERE name = 'Vieux'`).get() as { id: number };
  migrateSeedDatedAmounts(db);
  expect(listBudgetAmounts(db)).toContainEqual({ groupId: gid.id, effectiveMonth: "2000-01", amount: 42 });
});

test("une enveloppe sans montant reçoit 0", () => {
  const db = seed();
  db.prepare(
    `INSERT INTO groups (account_id, name, direction, kind, monthly_amount, start_month) VALUES ('a1', 'Vide', 'out', 'envelope', NULL, '2026-01')`,
  ).run();
  const gid = db.prepare(`SELECT id FROM groups WHERE name = 'Vide'`).get() as { id: number };
  migrateSeedDatedAmounts(db);
  expect(listBudgetAmounts(db)).toContainEqual({ groupId: gid.id, effectiveMonth: "2026-01", amount: 0 });
});

test("la migration n'écrase pas une entrée déjà posée au mois de départ", () => {
  const db = seed();
  const gid = insertEnvelopeGroup(db, "a1", "Activités", "out", 250, null, "2026-03", null);
  setBudgetAmount(db, gid, "2026-03", 999);
  migrateSeedDatedAmounts(db);
  expect(listBudgetAmounts(db)).toEqual([{ groupId: gid, effectiveMonth: "2026-03", amount: 999 }]);
});

test("la migration est idempotente", () => {
  const db = seed();
  const gid = insertRecurringGroup(db, "a1", "Abonnements", "out", null, "2026-03", null);
  insertLine(db, gid, "Spotify", 12.14, 12);
  migrateSeedDatedAmounts(db);
  migrateSeedDatedAmounts(db);
  migrateSeedDatedAmounts(db);
  expect(listLineAmounts(db)).toHaveLength(1);
});

test("la provision des non catégorisés (groupe 0) n'est pas touchée", () => {
  const db = seed();
  setBudgetAmount(db, 0, "2026-07", 30);
  migrateSeedDatedAmounts(db);
  expect(listBudgetAmounts(db)).toEqual([{ groupId: 0, effectiveMonth: "2026-07", amount: 30 }]);
});

test("la migration tourne sur une base qui n'a pas encore line_amounts", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE groups (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT, name TEXT, direction TEXT, kind TEXT, monthly_amount REAL, start_month TEXT, end_month TEXT);
    CREATE TABLE group_lines (id INTEGER PRIMARY KEY AUTOINCREMENT, group_id INTEGER, name TEXT, amount REAL, day INTEGER, keyword TEXT);
    CREATE TABLE budget_amounts (id INTEGER PRIMARY KEY AUTOINCREMENT, group_id INTEGER NOT NULL, effective_month TEXT NOT NULL, amount REAL NOT NULL, UNIQUE(group_id, effective_month));
    INSERT INTO groups (account_id, name, direction, kind, monthly_amount, start_month) VALUES ('a1', 'Activités', 'out', 'envelope', 250, '2026-03');
  `);
  expect(() => migrateSeedDatedAmounts(db)).not.toThrow();
});
```

- [ ] **Step 2: Lancer le test et le voir échouer**

Run : `npx vitest run tests/db/seed-dated-amounts.test.ts`
Expected : FAIL — `migrateSeedDatedAmounts is not exported`.

- [ ] **Step 3: Écrire la migration**

À la fin de `src/db/migrations.ts` :

```ts
// Matérialise les montants « de base » en première entrée datée, au mois de
// départ du groupe : chaque enveloppe dans budget_amounts, chaque ligne de
// récurrent dans line_amounts. Après passage, plus aucun calcul n'a besoin de
// groups.monthly_amount ni de group_lines.amount.
//
// Idempotent : INSERT OR IGNORE sur la contrainte d'unicité, donc une entrée déjà
// posée (par l'utilisateur ou par un passage précédent) n'est jamais écrasée.
//
// Les entrées datées posées sur un groupe RÉCURRENT sont un vestige de l'ancien
// modèle : elles n'ont plus de sens (un récurrent n'a plus de montant propre) et
// ne sont plus lues. On les signale sans y toucher ; la base réelle n'en contient
// aucune.
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
        SELECT id, COALESCE(start_month, '2000-01'), COALESCE(monthly_amount, 0)
        FROM groups WHERE kind = 'envelope';
      INSERT OR IGNORE INTO line_amounts (line_id, effective_month, amount)
        SELECT l.id, COALESCE(g.start_month, '2000-01'), l.amount
        FROM group_lines l JOIN groups g ON g.id = l.group_id;
    `);
  })();
  const vestiges = db
    .prepare(`SELECT COUNT(*) AS n FROM budget_amounts b JOIN groups g ON g.id = b.group_id WHERE g.kind = 'recurring'`)
    .get() as { n: number };
  if (vestiges.n > 0) {
    console.warn(
      `[budgets] ${vestiges.n} montant(s) daté(s) posé(s) sur un groupe récurrent sont ignorés : ` +
        `un récurrent tire désormais son budget de ses lignes. À reporter à la main sur les lignes concernées.`,
    );
  }
}
```

- [ ] **Step 4: Brancher la migration**

Dans `src/db/index.ts`, ajouter `migrateSeedDatedAmounts` à la liste d'imports
(ligne 4) et l'appeler en **dernier** dans `getDb`, après
`migrateBudgetAmountsDropGroupFk(db)` :

```ts
  migrateBudgetAmountsDropGroupFk(db);
  migrateSeedDatedAmounts(db);
  return db;
```

L'ordre compte : elle a besoin de `start_month` (posé par `migrateGroupLifespan`)
et d'un `budget_amounts` sans clé étrangère vers `groups` (le groupe 0 n'existe
pas dans `groups`).

- [ ] **Step 5: Lancer le test et le voir passer**

Run : `npx vitest run tests/db/seed-dated-amounts.test.ts`
Expected : PASS, 8 tests.

Puis toute la suite : `npx vitest run` → 288 tests verts, dont
`tests/lib/budget-baseline.test.ts` toujours au vert.

- [ ] **Step 6: Commit**

```bash
git add src/db/migrations.ts src/db/index.ts tests/db/seed-dated-amounts.test.ts
git commit -m "feat(db): reprise des montants de base en première entrée datée"
```

---

### Task 4: Résolution du montant sans montant de base

C'est la tâche centrale. `budgetInForce` ne lit plus `monthlyAmount`, et le budget
d'un récurrent devient la somme de ses lignes datées. Les fixtures des tests
existants portent leurs montants dans `monthlyAmount` / `lines[].amount` : un
helper les convertit en montants datés, exactement comme le fait la migration.

**Files:**
- Modifier : `src/lib/history.ts:96-152` (`budgetOf`, `budgetInForce`, ajouts)
- Créer : `tests/lib/dated-fixtures.ts` (helper de test)
- Modifier : `tests/lib/history.test.ts`
- Modifier : `tests/lib/history-ignored.test.ts`

**Interfaces:**
- Consumes : `Group` de `src/lib/forecast.ts`.
- Produces, dans `src/lib/history.ts` :
  - `type DatedLineAmounts = Record<number, { effectiveMonth: string; amount: number }[]>`
  - `lineAmountInForce(lineId: number, month: string, datedLines?: DatedLineAmounts): number`
  - `budgetInForce(g: Group, month: string, dated?: DatedBudgets, datedLines?: DatedLineAmounts): number`
  - `toDatedLineAmounts(rows: { lineId: number; effectiveMonth: string; amount: number }[]): DatedLineAmounts`
  - `budgetOf` est supprimé.
- Produces, dans `tests/lib/dated-fixtures.ts` :
  - `seedDated(groups: Group[]): { dated: DatedBudgets; datedLines: DatedLineAmounts }`
  - `mergeDated(a: DatedBudgets, b?: DatedBudgets): DatedBudgets`

- [ ] **Step 1: Écrire le helper de fixtures**

Ce n'est pas du code testé, c'est de l'outillage de test. Il reproduit la
migration de la Task 3 sur des fixtures en mémoire.

```ts
// tests/lib/dated-fixtures.ts
import { toDatedBudgets, toDatedLineAmounts, type DatedBudgets, type DatedLineAmounts } from "../../src/lib/history";
import type { Group } from "../../src/lib/forecast";

// Reproduit migrateSeedDatedAmounts sur des fixtures : le montant porté par la
// fixture (monthlyAmount pour une enveloppe, amount pour une ligne) devient la
// première entrée datée, au mois de départ du groupe.
export function seedDated(groups: Group[]): { dated: DatedBudgets; datedLines: DatedLineAmounts } {
  const start = (g: Group) => g.startMonth ?? "2000-01";
  const budgets = groups
    .filter((g) => g.kind === "envelope")
    .map((g) => ({ groupId: g.id, effectiveMonth: start(g), amount: g.monthlyAmount ?? 0 }));
  const lines = groups.flatMap((g) =>
    g.lines.map((l) => ({ lineId: l.id, effectiveMonth: start(g), amount: l.amount })),
  );
  return { dated: toDatedBudgets(budgets), datedLines: toDatedLineAmounts(lines) };
}

// Fusionne les entrées de départ et celles posées explicitement par un test, en
// gardant chaque suite triée par mois croissant. À mois égal, l'entrée du test gagne.
export function mergeDated(a: DatedBudgets, b?: DatedBudgets): DatedBudgets {
  if (!b) return a;
  const out: DatedBudgets = {};
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const id = Number(key);
    const parMois = new Map<string, number>();
    for (const e of a[id] ?? []) parMois.set(e.effectiveMonth, e.amount);
    for (const e of b[id] ?? []) parMois.set(e.effectiveMonth, e.amount);
    out[id] = [...parMois.entries()]
      .map(([effectiveMonth, amount]) => ({ effectiveMonth, amount }))
      .sort((x, y) => (x.effectiveMonth < y.effectiveMonth ? -1 : 1));
  }
  return out;
}
```

- [ ] **Step 2: Écrire les tests de résolution**

À ajouter dans `tests/lib/history.test.ts`, dans un nouveau bloc en fin de
fichier. Importer d'abord `lineAmountInForce` et `toDatedLineAmounts` depuis
`../../src/lib/history`, et `seedDated` depuis `./dated-fixtures`.

```ts
describe("montant en vigueur", () => {
  const spotify = { id: 11, name: "Spotify", amount: 10, day: 3 };
  const netflix = { id: 12, name: "Netflix", amount: 15, day: 8 };
  const recurrent: Group = {
    id: 2, accountId: "a1", name: "Abonnements", direction: "out", kind: "recurring",
    monthlyAmount: null, lines: [spotify, netflix], startMonth: "2026-01", endMonth: null,
  };
  const enveloppe: Group = {
    id: 1, accountId: "a1", name: "Courses", direction: "out", kind: "envelope",
    monthlyAmount: 300, lines: [], startMonth: "2026-01", endMonth: null,
  };

  it("rend 0 quand aucune entrée n'existe", () => {
    expect(budgetInForce(enveloppe, "2026-07", {}, {})).toBe(0);
    expect(lineAmountInForce(11, "2026-07", {})).toBe(0);
  });

  it("rend 0 pour les mois antérieurs à la première entrée", () => {
    const { dated, datedLines } = seedDated([enveloppe]);
    expect(budgetInForce(enveloppe, "2025-12", dated, datedLines)).toBe(0);
    expect(budgetInForce(enveloppe, "2026-01", dated, datedLines)).toBe(300);
  });

  it("rend la dernière entrée dont le mois est atteint", () => {
    const dated = toDatedBudgets([
      { groupId: 1, effectiveMonth: "2026-01", amount: 300 },
      { groupId: 1, effectiveMonth: "2026-08", amount: 400 },
      { groupId: 1, effectiveMonth: "2026-11", amount: 450 },
    ]);
    expect(budgetInForce(enveloppe, "2026-07", dated, {})).toBe(300);
    expect(budgetInForce(enveloppe, "2026-08", dated, {})).toBe(400);
    expect(budgetInForce(enveloppe, "2026-10", dated, {})).toBe(400);
    expect(budgetInForce(enveloppe, "2026-11", dated, {})).toBe(450);
  });

  it("fait du budget d'un récurrent la somme de ses lignes du mois", () => {
    const { dated, datedLines } = seedDated([recurrent]);
    expect(budgetInForce(recurrent, "2026-07", dated, datedLines)).toBe(25);
  });

  it("suit une hausse posée sur une seule ligne", () => {
    const datedLines = toDatedLineAmounts([
      { lineId: 11, effectiveMonth: "2026-01", amount: 10 },
      { lineId: 12, effectiveMonth: "2026-01", amount: 15 },
      { lineId: 12, effectiveMonth: "2026-08", amount: 20 },
    ]);
    expect(budgetInForce(recurrent, "2026-07", {}, datedLines)).toBe(25);
    expect(budgetInForce(recurrent, "2026-08", {}, datedLines)).toBe(30);
    expect(lineAmountInForce(12, "2026-08", datedLines)).toBe(20);
  });

  it("ignore un montant daté posé sur un groupe récurrent", () => {
    const dated = toDatedBudgets([{ groupId: 2, effectiveMonth: "2026-01", amount: 999 }]);
    const { datedLines } = seedDated([recurrent]);
    expect(budgetInForce(recurrent, "2026-07", dated, datedLines)).toBe(25);
  });

  it("compte une ligne créée après le départ du groupe seulement à partir de son entrée", () => {
    const datedLines = toDatedLineAmounts([
      { lineId: 11, effectiveMonth: "2026-01", amount: 10 },
      { lineId: 12, effectiveMonth: "2026-06", amount: 15 },
    ]);
    expect(budgetInForce(recurrent, "2026-05", {}, datedLines)).toBe(10);
    expect(budgetInForce(recurrent, "2026-06", {}, datedLines)).toBe(25);
  });
});
```

- [ ] **Step 3: Lancer les tests et les voir échouer**

Run : `npx vitest run tests/lib/history.test.ts -t "montant en vigueur"`
Expected : FAIL — `lineAmountInForce is not exported`.

- [ ] **Step 4: Implémenter la résolution**

Dans `src/lib/history.ts`, **supprimer** `budgetOf` (lignes 96-98) et remplacer le
bloc `budgetInForce` / `provisionInForce` par :

```ts
// Budgets datés : pour chaque groupe, la liste de ses montants avec leur mois
// d'entrée en vigueur (triée par mois croissant). Le montant en vigueur pour un
// mois M est celui de la dernière entrée dont effectiveMonth <= M. Sans entrée
// applicable, le montant est 0 : il n'existe PLUS de montant de base sur lequel
// retomber, c'est ce repli qui faisait diverger l'affichage et le calcul.
// La reprise de données garantit une entrée au mois de départ de chaque groupe.
export type DatedBudgets = Record<number, { effectiveMonth: string; amount: number }[]>;

// Même chose pour les lignes d'un récurrent, indexé par identifiant de ligne.
export type DatedLineAmounts = Record<number, { effectiveMonth: string; amount: number }[]>;

// Montant en vigueur d'une ligne de récurrent à `month`, 0 par défaut.
export function lineAmountInForce(lineId: number, month: string, datedLines?: DatedLineAmounts): number {
  let amount = 0;
  for (const b of datedLines?.[lineId] ?? []) if (b.effectiveMonth <= month) amount = b.amount;
  return amount;
}

// Budget en vigueur d'un groupe à `month`. Un récurrent n'a pas de montant à lui :
// son budget est la somme de ses lignes telles qu'elles sont ce mois-là. Les
// entrées éventuellement posées sur un groupe récurrent sont donc ignorées.
export function budgetInForce(
  g: Group,
  month: string,
  dated?: DatedBudgets,
  datedLines?: DatedLineAmounts,
): number {
  if (g.kind === "recurring") {
    return g.lines.reduce((s, l) => s + lineAmountInForce(l.id, month, datedLines), 0);
  }
  let amount = 0;
  for (const b of dated?.[g.id] ?? []) if (b.effectiveMonth <= month) amount = b.amount;
  return amount;
}
```

`provisionInForce` reste inchangée. Ajouter, juste après `toDatedBudgets` :

```ts
// Regroupe les montants de lignes par ligne, en conservant le tri par mois.
export function toDatedLineAmounts(
  rows: { lineId: number; effectiveMonth: string; amount: number }[],
): DatedLineAmounts {
  const out: DatedLineAmounts = {};
  for (const r of rows) (out[r.lineId] ??= []).push({ effectiveMonth: r.effectiveMonth, amount: r.amount });
  return out;
}
```

Dans `onceBudgetWrites`, le paramètre `baseBudget` n'a plus de sens : il vaut
toujours 0 maintenant. Le supprimer de la signature et remplacer son usage. Ses
deux appelants dans `src/app/historique/actions.ts` (`setGroupAmount` et
`setUncatProvision`) cassent aussitôt : y retirer l'argument dès maintenant, sans
attendre la Task 7, sinon `tsc` reste rouge entre les deux tâches.

```ts
export function onceBudgetWrites(
  datedForGroup: { effectiveMonth: string; amount: number }[],
  month: string,
  amount: number,
): { writes: { effectiveMonth: string; amount: number }[] } {
  const next = addMonthsKey(month, 1);
  // Valeur en vigueur à `month`, en ignorant une éventuelle entrée déjà posée
  // exactement à `month` (la précédente application « ce mois seulement »).
  let prev = 0;
  for (const b of datedForGroup) if (b.effectiveMonth !== month && b.effectiveMonth <= month) prev = b.amount;
  const writes = [{ effectiveMonth: month, amount }];
  if (!datedForGroup.some((b) => b.effectiveMonth === next)) writes.push({ effectiveMonth: next, amount: prev });
  return { writes };
}
```

Adapter aussi les appels dans `tests/lib/history.test.ts` (retirer l'argument
`baseBudget`). Le calcul du budget de base par `listGroups` + `budgetInForce`
dans `setGroupAmount` devient mort : le supprimer, ainsi que les imports devenus
inutiles (`listGroups`, `budgetInForce`, type `Group`).

- [ ] **Step 5: Adapter les appels de test, mécaniquement**

`budgetInForce` ne lit plus les fixtures : sans montants datés, tous les budgets
tombent à 0 et la quasi-totalité des tests de `history.test.ts` échoue. C'est
attendu. On introduit des enveloppes locales qui sèment les montants.

En tête de `tests/lib/history.test.ts`, après les imports, ajouter :

```ts
import { seedDated, mergeDated } from "./dated-fixtures";

// Enveloppes locales : sèment les montants des fixtures comme le fait la reprise
// de données, pour que les tests continuent d'exprimer leurs montants dans les
// fixtures plutôt que dans des tables datées écrites à la main.
const hist = (
  groups: Group[], txns: Txn[], months: string[], current: string, extra?: DatedBudgets,
) => {
  const { dated, datedLines } = seedDated(groups);
  return computeHistory(groups, txns, months, current, mergeDated(dated, extra), datedLines);
};
const over = (
  groups: Group[], txns: Txn[], current: string,
  decided: { groupId: number; month: string; decision?: "exceptional" | "permanent" }[],
  extra?: DatedBudgets,
) => {
  const { dated, datedLines } = seedDated(groups);
  return computeOverspends(groups, txns, current, decided, mergeDated(dated, extra), datedLines);
};
```

Puis le remplacement mécanique, qui ne doit PAS toucher les lignes d'import :

```bash
sed -i '' 's/= computeHistory(/= hist(/g; s/(computeHistory(/(hist(/g' tests/lib/history.test.ts
sed -i '' 's/= computeOverspends(/= over(/g; s/(computeOverspends(/(over(/g' tests/lib/history.test.ts
sed -i '' 's/= computeHistory(/= hist(/g' tests/lib/history-ignored.test.ts
```

Puis, à la main :
- `tests/lib/history-ignored.test.ts` : y recopier la même enveloppe `hist` (2
  appels) ainsi que les imports de `seedDated` / `mergeDated`.
- `tests/lib/history.test.ts` ligne 711 environ : un appel
  `computeOverspends(...)` dont le résultat n'est pas affecté (`computeOverspends([courses], ...)`
  seul sur sa ligne) — le renommer à la main en `over(`.
- Les 5 appels directs à `budgetInForce` (lignes 570-573 environ) : leur passer
  `seedDated([courses]).datedLines` en quatrième argument, et fusionner le `dated`
  local avec `seedDated([courses]).dated` via `mergeDated`.
- Les tests qui vérifiaient explicitement le repli sur `monthlyAmount` (chercher
  `budgetInForce` et `sans entrée`) : leur attendu passe de `monthlyAmount` à `0`,
  ou ils reçoivent un `seedDated`. Décider au cas par cas en relisant l'intention
  du test.

- [ ] **Step 6: Lancer toute la suite jusqu'au vert**

Run : `npx vitest run`
Expected : PASS. `tests/lib/budget-baseline.test.ts` doit être vert **sans avoir
été modifié** — c'est la preuve que les chiffres n'ont pas bougé.

Note : `budget-baseline.test.ts` appelle `computeHistory` sans montants datés.
Après cette tâche il rendrait 0 partout. Il faut donc y appliquer le même helper :
remplacer ses trois appels `computeHistory(GROUPS, txns, MONTHS, "2026-07")` par
`hist(GROUPS, txns, MONTHS, "2026-07")` avec la même enveloppe locale. **Les
valeurs attendues, elles, ne changent pas d'un centime.** Si l'une d'elles doit
changer pour que le test passe, c'est un bug : arrêter et comprendre.

- [ ] **Step 7: Vérifier le typage**

Run : `npx tsc --noEmit`
Expected : erreurs sur `src/lib/forecast.ts` et `src/app/historique/page.tsx`
uniquement (traitées en Task 5 et 6). Aucune erreur dans `src/lib/history.ts` ni
dans `src/app/historique/actions.ts` (l'argument `baseBudget` y a été retiré à
l'étape précédente).

- [ ] **Step 8: Commit**

```bash
git add src/lib/history.ts tests/lib/
git commit -m "feat(budgets): le montant en vigueur ne vient plus que des entrées datées"
```

---

### Task 5: Propager les montants de lignes dans les calculs

`computeHistory` doit dater les lignes de récurrent (aujourd'hui `l.amount`
constant), et `computeOverspends` comme `computeForecast` doivent recevoir la
même information pour ne pas diverger.

**Files:**
- Modifier : `src/lib/history.ts` (`computeHistory` ~166, `computeOverspends` ~635)
- Modifier : `src/lib/forecast.ts` (`computeForecast` ~102, boucle des lignes ~177)
- Modifier : `tests/lib/history.test.ts`, `tests/lib/forecast.test.ts`

**Interfaces:**
- Consumes : `lineAmountInForce`, `DatedLineAmounts`, `budgetInForce` (Task 4).
- Produces :
  - `computeHistory(groups, txns, months, currentMonth, dated?, datedLines?)`
  - `computeOverspends(groups, txns, currentMonth, decided, dated?, datedLines?)`
  - `computeForecast(accountId, balance, groups, txns, month, dated?, datedLines?)`

- [ ] **Step 1: Écrire le test**

Dans `tests/lib/history.test.ts`, bloc `montant en vigueur` :

```ts
it("date le budget des lignes affichées d'un récurrent", () => {
  const datedLines = toDatedLineAmounts([
    { lineId: 11, effectiveMonth: "2026-01", amount: 10 },
    { lineId: 12, effectiveMonth: "2026-01", amount: 15 },
    { lineId: 12, effectiveMonth: "2026-08", amount: 20 },
  ]);
  const sections = computeHistory([recurrent], [], ["2026-07", "2026-08"], "2026-07", {}, datedLines);
  const row = sections.flatMap((s) => s.rows).find((r) => r.id === 2)!;
  const netflix = row.subRows.find((sr) => sr.id === 12)!;
  expect(netflix.cells.map((c) => c.budgeted)).toEqual([15, 20]);
  expect(row.cells.map((c) => c.budgeted)).toEqual([25, 30]);
});

it("voit un dépassement disparaître quand la ligne est relevée", () => {
  const txns = [
    tx({ id: "a", date: "2026-07-08", amount: -20, label: "NETFLIX", groupId: 2, lineId: 12 }),
    tx({ id: "b", date: "2026-08-08", amount: -20, label: "NETFLIX", groupId: 2, lineId: 12 }),
  ];
  const datedLines = toDatedLineAmounts([
    { lineId: 11, effectiveMonth: "2026-01", amount: 10 },
    { lineId: 12, effectiveMonth: "2026-01", amount: 15 },
    { lineId: 12, effectiveMonth: "2026-08", amount: 20 },
  ]);
  const r = computeOverspends([recurrent], txns, "2026-08", [], {}, datedLines);
  // Juillet dépasse de 5 (20 dépensés pour 15 budgétés), août non (20 pour 20).
  expect(r.pendingClosed).toEqual([
    { groupId: 2, name: "Abonnements", month: "2026-07", amount: 5, kind: "recurring" },
  ]);
});
```

Dans `tests/lib/forecast.test.ts`, en fin de fichier :

```ts
it("prend le montant en vigueur du mois, pas celui de la fixture", () => {
  const g: Group = {
    id: 1, accountId: "a1", name: "Courses", direction: "out", kind: "envelope",
    monthlyAmount: 300, lines: [], startMonth: "2026-01", endMonth: null,
  };
  const dated = toDatedBudgets([
    { groupId: 1, effectiveMonth: "2026-01", amount: 300 },
    { groupId: 1, effectiveMonth: "2026-07", amount: 500 },
  ]);
  const f = computeForecast("a1", 1000, [g], [], "2026-07", dated, {});
  // Rien de dépensé : l'estimé de fin de mois est le solde moins le reste à
  // dépenser, soit 1000 − 500. Avec le montant de fixture (300) il vaudrait 700.
  expect(f.currentEstimate).toBeCloseTo(500, 2);
  expect(f.groups.find((x) => x.id === 1)?.total).toBeCloseTo(500, 2);
});
```

- [ ] **Step 2: Lancer les tests et les voir échouer**

Run : `npx vitest run tests/lib/history.test.ts tests/lib/forecast.test.ts`
Expected : FAIL — les lignes rendent `[15, 15]` au lieu de `[15, 20]`, et
`computeForecast` refuse deux arguments de trop.

- [ ] **Step 3: Dater les lignes dans computeHistory**

Signature (`src/lib/history.ts:166`) :

```ts
export function computeHistory(
  groups: Group[],
  txns: Txn[],
  months: string[],
  currentMonth: string,
  dated?: DatedBudgets,
  datedLines?: DatedLineAmounts,
): HistorySection[] {
```

Ligne 228, passer les montants de lignes :

```ts
    const cells = cellsFor((m) => (isGroupAlive(g, m) ? budgetInForce(g, m, dated, datedLines) : 0), isOut, (m) => spent(g.id, m));
```

Ligne 240, remplacer le montant constant de la ligne :

```ts
        cells: cellsFor((m) => (isGroupAlive(g, m) ? lineAmountInForce(l.id, m, datedLines) : 0), isOut, realizedOf),
```

- [ ] **Step 4: Dater les lignes dans computeOverspends**

Signature (`src/lib/history.ts:635`) : ajouter `datedLines?: DatedLineAmounts` en
dernier paramètre. Ligne 674 :

```ts
      const os = Math.max(0, spent - budgetInForce(g, m, dated, datedLines));
```

- [ ] **Step 5: Dater les lignes dans computeForecast**

Dans `src/lib/forecast.ts`, signature :

```ts
export function computeForecast(
  accountId: string,
  balance: number,
  groups: Group[],
  txns: Txn[],
  month: string,
  dated?: DatedBudgets,
  datedLines?: DatedLineAmounts,
): AccountForecast {
```

Importer en tête du fichier :

```ts
import { budgetInForce, lineAmountInForce, type DatedBudgets, type DatedLineAmounts } from "./history";
```

Attention au cycle d'import : `history.ts` importe déjà `forecast.ts` (pour
`Group`, `Txn`, `isGroupAlive`). Un import croisé de types seuls est effacé à la
compilation, mais `budgetInForce` et `lineAmountInForce` sont des valeurs. Pour
éviter le cycle, **déplacer** `lineAmountInForce`, `budgetInForce`,
`provisionInForce`, `toDatedBudgets`, `toDatedLineAmounts`, `onceBudgetWrites` et
les types `DatedBudgets` / `DatedLineAmounts` dans un nouveau module
`src/lib/budget-in-force.ts`, que `history.ts` et `forecast.ts` importent tous les
deux. Ne pas l'appeler `budget-amounts.ts` : ce nom est déjà pris par
`src/db/repositories/budget-amounts.ts` et la confusion serait garantie.
`history.ts` les ré-exporte pour ne pas casser ses consommateurs :

```ts
// src/lib/history.ts, en tête
export {
  lineAmountInForce, budgetInForce, provisionInForce, toDatedBudgets,
  toDatedLineAmounts, onceBudgetWrites,
  type DatedBudgets, type DatedLineAmounts,
} from "./budget-in-force";
```

`src/lib/budget-in-force.ts` n'importe que `Group` depuis `forecast.ts`, en
`import type` : aucun cycle à l'exécution.

Puis, ligne 143 de `forecast.ts`, remplacer `g.monthlyAmount ?? 0` par
`budgetInForce(g, month, dated, datedLines)` ; et lignes 177-188, remplacer chaque
`line.amount` par `lineAmountInForce(line.id, month, datedLines)` — le calculer une
fois en tête de boucle dans une constante `const montant = lineAmountInForce(line.id, month, datedLines);`
et l'utiliser partout à la place.

- [ ] **Step 6: Adapter les tests de forecast**

`tests/lib/forecast.test.ts` porte ses montants dans les fixtures : ajouter une
enveloppe locale, comme en Task 4.

```ts
import { seedDated } from "./dated-fixtures";

const fc = (accountId: string, balance: number, groups: Group[], txns: Txn[], month: string) => {
  const { dated, datedLines } = seedDated(groups);
  return computeForecast(accountId, balance, groups, txns, month, dated, datedLines);
};
```

```bash
sed -i '' 's/= computeForecast(/= fc(/g; s/(computeForecast(/(fc(/g' tests/lib/forecast.test.ts
```

Puis relire le fichier : le test ajouté à l'étape 1 doit garder l'appel direct à
`computeForecast` (il passe ses propres montants datés).

- [ ] **Step 7: Lancer toute la suite**

Run : `npx vitest run` puis `npx tsc --noEmit`
Expected : tests verts sauf `src/app/historique/page.tsx` côté typage (Task 6).
`budget-baseline.test.ts` toujours vert, valeurs inchangées.

- [ ] **Step 8: Commit**

```bash
git add src/lib/ tests/lib/
git commit -m "feat(budgets): les lignes de récurrent portent leur propre montant daté"
```

---

### Task 6: Câbler la page Historique

**Files:**
- Modifier : `src/app/historique/page.tsx:1-20` (imports), `:31-33`, `:110-121`

**Interfaces:**
- Consumes : `listLineAmounts` (Task 2), `toDatedLineAmounts`, `computeHistory`,
  `computeOverspends`, `computeForecast`, `budgetInForce` (Tasks 4 et 5).
- Produces : rien.

- [ ] **Step 1: Charger les montants de lignes**

Dans les imports :

```ts
import { listLineAmounts } from "../../db/repositories/line-amounts";
```

et ajouter `toDatedLineAmounts` à l'import groupé depuis `../../lib/history`.

Après `const datedBudgets = toDatedBudgets(listBudgetAmounts(database));` :

```ts
  const datedLines = toDatedLineAmounts(listLineAmounts(database));
```

- [ ] **Step 2: Passer les montants à chaque calcul**

Quatre appels à corriger dans le corps de la boucle par compte :

```ts
          const forecast = computeForecast(a.id, balance, groups, txns, currentMonth, datedBudgets, datedLines);
          const sectionsFull = computeHistory(groups, txns, calcMonths, currentMonth, datedBudgets, datedLines);
          const overspends = computeOverspends(groups, txns, currentMonth, decisions, datedBudgets, datedLines);
          const currentBudgets = Object.fromEntries(
            groups.map((g) => [g.id, budgetInForce(g, currentMonth, datedBudgets, datedLines)]),
          );
```

- [ ] **Step 3: Vérifier le typage et les tests**

Run : `npx tsc --noEmit`
Expected : aucune erreur.

Run : `npx vitest run`
Expected : tout vert.

- [ ] **Step 4: Vérifier dans le vrai serveur**

Cette étape n'a pas de test unitaire utile.

Run : `npm run dev -- --experimental-https`, ouvrir `https://localhost:3000/historique`.
Attendu : les budgets affichés sont **identiques** à ceux d'avant la refonte
(Abonnements 170,94 ; Impôts 49,00 ; Carburant 85,00 ; Activités 250,00). Le
détail d'une ligne de récurrent affiche le même montant qu'avant.
Vérifier aussi la console du serveur : aucun avertissement `[budgets]`.

- [ ] **Step 5: Commit**

```bash
git add src/app/historique/page.tsx
git commit -m "feat(budgets): la page Historique lit les montants datés des lignes"
```

---

### Task 7: Créer et modifier écrit des entrées datées

Toute écriture de montant passe désormais par les tables datées. Les deux
fonctions mortes de `groups.ts` disparaissent.

**Files:**
- Modifier : `src/db/repositories/groups.ts:135-144` (suppression), `:100-130`
- Modifier : `src/app/historique/actions.ts` (`createGroup`, `createRemuneration`,
  `addGroupLine`, `editGroupLine`, `setGroupAmount`, `setUncatProvision`)
- Test (créer) : `tests/db/dated-writes.test.ts`

**Interfaces:**
- Consumes : `setBudgetAmount`, `setLineAmount`, `onceBudgetWrites` (Task 4,
  signature sans `baseBudget`), `listBudgetAmounts`, `listLineAmounts`.
- Produces :
  - `editGroupLine(lineId: number, name: string, day: number, month: string, amount: number, scope: "once" | "ongoing"): Promise<void>`
  - `addGroupLine(groupId: number, name: string, amount: number, day: number, month: string): Promise<number>`
  - `setLineAmountAction(lineId: number, month: string, amount: number, scope: "once" | "ongoing"): Promise<void>`

- [ ] **Step 1: Écrire le test**

```ts
// tests/db/dated-writes.test.ts
import { expect, test } from "vitest";
import { getDb } from "../../src/db/index";
import { upsertAccount } from "../../src/db/repositories/accounts";
import { insertEnvelopeGroup, insertRecurringGroup, insertLine } from "../../src/db/repositories/groups";
import { listBudgetAmounts, setBudgetAmount } from "../../src/db/repositories/budget-amounts";
import { listLineAmounts, setLineAmount } from "../../src/db/repositories/line-amounts";
import { onceBudgetWrites, toDatedBudgets, toDatedLineAmounts, budgetInForce, lineAmountInForce } from "../../src/lib/history";
import type { Group } from "../../src/lib/forecast";

function seed() {
  const db = getDb(":memory:");
  upsertAccount(db, { id: "a1", name: "CIC", iban_masked: null, balance: 0, currency: "EUR", last_synced: null });
  return db;
}

test("une enveloppe créée est immédiatement lisible à son mois de départ", () => {
  const db = seed();
  const gid = insertEnvelopeGroup(db, "a1", "Activités", "out", 250, null, "2026-03", null);
  // getDb a déjà lancé la reprise ; ici c'est la création qui doit poser l'entrée.
  setBudgetAmount(db, gid, "2026-03", 250);
  const g: Group = { id: gid, accountId: "a1", name: "Activités", direction: "out", kind: "envelope", monthlyAmount: null, lines: [], startMonth: "2026-03", endMonth: null };
  const dated = toDatedBudgets(listBudgetAmounts(db));
  expect(budgetInForce(g, "2026-02", dated, {})).toBe(0);
  expect(budgetInForce(g, "2026-03", dated, {})).toBe(250);
  expect(budgetInForce(g, "2027-01", dated, {})).toBe(250);
});

test("une ligne ajoutée en cours de route ne compte qu'à partir de son mois", () => {
  const db = seed();
  const gid = insertRecurringGroup(db, "a1", "Abonnements", "out", null, "2026-01", null);
  const l1 = insertLine(db, gid, "Spotify", 10, 3);
  setLineAmount(db, l1, "2026-01", 10);
  const l2 = insertLine(db, gid, "Netflix", 15, 8);
  setLineAmount(db, l2, "2026-06", 15);
  const g: Group = {
    id: gid, accountId: "a1", name: "Abonnements", direction: "out", kind: "recurring",
    monthlyAmount: null, startMonth: "2026-01", endMonth: null,
    lines: [{ id: l1, name: "Spotify", amount: 10, day: 3 }, { id: l2, name: "Netflix", amount: 15, day: 8 }],
  };
  const datedLines = toDatedLineAmounts(listLineAmounts(db));
  expect(budgetInForce(g, "2026-05", {}, datedLines)).toBe(10);
  expect(budgetInForce(g, "2026-06", {}, datedLines)).toBe(25);
});

test("« ce mois seulement » sur une ligne restaure le montant au mois suivant", () => {
  const db = seed();
  const gid = insertRecurringGroup(db, "a1", "Abonnements", "out", null, "2026-01", null);
  const lid = insertLine(db, gid, "Spotify", 10, 3);
  setLineAmount(db, lid, "2026-01", 10);
  const existantes = toDatedLineAmounts(listLineAmounts(db))[lid] ?? [];
  const { writes } = onceBudgetWrites(existantes, "2026-07", 25);
  for (const w of writes) setLineAmount(db, lid, w.effectiveMonth, w.amount);
  const datedLines = toDatedLineAmounts(listLineAmounts(db));
  expect(lineAmountInForce(lid, "2026-06", datedLines)).toBe(10);
  expect(lineAmountInForce(lid, "2026-07", datedLines)).toBe(25);
  expect(lineAmountInForce(lid, "2026-08", datedLines)).toBe(10);
});

test("« ce mois seulement » n'écrase pas un changement déjà prévu au mois suivant", () => {
  const db = seed();
  const gid = insertRecurringGroup(db, "a1", "Abonnements", "out", null, "2026-01", null);
  const lid = insertLine(db, gid, "Spotify", 10, 3);
  setLineAmount(db, lid, "2026-01", 10);
  setLineAmount(db, lid, "2026-08", 30); // hausse permanente déjà décidée
  const existantes = toDatedLineAmounts(listLineAmounts(db))[lid] ?? [];
  const { writes } = onceBudgetWrites(existantes, "2026-07", 25);
  for (const w of writes) setLineAmount(db, lid, w.effectiveMonth, w.amount);
  const datedLines = toDatedLineAmounts(listLineAmounts(db));
  expect(lineAmountInForce(lid, "2026-07", datedLines)).toBe(25);
  expect(lineAmountInForce(lid, "2026-08", datedLines)).toBe(30);
});
```

- [ ] **Step 2: Lancer le test et le voir échouer**

Run : `npx vitest run tests/db/dated-writes.test.ts`
Expected : FAIL sur le premier test — `insertEnvelopeGroup` ne pose aucune entrée
datée, donc `budgetInForce` rend 0 à `2026-03` au lieu de 250. (Le test appelle
`setBudgetAmount` à la main pour décrire ce que la création DOIT faire ; retirer
cet appel une fois `createGroup` corrigé à l'étape 4, et vérifier que le test
passe toujours.)

- [ ] **Step 3: Supprimer le code mort**

Dans `src/db/repositories/groups.ts`, supprimer `updateGroupMonthlyAmount` et
`updateLineAmount` (lignes 135-144). Vérifier qu'aucun appelant ne subsiste :

```bash
grep -rn "updateGroupMonthlyAmount\|updateLineAmount" src tests
```
Expected : aucune sortie.

- [ ] **Step 4: Écrire l'entrée datée à la création**

Dans `src/app/historique/actions.ts`.

`createGroup` — après l'insertion :

```ts
  if (kind === "envelope") {
    const gid = insertEnvelopeGroup(database, accountId, trimmed, "out", amount ?? 0, null, startMonth, endMonth);
    setBudgetAmount(database, gid, startMonth, amount ?? 0);
  } else {
    insertRecurringGroup(database, accountId, trimmed, "out", null, startMonth, endMonth);
    // Un récurrent n'a pas de montant à lui : il n'y a rien à poser tant qu'il
    // n'a pas de ligne.
  }
```

`createRemuneration` — même chose, mois de départ `2000-01` :

```ts
  const gid = insertEnvelopeGroup(database, accountId, name, "in", amount, incomeKind, "2000-01", null);
  setBudgetAmount(database, gid, "2000-01", amount);
```

`addGroupLine` — le mois de départ de la ligne devient un paramètre, pour qu'une
ligne ajoutée en cours d'année ne compte pas rétroactivement :

```ts
// `month` est le mois affiché au moment de l'ajout : la ligne compte à partir de
// là, pas depuis la création du groupe.
export async function addGroupLine(
  groupId: number, name: string, amount: number, day: number, month: string,
): Promise<number> {
  const trimmed = name.trim();
  if (!trimmed || !/^\d{4}-\d{2}$/.test(month)) return -1;
  const database = db();
  const id = insertLine(database, groupId, trimmed, amount, day);
  setLineAmount(database, id, month, amount);
  await revalidate();
  return id;
}
```

`editGroupLine` — le montant devient daté, avec la même portée que les enveloppes :

```ts
// Modifie une ligne : le nom et le jour changent pour tous les mois (ce sont des
// propriétés de la ligne), le montant est daté selon la portée choisie.
export async function editGroupLine(
  lineId: number, name: string, day: number, month: string, amount: number, scope: "once" | "ongoing",
): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed || !/^\d{4}-\d{2}$/.test(month) || !Number.isFinite(amount) || amount < 0) return;
  const database = db();
  // updateLine écrit encore group_lines.amount, qui n'est plus lu : on lui passe
  // le montant courant pour ne pas laisser un champ incohérent en base.
  updateLine(database, lineId, trimmed, amount, day);
  if (scope === "once") {
    const existantes = toDatedLineAmounts(listLineAmounts(database))[lineId] ?? [];
    for (const w of onceBudgetWrites(existantes, month, amount).writes) {
      setLineAmount(database, lineId, w.effectiveMonth, w.amount);
    }
  } else {
    setLineAmount(database, lineId, month, amount);
  }
  await revalidate();
}
```

`setGroupAmount` — retirer le calcul du budget de base, devenu inutile :

```ts
export async function setGroupAmount(
  groupId: number, month: string, amount: number, scope: "once" | "ongoing",
): Promise<void> {
  if (!/^\d{4}-\d{2}$/.test(month) || !Number.isFinite(amount) || amount < 0) return;
  const database = db();
  if (scope === "once") {
    const datedForGroup = toDatedBudgets(listBudgetAmounts(database))[groupId] ?? [];
    for (const w of onceBudgetWrites(datedForGroup, month, amount).writes) {
      setBudgetAmount(database, groupId, w.effectiveMonth, w.amount);
    }
  } else {
    setBudgetAmount(database, groupId, month, amount);
  }
  await revalidate();
}
```

Les imports de `listGroups`, `budgetInForce` et du type `Group` deviennent inutiles
dans ce fichier : les retirer. `setUncatProvision` perd aussi son argument `0` :
`onceBudgetWrites(datedForGroup, month, amount)`.

- [ ] **Step 5: Adapter les appelants côté composant**

`addGroupLine` et `editGroupLine` changent de signature. Le seul appelant est
`src/components/history-detail-sidebar.tsx` (Tasks 9 et 10 le reprennent en
profondeur). Ici, se contenter de faire compiler en passant `info.month` :

```ts
onSave={(n, a, d) => run(() => editGroupLine(l.id, n, d, info.month, a, "ongoing"))}
...
const id = await addGroupLine(info.groupId, n, a, d, info.month);
```

- [ ] **Step 6: Lancer les tests et le typage**

Run : `npx vitest run tests/db/dated-writes.test.ts` → PASS, 4 tests.
Run : `npx vitest run` → tout vert.
Run : `npx tsc --noEmit` → aucune erreur.

- [ ] **Step 7: Commit**

```bash
git add src/db/repositories/groups.ts src/app/historique/actions.ts src/components/history-detail-sidebar.tsx tests/db/dated-writes.test.ts
git commit -m "feat(budgets): création et édition écrivent des montants datés"
```

---

### Task 8: « Permanent » au bon mois, ventilé sur les lignes

**Files:**
- Créer : `src/lib/overspend-writes.ts`
- Créer : `tests/lib/overspend-writes.test.ts`
- Modifier : `src/db/schema.sql` (colonne `writes` sur `overspend_decisions`)
- Modifier : `src/db/migrations.ts` (ajout de colonne, idempotent)
- Modifier : `src/db/repositories/overspend-decisions.ts`
- Modifier : `src/app/historique/actions.ts` (`decideOverspend`, `undoOverspendDecision`)

**Interfaces:**
- Consumes : `lineAmountInForce`, `nextMonthKey` de `src/lib/history.ts`.
- Produces, dans `src/lib/overspend-writes.ts` :
  - `type BudgetWrite = { target: "group" | "line"; id: number; month: string; amount: number; before: number | null }`
  - `overspentLines(lines, budgetOf, spentOf): { lineId: number; name: string; budget: number; spent: number }[]`
  - `envelopeWrites(groupId: number, month: string, amount: number, before: number | null): BudgetWrite[]`
  - `lineWrites(month: string, choix: { lineId: number; amount: number; before: number | null }[]): BudgetWrite[]`
  - `undoWrites(writes: BudgetWrite[], enPlace: (w: BudgetWrite) => number | null): { restore: BudgetWrite[]; remove: BudgetWrite[] }`
- Produces, côté repository : `OverspendDecision` gagne `writes: BudgetWrite[] | null`.

- [ ] **Step 1: Écrire le test**

```ts
// tests/lib/overspend-writes.test.ts
import { describe, it, expect } from "vitest";
import { overspentLines, envelopeWrites, lineWrites, undoWrites, type BudgetWrite } from "../../src/lib/overspend-writes";

describe("lignes en dépassement", () => {
  const lignes = [
    { id: 101, name: "Direct Assurance voiture" },
    { id: 102, name: "Sosh Internet" },
    { id: 105, name: "iCloud" },
  ];
  const budgets: Record<number, number> = { 101: 81.84, 102: 30.99, 105: 9.99 };
  const depenses: Record<number, number> = { 101: 151.84, 102: 30.99, 105: 1.99 };

  it("ne retient que les lignes qui ont dépassé", () => {
    expect(overspentLines(lignes, (id) => budgets[id], (id) => depenses[id])).toEqual([
      { lineId: 101, name: "Direct Assurance voiture", budget: 81.84, spent: 151.84 },
    ]);
  });

  it("ignore un écart d'arrondi sous le centime", () => {
    const b = { 101: 10 } as Record<number, number>;
    const d = { 101: 10.004 } as Record<number, number>;
    expect(overspentLines([{ id: 101, name: "X" }], (id) => b[id], (id) => d[id])).toEqual([]);
  });

  it("rend une liste vide quand la dépense vient du groupe et non d'une ligne", () => {
    expect(overspentLines([], () => 0, () => 0)).toEqual([]);
  });
});

describe("écritures d'une décision permanente", () => {
  it("relève une enveloppe au mois qui suit le dépassement", () => {
    expect(envelopeWrites(16, "2026-07", 468.19, 250)).toEqual([
      { target: "group", id: 16, month: "2026-08", amount: 468.19, before: 250 },
    ]);
  });

  it("garde before à null quand aucun montant n'existait à ce mois", () => {
    expect(envelopeWrites(16, "2026-07", 300, null)).toEqual([
      { target: "group", id: 16, month: "2026-08", amount: 300, before: null },
    ]);
  });

  it("relève chaque ligne choisie au mois qui suit le dépassement", () => {
    expect(lineWrites("2026-07", [{ lineId: 101, amount: 151.84, before: null }])).toEqual([
      { target: "line", id: 101, month: "2026-08", amount: 151.84, before: null },
    ]);
  });

  it("passe correctement d'une année à l'autre", () => {
    expect(envelopeWrites(1, "2026-12", 100, null)[0].month).toBe("2027-01");
  });
});

describe("annulation d'une décision permanente", () => {
  const w: BudgetWrite[] = [
    { target: "group", id: 16, month: "2026-08", amount: 300, before: 250 },
    { target: "line", id: 101, month: "2026-08", amount: 151.84, before: null },
  ];

  it("restaure le montant d'avant, ou supprime l'entrée s'il n'y en avait pas", () => {
    const r = undoWrites(w, (x) => (x.target === "group" ? 300 : 151.84));
    expect(r.restore).toEqual([{ target: "group", id: 16, month: "2026-08", amount: 300, before: 250 }]);
    expect(r.remove).toEqual([{ target: "line", id: 101, month: "2026-08", amount: 151.84, before: null }]);
  });

  it("ne touche pas une entrée modifiée à la main depuis la décision", () => {
    const r = undoWrites(w, () => 999);
    expect(r.restore).toEqual([]);
    expect(r.remove).toEqual([]);
  });

  it("ne fait rien quand la décision n'avait rien écrit", () => {
    expect(undoWrites([], () => null)).toEqual({ restore: [], remove: [] });
  });
});
```

- [ ] **Step 2: Lancer le test et le voir échouer**

Run : `npx vitest run tests/lib/overspend-writes.test.ts`
Expected : FAIL — `Failed to resolve import "../../src/lib/overspend-writes"`.

- [ ] **Step 3: Écrire le module**

```ts
// src/lib/overspend-writes.ts
import { nextMonthKey } from "./history";

// Une écriture de montant posée par une décision « permanent ». `before` est le
// montant qui existait à ce mois avant la décision (null s'il n'y en avait aucun) :
// c'est lui qui permet d'annuler exactement, sans écraser un montant saisi depuis.
export type BudgetWrite = {
  target: "group" | "line";
  id: number;              // identifiant de groupe ou de ligne selon `target`
  month: string;           // YYYY-MM, mois d'entrée en vigueur
  amount: number;
  before: number | null;
};

// Seuil sous lequel un écart est un arrondi, pas un dépassement (même seuil que
// computeOverspends).
const EPS = 0.005;

// Lignes d'un récurrent dont la dépense du mois excède le budget du mois.
export function overspentLines(
  lines: { id: number; name: string }[],
  budgetOf: (lineId: number) => number,
  spentOf: (lineId: number) => number,
): { lineId: number; name: string; budget: number; spent: number }[] {
  return lines
    .map((l) => ({ lineId: l.id, name: l.name, budget: budgetOf(l.id), spent: spentOf(l.id) }))
    .filter((l) => l.spent - l.budget > EPS);
}

// Hausse permanente d'une enveloppe : elle prend effet au mois qui SUIT celui du
// dépassement. Le mois du dépassement garde son budget réel, c'est un fait passé.
export function envelopeWrites(
  groupId: number, month: string, amount: number, before: number | null,
): BudgetWrite[] {
  return [{ target: "group", id: groupId, month: nextMonthKey(month), amount, before }];
}

// Hausse permanente d'un récurrent : une écriture par ligne retenue, au mois qui
// suit le dépassement.
export function lineWrites(
  month: string, choix: { lineId: number; amount: number; before: number | null }[],
): BudgetWrite[] {
  const m = nextMonthKey(month);
  return choix.map((c) => ({ target: "line", id: c.lineId, month: m, amount: c.amount, before: c.before }));
}

// Défait des écritures : on ne touche qu'aux entrées dont le montant est encore
// celui que la décision avait posé. Celles qu'on a modifiées depuis restent en
// place. `restore` reçoit un montant d'avant, `remove` n'en avait pas.
export function undoWrites(
  writes: BudgetWrite[],
  enPlace: (w: BudgetWrite) => number | null,
): { restore: BudgetWrite[]; remove: BudgetWrite[] } {
  const restore: BudgetWrite[] = [];
  const remove: BudgetWrite[] = [];
  for (const w of writes) {
    const actuel = enPlace(w);
    if (actuel === null || Math.abs(actuel - w.amount) > EPS) continue;
    if (w.before === null) remove.push(w);
    else restore.push(w);
  }
  return { restore, remove };
}
```

- [ ] **Step 4: Lancer le test et le voir passer**

Run : `npx vitest run tests/lib/overspend-writes.test.ts`
Expected : PASS, 9 tests.

- [ ] **Step 5: Stocker les écritures avec la décision**

Dans `src/db/schema.sql`, table `overspend_decisions`, ajouter après `decided_at` :

```sql
  writes TEXT,                     -- JSON des écritures posées (BudgetWrite[]), NULL si aucune
```

Dans `src/db/migrations.ts`, à la fin :

```ts
// Ajoute la colonne writes (trace des montants posés par une décision
// « permanent »), pour pouvoir annuler exactement. Idempotent.
export function migrateOverspendWrites(db: Database.Database): void {
  const cols = db.prepare("PRAGMA table_info(overspend_decisions)").all() as { name: string }[];
  if (cols.some((c) => c.name === "writes")) return;
  db.exec(`ALTER TABLE overspend_decisions ADD COLUMN writes TEXT`);
}
```

L'appeler dans `src/db/index.ts`, avant `migrateSeedDatedAmounts`.

Dans `src/db/repositories/overspend-decisions.ts`, porter la colonne :

```ts
import type { BudgetWrite } from "../../lib/overspend-writes";

export type OverspendDecision = {
  accountId: string;
  groupId: number;
  month: string;
  decision: "exceptional" | "permanent";
  decidedAt: string;
  writes: BudgetWrite[] | null; // montants posés par la décision, pour l'annuler
};

// Les trois lectures (`listOverspendDecisions`, `getOverspendDecision`) sélectionnent
// `writes AS writesJson` et le désérialisent :
function hydrate(row: { writesJson: string | null } & Omit<OverspendDecision, "writes">): OverspendDecision {
  const { writesJson, ...rest } = row;
  return { ...rest, writes: writesJson ? (JSON.parse(writesJson) as BudgetWrite[]) : null };
}
```

`setOverspendDecision` sérialise : `JSON.stringify(d.writes)` ou `null`.

Ajouter un test dans `tests/db/overspend-tables.test.ts` :

```ts
test("une décision garde la trace de ses écritures", () => {
  const db = getDb(":memory:");
  upsertAccount(db, { id: "a1", name: "CIC", iban_masked: null, balance: 0, currency: "EUR", last_synced: null });
  const writes = [{ target: "line" as const, id: 101, month: "2026-08", amount: 151.84, before: null }];
  setOverspendDecision(db, { accountId: "a1", groupId: 13, month: "2026-07", decision: "permanent", decidedAt: "2026-07-29T10:00:00Z", writes });
  expect(getOverspendDecision(db, "a1", 13, "2026-07")?.writes).toEqual(writes);
});

test("une décision exceptionnelle n'écrit rien", () => {
  const db = getDb(":memory:");
  upsertAccount(db, { id: "a1", name: "CIC", iban_masked: null, balance: 0, currency: "EUR", last_synced: null });
  setOverspendDecision(db, { accountId: "a1", groupId: 13, month: "2026-07", decision: "exceptional", decidedAt: "2026-07-29T10:00:00Z", writes: null });
  expect(getOverspendDecision(db, "a1", 13, "2026-07")?.writes).toBeNull();
});
```

- [ ] **Step 6: Récrire les deux actions serveur**

Dans `src/app/historique/actions.ts` :

```ts
// Enregistre la décision de l'utilisateur sur un dépassement (groupId 0 = non
// catégorisés). « Permanent » relève le budget au mois qui SUIT celui du
// dépassement : le mois du dépassement garde son budget réel. Pour une enveloppe
// (ou la provision du groupe 0), un seul montant ; pour un récurrent, un montant
// par ligne qui a dépassé. La décision garde la trace de ce qu'elle a écrit.
export async function decideOverspend(
  accountId: string,
  groupId: number,
  month: string,
  decision: "exceptional" | "permanent",
  newBudget?: number,
  lineAmounts?: { lineId: number; amount: number }[],
): Promise<void> {
  if (!/^\d{4}-\d{2}$/.test(month)) return;
  const database = db();
  let writes: BudgetWrite[] | null = null;

  if (decision === "permanent") {
    const cible = nextMonthKey(month);
    if (lineAmounts?.length) {
      const datedLines = toDatedLineAmounts(listLineAmounts(database));
      writes = lineWrites(
        month,
        lineAmounts
          .filter((l) => Number.isFinite(l.amount) && l.amount > 0)
          .map((l) => ({
            lineId: l.lineId,
            amount: l.amount,
            before: (datedLines[l.lineId] ?? []).find((e) => e.effectiveMonth === cible)?.amount ?? null,
          })),
      );
      for (const w of writes) setLineAmount(database, w.id, w.month, w.amount);
    } else if (newBudget != null && Number.isFinite(newBudget) && newBudget > 0) {
      const dated = toDatedBudgets(listBudgetAmounts(database));
      const before = (dated[groupId] ?? []).find((e) => e.effectiveMonth === cible)?.amount ?? null;
      writes = envelopeWrites(groupId, month, newBudget, before);
      for (const w of writes) setBudgetAmount(database, w.id, w.month, w.amount);
    }
  }

  setOverspendDecision(database, {
    accountId, groupId, month, decision, decidedAt: new Date().toISOString(), writes,
  });
  revalidatePath("/historique");
  revalidatePath("/");
}

// Annule une décision : le dépassement redevient « à trancher ». Les montants
// posés par une décision « permanent » sont défaits — restaurés à leur valeur
// d'avant, ou supprimés s'il n'y en avait pas — sauf ceux modifiés à la main
// depuis, qu'on laisse tels quels.
export async function undoOverspendDecision(
  accountId: string, groupId: number, month: string,
): Promise<void> {
  if (!/^\d{4}-\d{2}$/.test(month)) return;
  const database = db();
  const existing = getOverspendDecision(database, accountId, groupId, month);
  if (existing?.writes?.length) {
    const dated = toDatedBudgets(listBudgetAmounts(database));
    const datedLines = toDatedLineAmounts(listLineAmounts(database));
    const enPlace = (w: BudgetWrite) => {
      const suite = w.target === "line" ? datedLines[w.id] : dated[w.id];
      return (suite ?? []).find((e) => e.effectiveMonth === w.month)?.amount ?? null;
    };
    const { restore, remove } = undoWrites(existing.writes, enPlace);
    for (const w of restore) {
      if (w.target === "line") setLineAmount(database, w.id, w.month, w.before!);
      else setBudgetAmount(database, w.id, w.month, w.before!);
    }
    for (const w of remove) {
      if (w.target === "line") deleteLineAmount(database, w.id, w.month);
      else deleteBudgetAmount(database, w.id, w.month);
    }
  }
  deleteOverspendDecision(database, accountId, groupId, month);
  revalidatePath("/historique");
  revalidatePath("/");
}
```

Imports à ajouter : `nextMonthKey`, `toDatedLineAmounts`, `toDatedBudgets` de
`../../lib/history` ; `envelopeWrites`, `lineWrites`, `undoWrites`, type
`BudgetWrite` de `../../lib/overspend-writes` ; `setLineAmount`,
`deleteLineAmount`, `listLineAmounts` de `../../db/repositories/line-amounts`.

- [ ] **Step 7: Test bout en bout de la décision**

Ajouter à `tests/db/overspend-tables.test.ts` un test qui pose une décision
permanente sur une ligne, vérifie le montant en vigueur au mois suivant, annule,
et vérifie le retour à l'état d'avant. Les actions serveur (`"use server"`) ne
s'appellent pas depuis Vitest : reproduire leur corps avec les fonctions pures et
le repository, comme le fait déjà `tests/db/dated-writes.test.ts`.

```ts
test("une hausse permanente sur une ligne prend effet au mois suivant, et s'annule", () => {
  const db = getDb(":memory:");
  upsertAccount(db, { id: "a1", name: "CIC", iban_masked: null, balance: 0, currency: "EUR", last_synced: null });
  const gid = insertRecurringGroup(db, "a1", "Abonnements", "out", null, "2026-01", null);
  const lid = insertLine(db, gid, "Direct Assurance voiture", 81.84, 5);
  setLineAmount(db, lid, "2026-01", 81.84);

  const writes = lineWrites("2026-07", [{ lineId: lid, amount: 151.84, before: null }]);
  for (const w of writes) setLineAmount(db, w.id, w.month, w.amount);
  let datedLines = toDatedLineAmounts(listLineAmounts(db));
  expect(lineAmountInForce(lid, "2026-07", datedLines)).toBeCloseTo(81.84, 2);
  expect(lineAmountInForce(lid, "2026-08", datedLines)).toBeCloseTo(151.84, 2);

  const enPlace = (w: typeof writes[number]) =>
    (toDatedLineAmounts(listLineAmounts(db))[w.id] ?? []).find((e) => e.effectiveMonth === w.month)?.amount ?? null;
  const { remove } = undoWrites(writes, enPlace);
  for (const w of remove) deleteLineAmount(db, w.id, w.month);
  datedLines = toDatedLineAmounts(listLineAmounts(db));
  expect(lineAmountInForce(lid, "2026-08", datedLines)).toBeCloseTo(81.84, 2);
});
```

- [ ] **Step 8: Lancer toute la suite et le typage**

Run : `npx vitest run` → tout vert, `budget-baseline.test.ts` compris.
Run : `npx tsc --noEmit` → aucune erreur.

- [ ] **Step 9: Commit**

```bash
git add src/lib/overspend-writes.ts src/db/ src/app/historique/actions.ts tests/
git commit -m "feat(depassement): Permanent relève au mois suivant le dépassement et ventile sur les lignes"
```

---

### Task 9: Panneau d'une enveloppe — montant en vigueur et vie du budget

**Files:**
- Modifier : `src/lib/history-explain.ts:44-57` (type `GroupManageInfo`)
- Créer : `src/lib/budget-history.ts` (calcul pur de la liste des changements)
- Créer : `tests/lib/budget-history.test.ts`
- Modifier : `src/components/history-grid.tsx` (construction de `GroupManageInfo`)
- Modifier : `src/components/history-detail-sidebar.tsx:232-315`

**Interfaces:**
- Consumes : `DatedBudgets`, `DatedLineAmounts` de `src/lib/history.ts`.
- Produces, dans `src/lib/budget-history.ts` :
  - `type BudgetChange = { month: string; amount: number; isStart: boolean }`
  - `budgetChanges(entries: { effectiveMonth: string; amount: number }[]): BudgetChange[]`
- `GroupManageInfo` gagne `changes: BudgetChange[]` et chaque ligne gagne
  `changes: BudgetChange[]`.

- [ ] **Step 1: Écrire le test**

```ts
// tests/lib/budget-history.test.ts
import { describe, it, expect } from "vitest";
import { budgetChanges } from "../../src/lib/budget-history";

describe("vie d'un budget", () => {
  it("marque la première entrée comme montant de départ", () => {
    expect(budgetChanges([{ effectiveMonth: "2000-01", amount: 250 }])).toEqual([
      { month: "2000-01", amount: 250, isStart: true },
    ]);
  });

  it("trie par mois croissant et ne marque que la première", () => {
    expect(
      budgetChanges([
        { effectiveMonth: "2026-08", amount: 300 },
        { effectiveMonth: "2000-01", amount: 250 },
        { effectiveMonth: "2026-11", amount: 280 },
      ]),
    ).toEqual([
      { month: "2000-01", amount: 250, isStart: true },
      { month: "2026-08", amount: 300, isStart: false },
      { month: "2026-11", amount: 280, isStart: false },
    ]);
  });

  it("masque un changement qui ne change rien", () => {
    expect(
      budgetChanges([
        { effectiveMonth: "2000-01", amount: 250 },
        { effectiveMonth: "2026-08", amount: 250 },
      ]),
    ).toEqual([{ month: "2000-01", amount: 250, isStart: true }]);
  });

  it("rend une liste vide sans entrée", () => {
    expect(budgetChanges([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Lancer le test et le voir échouer**

Run : `npx vitest run tests/lib/budget-history.test.ts`
Expected : FAIL — module introuvable.

- [ ] **Step 3: Écrire le module**

```ts
// src/lib/budget-history.ts

// Un montant dans la vie d'un budget : le mois où il prend effet, sa valeur, et
// s'il s'agit du montant de départ (la première entrée, qui ne se supprime pas).
export type BudgetChange = { month: string; amount: number; isStart: boolean };

// Liste lisible des montants d'un budget, triée par mois croissant. Les entrées
// qui répètent le montant déjà en vigueur sont masquées : elles n'apprennent rien
// et encombreraient le panneau (une application « ce mois seulement » en pose une
// au mois suivant, qui restaure la valeur précédente).
export function budgetChanges(entries: { effectiveMonth: string; amount: number }[]): BudgetChange[] {
  const triees = [...entries].sort((a, b) => (a.effectiveMonth < b.effectiveMonth ? -1 : 1));
  const out: BudgetChange[] = [];
  let courant: number | null = null;
  for (const e of triees) {
    if (courant !== null && Math.abs(e.amount - courant) < 0.005) continue;
    out.push({ month: e.effectiveMonth, amount: e.amount, isStart: out.length === 0 });
    courant = e.amount;
  }
  return out;
}
```

- [ ] **Step 4: Lancer le test et le voir passer**

Run : `npx vitest run tests/lib/budget-history.test.ts`
Expected : PASS, 4 tests.

- [ ] **Step 5: Étendre GroupManageInfo**

Dans `src/lib/history-explain.ts` :

```ts
import type { BudgetChange } from "./budget-history";

export type GroupManageInfo = {
  groupId: number;
  name: string;
  kind: "envelope" | "recurring";
  month: string;          // mois affiché sélectionné
  currentAmount: number;  // montant en vigueur ce mois (pré-remplissage)
  changes: BudgetChange[]; // vie du budget (enveloppe) ; vide pour un récurrent
  lines: { id: number; name: string; amount: number; day: number; changes: BudgetChange[] }[];
};
```

- [ ] **Step 6: Renseigner le champ à la construction**

`GroupManageInfo` est construit dans `src/components/history-grid.tsx:1438-1450`,
à partir du `SelectGroup` enrichi que `page.tsx` lui passe. Ajouter les changements
à la source, dans `src/app/historique/page.tsx` (importer `budgetChanges` depuis
`../../lib/budget-history`) :

```ts
          const selectGroups = groups.map((g) => ({
            id: g.id,
            name: g.name,
            kind: g.kind,
            changes: budgetChanges(datedBudgets[g.id] ?? []),
            lines: g.lines.map((l) => ({
              id: l.id, name: l.name, amount: l.amount, day: l.day,
              changes: budgetChanges(datedLines[l.id] ?? []),
            })),
          }));
```

Dans `history-grid.tsx:1442-1449`, remplacer le pré-remplissage :

```tsx
      groupManage: {
        groupId: r.id,
        name: r.name,
        kind: sg?.kind ?? "envelope",
        month: manageMonth,
        // Le montant du mois visé, pas celui du mois courant : manageMonth peut
        // être le premier mois de la frise quand le mois courant n'est pas affiché.
        currentAmount:
          sg?.kind === "recurring"
            ? (sg?.lines ?? []).reduce((s, l) => s + amountAtMonth(l.changes, manageMonth), 0)
            : amountAtMonth(sg?.changes ?? [], manageMonth),
        changes: sg?.changes ?? [],
        lines: sg?.lines ?? [],
      },
```

`amountAtMonth` est définie en Task 10 étape 2 ; si cette tâche est faite avant la
Task 10, la créer ici avec son test. `currentBudgets` n'est alors plus utilisé
pour ce pré-remplissage — vérifier s'il sert encore ailleurs (`grep -n currentBudgets src/components/history-grid.tsx`)
avant de le retirer de `page.tsx` : il alimente aussi `OverspendActionInfo.currentBudget`.

- [ ] **Step 7: Afficher la vie du budget dans le panneau**

Dans `src/components/history-detail-sidebar.tsx`, `GroupManageBlock`, après le
bloc « Montant daté (enveloppe) » (ligne 315) :

```tsx
        {/* Vie du budget : ce qui s'applique et depuis quand. Le montant de
            départ se modifie mais ne se supprime pas — sans lui le groupe
            n'aurait plus de budget du tout. */}
        {info.kind === "envelope" && info.changes.length > 0 && (
          <div className="flex flex-col gap-2">
            <Label className="font-normal">Vie du budget</Label>
            <ul className="text-muted-foreground flex flex-col gap-1 text-sm">
              {info.changes.map((c) => (
                <li key={c.month} className="flex items-center justify-between gap-2">
                  <span>
                    {c.isStart ? "Montant de départ" : `À partir de ${monthLabel(c.month)}`}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums">{formatEur(c.amount)}</span>
                    {!c.isStart && (
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={`Supprimer le changement de ${monthLabel(c.month)}`}
                        onClick={() => run(() => removeGroupAmount(info.groupId, c.month))}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
```

Nouvelle action serveur dans `src/app/historique/actions.ts` :

```ts
// Retire un changement de budget daté (jamais le montant de départ : le panneau
// ne propose la corbeille que sur les autres).
export async function removeGroupAmount(groupId: number, month: string): Promise<void> {
  if (!/^\d{4}-\d{2}$/.test(month)) return;
  deleteBudgetAmount(db(), groupId, month);
  await revalidate();
}
```

- [ ] **Step 8: Vérifier**

Run : `npx vitest run` → tout vert.
Run : `npx tsc --noEmit` → aucune erreur.

Vérification visuelle, sans test unitaire utile : `npm run dev -- --experimental-https`.
Ouvrir le panneau « Gérer le groupe » d'Activités depuis le mois de juillet.
Attendu : le champ affiche 250 ; la vie du budget montre une seule ligne
« Montant de départ 250,00 ». Appliquer 300 « à partir de ce mois » sur août :
la vie du budget montre une seconde ligne « À partir d'août 2026 300,00 »,
supprimable, et le tableau passe à 300 en août. Supprimer la ligne : retour à 250.

- [ ] **Step 9: Commit**

```bash
git add src/lib/budget-history.ts src/lib/history-explain.ts src/app/historique/ src/components/ tests/lib/budget-history.test.ts
git commit -m "feat(panneau): afficher le montant en vigueur et la vie du budget d'une enveloppe"
```

---

### Task 10: Panneau d'un récurrent — lignes datées

**Files:**
- Modifier : `src/components/history-detail-sidebar.tsx:186-226` (`LineRow`), `:317-377`

**Interfaces:**
- Consumes : `editGroupLine` et `addGroupLine` (Task 7, nouvelles signatures),
  `BudgetChange` et `budgetChanges` (Task 9).
- Produces : nouvelle action `removeLineAmount(lineId: number, month: string)`.

- [ ] **Step 1: Ajouter l'action serveur**

Dans `src/app/historique/actions.ts` :

```ts
// Retire un changement de montant daté d'une ligne de récurrent.
export async function removeLineAmount(lineId: number, month: string): Promise<void> {
  if (!/^\d{4}-\d{2}$/.test(month)) return;
  deleteLineAmount(db(), lineId, month);
  await revalidate();
}
```

- [ ] **Step 2: Récrire LineRow**

```tsx
// Une ligne d'un récurrent en édition : nom / montant du mois affiché / jour, plus
// la vie de son montant. Le nom et le jour valent pour tous les mois ; le montant
// est daté, avec la même portée que celle d'une enveloppe.
function LineRow({ line, month, busy, onSave, onRemove, onRemoveChange }: {
  line: { id: number; name: string; amount: number; day: number; changes: BudgetChange[] };
  month: string;
  busy: boolean;
  onSave: (name: string, day: number, amount: number, scope: "once" | "ongoing") => void;
  onRemove: () => void;
  onRemoveChange: (month: string) => void;
}) {
  const [name, setName] = useState(line.name);
  const [amount, setAmount] = useState(String(line.amount));
  const [day, setDay] = useState(String(line.day));
  const [scope, setScope] = useState<"ongoing" | "once">("ongoing");
  return (
    <div className="flex flex-col gap-2 border-b pb-3 last:border-b-0">
      <div className="flex items-end gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Label className="text-muted-foreground text-xs font-normal">Nom</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8" />
        </div>
        <div className="flex w-20 flex-col gap-1">
          <Label className="text-muted-foreground text-xs font-normal">Montant</Label>
          <Input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-8 text-right tabular-nums" />
        </div>
        <div className="flex w-14 flex-col gap-1">
          <Label className="text-muted-foreground text-xs font-normal">Jour</Label>
          <Input type="number" min="1" max="31" value={day} onChange={(e) => setDay(e.target.value)} className="h-8 text-right tabular-nums" />
        </div>
        <Button type="button" size="icon-xs" variant="ghost" disabled={busy} aria-label="Supprimer la ligne" onClick={onRemove}>
          <Trash2 className="text-muted-foreground size-4" />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as "ongoing" | "once")}
          className="h-8 rounded-md border bg-transparent px-2 text-sm"
        >
          <option value="ongoing">À partir de ce mois</option>
          <option value="once">Ce mois seulement</option>
        </select>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={busy || !name.trim()}
          onClick={() => onSave(name.trim(), parseInt(day, 10) || 1, parseFloat(amount) || 0, scope)}
        >
          Enregistrer
        </Button>
      </div>
      {line.changes.length > 0 && (
        <ul className="text-muted-foreground flex flex-col gap-1 text-xs">
          {line.changes.map((c) => (
            <li key={c.month} className="flex items-center justify-between gap-2">
              <span>{c.isStart ? "Montant de départ" : `À partir de ${monthLabel(c.month)}`}</span>
              <span className="flex items-center gap-2">
                <span className="tabular-nums">{formatEur(c.amount)}</span>
                {!c.isStart && (
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`Supprimer le changement de ${monthLabel(c.month)}`}
                    onClick={() => onRemoveChange(c.month)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <Trash2 className="size-3" />
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

Le montant affiché doit être celui du mois : dans `page.tsx`, `selectGroups`
renseigne `amount: lineAmountInForce(l.id, month, datedLines)` — mais `month`
n'est connu qu'au clic. Le plus simple : `selectGroups` fournit les `changes`, et
le composant en déduit le montant du mois avec une petite fonction locale
`montantAuMois(changes, month)` qui prend la dernière entrée dont le mois est
atteint. La placer dans `src/lib/budget-history.ts` et la tester :

```ts
// Montant en vigueur à `month` dans une vie de budget déjà calculée.
export function amountAtMonth(changes: BudgetChange[], month: string): number {
  let amount = 0;
  for (const c of changes) if (c.month <= month) amount = c.amount;
  return amount;
}
```

Test à ajouter dans `tests/lib/budget-history.test.ts` :

```ts
it("rend le montant en vigueur à un mois donné", () => {
  const c = budgetChanges([
    { effectiveMonth: "2000-01", amount: 250 },
    { effectiveMonth: "2026-08", amount: 300 },
  ]);
  expect(amountAtMonth(c, "2026-07")).toBe(250);
  expect(amountAtMonth(c, "2026-08")).toBe(300);
  expect(amountAtMonth([], "2026-08")).toBe(0);
});
```

- [ ] **Step 3: Brancher la liste des lignes**

Dans `GroupManageBlock`, section « Lignes (récurrent) » :

```tsx
            {lines.map((l) => (
              <LineRow
                key={l.id}
                line={{ ...l, amount: amountAtMonth(l.changes, info.month) }}
                month={info.month}
                busy={busy}
                onSave={(n, d, a, s) => run(() => editGroupLine(l.id, n, d, info.month, a, s))}
                onRemoveChange={(m) => run(() => removeLineAmount(l.id, m))}
                onRemove={() =>
                  run(async () => {
                    await removeGroupLine(l.id);
                    setLines((cur) => cur.filter((x) => x.id !== l.id));
                  })
                }
              />
            ))}
```

Et l'ajout d'une ligne passe le mois affiché :

```tsx
                    const id = await addGroupLine(info.groupId, n, a, d, info.month);
                    if (id > 0) {
                      setLines((cur) => [...cur, { id, name: n, amount: a, day: d, changes: [{ month: info.month, amount: a, isStart: true }] }]);
                    }
```

- [ ] **Step 4: Retirer le champ montant du groupe pour un récurrent**

Le bloc « Montant daté (enveloppe) » est déjà conditionné par
`info.kind === "envelope"` : rien à faire. Vérifier qu'aucun autre endroit ne
propose de fixer un montant sur un groupe récurrent.

```bash
grep -rn "setGroupAmount" src
```
Attendu : uniquement l'action et l'appel du bloc enveloppe.

- [ ] **Step 5: Vérifier**

Run : `npx vitest run` → tout vert.
Run : `npx tsc --noEmit` → aucune erreur.

Vérification visuelle : ouvrir le panneau d'Abonnements sur juillet. Attendu :
pas de champ montant pour le groupe ; six lignes avec leur montant de juillet ;
sous chacune, « Montant de départ ». Passer Direct Assurance à 151,84 « à partir
de ce mois » : le total du groupe passe de 170,94 à 240,94 sur juillet et les mois
suivants, la ligne gagne un « À partir de juillet 2026 », et supprimer ce
changement ramène tout à 170,94.

- [ ] **Step 6: Commit**

```bash
git add src/lib/budget-history.ts src/app/historique/actions.ts src/components/history-detail-sidebar.tsx tests/lib/budget-history.test.ts
git commit -m "feat(panneau): éditer les montants datés des lignes d'un récurrent"
```

---

### Task 11: Formulaire « Permanent » d'un récurrent

**Files:**
- Modifier : `src/lib/history-explain.ts` (type `OverspendActionInfo`)
- Modifier : `src/lib/history-detail.ts` (construction de `overspendDecisionDetail`)
- Modifier : `src/app/historique/page.tsx` (alimenter les lignes en dépassement)
- Modifier : `src/components/history-detail-sidebar.tsx:102-184` (`OverspendActionBlock`)

**Interfaces:**
- Consumes : `overspentLines` (Task 8), `decideOverspend` avec son paramètre
  `lineAmounts` (Task 8).
- Produces : `OverspendActionInfo` gagne
  `overspentLines: { lineId: number; name: string; budget: number; spent: number }[]`
  (vide pour une enveloppe et pour le groupe 0).

- [ ] **Step 1: Étendre le type et l'alimenter**

Dans `src/lib/history-explain.ts` :

```ts
export type OverspendActionInfo = {
  accountId: string;
  groupId: number;
  groupName: string;
  month: string;
  amount: number;
  decision: "exceptional" | "permanent" | null;
  currentBudget: number | null;
  // Lignes d'un récurrent qui ont dépassé ce mois-là, avec leur budget et leur
  // dépense réelle. Vide pour une enveloppe et pour les non catégorisés.
  overspentLines: { lineId: number; name: string; budget: number; spent: number }[];
};
```

Dans `src/app/historique/page.tsx`, à l'endroit où l'info est construite, calculer
les lignes en dépassement à partir des sections déjà calculées (`subRows` porte
`budgeted` et `depense` par mois — la même information, sans recalcul) :

```ts
// Lignes d'un récurrent en dépassement au mois de la case cliquée.
const lignesEnDepassement = (row: HistoryRow, i: number) =>
  overspentLines(
    row.subRows.map((sr) => ({ id: sr.id, name: sr.name })),
    (id) => row.subRows.find((sr) => sr.id === id)!.cells[i].budgeted,
    (id) => row.subRows.find((sr) => sr.id === id)!.cells[i].depense,
  );
```

Suivre les erreurs de `npx tsc --noEmit` pour brancher jusqu'au composant.

- [ ] **Step 2: Récrire le formulaire**

Dans `OverspendActionBlock`, remplacer le mini-formulaire (lignes 158-181) par un
aiguillage sur `action.overspentLines` :

```tsx
      {openForm && action.overspentLines.length === 0 && action.groupId !== 0 && isRecurring && (
        <p className="text-muted-foreground mt-2 text-sm">
          Aucune ligne n&apos;a dépassé ce mois-ci : la dépense est rattachée au groupe,
          pas à une ligne précise. Ajuste la ligne concernée depuis « Gérer le groupe ».
        </p>
      )}
      {openForm && action.overspentLines.length > 0 && (
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-muted-foreground">Nouveaux montants, à partir du mois suivant :</p>
          {action.overspentLines.map((l) => (
            <div key={l.lineId} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate">{l.name}</span>
              <span className="flex items-center gap-2">
                <span className="text-muted-foreground tabular-nums">{formatEur(l.budget)} →</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={lineValues[l.lineId] ?? String(l.spent)}
                  onChange={(e) => setLineValues((v) => ({ ...v, [l.lineId]: e.target.value }))}
                  className="w-24 rounded-md border px-2 py-1 text-right tabular-nums"
                />
              </span>
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() =>
              decide(
                "permanent",
                undefined,
                action.overspentLines.map((l) => ({
                  lineId: l.lineId,
                  amount: parseFloat(lineValues[l.lineId] ?? String(l.spent)),
                })),
              )
            }
          >
            Valider
          </Button>
        </div>
      )}
```

avec, en tête du composant :

```tsx
  const [lineValues, setLineValues] = useState<Record<number, string>>({});
```

et `decide` qui accepte le troisième argument :

```tsx
  const decide = async (
    decision: "exceptional" | "permanent",
    newBudget?: number,
    lineAmounts?: { lineId: number; amount: number }[],
  ) => {
    setBusy(true);
    await decideOverspend(action.accountId, action.groupId, action.month, decision, newBudget, lineAmounts);
    ...
  };
```

Le formulaire à un seul montant reste affiché quand `overspentLines` est vide et
que le groupe est une enveloppe ou le groupe 0.

- [ ] **Step 3: Vérifier**

Run : `npx vitest run` → tout vert.
Run : `npx tsc --noEmit` → aucune erreur.

Vérification visuelle : cliquer la case Balance d'Abonnements en juillet
(-32,88). Attendu : « Permanent » déplie une seule ligne, Direct Assurance
voiture, avec 81,84 → 151,84 pré-rempli. Valider : le budget d'Abonnements passe
à 240,94 à partir d'août, juillet reste à 170,94. Annuler la décision : retour à
170,94 partout.

- [ ] **Step 4: Commit**

```bash
git add src/lib/history-explain.ts src/lib/history-detail.ts src/app/historique/page.tsx src/components/history-detail-sidebar.tsx
git commit -m "feat(depassement): formulaire Permanent par ligne pour un récurrent"
```

---

### Task 12: Repère dans le tableau

**Files:**
- Modifier : `src/lib/history-columns.ts` (ajout d'une fonction pure)
- Modifier : `tests/lib/history-columns.test.ts`
- Modifier : `src/components/history-grid.tsx` (rendu de la cellule Budget)

**Interfaces:**
- Produces : `budgetChangePoints(cells: { budgeted: number }[]): boolean[]`

- [ ] **Step 1: Écrire le test**

```ts
// tests/lib/history-columns.test.ts, en fin de fichier
describe("repère de changement de budget", () => {
  it("marque le mois où le budget change", () => {
    expect(budgetChangePoints([{ budgeted: 250 }, { budgeted: 250 }, { budgeted: 300 }]))
      .toEqual([false, false, true]);
  });

  it("ne marque jamais la première colonne", () => {
    expect(budgetChangePoints([{ budgeted: 300 }])).toEqual([false]);
  });

  it("ignore un écart d'arrondi", () => {
    expect(budgetChangePoints([{ budgeted: 250 }, { budgeted: 250.001 }])).toEqual([false, false]);
  });

  it("rend une liste vide sans cellule", () => {
    expect(budgetChangePoints([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Lancer le test et le voir échouer**

Run : `npx vitest run tests/lib/history-columns.test.ts -t "repère"`
Expected : FAIL — `budgetChangePoints is not exported`.

- [ ] **Step 3: Implémenter**

Dans `src/lib/history-columns.ts` :

```ts
// Mois où le budget diffère de celui du mois précédent, pour signaler dans le
// tableau qu'une hausse ou une baisse a pris effet là. La première colonne n'a
// pas de précédent : elle n'est jamais marquée.
export function budgetChangePoints(cells: { budgeted: number }[]): boolean[] {
  return cells.map((c, i) => i > 0 && Math.abs(c.budgeted - cells[i - 1].budgeted) > 0.005);
}
```

- [ ] **Step 4: Lancer le test et le voir passer**

Run : `npx vitest run tests/lib/history-columns.test.ts`
Expected : PASS.

- [ ] **Step 5: Afficher le repère**

Dans `src/components/history-grid.tsx`, là où la cellule Budget d'une ligne est
rendue, calculer `const changes = budgetChangePoints(row.cells);` une fois par
ligne et ajouter une bordure gauche discrète sur les cellules marquées :

```tsx
className={cn(..., changes[i] && "border-l-muted-foreground/40 border-l-2")}
```

Le repère doit rester discret : pas de couleur d'alerte, c'est une information, pas
un problème.

- [ ] **Step 6: Vérifier**

Run : `npx vitest run` → tout vert, `budget-baseline.test.ts` compris.
Run : `npx tsc --noEmit` → aucune erreur.
Run : `npx eslint .` → pas de nouvelle erreur (5 items préexistants tolérés).

Vérification visuelle : poser une hausse en août sur Activités, constater le trait
sur la colonne d'août et son absence ailleurs.

- [ ] **Step 7: Commit**

```bash
git add src/lib/history-columns.ts src/components/history-grid.tsx tests/lib/history-columns.test.ts
git commit -m "feat(tableau): repérer le mois où un budget change"
```

---

## Vérification finale

- [ ] `npx vitest run` — tout vert, `tests/lib/budget-baseline.test.ts` compris,
      **avec ses valeurs attendues d'origine, jamais retouchées**.
- [ ] `npx tsc --noEmit` — aucune erreur.
- [ ] `npx eslint .` — aucune nouvelle erreur.
- [ ] `grep -rn "monthlyAmount\|l\.amount" src/lib src/app` — plus aucune lecture
      de montant de base dans un calcul (les occurrences restantes sont des
      écritures ou des types).
- [ ] Serveur réel lancé, budgets identiques à ceux d'avant la refonte, aucun
      avertissement `[budgets]` en console.
