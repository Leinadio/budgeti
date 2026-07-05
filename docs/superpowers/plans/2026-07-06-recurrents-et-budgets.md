# Paiements récurrents et refonte des budgets — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter les paiements récurrents (nom + mot-clé + montant mensuel prévu, reliés aux vraies transactions par mot-clé) et permettre la création directe de budgets, avec des montants mensuels récurrents.

**Architecture:** Deux couches indépendantes qui réutilisent les patterns existants (mot-clé insensible à la casse comme les règles, `ensureCategory`, server actions + `revalidatePath`, composants shadcn/ui). Le modèle de budget passe de « par mois » à « montant mensuel récurrent » (une ligne par catégorie), avec une migration idempotente au démarrage. Les paiements récurrents sont une nouvelle table + page dédiée.

**Tech Stack:** Next.js (App Router, TypeScript, React), SQLite (better-sqlite3), Vitest, shadcn/ui, Tailwind CSS v4.

## Global Constraints

- App locale mono-utilisateur ; les données bancaires ne quittent pas la machine.
- Montants prévus récurrents par défaut : définis une fois, appliqués à tous les mois. La dépense courante se calcule sur le mois affiché (mois en cours).
- Mot-clé matché insensiblement à la casse contre le libellé de transaction ; débits uniquement (`amount < 0`) ; dépense = somme des `Math.abs(amount)`.
- Réutiliser `ensureCategory`, les server actions avec `revalidatePath`, les composants shadcn/ui déjà en place (`@/components/ui/*`). Le composant Table n'exporte PAS de `TableFooter` : rendre les totaux comme une ligne normale dans `TableBody`.
- `"limit"` est un mot réservé SQL : l'alias doit rester entre guillemets doubles dans les requêtes.
- Vérification finale en lançant le vrai serveur (`npm run dev`), pas seulement `npm test` (les DB `:memory:` ne voient pas certains bugs runtime).
- Gate d'implémentation par tâche : `npx tsc --noEmit` doit passer (le serveur dev bloque un subagent).

---

## File Structure

- `src/lib/budget.ts` (modifié) : `Budget` perd `month` ; `computeEnvelopes` ne filtre plus par mois.
- `src/lib/recurring.ts` (créé) : calcul des dépenses des paiements récurrents.
- `src/db/schema.sql` (modifié) : table `budgets` refondue + nouvelle table `recurring_payments`.
- `src/db/migrations.ts` (créé) : `migrateBudgets` convertit l'ancien schéma.
- `src/db/index.ts` (modifié) : appelle `migrateBudgets` après le schéma.
- `src/db/repositories/budgets.ts` (modifié) : `list/set/delete` sans mois.
- `src/db/repositories/recurring.ts` (créé) : `list/insert/delete`.
- `src/app/budgets/page.tsx` + `actions.ts` (refonte) : création directe + liste éditable + suppression.
- `src/app/recurring/page.tsx` + `actions.ts` (créés) : formulaire + table + total.
- `src/app/layout.tsx` (modifié) : lien nav « Récurrents ».
- `src/app/page.tsx` (modifié) : enveloppes au nouveau modèle + carte Récurrents.
- Tests : `tests/lib/budget.test.ts` (maj), `tests/lib/recurring.test.ts` (créé), `tests/db/repositories.test.ts` (maj), `tests/db/schema.test.ts` (maj), `tests/db/migration.test.ts` (créé).

---

## Task 1 : Refonte de la lib budget (montant récurrent)

**Files:**
- Modify: `src/lib/budget.ts`
- Test: `tests/lib/budget.test.ts`

**Interfaces:**
- Consumes: `monthKey` de `src/lib/money.ts`.
- Produces:
  - `type Txn = { date: string; amount: number; category: string | null }`
  - `type Budget = { category: string; limit: number }` (plus de `month`)
  - `type Envelope = { category: string; limit: number; spent: number; remaining: number; ratio: number }`
  - `function computeEnvelopes(txns: Txn[], budgets: Budget[], month: string): Envelope[]`

- [ ] **Step 1: Réécrire le test pour le modèle récurrent**

Remplacer tout le contenu de `tests/lib/budget.test.ts` par :

