# Rémunérations : montant dédié, colonnes Historique et projection — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner à chaque rémunération (principale, supplémentaire) un montant saisi à la création, l'afficher en Budget pour la principale seulement, et ne projeter que la principale sur les mois suivants.

**Architecture:** Les deux rémunérations deviennent des enveloppes (`kind='envelope'`, `direction='in'`) portant `monthly_amount` = montant et le bon `income_kind`. Une migration convertit les principales de l'ancien modèle (récurrent + lignes) en enveloppe. La lib d'historique paramètre la projection (supplémentaire = 0 dans le futur) et porte `incomeKind` sur la ligne ; l'affichage montre le Budget pour la principale seulement ; `computeForecast` exclut la supplémentaire de l'estimé du mois suivant.

**Tech Stack:** Next.js (App Router, TS, React), better-sqlite3, Vitest.

## Global Constraints

- Noms figés, valeurs exactes : `"Rémunération principale"` et `"Rémunération supplémentaire"`.
- Une seule rémunération de chaque `income_kind` par compte.
- Colonne Budget (Historique) : principale = `monthly_amount` (tous les mois) ; supplémentaire = vide.
- Colonne Reçu : transactions rangées (mois passés/courant) ; mois futurs : principale = `monthly_amount` projeté, supplémentaire = 0.
- Colonne Reste : vide pour toute rémunération (`balance = 0` pour une entrée, inchangé).
- `computeForecast` : principale ajoutée à l'estimé du mois courant ET du mois suivant ; supplémentaire au mois courant uniquement.
- Style projet : commentaires en français, pas d'emoji, réponses/diffs concis.

---

### Task 1 : Migration des rémunérations principales vers le modèle enveloppe

**Files:**
- Modify: `src/db/migrations.ts` (ajouter la fonction en fin de fichier)
- Modify: `src/db/index.ts:4,23` (import + appel dans `getDb`)
- Test: `tests/db/migration.test.ts` (ajouter deux tests)

**Interfaces:**
- Produces: `export function migrateRemunerationPrincipalToEnvelope(db: Database.Database): void`

- [ ] **Step 1 : Écrire le test qui échoue**

Ajouter à la fin de `tests/db/migration.test.ts` :

```ts
import { migrateRemunerationPrincipalToEnvelope } from "../../src/db/migrations";

function groupsSchemaWithIncomeKind(db: Database.Database) {
  db.exec(`
    CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL,
      name TEXT NOT NULL,
      direction TEXT NOT NULL,
      kind TEXT NOT NULL,
      monthly_amount REAL,
      income_kind TEXT
    );
    CREATE TABLE group_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      amount REAL NOT NULL,
      day INTEGER,
      keyword TEXT NOT NULL
    );
    INSERT INTO accounts (id, name) VALUES ('a1', 'Compte');
  `);
}

test("migrateRemunerationPrincipal convertit un récurrent principal en enveloppe (montant = somme des lignes)", () => {
  const db = new Database(":memory:");
  groupsSchemaWithIncomeKind(db);
  db.exec(`
    INSERT INTO groups (id, account_id, name, direction, kind, monthly_amount, income_kind)
      VALUES (1, 'a1', 'Rémunération principale', 'in', 'recurring', NULL, 'principal');
    INSERT INTO group_lines (group_id, name, amount, day, keyword) VALUES
      (1, 'Base', 500, 1, ''), (1, 'Prime', 152.09, 1, '');
  `);
  migrateRemunerationPrincipalToEnvelope(db);
  const g = db.prepare("SELECT kind, monthly_amount AS m FROM groups WHERE id = 1").get() as { kind: string; m: number };
  expect(g.kind).toBe("envelope");
  expect(g.m).toBeCloseTo(652.09, 2);
  const lines = db.prepare("SELECT COUNT(*) AS n FROM group_lines WHERE group_id = 1").get() as { n: number };
  expect(lines.n).toBe(0);
});

test("migrateRemunerationPrincipal est un no-op si déjà en enveloppe", () => {
  const db = new Database(":memory:");
  groupsSchemaWithIncomeKind(db);
  db.exec(`INSERT INTO groups (id, account_id, name, direction, kind, monthly_amount, income_kind)
    VALUES (1, 'a1', 'Rémunération principale', 'in', 'envelope', 2000, 'principal');`);
  migrateRemunerationPrincipalToEnvelope(db);
  const g = db.prepare("SELECT kind, monthly_amount AS m FROM groups WHERE id = 1").get() as { kind: string; m: number };
  expect(g.kind).toBe("envelope");
  expect(g.m).toBe(2000);
});
```

