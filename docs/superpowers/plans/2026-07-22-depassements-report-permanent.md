# Dépassements : report opt-in via « permanent » + bandeaux par mois — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un dépassement est exceptionnel par défaut (non reporté). « Permanent » devient le seul choix qui reporte un dépassement dans « Solde si dépassement » sur les mois futurs, sans toucher au budget, et la même règle vaut pour les groupes et les non catégorisés. Chaque mois affiche sous son en-tête un bandeau des dépassements à trancher.

**Architecture:** Le sens de `retained` (dans `computeOverspends`) s'inverse : il ne contient plus les dépassements NON tranchés mais les dépassements marqués PERMANENT. `computePlannedSoldes` n'a pas besoin de changer, il lit déjà `retained` pour le report futur. La carte de décision perd son formulaire de budget et se réduit à deux boutons. Un nouveau `pendingByMonth` alimente les bandeaux par mois.

**Tech Stack:** Next.js (App Router, TypeScript, React), SQLite (better-sqlite3), Vitest.

## Global Constraints

- Réponses et libellés en français, avec accents corrects.
- Tests : Vitest, bases `:memory:`. Lancer `npm test`.
- Vérifier le typecheck : `npx tsc --noEmit`. Lint : `npx eslint <fichiers>`.
- Les changements d'UI ne sont pas couverts par des tests unitaires dans ce dépôt : les vérifier par `npx tsc --noEmit` + `npm run build` + lancement du serveur (`npm run dev`).
- `decision` : union `"exceptional" | "permanent"`. Groupe `0` = non catégorisés.

---

### Task 1: `computeOverspends` — `retained` depuis les permanents + `pendingByMonth`

**Files:**
- Modify: `src/lib/history.ts` (fonction `computeOverspends`, ~556-608 ; type de retour ~562)
- Test: `tests/lib/history.test.ts` (bloc `describe("Rappels d'argent dépensé au-delà du budget")`, ~583-625)

**Interfaces:**
- Consumes: `PendingOverspend`, `RetainedOverspends` (déjà définis).
- Produces:
  - `computeOverspends(groups, txns, currentMonth, decided: { groupId: number; month: string; decision?: "exceptional" | "permanent" }[], dated?): { pendingClosed: PendingOverspend[]; pending: PendingOverspend[]; retained: RetainedOverspends; pendingByMonth: Record<string, PendingOverspend[]> }`
  - Sémantique nouvelle : `retained` = dépassement **permanent** le plus récent par groupe (et `uncat`). `pending`/`pendingClosed`/`pendingByMonth` = dépassements **non tranchés**.

- [ ] **Step 1: Écrire les tests qui échouent**

Remplacer entièrement les deux `it(...)` du bloc `describe("Rappels d'argent dépensé au-delà du budget", ...)` (actuellement lignes ~584-624) par :

