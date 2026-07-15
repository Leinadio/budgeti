# Rémunération par groupe — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Déplacer la classification « principale / supplémentaire » de la transaction vers le groupe : deux groupes de revenu (principal récurrent, supplémentaire enveloppe), l'analyse mensuelle calculée à partir de la classification du groupe, et le menu par transaction retiré.

**Architecture:** Nouvelle colonne `income_kind` sur `groups` (migration idempotente). Le formulaire « Nouveau groupe » démarre par une « Nature » (Dépense / Rémunération principale / Rémunération supplémentaire) qui fixe sens+type+classification. `monthRemuneration` somme par la classification du groupe propriétaire. Le composant `IncomeKindSelect`, l'action `setIncomeKind` et le menu du formulaire de saisie manuelle sont retirés.

**Tech Stack:** Next.js 16 (App Router, server actions), React 19, TypeScript, better-sqlite3, Vitest, shadcn/ui.

## Global Constraints

- Français partout dans l'UI et les libellés. Pas d'emoji ni de symbole décoratif.
- Migrations idempotentes basées sur `PRAGMA table_info`, appelées dans `getDb()` (`src/db/index.ts`).
- Tests avec DB `:memory:` (`getDb(":memory:")` ou `new Database(":memory:")`). Rappel : ils ne voient pas certains bugs runtime ; vérifier au serveur réel.
- Valeurs de classification : `'principal'` | `'supplementary'` | NULL, cohérentes avec la colonne `transactions.income_kind` existante.
- Pas de harnais de test de composants React : les tâches UI se vérifient par `npx tsc --noEmit` (bloquant) puis `npm run build`.
- La colonne `transactions.income_kind` reste en place mais devient inutilisée (aucune reconstruction de table). On ne touche pas au plumbing income_kind de `insertManualTransaction` / `updateManualTransaction` / `mergeTransactions`.
- Commits fréquents, un par tâche, Conventional Commits.

---

### Task 1: Migration et schéma — colonne income_kind sur groups

**Files:**
- Modify: `src/db/schema.sql`
- Modify: `src/db/migrations.ts`
- Modify: `src/db/index.ts`
- Test: `tests/db/migration.test.ts`

**Interfaces:**
- Produces: `migrateGroupIncomeKind(db: Database.Database): void`. Après `getDb()`, la table `groups` possède une colonne `income_kind TEXT`.

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter à la fin de `tests/db/migration.test.ts` :

