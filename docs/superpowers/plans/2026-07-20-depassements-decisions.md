# Décisions sur les dépassements et budgets datés — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à l'utilisateur de trancher chaque dépassement (exceptionnel / permanent), avec budgets datés non rétroactifs, projections fondées sur les dépassements non tranchés, et rappels (bandeau + pastille) dans l'Historique.

**Architecture:** Deux nouvelles tables SQLite (`budget_amounts`, `overspend_decisions`) lues par la page Historique ; la logique pure vit dans `src/lib/history.ts` (budget en vigueur par mois, dépassements en attente, chaîne « si dépassement » fondée sur les non tranchés) ; l'UI de décision vit dans le side panel existant (`history-detail-sidebar.tsx`), les rappels dans un bandeau au-dessus du tableau et une pastille sur les lignes.

**Tech Stack:** Next.js App Router (server actions), better-sqlite3, Vitest, React/Tailwind (shadcn).

## Global Constraints

- Spec de référence : `docs/superpowers/specs/2026-07-20-depassements-decisions-design.md`.
- Tous les libellés UI sont en français, sans emoji.
- Un dépassement est identifié par (account_id, group_id, month) où `group_id = 0` désigne les Non catégorisés du compte.
- Une hausse de budget « permanent » prend effet au mois courant, jamais avant. Les mois passés gardent le budget qui était en vigueur.
- La projection retient, par groupe, **son dépassement non tranché le plus récent** (mois courant inclus), pas la somme.
- Les Non catégorisés n'ont pas d'option « permanent » (pas de budget à relever).
- La colonne `soldeDepass` s'appelle « Solde si dépassement ».
- Vérifications : `npx tsc --noEmit` puis `npm test` doivent passer à la fin de chaque tâche.
- Les tests lib utilisent des données en mémoire ; les tests DB utilisent `getDb(":memory:")`.
- Commits fréquents, messages `feat(historique): …` / `feat(db): …`, avec le trailer Co-Authored-By habituel du projet.

---

## Fichiers touchés (vue d'ensemble)

- Modifier : `src/db/schema.sql` (2 tables), `src/db/repositories/` (+2 fichiers), `src/lib/history.ts`, `src/app/historique/page.tsx`, `src/components/history-grid.tsx`, `src/components/history-with-detail.tsx`, `src/components/history-detail-sidebar.tsx`, `src/lib/history-explain.ts`.
- Créer : `src/db/repositories/budget-amounts.ts`, `src/db/repositories/overspend-decisions.ts`, `src/app/historique/actions.ts`, `src/components/overspend-banner.tsx`, `tests/db/overspend-tables.test.ts` (+ tests dans `tests/lib/history.test.ts`).

---

### Task 1: Tables et repositories (budgets datés, décisions)

**Files:**
- Modify: `src/db/schema.sql` (fin de fichier)
- Create: `src/db/repositories/budget-amounts.ts`
- Create: `src/db/repositories/overspend-decisions.ts`
- Test: `tests/db/overspend-tables.test.ts`

**Interfaces:**
- Consumes: `getDb` de `src/db/index.ts` (le schéma est rejoué en `IF NOT EXISTS` à chaque ouverture : aucune migration à écrire).
- Produces:
  - `type BudgetAmount = { groupId: number; effectiveMonth: string; amount: number }`
  - `listBudgetAmounts(db: Database.Database): BudgetAmount[]` (triés par groupId puis effectiveMonth croissant)
  - `setBudgetAmount(db: Database.Database, groupId: number, effectiveMonth: string, amount: number): void` (upsert)
  - `type OverspendDecision = { accountId: string; groupId: number; month: string; decision: "exceptional" | "permanent"; decidedAt: string }`
  - `listOverspendDecisions(db: Database.Database, accountId: string): OverspendDecision[]`
  - `setOverspendDecision(db: Database.Database, d: OverspendDecision): void` (upsert sur (accountId, groupId, month))

- [ ] **Step 1: Écrire le test qui échoue**

Dans `tests/db/overspend-tables.test.ts` :

```ts
import { test, expect } from "vitest";
import { getDb } from "../../src/db/index";
import { listBudgetAmounts, setBudgetAmount } from "../../src/db/repositories/budget-amounts";
import { listOverspendDecisions, setOverspendDecision } from "../../src/db/repositories/overspend-decisions";

function freshDb() {
  const db = getDb(":memory:");
  db.prepare(`INSERT INTO accounts (id, name) VALUES ('a1', 'CIC')`).run();
  db.prepare(
    `INSERT INTO groups (id, account_id, name, direction, kind, monthly_amount) VALUES (1, 'a1', 'Courses', 'out', 'envelope', 300)`,
  ).run();
  return db;
}

test("budget_amounts : upsert et lecture triée", () => {
  const db = freshDb();
  setBudgetAmount(db, 1, "2026-08", 400);
  setBudgetAmount(db, 1, "2026-10", 450);
  setBudgetAmount(db, 1, "2026-08", 410); // upsert : remplace le montant d'août
  expect(listBudgetAmounts(db)).toEqual([
    { groupId: 1, effectiveMonth: "2026-08", amount: 410 },
    { groupId: 1, effectiveMonth: "2026-10", amount: 450 },
  ]);
});

test("overspend_decisions : upsert par (compte, groupe, mois), groupId 0 = non catégorisés", () => {
  const db = freshDb();
  setOverspendDecision(db, { accountId: "a1", groupId: 1, month: "2026-07", decision: "exceptional", decidedAt: "2026-08-01T10:00:00Z" });
  setOverspendDecision(db, { accountId: "a1", groupId: 0, month: "2026-07", decision: "exceptional", decidedAt: "2026-08-01T10:00:00Z" });
  setOverspendDecision(db, { accountId: "a1", groupId: 1, month: "2026-07", decision: "permanent", decidedAt: "2026-08-02T10:00:00Z" });
  const rows = listOverspendDecisions(db, "a1");
  expect(rows).toHaveLength(2);
  expect(rows.find((r) => r.groupId === 1)?.decision).toBe("permanent"); // le dernier choix gagne
  expect(rows.find((r) => r.groupId === 0)?.decision).toBe("exceptional");
  expect(listOverspendDecisions(db, "autre")).toHaveLength(0);
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run tests/db/overspend-tables.test.ts`
Expected: FAIL (modules `budget-amounts` / `overspend-decisions` introuvables).

