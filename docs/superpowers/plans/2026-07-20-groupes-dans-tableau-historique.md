# Groupes dans le tableau de l'Historique — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Déplacer toute la création et la gestion des groupes (enveloppes et récurrents) dans le tableau de l'Historique, en donnant à chaque groupe une durée de vie (mois de départ + fin ponctuelle ou permanente), puis supprimer l'onglet Groupes et le code mort des mots-clés.

**Architecture:** On ajoute deux colonnes `start_month` / `end_month` à la table `groups` (migration idempotente sur le modèle existant). Une fonction pure `isGroupAlive(group, month)` filtre la présence d'un groupe par mois ; elle est appliquée dans les trois moteurs de calcul (`computeHistory`, `computeOverspends`, `computeForecast`). L'UI de création (bouton +) et de gestion (menu au survol → side panel de droite) vit dans le tableau (`history-grid.tsx`, `history-with-detail.tsx`, `history-detail-sidebar.tsx`) et s'appuie sur de nouvelles server actions dans `src/app/historique/actions.ts`. L'onglet Groupes et les mots-clés sont retirés en fin de chantier, une fois leurs fonctions reprises.

**Tech Stack:** Next.js (App Router, TypeScript, React), better-sqlite3, Vitest, Tailwind + shadcn/ui.

## Global Constraints

- Réponses de l'assistant en français, en phrases (prose), sans emoji ni symboles décoratifs. Ne s'applique pas au code ; le code et ses commentaires suivent le style du fichier voisin.
- Clés de mois au format `YYYY-MM` (validées par `isMonthKey` / regex `/^\d{4}-\d{2}$/`).
- Le rattachement transaction → groupe reste 100 % manuel (`resolveOwnership`, via `group_id`). Aucune correspondance automatique par mot-clé ne doit subsister ou réapparaître.
- Migration additive uniquement : nouvelles colonnes via `ALTER TABLE ... ADD COLUMN` idempotent (test `PRAGMA table_info` avant), sur le modèle exact de `migrateGroupIncomeKind`. Ne jamais réécrire `groups`.
- Valeur de migration des groupes existants : `start_month = '2000-01'`, `end_month = NULL` (visibles partout, permanents — comportement actuel préservé).
- Le schéma `src/db/schema.sql` est rejoué (`CREATE TABLE IF NOT EXISTS`) à chaque `getDb()` ; il ne modifie jamais une table existante. Les changements de colonnes passent donc par `schema.sql` (bases neuves) ET une migration dans `src/db/migrations.ts` appelée depuis `getDb` (bases existantes).
- La table `group_keywords` est laissée en place mais devient inerte (plus lue ni écrite). Aucune suppression physique de table.
- Un groupe est vivant au mois `m` si `start_month <= m` et (`end_month` est NULL ou `m <= end_month`). Un groupe ponctuel a `end_month = start_month`. Un permanent a `end_month = NULL`.
- Les rémunérations (`income_kind` non nul) restent permanentes : créées avec `start_month = '2000-01'`, `end_month = NULL`. Limite d'une principale et une supplémentaire par compte (`hasIncomeGroup`).
- Mois de départ à la création : jamais un mois passé. Plage autorisée `currentMonth`..`stripMax` (= `currentMonth + 12`).
- Après chaque tâche : `npx tsc --noEmit` propre et `npm test` vert. Les tâches UI se vérifient en plus par `npm run build` et un test manuel décrit dans la tâche (les tests `:memory:` ne voient pas certains bugs runtime).

---

## Structure des fichiers touchés

- `src/db/schema.sql` — ajout `start_month`, `end_month` à `groups`.
- `src/db/migrations.ts` — nouvelle migration `migrateGroupLifespan`.
- `src/db/index.ts` — appel de `migrateGroupLifespan` dans `getDb`.
- `src/db/repositories/groups.ts` — `GroupRow` + `listGroups` (lecture des deux colonnes), signatures d'insertion (durée de vie), `renameGroup`, retrait mots-clés (tâche finale).
- `src/lib/forecast.ts` — type `Group` (champs durée de vie), `isGroupAlive`, gating dans `computeForecast`, retrait `keywords`/`toOwnable` (tâche finale).
- `src/lib/history.ts` — gating durée de vie dans `computeHistory` et `computeOverspends`, `aliveMonths` sur `HistoryRow`, slice, retrait `toOwnable.keywords` (tâche finale).
- `src/lib/ownership.ts` — retrait `keywords` de `OwnableGroup` (tâche finale).
- `src/app/historique/actions.ts` — nouvelles server actions (création, renommage, montant daté, lignes, suppression, rémunération).
- `src/components/history-grid.tsx` — cellules vides hors durée de vie, teinte entrant/sortant, bouton +, menu au survol, formulaire de création.
- `src/components/history-with-detail.tsx` — passage des nouvelles props (accountId déjà présent, currentMonth, stripMax).
- `src/components/history-detail-sidebar.tsx` + `src/lib/history-explain.ts` — vue « gestion du groupe » dans le side panel.
- Suppression : `src/app/groupes/` (page + actions), `src/components/new-group-form.tsx`, `src/components/group-editors.tsx`, entrée `/groupes` de `src/components/app-sidebar.tsx`.
- Tests : `tests/lib/history.test.ts`, `tests/lib/forecast.test.ts`, `tests/db/repositories.test.ts`.

---

## Task 1: Colonnes de durée de vie sur `groups` (schéma, migration, repository)

**Files:**
- Modify: `src/db/schema.sql:56-64` (table `groups`)
- Modify: `src/db/migrations.ts` (ajouter `migrateGroupLifespan`)
- Modify: `src/db/index.ts` (appeler la migration)
- Modify: `src/db/repositories/groups.ts` (`GroupRow`, `listGroups`, `insertEnvelopeGroup`, `insertRecurringGroup`, `renameGroup`)
- Modify: `src/lib/forecast.ts:14-24` (type `Group` : deux champs optionnels)
- Test: `tests/db/repositories.test.ts`

**Interfaces:**
- Consumes: rien (première tâche).
- Produces :
  - `GroupRow` gagne `startMonth: string | null; endMonth: string | null`.
  - `insertEnvelopeGroup(db, accountId, name, direction, monthlyAmount, incomeKind, startMonth, endMonth): number` — deux paramètres ajoutés en fin, `startMonth: string`, `endMonth: string | null`.
  - `insertRecurringGroup(db, accountId, name, direction, incomeKind, startMonth, endMonth): number` — idem.
  - `renameGroup(db, id, name): void`.
  - Type `Group` (forecast) gagne `startMonth?: string | null; endMonth?: string | null` (optionnels : les fixtures existantes ne cassent pas).

- [ ] **Step 1: Écrire le test repository qui échoue**

Dans `tests/db/repositories.test.ts`, ajouter (les helpers `makeDb`/`seedAccount` existants du fichier restent inchangés ; adapter les noms au style du fichier) :

```ts
it("stocke et relit la durée de vie d'un groupe (start_month / end_month)", () => {
  const db = makeDb();
  seedAccount(db, "a1");
  const permanent = insertEnvelopeGroup(db, "a1", "Courses", "out", 300, null, "2026-07", null);
  const ponctuel = insertEnvelopeGroup(db, "a1", "Cadeau", "out", 50, null, "2026-08", "2026-08");
  const rec = insertRecurringGroup(db, "a1", "Abonnements", "out", null, "2026-07", null);
  const groups = listGroups(db);
  const byId = (id: number) => groups.find((g) => g.id === id)!;
  expect(byId(permanent).startMonth).toBe("2026-07");
  expect(byId(permanent).endMonth).toBeNull();
  expect(byId(ponctuel).endMonth).toBe("2026-08");
  expect(byId(rec).startMonth).toBe("2026-07");
});

it("renomme un groupe sans toucher au reste", () => {
  const db = makeDb();
  seedAccount(db, "a1");
  const id = insertEnvelopeGroup(db, "a1", "Ancien", "out", 100, null, "2026-07", null);
  renameGroup(db, id, "Nouveau");
  expect(listGroups(db).find((g) => g.id === id)!.name).toBe("Nouveau");
});

it("les groupes créés avant migration sont visibles partout (start_month '2000-01')", () => {
  const db = makeDb();
  seedAccount(db, "a1");
  // Simule une base pré-migration : on insère sans les colonnes, puis on rejoue la migration.
  db.prepare(
    "INSERT INTO groups (account_id, name, direction, kind, monthly_amount) VALUES ('a1','Legacy','out','envelope',200)",
  ).run();
  db.exec("UPDATE groups SET start_month = NULL, end_month = NULL");
  migrateGroupLifespan(db);
  expect(listGroups(db)[0].startMonth).toBe("2000-01");
});
```