```ts
import { expect, test } from "vitest";
import { computeEnvelopes, type Txn, type Budget } from "../../src/lib/budget";

const txns: Txn[] = [
  { date: "2026-07-01", amount: -30, category: "Courses" },
  { date: "2026-07-15", amount: -50, category: "Courses" },
  { date: "2026-07-10", amount: -20, category: "Transport" },
  { date: "2026-06-30", amount: -999, category: "Courses" }, // autre mois
  { date: "2026-07-20", amount: 100, category: "Courses" },  // crédit, ignoré
];

const budgets: Budget[] = [
  { category: "Courses", limit: 400 },
  { category: "Transport", limit: 100 },
];

test("computes spent/remaining/ratio for the month", () => {
  const env = computeEnvelopes(txns, budgets, "2026-07");
  const courses = env.find((e) => e.category === "Courses")!;
  expect(courses.spent).toBe(80);
  expect(courses.remaining).toBe(320);
  expect(courses.ratio).toBeCloseTo(0.2);
});

test("ratio is 0 when limit is 0", () => {
  const env = computeEnvelopes(txns, [{ category: "X", limit: 0 }], "2026-07");
  expect(env[0].ratio).toBe(0);
});

test("same budget applies to any month (recurring)", () => {
  const env = computeEnvelopes(txns, budgets, "2026-06");
  const courses = env.find((e) => e.category === "Courses")!;
  expect(courses.spent).toBe(999);
  expect(courses.limit).toBe(400);
});
```

- [ ] **Step 2: Lancer le test pour vérifier l'échec**

Run: `npx vitest run tests/lib/budget.test.ts`
Expected: FAIL (le type `Budget` a encore `month`, le 3e test échoue car `computeEnvelopes` filtre par mois).

- [ ] **Step 3: Modifier `src/lib/budget.ts`**

Remplacer tout le contenu par :

```ts
import { monthKey } from "./money";

export type Txn = { date: string; amount: number; category: string | null };
export type Budget = { category: string; limit: number };
export type Envelope = {
  category: string;
  limit: number;
  spent: number;
  remaining: number;
  ratio: number;
};

export function computeEnvelopes(txns: Txn[], budgets: Budget[], month: string): Envelope[] {
  return budgets.map((b) => {
    const spent = txns
      .filter((t) => monthKey(t.date) === month && t.category === b.category && t.amount < 0)
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);
    const remaining = b.limit - spent;
    const ratio = b.limit > 0 ? spent / b.limit : 0;
    return { category: b.category, limit: b.limit, spent, remaining, ratio };
  });
}
```

- [ ] **Step 4: Lancer le test pour vérifier le succès**