- [ ] **Step 3: Ajouter les tables au schéma**

À la fin de `src/db/schema.sql` :

```sql
-- Budgets datés : montant d'un groupe à partir d'un mois donné. Le montant en
-- vigueur pour un mois M est celui de la ligne au plus grand effective_month <= M ;
-- sans ligne applicable, on retombe sur groups.monthly_amount.
CREATE TABLE IF NOT EXISTS budget_amounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  effective_month TEXT NOT NULL,   -- YYYY-MM
  amount REAL NOT NULL,
  UNIQUE(group_id, effective_month)
);

-- Décision de l'utilisateur sur un dépassement (un groupe x un mois).
-- group_id = 0 désigne les Non catégorisés du compte (pas de FK volontairement).
-- L'absence de ligne = non tranché. Le dernier choix gagne (upsert).
CREATE TABLE IF NOT EXISTS overspend_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  group_id INTEGER NOT NULL,       -- 0 = non catégorisés
  month TEXT NOT NULL,             -- YYYY-MM
  decision TEXT NOT NULL CHECK (decision IN ('exceptional', 'permanent')),
  decided_at TEXT NOT NULL,        -- ISO datetime
  UNIQUE(account_id, group_id, month)
);
```

- [ ] **Step 4: Écrire les repositories**

`src/db/repositories/budget-amounts.ts` :

```ts
import type Database from "better-sqlite3";

export type BudgetAmount = { groupId: number; effectiveMonth: string; amount: number };

export function listBudgetAmounts(db: Database.Database): BudgetAmount[] {
  return (
    db
      .prepare(`SELECT group_id AS groupId, effective_month AS effectiveMonth, amount FROM budget_amounts ORDER BY group_id, effective_month`)
      .all() as BudgetAmount[]
  );
}

export function setBudgetAmount(db: Database.Database, groupId: number, effectiveMonth: string, amount: number): void {
  db.prepare(
    `INSERT INTO budget_amounts (group_id, effective_month, amount) VALUES (?, ?, ?)
     ON CONFLICT(group_id, effective_month) DO UPDATE SET amount = excluded.amount`,
  ).run(groupId, effectiveMonth, amount);
}
```

`src/db/repositories/overspend-decisions.ts` :

