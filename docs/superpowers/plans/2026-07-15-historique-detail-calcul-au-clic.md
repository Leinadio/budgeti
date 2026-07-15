# Historique : détail du calcul au clic — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Afficher « Estimé fin de mois » sur tous les mois, et rendre chaque montant du tableau Historique cliquable pour afficher, dans un popover, le détail du calcul qui y aboutit.

**Architecture:** Un module pur testé `history-explain.ts` construit des objets `CellExplanation` (titre + étapes + total). Un composant Popover shadcn/Radix (`popover.tsx`). Dans `history-grid.tsx`, un wrapper `CellAmount` enveloppe chaque montant dans un Popover dont le contenu (`ExplanationContent`) rend l'explication ; chaque site de rendu fournit l'explication adaptée à son contexte.

**Tech Stack:** TypeScript, React (Next.js), Radix (`radix-ui` méta-paquet), Vitest.

## Global Constraints

- Textes en français, sans emoji.
- Popover déclenché au **clic** (pas au survol), reste ouvert jusqu'à un clic ailleurs.
- Pas de popover sur : cellules vides, « — », en-têtes, montants de transactions individuelles.
- Le **total** d'une explication doit égaler le montant affiché dans la cellule cliquée.
- Montants dans le popover : rouge si négatif, sinon texte normal (pas de vert, pas de « + » forcé).
- Formatage via le helper `fmt` déjà présent dans `history-grid.tsx`.
- Ne pas modifier les calculs (`computeHistory`, `computeSolde`, forecast).

---

### Task 1: Composant Popover (shadcn/Radix)

**Files:**
- Create: `src/components/ui/popover.tsx`

**Interfaces:**
- Produces : `Popover`, `PopoverTrigger`, `PopoverContent`.

- [ ] **Step 1: Créer le composant**

Créer `src/components/ui/popover.tsx` :

```tsx
"use client";
import * as React from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

function Popover(props: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger(props: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
  className,
  align = "end",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "bg-popover text-popover-foreground z-50 w-72 rounded-md border p-3 shadow-md outline-none",
          "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverTrigger, PopoverContent };
```

- [ ] **Step 2: Vérifier le typage**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/popover.tsx
git commit -m "feat(ui): composant Popover (shadcn/Radix)"
```

---

### Task 2: Module d'explication pur `history-explain.ts`

**Files:**
- Create: `src/lib/history-explain.ts`
- Test: `tests/lib/history-explain.test.ts`

**Interfaces:**
- Produces :
  ```ts
  export type ExplanationStep = { label: string; amount: number };
  export type CellExplanation = { title: string; steps: ExplanationStep[]; result: number; note?: string };
  export function resteExplanation(budgeted: number, depense: number): CellExplanation;
  export function sumExplanation(title: string, entries: ExplanationStep[], note?: string): CellExplanation;
  export function runningExplanation(prevSolde: number, netLine: number): CellExplanation;
  export function soldeActuelExplanation(opening: number, recu: number, depense: number): CellExplanation;
  ```

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `tests/lib/history-explain.test.ts` :

```ts
import { expect, test } from "vitest";
import { resteExplanation, sumExplanation, runningExplanation, soldeActuelExplanation } from "../../src/lib/history-explain";

test("resteExplanation: Budget − Dépensé", () => {
  const e = resteExplanation(150.95, 114.82);
  expect(e.steps).toEqual([
    { label: "Budget", amount: 150.95 },
    { label: "Dépensé", amount: -114.82 },
  ]);
  expect(e.result).toBeCloseTo(36.13, 2);
});

test("sumExplanation additionne les entrées", () => {
  const e = sumExplanation("Dépensé", [
    { label: "CARREFOUR", amount: 50 },
    { label: "LECLERC", amount: 64.82 },
  ]);
  expect(e.result).toBeCloseTo(114.82, 2);
  expect(e.title).toBe("Dépensé");
});