```ts
  it("devrait lister les dépassements non tranchés des mois terminés, sans rien retenir par défaut", () => {
    const txns = [
      tx({ id: "1", date: "2026-06-10", amount: -350, label: "CARREFOUR", groupId: 1 }), // juin : dépassement 50
      tx({ id: "2", date: "2026-07-10", amount: -380, label: "CARREFOUR", groupId: 1 }), // juillet (courant) : dépassement 80
      tx({ id: "3", date: "2026-06-05", amount: -120, label: "SANS GROUPE" }), // uncat juin : 120 dépensés
      tx({ id: "4", date: "2026-06-06", amount: 40, label: "REMBOURSEMENT" }), // uncat juin : 40 reçus -> net 80
    ];
    const r = computeOverspends([courses], txns, "2026-07", []);
    // Mois terminés, non tranchés : Courses juin (50) et Non catégorisés juin (80).
    expect(r.pendingClosed).toEqual([
      { groupId: 1, name: "Courses", month: "2026-06", amount: 50 },
      { groupId: 0, name: "Non catégorisés", month: "2026-06", amount: 80 },
    ]);
    // Rien tranché => rien de retenu : exceptionnel par défaut, aucun report.
    expect(r.retained.byGroup[1] ?? 0).toBe(0);
    expect(r.retained.uncat).toBe(0);
    // Pastilles : un dépassement non tranché par élément (le plus récent), mois courant inclus.
    expect(r.pending).toEqual([
      { groupId: 0, name: "Non catégorisés", month: "2026-06", amount: 80 },
      { groupId: 1, name: "Courses", month: "2026-07", amount: 80 },
    ]);
    // Groupés par mois pour les bandeaux par mois (mois courant inclus).
    expect(r.pendingByMonth["2026-06"]).toEqual([
      { groupId: 1, name: "Courses", month: "2026-06", amount: 50 },
      { groupId: 0, name: "Non catégorisés", month: "2026-06", amount: 80 },
    ]);
    expect(r.pendingByMonth["2026-07"]).toEqual([
      { groupId: 1, name: "Courses", month: "2026-07", amount: 80 },
    ]);
  });

  it("devrait ne retenir pour le prévisionnel que les dépassements marqués permanents", () => {
    const txns = [
      tx({ id: "1", date: "2026-06-10", amount: -350, label: "CARREFOUR", groupId: 1 }), // juin : 50
      tx({ id: "2", date: "2026-07-10", amount: -380, label: "CARREFOUR", groupId: 1 }), // juillet : 80
    ];
    // Juillet permanent : c'est lui qu'on reporte (80), et il quitte les rappels.
    const perm = computeOverspends([courses], txns, "2026-07", [{ groupId: 1, month: "2026-07", decision: "permanent" }]);
    expect(perm.retained.byGroup[1]).toBe(80);
    expect(perm.pendingClosed).toEqual([{ groupId: 1, name: "Courses", month: "2026-06", amount: 50 }]);
    // Juillet exceptionnel : rien de retenu, il quitte quand même les rappels.
    const exc = computeOverspends([courses], txns, "2026-07", [{ groupId: 1, month: "2026-07", decision: "exceptional" }]);
    expect(exc.retained.byGroup[1] ?? 0).toBe(0);
    expect(exc.pendingClosed).toEqual([{ groupId: 1, name: "Courses", month: "2026-06", amount: 50 }]);
    // Juin permanent, juillet non tranché : on reporte juin (50).
    const permJuin = computeOverspends([courses], txns, "2026-07", [{ groupId: 1, month: "2026-06", decision: "permanent" }]);
    expect(permJuin.retained.byGroup[1]).toBe(50);
  });
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `npx vitest run tests/lib/history.test.ts -t "Rappels"`
Expected: FAIL (`pendingByMonth` indéfini, `retained` toujours basé sur le non-tranché).

- [ ] **Step 3: Réécrire `computeOverspends`**

Dans `src/lib/history.ts`, remplacer la signature de retour et le corps. Type de retour :

```ts
): { pendingClosed: PendingOverspend[]; pending: PendingOverspend[]; retained: RetainedOverspends; pendingByMonth: Record<string, PendingOverspend[]> } {
```

Élargir le paramètre `decided` :

```ts
  decided: { groupId: number; month: string; decision?: "exceptional" | "permanent" }[],
```

Garder le début de la fonction inchangé (`ownable`, `owned`). Remplacer ensuite **tout le bloc** depuis `const isDecided = ...` jusqu'au `return { ... }` final (la ligne `const months = ...` fait partie du bloc remplacé et est redéclarée ci-dessous) par :

```ts
  // Décision prise par (groupe, mois) : undefined = non tranché.
  const decidedBy = new Map(decided.map((d) => [`${d.groupId}::${d.month}`, d.decision]));
  const months = monthsWithData(txns).filter((m) => m <= currentMonth);

  const pendingClosed: PendingOverspend[] = [];
  const pendingByMonth: Record<string, PendingOverspend[]> = {};
  const retained: RetainedOverspends = { byGroup: {}, uncat: 0 };
  // Le dépassement NON tranché le plus récent, par groupe (0 = non catégorisés) : pastilles.
  const mostRecent = new Map<number, PendingOverspend>();
  // Classe un dépassement selon sa décision : non tranché -> rappels ; permanent -> retenu.
  const classify = (item: PendingOverspend, key: string) => {
    const dec = decidedBy.get(key);
    if (dec === undefined) {
      (pendingByMonth[item.month] ??= []).push(item);
      if (item.month < currentMonth) pendingClosed.push(item);
      mostRecent.set(item.groupId, item);
    } else if (dec === "permanent") {
      if (item.groupId === 0) retained.uncat = item.amount; // mois croissants : le dernier = le plus récent
      else retained.byGroup[item.groupId] = item.amount;
    }
    // exceptionnel : n'alimente ni les rappels ni le report.
  };
  for (const m of months) {
    for (const g of groups) {
      if (g.direction !== "out") continue;
      if (!isGroupAlive(g, m)) continue;
      const spent = owned.filter((o) => o.ownerId === g.id && o.month === m).reduce((s, o) => s + Math.abs(o.t.amount), 0);
      const os = Math.max(0, spent - budgetInForce(g, m, dated));
      if (os <= 0.005) continue;
      classify({ groupId: g.id, name: g.name, month: m, amount: os }, `${g.id}::${m}`);
    }
    const uncat = owned.filter((o) => o.ownerId === null && o.month === m);
    const dep = uncat.filter((o) => o.t.amount < 0).reduce((s, o) => s + Math.abs(o.t.amount), 0);
    const rec = uncat.filter((o) => o.t.amount > 0).reduce((s, o) => s + o.t.amount, 0);
    const os = Math.max(0, dep - rec);
    if (os > 0.005) classify({ groupId: 0, name: "Non catégorisés", month: m, amount: os }, `0::${m}`);
  }
  // Tri : par mois puis nom, pour un bandeau et des pastilles stables.
  const byMonthThenName = (a: PendingOverspend, b: PendingOverspend) =>
    a.month < b.month ? -1 : a.month > b.month ? 1 : a.name.localeCompare(b.name);
  pendingClosed.sort(byMonthThenName);
  for (const m of Object.keys(pendingByMonth)) pendingByMonth[m].sort(byMonthThenName);
  const pending = [...mostRecent.values()].sort(byMonthThenName);
  return { pendingClosed, pending, retained, pendingByMonth };
```

Mettre à jour le commentaire d'en-tête de la fonction (lignes ~548-552) pour refléter que `retained` = permanent, pas non-tranché.

- [ ] **Step 4: Lancer les tests pour vérifier qu'ils passent**

Run: `npx vitest run tests/lib/history.test.ts -t "Rappels"`
Expected: PASS.

- [ ] **Step 5: Adapter le récit d'un test voisin de `computePlannedSoldes`**

Le test « devrait reporter un dépassement non tranché sur les mois suivants... » (~460-479) passe `retained` à la main, donc sa mécanique reste valable, mais son intitulé est trompeur. Renommer le `it(...)` en :

```ts
  it("devrait reporter sur les mois suivants un dépassement retenu (permanent), et ne rien reporter quand il n'y en a pas", () => {
```

Et remplacer le commentaire ligne ~471 `// Non tranché : 50 est retenu...` par `// Retenu (permanent) : 50 est reporté -> août le soustrait.` et ligne ~474 `// Tranché (exceptionnel)...` par `// Rien de retenu -> août ne soustrait plus rien.`.

- [ ] **Step 6: Lancer toute la suite**

Run: `npm test`
Expected: PASS (tous les fichiers).

- [ ] **Step 7: Commit**

```bash
git add src/lib/history.ts tests/lib/history.test.ts
git commit -m "feat(dépassements): retained = permanents + pendingByMonth (report opt-in)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `decideOverspend` / `undoOverspendDecision` — ne plus toucher au budget

**Files:**
- Modify: `src/app/historique/actions.ts` (`decideOverspend` ~26-42, `undoOverspendDecision` ~44-72, imports ~3-4)
- Modify: `src/db/repositories/budget-amounts.ts` (retirer `deleteBudgetAmount` si inutilisé ailleurs)
- Modify: `src/db/repositories/overspend-decisions.ts` (retirer `getOverspendDecision` si inutilisé ailleurs)

**Interfaces:**
- Produces:
  - `decideOverspend(accountId: string, groupId: number, month: string, decision: "exceptional" | "permanent"): Promise<void>` (le paramètre `newBudget` reste optionnel et ignoré ici ; il sera retiré en Task 3 quand l'appelant ne le passera plus).
  - `undoOverspendDecision(accountId: string, groupId: number, month: string): Promise<void>` (supprime la décision, ne touche à aucun budget).

- [ ] **Step 1: Simplifier `decideOverspend`**

Dans `src/app/historique/actions.ts`, remplacer le corps de `decideOverspend` (garder la signature avec `newBudget?` pour ne pas casser l'appelant, mais l'ignorer) :

```ts
export async function decideOverspend(
  accountId: string,
  groupId: number,
  month: string,
  decision: "exceptional" | "permanent",
  newBudget?: number, // conservé pour compat appelant ; sans effet (Task 3 le retire)
): Promise<void> {
  void newBudget;
  if (!/^\d{4}-\d{2}$/.test(month)) return;
  setOverspendDecision(db(), { accountId, groupId, month, decision, decidedAt: new Date().toISOString() });
  revalidatePath("/historique");
  revalidatePath("/previsionnel");
  revalidatePath("/");
}
```

- [ ] **Step 2: Simplifier `undoOverspendDecision`**

Remplacer le corps par :

```ts
export async function undoOverspendDecision(
  accountId: string,
  groupId: number,
  month: string,
): Promise<void> {
  if (!/^\d{4}-\d{2}$/.test(month)) return;
  deleteOverspendDecision(db(), accountId, groupId, month);
  revalidatePath("/historique");
  revalidatePath("/previsionnel");
  revalidatePath("/");
}
```

- [ ] **Step 3: Nettoyer les imports et les repos devenus inutiles**

Dans `actions.ts`, l'import ligne ~3 devient :

```ts
import { setOverspendDecision, deleteOverspendDecision } from "../../db/repositories/overspend-decisions";
```

et ligne ~4 (retirer `deleteBudgetAmount`, garder `setBudgetAmount` utilisé par `setGroupAmount`) :

```ts
import { setBudgetAmount, listBudgetAmounts } from "../../db/repositories/budget-amounts";
```

Vérifier qu'ils ne sont plus utilisés ailleurs, puis retirer de `src/db/repositories/budget-amounts.ts` la fonction `deleteBudgetAmount`, et de `src/db/repositories/overspend-decisions.ts` la fonction `getOverspendDecision` :

Run: `grep -rn "deleteBudgetAmount\|getOverspendDecision" src/`
Expected: aucune occurrence après suppression. S'il en reste, ne pas supprimer la fonction concernée.

- [ ] **Step 4: Typecheck + tests**

Run: `npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/historique/actions.ts src/db/repositories/budget-amounts.ts src/db/repositories/overspend-decisions.ts
git commit -m "feat(dépassements): permanent ne relève plus de budget ; annuler ne fait que supprimer la décision

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Carte de décision — deux boutons partout, sans formulaire de budget

**Files:**
- Modify: `src/components/history-detail-sidebar.tsx` (`OverspendActionBlock` ~112-182)
- Modify: `src/app/historique/actions.ts` (retirer le paramètre `newBudget` de `decideOverspend`)

**Interfaces:**
- Consumes: `decideOverspend(accountId, groupId, month, decision)`, `undoOverspendDecision(accountId, groupId, month)`.

- [ ] **Step 1: Réécrire `OverspendActionBlock`**

Remplacer toute la fonction `OverspendActionBlock` (de `function OverspendActionBlock` jusqu'à sa `}` finale, ~112-182) par :

```tsx
function OverspendActionBlock({ action }: { action: OverspendActionInfo }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [decided, setDecided] = useState<"exceptional" | "permanent" | null>(action.decision);
  const decide = async (decision: "exceptional" | "permanent") => {
    setBusy(true);
    await decideOverspend(action.accountId, action.groupId, action.month, decision);
    setBusy(false);
    setDecided(decision);
    router.refresh();
  };
  const undo = async () => {
    setBusy(true);
    await undoOverspendDecision(action.accountId, action.groupId, action.month);
    setBusy(false);
    setDecided(null);
    router.refresh();
  };
  if (decided) {
    return (
      <div className="mt-4 rounded-md border p-3 text-sm">
        <p>
          Décidé : {decided === "exceptional" ? "exceptionnel" : "permanent"} pour le dépassement de{" "}
          {fmtAbs(action.amount)} en {monthLabel(action.month)}.
        </p>
        <div className="mt-2 flex gap-3">
          <button type="button" disabled={busy} onClick={() => setDecided(null)} className="text-muted-foreground underline decoration-dotted underline-offset-2 hover:no-underline">
            Modifier
          </button>
          <button type="button" disabled={busy} onClick={undo} className="text-muted-foreground underline decoration-dotted underline-offset-2 hover:no-underline">
            Annuler
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="mt-4 rounded-md border p-3 text-sm">
      <p>
        Dépassement de {fmtAbs(action.amount)} en {monthLabel(action.month)} — va-t-il revenir ?
      </p>
      <div className="mt-2 flex gap-2">
        <button type="button" disabled={busy} onClick={() => decide("exceptional")} className="rounded-md border px-2 py-1 hover:bg-muted">
          Exceptionnel
        </button>
        <button type="button" disabled={busy} onClick={() => decide("permanent")} className="rounded-md border px-2 py-1 hover:bg-muted">
          Permanent
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Retirer le paramètre `newBudget` de `decideOverspend`**

Dans `src/app/historique/actions.ts`, la signature devient (et retirer la ligne `void newBudget;`) :

```ts
export async function decideOverspend(
  accountId: string,
  groupId: number,
  month: string,
  decision: "exceptional" | "permanent",
): Promise<void> {
  if (!/^\d{4}-\d{2}$/.test(month)) return;
  setOverspendDecision(db(), { accountId, groupId, month, decision, decidedAt: new Date().toISOString() });
  revalidatePath("/historique");
  revalidatePath("/previsionnel");
  revalidatePath("/");
}
```

- [ ] **Step 3: Vérifier les autres appels de `decideOverspend`**

Run: `grep -rn "decideOverspend(" src/`
Expected: seul l'appel de `OverspendActionBlock` (à 4 arguments). Aucun n'a plus de 5e argument.

- [ ] **Step 4: Typecheck + build + tests**

Run: `npx tsc --noEmit && npm test`
Expected: PASS. Note : si `useState` d'`openForm`/`value` devient inutilisé, l'avoir retiré (fait ci-dessus).

- [ ] **Step 5: Vérification manuelle**

Lancer `npm run dev`, ouvrir /historique, cliquer une case Balance rouge d'un groupe : la carte montre deux boutons « Exceptionnel » / « Permanent », sans champ de budget. Cliquer sur la case Balance rouge des Non catégorisés : mêmes deux boutons.

- [ ] **Step 6: Commit**

```bash
git add src/components/history-detail-sidebar.tsx src/app/historique/actions.ts
git commit -m "feat(dépassements): carte de décision à deux boutons, sans formulaire de budget

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Bandeau par mois sous l'en-tête

**Files:**
- Modify: `src/app/historique/page.tsx` (passer `pendingByMonth` à la grille, ~107-150)
- Modify: `src/components/history-with-detail.tsx` (relayer la prop, ~30-50)
- Modify: `src/components/history-grid.tsx` (prop + rendu dans l'en-tête de mois, ~1320-1355 et ~1806-1823)

**Interfaces:**
- Consumes: `overspends.pendingByMonth: Record<string, PendingOverspend[]>` (Task 1), `overspendDecisionDetail(item, accountId, monthIdx, decision, currentBudget)` (existant).
- Produces: prop `pendingByMonth?: Record<string, PendingOverspend[]>` sur `HistoryGrid` et `HistoryWithDetail`.

- [ ] **Step 1: Relayer `pendingByMonth` depuis la page**

Dans `src/app/historique/page.tsx`, au rendu de la grille (bloc ~140-150 où sont passés `retained`, `pending`, `pendingClosed`), ajouter la prop :

```tsx
                  pendingByMonth={overspends.pendingByMonth}
```

- [ ] **Step 2: Relayer dans `history-with-detail.tsx`**

Dans le type de props (~30-45), ajouter :

```ts
  pendingByMonth?: Record<string, import("@/lib/history").PendingOverspend[]>;
```

et passer la prop au `HistoryGrid` rendu dans ce composant (chercher `<HistoryGrid` et ajouter `pendingByMonth={props.pendingByMonth}`).

- [ ] **Step 3: Ajouter la prop à `HistoryGrid`**

Dans `src/components/history-grid.tsx`, ajouter `pendingByMonth` à la déstructuration (~1320) et au type de props (~1330-1355) :

```ts
  pendingByMonth?: Record<string, PendingOverspend[]>;
```

`PendingOverspend` est déjà importé (utilisé par `pending`/`pendingClosed`). Vérifier l'import en tête de fichier ; sinon l'ajouter depuis `@/lib/history`.

- [ ] **Step 4: Rendre le bandeau dans l'en-tête de chaque mois**

Dans le `<TableHead>` de mois (~1809-1821), sous le `monthLabel`, ajouter la liste des dépassements du mois. Remplacer le contenu du `<TableHead>` par :

```tsx
              <TableHead
                key={m}
                colSpan={cols.length}
                data-current-month={m === currentMonth ? "" : undefined}
                className={cn(
                  "border-l text-center whitespace-nowrap align-top",
                  m === currentMonth && "text-foreground font-semibold",
                  m > currentMonth && "text-muted-foreground italic",
                )}
              >
                <div>
                  {monthLabel(m)}
                  {m > currentMonth ? " · projection" : ""}
                </div>
                {accountId && (pendingByMonth?.[m]?.length ?? 0) > 0 && (
                  <div className="mt-1 flex flex-wrap justify-center gap-1 text-xs font-normal not-italic">
                    {pendingByMonth![m].map((it) => (
                      <button
                        key={`${it.groupId}-${it.month}`}
                        type="button"
                        onClick={() => onSelect(overspendDecisionDetail(it, accountId, months.indexOf(it.month) === -1 ? null : months.indexOf(it.month), null, null))}
                        className="rounded border border-amber-300 bg-amber-50 px-1 text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
                      >
                        {it.name} ({NUM.format(it.amount)} €)
                      </button>
                    ))}
                  </div>
                )}
              </TableHead>
```

Vérifier que `overspendDecisionDetail` et `NUM` sont accessibles dans `history-grid.tsx`. `overspendDecisionDetail` est exporté par `@/components/overspend-banner` : ajouter l'import s'il manque :

```ts
import { overspendDecisionDetail } from "@/components/overspend-banner";
```

Pour `NUM`, s'il n'existe pas déjà dans `history-grid.tsx`, ajouter en haut du fichier :

```ts
const NUM = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
```

- [ ] **Step 5: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: succès.

- [ ] **Step 6: Vérification manuelle**

`npm run dev`, /historique : sous chaque mois ayant des dépassements non tranchés, une ou plusieurs pastilles apparaissent (nom + montant). Cliquer une pastille ouvre la carte de décision du bon groupe/mois, identique à celle du bandeau du haut.

- [ ] **Step 7: Commit**

```bash
git add src/app/historique/page.tsx src/components/history-with-detail.tsx src/components/history-grid.tsx
git commit -m "feat(dépassements): bandeau des dépassements à trancher sous chaque en-tête de mois

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Nettoyage — retirer le champ mort `currentBudget`

**Files:**
- Modify: `src/lib/history-explain.ts` (type `OverspendActionInfo` ~60-68)
- Modify: `src/components/history-grid.tsx` (occurrences `currentBudget`, `currentGroupBudget`, ~476, 533, 792, 1568-1590, 1626)
- Modify: `src/components/overspend-banner.tsx` (`overspendDecisionDetail` : retirer le paramètre `currentBudget`)
- Modify: `src/components/history-detail-sidebar.tsx` (retirer `currentBudget` si lu quelque part)

**Interfaces:**
- Produces: `overspendDecisionDetail(item: PendingOverspend, accountId: string, monthIdx: number | null, decision: "exceptional" | "permanent" | null): CellDetail` (plus de `currentBudget`).
- Produces: `OverspendActionInfo` sans le champ `currentBudget`.

- [ ] **Step 1: Retirer le champ du type**

Dans `src/lib/history-explain.ts`, supprimer la ligne `currentBudget: number | null;` du type `OverspendActionInfo` et le commentaire associé (~58-67).

- [ ] **Step 2: Retirer le paramètre de `overspendDecisionDetail`**

Dans `src/components/overspend-banner.tsx`, la fonction devient :

```tsx
export function overspendDecisionDetail(
  item: PendingOverspend,
  accountId: string,
  monthIdx: number | null,
  decision: "exceptional" | "permanent" | null,
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
    },
  };
}
```

Et dans le `onClick` du bandeau du haut (même fichier, ~66-73), retirer le dernier argument :

```tsx
            setDetail(overspendDecisionDetail(it, accountId, months.indexOf(it.month) === -1 ? null : months.indexOf(it.month), null))
```

`budgets` n'est plus utilisé par le bandeau : retirer la prop `budgets` de `OverspendBanner` et son usage (et l'endroit qui la passe, dans `history-with-detail.tsx`).

- [ ] **Step 3: Nettoyer `history-grid.tsx`**

Retirer les champs `currentBudget` des deux constructions `overspendAction` (`currentBudget: currentGroupBudget ?? c.budgeted,` ~533 et `currentBudget: null,` ~792). Retirer la prop `currentGroupBudget` d'`AmountCells` (déstructuration ~443, type ~476, passage ~1626). Retirer le dernier argument des appels `overspendDecisionDetail(...)` (~1590 et le bandeau par mois de Task 4 ~ en-tête). Retirer `currentBudgets`/`currentAmount`-liés uniquement s'ils ne servent plus à l'édition de budget (attention : `currentBudgets` sert aussi à `groupManage`/l'édition ; ne retirer QUE ce qui concerne `currentBudget` de `overspendAction`).

Run après édition : `grep -n "currentBudget\b" src/components/history-grid.tsx`
Expected: plus aucune occurrence de `currentBudget` (le champ mort). `currentBudgets` (pluriel, édition de budget) peut subsister.

- [ ] **Step 4: Typecheck + build + tests**

Run: `npx tsc --noEmit && npm run build && npm test`
Expected: PASS. Corriger toute référence restante signalée par le typecheck.

- [ ] **Step 5: Vérification manuelle**

`npm run dev` : la carte de décision fonctionne toujours (deux boutons), le bandeau du haut et les bandeaux par mois ouvrent bien la carte.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(dépassements): retirer le champ mort currentBudget de la carte de décision

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Notes de vérification finale

- Scénario complet à la main : un dépassement Carburant en juillet marqué « Permanent » fait décrocher « Solde si dépassement » de « Solde prévu » sur août/septembre (écart cumulé), sans changer le budget de Carburant. Un dépassement Non catégorisés marqué « Permanent » fait pareil. Marqué « Exceptionnel » ou laissé non tranché : les deux colonnes restent collées sur le futur.
- Les bandeaux par mois listent les non tranchés du mois ; trancher (exceptionnel ou permanent) retire la pastille.