```ts
import type Database from "better-sqlite3";

// group_id = 0 désigne les Non catégorisés du compte.
export type OverspendDecision = {
  accountId: string;
  groupId: number;
  month: string; // YYYY-MM
  decision: "exceptional" | "permanent";
  decidedAt: string; // ISO datetime
};

export function listOverspendDecisions(db: Database.Database, accountId: string): OverspendDecision[] {
  return (
    db
      .prepare(
        `SELECT account_id AS accountId, group_id AS groupId, month, decision, decided_at AS decidedAt
         FROM overspend_decisions WHERE account_id = ? ORDER BY month, group_id`,
      )
      .all(accountId) as OverspendDecision[]
  );
}

export function setOverspendDecision(db: Database.Database, d: OverspendDecision): void {
  db.prepare(
    `INSERT INTO overspend_decisions (account_id, group_id, month, decision, decided_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(account_id, group_id, month) DO UPDATE SET decision = excluded.decision, decided_at = excluded.decided_at`,
  ).run(d.accountId, d.groupId, d.month, d.decision, d.decidedAt);
}
```

- [ ] **Step 5: Vérifier le passage**

Run: `npx vitest run tests/db/overspend-tables.test.ts`
Expected: PASS (2 tests). Puis `npx tsc --noEmit` : aucun diagnostic.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.sql src/db/repositories/budget-amounts.ts src/db/repositories/overspend-decisions.ts tests/db/overspend-tables.test.ts
git commit -m "feat(db): budgets datés et décisions de dépassement (tables + repositories)"
```

---

### Task 2: Budget en vigueur par mois dans computeHistory

**Files:**
- Modify: `src/lib/history.ts` (fonction `budgetOf` ligne ~95, `cellsFor`/`rowFor` lignes ~146-200, signature de `computeHistory` ligne ~113)
- Modify: `src/app/historique/page.tsx` (chargement + passage des budgets datés)
- Test: `tests/lib/history.test.ts`

**Interfaces:**
- Consumes: `listBudgetAmounts(db)` (Task 1).
- Produces:
  - `export type DatedBudgets = Record<number, { effectiveMonth: string; amount: number }[]>` (listes triées par `effectiveMonth` croissant)
  - `export function budgetInForce(g: Group, month: string, dated?: DatedBudgets): number`
  - `computeHistory(groups, txns, months, currentMonth, dated?: DatedBudgets)` — 5e paramètre optionnel ; sans lui, comportement inchangé.
  - `export function toDatedBudgets(rows: { groupId: number; effectiveMonth: string; amount: number }[]): DatedBudgets`

- [ ] **Step 1: Écrire le test qui échoue**

Dans `tests/lib/history.test.ts` (le fichier définit déjà `courses` — enveloppe out, monthlyAmount 300 — et le helper `tx`) :

```ts
test("budgets datés : le budget en vigueur dépend du mois, sans rétroactivité", () => {
  const dated = { 1: [{ effectiveMonth: "2026-08", amount: 400 }] };
  const txns = [tx({ id: "1", date: "2026-07-10", amount: -350, label: "CARREFOUR", groupId: 1 })];
  const sections = computeHistory([courses], txns, ["2026-07", "2026-08"], "2026-07", dated);
  const row = sections[0].rows[0];
  // Juillet garde l'ancien budget (300) : le dépassement de 50 reste visible.
  expect(row.cells[0]).toEqual({ budgeted: 300, depense: 350, recu: 0, balance: -50 });
  // Août applique le nouveau budget (400), rien de dépensé encore.
  expect(row.cells[1]).toEqual({ budgeted: 400, depense: 0, recu: 0, balance: 400 });
});
```

Ajouter `budgetInForce` et `toDatedBudgets` à l'import de `../../src/lib/history` en tête de fichier, et :

```ts
test("budgetInForce : dernier montant daté <= mois, repli sur monthlyAmount", () => {
  const dated = { 1: [{ effectiveMonth: "2026-08", amount: 400 }, { effectiveMonth: "2026-10", amount: 450 }] };
  expect(budgetInForce(courses, "2026-07", dated)).toBe(300); // avant toute ligne datée
  expect(budgetInForce(courses, "2026-08", dated)).toBe(400);
  expect(budgetInForce(courses, "2026-09", dated)).toBe(400);
  expect(budgetInForce(courses, "2026-11", dated)).toBe(450);
  expect(budgetInForce(courses, "2026-07")).toBe(300); // sans budgets datés
});

test("toDatedBudgets regroupe et conserve l'ordre par mois", () => {
  expect(
    toDatedBudgets([
      { groupId: 1, effectiveMonth: "2026-08", amount: 400 },
      { groupId: 2, effectiveMonth: "2026-09", amount: 50 },
      { groupId: 1, effectiveMonth: "2026-10", amount: 450 },
    ]),
  ).toEqual({ 1: [{ effectiveMonth: "2026-08", amount: 400 }, { effectiveMonth: "2026-10", amount: 450 }], 2: [{ effectiveMonth: "2026-09", amount: 50 }] });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run tests/lib/history.test.ts`
Expected: FAIL (`budgetInForce` / `toDatedBudgets` non exportés ; 5e argument inconnu).

- [ ] **Step 3: Implémenter dans src/lib/history.ts**

Sous `budgetOf` (ligne ~97), ajouter :

```ts
// Budgets datés : pour chaque groupe, la liste de ses montants avec leur mois
// d'entrée en vigueur (triée par mois croissant). Le montant en vigueur pour un
// mois M est celui de la dernière entrée dont effectiveMonth <= M ; sans entrée
// applicable, on retombe sur le budget « constant » du groupe (monthlyAmount ou
// somme des lignes). Jamais rétroactif : un mois passé garde son ancien budget.
export type DatedBudgets = Record<number, { effectiveMonth: string; amount: number }[]>;

export function budgetInForce(g: Group, month: string, dated?: DatedBudgets): number {
  let amount: number | null = null;
  for (const b of dated?.[g.id] ?? []) if (b.effectiveMonth <= month) amount = b.amount;
  return amount ?? budgetOf(g);
}

// Regroupe les lignes du repository par groupe, en conservant le tri par mois.
export function toDatedBudgets(rows: { groupId: number; effectiveMonth: string; amount: number }[]): DatedBudgets {
  const out: DatedBudgets = {};
  for (const r of rows) (out[r.groupId] ??= []).push({ effectiveMonth: r.effectiveMonth, amount: r.amount });
  return out;
}
```

Dans `computeHistory`, ajouter le 5e paramètre `dated?: DatedBudgets`. Changer `cellsFor` pour prendre une fonction de budget par mois :

```ts
  const cellsFor = (
    budgetedOf: (m: string) => number,
    isOut: boolean,
    realizedOf: (m: string) => number,
  ): MonthCell[] =>
    months.map((m) => {
      const budgeted = budgetedOf(m);
      const realized = m > currentMonth ? 0 : realizedOf(m);
      return {
        budgeted,
        depense: isOut ? realized : 0,
        recu: isOut ? 0 : realized,
        balance: isOut ? budgeted - realized : 0,
      };
    });
```

Dans `rowFor` : remplacer `const budgeted = budgetOf(g);` et l'appel par

```ts
    const cells = cellsFor((m) => budgetInForce(g, m, dated), isOut, (m) => spent(g.id, m));
```

et pour les lignes du récurrent : `cellsFor(() => l.amount, isOut, realizedOf)`.

- [ ] **Step 4: Vérifier le passage**

Run: `npx vitest run tests/lib/history.test.ts` — Expected: PASS (tous, y compris les anciens : sans `dated`, rien ne change). Puis `npx tsc --noEmit`.

- [ ] **Step 5: Brancher la page**

Dans `src/app/historique/page.tsx` : importer `listBudgetAmounts` et `toDatedBudgets`, puis au niveau du composant (avant la boucle des comptes) :

```ts
  const datedBudgets = toDatedBudgets(listBudgetAmounts(database));
```

et dans la boucle : `const sectionsFull = computeHistory(groups, txns, calcMonths, currentMonth, datedBudgets);`

- [ ] **Step 6: Vérifier et commit**

Run: `npx tsc --noEmit && npm test` — Expected: tout passe.

```bash
git add src/lib/history.ts src/app/historique/page.tsx tests/lib/history.test.ts
git commit -m "feat(historique): budgets datés — budget en vigueur par mois, sans rétroactivité"
```

---

### Task 3: computeOverspends — dépassements en attente et montants retenus

**Files:**
- Modify: `src/lib/history.ts` (après `uncatOverspend`)
- Test: `tests/lib/history.test.ts`

**Interfaces:**
- Consumes: `budgetInForce` (Task 2), helpers internes de `computeHistory` (réutilise `resolveOwnership` via le même motif que `computeHistory`).
- Produces:
  - `export type PendingOverspend = { groupId: number; name: string; month: string; amount: number }` (`groupId` 0 = Non catégorisés, `name` = "Non catégorisés")
  - `export type RetainedOverspends = { byGroup: Record<number, number>; uncat: number }`
  - `export function computeOverspends(groups: Group[], txns: Txn[], currentMonth: string, decided: { groupId: number; month: string }[], dated?: DatedBudgets): { pendingClosed: PendingOverspend[]; retained: RetainedOverspends }`
  - Règles : dépassement d'un groupe out pour un mois M ≤ courant = max(0, dépensé(M) − budgetInForce(M)) ; dépassement des Non catégorisés = max(0, dépensesSansGroupe(M) − reçusSansGroupe(M)). `pendingClosed` = dépassements de mois **terminés** (M < courant) sans décision, triés par mois puis nom. `retained` = pour chaque groupe (et l'entrée uncat), le dépassement **non tranché le plus récent** (M ≤ courant), 0 sinon.

- [ ] **Step 1: Écrire le test qui échoue**

```ts
test("computeOverspends : en attente sur mois terminés, retenu = le plus récent non tranché", () => {
  const txns = [
    tx({ id: "1", date: "2026-06-10", amount: -350, label: "CARREFOUR", groupId: 1 }), // juin : dépassement 50
    tx({ id: "2", date: "2026-07-10", amount: -380, label: "CARREFOUR", groupId: 1 }), // juillet (courant) : dépassement 80
    tx({ id: "3", date: "2026-06-05", amount: -120, label: "SANS GROUPE" }), // uncat juin : 120 dépensés
    tx({ id: "4", date: "2026-06-06", amount: 40, label: "REMBOURSEMENT" }), // uncat juin : 40 reçus -> net 80
  ];
  const r = computeOverspends([courses], txns, "2026-07", []);
  // Mois terminés non tranchés : Courses juin (50) et Non catégorisés juin (80).
  expect(r.pendingClosed).toEqual([
    { groupId: 1, name: "Courses", month: "2026-06", amount: 50 },
    { groupId: 0, name: "Non catégorisés", month: "2026-06", amount: 80 },
  ]);
  // Retenu pour les projections : le plus récent non tranché de Courses = juillet (80).
  expect(r.retained.byGroup[1]).toBe(80);
  expect(r.retained.uncat).toBe(80); // juin, seul mois uncat non tranché
});

test("computeOverspends : une décision sort le dépassement des rappels et du retenu", () => {
  const txns = [
    tx({ id: "1", date: "2026-06-10", amount: -350, label: "CARREFOUR", groupId: 1 }),
    tx({ id: "2", date: "2026-07-10", amount: -380, label: "CARREFOUR", groupId: 1 }),
  ];
  // Juillet tranché : il ne reste que juin, à la fois en attente (mois terminé) et retenu.
  const r = computeOverspends([courses], txns, "2026-07", [{ groupId: 1, month: "2026-07" }]);
  expect(r.pendingClosed).toEqual([{ groupId: 1, name: "Courses", month: "2026-06", amount: 50 }]);
  expect(r.retained.byGroup[1]).toBe(50);
  // Tout tranché : plus rien nulle part.
  const r2 = computeOverspends([courses], txns, "2026-07", [
    { groupId: 1, month: "2026-06" },
    { groupId: 1, month: "2026-07" },
  ]);
  expect(r2.pendingClosed).toEqual([]);
  expect(r2.retained.byGroup[1] ?? 0).toBe(0);
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run tests/lib/history.test.ts` — Expected: FAIL (`computeOverspends` non exporté).

- [ ] **Step 3: Implémenter dans src/lib/history.ts**

Après `uncatOverspend` :

```ts
// Dépassements par (groupe x mois), avec l'état de décision de l'utilisateur.
// pendingClosed : dépassements de mois terminés sans décision (bandeau/pastilles).
// retained : pour chaque groupe (et les non catégorisés via `uncat`), le
// dépassement non tranché le plus récent (mois courant inclus) — c'est lui que
// la chaîne « Solde si dépassement » reconduit sur les mois futurs.
export type PendingOverspend = { groupId: number; name: string; month: string; amount: number };
export type RetainedOverspends = { byGroup: Record<number, number>; uncat: number };

export function computeOverspends(
  groups: Group[],
  txns: Txn[],
  currentMonth: string,
  decided: { groupId: number; month: string }[],
  dated?: DatedBudgets,
): { pendingClosed: PendingOverspend[]; retained: RetainedOverspends } {
  const ownable = groups.map(toOwnable);
  const owned = txns.map((t) => {
    const o: OwnedTxn = { id: t.id, date: t.date, amount: t.amount, label: t.label, accountId: t.accountId, groupId: t.groupId, excluded: t.excluded };
    const res = resolveOwnership(o, ownable);
    return { t, ownerId: res.status === "manual" ? res.groupId : null, month: t.date.slice(0, 7) };
  });
  const isDecided = new Set(decided.map((d) => `${d.groupId}::${d.month}`));
  const months = monthsWithData(txns).filter((m) => m <= currentMonth);

  const pendingClosed: PendingOverspend[] = [];
  const retained: RetainedOverspends = { byGroup: {}, uncat: 0 };
  for (const m of months) {
    // Groupes de dépense : dépensé au-delà du budget en vigueur ce mois-là.
    for (const g of groups) {
      if (g.direction !== "out") continue;
      const spent = owned.filter((o) => o.ownerId === g.id && o.month === m).reduce((s, o) => s + Math.abs(o.t.amount), 0);
      const os = Math.max(0, spent - budgetInForce(g, m, dated));
      if (os <= 0.005 || isDecided.has(`${g.id}::${m}`)) continue;
      if (m < currentMonth) pendingClosed.push({ groupId: g.id, name: g.name, month: m, amount: os });
      retained.byGroup[g.id] = os; // les mois sont croissants : le dernier écrase = le plus récent
    }
    // Non catégorisés : dépensé au-delà des reçus, sans groupe.
    const uncat = owned.filter((o) => o.ownerId === null && o.month === m);
    const dep = uncat.filter((o) => o.t.amount < 0).reduce((s, o) => s + Math.abs(o.t.amount), 0);
    const rec = uncat.filter((o) => o.t.amount > 0).reduce((s, o) => s + o.t.amount, 0);
    const os = Math.max(0, dep - rec);
    if (os > 0.005 && !isDecided.has(`0::${m}`)) {
      if (m < currentMonth) pendingClosed.push({ groupId: 0, name: "Non catégorisés", month: m, amount: os });
      retained.uncat = os;
    }
  }
  // Tri : par mois puis nom, pour un bandeau stable.
  pendingClosed.sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : a.name.localeCompare(b.name)));
  return { pendingClosed, retained };
}
```

Note : `retained.uncat` doit rester 0 quand tous les mois uncat sont tranchés — c'est le cas car il n'est écrit que pour un mois non tranché ; idem `byGroup` (pas d'entrée = 0).

- [ ] **Step 4: Vérifier le passage et commit**

Run: `npx vitest run tests/lib/history.test.ts && npx tsc --noEmit` — Expected: PASS.

```bash
git add src/lib/history.ts tests/lib/history.test.ts
git commit -m "feat(historique): computeOverspends — dépassements en attente et montants retenus"
```

---

### Task 4: La chaîne « Solde si dépassement » se fonde sur les dépassements retenus

**Files:**
- Modify: `src/lib/history.ts` (`computePlannedSoldes`)
- Modify: `src/app/historique/page.tsx` (calcul et passage de `retained` + `pendingClosed` + décisions)
- Modify: `src/components/history-with-detail.tsx`, `src/components/history-grid.tsx` (prop `retained`, décompositions des mois futurs)
- Test: `tests/lib/history.test.ts`

**Interfaces:**
- Consumes: `RetainedOverspends` (Task 3), `listOverspendDecisions` (Task 1).
- Produces:
  - `computePlannedSoldes(sections, months, currentMonth, openingsReal, currentEstimate?, retained?: RetainedOverspends)` — 6e paramètre optionnel. Mois passés/courant : inchangés (dépassements réels du mois). Mois futurs : chaque ligne de groupe soustrait `retained.byGroup[r.id] ?? 0` (au lieu du dépassement du mois courant), l'étape uncat « out » soustrait `retained.uncat` (au lieu de `uncatOverspend(sections, ci)`). Sans `retained`, comportement actuel conservé (repli).
  - `HistoryGrid` et `HistoryWithDetail` acceptent une prop `retained?: RetainedOverspends`, utilisée par les décompositions des mois futurs (montants du « Dépassement cumulé » par ligne et au grand total, `depassVal` futur des Non catégorisés).

- [ ] **Step 1: Écrire le test qui échoue**

```ts
test("computePlannedSoldes : les mois futurs reconduisent les dépassements retenus, pas ceux du mois courant", () => {
  const principal: Group = { id: 1, accountId: "a1", name: "Rémunération principale", direction: "in", kind: "envelope", monthlyAmount: 2000, keywords: [], lines: [], incomeKind: "principal" };
  const courses2: Group = { id: 2, accountId: "a1", name: "Courses", direction: "out", kind: "envelope", monthlyAmount: 300, keywords: [], lines: [], incomeKind: null };
  const txns = [
    tx({ id: "s", date: "2026-07-01", amount: 2000, label: "REMU", groupId: 1 }),
    tx({ id: "c", date: "2026-07-10", amount: -350, label: "CARREFOUR", groupId: 2 }), // dépassement courant : 50
  ];
  const months = ["2026-07", "2026-08"];
  const sections = computeHistory([principal, courses2], txns, months, "2026-07");
  const solde = computeSolde(sections, months, "2026-07", 5000);
  const open = solde.openings[0];
  // Non tranché : retained = 50 -> août le soustrait (comme avant).
  const pending = computePlannedSoldes(sections, months, "2026-07", solde.openings, null, { byGroup: { 2: 50 }, uncat: 0 });
  expect(pending.depassClosings[1]).toBeCloseTo((open + 2000 - 300 - 50) + (2000 - 300 - 50), 2);
  // Tranché (exceptionnel) : retained vide -> août ne soustrait plus rien.
  const decided = computePlannedSoldes(sections, months, "2026-07", solde.openings, null, { byGroup: {}, uncat: 0 });
  expect(decided.depassClosings[1]).toBeCloseTo((open + 2000 - 300 - 50) + (2000 - 300), 2);
  // Le mois courant reste factuel dans les deux cas (dépassement réel de 50).
  expect(decided.depassClosings[0]).toBeCloseTo(open + 2000 - 300 - 50, 2);
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run tests/lib/history.test.ts` — Expected: FAIL (6e argument inconnu / valeurs).

- [ ] **Step 3: Implémenter computePlannedSoldes**

Signature : `export function computePlannedSoldes(sections, months, currentMonth, openingsReal, currentEstimate?: number | null, retained?: RetainedOverspends): PlannedSoldes`.

Dans la boucle, remplacer les deux soustractions des mois **non ancrés** :

```ts
      if (sec.kind === "uncategorized") {
        const dir = sec.uncatDirection ?? "out";
        if (dir === "out")
          runD -= anchored ? uncatOverspend(sections, osMonth) : retained ? retained.uncat : uncatOverspend(sections, osMonth);
        ...
      } else {
        for (const r of sec.rows) {
          const net = rowRevenus(r, i, isCurrent) - rowBudget(r, i);
          runP += net;
          const os = anchored ? rowOverspend(r, osMonth) : retained ? retained.byGroup[r.id] ?? 0 : rowOverspend(r, osMonth);
          runD += net - os;
          ...
        }
      }
```

- [ ] **Step 4: Vérifier le passage lib**

Run: `npx vitest run tests/lib/history.test.ts` — Expected: PASS (les anciens tests passent sans `retained` grâce au repli).

- [ ] **Step 5: Brancher la page et le tableau**

`src/app/historique/page.tsx`, dans la boucle des comptes (après `datedBudgets`) :

```ts
          const decisions = listOverspendDecisions(database, a.id);
          const overspends = computeOverspends(groups, txns, currentMonth, decisions, datedBudgets);
          const plannedFull = computePlannedSoldes(sectionsFull, calcMonths, currentMonth, soldeFull.openings, estimateValue, overspends.retained);
```

puis passer à `HistoryWithDetail` les nouvelles props `retained={overspends.retained}` (et garder `overspends.pendingClosed` + `decisions` sous la main : elles servent aux Tasks 6 et 7).

`src/components/history-with-detail.tsx` : ajouter `retained` au type des props et le transmettre à `HistoryGrid`.

`src/components/history-grid.tsx` : ajouter la prop `retained?: RetainedOverspends` et l'utiliser pour les mois futurs :
- `depassCumulByRow` : pour un mois futur (`months[i] > currentMonth`), la liste cumulée se construit à partir de `retained.byGroup` (mêmes groupes, montants retenus) au lieu de `cells[ciSafe]` ;
- `GrandTotalsCells` (prop à ajouter aussi) : pour un mois futur, `uncatOs = retained?.uncat ?? uncatOverspend(sections, cs)` et `grandOverspendChildren` se construit depuis `retained.byGroup` (label = nom du groupe, montant négatif) ;
- `SectionTotalsCells` : `depassVal` d'un mois futur pour les Non catégorisés = `retained?.uncat ?? …` (repli sur le calcul actuel).

Les renvois (refs) restent ceux du mois affiché (règle déjà en place).

- [ ] **Step 6: Vérifier et commit**

Run: `npx tsc --noEmit && npm test` — Expected: tout passe. Vérification manuelle : `npm run dev`, onglet Historique, les colonnes « Solde si dépassement » des mois futurs bougent quand on insère une décision à la main :
`sqlite3 data/budget.db "INSERT INTO overspend_decisions (account_id, group_id, month, decision, decided_at) VALUES ('<id compte>', <id groupe>, '2026-07', 'exceptional', '2026-07-20T00:00:00Z')"` puis recharger.

```bash
git add src/lib/history.ts src/app/historique/page.tsx src/components/history-with-detail.tsx src/components/history-grid.tsx tests/lib/history.test.ts
git commit -m "feat(historique): la chaîne Solde si dépassement reconduit les dépassements non tranchés"
```

---

### Task 5: Server action de décision

**Files:**
- Create: `src/app/historique/actions.ts`

**Interfaces:**
- Consumes: `setOverspendDecision`, `setBudgetAmount` (Task 1), `monthKey` de `src/lib/money.ts`.
- Produces: `export async function decideOverspend(accountId: string, groupId: number, month: string, decision: "exceptional" | "permanent", newBudget?: number): Promise<void>` — enregistre la décision ; si `permanent` avec `groupId !== 0` et `newBudget` valide (> 0), crée le budget daté effectif au **mois courant** ; revalide les pages.

- [ ] **Step 1: Écrire l'action**

`src/app/historique/actions.ts` :

```ts
"use server";
import { db } from "../../db/index";
import { setOverspendDecision } from "../../db/repositories/overspend-decisions";
import { setBudgetAmount } from "../../db/repositories/budget-amounts";
import { monthKey } from "../../lib/money";
import { revalidatePath } from "next/cache";

// Enregistre la décision de l'utilisateur sur un dépassement (groupId 0 = non
// catégorisés). « permanent » relève aussi le budget du groupe, effectif au mois
// courant — jamais rétroactif (les mois passés gardent l'ancien budget).
export async function decideOverspend(
  accountId: string,
  groupId: number,
  month: string,
  decision: "exceptional" | "permanent",
  newBudget?: number,
): Promise<void> {
  if (!/^\d{4}-\d{2}$/.test(month)) return;
  const database = db();
  setOverspendDecision(database, { accountId, groupId, month, decision, decidedAt: new Date().toISOString() });
  if (decision === "permanent" && groupId !== 0 && newBudget != null && Number.isFinite(newBudget) && newBudget > 0) {
    setBudgetAmount(database, groupId, monthKey(new Date().toISOString().slice(0, 10)), newBudget);
  }
  revalidatePath("/historique");
  revalidatePath("/previsionnel");
  revalidatePath("/");
}
```

- [ ] **Step 2: Vérifier et commit**

Run: `npx tsc --noEmit` — Expected: aucun diagnostic (la logique DB est couverte par les tests de la Task 1).

```bash
git add src/app/historique/actions.ts
git commit -m "feat(historique): action serveur de décision sur un dépassement"
```

---

### Task 6: Bloc de décision dans le side panel

**Files:**
- Modify: `src/lib/history-explain.ts` (type `CellDetail`)
- Modify: `src/components/history-detail-sidebar.tsx` (rendu du bloc + mini-formulaire « permanent »)
- Modify: `src/components/history-grid.tsx` (attacher l'action aux Balances rouges ; props `accountId` + `decisions`)
- Modify: `src/components/history-with-detail.tsx`, `src/app/historique/page.tsx` (threading des props)

**Interfaces:**
- Consumes: `decideOverspend` (Task 5), décisions chargées en page (Task 4).
- Produces:
  - Dans `history-explain.ts` :
    ```ts
    export type OverspendActionInfo = {
      accountId: string;
      groupId: number;            // 0 = non catégorisés
      groupName: string;
      month: string;              // YYYY-MM
      amount: number;             // dépassement, positif
      decision: "exceptional" | "permanent" | null; // null = non tranché
      currentBudget: number | null; // null = pas d'option « permanent » (non catégorisés)
    };
    ```
    et `CellDetail` gagne `overspendAction?: OverspendActionInfo`.
  - `HistoryGrid` accepte `accountId: string` et `decisions?: { groupId: number; month: string; decision: "exceptional" | "permanent" }[]`.

- [ ] **Step 1: Étendre CellDetail**

Dans `src/lib/history-explain.ts`, ajouter le type `OverspendActionInfo` ci-dessus (avec un commentaire en français) et le champ `overspendAction?: OverspendActionInfo` à `CellDetail`.

- [ ] **Step 2: Rendre le bloc dans le side panel**

Dans `src/components/history-detail-sidebar.tsx`, créer un composant local (dans le même fichier) :

```tsx
// Bloc de décision d'un dépassement : affiché sous le détail quand la case
// cliquée est une Balance en dépassement. « Exceptionnel » enregistre en un
// clic ; « Permanent » déplie un mini-formulaire avec le nouveau budget
// pré-rempli (budget + dépassement), ajustable avant validation.
function OverspendActionBlock({ action }: { action: OverspendActionInfo }) {
  const router = useRouter();
  const [openForm, setOpenForm] = useState(false);
  const [value, setValue] = useState(() => String(Math.round(((action.currentBudget ?? 0) + action.amount) * 100) / 100));
  const [busy, setBusy] = useState(false);
  const decide = async (decision: "exceptional" | "permanent", newBudget?: number) => {
    setBusy(true);
    await decideOverspend(action.accountId, action.groupId, action.month, decision, newBudget);
    setBusy(false);
    setOpenForm(false);
    router.refresh();
  };
  return (
    <div className="mt-4 rounded-md border p-3 text-sm">
      <p>
        Dépassement de {fmtAbs(action.amount)} en {monthLabel(action.month)} — que veux-tu en faire ?
      </p>
      {action.decision && (
        <p className="text-muted-foreground mt-1">
          Décidé : {action.decision === "exceptional" ? "exceptionnel" : "permanent"} (modifiable)
        </p>
      )}
      <div className="mt-2 flex gap-2">
        <button type="button" disabled={busy} onClick={() => decide("exceptional")} className="rounded-md border px-2 py-1 hover:bg-muted">
          Exceptionnel
        </button>
        {action.currentBudget != null && (
          <button type="button" disabled={busy} onClick={() => setOpenForm((v) => !v)} className="rounded-md border px-2 py-1 hover:bg-muted">
            Permanent
          </button>
        )}
      </div>
      {openForm && action.currentBudget != null && (
        <div className="mt-2 flex items-center gap-2">
          <label className="text-muted-foreground" htmlFor="new-budget">Nouveau budget</label>
          <input
            id="new-budget"
            type="number"
            step="0.01"
            min="0"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-24 rounded-md border px-2 py-1 text-right tabular-nums"
          />
          <button
            type="button"
            disabled={busy || !(parseFloat(value) > 0)}
            onClick={() => decide("permanent", parseFloat(value))}
            className="bg-primary text-primary-foreground rounded-md px-2 py-1"
          >
            Valider
          </button>
        </div>
      )}
    </div>
  );
}
```

Imports à ajouter en tête du fichier : `useRouter` de `next/navigation`, `decideOverspend` de `@/app/historique/actions`, `OverspendActionInfo` (type) de `@/lib/history-explain`, et un helper local `monthLabel` importé de `@/lib/transactions-view`. Rendu : dans `DetailBody`, après le `<Table>` (avant `detail.note`), ajouter `{detail.overspendAction && <OverspendActionBlock action={detail.overspendAction} />}`.

- [ ] **Step 3: Attacher l'action aux Balances rouges dans le tableau**

Dans `src/components/history-grid.tsx` :
- `HistoryGrid` reçoit `accountId: string` et `decisions?: { groupId: number; month: string; decision: "exceptional" | "permanent" }[]` ; construire `const decisionByKey = useMemo(() => new Map((decisions ?? []).map((d) => [`${d.groupId}::${d.month}`, d.decision])), [decisions]);` et le passer (avec `accountId`) à `AmountCells` (lignes de groupes) et `SectionTotalsCells` (Non catégorisés « out »).
- Dans `AmountCells` (ligne de groupe, `mode === "out"`), quand `month <= currentMonth` et `c.balance < -0.005`, enrichir `resteDetail` :

```ts
        if (resteDetail && mode === "out" && month <= currentMonth && c.balance < -0.005 && r && accountId) {
          resteDetail.overspendAction = {
            accountId,
            groupId: r.id,
            groupName: r.name,
            month,
            amount: -c.balance,
            decision: decisionByKey?.get(`${r.id}::${month}`) ?? null,
            currentBudget: c.budgeted,
          };
        }
```

- Dans `SectionTotalsCells` (uniquement la section Non catégorisés « out »), même motif sur son `resteDetail` quand `resteVal < -0.005` et `month <= currentMonth`, avec `groupId: 0`, `groupName: "Non catégorisés"`, `amount: -resteVal`, `currentBudget: null`.
- Les sous-lignes (postes d'un récurrent) ne reçoivent pas d'action : la décision se prend au niveau du groupe.

- [ ] **Step 4: Thread des props**

`src/components/history-with-detail.tsx` : props `accountId: string`, `decisions`, transmis à `HistoryGrid`. `src/app/historique/page.tsx` : `<HistoryWithDetail … accountId={a.id} decisions={decisions.map(({ groupId, month, decision }) => ({ groupId, month, decision }))} />`.

- [ ] **Step 5: Vérifier et commit**

Run: `npx tsc --noEmit && npm test` — Expected: tout passe. Vérification manuelle (`npm run dev`) : cliquer une Balance rouge d'un mois passé → le bloc de décision apparaît ; « Exceptionnel » → refresh, le « Solde si dépassement » des mois futurs remonte ; « Permanent » → le formulaire propose budget + dépassement, la validation crée la ligne dans `budget_amounts` (vérifier `sqlite3 data/budget.db "SELECT * FROM budget_amounts"`) et le Budget dép. des mois ≥ courant change, pas celui des mois passés.

```bash
git add src/lib/history-explain.ts src/components/history-detail-sidebar.tsx src/components/history-grid.tsx src/components/history-with-detail.tsx src/app/historique/page.tsx
git commit -m "feat(historique): bloc de décision de dépassement dans le side panel"
```

---

### Task 7: Bandeau, pastille et renommage de la colonne

**Files:**
- Create: `src/components/overspend-banner.tsx`
- Modify: `src/components/history-with-detail.tsx` (bandeau au-dessus du tableau)
- Modify: `src/components/history-grid.tsx` (pastille sur les lignes, renommage colonne, COL_INFO)
- Modify: `src/app/historique/page.tsx` (prop `pendingClosed`)

**Interfaces:**
- Consumes: `PendingOverspend` (Task 3), `OverspendActionInfo` (Task 6), `useDetailSidebar` (contexte existant), `setDetail`.
- Produces:
  - `export function overspendDecisionDetail(item: PendingOverspend, accountId: string, monthIdx: number | null, decision: "exceptional" | "permanent" | null, currentBudget: number | null): CellDetail` (dans `overspend-banner.tsx`) — détail minimal : titre « Dépassement », sous-titre `«nom» · «mois»`, `result = item.amount`, `nodes: []`, `cellRef` = case Balance du bon mois si `monthIdx != null` (`groupRow(id)` ou `sectionRow("uncategorized")`), et `overspendAction` rempli.
  - `export function OverspendBanner({ items, accountId, months, budgets }: …)` — composant client rendu par `HistoryWithDetail`.
  - `HistoryGrid` accepte `pendingClosed?: PendingOverspend[]` et `currentBudgets?: Record<number, number>` (pastilles + pré-remplissage).

- [ ] **Step 1: Créer le bandeau**

`src/components/overspend-banner.tsx` :

```tsx
"use client";
import { TriangleAlert } from "lucide-react";
import { monthLabel } from "@/lib/transactions-view";
import { cellKey, groupRow, sectionRow, type CellDetail } from "@/lib/history-explain";
import type { PendingOverspend } from "@/lib/history";
import { useDetailSidebar } from "@/components/detail-sidebar";

const NUM = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Détail minimal ouvert par le bandeau ou la pastille : le montant du
// dépassement et le bloc de décision. cellRef surligne la Balance du bon mois
// quand il est affiché (monthIdx), sinon le panneau s'ouvre sans surbrillance.
export function overspendDecisionDetail(
  item: PendingOverspend,
  accountId: string,
  monthIdx: number | null,
  decision: "exceptional" | "permanent" | null,
  currentBudget: number | null,
): CellDetail {
  return {
    title: "Dépassement",
    subtitle: `${item.name} · ${monthLabel(item.month)}`,
    nodes: [],
    result: item.amount,
    cellRef:
      monthIdx != null
        ? cellKey(item.groupId === 0 ? sectionRow("uncategorized") : groupRow(item.groupId), "reste", monthIdx)
        : undefined,
    overspendAction: {
      accountId,
      groupId: item.groupId,
      groupName: item.name,
      month: item.month,
      amount: item.amount,
      decision,
      currentBudget,
    },
  };
}

// Bandeau « dépassements à traiter » : listé par mois terminé, chaque élément
// ouvre le side panel de décision du bon groupe et du bon mois.
export function OverspendBanner({ items, accountId, months, budgets }: {
  items: PendingOverspend[];
  accountId: string;
  months: string[]; // mois affichés, pour retrouver l'index de la colonne
  budgets: Record<number, number>; // budget courant par groupe (pré-remplissage)
}) {
  const { setDetail } = useDetailSidebar();
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950">
      <TriangleAlert className="size-4 shrink-0 text-amber-600" />
      <span>Des dépassements attendent une décision :</span>
      {items.map((it) => (
        <button
          key={`${it.groupId}-${it.month}`}
          type="button"
          onClick={() =>
            setDetail(overspendDecisionDetail(it, accountId, months.indexOf(it.month) === -1 ? null : months.indexOf(it.month), null, it.groupId === 0 ? null : budgets[it.groupId] ?? null))
          }
          className="cursor-pointer underline decoration-dotted underline-offset-2 hover:no-underline"
        >
          {it.name} ({NUM.format(it.amount)} € · {monthLabel(it.month)})
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Rendre le bandeau et calculer les budgets courants**

`src/app/historique/page.tsx` : passer `pendingClosed={overspends.pendingClosed}` et `currentBudgets` à `HistoryWithDetail` — construire dans la boucle :

```ts
          const currentBudgets = Object.fromEntries(groups.map((g) => [g.id, budgetInForce(g, currentMonth, datedBudgets)]));
```

`src/components/history-with-detail.tsx` : ajouter les props `pendingClosed?: PendingOverspend[]`, `currentBudgets?: Record<number, number>`, et rendre, au-dessus de `<CenterScroll>` :

```tsx
    <div className="flex flex-col gap-3">
      {props.pendingClosed && props.pendingClosed.length > 0 && (
        <OverspendBanner items={props.pendingClosed} accountId={props.accountId} months={props.months} budgets={props.currentBudgets ?? {}} />
      )}
      <CenterScroll>…</CenterScroll>
    </div>
```

- [ ] **Step 3: Pastille sur les lignes concernées**

`src/components/history-grid.tsx` : props `pendingClosed?: PendingOverspend[]` et `currentBudgets?: Record<number, number>`. Construire :

```ts
  // Premier dépassement en attente par groupe (le plus ancien), pour la pastille.
  const pendingByGroup = useMemo(() => {
    const m = new Map<number, PendingOverspend>();
    for (const p of pendingClosed ?? []) if (!m.has(p.groupId)) m.set(p.groupId, p);
    return m;
  }, [pendingClosed]);
```

Dans `renderGroup`, à côté du nom quand `pendingByGroup.has(r.id)` :

```tsx
            <button
              type="button"
              aria-label="Dépassement à traiter"
              onClick={(e) => {
                e.stopPropagation();
                const p = pendingByGroup.get(r.id)!;
                const idx = months.indexOf(p.month);
                onSelect(overspendDecisionDetail(p, accountId, idx === -1 ? null : idx, null, currentBudgets?.[r.id] ?? null));
              }}
              className="ml-1 inline-block size-2 shrink-0 rounded-full bg-amber-500"
            />
```

Même pastille sur la ligne « Non catégorisés » (out) via `pendingByGroup.get(0)` dans `renderUncatRows` (le `NameCell` y est accessible), avec `null` comme dernier argument (pas de budget pour les non catégorisés).

- [ ] **Step 4: Renommer la colonne et réécrire son explication**

Dans `src/components/history-grid.tsx` :
- `COL_LABEL.soldeDepass` : `"Solde si dépassement"`.
- `COL_INFO.soldeDepass` remplacé par :

```ts
  soldeDepass: [
    "C'est l'hypothèse défavorable : où tu atterris si les dépassements que tu n'as pas encore tranchés se répètent chaque mois.",
    "Quand un budget déborde, l'app te demande de décider : exceptionnel (un accident, on arrête de le compter) ou permanent (ton budget monte, et c'est le Solde prévu qui l'absorbe). Tant que tu n'as pas décidé, le dépassement est reconduit ici, par prudence.",
    "L'écart entre « Solde prévu » et cette colonne mesure donc exactement ce qu'il te reste à trancher. Chaque décision le referme un peu ; quand tout est réglé, les deux colonnes disent la même chose.",
    "Sur les mois passés et le mois en cours, pas d'hypothèse : ce sont tes dépassements réels qui sont retirés.",
  ],
```

- [ ] **Step 5: Vérifier et commit**

Run: `npx tsc --noEmit && npm test` — Expected: tout passe. Vérification manuelle (`npm run dev`) : insérer un dépassement de test sur un mois passé si besoin, vérifier que le bandeau liste le dépassement, que le clic ouvre le panneau de décision (avec surbrillance de la Balance quand le mois est affiché), que la pastille apparaît à côté du nom, et que bandeau + pastille disparaissent après décision. Vérifier l'en-tête « Solde si dépassement » et son explication au clic.

```bash
git add src/components/overspend-banner.tsx src/components/history-with-detail.tsx src/components/history-grid.tsx src/app/historique/page.tsx
git commit -m "feat(historique): bandeau et pastille des dépassements à traiter, colonne Solde si dépassement"
```

---

## Ordre et dépendances

Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6 → Task 7 (strictement séquentiel : chaque tâche consomme les interfaces de la précédente).

## Vérification finale

- `npx tsc --noEmit && npm test` : tout vert.
- Parcours complet dans le navigateur (`npm run dev`) sur le compte réel : Balance rouge → décision exceptionnelle → l'écart Solde prévu / Solde si dépassement se referme ; décision permanente → budget relevé au mois courant, mois passés inchangés ; bandeau et pastilles cohérents ; « Dépassement hors budget » (ligne du bas) inchangé dans sa logique.