- [ ] **Step 2 : Lancer le test pour vérifier l'échec**

Run: `npx vitest run tests/db/migration.test.ts`
Expected: FAIL (`migrateRemunerationPrincipalToEnvelope` n'existe pas).

- [ ] **Step 3 : Implémenter la migration**

Ajouter à la fin de `src/db/migrations.ts` :

```ts
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
```

- [ ] **Step 4 : Câbler dans getDb**

Dans `src/db/index.ts`, ajouter `migrateRemunerationPrincipalToEnvelope` à l'import ligne 4, puis l'appeler après `migrateGroupIncomeKind(db);` (ligne 23) :

```ts
  migrateGroupIncomeKind(db);
  migrateRemunerationPrincipalToEnvelope(db);
```

- [ ] **Step 5 : Lancer le test pour vérifier le succès**

Run: `npx vitest run tests/db/migration.test.ts`
Expected: PASS.

- [ ] **Step 6 : Commit**

```bash
git add src/db/migrations.ts src/db/index.ts tests/db/migration.test.ts
git commit -m "feat(db): migre les rémunérations principales vers le modèle enveloppe"
```

---

### Task 2 : Historique — `incomeKind` sur la ligne et projection paramétrée

**Files:**
- Modify: `src/lib/history.ts` (type `HistoryRow`, `cellsFor`, `rowFor`)
- Test: `tests/lib/history.test.ts` (ajouter deux tests)

**Interfaces:**
- Consumes: type `Group` (`incomeKind?: "principal" | "supplementary" | null`) de `src/lib/forecast.ts`.
- Produces: `HistoryRow` gagne `incomeKind: "principal" | "supplementary" | null`. `cellsFor` gagne un 5e paramètre `projectFuture = true`.

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajouter à `tests/lib/history.test.ts` :

```ts
test("la rémunération principale projette son montant sur les mois futurs", () => {
  const principal: Group = {
    id: 30, accountId: "a1", name: "Rémunération principale", direction: "in",
    kind: "envelope", monthlyAmount: 2000, keywords: [], lines: [], incomeKind: "principal",
  };
  const sections = computeHistory([principal], [], ["2026-07", "2026-08"], "2026-07");
  const row = sections.find((s) => s.kind === "income")!.rows[0];
  expect(row.incomeKind).toBe("principal");
  expect(row.cells[1].recu).toBe(2000); // mois futur projeté
  expect(row.cells[1].budgeted).toBe(2000);
});

test("la rémunération supplémentaire n'est pas projetée (Reçu futur = 0)", () => {
  const supp: Group = {
    id: 31, accountId: "a1", name: "Rémunération supplémentaire", direction: "in",
    kind: "envelope", monthlyAmount: 500, keywords: [], lines: [], incomeKind: "supplementary",
  };
  const sections = computeHistory([supp], [], ["2026-07", "2026-08"], "2026-07");
  const row = sections.find((s) => s.kind === "income")!.rows[0];
  expect(row.incomeKind).toBe("supplementary");
  expect(row.cells[1].recu).toBe(0); // mois futur : rien
  expect(row.cells[1].budgeted).toBe(500); // le montant reste stocké (masqué à l'affichage)
});
```

- [ ] **Step 2 : Lancer pour vérifier l'échec**

Run: `npx vitest run tests/lib/history.test.ts`
Expected: FAIL (`incomeKind` absent de `HistoryRow`, projection non paramétrée).

- [ ] **Step 3 : Ajouter `incomeKind` au type `HistoryRow`**

Dans `src/lib/history.ts`, type `HistoryRow` (actuellement lignes 27-35), ajouter le champ :

```ts
export type HistoryRow = {
  id: number;
  name: string;
  kind: "envelope" | "recurring";
  direction: "in" | "out";
  incomeKind: "principal" | "supplementary" | null; // classe de revenu (null hors rémunération)
  cells: MonthCell[];
  subRows: HistorySubRow[];
  txns: HistoryTxn[];
};
```

- [ ] **Step 4 : Paramétrer la projection dans `cellsFor`**

Remplacer `cellsFor` (actuellement lignes 142-154) par :

```ts
  // projectFuture=false : la ligne n'est pas anticipée sur les mois futurs (réalisé
  // projeté = 0). Utilisé pour la rémunération supplémentaire (couvre le mois courant,
  // pas les suivants).
  const cellsFor = (
    budgeted: number,
    isOut: boolean,
    overspend: number,
    realizedOf: (m: string) => number,
    projectFuture = true,
  ): MonthCell[] =>
    months.map((m) => {
      const realized = m > currentMonth ? (projectFuture ? budgeted + overspend : 0) : realizedOf(m);
      return {
        budgeted,
        depense: isOut ? realized : 0,
        recu: isOut ? 0 : realized,
        balance: isOut ? budgeted - realized : 0,
      };
    });
```

- [ ] **Step 5 : Renseigner `incomeKind` et `projectFuture` dans `rowFor`**

Dans `rowFor` (lignes 156-187) : après `const isOut = g.direction === "out";`, ajouter le calcul de `projectFuture`, le passer à l'appel `cellsFor` du groupe, et ajouter `incomeKind` au retour. La ligne de calcul des cellules devient :

```ts
    const isOut = g.direction === "out";
    // La supplémentaire n'est pas projetée sur les mois futurs (cf. Global Constraints).
    const projectFuture = !(g.direction === "in" && g.incomeKind === "supplementary");
    // ... (mine, overspend inchangés) ...
    const cells = cellsFor(budgeted, isOut, overspend, (m) => spent(g.id, m), projectFuture);
```

Et le `return` de `rowFor` :

```ts
    return { id: g.id, name: g.name, kind: g.kind, direction: g.direction, incomeKind: g.incomeKind ?? null, cells, subRows, txns: groupTxns };
```

(Les `subRows` gardent l'appel `cellsFor` par défaut `projectFuture=true` : ce sont des postes de dépense.)

- [ ] **Step 6 : Lancer pour vérifier le succès**

Run: `npx vitest run tests/lib/history.test.ts`
Expected: PASS (les tests existants restent verts : une entrée sans `incomeKind` garde `projectFuture=true`).

- [ ] **Step 7 : Commit**

```bash
git add src/lib/history.ts tests/lib/history.test.ts
git commit -m "feat(historique): incomeKind sur la ligne et projection propre à la supplémentaire"
```

---

### Task 3 : Prévisionnel — exclure la supplémentaire de l'estimé du mois suivant

**Files:**
- Modify: `src/lib/forecast.ts` (branche enveloppe de `computeForecast`, lignes 121-142)
- Test: `tests/lib/forecast.test.ts` (ajouter deux tests)

**Interfaces:**
- Consumes: `Group.incomeKind`. Aucun changement de signature publique.

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajouter à `tests/lib/forecast.test.ts` (adapter l'import du type `Group` s'il n'y est pas déjà) :

```ts
test("rémunération principale : ajoutée à l'estimé du mois courant ET du mois suivant", () => {
  const principal: Group = {
    id: 40, accountId: "a1", name: "Rémunération principale", direction: "in",
    kind: "envelope", monthlyAmount: 2000, keywords: [], lines: [], incomeKind: "principal",
  };
  const f = computeForecast("a1", 100, [principal], [], "2026-07");
  expect(f.currentEstimate).toBe(2100); // 100 + 2000 attendus
  expect(f.nextEstimate).toBe(4100); // + 2000 le mois suivant
});

test("rémunération supplémentaire : mois courant seulement, pas de projection au mois suivant", () => {
  const supp: Group = {
    id: 41, accountId: "a1", name: "Rémunération supplémentaire", direction: "in",
    kind: "envelope", monthlyAmount: 500, keywords: [], lines: [], incomeKind: "supplementary",
  };
  const f = computeForecast("a1", 100, [supp], [], "2026-07");
  expect(f.currentEstimate).toBe(600); // 100 + 500 attendus ce mois
  expect(f.nextEstimate).toBe(600); // pas d'ajout au mois suivant
});
```

- [ ] **Step 2 : Lancer pour vérifier l'échec**

Run: `npx vitest run tests/lib/forecast.test.ts`
Expected: FAIL (`nextEstimate` vaut 1100 pour la supplémentaire au lieu de 600).

- [ ] **Step 3 : Brancher sur `incomeKind` dans la branche enveloppe**

Dans `computeForecast`, branche `if (g.kind === "envelope")` (lignes 121-142), remplacer le corps par :

```ts
    if (g.kind === "envelope") {
      const amount = g.monthlyAmount ?? 0;
      const spent = spentIn(g.id, month);
      const remaining = Math.max(0, amount - spent);
      // Le sens compte : une sortie retire, une entrée ajoute.
      current += sign * remaining;
      // La supplémentaire couvre le mois courant mais n'est pas projetée au mois suivant.
      const projectNext = !(g.direction === "in" && g.incomeKind === "supplementary");
      if (projectNext) nextDelta += sign * amount;
      if (remaining > 0)
        currentSteps.push({
          label: `${g.name} — ${g.direction === "in" ? "reste à recevoir" : "reste à dépenser"} ce mois-ci`,
          amount: sign * remaining,
        });
      if (amount > 0 && projectNext)
        nextSteps.push({
          label: `${g.name} — ${g.direction === "in" ? "revenu mensuel" : "budget mensuel"}`,
          amount: sign * amount,
        });
      const overspend = g.direction === "out" ? Math.max(0, spent - amount) : 0;
      const prevSpent = spentIn(g.id, prevMonth);
      const prevOverspend = g.direction === "out" ? Math.max(0, prevSpent - amount) : 0;
      groupViews.push({ id: g.id, name: g.name, direction: g.direction, kind: g.kind, total: amount, spent, overspend, prevSpent, prevOverspend });
    } else {
```

- [ ] **Step 4 : Lancer pour vérifier le succès**

Run: `npx vitest run tests/lib/forecast.test.ts`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add src/lib/forecast.ts tests/lib/forecast.test.ts
git commit -m "feat(prevision): la supplémentaire ne se projette pas au mois suivant"
```

---

### Task 4 : Création / édition — champ montant, nom figé, unicité

**Files:**
- Modify: `src/db/repositories/groups.ts` (ajouter `hasIncomeGroup`)
- Modify: `src/app/groupes/actions.ts` (`addGroup`)
- Modify: `src/components/new-group-form.tsx` (champ montant pour rémunération, nom masqué, options désactivées)
- Modify: `src/app/groupes/page.tsx` (passer l'existant par compte au formulaire ; passer `incomeKind` à l'en-tête)
- Modify: `src/components/group-editors.tsx` (verrouiller nom/sens pour une rémunération)
- Test: `tests/db/repositories.test.ts` (test de `hasIncomeGroup`)

**Interfaces:**
- Produces: `export function hasIncomeGroup(db, accountId, incomeKind: "principal" | "supplementary"): boolean`.

- [ ] **Step 1 : Écrire le test qui échoue (repo)**

Ajouter à `tests/db/repositories.test.ts` un test (réutiliser l'helper de création de DB déjà présent dans ce fichier ; insérer une enveloppe income via `insertEnvelopeGroup`) :

```ts
test("hasIncomeGroup détecte une rémunération existante du même type", () => {
  const db = freshDb(); // helper existant du fichier
  insertEnvelopeGroup(db, "a1", "Rémunération principale", "in", 2000, "principal");
  expect(hasIncomeGroup(db, "a1", "principal")).toBe(true);
  expect(hasIncomeGroup(db, "a1", "supplementary")).toBe(false);
  expect(hasIncomeGroup(db, "a2", "principal")).toBe(false);
});
```

Note pour l'implémenteur : adapter au helper réel du fichier (regarder comment les autres tests créent la DB et importent `insertEnvelopeGroup`). Ajouter `hasIncomeGroup` à l'import.

- [ ] **Step 2 : Lancer pour vérifier l'échec**

Run: `npx vitest run tests/db/repositories.test.ts`
Expected: FAIL (`hasIncomeGroup` n'existe pas).

- [ ] **Step 3 : Implémenter `hasIncomeGroup`**

Dans `src/db/repositories/groups.ts`, ajouter :

```ts
export function hasIncomeGroup(
  db: Database.Database,
  accountId: string,
  incomeKind: "principal" | "supplementary",
): boolean {
  const row = db
    .prepare(`SELECT 1 FROM groups WHERE account_id = ? AND income_kind = ? LIMIT 1`)
    .get(accountId, incomeKind);
  return row !== undefined;
}
```

- [ ] **Step 4 : Lancer pour vérifier le succès (repo)**

Run: `npx vitest run tests/db/repositories.test.ts`
Expected: PASS.

- [ ] **Step 5 : `addGroup` — nom figé, montant, unicité**

Dans `src/app/groupes/actions.ts` : importer `hasIncomeGroup` et `insertEnvelopeGroup`, retirer l'usage de `insertRecurringGroup` pour les rémunérations, et remplacer `addGroup` par :

```ts
const REMU_NAMES = {
  principal: "Rémunération principale",
  supplementary: "Rémunération supplémentaire",
} as const;

export async function addGroup(formData: FormData) {
  const accountId = String(formData.get("accountId") ?? "").trim();
  const nature = String(formData.get("nature") ?? "");
  if (!accountId) return;

  if (nature === "principal" || nature === "supplementary") {
    if (hasIncomeGroup(db(), accountId, nature)) return; // une seule de chaque
    const parsed = Number.parseFloat(String(formData.get("monthlyAmount")));
    const amount = Number.isFinite(parsed) ? Math.abs(parsed) : 0;
    insertEnvelopeGroup(db(), accountId, REMU_NAMES[nature], "in", amount, nature);
  } else if (nature === "expense") {
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return;
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

Garder l'import `insertRecurringGroup` (encore utilisé pour la dépense récurrente).

- [ ] **Step 6 : Formulaire de création**

Dans `src/components/new-group-form.tsx` :
- Ajouter `const isRemu = nature === "principal" || nature === "supplementary";`.
- Recevoir en props l'existant par compte : `remuByAccount: Record<string, { principal: boolean; supplementary: boolean }>`, et suivre le compte sélectionné dans un state `accountId` (initialisé au premier compte). Le select Compte devient contrôlé (`value={accountId} onChange`).
- Dans le select « Nature », désactiver l'option `principal` / `supplementary` si `remuByAccount[accountId]?.principal` / `.supplementary` est vrai (ajouter `disabled` + suffixe « (déjà créée) » au libellé). Si la nature courante devient indisponible après changement de compte, repasser `nature` à `"expense"` (via un effet ou à l'`onChange` du compte).
- Champ « Nom » : afficher uniquement si `isExpense` (retirer `required` implicite pour les rémunérations en ne le rendant pas).
- Champ « Montant € » : condition d'affichage `(isExpense && kind === "envelope") || isRemu`.

Extrait cible du champ montant :

```tsx
{((isExpense && kind === "envelope") || isRemu) && (
  <div className="flex flex-col gap-1">
    <Label htmlFor="grp-amount" className="font-normal">Montant €</Label>
    <Input id="grp-amount" type="number" name="monthlyAmount" step="0.01" placeholder="0.00" className="max-w-32" />
  </div>
)}
```

Extrait cible du champ nom (rendu seulement pour une dépense) :

```tsx
{isExpense && (
  <div className="flex flex-col gap-1">
    <Label htmlFor="grp-name" className="font-normal">Nom</Label>
    <Input id="grp-name" name="name" placeholder="Ex: Courses" required />
  </div>
)}
```

- [ ] **Step 7 : Page Groupes — fournir l'existant et l'incomeKind**

Dans `src/app/groupes/page.tsx` :
- Construire `remuByAccount` depuis `groups` : pour chaque compte, `{ principal: groups.some(g => g.accountId===id && g.incomeKind==='principal'), supplementary: ... }`. Le passer à `<NewGroupForm remuByAccount={...} />`.
- Passer `incomeKind={g.incomeKind}` à `<EditableGroupHeader group={{ ..., incomeKind: g.incomeKind }} />` (étendre l'objet `group`).

- [ ] **Step 8 : Édition — verrouiller nom et sens pour une rémunération**

Dans `src/components/group-editors.tsx`, type `Group` local : ajouter `incomeKind?: "principal" | "supplementary" | null;`. Dans `EditableGroupHeader`, si `group.incomeKind` est non nul :
- Nom : afficher en lecture seule + `<input type="hidden" name="name" value={group.name} />` (pas de champ éditable).
- Sens : `<input type="hidden" name="direction" value="in" />` (pas de select).
- Montant : éditable comme aujourd'hui (`group.kind === "envelope"`, ce qui est le cas après migration).

Pour une dépense (`incomeKind` nul), garder le formulaire actuel (nom + sens + montant si enveloppe).

- [ ] **Step 9 : Vérifier build + tests + navigateur**

Run: `npx tsc --noEmit && npx vitest run tests/db/repositories.test.ts && npm run build`
Expected: tout vert.
Vérification manuelle (dev) : créer une rémunération principale avec montant → apparaît, montant éditable, nom figé, seconde principale refusée. Idem supplémentaire.

- [ ] **Step 10 : Commit**

```bash
git add src/db/repositories/groups.ts src/app/groupes/actions.ts src/components/new-group-form.tsx src/app/groupes/page.tsx src/components/group-editors.tsx tests/db/repositories.test.ts
git commit -m "feat(groupes): montant + nom figé + unicité pour les rémunérations"
```

---

### Task 5 : Historique — afficher le Budget de la principale (et le total)

**Files:**
- Modify: `src/components/history-grid.tsx` (`AmountCells` colonne Budget en `mode="in"` ; `IncomeTotalCells` colonne Budget)

**Interfaces:**
- Consumes: `HistoryRow.incomeKind` (Task 2) via `detailRow` dans `AmountCells`, et `sec.rows[].incomeKind` dans `IncomeTotalCells`.

- [ ] **Step 1 : Colonne Budget d'une ligne rémunération**

Dans `src/components/history-grid.tsx`, `AmountCells`, la cellule Budget (première `CellAmount`) affiche aujourd'hui `{mode === "in" ? "" : fmt(c.budgeted)}`. La remplacer par (afficher le montant seulement pour la principale) :

```tsx
{mode === "in" ? (r?.incomeKind === "principal" ? fmt(c.budgeted) : "") : fmt(c.budgeted)}
```

(`r` = `detailRow`. `budgetDetail` reste `null` en `mode="in"` : la cellule est un simple affichage non cliquable, ce qui est voulu.)

- [ ] **Step 2 : Colonne Budget de la ligne « Total rémunérations »**

Dans `IncomeTotalCells`, la première cellule est aujourd'hui `<TableCell className="border-l" />` (vide). La remplacer par la somme des budgets principaux :

```tsx
{(() => {
  const principalBudget = sec.rows
    .filter((r) => r.incomeKind === "principal")
    .reduce((s, r) => s + r.cells[i].budgeted, 0);
  return (
    <TableCell className="border-l text-right tabular-nums text-muted-foreground">
      {principalBudget !== 0 ? fmt(principalBudget) : ""}
    </TableCell>
  );
})()}
```

- [ ] **Step 3 : Vérifier build + navigateur**

Run: `npx tsc --noEmit && npm run build`
Expected: vert.
Vérification (dev, onglet Historique) : la principale montre son montant en Budget (tous les mois) et le projette en Reçu sur les mois futurs ; la supplémentaire a une colonne Budget vide et Reçu = 0 sur les mois futurs ; « Total rémunérations » montre en Budget la somme des principales.

- [ ] **Step 4 : Commit**

```bash
git add src/components/history-grid.tsx
git commit -m "feat(historique): Budget affiché pour la rémunération principale et son total"
```

---

## Notes d'exécution

- Ordre : Task 1 → 5 (Task 5 dépend de `HistoryRow.incomeKind` posé en Task 2).
- Après la Task 5, lancer la suite complète (`npm test`) et une vérification navigateur globale sur les onglets Groupes, Historique et Prévisionnel.
- Migration : base locale personnelle ; la conversion des principales existantes est faite au démarrage par `getDb`.