test("runningExplanation: solde précédent + net de la ligne", () => {
  const e = runningExplanation(530.21, -114.82);
  expect(e.steps).toEqual([
    { label: "Solde ligne précédente", amount: 530.21 },
    { label: "Mouvement de cette ligne", amount: -114.82 },
  ]);
  expect(e.result).toBeCloseTo(415.39, 2);
});

test("soldeActuelExplanation: départ + reçu − dépensé", () => {
  const e = soldeActuelExplanation(-121.88, 1157.58, 1222.85);
  expect(e.result).toBeCloseTo(-187.15, 2);
  expect(e.steps.map((s) => s.label)).toEqual(["Argent de départ", "Total reçu", "Total dépensé"]);
});
```

- [ ] **Step 2: Lancer les tests (échec attendu)**

Run: `npx vitest run tests/lib/history-explain.test.ts`
Expected: FAIL (module absent).

- [ ] **Step 3: Implémenter le module**

Créer `src/lib/history-explain.ts` :

```ts
// Détail d'un calcul affiché dans le tableau Historique : un titre, des étapes
// signées, et un total qui doit égaler le montant de la cellule cliquée.
export type ExplanationStep = { label: string; amount: number };
export type CellExplanation = { title: string; steps: ExplanationStep[]; result: number; note?: string };

const sum = (steps: ExplanationStep[]) => steps.reduce((s, e) => s + e.amount, 0);

// Reste = Budget − Dépensé.
export function resteExplanation(budgeted: number, depense: number): CellExplanation {
  const steps: ExplanationStep[] = [
    { label: "Budget", amount: budgeted },
    { label: "Dépensé", amount: -depense },
  ];
  return { title: "Reste = Budget − Dépensé", steps, result: sum(steps) };
}

// Somme d'une liste (transactions, postes d'un récurrent, groupes d'une section…).
export function sumExplanation(title: string, entries: ExplanationStep[], note?: string): CellExplanation {
  return { title, steps: entries, result: sum(entries), note };
}

// Solde cumulé = solde de la ligne précédente ± mouvement de cette ligne.
export function runningExplanation(prevSolde: number, netLine: number): CellExplanation {
  const steps: ExplanationStep[] = [
    { label: "Solde ligne précédente", amount: prevSolde },
    { label: "Mouvement de cette ligne", amount: netLine },
  ];
  return { title: "Solde cumulé", steps, result: sum(steps) };
}

// Solde = Argent de départ + Total reçu − Total dépensé.
export function soldeActuelExplanation(opening: number, recu: number, depense: number): CellExplanation {
  const steps: ExplanationStep[] = [
    { label: "Argent de départ", amount: opening },
    { label: "Total reçu", amount: recu },
    { label: "Total dépensé", amount: -depense },
  ];
  return { title: "Solde = Départ + Reçu − Dépensé", steps, result: sum(steps) };
}
```

- [ ] **Step 4: Lancer les tests (succès attendu)**

Run: `npx vitest run tests/lib/history-explain.test.ts`
Expected: PASS.

- [ ] **Step 5: Vérifier le typage et la suite complète**

Run: `npx tsc --noEmit && npm test`
Expected: aucune erreur ; toute la suite verte.

- [ ] **Step 6: Commit**

```bash
git add src/lib/history-explain.ts tests/lib/history-explain.test.ts
git commit -m "feat(history): module pur d'explication des montants (CellExplanation)"
```

---

### Task 3: Cellules cliquables du corps + estimé sur tous les mois

**Files:**
- Modify: `src/components/history-grid.tsx`

**Interfaces:**
- Consumes : `Popover`/`PopoverTrigger`/`PopoverContent` (Task 1) ; `CellExplanation` + builders (Task 2).

- [ ] **Step 1: Imports**

Dans `src/components/history-grid.tsx`, ajouter :

```tsx
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { type CellExplanation, resteExplanation, sumExplanation, runningExplanation } from "@/lib/history-explain";
```

- [ ] **Step 2: Rendu d'une explication + cellule cliquable**

Ajouter, avant le composant `AmountCells`, deux helpers :

```tsx
// Contenu du popover : titre, étapes signées, total en gras.
function ExplanationContent({ e }: { e: CellExplanation }) {
  const money = (n: number) => (
    <span className={cn("tabular-nums whitespace-nowrap", n < 0 && "text-red-600")}>{fmt(n)}</span>
  );
  return (
    <div className="flex flex-col gap-1 text-sm">
      <div className="font-medium">{e.title}</div>
      <div className="mt-1 flex flex-col gap-0.5">
        {e.steps.map((s, i) => (
          <div key={i} className="flex items-baseline justify-between gap-4">
            <span className="text-muted-foreground">{s.label}</span>
            {money(s.amount)}
          </div>
        ))}
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-4 border-t pt-1 font-semibold">
        <span>Total</span>
        {money(e.result)}
      </div>
      {e.note && <p className="text-muted-foreground mt-1 text-xs">{e.note}</p>}
    </div>
  );
}

