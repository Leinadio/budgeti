# « Permanent » = budget + provision non catégorisés + retrait du solde si dépassement en projection — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** « Permanent » relève le budget (avec champ ajustable) pour tous les types de dépassement ; les non catégorisés reçoivent une provision (budget du groupe 0) éditable ; la colonne « Solde si dépassement » disparaît sur les mois de projection ; les dépassements portent une pastille colorée sur la Balance.

**Architecture:** On réintroduit la hausse de budget sur « Permanent » (retirée au chantier précédent) et on la généralise au groupe 0 via une « provision » stockée dans `budget_amounts` (`group_id = 0`). Le mécanisme de report `retained` disparaît. `monthColumns` cesse de renvoyer `soldeDepass` sur les mois futurs.

**Tech Stack:** Next.js (App Router, TypeScript, React), SQLite (better-sqlite3), Vitest.

## Global Constraints

- Libellés / commentaires en français, accents corrects.
- Vérifier : `npm test` (Vitest, DB `:memory:`), `npx tsc --noEmit`, et `npm run build` pour l'UI.
- `decision` = union `"exceptional" | "permanent"`. Groupe `0` = non catégorisés.
- La hausse de budget d'un « permanent » est effective au **mois courant + 1** (`addMonthsKey(monthKey(now), 1)`), comme l'ancien comportement.

---

### Task 1: Provision dans le dépassement non catégorisé (lib)

**Files:**
- Modify: `src/lib/history.ts` (`computeOverspends` ~604-608 ; `uncatOverspend` helper)
- Test: `tests/lib/history.test.ts`

**Interfaces:**
- Produces: `provisionInForce(dated: DatedBudgets | undefined, month: string): number` — la provision (budget du groupe 0) en vigueur à `month`, 0 par défaut.
- Le dépassement non catégorisé devient `max(0, dépensé − reçu − provision)`.

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter dans `tests/lib/history.test.ts`, dans le `describe("Rappels d'argent dépensé au-delà du budget")` :