Ajouter les imports manquants en tête de fichier : `renameGroup` depuis `../../src/db/repositories/groups` et `migrateGroupLifespan` depuis `../../src/db/migrations`.

- [ ] **Step 2: Lancer le test pour le voir échouer**

Run: `npm test -- tests/db/repositories.test.ts`
Expected: FAIL (`insertEnvelopeGroup` n'accepte pas 7 arguments, `renameGroup` / `migrateGroupLifespan` non exportés, `startMonth` absent de `GroupRow`).

- [ ] **Step 3: Ajouter les colonnes au schéma**

Dans `src/db/schema.sql`, remplacer la définition de `groups` (l.56-64) par :

```sql
CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  name TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  kind TEXT NOT NULL CHECK (kind IN ('envelope', 'recurring')),
  monthly_amount REAL,
  income_kind TEXT,                -- 'principal' | 'supplementary' | NULL (revenu)
  start_month TEXT,                -- 'YYYY-MM' : mois de départ (invisible avant)
  end_month TEXT                   -- 'YYYY-MM' ou NULL : dernier mois (NULL = permanent)
);
```

- [ ] **Step 4: Écrire la migration idempotente**

Dans `src/db/migrations.ts`, ajouter (sur le modèle exact de `migrateGroupIncomeKind`) :

```ts
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
```

(Réutiliser le même `import type Database from "better-sqlite3"` déjà présent en tête du fichier.)

- [ ] **Step 5: Brancher la migration dans `getDb`**

Dans `src/db/index.ts`, importer `migrateGroupLifespan` avec les autres migrations, et l'appeler dans `getDb` après `migrateRemunerationPrincipalToEnvelope(db);` :

```ts
  migrateRemunerationPrincipalToEnvelope(db);
  migrateGroupLifespan(db);
  return db;
```

- [ ] **Step 6: Étendre le repository `groups.ts`**

Dans `src/db/repositories/groups.ts` :

Type `GroupRow` — ajouter deux champs après `incomeKind` :

```ts
  incomeKind: "principal" | "supplementary" | null;
  startMonth: string | null;
  endMonth: string | null;
  keywords: string[];
  lines: GroupLineRow[];
```

`listGroups` — SELECT principal étendu (l.26-27) :

```ts
      `SELECT id, account_id AS accountId, name, direction, kind, monthly_amount AS monthlyAmount,
              income_kind AS incomeKind, start_month AS startMonth, end_month AS endMonth
       FROM groups ORDER BY name`,
```

et le type inline de la ligne SELECT doit inclure `startMonth`/`endMonth` (adapter le `Omit<...>` : retirer `startMonth`/`endMonth` de l'Omit puisqu'ils viennent du SELECT — le plus simple est de les laisser passer via le spread `...g`).

`insertEnvelopeGroup` — nouvelle signature et INSERT :

```ts
export function insertEnvelopeGroup(
  db: Database.Database,
  accountId: string,
  name: string,
  direction: "in" | "out",
  monthlyAmount: number,
  incomeKind: "principal" | "supplementary" | null = null,
  startMonth: string,
  endMonth: string | null,
): number {
  const info = db
    .prepare(
      `INSERT INTO groups (account_id, name, direction, kind, monthly_amount, income_kind, start_month, end_month)
       VALUES (?, ?, ?, 'envelope', ?, ?, ?, ?)`,
    )
    .run(accountId, name, direction, monthlyAmount, incomeKind, startMonth, endMonth);
  return Number(info.lastInsertRowid);
}
```

Note : `incomeKind` garde son défaut mais `startMonth`/`endMonth` sont requis ; en TypeScript un paramètre requis après un paramètre à défaut est autorisé (l'appelant doit fournir les trois). Faire de même pour `insertRecurringGroup` :

```ts
export function insertRecurringGroup(
  db: Database.Database,
  accountId: string,
  name: string,
  direction: "in" | "out",
  incomeKind: "principal" | "supplementary" | null = null,
  startMonth: string,
  endMonth: string | null,
): number {
  const info = db
    .prepare(
      `INSERT INTO groups (account_id, name, direction, kind, monthly_amount, income_kind, start_month, end_month)
       VALUES (?, ?, ?, 'recurring', NULL, ?, ?, ?)`,
    )
    .run(accountId, name, direction, incomeKind, startMonth, endMonth);
  return Number(info.lastInsertRowid);
}
```

Ajouter `renameGroup` (à côté de `updateGroup`) :

```ts
export function renameGroup(db: Database.Database, id: number, name: string): void {
  db.prepare(`UPDATE groups SET name = ? WHERE id = ?`).run(name, id);
}
```

- [ ] **Step 7: Étendre le type `Group` de forecast**

Dans `src/lib/forecast.ts`, type `Group` (l.14-24), ajouter deux champs optionnels :

```ts
export type Group = {
  id: number;
  accountId: string;
  name: string;
  direction: Direction;
  kind: "envelope" | "recurring";
  monthlyAmount: number | null;
  keywords: string[];
  lines: GroupLine[];
  incomeKind?: "principal" | "supplementary" | null;
  startMonth?: string | null;
  endMonth?: string | null;
};
```

- [ ] **Step 8: Corriger l'appelant existant qui casse la compilation**

`src/app/groupes/actions.ts` `addGroup` appelle `insertEnvelopeGroup` / `insertRecurringGroup` avec l'ancienne arité. Cet onglet sera supprimé en Task 8, mais d'ici là il doit compiler. Passer une durée de vie permanente pour préserver le comportement actuel : ajouter `"2000-01", null` en fin d'appel des deux insertions dans `addGroup`. (Localiser les deux appels dans le fichier et ajouter les deux arguments.)

- [ ] **Step 9: Lancer les tests pour les voir passer**

Run: `npm test -- tests/db/repositories.test.ts`
Expected: PASS. Puis `npx tsc --noEmit` propre et `npm test` (suite complète) vert.

- [ ] **Step 10: Commit**

```bash
git add src/db/schema.sql src/db/migrations.ts src/db/index.ts src/db/repositories/groups.ts src/lib/forecast.ts src/app/groupes/actions.ts tests/db/repositories.test.ts
git commit -m "feat(db): durée de vie des groupes (start_month / end_month)"
```

---

## Task 2: Filtrage durée de vie dans `computeHistory`

**Files:**
- Modify: `src/lib/forecast.ts` (ajouter `isGroupAlive`)
- Modify: `src/lib/history.ts` (`HistoryRow`, `computeHistory`, `sliceHistorySections`)
- Test: `tests/lib/history.test.ts`

**Interfaces:**
- Consumes: type `Group` avec `startMonth`/`endMonth` (Task 1).
- Produces :
  - `isGroupAlive(g: Pick<Group, "startMonth" | "endMonth">, month: string): boolean` exporté depuis `forecast.ts`.
  - `HistoryRow` gagne `aliveMonths: boolean[]` (aligné sur `months`).
  - Comportement : un groupe mort à un mois `m` a des cellules à zéro à `m`, ne liste aucune transaction à `m` (celles-ci basculent en non catégorisés), et n'apparaît en ligne que s'il est vivant sur au moins un des mois affichés.

- [ ] **Step 1: Écrire les tests qui échouent**

Dans `tests/lib/history.test.ts`, ajouter un bloc. `courses` (envelope out, monthlyAmount 300) existe déjà ; on lui donne une durée de vie via spread.

```ts
import { computeHistory, isGroupAlive /* ...imports existants... */ } from ... ; // ajouter isGroupAlive à l'import history OU forecast

describe("durée de vie des groupes", () => {
  it("isGroupAlive borne par start et end", () => {
    const g = { startMonth: "2026-07", endMonth: "2026-08" };
    expect(isGroupAlive(g, "2026-06")).toBe(false);
    expect(isGroupAlive(g, "2026-07")).toBe(true);
    expect(isGroupAlive(g, "2026-08")).toBe(true);
    expect(isGroupAlive(g, "2026-09")).toBe(false);
    expect(isGroupAlive({ startMonth: null, endMonth: null }, "2026-07")).toBe(true);
    expect(isGroupAlive({ startMonth: "2026-07", endMonth: null }, "2030-01")).toBe(true);
  });

  it("un groupe ponctuel n'a de budget que dans son mois de départ", () => {
    const ponctuel: Group = { ...courses, id: 50, name: "Cadeau", startMonth: "2026-07", endMonth: "2026-07" };
    const months = ["2026-06", "2026-07", "2026-08"];
    const sections = computeHistory([ponctuel], [], months, "2026-07");
    const row = sections.flatMap((s) => s.rows).find((r) => r.id === 50)!;
    expect(row.cells[0].budgeted).toBe(0); // juin : mort
    expect(row.cells[1].budgeted).toBe(300); // juillet : vivant
    expect(row.cells[2].budgeted).toBe(0); // août : mort
    expect(row.aliveMonths).toEqual([false, true, false]);
  });

  it("un groupe qui démarre plus tard n'apparaît pas s'il n'est vivant sur aucun mois affiché", () => {
    const futur: Group = { ...courses, id: 51, name: "Futur", startMonth: "2026-10", endMonth: null };
    const sections = computeHistory([futur], [], ["2026-07", "2026-08"], "2026-07");
    expect(sections.flatMap((s) => s.rows).some((r) => r.id === 51)).toBe(false);
  });

  it("une dépense d'un mois où le groupe est mort bascule en non catégorisés", () => {
    const ponctuel: Group = { ...courses, id: 52, name: "Cadeau", startMonth: "2026-07", endMonth: "2026-07" };
    const txn: Txn = { id: "t1", date: "2026-08-05", amount: -40, label: "x", accountId: "a1", groupId: 52 };
    const sections = computeHistory([ponctuel], [txn], ["2026-07", "2026-08"], "2026-07");
    const uncatOut = sections.find((s) => s.kind === "uncategorized" && s.uncatDirection === "out");
    expect(uncatOut?.totals[1].depense).toBe(40); // août : la dépense retombe en non catégorisés
    const row = sections.flatMap((s) => s.rows).find((r) => r.id === 52)!;
    expect(row.cells[1].depense).toBe(0); // le groupe mort ne la porte pas
  });
});
```

- [ ] **Step 2: Voir les tests échouer**

Run: `npm test -- tests/lib/history.test.ts`
Expected: FAIL (`isGroupAlive` non défini, `aliveMonths` absent, cellules non zéro-ées hors durée de vie).

- [ ] **Step 3: Ajouter `isGroupAlive` dans forecast.ts**

Dans `src/lib/forecast.ts`, après le type `Group` :

```ts
// Un groupe est vivant au mois m si son mois de départ est atteint et que sa
// fin (si définie) n'est pas dépassée. Sans bornes (fixtures / groupes hérités),
// il est vivant partout.
export function isGroupAlive(g: Pick<Group, "startMonth" | "endMonth">, month: string): boolean {
  if (g.startMonth != null && month < g.startMonth) return false;
  if (g.endMonth != null && month > g.endMonth) return false;
  return true;
}
```

- [ ] **Step 4: Ajouter `aliveMonths` au type `HistoryRow`**

Dans `src/lib/history.ts`, type `HistoryRow` (l.27-36), ajouter après `cells` :

```ts
  cells: MonthCell[];
  aliveMonths: boolean[]; // aligné sur months : le groupe est-il vivant ce mois-là
```

Et importer `isGroupAlive` en tête : `import { type Group, type Txn, isGroupAlive } from "./forecast";` (adapter l'import existant l.2).

- [ ] **Step 5: Appliquer le gating dans `computeHistory`**

Dans `computeHistory` (`src/lib/history.ts`) :

Gate d'appartenance — le `owned` (l.145-150) : une transaction rattachée à un groupe mort ce mois-là devient non catégorisée.

```ts
  const owned = txns.map((t) => {
    const o: OwnedTxn = { id: t.id, date: t.date, amount: t.amount, label: t.label, accountId: t.accountId, groupId: t.groupId, excluded: t.excluded };
    const res = resolveOwnership(o, ownable);
    const month = t.date.slice(0, 7);
    const g = res.status === "manual" ? groups.find((x) => x.id === res.groupId) : undefined;
    const ownerId = g && isGroupAlive(g, month) ? g.id : null;
    return { t, ownerId, month };
  });
```

Budget zéro hors durée de vie et `aliveMonths` — dans `rowFor` (l.190-218) : la ligne `cells` devient

```ts
    const cells = cellsFor((m) => (isGroupAlive(g, m) ? budgetInForce(g, m, dated) : 0), isOut, (m) => spent(g.id, m));
    const aliveMonths = months.map((m) => isGroupAlive(g, m));
```

et le `return` inclut `aliveMonths` :

```ts
    return { id: g.id, name: g.name, kind: g.kind, direction: g.direction, incomeKind: g.incomeKind ?? null, cells, aliveMonths, subRows, txns: groupTxns };
```

Inclusion des lignes — filtrer les groupes morts sur toute la plage. Dans `incomeSection` (l.237-240) et `section` (l.255), ajouter un filtre `isGroupAlive` sur au moins un mois :

```ts
// incomeSection :
    const rows = groups
      .filter((g) => g.direction === "in")
      .filter((g) => months.some((m) => isGroupAlive(g, m)))
      .sort((a, b) => incomeRank(a) - incomeRank(b))
      .map(rowFor);
// section :
    const rows = groups
      .filter((g) => g.kind === kind && g.direction === "out")
      .filter((g) => months.some((m) => isGroupAlive(g, m)))
      .map(rowFor);
```

- [ ] **Step 6: Slicer `aliveMonths`**

Dans `sliceHistorySections` (l.436-450), ajouter le slice d'`aliveMonths` dans le map des rows :

```ts
    rows: sec.rows.map((r) => ({
      ...r,
      cells: r.cells.slice(k),
      aliveMonths: r.aliveMonths.slice(k),
      subRows: r.subRows.map((s) => ({ ...s, cells: s.cells.slice(k), txns: s.txns.filter((t) => keep.has(t.month)) })),
      txns: r.txns.filter((t) => keep.has(t.month)),
    })),
```

- [ ] **Step 7: Voir les tests passer**

Run: `npm test -- tests/lib/history.test.ts`
Expected: PASS. Vérifier que les tests history préexistants passent toujours (les fixtures sans `startMonth`/`endMonth` sont vivantes partout → aucun changement de comportement). `npx tsc --noEmit` propre.

- [ ] **Step 8: Commit**

```bash
git add src/lib/forecast.ts src/lib/history.ts tests/lib/history.test.ts
git commit -m "feat(historique): filtrage des groupes par durée de vie dans computeHistory"
```

---

## Task 3: Durée de vie dans `computeOverspends` et `computeForecast`

**Files:**
- Modify: `src/lib/history.ts` (`computeOverspends`)
- Modify: `src/lib/forecast.ts` (`computeForecast`)
- Test: `tests/lib/history.test.ts`, `tests/lib/forecast.test.ts`

**Interfaces:**
- Consumes: `isGroupAlive` (Task 2).
- Produces : aucun changement de signature ; seulement le comportement (un groupe mort ne génère ni dépassement ni projection à ce mois-là).

- [ ] **Step 1: Écrire les tests qui échouent**

Dans `tests/lib/history.test.ts` (bloc dépassements existant), ajouter :

```ts
it("un groupe mort ne produit pas de dépassement", () => {
  const ponctuel: Group = { ...courses, id: 60, name: "Cadeau", startMonth: "2026-06", endMonth: "2026-06" };
  // dépense en juillet, mois où le groupe est mort : elle est non catégorisée, pas un dépassement de groupe
  const txn: Txn = { id: "t1", date: "2026-07-10", amount: -500, label: "x", accountId: "a1", groupId: 60 };
  const r = computeOverspends([ponctuel], [txn], "2026-07", []);
  expect(r.retained.byGroup[60]).toBeUndefined();
});
```

Dans `tests/lib/forecast.test.ts`, ajouter (à côté des fixtures `courses`/`salaire`) :

```ts
it("un groupe pas encore né n'entre pas dans l'estimé", () => {
  const futur: Group = { ...courses, id: 70, name: "Futur", startMonth: "2026-10", endMonth: null };
  const f = computeForecast("a1", 1000, [futur], [], "2026-07");
  // Aucun budget projeté : l'estimé courant reste le solde.
  expect(f.currentEstimate).toBe(1000);
  expect(f.groups.some((g) => g.id === 70)).toBe(false);
});
```

- [ ] **Step 2: Voir les tests échouer**

Run: `npm test -- tests/lib/history.test.ts tests/lib/forecast.test.ts`
Expected: FAIL (le groupe mort produit encore un `retained` ; le groupe futur apparaît encore dans le forecast).

- [ ] **Step 3: Gating dans `computeOverspends`**

Dans `src/lib/history.ts`, `computeOverspends` : importer `isGroupAlive` est déjà fait (Task 2). Gater l'appartenance dans le `owned` (l.534-538) comme dans `computeHistory` :

```ts
  const owned = txns.map((t) => {
    const o: OwnedTxn = { id: t.id, date: t.date, amount: t.amount, label: t.label, accountId: t.accountId, groupId: t.groupId, excluded: t.excluded };
    const res = resolveOwnership(o, ownable);
    const month = t.date.slice(0, 7);
    const g = res.status === "manual" ? groups.find((x) => x.id === res.groupId) : undefined;
    return { t, ownerId: g && isGroupAlive(g, month) ? g.id : null, month };
  });
```

Et dans la boucle des groupes de sortie (l.549-557), ignorer les mois morts :

```ts
    for (const g of groups) {
      if (g.direction !== "out") continue;
      if (!isGroupAlive(g, m)) continue;
      const spent = owned.filter((o) => o.ownerId === g.id && o.month === m).reduce((s, o) => s + Math.abs(o.t.amount), 0);
      // ... inchangé
    }
```

- [ ] **Step 4: Gating dans `computeForecast`**

Dans `src/lib/forecast.ts`, `computeForecast`, la boucle `for (const g of groups)` (l.121) : ajouter en première ligne du corps de boucle :

```ts
  for (const g of groups) {
    if (!isGroupAlive(g, month)) continue;
    const sign = g.direction === "in" ? 1 : -1;
    // ... inchangé
```

- [ ] **Step 5: Voir les tests passer**

Run: `npm test -- tests/lib/history.test.ts tests/lib/forecast.test.ts`
Expected: PASS. Suite complète verte, `npx tsc --noEmit` propre.

- [ ] **Step 6: Commit**

```bash
git add src/lib/history.ts src/lib/forecast.ts tests/lib/history.test.ts tests/lib/forecast.test.ts
git commit -m "feat(historique): durée de vie dans computeOverspends et computeForecast"
```

---

## Task 4: Rendu du tableau — cellules vides hors durée de vie + teinte entrant/sortant

**Files:**
- Modify: `src/components/history-grid.tsx`
- Test: vérification `tsc` + `npm run build` + test manuel

**Interfaces:**
- Consumes: `HistoryRow.aliveMonths` (Task 2).
- Produces : les cellules d'un groupe pour un mois où `aliveMonths[i] === false` s'affichent vides (rien), pas « 0,00 ». Un fond teinté discret sépare le bloc entrant (haut : rémunérations + non catégorisés reçus) du bloc sortant (récurrents, enveloppes, non catégorisés dépenses).

**Contexte pour l'implémenteur :** `history-grid.tsx` fait ~1991 lignes. Les cellules d'un groupe sont rendues par `AmountCells` (l.424-645). Les rows portent désormais `aliveMonths: boolean[]` aligné sur les mois. Lis le composant en entier avant de modifier.

- [ ] **Step 1: Rendre les cellules vides hors durée de vie**

Dans `AmountCells` (l.424-645), le composant reçoit la row (ou ses cells) et un index de mois `i`. Là où chaque colonne mensuelle est rendue (budget rém., budget dép., dép., reçu, reste), enrober le rendu d'un test : si `row.aliveMonths[i] === false`, rendre une cellule vide (même largeur/classe que les autres, contenu vide — réutiliser le rendu « tiret » déjà utilisé pour les valeurs nulles s'il existe, sinon une cellule vide `<td className={...}></td>`). Faire passer `aliveMonths` jusqu'à `AmountCells` s'il ne reçoit aujourd'hui que `cells` (ajouter une prop `aliveMonths: boolean[]`). Les colonnes de solde (Solde réel / prévu / si dépassement) ne sont pas concernées par groupe : elles restent inchangées.

Repère : si un helper de formatage de montant central existe (par ex. `fmt` / `money`), n'y touche pas ; ajoute le court-circuit « mois mort → vide » au niveau de la cellule, avant l'appel de format.

- [ ] **Step 2: Ajouter la teinte entrant / sortant**

Le tableau rend ses sections dans l'ordre `income`, `uncategorized(in)`, `recurring`, `envelope`, `uncategorized(out)` (voir `computeHistory` l.279). Appliquer une classe de fond discrète (par ex. `bg-muted/30`, cohérente avec les teintes de colgroup existantes `SOLDE_TINT`/`BALANCE_TINT`) sur les lignes des sections sortantes (`recurring`, `envelope`, `uncategorized` avec `uncatDirection === "out"`), en laissant le bloc entrant sans teinte — ou l'inverse, l'important est le contraste visuel entre les deux blocs. Choisir la teinte la plus légère possible pour ne pas gêner la lecture des montants rouges/verts. Ne pas teinter les lignes de totaux/solde si cela nuit à la lisibilité ; se limiter aux lignes de groupes et sous-totaux de section.

- [ ] **Step 3: Vérifier**

Run: `npx tsc --noEmit` (propre) puis `npm run build` (succès).

Test manuel : `npm run dev`, ouvrir `/historique`. Créer mentalement le cas via la base n'est pas nécessaire ici ; vérifier au minimum que le tableau s'affiche sans régression, que les colonnes des mois futurs restent lisibles, et que la séparation entrant/sortant est visible. (Le rendu « cellules vides » sera réellement exerçable après Task 5, une fois qu'on peut créer un groupe daté ; le noter comme point de vérification de Task 5.)

- [ ] **Step 4: Commit**

```bash
git add src/components/history-grid.tsx
git commit -m "feat(historique): cellules vides hors durée de vie et teinte entrant/sortant"
```

---

## Task 5: Création inline d'un groupe (enveloppe / récurrent)

**Files:**
- Modify: `src/app/historique/actions.ts` (action `createGroup`)
- Create: `src/components/new-group-inline.tsx` (formulaire de création)
- Modify: `src/components/history-grid.tsx` (bouton + par section sortante + montage du formulaire)
- Modify: `src/components/history-with-detail.tsx` (passer `currentMonth`, `stripMax`)
- Modify: `src/app/historique/page.tsx` (passer `stripMax` à `HistoryWithDetail`)
- Test: `tsc` + `npm run build` + test manuel

**Interfaces:**
- Consumes: `insertEnvelopeGroup` / `insertRecurringGroup` avec durée de vie (Task 1) ; `addMonthsKey`, `monthRange`, `isMonthKey` (`src/lib/history.ts`).
- Produces : server action

```ts
createGroup(input: {
  accountId: string;
  kind: "envelope" | "recurring";
  name: string;
  amount: number | null;   // null pour un récurrent
  startMonth: string;      // 'YYYY-MM'
  scope: "once" | "ongoing";
}): Promise<void>
```

- [ ] **Step 1: Écrire l'action `createGroup`**

Dans `src/app/historique/actions.ts` (fichier qui contient déjà `decideOverspend` et `"use server"` en tête), ajouter :

```ts
import { db } from "../../db/index";
import { insertEnvelopeGroup, insertRecurringGroup } from "../../db/repositories/groups";
import { revalidatePath } from "next/cache";

export async function createGroup(input: {
  accountId: string;
  kind: "envelope" | "recurring";
  name: string;
  amount: number | null;
  startMonth: string;
  scope: "once" | "ongoing";
}): Promise<void> {
  const { accountId, kind, name, amount, startMonth, scope } = input;
  if (!/^\d{4}-\d{2}$/.test(startMonth)) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  const endMonth = scope === "once" ? startMonth : null;
  const database = db();
  if (kind === "envelope") {
    insertEnvelopeGroup(database, accountId, trimmed, "out", amount ?? 0, null, startMonth, endMonth);
  } else {
    insertRecurringGroup(database, accountId, trimmed, "out", null, startMonth, endMonth);
  }
  revalidatePath("/historique");
  revalidatePath("/previsionnel");
  revalidatePath("/");
}
```

(Si `db`, `revalidatePath` sont déjà importés dans le fichier, ne pas dupliquer les imports.)

- [ ] **Step 2: Créer le composant de formulaire inline**

Créer `src/components/new-group-inline.tsx` (client) :

```tsx
"use client";
import { useState } from "react";
import { createGroup } from "@/app/historique/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addMonthsKey } from "@/lib/history";

// Libellé « Juillet 2026 » à partir d'une clé 'YYYY-MM'.
function monthLabel(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1, 1));
  return d.toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function NewGroupInline({
  accountId,
  kind,
  currentMonth,
  stripMax,
  defaultMonth,
  onDone,
}: {
  accountId: string;
  kind: "envelope" | "recurring";
  currentMonth: string;
  stripMax: string;
  defaultMonth: string;
  onDone: () => void;
}) {
  // Options de mois : de currentMonth (jamais dans le passé) jusqu'à stripMax.
  const months: string[] = [];
  for (let m = currentMonth; m <= stripMax; m = addMonthsKey(m, 1)) months.push(m);
  const start = defaultMonth >= currentMonth && defaultMonth <= stripMax ? defaultMonth : currentMonth;
  const [pending, setPending] = useState(false);

  async function submit(formData: FormData) {
    setPending(true);
    await createGroup({
      accountId,
      kind,
      name: String(formData.get("name") ?? ""),
      amount: kind === "envelope" ? Number(formData.get("amount") ?? 0) : null,
      startMonth: String(formData.get("startMonth") ?? currentMonth),
      scope: (String(formData.get("scope") ?? "ongoing") as "once" | "ongoing"),
    });
    setPending(false);
    onDone();
  }

  return (
    <form action={submit} className="flex flex-wrap items-end gap-2 py-2 pl-6">
      <div className="flex flex-col gap-1">
        <Label className="font-normal">Nom</Label>
        <Input name="name" required className="max-w-40" placeholder={kind === "envelope" ? "Ex: Courses" : "Ex: Abonnements"} />
      </div>
      {kind === "envelope" && (
        <div className="flex flex-col gap-1">
          <Label className="font-normal">Montant €</Label>
          <Input type="number" name="amount" step="0.01" min="0" className="max-w-28" placeholder="0.00" />
        </div>
      )}
      <div className="flex flex-col gap-1">
        <Label className="font-normal">Mois de départ</Label>
        <select name="startMonth" defaultValue={start} className="h-9 rounded-md border bg-transparent px-2 text-sm">
          {months.map((m) => (
            <option key={m} value={m}>{monthLabel(m)}</option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <Label className="font-normal">Portée</Label>
        <select name="scope" defaultValue="ongoing" className="h-9 rounded-md border bg-transparent px-2 text-sm">
          <option value="ongoing">Permanent (mois suivants aussi)</option>
          <option value="once">Ce mois seulement</option>
        </select>
      </div>
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>Ajouter</Button>
      <Button type="button" size="sm" variant="ghost" onClick={onDone}>Annuler</Button>
    </form>
  );
}
```

(Si le projet expose un composant `Select` shadcn plutôt qu'un `<select>` natif, l'utiliser pour rester cohérent ; le `<select>` natif reste acceptable et sans dépendance.)

- [ ] **Step 3: Passer `stripMax` jusqu'au tableau**

Dans `src/app/historique/page.tsx`, `stripMax` est déjà calculé (`const stripMax = addMonthsKey(currentMonth, 12);`). L'ajouter aux props de `<HistoryWithDetail ...>`. Dans `src/components/history-with-detail.tsx`, ajouter `currentMonth` (déjà présent dans les props ? il est déjà passé) et `stripMax: string` au type des props, et les transmettre à `<HistoryGrid ... />`.

- [ ] **Step 4: Bouton + et montage du formulaire dans la grille**

Dans `src/components/history-grid.tsx` : `HistoryGrid` reçoit maintenant `currentMonth`, `stripMax`, `accountId` (déjà présent). Pour chaque section sortante (`recurring`, `envelope`), afficher un bouton + (petit, discret) à gauche du titre de section. Un état local `const [adding, setAdding] = useState<null | "recurring" | "envelope">(null)` ouvre `<NewGroupInline accountId={accountId} kind={adding} currentMonth={currentMonth} stripMax={stripMax} defaultMonth={/* le premier mois affiché, ou currentMonth */} onDone={() => setAdding(null)} />` juste sous le titre de la section correspondante. Le `defaultMonth` = premier mois de `props.months` s'il est ≥ `currentMonth`, sinon `currentMonth`. Après soumission, `router.refresh()` n'est pas nécessaire (l'action revalide `/historique`) ; `onDone` referme le formulaire.

Importer `NewGroupInline` depuis `@/components/new-group-inline`.

- [ ] **Step 5: Vérifier**

Run: `npx tsc --noEmit` (propre), `npm run build` (succès).

Test manuel (`npm run dev`, `/historique`) :
- Cliquer le + de la section Enveloppes, créer « Test » à 100 €, mois de départ = mois courant, portée permanente. Vérifier qu'il apparaît dans le mois courant et les mois futurs affichés, avec budget 100.
- Créer une enveloppe ponctuelle (« ce mois seulement ») : vérifier qu'elle apparaît uniquement dans le mois courant, et que la colonne du mois suivant est **vide** (validation reportée de Task 4).
- Créer un groupe avec mois de départ = mois suivant : vérifier qu'il n'apparaît pas dans le mois courant.
- Créer un récurrent : vérifier qu'il apparaît (budget 0 tant qu'il n'a pas de lignes).
- Nettoyer ensuite ces groupes de test depuis la base (ou via Task 6 une fois la suppression dispo).

- [ ] **Step 6: Commit**

```bash
git add src/app/historique/actions.ts src/components/new-group-inline.tsx src/components/history-grid.tsx src/components/history-with-detail.tsx src/app/historique/page.tsx
git commit -m "feat(historique): création inline d'un groupe avec durée de vie"
```

---

## Task 6: Gestion d'un groupe dans le side panel (renommer, montant daté, lignes, supprimer)

**Files:**
- Modify: `src/app/historique/actions.ts` (actions `renameGroupAction`, `setGroupAmount`, `deleteGroupAction`, `addGroupLine`, `editGroupLine`, `removeGroupLine`)
- Modify: `src/lib/history-explain.ts` (variante de détail « gestion de groupe »)
- Modify: `src/components/history-detail-sidebar.tsx` (rendu de la vue gestion)
- Modify: `src/components/history-grid.tsx` (menu au survol de la ligne de groupe)
- Test: `tests/db/repositories.test.ts` (montant daté « ce mois seulement ») + `tsc` + `npm run build` + test manuel

**Interfaces:**
- Consumes: `renameGroup`, `deleteGroup`, `insertLine`, `updateLine`, `deleteLine` (repository groups) ; `setBudgetAmount`, `listBudgetAmounts` (budget-amounts) ; `budgetInForce`, `toDatedBudgets`, `addMonthsKey` (history).
- Produces : server actions

```ts
renameGroupAction(groupId: number, name: string): Promise<void>
deleteGroupAction(groupId: number): Promise<void>
setGroupAmount(groupId: number, month: string, amount: number, scope: "once" | "ongoing"): Promise<void>
addGroupLine(groupId: number, name: string, amount: number, day: number): Promise<void>
editGroupLine(lineId: number, name: string, amount: number, day: number): Promise<void>
removeGroupLine(lineId: number): Promise<void>
```

**Contexte durée de vie du montant :** `setGroupAmount` réutilise les budgets datés. « À partir de ce mois » (`ongoing`) écrit un seul montant daté à `month`. « Ce mois seulement » (`once`) écrit le montant à `month` **et** restaure le montant précédent au mois suivant, pour ne pas propager le changement.

- [ ] **Step 1: Écrire le test du montant daté « ce mois seulement »**

Ce comportement est testable purement via le repository + `budgetInForce`. Dans `tests/db/repositories.test.ts` :

```ts
it("setGroupAmount 'once' n'affecte que le mois visé", () => {
  const db = makeDb();
  seedAccount(db, "a1");
  const id = insertEnvelopeGroup(db, "a1", "Courses", "out", 300, null, "2026-01", null);
  // Simule l'action 'once' : montant à juillet, restauration du précédent en août.
  const prev = 300; // budget en vigueur avant juillet (monthlyAmount)
  setBudgetAmount(db, id, "2026-07", 500);
  setBudgetAmount(db, id, "2026-08", prev);
  const dated = toDatedBudgets(listBudgetAmounts(db));
  const g = listGroups(db).find((x) => x.id === id)! as unknown as Group;
  expect(budgetInForce(g, "2026-07", dated)).toBe(500);
  expect(budgetInForce(g, "2026-08", dated)).toBe(300);
});
```

Ajouter les imports : `setBudgetAmount`, `listBudgetAmounts` depuis `budget-amounts`, `toDatedBudgets`, `budgetInForce` depuis `../../src/lib/history`, et le type `Group` depuis `../../src/lib/forecast`.

- [ ] **Step 2: Voir le test échouer / passer**

Run: `npm test -- tests/db/repositories.test.ts`
Ce test n'exerce que des fonctions existantes ; il doit **passer** directement et sert de garde-fou du calcul daté. S'il échoue, corriger d'abord la compréhension du montant en vigueur avant d'écrire l'action.

- [ ] **Step 3: Écrire les server actions de gestion**

Dans `src/app/historique/actions.ts`, ajouter (imports : `renameGroup`, `deleteGroup`, `insertLine`, `updateLine`, `deleteLine`, `listGroups` depuis groups ; `setBudgetAmount`, `listBudgetAmounts` depuis budget-amounts ; `toDatedBudgets`, `budgetInForce`, `addMonthsKey` depuis `../../lib/history`) :

```ts
async function revalidate() {
  revalidatePath("/historique");
  revalidatePath("/previsionnel");
  revalidatePath("/transactions");
  revalidatePath("/");
}

export async function renameGroupAction(groupId: number, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  renameGroup(db(), groupId, trimmed);
  await revalidate();
}

export async function deleteGroupAction(groupId: number): Promise<void> {
  // La FK transactions.group_id ON DELETE SET NULL renvoie les transactions en Non catégorisés.
  deleteGroup(db(), groupId);
  await revalidate();
}

export async function setGroupAmount(
  groupId: number,
  month: string,
  amount: number,
  scope: "once" | "ongoing",
): Promise<void> {
  if (!/^\d{4}-\d{2}$/.test(month) || !Number.isFinite(amount) || amount < 0) return;
  const database = db();
  if (scope === "once") {
    // Montant précédent en vigueur juste avant `month`, pour le restaurer après.
    const g = listGroups(database).find((x) => x.id === groupId);
    if (!g) return;
    const dated = toDatedBudgets(listBudgetAmounts(database));
    const prev = budgetInForce(g as unknown as import("../../lib/forecast").Group, month, dated);
    setBudgetAmount(database, groupId, month, amount);
    setBudgetAmount(database, groupId, addMonthsKey(month, 1), prev);
  } else {
    setBudgetAmount(database, groupId, month, amount);
  }
  await revalidate();
}

export async function addGroupLine(groupId: number, name: string, amount: number, day: number): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  insertLine(db(), groupId, trimmed, amount, day, "");
  await revalidate();
}

export async function editGroupLine(lineId: number, name: string, amount: number, day: number): Promise<void> {
  updateLine(db(), lineId, name.trim(), amount, day, "");
  await revalidate();
}

export async function removeGroupLine(lineId: number): Promise<void> {
  deleteLine(db(), lineId);
  await revalidate();
}
```

Note : le dernier paramètre `""` de `insertLine`/`updateLine` (mot-clé) sera retiré en Task 9 en même temps que la signature.

- [ ] **Step 4: Ajouter une variante « gestion de groupe » au détail du side panel**

Dans `src/lib/history-explain.ts`, le side panel est piloté par `CellDetail`. Ajouter un champ optionnel décrivant une gestion de groupe, par exemple :

```ts
export type GroupManageInfo = {
  groupId: number;
  name: string;
  kind: "envelope" | "recurring";
  month: string;          // mois affiché sélectionné (pour le montant daté)
  currentAmount: number;  // budget en vigueur ce mois (pré-remplissage)
  lines: { id: number; name: string; amount: number; day: number }[];
};
```

et l'ajouter à `CellDetail` (`groupManage?: GroupManageInfo`), sur le modèle du champ `overspendAction?: OverspendActionInfo` déjà présent.

- [ ] **Step 5: Rendre la vue gestion dans `history-detail-sidebar.tsx`**

Dans `DetailBody` (`src/components/history-detail-sidebar.tsx`), quand `detail.groupManage` est défini, rendre un bloc de gestion (au lieu du détail de montant), avec :
- un champ nom + bouton « Renommer » → `renameGroupAction(groupId, name)` ;
- pour une enveloppe, un champ montant pré-rempli à `currentAmount` + un select portée (« à partir de ce mois » / « ce mois seulement ») + bouton « Appliquer » → `setGroupAmount(groupId, month, amount, scope)` ;
- pour un récurrent, la liste des lignes avec édition (nom/montant/jour → `editGroupLine`), suppression (`removeGroupLine`), et un mini-formulaire d'ajout (`addGroupLine`) ;
- un bouton « Supprimer le groupe » → `deleteGroupAction(groupId)` (avec une confirmation légère type `window.confirm` en français : « Supprimer ce groupe ? Ses transactions repasseront en Non catégorisés. »).

Importer les actions depuis `@/app/historique/actions`. Réutiliser `Button`, `Input`, `Label`, `select` comme dans `new-group-inline.tsx`.

- [ ] **Step 6: Menu au survol de la ligne de groupe (grille)**

Dans `src/components/history-grid.tsx`, sur la ligne d'un groupe (là où le nom et le chevron de dépliage sont rendus), ajouter une icône discrète (crayon ou trois points, `lucide-react`) visible au survol de la ligne (`opacity-0 group-hover:opacity-100` sur un conteneur `group`). Le clic construit un `CellDetail` avec `groupManage` renseigné pour ce groupe :
- `month` = premier mois affiché (`props.months[0]`) ou `currentMonth` s'il est dans la plage ;
- `currentAmount` = `props.currentBudgets?.[groupId] ?? 0` ;
- `lines` = les lignes du groupe (disponibles via `props.groups` : `SelectGroup.lines` ne porte que id/name ; il faut enrichir `SelectGroup` avec `amount`/`day`, ou passer les lignes complètes). **Décision :** enrichir le type `SelectGroup` (l.32 de history-grid + `selectGroups` dans page.tsx) pour inclure `kind`, `amount`, `day` par ligne, afin d'alimenter la gestion sans requête supplémentaire.

Le clic appelle `onSelect(detail)` (le mécanisme existant qui ouvre le side panel de droite). Le clic sur le **nom** garde son rôle de dépliage : ne pas le remplacer.

Dans `src/app/historique/page.tsx`, adapter `selectGroups` :

```ts
const selectGroups = groups.map((g) => ({
  id: g.id,
  name: g.name,
  kind: g.kind,
  lines: g.lines.map((l) => ({ id: l.id, name: l.name, amount: l.amount, day: l.day })),
}));
```

et le type `SelectGroup` de `history-grid.tsx` / `history-with-detail.tsx` en conséquence.

- [ ] **Step 7: Vérifier**

Run: `npx tsc --noEmit` (propre), `npm run build` (succès), `npm test` (vert).

Test manuel (`npm run dev`, `/historique`) :
- Survoler une ligne de groupe → l'icône apparaît ; cliquer → le side panel de droite s'ouvre en mode gestion.
- Renommer un groupe → le nom change dans le tableau.
- Enveloppe : changer le montant « à partir de ce mois » → le budget change ce mois et les suivants, pas les mois passés. Puis « ce mois seulement » → seul le mois visé change, le suivant revient à l'ancien montant.
- Récurrent : ajouter une ligne (nom, montant, jour) → le budget du groupe augmente ; éditer, supprimer une ligne.
- Supprimer un groupe qui a des transactions → il disparaît partout et ses transactions apparaissent en Non catégorisés (mois passés inclus).

- [ ] **Step 8: Commit**

```bash
git add src/app/historique/actions.ts src/lib/history-explain.ts src/components/history-detail-sidebar.tsx src/components/history-grid.tsx src/app/historique/page.tsx tests/db/repositories.test.ts
git commit -m "feat(historique): gestion d'un groupe dans le side panel (renommer, montant daté, lignes, supprimer)"
```

---

## Task 7: Bouton de création des rémunérations dans l'Historique

**Files:**
- Modify: `src/app/historique/actions.ts` (action `createRemuneration`)
- Modify: `src/components/history-grid.tsx` (bouton dans la section Rémunérations)
- Test: `tsc` + `npm run build` + test manuel

**Interfaces:**
- Consumes: `insertEnvelopeGroup`, `hasIncomeGroup` (repository groups).
- Produces : `createRemuneration(accountId: string, incomeKind: "principal" | "supplementary", amount: number): Promise<void>`.

**Contexte :** les rémunérations sont des groupes enveloppe de direction `in` avec `income_kind`. Elles restent permanentes : `start_month = '2000-01'`, `end_month = null`. Une seule principale et une seule supplémentaire par compte (`hasIncomeGroup`).

- [ ] **Step 1: Écrire l'action**

Dans `src/app/historique/actions.ts` :

```ts
import { hasIncomeGroup } from "../../db/repositories/groups";

export async function createRemuneration(
  accountId: string,
  incomeKind: "principal" | "supplementary",
  amount: number,
): Promise<void> {
  const database = db();
  if (hasIncomeGroup(database, accountId, incomeKind)) return; // déjà créée
  const name = incomeKind === "principal" ? "Rémunération principale" : "Rémunération supplémentaire";
  insertEnvelopeGroup(database, accountId, name, "in", amount, incomeKind, "2000-01", null);
  await revalidate();
}
```

(`revalidate` défini en Task 6 ; si Task 7 est faite avant Task 6, définir le helper ici ou revalider en ligne.)

- [ ] **Step 2: Bouton dans la section Rémunérations**

Dans `src/components/history-grid.tsx`, la section `income` est rendue en haut. Ajouter, dans l'en-tête de cette section, un ou deux boutons discrets « Ajouter la rémunération principale » / « supplémentaire », masqués si le compte possède déjà ce type. Pour savoir si un type existe, s'appuyer sur les rows de la section income (leur `incomeKind` : `sections.find(s => s.kind === "income")?.rows` contient les rémunérations présentes). Le bouton ouvre un mini-formulaire (nom fixe, un champ montant) qui appelle `createRemuneration(accountId, incomeKind, amount)`. Réutiliser un petit formulaire inline analogue à `NewGroupInline` (sans mois de départ ni portée puisqu'elles sont permanentes) — soit un composant `NewRemunerationInline`, soit un mode de `NewGroupInline`. **Décision :** créer un petit composant dédié `src/components/new-remuneration-inline.tsx` pour ne pas surcharger `NewGroupInline`.

- [ ] **Step 3: Vérifier**

Run: `npx tsc --noEmit` (propre), `npm run build` (succès).

Test manuel : sur un compte sans rémunération, le bouton apparaît ; créer la principale à un montant → elle apparaît en haut du tableau, tous mois. Le bouton principal disparaît ensuite. Idem supplémentaire.

- [ ] **Step 4: Commit**

```bash
git add src/app/historique/actions.ts src/components/history-grid.tsx src/components/new-remuneration-inline.tsx
git commit -m "feat(historique): création des rémunérations depuis l'Historique"
```

---

## Task 8: Suppression de l'onglet Groupes

**Files:**
- Delete: `src/app/groupes/page.tsx`, `src/app/groupes/actions.ts` (et le dossier `src/app/groupes/`)
- Delete: `src/components/new-group-form.tsx`, `src/components/group-editors.tsx`
- Modify: `src/components/app-sidebar.tsx` (retirer l'entrée `/groupes`)
- Test: `tsc` + `npm run build` + grep d'imports morts

**Interfaces:**
- Consumes: rien (les fonctions de l'onglet sont désormais reprises côté Historique).
- Produces : plus de route `/groupes`, plus d'entrée de menu.

**Pré-requis :** Tasks 5, 6, 7 terminées (création, gestion, rémunérations disponibles dans l'Historique). Ne pas faire cette tâche avant.

- [ ] **Step 1: Retirer l'entrée de navigation**

Dans `src/components/app-sidebar.tsx`, tableau `NAV` (l.18-24), supprimer la ligne `{ href: "/groupes", label: "Groupes", icon: FolderTree },` et retirer l'import `FolderTree` de `lucide-react` s'il n'est plus utilisé.

- [ ] **Step 2: Supprimer les fichiers de l'onglet et ses composants dédiés**

```bash
git rm -r src/app/groupes
git rm src/components/new-group-form.tsx src/components/group-editors.tsx
```

- [ ] **Step 3: Vérifier l'absence d'imports morts**

Run:
```bash
grep -rn "groupes/actions\|new-group-form\|group-editors\|href=\"/groupes\"\|/groupes" src/
```
Expected: aucun résultat (hormis éventuellement des chaînes de revalidation `revalidatePath("/groupes")` — les retirer si présentes, la route n'existe plus).

Vérifier aussi qu'aucune fonction du repository n'est devenue orpheline **et référencée nulle part** (`addGroup`/`editGroup`/`removeGroup` étaient des actions, pas des fonctions repo ; `updateGroup` du repo n'a plus d'appelant après le passage à `renameGroup` + budgets datés — le laisser en place est acceptable, ou le supprimer s'il n'est plus référencé : `grep -rn "updateGroup" src/`).

- [ ] **Step 4: Vérifier la compilation et le build**

Run: `npx tsc --noEmit` (propre), `npm run build` (succès), `npm test` (vert).

Test manuel : le menu latéral n'affiche plus « Groupes » ; toutes les autres pages fonctionnent ; `/groupes` renvoie un 404 (attendu).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(historique): suppression de l'onglet Groupes (fonctions reprises dans l'Historique)"
```

---

## Task 9: Retrait du code mort des mots-clés

**Files:**
- Modify: `src/db/repositories/groups.ts` (`GroupRow.keywords`, lecture `group_keywords`, `addKeyword`, `updateKeyword`, param `keyword` de `insertLine`/`updateLine`, champ `keyword` de `GroupLineRow`)
- Modify: `src/lib/forecast.ts` (type `Group.keywords`, `GroupLine.keyword`, `toOwnable`)
- Modify: `src/lib/history.ts` (`toOwnable`)
- Modify: `src/lib/ownership.ts` (`OwnableGroup.keywords`)
- Modify: `src/lib/remuneration.ts` (dérivation `keywords`)
- Modify: `src/app/page.tsx`, `src/app/transactions/page.tsx` (dérivation `keywords`)
- Modify: `src/app/historique/actions.ts` (appels `insertLine`/`updateLine` sans `""`)
- Test: `tests/db/repositories.test.ts`, `tests/lib/history.test.ts`, `tests/lib/forecast.test.ts` (retrait des champs `keywords`/`keyword` des fixtures et des tests keyword)
- Garder inerte : `src/db/schema.sql` table `group_keywords` (non supprimée) ; `tests/db/schema.test.ts` et `tests/db/migration.test.ts` peuvent continuer de vérifier la présence de la table.

**Interfaces:**
- Consumes: rien.
- Produces : `OwnableGroup` sans `keywords` ; `resolveOwnership` inchangé (il ignorait déjà les mots-clés) ; `insertLine(db, groupId, name, amount, day)` et `updateLine(db, id, name, amount, day)` sans paramètre `keyword`.

- [ ] **Step 1: Mettre à jour les tests d'abord (retrait des attentes keyword)**

Dans `tests/db/repositories.test.ts`, supprimer les tests qui exercent `addKeyword`/`updateKeyword`/la lecture des `keywords` et la cascade `group_keywords` (l. ~11, 38-49, 60 selon le rapport). Dans `tests/lib/history.test.ts` et `tests/lib/forecast.test.ts`, retirer les champs `keywords: [...]` des littéraux `Group` (`courses`, `abo`, `courses2`, `salaire`) et les champs `keyword: "..."` des littéraux de ligne (`GroupLine`). Adapter tout test qui lisait `.keywords` / `.keyword`.

- [ ] **Step 2: Voir les tests échouer à la compilation**

Run: `npm test` (ou `npx tsc --noEmit`)
Expected: FAIL/erreurs de type tant que les types portent encore `keywords`/`keyword` et que les fonctions existent — c'est le signal pour nettoyer le code source.

- [ ] **Step 3: Nettoyer `ownership.ts`**

Dans `src/lib/ownership.ts`, retirer `keywords: string[];` du type `OwnableGroup`. `resolveOwnership` n'utilise pas les mots-clés : aucun changement de logique.

- [ ] **Step 4: Nettoyer `forecast.ts` et `history.ts`**

Retirer `keywords: string[];` du type `Group` et `keyword: string;` du type `GroupLine` (forecast.ts). Dans les deux `toOwnable` (forecast.ts l.80-88 et history.ts l.119-127), supprimer la ligne `keywords: g.kind === "envelope" ? g.keywords : g.lines.map((l) => l.keyword),`. Le `toOwnable` se réduit à `{ id, accountId, direction, kind }`.

- [ ] **Step 5: Nettoyer les pages qui dérivaient les keywords**

Dans `src/lib/remuneration.ts` (l.20), `src/app/page.tsx` (l.22), `src/app/transactions/page.tsx` (l.21), supprimer la propriété `keywords: g.kind === "envelope" ? g.keywords : g.lines.map((l) => l.keyword),` du littéral de `Group` construit. Vérifier que le `Group` construit reste valide (le champ n'existe plus dans le type).

- [ ] **Step 6: Nettoyer le repository `groups.ts`**

- Retirer `keywords: string[];` de `GroupRow` et `keyword: string;` de `GroupLineRow`.
- Dans `listGroups`, supprimer le `kwStmt` et la propriété `keywords: ...` du map ; le `lineStmt` ne lit plus `keyword` (`SELECT id, name, amount, day FROM group_lines WHERE group_id = ? ORDER BY id`).
- Supprimer les fonctions `addKeyword` et `updateKeyword`.
- `insertLine(db, groupId, name, amount, day)` : retirer le paramètre `keyword` et l'INSERT ne pose plus la colonne `keyword`. **Attention :** `group_lines.keyword` est `NOT NULL` dans le schéma. Pour une base neuve, poser une valeur par défaut vide reste nécessaire côté SQL. Deux options : (a) garder l'INSERT avec `keyword` fixé à `''` en interne sans l'exposer en paramètre ; (b) rendre la colonne nullable. **Décision : option (a)** — la signature publique perd `keyword`, mais l'INSERT écrit `''` en dur, pour ne pas violer la contrainte `NOT NULL` sur les bases existantes :

```ts
export function insertLine(db: Database.Database, groupId: number, name: string, amount: number, day: number): void {
  db.prepare(`INSERT INTO group_lines (group_id, name, amount, day, keyword) VALUES (?, ?, ?, ?, '')`).run(groupId, name, amount, day);
}
export function updateLine(db: Database.Database, id: number, name: string, amount: number, day: number): void {
  db.prepare(`UPDATE group_lines SET name = ?, amount = ?, day = ? WHERE id = ?`).run(name, amount, day, id);
}
```

- [ ] **Step 7: Adapter les appelants de `insertLine`/`updateLine`**

Dans `src/app/historique/actions.ts` (`addGroupLine`, `editGroupLine` de Task 6), retirer le dernier argument `""` :
`insertLine(db(), groupId, trimmed, amount, day);` et `updateLine(db(), lineId, name.trim(), amount, day);`.

- [ ] **Step 8: Voir les tests passer**

Run: `npm test`
Expected: PASS (suite complète). `npx tsc --noEmit` propre, `npm run build` succès.

Vérifier par grep qu'il ne reste aucune dérivation de mots-clés :
```bash
grep -rn "keywords\|\.keyword\b\|addKeyword\|updateKeyword\|group_keywords" src/
```
Expected : plus aucune occurrence dans `src/` sauf la définition de la table dans `schema.sql` (laissée inerte volontairement).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor(groupes): retrait du code mort des mots-clés (rattachement 100 % manuel)"
```

---

## Récapitulatif de l'ordre des tâches

1. Colonnes de durée de vie (schéma, migration, repository).
2. Filtrage durée de vie dans `computeHistory`.
3. Durée de vie dans `computeOverspends` et `computeForecast`.
4. Rendu : cellules vides hors durée de vie + teinte entrant/sortant.
5. Création inline d'un groupe.
6. Gestion d'un groupe dans le side panel.
7. Bouton de création des rémunérations.
8. Suppression de l'onglet Groupes (après 5, 6, 7).
9. Retrait du code mort des mots-clés.

Les tâches 1 à 3 sont testées par Vitest (logique pure et repository). Les tâches 4 à 8 sont des changements d'UI vérifiés par `tsc` + `npm run build` + test manuel décrit. La tâche 9 est un nettoyage guidé par le compilateur et la suite de tests.