Run: `npx vitest run tests/lib/budget.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Vérifier tsc**

Run: `npx tsc --noEmit`
Expected: échoue UNIQUEMENT sur les fichiers pas encore migrés qui utilisent l'ancienne API (`src/app/page.tsx`, `src/app/budgets/*`, `src/db/repositories/budgets.ts`). C'est attendu à ce stade ; ces fichiers sont migrés dans les tâches suivantes. Ne pas corriger ici.

- [ ] **Step 6: Commit**

```bash
git add src/lib/budget.ts tests/lib/budget.test.ts
git commit -m "refactor: budget récurrent (Budget sans month)"
```

---

## Task 2 : Schéma budgets, migration et repository

**Files:**
- Modify: `src/db/schema.sql`
- Create: `src/db/migrations.ts`
- Modify: `src/db/index.ts`
- Modify: `src/db/repositories/budgets.ts`
- Test: `tests/db/migration.test.ts` (créé), `tests/db/repositories.test.ts` (maj)

**Interfaces:**
- Consumes: `ensureCategory` de `src/db/repositories/categories.ts`.
- Produces:
  - `migrateBudgets(db: Database.Database): void`
  - `type BudgetRow = { category: string; limit: number }`
  - `listBudgets(db): BudgetRow[]`
  - `setBudget(db, category: string, limit: number): void`
  - `deleteBudget(db, category: string): void`

- [ ] **Step 1: Écrire le test de migration**

Créer `tests/db/migration.test.ts` :

```ts
import { expect, test } from "vitest";
import Database from "better-sqlite3";
import { migrateBudgets } from "../../src/db/migrations";

test("migrateBudgets converts old month-keyed table, keeping latest month per category", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE);
    CREATE TABLE budgets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL REFERENCES categories(id),
      month TEXT NOT NULL,
      limit_amount REAL NOT NULL,
      UNIQUE(category_id, month)
    );
    INSERT INTO categories (id, name) VALUES (1, 'Courses'), (2, 'Transport');
    INSERT INTO budgets (category_id, month, limit_amount) VALUES
      (1, '2026-06', 300), (1, '2026-07', 400), (2, '2026-07', 100);
  `);
  migrateBudgets(db);
  const cols = db.prepare("PRAGMA table_info(budgets)").all() as { name: string }[];
  expect(cols.some((c) => c.name === "month")).toBe(false);
  expect(cols.some((c) => c.name === "monthly_limit")).toBe(true);
  const rows = db.prepare("SELECT category_id, monthly_limit FROM budgets ORDER BY category_id").all();
  expect(rows).toEqual([
    { category_id: 1, monthly_limit: 400 }, // dernier mois: 2026-07
    { category_id: 2, monthly_limit: 100 },
  ]);
});

test("migrateBudgets is a no-op on the new schema", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE);
    CREATE TABLE budgets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL REFERENCES categories(id),
      monthly_limit REAL NOT NULL,
      UNIQUE(category_id)
    );
    INSERT INTO categories (id, name) VALUES (1, 'Courses');
    INSERT INTO budgets (category_id, monthly_limit) VALUES (1, 400);
  `);
  migrateBudgets(db);
  const rows = db.prepare("SELECT category_id, monthly_limit FROM budgets").all();
  expect(rows).toEqual([{ category_id: 1, monthly_limit: 400 }]);
});
```

- [ ] **Step 2: Lancer le test pour vérifier l'échec**

Run: `npx vitest run tests/db/migration.test.ts`
Expected: FAIL (`src/db/migrations.ts` n'existe pas).

- [ ] **Step 3: Créer `src/db/migrations.ts`**

```ts
import type Database from "better-sqlite3";

// Convertit l'ancienne table budgets (category_id, month, limit_amount) vers le
// modèle récurrent (category_id UNIQUE, monthly_limit), en gardant le montant du
// mois le plus récent par catégorie. Idempotent : no-op si déjà au nouveau schéma.
export function migrateBudgets(db: Database.Database): void {
  const cols = db.prepare("PRAGMA table_info(budgets)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "month")) return;
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
}
```

- [ ] **Step 4: Modifier `src/db/schema.sql`**

Remplacer le bloc `CREATE TABLE IF NOT EXISTS budgets (...)` existant par :

```sql
CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  monthly_limit REAL NOT NULL,
  UNIQUE(category_id)
);
```

- [ ] **Step 5: Modifier `src/db/index.ts` pour appeler la migration**

Ajouter l'import en haut :

```ts
import { migrateBudgets } from "./migrations";
```

Dans `getDb`, juste après `db.exec(SCHEMA);` et avant `return db;`, ajouter :

```ts
  migrateBudgets(db);
```

- [ ] **Step 6: Réécrire le repository `src/db/repositories/budgets.ts`**

Remplacer tout le contenu par :

```ts
import type Database from "better-sqlite3";
import { ensureCategory } from "./categories";

export type BudgetRow = { category: string; limit: number };

export function listBudgets(db: Database.Database): BudgetRow[] {
  return db
    .prepare(
      // "limit" est un mot réservé SQL — l'alias doit être entre guillemets.
      `SELECT c.name AS category, b.monthly_limit AS "limit"
       FROM budgets b JOIN categories c ON c.id = b.category_id
       ORDER BY c.name`,
    )
    .all() as BudgetRow[];
}

export function setBudget(db: Database.Database, category: string, limit: number): void {
  const categoryId = ensureCategory(db, category);
  db.prepare(
    `INSERT INTO budgets (category_id, monthly_limit) VALUES (?, ?)
     ON CONFLICT(category_id) DO UPDATE SET monthly_limit = excluded.monthly_limit`,
  ).run(categoryId, limit);
}

export function deleteBudget(db: Database.Database, category: string): void {
  db.prepare(
    `DELETE FROM budgets WHERE category_id = (SELECT id FROM categories WHERE name = ?)`,
  ).run(category);
}
```

- [ ] **Step 7: Mettre à jour le test repository budgets**

Dans `tests/db/repositories.test.ts`, remplacer la ligne d'import des budgets :

```ts
import { setBudget, listBudgets } from "../../src/db/repositories/budgets";
```

par :

```ts
import { setBudget, listBudgets, deleteBudget } from "../../src/db/repositories/budgets";
```

Puis remplacer le test `"budget set and list round-trip (limit is a reserved word)"` existant par :

```ts
test("budget set and list round-trip (limit is a reserved word)", () => {
  const db = getDb(":memory:");
  setBudget(db, "Courses", 400);
  setBudget(db, "Courses", 450); // upsert sur la même catégorie
  const budgets = listBudgets(db);
  expect(budgets).toHaveLength(1);
  expect(budgets[0]).toEqual({ category: "Courses", limit: 450 });
});

test("budget delete removes the row", () => {
  const db = getDb(":memory:");
  setBudget(db, "Courses", 400);
  deleteBudget(db, "Courses");
  expect(listBudgets(db)).toHaveLength(0);
});
```

- [ ] **Step 8: Lancer les tests db**

Run: `npx vitest run tests/db/migration.test.ts tests/db/repositories.test.ts`
Expected: PASS (migration : 2 tests ; repositories : tous verts, dont les 2 budgets).

- [ ] **Step 9: Commit**

```bash
git add src/db/schema.sql src/db/migrations.ts src/db/index.ts src/db/repositories/budgets.ts tests/db/migration.test.ts tests/db/repositories.test.ts
git commit -m "feat: schéma budgets récurrent + migration"
```

---

## Task 3 : Page Budgets (création directe + liste éditable + suppression)

**Files:**
- Modify: `src/app/budgets/actions.ts`
- Modify: `src/app/budgets/page.tsx`

**Interfaces:**
- Consumes: `setBudget`, `deleteBudget`, `listBudgets` (Task 2) ; `computeEnvelopes`, `Txn` (Task 1) ; `listTransactions` (`src/db/repositories/transactions.ts`, renvoie `TxnView` avec `date`, `amount`, `category`, `label`) ; `formatEur`, `monthKey`.
- Produces: server actions `saveBudget(formData)` et `removeBudget(formData)`.

- [ ] **Step 1: Réécrire `src/app/budgets/actions.ts`**

Remplacer tout le contenu par :

```ts
"use server";
import { db } from "../../db/index";
import { setBudget, deleteBudget } from "../../db/repositories/budgets";
import { revalidatePath } from "next/cache";

export async function saveBudget(formData: FormData) {
  const category = String(formData.get("category")).trim();
  const limit = Number.parseFloat(String(formData.get("limit")));
  if (!category) return;
  setBudget(db(), category, Number.isFinite(limit) ? limit : 0);
  revalidatePath("/budgets");
  revalidatePath("/");
}

export async function removeBudget(formData: FormData) {
  const category = String(formData.get("category"));
  deleteBudget(db(), category);
  revalidatePath("/budgets");
  revalidatePath("/");
}
```

- [ ] **Step 2: Réécrire `src/app/budgets/page.tsx`**

Remplacer tout le contenu par :

```tsx
import { db } from "../../db/index";
import { listBudgets } from "../../db/repositories/budgets";
import { listTransactions } from "../../db/repositories/transactions";
import { computeEnvelopes, type Txn } from "../../lib/budget";
import { formatEur, monthKey } from "../../lib/money";
import { saveBudget, removeBudget } from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

export default function BudgetsPage() {
  const database = db();
  const month = monthKey(new Date().toISOString().slice(0, 10));
  const budgets = listBudgets(database);
  const txns: Txn[] = listTransactions(database).map((t) => ({
    date: t.date,
    amount: t.amount,
    category: t.category,
  }));
  const envelopes = computeEnvelopes(txns, budgets, month);
  const spentFor = (c: string) => envelopes.find((e) => e.category === c)?.spent ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Nouveau budget</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={saveBudget} className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="budget-name" className="font-normal">Nom</Label>
              <Input id="budget-name" name="category" placeholder="Ex: Coiffure" required />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="budget-limit" className="font-normal">Montant prévu €</Label>
              <Input
                id="budget-limit"
                type="number"
                name="limit"
                step="0.01"
                placeholder="0.00"
                className="max-w-40"
              />
            </div>
            <Button type="submit" size="sm">Créer</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Budgets — {month}</CardTitle>
        </CardHeader>
        <CardContent>
          {budgets.length === 0 ? (
            <p className="text-muted-foreground text-sm">Aucun budget. Crée-en un ci-dessus.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nom</TableHead>
                  <TableHead className="text-right">Dépense courante</TableHead>
                  <TableHead>Dépense prévue</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {budgets.map((b) => (
                  <TableRow key={b.category}>
                    <TableCell>{b.category}</TableCell>
                    <TableCell className="text-right">{formatEur(spentFor(b.category))}</TableCell>
                    <TableCell>
                      <form action={saveBudget} className="flex items-center gap-2">
                        <input type="hidden" name="category" value={b.category} />
                        <Input
                          type="number"
                          name="limit"
                          step="0.01"
                          defaultValue={b.limit}
                          className="max-w-32"
                        />
                        <Button type="submit" size="sm" variant="secondary">OK</Button>
                      </form>
                    </TableCell>
                    <TableCell>
                      <form action={removeBudget}>
                        <input type="hidden" name="category" value={b.category} />
                        <Button type="submit" size="sm" variant="ghost">Supprimer</Button>
                      </form>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Vérifier tsc**

Run: `npx tsc --noEmit`
Expected: échoue encore UNIQUEMENT sur `src/app/page.tsx` (dashboard, migré en Task 7, utilise encore l'ancien mapping `month`). Les fichiers budgets ne doivent plus produire d'erreur.

- [ ] **Step 4: Commit**

```bash
git add src/app/budgets/page.tsx src/app/budgets/actions.ts
git commit -m "feat: page budgets création directe + suppression"
```

---

## Task 4 : Lib recurring (calcul des paiements récurrents)

**Files:**
- Create: `src/lib/recurring.ts`
- Test: `tests/lib/recurring.test.ts`

**Interfaces:**
- Consumes: `monthKey` de `src/lib/money.ts`.
- Produces:
  - `type RecurringPayment = { id: number; name: string; keyword: string; expected: number }`
  - `type RecurringLine = { id: number; name: string; keyword: string; expected: number; spent: number }`
  - `type RecurringSummary = { lines: RecurringLine[]; totalExpected: number; totalSpent: number }`
  - `function computeRecurring(payments: RecurringPayment[], txns: { date: string; amount: number; label: string }[], month: string): RecurringSummary`

- [ ] **Step 1: Écrire le test**

Créer `tests/lib/recurring.test.ts` :

```ts
import { expect, test } from "vitest";
import { computeRecurring, type RecurringPayment } from "../../src/lib/recurring";

const payments: RecurringPayment[] = [
  { id: 1, name: "Spotify", keyword: "SPOTIFY", expected: 12.14 },
  { id: 2, name: "iCloud", keyword: "icloud", expected: 9.99 },
];

const txns = [
  { date: "2026-07-03", amount: -12.14, label: "PRLV SPOTIFY AB" },
  { date: "2026-07-05", amount: -9.99, label: "APPLE ICLOUD" }, // casse différente
  { date: "2026-06-03", amount: -12.14, label: "PRLV SPOTIFY AB" }, // autre mois
  { date: "2026-07-20", amount: 12.14, label: "REMBOURSEMENT SPOTIFY" }, // crédit, ignoré
];

test("matches by keyword case-insensitively, current month, debits only", () => {
  const s = computeRecurring(payments, txns, "2026-07");
  const spotify = s.lines.find((l) => l.name === "Spotify")!;
  const icloud = s.lines.find((l) => l.name === "iCloud")!;
  expect(spotify.spent).toBeCloseTo(12.14);
  expect(icloud.spent).toBeCloseTo(9.99);
});

test("totals sum expected and spent", () => {
  const s = computeRecurring(payments, txns, "2026-07");
  expect(s.totalExpected).toBeCloseTo(22.13);
  expect(s.totalSpent).toBeCloseTo(22.13);
});

test("spent is 0 when nothing matches the month", () => {
  const s = computeRecurring(payments, txns, "2026-05");
  expect(s.totalSpent).toBe(0);
  expect(s.lines.every((l) => l.spent === 0)).toBe(true);
});
```

- [ ] **Step 2: Lancer le test pour vérifier l'échec**

Run: `npx vitest run tests/lib/recurring.test.ts`
Expected: FAIL (`src/lib/recurring.ts` n'existe pas).

- [ ] **Step 3: Créer `src/lib/recurring.ts`**

```ts
import { monthKey } from "./money";

export type RecurringPayment = { id: number; name: string; keyword: string; expected: number };
export type RecurringLine = {
  id: number;
  name: string;
  keyword: string;
  expected: number;
  spent: number;
};
export type RecurringSummary = {
  lines: RecurringLine[];
  totalExpected: number;
  totalSpent: number;
};

export function computeRecurring(
  payments: RecurringPayment[],
  txns: { date: string; amount: number; label: string }[],
  month: string,
): RecurringSummary {
  const lines = payments.map((p) => {
    const needle = p.keyword.toLowerCase();
    const spent = txns
      .filter(
        (t) =>
          monthKey(t.date) === month &&
          t.amount < 0 &&
          t.label.toLowerCase().includes(needle),
      )
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);
    return { id: p.id, name: p.name, keyword: p.keyword, expected: p.expected, spent };
  });
  const totalExpected = lines.reduce((s, l) => s + l.expected, 0);
  const totalSpent = lines.reduce((s, l) => s + l.spent, 0);
  return { lines, totalExpected, totalSpent };
}
```

- [ ] **Step 4: Lancer le test pour vérifier le succès**

Run: `npx vitest run tests/lib/recurring.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/recurring.ts tests/lib/recurring.test.ts
git commit -m "feat: lib calcul paiements récurrents"
```

---

## Task 5 : Schéma et repository recurring_payments

**Files:**
- Modify: `src/db/schema.sql`
- Create: `src/db/repositories/recurring.ts`
- Test: `tests/db/repositories.test.ts` (maj), `tests/db/schema.test.ts` (maj)

**Interfaces:**
- Produces:
  - `type RecurringRow = { id: number; name: string; keyword: string; expected: number }`
  - `listRecurring(db): RecurringRow[]`
  - `insertRecurring(db, name: string, keyword: string, expected: number): void`
  - `deleteRecurring(db, id: number): void`

- [ ] **Step 1: Ajouter les tests repository et schema**

Dans `tests/db/repositories.test.ts`, ajouter l'import en haut :

```ts
import { listRecurring, insertRecurring, deleteRecurring } from "../../src/db/repositories/recurring";
```

Puis ajouter ce test à la fin du fichier :

```ts
test("recurring payment insert, list, delete round-trip", () => {
  const db = getDb(":memory:");
  insertRecurring(db, "Spotify", "SPOTIFY", 12.14);
  insertRecurring(db, "iCloud", "ICLOUD", 9.99);
  let rows = listRecurring(db);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toEqual({ id: rows[0].id, name: "Spotify", keyword: "SPOTIFY", expected: 12.14 });
  deleteRecurring(db, rows[0].id);
  rows = listRecurring(db);
  expect(rows).toHaveLength(1);
  expect(rows[0].name).toBe("iCloud");
});
```

Dans `tests/db/schema.test.ts`, remplacer la liste de tables par (ajout de `recurring_payments`) :

```ts
  for (const t of ["accounts", "categories", "rules", "transactions", "budgets", "settings", "recurring_payments"]) {
    expect(tables).toContain(t);
  }
```

- [ ] **Step 2: Lancer les tests pour vérifier l'échec**

Run: `npx vitest run tests/db/repositories.test.ts tests/db/schema.test.ts`
Expected: FAIL (`src/db/repositories/recurring.ts` n'existe pas ; table `recurring_payments` absente du schéma).

- [ ] **Step 3: Ajouter la table dans `src/db/schema.sql`**

Ajouter à la fin du fichier :

```sql
CREATE TABLE IF NOT EXISTS recurring_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  keyword TEXT NOT NULL,            -- matché insensiblement à la casse contre le libellé
  expected_amount REAL NOT NULL    -- montant mensuel prévu, euros positifs
);
```

- [ ] **Step 4: Créer `src/db/repositories/recurring.ts`**

```ts
import type Database from "better-sqlite3";

export type RecurringRow = { id: number; name: string; keyword: string; expected: number };

export function listRecurring(db: Database.Database): RecurringRow[] {
  return db
    .prepare(
      `SELECT id, name, keyword, expected_amount AS expected FROM recurring_payments ORDER BY id`,
    )
    .all() as RecurringRow[];
}

export function insertRecurring(
  db: Database.Database,
  name: string,
  keyword: string,
  expected: number,
): void {
  db.prepare(
    `INSERT INTO recurring_payments (name, keyword, expected_amount) VALUES (?, ?, ?)`,
  ).run(name, keyword, expected);
}

export function deleteRecurring(db: Database.Database, id: number): void {
  db.prepare(`DELETE FROM recurring_payments WHERE id = ?`).run(id);
}
```

- [ ] **Step 5: Lancer les tests pour vérifier le succès**

Run: `npx vitest run tests/db/repositories.test.ts tests/db/schema.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.sql src/db/repositories/recurring.ts tests/db/repositories.test.ts tests/db/schema.test.ts
git commit -m "feat: schéma + repository recurring_payments"
```

---

## Task 6 : Page Récurrents + lien de navigation

**Files:**
- Create: `src/app/recurring/actions.ts`
- Create: `src/app/recurring/page.tsx`
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Consumes: `insertRecurring`, `deleteRecurring`, `listRecurring` (Task 5) ; `computeRecurring` (Task 4) ; `listTransactions` (`TxnView` avec `date`, `amount`, `label`) ; `formatEur`, `monthKey`.
- Produces: server actions `addRecurring(formData)`, `removeRecurring(formData)`.

- [ ] **Step 1: Créer `src/app/recurring/actions.ts`**

```ts
"use server";
import { db } from "../../db/index";
import { insertRecurring, deleteRecurring } from "../../db/repositories/recurring";
import { revalidatePath } from "next/cache";

export async function addRecurring(formData: FormData) {
  const name = String(formData.get("name")).trim();
  const keyword = String(formData.get("keyword")).trim();
  const expected = Number.parseFloat(String(formData.get("expected")));
  if (!name || !keyword) return;
  insertRecurring(db(), name, keyword, Number.isFinite(expected) ? expected : 0);
  revalidatePath("/recurring");
  revalidatePath("/");
}

export async function removeRecurring(formData: FormData) {
  const id = Number.parseInt(String(formData.get("id")), 10);
  if (Number.isFinite(id)) deleteRecurring(db(), id);
  revalidatePath("/recurring");
  revalidatePath("/");
}
```

- [ ] **Step 2: Créer `src/app/recurring/page.tsx`**

La ligne de total est une `TableRow` normale dans `TableBody` (pas de `TableFooter` dans notre composant Table).

```tsx
import { db } from "../../db/index";
import { listRecurring } from "../../db/repositories/recurring";
import { listTransactions } from "../../db/repositories/transactions";
import { computeRecurring } from "../../lib/recurring";
import { formatEur, monthKey } from "../../lib/money";
import { addRecurring, removeRecurring } from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

export default function RecurringPage() {
  const database = db();
  const month = monthKey(new Date().toISOString().slice(0, 10));
  const payments = listRecurring(database);
  const txns = listTransactions(database).map((t) => ({
    date: t.date,
    amount: t.amount,
    label: t.label,
  }));
  const summary = computeRecurring(payments, txns, month);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Nouveau paiement récurrent</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={addRecurring} className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="rec-name" className="font-normal">Nom</Label>
              <Input id="rec-name" name="name" placeholder="Ex: Spotify" required />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="rec-keyword" className="font-normal">Mot-clé</Label>
              <Input id="rec-keyword" name="keyword" placeholder="Ex: SPOTIFY" required />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="rec-expected" className="font-normal">Montant prévu €</Label>
              <Input
                id="rec-expected"
                type="number"
                name="expected"
                step="0.01"
                placeholder="0.00"
                className="max-w-32"
              />
            </div>
            <Button type="submit" size="sm">Ajouter</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Paiements récurrents — {month}</CardTitle>
        </CardHeader>
        <CardContent>
          {payments.length === 0 ? (
            <p className="text-muted-foreground text-sm">Aucun paiement récurrent.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nom</TableHead>
                  <TableHead>Mot-clé</TableHead>
                  <TableHead className="text-right">Dépense courante</TableHead>
                  <TableHead className="text-right">Dépense prévue</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>{l.name}</TableCell>
                    <TableCell className="text-muted-foreground">{l.keyword}</TableCell>
                    <TableCell className="text-right">{formatEur(l.spent)}</TableCell>
                    <TableCell className="text-right">{formatEur(l.expected)}</TableCell>
                    <TableCell>
                      <form action={removeRecurring}>
                        <input type="hidden" name="id" value={l.id} />
                        <Button type="submit" size="sm" variant="ghost">Supprimer</Button>
                      </form>
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2">
                  <TableCell className="font-medium" colSpan={2}>Total</TableCell>
                  <TableCell className="text-right font-medium">{formatEur(summary.totalSpent)}</TableCell>
                  <TableCell className="text-right font-medium">{formatEur(summary.totalExpected)}</TableCell>
                  <TableCell></TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Ajouter le lien nav dans `src/app/layout.tsx`**

Dans le tableau `NAV`, insérer l'entrée Récurrents entre Transactions et Budgets :

```tsx
const NAV = [
  { href: "/", label: "Tableau de bord" },
  { href: "/transactions", label: "Transactions" },
  { href: "/recurring", label: "Récurrents" },
  { href: "/budgets", label: "Budgets" },
  { href: "/categories", label: "Catégories" },
  { href: "/settings", label: "Réglages" },
];
```

- [ ] **Step 4: Vérifier tsc**

Run: `npx tsc --noEmit`
Expected: échoue encore UNIQUEMENT sur `src/app/page.tsx` (migré en Task 7). Les fichiers recurring et layout ne doivent pas produire d'erreur.

- [ ] **Step 5: Commit**

```bash
git add src/app/recurring/page.tsx src/app/recurring/actions.ts src/app/layout.tsx
git commit -m "feat: page paiements récurrents + lien nav"
```

---

## Task 7 : Tableau de bord (nouveau modèle budget + carte Récurrents)

**Files:**
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `listBudgets` (renvoie `{category, limit}`) ; `computeEnvelopes` ; `listRecurring`, `computeRecurring` ; `formatEur`, `monthKey`.

- [ ] **Step 1: Réécrire `src/app/page.tsx`**

Remplacer tout le contenu par (mapping budget sans `month` + carte Récurrents ajoutée après la carte solde) :

```tsx
import { db } from "../db/index";
import { totalBalance, listAccounts } from "../db/repositories/accounts";
import { listTransactions } from "../db/repositories/transactions";
import { listBudgets } from "../db/repositories/budgets";
import { listRecurring } from "../db/repositories/recurring";
import { getSetting } from "../db/repositories/settings";
import { computeEnvelopes } from "../lib/budget";
import { computeRecurring } from "../lib/recurring";
import { buildAlerts } from "../lib/alerts";
import { formatEur, monthKey } from "../lib/money";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";

export const dynamic = "force-dynamic";

export default function Dashboard() {
  const database = db();
  const month = monthKey(new Date().toISOString().slice(0, 10));
  const balance = totalBalance(database);
  const accounts = listAccounts(database);
  const allTxns = listTransactions(database);
  const txns = allTxns.map((t) => ({ date: t.date, amount: t.amount, category: t.category }));
  const budgets = listBudgets(database).map((b) => ({ category: b.category, limit: b.limit }));
  const envelopes = computeEnvelopes(txns, budgets, month);
  const threshold = Number.parseFloat(getSetting(database, "balance_threshold") ?? "0");
  const alerts = buildAlerts(envelopes, balance, threshold);

  const recTxns = allTxns.map((t) => ({ date: t.date, amount: t.amount, label: t.label }));
  const recurring = computeRecurring(listRecurring(database), recTxns, month);

  const monthSpend = txns
    .filter((t) => monthKey(t.date) === month && t.amount < 0)
    .reduce((s, t) => s + Math.abs(t.amount), 0);

  const accountLabel = (a: (typeof accounts)[number]) =>
    a.iban_masked ? `${a.name} ${a.iban_masked}` : a.name;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-1">
          <div className="text-3xl font-bold">{formatEur(balance)}</div>
          <div className="text-muted-foreground text-sm">
            Solde total ({accounts.length} compte{accounts.length > 1 ? "s" : ""})
          </div>
          <div className="text-muted-foreground text-sm">
            Dépensé ce mois-ci : {formatEur(monthSpend)}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-baseline justify-between">
          <CardTitle>Récurrents ({month})</CardTitle>
          <span className="text-sm">
            {formatEur(recurring.totalSpent)} / {formatEur(recurring.totalExpected)}
          </span>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            Total courant / prévu des paiements récurrents ce mois-ci.
          </p>
        </CardContent>
      </Card>

      {alerts.map((a, i) => (
        <div
          key={i}
          className={cn(
            "rounded-lg px-4 py-3 text-sm",
            a.level === "danger"
              ? "bg-destructive/10 text-destructive"
              : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
          )}
        >
          {a.message}
        </div>
      ))}

      <Card>
        <CardHeader>
          <CardTitle>Enveloppes ({month})</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {envelopes.length === 0 && (
            <p className="text-muted-foreground text-sm">Aucun budget défini. Va dans « Budgets ».</p>
          )}
          {envelopes.map((e) => (
            <div key={e.category} className="flex flex-col gap-1">
              <div className="flex justify-between text-sm">
                <span>{e.category}</span>
                <span>
                  {formatEur(e.spent)} / {formatEur(e.limit)}
                </span>
              </div>
              <Progress
                value={Math.min(100, e.ratio * 100)}
                indicatorClassName={
                  e.ratio >= 1 ? "bg-red-500" : e.ratio >= 0.8 ? "bg-amber-500" : "bg-green-500"
                }
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {accounts.map((a) => {
        const accountTxns = allTxns.filter((t) => t.accountId === a.id).slice(0, 8);
        return (
          <Card key={a.id}>
            <CardHeader className="flex-row items-baseline justify-between">
              <CardTitle>{accountLabel(a)}</CardTitle>
              <span className="text-xl font-bold">{formatEur(a.balance)}</span>
            </CardHeader>
            <CardContent>
              <Table>
                <TableBody>
                  {accountTxns.length === 0 && (
                    <TableRow>
                      <TableCell className="text-muted-foreground">Aucune transaction.</TableCell>
                    </TableRow>
                  )}
                  {accountTxns.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="text-muted-foreground">{t.date}</TableCell>
                      <TableCell>{t.label}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {t.category ?? "À catégoriser"}
                      </TableCell>
                      <TableCell className="text-right font-medium">{formatEur(t.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Vérifier tsc (tout le projet doit être propre)**

Run: `npx tsc --noEmit`
Expected: PASS, zéro erreur.

- [ ] **Step 3: Lancer toute la suite de tests**

Run: `npm test`
Expected: PASS (tous les tests, dont budget, recurring, migration, repositories, schema).

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: tableau de bord budget récurrent + carte récurrents"
```

---

## Vérification finale (contrôleur, après toutes les tâches)

Les DB `:memory:` ne voient pas les bugs runtime. Lancer le vrai serveur et vérifier :

- [ ] `npm run build` réussit (compilation Next.js + CSS).
- [ ] `npm run dev`, puis vérifier en HTTP 200 : `/`, `/recurring`, `/budgets`, `/transactions`, `/categories`, `/settings`.
- [ ] Créer un budget via le formulaire ; il apparaît dans la liste avec dépense courante.
- [ ] Ajouter un paiement récurrent (nom + mot-clé + montant) ; il apparaît, la ligne de total s'additionne.
- [ ] Le lien « Récurrents » est présent dans la nav et mène à la page.
- [ ] Aucune erreur serveur dans la console.

## Notes pour la revue finale

- Migration `budgets` : idempotente, garde le dernier montant par catégorie. Vérifiée par `tests/db/migration.test.ts` + smoke test runtime sur la vraie base.
- Couplage voulu : une transaction peut compter dans un budget ET un paiement récurrent (couches parallèles, pas de déduplication).
- Ordre des tâches : les tâches 1, 2, 3 (budgets) laissent volontairement `src/app/page.tsx` en erreur tsc jusqu'à la Task 7 ; c'est documenté dans les steps « Vérifier tsc » et attendu.