// Cellule de montant : cliquable (popover) si une explication est fournie.
function CellAmount({ children, className, explanation }: {
  children: React.ReactNode;
  className?: string;
  explanation?: CellExplanation | null;
}) {
  if (!explanation) return <TableCell className={className}>{children}</TableCell>;
  return (
    <TableCell className={className}>
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className="cursor-pointer decoration-dotted underline-offset-2 hover:underline">
            {children}
          </button>
        </PopoverTrigger>
        <PopoverContent><ExplanationContent e={explanation} /></PopoverContent>
      </Popover>
    </TableCell>
  );
}
```

- [ ] **Step 3: Rendre `AmountCells` cliquable**

Le composant `AmountCells` reçoit déjà `cells` et `mode` et (pour le Solde) `solde`. Il lui faut aussi de quoi expliquer Dépensé/Reçu et le Solde cumulé. Élargir sa signature :

```tsx
function AmountCells({ cells, mode, solde, depEntries, recuEntries, budgetEntries }: {
  cells: MonthCell[];
  mode: "out" | "in" | "total";
  solde?: (number | null)[];
  // Entrées de détail pour la colonne Dépensé, par mois (transactions ou groupes).
  depEntries?: (i: number) => ExplanationStep[] | null;
  // Entrées de détail pour la colonne Reçu, par mois.
  recuEntries?: (i: number) => ExplanationStep[] | null;
  // Entrées de détail pour Budget (postes d'un récurrent, ou groupes d'une section), par mois.
  budgetEntries?: (i: number) => ExplanationStep[] | null;
}) {
```

(Importer aussi `type ExplanationStep` depuis `@/lib/history-explain`.)

Remplacer le corps qui rend les 5 cellules par, pour chaque mois `i` :

```tsx
        <Fragment key={i}>
          <CellAmount
            className="border-l text-right tabular-nums text-muted-foreground"
            explanation={mode !== "in" && c.budgeted !== 0 && budgetEntries?.(i) ? sumExplanation("Budget — postes", budgetEntries(i)!) : null}
          >
            {mode === "in" ? "" : fmt(c.budgeted)}
          </CellAmount>
          <CellAmount
            className="text-right tabular-nums"
            explanation={mode !== "in" && c.depense !== 0 && depEntries?.(i) ? sumExplanation("Dépensé — détail", depEntries(i)!) : null}
          >
            {mode === "in" ? "—" : fmt(c.depense)}
          </CellAmount>
          <CellAmount
            className="text-right tabular-nums"
            explanation={mode !== "out" && c.recu !== 0 && recuEntries?.(i) ? sumExplanation("Reçu — détail", recuEntries(i)!) : null}
          >
            {mode === "out" ? "—" : fmt(c.recu)}
          </CellAmount>
          <CellAmount
            className={cn("text-right tabular-nums", mode !== "in" && c.balance < 0 && "text-red-600")}
            explanation={mode !== "in" ? resteExplanation(c.budgeted, c.depense) : null}
          >
            {mode === "in" ? "" : fmt(c.balance)}
          </CellAmount>
          {(() => {
            const s = solde?.[i];
            const net = c.recu - c.depense;
            // Solde précédent = solde de cette ligne − son propre mouvement.
            const exp = s != null ? runningExplanation(s - net, net) : null;
            return (
              <CellAmount className={cn("text-right tabular-nums", s != null && s < -0.005 && "text-red-600")} explanation={exp}>
                {s != null ? fmt(s) : ""}
              </CellAmount>
            );
          })()}
        </Fragment>
```

Note : Budget cliquable seulement si `budgetEntries` fourni (postes d'un récurrent). Reste via `resteExplanation`. Solde cumulé via `runningExplanation(s − net, net)`.

- [ ] **Step 4: Fournir `spendEntries` et `budgetEntries` aux appels de `AmountCells`**

Pour une **ligne de groupe** (`renderGroup`), construire les entrées de transactions du mois et le solde précédent. Remplacer l'appel :

```tsx
          <AmountCells cells={r.cells} mode={r.direction} solde={solde.rowRunning[r.id]} />
```

par :

```tsx
          <AmountCells
            cells={r.cells}
            mode={r.direction}
            solde={solde.rowRunning[r.id]}
            depEntries={(i) => txnEntries(r, months[i])}
            recuEntries={(i) => txnEntries(r, months[i])}
            budgetEntries={(i) => r.subRows.length > 0 ? r.subRows.map((s) => ({ label: s.name, amount: s.cells[i].budgeted })).filter((e) => e.amount !== 0) : null}
          />
```

Ajouter, dans le composant `HistoryGrid` (avant `renderGroup`), ce helper :

```tsx
  // Transactions d'un groupe pour un mois donné → entrées {libellé, montant} pour le popover.
  // Montant en valeur absolue (le total du popover doit égaler la cellule Dép./Reçu).
  const txnEntries = (r: HistoryRow, month: string): ExplanationStep[] | null => {
    const all = [...r.txns, ...r.subRows.flatMap((s) => s.txns)].filter((t) => t.month === month);
    if (all.length === 0) return null;
    return all.map((t) => ({ label: `${t.date} · ${t.label}`, amount: Math.abs(t.amount) }));
  };
```

Le solde précédent n'a pas besoin d'un helper : dans la cellule Solde (étape 3), il vaut `s − net` (le solde de la ligne moins son propre mouvement). C'est déjà ce que fait le code de l'étape 3.

- [ ] **Step 5: Estimé fin de mois sur tous les mois**

Dans la ligne « Estimé fin de mois », la cellule Solde affiche actuellement le montant seulement pour le mois courant. La remplir pour tous les mois : mois courant = `forecast.currentEstimate` ; autres mois = `solde.closings[i]`. Remplacer :

```tsx
              <TableCell className={cn("text-right tabular-nums", forecast.currentEstimate < 0 && "text-red-600")}>
                {m === currentMonth ? fmt(forecast.currentEstimate) : ""}
              </TableCell>
```

par :

```tsx
              {(() => {
                const v = m === currentMonth ? forecast.currentEstimate : solde.closings[i];
                return (
                  <TableCell className={cn("text-right tabular-nums", v < -0.005 && "text-red-600")}>
                    {fmt(v)}
                  </TableCell>
                );
              })()}
```

- [ ] **Step 6: Vérifier typage + build + tests**

Run: `npx tsc --noEmit && npm run build && npm test`
Expected: aucune erreur ; build OK ; suite verte.

- [ ] **Step 7: Vérification visuelle**

`npm run dev`, `/historique`, compte avec des groupes. Vérifier :
- Cliquer un « Reste » ouvre un popover Budget − Dépensé = Reste.
- Cliquer un « Dépensé » d'un groupe liste ses transactions, total = la cellule.
- Cliquer un « Solde » de ligne montre « solde précédent + mouvement = solde ».
- Le popover reste ouvert et se ferme au clic ailleurs.
- « Estimé fin de mois » est rempli sur août/septembre (= solde projeté).

- [ ] **Step 8: Commit**

```bash
git add src/components/history-grid.tsx
git commit -m "feat(historique): montants du corps cliquables (détail au clic) + estimé sur tous les mois"
```

---

### Task 4: Détail sur les lignes de synthèse

**Files:**
- Modify: `src/components/history-grid.tsx`

**Interfaces:**
- Consumes : `sumExplanation`, `soldeActuelExplanation` (Task 2) ; `CellAmount`/`ExplanationContent` (Task 3).

- [ ] **Step 1: Sous-totaux de section cliquables**

Les en-têtes de section (`income`, `recurring`, `envelope`, `uncategorized`) rendent `<AmountCells cells={sec.totals} mode="total" ... />`. Grâce à Task 3, leurs colonnes Dép./Reçu deviennent cliquables **seulement** si `spendEntries` est fourni. Fournir, pour ces sous-totaux, les groupes de la section comme entrées. Pour chaque appel `AmountCells` de sous-total de section, ajouter :

```tsx
            depEntries={(i) => sec.rows.map((r) => ({ label: r.name, amount: r.cells[i].depense })).filter((e) => e.amount !== 0)}
            recuEntries={(i) => sec.rows.map((r) => ({ label: r.name, amount: r.cells[i].recu })).filter((e) => e.amount !== 0)}
            budgetEntries={(i) => sec.rows.map((r) => ({ label: r.name, amount: r.cells[i].budgeted })).filter((e) => e.amount !== 0)}
```

Note : pour un sous-total, le détail Budg./Dép./Reçu liste les **groupes** de la section (pas les transactions). La colonne Reste utilise déjà `resteExplanation` sur le total (Budget total − Dépensé total), ce qui est correct. Ce bloc s'ajoute aux appels `AmountCells` des en-têtes de section (income, récurrents, enveloppes) et des non catégorisés.

- [ ] **Step 2: Ligne « Solde actuel » — colonne Solde cliquable**

La ligne « Solde actuel » rend `<AmountCells cells={grand} mode="total" solde={solde.closings} />`. Sa cellule Solde doit expliquer `Argent de départ + Total reçu − Total dépensé`. Le `runningExplanation(s − net, net)` de Task 3 donnerait « solde précédent + net », ce qui n'est pas le bon récit ici (c'est un total de colonne, pas une ligne cumulée).

Pour cette ligne précise, remplacer l'appel `AmountCells` par un rendu dédié qui, sur la colonne Solde, utilise `soldeActuelExplanation(solde.openings[i], grand[i].recu, grand[i].depense)`. Concrètement, rendre les 4 premières colonnes comme un `AmountCells` (sans `solde`), puis remplacer manuellement la 5e cellule (Solde) par :

```tsx
                <CellAmount
                  className={cn("text-right tabular-nums", solde.closings[i] < -0.005 && "text-red-600")}
                  explanation={soldeActuelExplanation(solde.openings[i], grand[i].recu, grand[i].depense)}
                >
                  {fmt(solde.closings[i])}
                </CellAmount>
```

Le plus simple : dupliquer la structure d'`AmountCells` en ligne pour la ligne « Solde actuel » (5 cellules par mois), colonnes Budg./Dép./Reçu/Reste identiques (Dép./Reçu cliquables via `spendEntries` = liste des sections), et la 5e via le bloc ci-dessus. Importer `soldeActuelExplanation`.

- [ ] **Step 2b: Détail Dép./Reçu de « Solde actuel »**

Pour les colonnes Dép./Reçu de « Solde actuel », les entrées sont les **sections** :

```tsx
sections.map((sec) => ({ label: labelOfSection(sec.kind), amount: Math.abs(isRecu ? sec.totals[i].recu : sec.totals[i].depense) })).filter((e) => e.amount !== 0)
```

avec un helper local `labelOfSection` : `income → "Rémunérations"`, `recurring → "Récurrents"`, `envelope → "Enveloppes"`, `uncategorized → "Non catégorisés"`.

- [ ] **Step 3: « Argent de départ » cliquable**

La cellule Solde de la ligne « Argent de départ » (valeur `solde.openings[i]`) : pour le 1er mois affiché, explication = « Solde banque − mouvements du mois » ; sinon = « Solde de fin du mois précédent ». Remplacer sa cellule finale par :

```tsx
              {(() => {
                const exp: CellExplanation = i === 0
                  ? { title: "Argent de départ", steps: [
                      { label: "Solde du compte (banque)", amount: forecast.balance },
                      { label: "Mouvements affichés du mois", amount: -(grand[i].recu - grand[i].depense) },
                    ], result: solde.openings[i], note: "On rembobine depuis le solde réel de la banque." }
                  : sumExplanation("Argent de départ", [
                      { label: "Solde de fin du mois précédent", amount: solde.closings[i - 1] },
                    ]);
                return (
                  <CellAmount className={cn("text-right tabular-nums", v < -0.005 && "text-red-600")} explanation={exp}>
                    {fmt(v)}
                  </CellAmount>
                );
              })()}
```

(où `v = solde.openings[i]` ; adapter le nom de variable au code existant. Importer `type CellExplanation`.)

- [ ] **Step 4: « Estimé fin de mois » et « Dépassement » cliquables**

- « Estimé fin de mois » : pour le mois courant, explication = étapes du Prévisionnel. Construire depuis `forecast.currentSteps` :

```tsx
const estimeExp = m === currentMonth
  ? { title: "Estimé fin de mois", steps: [{ label: "Solde actuel", amount: forecast.balance }, ...forecast.currentSteps.map((s) => ({ label: s.label, amount: s.amount }))], result: forecast.currentEstimate }
  : soldeActuelExplanation(solde.openings[i], grand[i].recu, grand[i].depense);
```

Envelopper la cellule (v de l'étape 5, Task 3) dans un `CellAmount explanation={estimeExp}`.

- « Dépassement » : la cellule Reste (valeur `overspend[i]`) liste les groupes en dépassement. Construire les entrées depuis les sections :

```tsx
const overEntries = sections.flatMap((s) => s.rows)
  .filter((r) => r.direction === "out" && r.cells[i].balance < 0)
  .map((r) => ({ label: r.name, amount: -r.cells[i].balance }));
```

Envelopper la cellule Dépassement dans `CellAmount explanation={overspend[i] > 0 ? sumExplanation("Dépassement — groupes au-dessus du budget", overEntries) : null}`.

- [ ] **Step 5: Vérifier typage + build + tests**

Run: `npx tsc --noEmit && npm run build && npm test`
Expected: aucune erreur ; build OK ; suite verte.

- [ ] **Step 6: Vérification visuelle**

`/historique` : cliquer un sous-total de section (liste des groupes), « Solde actuel » (départ + reçu − dépensé), « Argent de départ » (rembobinage), « Estimé fin de mois » (étapes du Prévisionnel), « Dépassement » (groupes dépassés). Chaque total du popover égale la cellule.

- [ ] **Step 7: Commit**

```bash
git add src/components/history-grid.tsx
git commit -m "feat(historique): détail au clic sur les lignes de synthèse (totaux, départ, estimé, dépassement)"
```

---

## Self-Review

- **Couverture du spec** : estimé sur tous les mois (Task 3 Step 5) ; popover au clic (Task 1 + Task 3) ; détail par type — Budget (postes d'un récurrent) / Reste / Dép / Reçu / Solde de groupe (Task 3), sous-totaux / Solde actuel / Argent de départ / Estimé / Dépassement (Task 4) ; pas de popover sur vides / « — » / transactions individuelles (CellAmount avec `explanation={null}`, guards `c.xxx !== 0`). Budget d'une enveloppe : non cliquable (pas de décomposition), conforme au spec.
- **Placeholders** : le code est fourni ; le solde précédent = `s − net` directement dans la cellule (pas de helper).
- **Cohérence des types** : `CellExplanation`/`ExplanationStep` définis en Task 2, consommés en Task 3/4 ; `sumExplanation`/`resteExplanation`/`runningExplanation`/`soldeActuelExplanation` mêmes signatures partout ; `AmountCells` expose `depEntries`/`recuEntries`/`budgetEntries` (fonctions `(i) => ExplanationStep[] | null`) utilisées identiquement en Task 3 et Task 4.