```ts
import { migrateGroupIncomeKind } from "../../src/db/migrations";

test("migrateGroupIncomeKind adds income_kind to groups idempotently", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL, name TEXT NOT NULL,
      direction TEXT NOT NULL, kind TEXT NOT NULL, monthly_amount REAL
    );
    INSERT INTO groups (account_id, name, direction, kind, monthly_amount)
      VALUES ('a1', 'Courses', 'out', 'envelope', 300);
  `);
  migrateGroupIncomeKind(db);
  const cols = db.prepare("PRAGMA table_info(groups)").all() as { name: string }[];
  expect(cols.some((c) => c.name === "income_kind")).toBe(true);
  expect(db.prepare("SELECT income_kind FROM groups WHERE name='Courses'").get()).toEqual({ income_kind: null });
  migrateGroupIncomeKind(db); // idempotent
  expect(db.prepare("SELECT COUNT(*) AS n FROM groups").get()).toEqual({ n: 1 });
});
```

- [ ] **Step 2: Lancer le test, vérifier l'échec**

Run: `npx vitest run tests/db/migration.test.ts`
Expected: FAIL (`migrateGroupIncomeKind` non exporté).

- [ ] **Step 3: Ajouter la migration**

Ajouter à la fin de `src/db/migrations.ts` :

```ts
// Ajoute income_kind aux groupes : classe une entrée en revenu « principal » ou
// « supplementary ». NULL pour une dépense ou un groupe non-revenu. Idempotent.
export function migrateGroupIncomeKind(db: Database.Database): void {
  const cols = db.prepare("PRAGMA table_info(groups)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "income_kind"))
    db.exec(`ALTER TABLE groups ADD COLUMN income_kind TEXT`);
}
```

- [ ] **Step 4: Mettre à jour le schéma neuf**

Dans `src/db/schema.sql`, dans le bloc `CREATE TABLE IF NOT EXISTS groups (...)`, remplacer la ligne `monthly_amount REAL` par :

```sql
  monthly_amount REAL,
  income_kind TEXT                 -- 'principal' | 'supplementary' | NULL (revenu)
```

- [ ] **Step 5: Brancher la migration dans getDb**

Dans `src/db/index.ts`, ajouter `migrateGroupIncomeKind` à l'import depuis `./migrations`, puis l'appeler après `migrateReconcileIgnored(db);` :

```ts
  migrateGroupIncomeKind(db);
```

- [ ] **Step 6: Lancer les tests, vérifier le succès**

Run: `npx vitest run tests/db/migration.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/db/schema.sql src/db/migrations.ts src/db/index.ts tests/db/migration.test.ts
git commit -m "feat(db): colonne income_kind sur les groupes"
```

---

### Task 2: Repository groups + type Group — income_kind

**Files:**
- Modify: `src/db/repositories/groups.ts`
- Modify: `src/lib/forecast.ts`
- Test: `tests/db/repositories.test.ts`

**Interfaces:**
- Consumes: `migrateGroupIncomeKind` (colonne présente).
- Produces:
  - `GroupRow` gagne `incomeKind: "principal" | "supplementary" | null`; `listGroups` la lit.
  - `insertEnvelopeGroup(db, accountId, name, direction, monthlyAmount, incomeKind?: "principal" | "supplementary" | null)` — défaut `null`.
  - `insertRecurringGroup(db, accountId, name, direction, incomeKind?: "principal" | "supplementary" | null)` — défaut `null`.
  - Type `Group` (`src/lib/forecast.ts`) gagne `incomeKind?: "principal" | "supplementary" | null`.

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter à `tests/db/repositories.test.ts` :

```ts
test("groups carry income_kind for income classification", () => {
  const db = getDb(":memory:");
  upsertAccount(db, { id: "a1", name: "CIC", iban_masked: null, balance: 0, currency: "EUR", last_synced: null });
  const p = insertRecurringGroup(db, "a1", "Rémunération principale", "in", "principal");
  const s = insertEnvelopeGroup(db, "a1", "Rémunération supplémentaire", "in", 0, "supplementary");
  const c = insertEnvelopeGroup(db, "a1", "Courses", "out", 300);
  const byId = Object.fromEntries(listGroups(db).map((g) => [g.id, g]));
  expect(byId[p].incomeKind).toBe("principal");
  expect(byId[s].incomeKind).toBe("supplementary");
  expect(byId[c].incomeKind).toBeNull();
});
```

- [ ] **Step 2: Lancer le test, vérifier l'échec**

Run: `npx vitest run tests/db/repositories.test.ts`
Expected: FAIL (`insertRecurringGroup` n'accepte pas d'`incomeKind` ; `incomeKind` absent de `GroupRow`).

- [ ] **Step 3: Étendre GroupRow, listGroups et les insertions**

Dans `src/db/repositories/groups.ts` :

Ajouter le champ à `GroupRow` (après `monthlyAmount: number | null;`) :

```ts
  incomeKind: "principal" | "supplementary" | null;
```

Dans `listGroups`, remplacer la requête et le mapping. La requête devient :

```ts
  const groups = db
    .prepare(
      `SELECT id, account_id AS accountId, name, direction, kind, monthly_amount AS monthlyAmount, income_kind AS incomeKind
       FROM groups ORDER BY name`,
    )
    .all() as (Omit<GroupRow, "keywords" | "lines" | "incomeKind"> & { incomeKind: string | null })[];
```

et le `return groups.map(...)` :

```ts
  return groups.map((g) => ({
    ...g,
    incomeKind: g.incomeKind === "principal" || g.incomeKind === "supplementary" ? g.incomeKind : null,
    keywords: (kwStmt.all(g.id) as { keyword: string }[]).map((r) => r.keyword),
    lines: lineStmt.all(g.id) as GroupLineRow[],
  }));
```

Remplacer `insertEnvelopeGroup` :

```ts
export function insertEnvelopeGroup(
  db: Database.Database,
  accountId: string,
  name: string,
  direction: "in" | "out",
  monthlyAmount: number,
  incomeKind: "principal" | "supplementary" | null = null,
): number {
  const info = db
    .prepare(
      `INSERT INTO groups (account_id, name, direction, kind, monthly_amount, income_kind) VALUES (?, ?, ?, 'envelope', ?, ?)`,
    )
    .run(accountId, name, direction, monthlyAmount, incomeKind);
  return Number(info.lastInsertRowid);
}
```

Remplacer `insertRecurringGroup` :

```ts
export function insertRecurringGroup(
  db: Database.Database,
  accountId: string,
  name: string,
  direction: "in" | "out",
  incomeKind: "principal" | "supplementary" | null = null,
): number {
  const info = db
    .prepare(
      `INSERT INTO groups (account_id, name, direction, kind, monthly_amount, income_kind) VALUES (?, ?, ?, 'recurring', NULL, ?)`,
    )
    .run(accountId, name, direction, incomeKind);
  return Number(info.lastInsertRowid);
}
```

- [ ] **Step 4: Ajouter incomeKind au type Group**

Dans `src/lib/forecast.ts`, dans le type `Group`, ajouter après `lines: GroupLine[];` :

```ts
  incomeKind?: "principal" | "supplementary" | null;
```

- [ ] **Step 5: Lancer les tests, vérifier le succès**

Run: `npx vitest run tests/db/repositories.test.ts && npx tsc --noEmit`
Expected: PASS, aucune erreur de type.

- [ ] **Step 6: Commit**

```bash
git add src/db/repositories/groups.ts src/lib/forecast.ts tests/db/repositories.test.ts
git commit -m "feat(db): income_kind dans GroupRow/inserts et type Group"
```

---

### Task 3: monthRemuneration — classification par le groupe

**Files:**
- Modify: `src/lib/remuneration.ts`
- Test: `tests/lib/remuneration.test.ts` (réécrire)

**Interfaces:**
- Consumes: `Group.incomeKind`, `resolveOwnership`.
- Produces: `monthRemuneration(groups, txns, month)` inchangée en signature ; `principal`/`supplementary` viennent désormais de `income_kind` du groupe propriétaire, `expenses` des groupes de sens `out`.

- [ ] **Step 1: Réécrire le test (il échouera)**

Remplacer tout le contenu de `tests/lib/remuneration.test.ts` par :

```ts
import { expect, test } from "vitest";
import { monthRemuneration } from "../../src/lib/remuneration";
import type { Group, Txn } from "../../src/lib/forecast";

const principalGroup: Group = {
  id: 1, accountId: "a1", name: "Rémunération principale", direction: "in", kind: "recurring",
  monthlyAmount: null, keywords: [], lines: [], incomeKind: "principal",
};
const supGroup: Group = {
  id: 2, accountId: "a1", name: "Rémunération supplémentaire", direction: "in", kind: "envelope",
  monthlyAmount: 0, keywords: [], lines: [], incomeKind: "supplementary",
};
const courses: Group = {
  id: 3, accountId: "a1", name: "Courses", direction: "out", kind: "envelope",
  monthlyAmount: 652.09, keywords: [], lines: [], incomeKind: null,
};

function txn(p: Partial<Txn> & { id: string; date: string; amount: number; groupId: number | null }): Txn {
  return { label: "x", accountId: "a1", excluded: false, lineId: null, incomeKind: null, ...p };
}

test("principal/supplementary come from the owning group's income_kind", () => {
  const txns: Txn[] = [
    txn({ id: "t1", date: "2026-07-01", amount: 652.09, groupId: 1 }),
    txn({ id: "t2", date: "2026-07-15", amount: 47.91, groupId: 2 }),
    txn({ id: "t3", date: "2026-07-15", amount: -700, groupId: 3 }),
  ];
  const r = monthRemuneration([principalGroup, supGroup, courses], txns, "2026-07");
  expect(r.principal).toBeCloseTo(652.09, 2);
  expect(r.supplementary).toBeCloseTo(47.91, 2);
  expect(r.expenses).toBeCloseTo(700, 2);
  expect(r.balanceVsPrincipal).toBeCloseTo(-47.91, 2);
  expect(r.balanceVsTotal).toBeCloseTo(0, 2);
  expect(r.suggestedNextPrincipal).toBeCloseTo(700, 2);
});

test("other months and uncategorized ignored; multiple principal groups summed", () => {
  const principal2: Group = { ...principalGroup, id: 4, name: "Prime récurrente" };
  const txns: Txn[] = [
    txn({ id: "t1", date: "2026-07-01", amount: 500, groupId: 1 }),
    txn({ id: "t2", date: "2026-07-03", amount: 300, groupId: 4 }),
    txn({ id: "t3", date: "2026-06-01", amount: 999, groupId: 1 }),
    txn({ id: "t4", date: "2026-07-10", amount: -30, groupId: null }),
  ];
  const r = monthRemuneration([principalGroup, principal2, supGroup, courses], txns, "2026-07");
  expect(r.principal).toBeCloseTo(800, 2);
  expect(r.supplementary).toBe(0);
  expect(r.expenses).toBe(0);
});
```

- [ ] **Step 2: Lancer le test, vérifier l'échec**

Run: `npx vitest run tests/lib/remuneration.test.ts`
Expected: FAIL (l'implémentation lit encore `txn.incomeKind` ; « multiple principal groups summed » notamment ne passe pas).

- [ ] **Step 3: Réécrire la fonction**

Dans `src/lib/remuneration.ts`, remplacer le corps de `monthRemuneration` (garder les imports et le type `MonthRemuneration` et `toOwnable`) :

```ts
export function monthRemuneration(groups: Group[], txns: Txn[], month: string): MonthRemuneration {
  const ownable = groups.map(toOwnable);
  const byId = new Map(groups.map((g) => [g.id, g] as const));
  let principal = 0;
  let supplementary = 0;
  let expenses = 0;
  for (const t of txns) {
    if (t.date.slice(0, 7) !== month) continue;
    const o: OwnedTxn = { id: t.id, date: t.date, amount: t.amount, label: t.label, accountId: t.accountId, groupId: t.groupId, excluded: t.excluded };
    const res = resolveOwnership(o, ownable);
    if (res.status !== "manual") continue;
    const g = byId.get(res.groupId);
    if (!g) continue;
    // La classe de revenu vient du groupe, plus de l'étiquette de transaction.
    if (g.incomeKind === "principal") principal += Math.abs(t.amount);
    else if (g.incomeKind === "supplementary") supplementary += Math.abs(t.amount);
    else if (g.direction === "out") expenses += Math.abs(t.amount);
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

- [ ] **Step 4: Lancer les tests, vérifier le succès**

Run: `npx vitest run tests/lib/remuneration.test.ts && npx tsc --noEmit`
Expected: PASS, aucune erreur de type.

- [ ] **Step 5: Commit**

```bash
git add src/lib/remuneration.ts tests/lib/remuneration.test.ts
git commit -m "feat(lib): monthRemuneration calcule par la classification du groupe"
```

---

### Task 4: Flux de création — action addGroup + NewGroupForm

**Files:**
- Modify: `src/app/groupes/actions.ts`
- Modify: `src/components/new-group-form.tsx`

**Interfaces:**
- Consumes: `insertEnvelopeGroup`/`insertRecurringGroup` (avec `incomeKind`).
- Produces: `addGroup` interprète un champ `nature` (`'expense'` | `'principal'` | `'supplementary'`) ; `NewGroupForm` envoie `nature` et, pour une dépense, `kind` + `monthlyAmount`.

Note : pas de test unitaire d'action (lecture de `FormData`, `revalidatePath`) ; vérification par `npx tsc --noEmit` + `npm run build` + contrôle manuel.

- [ ] **Step 1: Réécrire l'action addGroup**

Dans `src/app/groupes/actions.ts`, remplacer la fonction `addGroup` par :

```ts
export async function addGroup(formData: FormData) {
  const accountId = String(formData.get("accountId") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const nature = String(formData.get("nature") ?? "");
  if (!accountId || !name) return;
  if (nature === "principal") {
    insertRecurringGroup(db(), accountId, name, "in", "principal");
  } else if (nature === "supplementary") {
    insertEnvelopeGroup(db(), accountId, name, "in", 0, "supplementary");
  } else if (nature === "expense") {
    const kind = String(formData.get("kind") ?? "");
    if (kind === "envelope") {
      const parsed = Number.parseFloat(String(formData.get("monthlyAmount")));
      insertEnvelopeGroup(db(), accountId, name, "out", Number.isFinite(parsed) ? Math.abs(parsed) : 0, null);
    } else if (kind === "recurring") {
      insertRecurringGroup(db(), accountId, name, "out", null);
    } else {
      return;
    }
  } else {
    return;
  }
  refresh();
}
```

- [ ] **Step 2: Réécrire NewGroupForm**

Remplacer tout le contenu de `src/components/new-group-form.tsx` par :

```tsx
"use client";
import { useState } from "react";
import { addGroup } from "@/app/groupes/actions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Acct = { id: string; name: string };

const selectClass = "border-input bg-background h-9 rounded-md border px-3 text-sm";

// La « nature » pilote sens + type : une dépense choisit enveloppe/récurrent et
// un montant ; une rémunération principale est un récurrent, une supplémentaire
// une enveloppe sans montant (le montant du mois vient des transactions rangées).
export function NewGroupForm({ accounts }: { accounts: Acct[] }) {
  const [nature, setNature] = useState("expense");
  const [kind, setKind] = useState("envelope");
  const isExpense = nature === "expense";
  return (
    <form action={addGroup} className="flex flex-wrap items-end gap-2">
      <div className="flex w-full flex-col gap-1">
        <Label htmlFor="grp-nature" className="font-normal">Nature</Label>
        <select
          id="grp-nature"
          name="nature"
          value={nature}
          onChange={(e) => setNature(e.target.value)}
          className={cn(selectClass, "max-w-64")}
        >
          <option value="expense">Dépense</option>
          <option value="principal">Rémunération principale</option>
          <option value="supplementary">Rémunération supplémentaire</option>
        </select>
      </div>
      {isExpense && (
        <div className="flex flex-col gap-1">
          <Label htmlFor="grp-kind" className="font-normal">Type</Label>
          <select
            id="grp-kind"
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className={cn(selectClass, "max-w-40")}
          >
            <option value="envelope">Enveloppe</option>
            <option value="recurring">Récurrent</option>
          </select>
        </div>
      )}
      <div className="flex flex-col gap-1">
        <Label htmlFor="grp-name" className="font-normal">Nom</Label>
        <Input id="grp-name" name="name" placeholder={isExpense ? "Ex: Courses" : "Ex: Rémunération"} required />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="grp-account" className="font-normal">Compte</Label>
        <select id="grp-account" name="accountId" className={selectClass}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>
      {isExpense && kind === "envelope" && (
        <div className="flex flex-col gap-1">
          <Label htmlFor="grp-amount" className="font-normal">Montant €</Label>
          <Input id="grp-amount" type="number" name="monthlyAmount" step="0.01" placeholder="0.00" className="max-w-32" />
        </div>
      )}
      <Button type="submit" size="sm">Ajouter</Button>
    </form>
  );
}
```

- [ ] **Step 3: Vérifier types et build**

Run: `npx tsc --noEmit && npm run build`
Expected: aucune erreur. (Si `npm run build` échoue pour une raison d'environnement sans rapport — réseau/https — le noter comme concern.)

- [ ] **Step 4: Contrôle manuel**

Run: `npm run dev` puis `/groupes`.
Expected: le menu « Nature » propose Dépense / Rémunération principale / Rémunération supplémentaire ; « Type » et « Montant » n'apparaissent que pour Dépense ; plus de champ « Sens ». Créer « Rémunération principale » (récurrent, in) et « Rémunération supplémentaire » (enveloppe, in) fonctionne.

- [ ] **Step 5: Commit**

```bash
git add src/app/groupes/actions.ts src/components/new-group-form.tsx
git commit -m "feat(groupes): création par nature (dépense / rémunération principale / supplémentaire)"
```

---

### Task 5: Retirer l'étiquetage de revenu par transaction

**Files:**
- Delete: `src/components/income-kind-select.tsx`
- Modify: `src/components/transactions-browser.tsx`
- Modify: `src/components/add-transaction-sheet.tsx`
- Modify: `src/app/transactions/actions.ts`
- Modify: `src/db/repositories/transactions.ts`
- Modify: `tests/db/manual-transactions.test.ts`

**Interfaces:**
- Removes: composant `IncomeKindSelect`, action serveur `setIncomeKind`, fonction repo `setIncomeKind`, le menu « Type de rémunération » du Sheet de saisie, le helper `owningDirection` du browser. Le plumbing `income_kind` de `insertManualTransaction`/`updateManualTransaction`/`mergeTransactions` reste (inoffensif).

Note : vérification par `npx tsc --noEmit` + `npm run build` + `npm test`.

- [ ] **Step 1: Supprimer le composant IncomeKindSelect**

```bash
git rm src/components/income-kind-select.tsx
```

- [ ] **Step 2: Retirer l'usage dans le browser**

Dans `src/components/transactions-browser.tsx` :

Supprimer l'import :

```tsx
import { IncomeKindSelect } from "@/components/income-kind-select";
```

Supprimer entièrement le helper `owningDirection` (la fonction `const owningDirection = (t: TxnView): "in" | "out" | null => { ... };`).

Dans les DEUX cellules Groupe, remplacer le bloc :

```tsx
                      <div className="flex flex-col">
                        <GroupSelectField txnId={t.id} groups={groupsOfAccount(t.accountId)} defaultGroupId={t.groupId} defaultLineId={t.lineId} />
                        {owningDirection(t) === "in" && <IncomeKindSelect txnId={t.id} value={t.incomeKind} />}
                      </div>
```

par le contrôle seul (respecter l'indentation de chaque table) :

```tsx
                      <GroupSelectField txnId={t.id} groups={groupsOfAccount(t.accountId)} defaultGroupId={t.groupId} defaultLineId={t.lineId} />
```

(La version de la vue par mois est indentée plus profondément ; appliquer le même remplacement à ses lignes correspondantes.)

- [ ] **Step 3: Retirer le menu du Sheet de saisie**

Dans `src/components/add-transaction-sheet.tsx` :

Supprimer la ligne d'état :

```tsx
  const [incomeKind, setIncomeKind] = useState<"principal" | "supplementary">(edit?.incomeKind ?? "principal");
```

Dans la construction de `form` (objet `ManualFormInput`), remplacer :

```tsx
      label, groupId, lineId: null, incomeKind: direction === "in" ? incomeKind : null,
```

par :

```tsx
      label, groupId, lineId: null, incomeKind: null,
```

Supprimer le bloc du select « Type de rémunération » (le `{direction === "in" && ( ... )}` contenant le `<select>` sur `incomeKind`).

- [ ] **Step 4: Retirer l'action et la fonction repo setIncomeKind**

Dans `src/app/transactions/actions.ts` : supprimer `setIncomeKind as setIncomeKindRepo,` de l'import depuis `../../db/repositories/transactions`, et supprimer l'action exportée :

```ts
export async function setIncomeKind(id: string, kind: "principal" | "supplementary" | null) {
  setIncomeKindRepo(db(), id, kind);
  revalidateAll();
}
```

Dans `src/db/repositories/transactions.ts` : supprimer la fonction `setIncomeKind` :

```ts
export function setIncomeKind(
  db: Database.Database,
  id: string,
  kind: "principal" | "supplementary" | null,
): void {
  db.prepare("UPDATE transactions SET income_kind=? WHERE id=?").run(kind, id);
}
```

- [ ] **Step 5: Retirer le test devenu invalide**

Dans `tests/db/manual-transactions.test.ts` : retirer `setIncomeKind` de la liste d'import (ligne d'`import ... from "../../src/db/repositories/transactions"`), et supprimer le test :

```ts
test("setIncomeKind tags any income row, including a synced one", () => {
  ...
});
```

- [ ] **Step 6: Vérifier types, build et tests**

Run: `npx tsc --noEmit && npm run build && npm test`
Expected: aucune erreur de type ; build OK ; toute la suite verte. (Build en échec pour raison d'environnement sans rapport : le noter comme concern.)

- [ ] **Step 7: Contrôle manuel**

Run: `npm run dev` puis `/transactions`.
Expected: plus de menu « Principale / Supplémentaire » sous le groupe ni dans le formulaire d'ajout ; ranger une entrée dans « Rémunération principale » ou « Rémunération supplémentaire » via le menu Groupe suffit ; l'encart de l'Historique se remplit à partir des groupes.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(transactions): retire l'étiquetage de revenu par transaction (au profit du groupe)"
```

---

## Self-review (contrôle du plan face à la spec)

- Colonne `income_kind` sur `groups` (spec « Modèle de données ») → Task 1. ✓
- Repo/inserts + type `Group` (spec « Repository ») → Task 2. ✓
- `monthRemuneration` par classification du groupe (spec « Lib pure ») → Task 3. ✓
- Formulaire par Nature + action (spec « UI » / « Server action ») → Task 4. ✓
- Retrait `IncomeKindSelect`, `setIncomeKind`, lecture par transaction (spec « Ce qui est retiré ») → Task 5. Le menu du Sheet de saisie est aussi retiré (cohérent avec « le menu par transaction disparaît »). ✓
- Colonne `transactions.income_kind` laissée en place, plumbing insert/merge intact (spec « Ce qui est retiré » + « Hors périmètre ») → respecté (Task 5 ne touche pas au plumbing). ✓
- Édition de la classification d'un groupe : hors périmètre → `editGroup`/formulaire d'édition non modifiés. ✓

## Notes de fin

- Rappel CLAUDE.md : ne jamais lancer `git commit`/`add`/`push` sans demande explicite de l'utilisateur. Les étapes « Commit » ne s'exécutent que si l'utilisateur a choisi une exécution qui les autorise.
- Vérifier au serveur réel (pas seulement `:memory:`) : migration sur la base existante, création des deux groupes de revenu, remplissage de l'encart Historique.