```ts
  it("devrait retirer la provision du dépassement non catégorisé", () => {
    const txns = [
      tx({ id: "a", date: "2026-06-05", amount: -300, label: "SANS GROUPE" }), // dépensé 300 sans groupe
      tx({ id: "b", date: "2026-06-06", amount: 40, label: "REMB" }), // reçu 40 -> net 260
    ];
    // Sans provision : dépassement = 260.
    const sans = computeOverspends([], txns, "2026-07", []);
    expect(sans.pendingClosed).toEqual([{ groupId: 0, name: "Non catégorisés", month: "2026-06", amount: 260 }]);
    // Provision de 100 en vigueur en juin (budget daté du groupe 0) : dépassement = 160.
    const dated = { 0: [{ effectiveMonth: "2026-06", amount: 100 }] };
    const avec = computeOverspends([], txns, "2026-07", [], dated);
    expect(avec.pendingClosed).toEqual([{ groupId: 0, name: "Non catégorisés", month: "2026-06", amount: 160 }]);
  });
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run tests/lib/history.test.ts -t "provision du dépassement"`
Expected: FAIL (la provision n'est pas prise en compte).

- [ ] **Step 3: Implémenter**

Dans `src/lib/history.ts`, ajouter le helper (près de `budgetInForce`) :

```ts
// Provision (budget daté du groupe 0 = non catégorisés) en vigueur à `month`, 0 par défaut.
export function provisionInForce(dated: DatedBudgets | undefined, month: string): number {
  let amount = 0;
  for (const b of dated?.[0] ?? []) if (b.effectiveMonth <= month) amount = b.amount;
  return amount;
}
```

Dans `computeOverspends`, le bloc non catégorisés (~604-608) devient :

```ts
    const uncat = owned.filter((o) => o.ownerId === null && o.month === m);
    const dep = uncat.filter((o) => o.t.amount < 0).reduce((s, o) => s + Math.abs(o.t.amount), 0);
    const rec = uncat.filter((o) => o.t.amount > 0).reduce((s, o) => s + o.t.amount, 0);
    const os = Math.max(0, dep - rec - provisionInForce(dated, m));
    if (os > 0.005) classify({ groupId: 0, name: "Non catégorisés", month: m, amount: os }, `0::${m}`);
```

Ne PAS toucher au helper `uncatOverspend` ici (il est utilisé par `computePlannedSoldes`, qui ne reçoit `dated` qu'en Task 2) : cette tâche ne modifie que le calcul inline de `computeOverspends` et ajoute `provisionInForce`.

- [ ] **Step 4: Vérifier le succès + suite complète**

Run: `npx vitest run tests/lib/history.test.ts -t "provision du dépassement"` puis `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/history.ts tests/lib/history.test.ts
git commit -m "feat(dépassements): la provision réduit le dépassement des non catégorisés

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Provision dans l'historique et le prévisionnel + retrait de `retained` (lib)

**Files:**
- Modify: `src/lib/history.ts` (`computeHistory` section non catégorisés ; `computePlannedSoldes` ; `computeOverspends` retour)
- Modify: `src/app/historique/page.tsx` (appels)
- Test: `tests/lib/history.test.ts`

**Interfaces:**
- `computeOverspends(...)` ne renvoie plus `retained` : `{ pendingClosed, pending, pendingByMonth }`.
- `computePlannedSoldes(sections, months, currentMonth, openingsReal, currentEstimate?, dated?)` : le paramètre `retained` est remplacé par `dated?: DatedBudgets` (pour la provision) ; plus aucun report sur le futur.
- La ligne « Non catégorisés » a un `budgeted` = provision et un `balance` = provision − (dépensé − reçu).

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
  it("devrait donner un budget (provision) et un solde prévu aux non catégorisés", () => {
    const dated = { 0: [{ effectiveMonth: "2026-07", amount: 200 }] };
    const txns = [tx({ id: "a", date: "2026-07-05", amount: -50, label: "SANS GROUPE" })];
    const months = ["2026-07"];
    const sections = computeHistory([], txns, months, "2026-07", dated);
    const uncatOut = sections.find((s) => s.kind === "uncategorized" && (s.uncatDirection ?? "out") === "out")!;
    // La provision s'affiche comme budget, et la Balance = provision − dépensé net (200 − 50 = 150).
    expect(uncatOut.totals[0].budgeted).toBeCloseTo(200, 2);
    expect(uncatOut.totals[0].balance).toBeCloseTo(150, 2);
  });
```

(Vérifier la signature réelle de `computeHistory` — elle prend déjà `dated?` en 5e paramètre, cf. les tests existants « Budgets qui changent ». Réutiliser cette forme.)

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run tests/lib/history.test.ts -t "provision"`
Expected: FAIL.

- [ ] **Step 3: Implémenter**

Dans `computeHistory`, à la construction de la section non catégorisés « out » (chercher `uncategorized` / `uncatDirection`), remplir `totals[i].budgeted = provisionInForce(dated, months[i])` et `totals[i].balance = budgeted − (dépensé − reçu)` (au lieu de `recu − depense`). Garder `balance = recu − depense` quand la provision est nulle donne le même résultat, donc l'invariant reste rétrocompatible.

Mettre à jour le helper `uncatOverspend(sections, month)` pour qu'il accepte `dated?: DatedBudgets` et calcule `max(0, dépensé − reçu − provisionInForce(dated, month))`. Répercuter sur ses appels.

Dans `computePlannedSoldes` : remplacer le paramètre `retained?: RetainedOverspends` par `dated?: DatedBudgets`. Retirer toute la logique de report `retained` :
- bloc non catégorisés (~672-673) :

```ts
        const dir = sec.uncatDirection ?? "out";
        if (dir === "out") {
          // Plan : la provision est une dépense planifiée, retirée du prévu.
          runP -= provisionInForce(dated, months[i]);
          // Si dépassement (passé / courant) : le débordement net au-delà de la provision.
          if (anchored) runD -= uncatOverspend(sections, osMonth, dated);
          else runD = runP; // futur : plus de report, le si dépassement suit le prévu
        }
```

- bloc groupes (~677-685) : le `os` du futur ne vient plus de `retained` :

```ts
          const os = anchored ? rowOverspend(r, osMonth) : 0;
```

Dans `computeOverspends`, retirer `retained` de la construction et du retour (garder `pending`, `pendingClosed`, `pendingByMonth`). Supprimer le type `RetainedOverspends` s'il n'est plus utilisé nulle part (`grep -rn RetainedOverspends src/`).

Dans `src/app/historique/page.tsx` : ne plus lire `overspends.retained`, ne plus le passer ni à `computePlannedSoldes` ni à la grille ; passer `datedBudgets` à `computePlannedSoldes`. Retirer la prop `retained` transmise à `HistoryWithDetail`/`HistoryGrid` (et l'enlever de leurs types — voir aussi Task 4/8).

- [ ] **Step 4: Adapter les tests existants**

Les tests utilisant `retained` (`computePlannedSoldes(..., { byGroup, uncat })`, `r.retained.*`) doivent être réécrits : la projection ne reporte plus rien. Le test « devrait reporter sur les mois suivants un dépassement retenu (permanent)… » devient : sur un mois futur, `depassClosings` == `prevuClosings` (aucun report). Les assertions `r.retained.*` de `computeOverspends` disparaissent.

- [ ] **Step 5: Suite complète**

Run: `npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/history.ts src/app/historique/page.tsx tests/lib/history.test.ts
git commit -m "feat(dépassements): provision dans historique/prévisionnel + retrait du report retained

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `monthColumns` sans « Solde si dépassement » sur les mois futurs

**Files:**
- Modify: `src/components/history-grid.tsx` (`monthColumns` ~85-95)

**Interfaces:**
- `monthColumns(type)` renvoie `soldeDepass` pour `"past"`/`"current"`, mais **pas** pour `"future"`.

- [ ] **Step 1: Implémenter**

Remplacer `monthColumns` :

```ts
function monthColumns(type: MonthType): ColKey[] {
  const base: ColKey[] = ["budgetRem", "budgetDep", "dep", "recu", "reste", "soldeReel", "soldePrevu"];
  // Sur les mois de projection, « Solde si dépassement » ne dirait que la même chose
  // que « Solde prévu » (les dépassements permanents sont passés dans le budget) : on
  // ne l'affiche que sur les mois passés et le mois en cours.
  return type === "future" ? base : [...base, "soldeDepass"];
}
```

- [ ] **Step 2: Typecheck + build + vérif navigateur**

Run: `npx tsc --noEmit && npm run build`
Expected: succès. Puis `npm run dev` : sur un mois futur, la colonne « Solde si dépassement » n'apparaît plus ; elle reste sur le mois courant.

- [ ] **Step 3: Commit**

```bash
git add src/components/history-grid.tsx
git commit -m "feat(historique): retirer « Solde si dépassement » sur les mois de projection

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Action + repo — « Permanent » relève le budget / la provision

**Files:**
- Modify: `src/db/repositories/budget-amounts.ts` (re-ajouter `deleteBudgetAmount`)
- Modify: `src/app/historique/actions.ts` (`decideOverspend`, `undoOverspendDecision`, imports)

**Interfaces:**
- `decideOverspend(accountId, groupId, month, decision, newBudget?)` : sur `"permanent"` avec `newBudget` valide, écrit `setBudgetAmount(groupId, moisCourant+1, newBudget)` — groupId 0 inclus (provision).
- `undoOverspendDecision(accountId, groupId, month)` : si la décision était `"permanent"`, `deleteBudgetAmount(groupId, moisCourant+1)`.
- `deleteBudgetAmount(db, groupId, effectiveMonth)`.

- [ ] **Step 1: Re-ajouter `deleteBudgetAmount`**

Dans `src/db/repositories/budget-amounts.ts` :

```ts
export function deleteBudgetAmount(db: Database.Database, groupId: number, effectiveMonth: string): void {
  db.prepare(`DELETE FROM budget_amounts WHERE group_id = ? AND effective_month = ?`).run(groupId, effectiveMonth);
}
```

- [ ] **Step 2: `decideOverspend` relève le budget**

Dans `src/app/historique/actions.ts`, réintroduire (imports `monthKey` depuis `../../lib/money`, `addMonthsKey` depuis `../../lib/history`, `getOverspendDecision` depuis le repo décisions) et remplacer `decideOverspend` :

```ts
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
  // « Permanent » relève le budget (ou la provision du groupe 0) au mois suivant le
  // mois courant : le passé et le mois courant gardent leur budget réel.
  if (decision === "permanent" && newBudget != null && Number.isFinite(newBudget) && newBudget > 0) {
    const currentMonth = monthKey(new Date().toISOString().slice(0, 10));
    setBudgetAmount(database, groupId, addMonthsKey(currentMonth, 1), newBudget);
  }
  revalidatePath("/historique");
  revalidatePath("/previsionnel");
  revalidatePath("/");
}
```

- [ ] **Step 3: `undoOverspendDecision` retire la hausse**

```ts
export async function undoOverspendDecision(
  accountId: string,
  groupId: number,
  month: string,
): Promise<void> {
  if (!/^\d{4}-\d{2}$/.test(month)) return;
  const database = db();
  const existing = getOverspendDecision(database, accountId, groupId, month);
  if (existing?.decision === "permanent") {
    const currentMonth = monthKey(new Date().toISOString().slice(0, 10));
    deleteBudgetAmount(database, groupId, addMonthsKey(currentMonth, 1));
  }
  deleteOverspendDecision(database, accountId, groupId, month);
  revalidatePath("/historique");
  revalidatePath("/previsionnel");
  revalidatePath("/");
}
```

Re-ajouter `getOverspendDecision` dans `src/db/repositories/overspend-decisions.ts` s'il a été retiré (SELECT par account/group/month renvoyant la décision ou null).

- [ ] **Step 4: Typecheck + tests**

Run: `npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/historique/actions.ts src/db/repositories/budget-amounts.ts src/db/repositories/overspend-decisions.ts
git commit -m "feat(dépassements): « permanent » relève le budget/la provision ; annuler le retire

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Carte de décision — formulaire « Permanent » ajustable (groupes + provision)

**Files:**
- Modify: `src/lib/history-explain.ts` (re-ajouter `currentBudget` à `OverspendActionInfo`)
- Modify: `src/components/history-grid.tsx` (construction `overspendAction` : `currentBudget` = budget du groupe / provision du groupe 0)
- Modify: `src/components/history-detail-sidebar.tsx` (`OverspendActionBlock` : bouton « Permanent » ouvre un champ pré-rempli)

**Interfaces:**
- `OverspendActionInfo` regagne `currentBudget: number | null` (budget/provision actuel, pour pré-remplir le champ ; null si inconnu).
- `decide("permanent", newBudget)` transmet le montant.

- [ ] **Step 1: Re-ajouter le champ au type**

Dans `src/lib/history-explain.ts`, ajouter à `OverspendActionInfo` :

```ts
  currentBudget: number | null; // budget/provision actuel, pour pré-remplir « permanent »
```

- [ ] **Step 2: Renseigner `currentBudget` dans `history-grid.tsx`**

Aux deux constructions `overspendAction` (ligne de groupe dans `AmountCells` ; non catégorisés dans `SectionTotalsCells`), ajouter `currentBudget` :
- Groupe : le budget courant du groupe (réutiliser `currentBudgets?.[r.id]` déjà disponible, sinon le budget de la cellule).
- Non catégorisés : la provision en vigueur au mois courant. Passer une prop `currentUncatProvision` (calculée dans `HistoryGrid` via `provisionInForce(datedBudgets, currentMonth)`) jusqu'à `SectionTotalsCells`, ou `null` si non disponible.

- [ ] **Step 3: Restaurer le formulaire dans `OverspendActionBlock`**

Remplacer `OverspendActionBlock` par une version où « Permanent » déplie un champ pré-rempli (voir le code d'origine avant le chantier précédent, commit parent de `4300a7a`). Structure attendue :
- état `openForm`, `value` (init `String(Math.round(((action.currentBudget ?? 0) + action.amount) * 100) / 100)`).
- `decide("exceptional")` sur le bouton Exceptionnel.
- bouton « Permanent » → `setOpenForm(v => !v)`.
- champ « Nouveau budget » (ou « Nouvelle provision » si `groupId === 0`) + bouton « Valider » → `decide("permanent", parseFloat(value))`.
- `decide` prend `(decision, newBudget?)` et appelle `decideOverspend(accountId, groupId, month, decision, newBudget)`.
- le bloc « décidé » garde « Modifier » et « Annuler » (inchangé).

- [ ] **Step 4: Typecheck + build + vérif navigateur**

Run: `npx tsc --noEmit && npm run build`
Puis `npm run dev` : cliquer une Balance rouge → « Permanent » ouvre un champ pré-rempli (budget + dépassement) ; valider relève le budget (visible sur les mois de projection). Sur les non catégorisés, le libellé est « Nouvelle provision ».

- [ ] **Step 5: Commit**

```bash
git add src/lib/history-explain.ts src/components/history-grid.tsx src/components/history-detail-sidebar.tsx
git commit -m "feat(dépassements): « permanent » rouvre un champ de budget/provision ajustable

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Édition manuelle de la provision des non catégorisés

**Files:**
- Modify: `src/app/historique/actions.ts` (action `setUncatProvision` ou généralisation de `setGroupAmount` au groupe 0)
- Modify: `src/components/history-grid.tsx` (rendre la case « Budget dép. » des non catégorisés cliquable → détail éditable)
- Modify: `src/components/history-detail-sidebar.tsx` (bloc d'édition « Provision pour [mois] », réutilise l'UI d'édition de montant d'enveloppe)

**Interfaces:**
- `setUncatProvision(month, amount, scope)` (ou `setGroupAmount(0, month, amount, scope)` adapté au groupe 0 : `setGroupAmount` utilise `listGroups().find(id)` qui échoue pour 0 → écrire une variante qui pose directement `setBudgetAmount(0, …)` avec la même logique `once`/`ongoing`).

- [ ] **Step 1: Action provision**

Dans `actions.ts`, ajouter une action qui écrit un budget daté pour le groupe 0 avec la même sémantique `once`/`ongoing` que `setGroupAmount` (réutiliser `onceBudgetWrites` avec un budget de base 0 pour le groupe 0). Revalider `/historique`, `/previsionnel`, `/`.

- [ ] **Step 2: Case Budget éditable + bloc d'édition**

Rendre la case « Budget dép. » des non catégorisés cliquable (comme celle d'une enveloppe) et lui attacher un détail portant les infos nécessaires (mois, provision courante). Dans le side panel, réutiliser le bloc d'édition de montant existant des enveloppes (« Montant pour [mois] » + sélecteur `ongoing`/`once` + « Appliquer ») avec le libellé « Provision pour [mois] », appelant l'action de Step 1.

- [ ] **Step 3: Typecheck + build + vérif navigateur**

Run: `npx tsc --noEmit && npm run build`
Puis `npm run dev` : cliquer la case Budget des non catégorisés → saisir une provision → « Appliquer » → elle s'affiche et fait baisser le Solde prévu des non catégorisés.

- [ ] **Step 4: Commit**

```bash
git add src/app/historique/actions.ts src/components/history-grid.tsx src/components/history-detail-sidebar.tsx
git commit -m "feat(historique): provision des non catégorisés éditable comme un budget d'enveloppe

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Pastilles colorées sur la colonne Balance

**Files:**
- Modify: `src/components/history-grid.tsx` (cellule Balance des lignes de groupe et des non catégorisés)

**Interfaces:**
- Sur une Balance en dépassement (mois passé / courant), un point coloré selon `decisionByKey.get(\`${groupId}::${month}\`)` : `undefined` → ambre, `"exceptional"` → gris, `"permanent"` → bleu.

- [ ] **Step 1: Helper de couleur**

Ajouter un petit composant/at helper qui, pour un dépassement donné, rend un point (`<span className="ml-1 inline-block size-2 shrink-0 rounded-full ...">`) avec la classe de couleur : ambre `bg-amber-500`, gris `bg-muted-foreground/60`, bleu `bg-blue-500`. Réutiliser le style du point ambre existant sur le nom des non catégorisés (`grep -n "bg-amber-500" src/components/history-grid.tsx`).

- [ ] **Step 2: Poser la pastille sur la Balance**

Dans le rendu de la cellule Balance (`reste`) des lignes de groupe sortantes et des non catégorisés, quand la Balance est un dépassement (`balance < -0.005`, mois `<= currentMonth`), afficher la pastille à côté du montant, couleur selon la décision (via `decisionByKey`, déjà passé à ces composants).

- [ ] **Step 3: Typecheck + build + vérif navigateur**

Run: `npx tsc --noEmit && npm run build`
Puis `npm run dev` : une Balance rouge non tranchée porte un point ambre ; après « exceptionnel » il devient gris, après « permanent » bleu.

- [ ] **Step 4: Commit**

```bash
git add src/components/history-grid.tsx
git commit -m "feat(historique): pastille colorée sur la Balance selon la décision (ambre/gris/bleu)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Rafraîchissement du bandeau du haut

**Files:**
- Verify/Modify: `src/components/overspend-banner.tsx`, `src/components/history-detail-sidebar.tsx`, `src/app/historique/page.tsx`

**Interfaces:**
- Après un choix ou une annulation, le bandeau « Des dépassements attendent une décision » reflète immédiatement l'état.

- [ ] **Step 1: Vérifier le comportement**

`npm run dev` : trancher un dépassement d'un mois passé listé dans le bandeau du haut → l'élément doit disparaître ; annuler → il revient. La carte appelle déjà `router.refresh()` et les actions `revalidatePath("/historique")`.

- [ ] **Step 2: Corriger si figé**

Si le bandeau ne se met pas à jour : s'assurer que `OverspendBanner` est bien rendu à partir des données serveur re-fetchées (pas d'état client figé), et que `pendingClosed`/`pending` sont recalculés après `revalidatePath`. Au besoin, dériver la liste affichée d'une prop serveur plutôt que d'un `useState` local.

- [ ] **Step 3: Commit (si changement)**

```bash
git add -A
git commit -m "fix(historique): le bandeau des dépassements se met à jour après un choix ou une annulation

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Notes de vérification finale

- Parcours : dépassement Carburant → « Permanent » → champ pré-rempli (budget + dépassement) → valider → budget relevé sur les mois de projection, plus de colonne « Solde si dépassement » sur ces mois. « Annuler » → budget revenu.
- Non catégorisés : « Permanent » pose une provision ; on peut aussi la saisir à la main via la case Budget. Le dépassement des non catégorisés en tient compte.
- Pastilles Balance : ambre → gris (exceptionnel) → bleu (permanent). Bandeau du haut à jour.
