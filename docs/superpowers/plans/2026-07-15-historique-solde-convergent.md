# Historique : solde convergent — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformer la colonne « Solde » du tableau Historique en solde du compte cumulé qui converge, ligne par ligne, vers le solde réel de la banque ; déplacer le suivi de budget dans une nouvelle colonne « Reste ».

**Architecture:** Une nouvelle fonction pure `computeSolde` (dans `src/lib/history.ts`) reconstitue, à partir du solde réel de la banque, le solde d'ouverture de chaque mois (par rembombinage) puis le solde accumulé après chaque ligne de groupe, dans l'ordre d'affichage. Le composant `history-grid.tsx` ne fait qu'afficher : cinquième colonne « Reste », colonne « Solde » alimentée par `computeSolde`, ligne « Argent de départ » en haut, ligne « Solde actuel » en bas.

**Tech Stack:** TypeScript, React (Next.js App Router), Vitest. Tests dans `tests/lib/`.

## Global Constraints

- Textes en français, sans emoji ni symbole décoratif.
- Formatage des montants via le helper `fmt` déjà présent dans `history-grid.tsx` (`new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })`).
- Tests unitaires dans `tests/lib/*.test.ts` (config vitest : `include: ["tests/**/*.test.ts"]`).
- Ne pas modifier `computeHistory`, `grandTotals`, `monthlyOverspend`, ni le forecast.
- L'ordre des sections retourné par `computeHistory` est `[recurring, envelope, uncategorized]` ; les lignes de rémunération (sens « in ») sont déjà en tête de chaque section. `computeSolde` DOIT suivre ce même ordre pour l'accumulation.

---

### Task 1: Fonction `computeSolde` dans history.ts

**Files:**
- Modify: `src/lib/history.ts` (ajouter le type `SoldeColumn` et la fonction `computeSolde` à la fin du fichier, après `grandTotals`)
- Test: `tests/lib/history.test.ts` (ajouter des tests ; réutiliser les fixtures `courses`, `tx`, et un groupe de revenu)

**Interfaces:**
- Consumes : `HistorySection`, `MonthCell` (déjà exportés par `history.ts`) ; `computeHistory` pour construire les fixtures de test.
- Produces :
  ```ts
  export type SoldeColumn = {
    openings: number[];                    // solde au début de chaque mois affiché
    closings: number[];                    // solde à la fin (mois courant = solde banque)
    rowRunning: Record<number, number[]>;  // HistoryRow.id -> solde après cette ligne, par mois
    uncategorizedRunning: number[] | null; // solde après le bloc « Non catégorisés », par mois
  };
  export function computeSolde(
    sections: HistorySection[],
    months: string[],
    currentMonth: string,
    balance: number,
  ): SoldeColumn;
  ```

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter à la fin de `tests/lib/history.test.ts` :

```ts
import { computeSolde } from "../../src/lib/history";

const salaire: Group = {
  id: 9, accountId: "a1", name: "Salaire", direction: "in", kind: "envelope",
  monthlyAmount: 2000, keywords: ["REMU"], lines: [],
};

test("computeSolde: le bas du mois courant colle au solde de la banque", () => {
  const txns = [
    tx({ id: "1", date: "2026-07-01", amount: 2000, label: "VIR REMU", groupId: 9 }),
    tx({ id: "2", date: "2026-07-10", amount: -120, label: "CARREFOUR", groupId: 1 }),
  ];
  const months = ["2026-07"];
  const sections = computeHistory([salaire, courses], txns, months, "2026-07");
  const solde = computeSolde(sections, months, "2026-07", 1500);
  // net juillet = 2000 - 120 = 1880 ; ouverture = 1500 - 1880 = -380
  expect(solde.closings[0]).toBe(1500);
  expect(solde.openings[0]).toBe(-380);
  // rémunération d'abord (-380 + 2000 = 1620), puis dépense (1620 - 120 = 1500)
  expect(solde.rowRunning[9][0]).toBe(1620);
  expect(solde.rowRunning[1][0]).toBe(1500);
});

test("computeSolde: les mois s'enchaînent (fin du mois N = début du mois N+1)", () => {
  const txns = [
    tx({ id: "1", date: "2026-06-10", amount: -100, label: "CARREFOUR", groupId: 1 }),
    tx({ id: "2", date: "2026-07-01", amount: 2000, label: "VIR REMU", groupId: 9 }),
    tx({ id: "3", date: "2026-07-10", amount: -120, label: "CARREFOUR", groupId: 1 }),
  ];
  const months = ["2026-06", "2026-07"];
  const sections = computeHistory([salaire, courses], txns, months, "2026-07");
  const solde = computeSolde(sections, months, "2026-07", 1500);
  expect(solde.closings[1]).toBe(1500);
  expect(solde.openings[1]).toBe(-380); // 1500 - 1880
  expect(solde.closings[0]).toBe(solde.openings[1]); // enchaînement
  expect(solde.openings[0]).toBe(-280); // -380 - (-100)
});

test("computeSolde: un mois futur part du solde de fin du mois courant", () => {
  const txns = [
    tx({ id: "1", date: "2026-07-01", amount: 2000, label: "VIR REMU", groupId: 9 }),
    tx({ id: "2", date: "2026-07-10", amount: -120, label: "CARREFOUR", groupId: 1 }),
  ];
  const months = ["2026-07", "2026-08"];
  const sections = computeHistory([salaire, courses], txns, months, "2026-07");
  const solde = computeSolde(sections, months, "2026-07", 1500);
  // août projeté : salaire reçu 2000, courses dépensé = budget 300 -> net 1700
  expect(solde.openings[1]).toBe(1500); // = fin de juillet
  expect(solde.closings[1]).toBe(3200); // 1500 + 1700
});
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `npx vitest run tests/lib/history.test.ts`
Expected: FAIL (`computeSolde is not a function` / import non résolu).

- [ ] **Step 3: Implémenter `computeSolde`**

Ajouter à la fin de `src/lib/history.ts` :

```ts
// Solde du compte reconstitué le long du tableau. On part du solde réel fourni
// par la banque (mois courant) : on rembobine pour trouver le solde d'ouverture
// de chaque mois, puis on accumule ligne par ligne, dans l'ordre d'affichage,
// pour la colonne « Solde ». Le bas du mois courant retombe donc, par
// construction, exactement sur le solde de la banque.
export type SoldeColumn = {
  openings: number[];
  closings: number[];
  rowRunning: Record<number, number[]>;
  uncategorizedRunning: number[] | null;
};

const cellNet = (c: MonthCell) => c.recu - c.depense;

export function computeSolde(
  sections: HistorySection[],
  months: string[],
  currentMonth: string,
  balance: number,
): SoldeColumn {
  const n = months.length;
  // Mouvement net affiché par mois = somme des sous-totaux de section
  // (entrées - sorties). Inclut déjà les non catégorisés et les projections.
  const net = months.map((_, i) => sections.reduce((s, sec) => s + cellNet(sec.totals[i]), 0));

  const openings = new Array<number>(n).fill(0);
  const closings = new Array<number>(n).fill(0);

  // Ancre : le mois courant se ferme sur le solde réel de la banque. S'il est
  // hors de la plage affichée, on ancre sur la borne la plus proche.
  let ci = months.indexOf(currentMonth);
  if (ci === -1) ci = n > 0 && currentMonth > months[n - 1] ? n - 1 : 0;

  if (n > 0) {
    closings[ci] = balance;
    openings[ci] = balance - net[ci];
    for (let i = ci - 1; i >= 0; i--) {
      closings[i] = openings[i + 1];
      openings[i] = closings[i] - net[i];
    }
    for (let i = ci + 1; i < n; i++) {
      openings[i] = closings[i - 1];
      closings[i] = openings[i] + net[i];
    }
  }

  // Accumulation ligne par ligne, dans l'ordre d'affichage des sections.
  const rowRunning: Record<number, number[]> = {};
  let uncategorizedRunning: number[] | null = null;
  for (let i = 0; i < n; i++) {
    let run = openings[i];
    for (const sec of sections) {
      if (sec.kind === "uncategorized") {
        run += cellNet(sec.totals[i]);
        (uncategorizedRunning ??= new Array<number>(n).fill(0))[i] = run;
      } else {
        for (const r of sec.rows) {
          run += cellNet(r.cells[i]);
          (rowRunning[r.id] ??= new Array<number>(n).fill(0))[i] = run;
        }
      }
    }
  }

  return { openings, closings, rowRunning, uncategorizedRunning };
}
```

- [ ] **Step 4: Lancer les tests pour vérifier qu'ils passent**

Run: `npx vitest run tests/lib/history.test.ts`
Expected: PASS (tous les tests, anciens et nouveaux).

- [ ] **Step 5: Vérifier le typage**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 6: Commit**

```bash
git add src/lib/history.ts tests/lib/history.test.ts
git commit -m "feat(history): computeSolde reconstitue le solde du compte le long du tableau"
```

---

### Task 2: Affichage — colonne « Reste », solde cumulé, lignes départ/solde actuel

**Files:**
- Modify: `src/components/history-grid.tsx`
- Modify: `src/app/historique/page.tsx`

**Interfaces:**
- Consumes : `computeSolde`, `SoldeColumn` (Task 1).
- Produces : prop `solde: SoldeColumn` sur `HistoryGrid`.

- [ ] **Step 1: Câbler `computeSolde` dans page.tsx**

Dans `src/app/historique/page.tsx`, ajouter `computeSolde` à l'import existant depuis `history` (la ligne qui importe déjà `computeHistory, grandTotals, monthlyOverspend, monthsWithData`), puis, juste après la ligne `const grand = grandTotals(sections, months.length);` :

```tsx
const solde = computeSolde(sections, months, currentMonth, a.balance);
```

Et passer la prop au composant, dans le JSX `<HistoryGrid ... />`, ajouter :

```tsx
solde={solde}
```

- [ ] **Step 2: Étendre le type de props et l'import dans history-grid.tsx**

Dans `src/components/history-grid.tsx`, ajouter `SoldeColumn` à l'import depuis `@/lib/history` :

```tsx
import { monthsDiff, type MonthCell, type HistorySection, type HistoryRow, type HistorySubRow, type HistoryTxn, type SoldeColumn } from "@/lib/history";
```

Puis, dans la signature de `HistoryGrid`, ajouter la prop `solde` :

```tsx
export function HistoryGrid({ months, currentMonth, forecast, sections, overspend, grand, groups, solde }: {
  months: string[];
  currentMonth: string;
  forecast: AccountForecast;
  sections: HistorySection[];
  overspend: number[];
  grand: MonthCell[];
  groups: SelectGroup[];
  solde: SoldeColumn;
}) {
```

- [ ] **Step 3: Réécrire `AmountCells` (5 colonnes + Solde piloté)**

Remplacer entièrement la fonction `AmountCells` par :

```tsx
// mode : "out" (dépense), "in" (entrée) ou "total" (sous-total, montre les deux
// colonnes). La colonne Solde affiche le solde du compte cumulé, fourni par
// `solde` (une valeur par mois) ; absente ou null => cellule vide.
function AmountCells({ cells, mode, solde }: { cells: MonthCell[]; mode: "out" | "in" | "total"; solde?: (number | null)[] }) {
  return (
    <>
      {cells.map((c, i) => (
        <Fragment key={i}>
          <TableCell className="border-l text-right tabular-nums text-muted-foreground">
            {mode === "in" ? "" : fmt(c.budgeted)}
          </TableCell>
          <TableCell className="text-right tabular-nums">{mode === "in" ? "—" : fmt(c.depense)}</TableCell>
          <TableCell className="text-right tabular-nums">{mode === "out" ? "—" : fmt(c.recu)}</TableCell>
          <TableCell className={cn("text-right tabular-nums", mode !== "in" && c.balance < 0 && "text-red-600")}>
            {mode === "in" ? "" : fmt(c.balance)}
          </TableCell>
          <TableCell className={cn("text-right tabular-nums", solde?.[i] != null && solde[i]! < 0 && "text-red-600")}>
            {solde?.[i] != null ? fmt(solde[i]!) : ""}
          </TableCell>
        </Fragment>
      ))}
    </>
  );
}
```

- [ ] **Step 4: Ajouter l'en-tête de colonne « Reste » et corriger les colSpan**

Dans le `TableHeader`, remplacer les deux occurrences de `colSpan={4}` par `colSpan={5}` (première ligne d'en-tête avec `ForecastCard`, deuxième ligne avec `monthLabel`).

Puis, dans la troisième ligne d'en-tête, remplacer le bloc :

```tsx
              <TableHead className="border-l text-right">Budg.</TableHead>
              <TableHead className="text-right">Dép.</TableHead>
              <TableHead className="text-right">Reçu</TableHead>
              <TableHead className="text-right">Solde</TableHead>
```

par :

```tsx
              <TableHead className="border-l text-right">Budg.</TableHead>
              <TableHead className="text-right">Dép.</TableHead>
              <TableHead className="text-right">Reçu</TableHead>
              <TableHead className="text-right">Reste</TableHead>
              <TableHead className="text-right">Solde</TableHead>
```

- [ ] **Step 5: Alimenter le solde cumulé sur les lignes de groupe et non catégorisés**

Dans `renderGroup`, la ligne du groupe :

```tsx
            <AmountCells cells={r.cells} mode={r.direction} />
```

devient :

```tsx
            <AmountCells cells={r.cells} mode={r.direction} solde={solde.rowRunning[r.id]} />
```

(Ne pas toucher aux sous-lignes `sub.cells` : elles restent sans `solde`, colonne Solde vide.)

Dans le bloc `uncategorized`, la ligne d'en-tête :

```tsx
                  <AmountCells cells={sec.totals} mode="total" />
```

devient :

```tsx
                  <AmountCells cells={sec.totals} mode="total" solde={solde.uncategorizedRunning ?? undefined} />
```

(Laisser les en-têtes de section `envelope`/`recurring` — l'autre `<AmountCells cells={sec.totals} mode="total" />` — sans `solde` : colonne Solde vide.)

- [ ] **Step 6: Ajouter la ligne « Argent de départ » en haut du corps**

Dans le `TableBody`, juste avant `{sections.map((sec) => {`, insérer :

```tsx
        <TableRow className="bg-muted/40 hover:bg-muted/40 font-medium">
          <TableCell className={cn("sticky left-0 z-10 p-0", MUTED40)}>
            <FirstColBox>Argent de départ</FirstColBox>
          </TableCell>
          {solde.openings.map((v, i) => (
            <Fragment key={i}>
              <TableCell className="border-l" />
              <TableCell />
              <TableCell />
              <TableCell />
              <TableCell className={cn("text-right tabular-nums", v < 0 && "text-red-600")}>{fmt(v)}</TableCell>
            </Fragment>
          ))}
        </TableRow>
```

- [ ] **Step 7: Renommer la ligne « Total » en « Solde actuel » et y afficher le solde de fin**

Remplacer le bloc de la ligne de total :

```tsx
        <TableRow className="bg-muted/60 hover:bg-muted/60 font-semibold">
          <TableCell className="sticky left-0 z-10 bg-[color-mix(in_oklab,var(--muted)_60%,var(--background))] p-0">
            <FirstColBox>Total</FirstColBox>
          </TableCell>
          <AmountCells cells={grand} mode="total" />
        </TableRow>
```

par :

```tsx
        <TableRow className="bg-muted/60 hover:bg-muted/60 font-semibold">
          <TableCell className="sticky left-0 z-10 bg-[color-mix(in_oklab,var(--muted)_60%,var(--background))] p-0">
            <FirstColBox>Solde actuel</FirstColBox>
          </TableCell>
          <AmountCells cells={grand} mode="total" solde={solde.closings} />
        </TableRow>
```

- [ ] **Step 8: Vérifier le typage et le build**

Run: `npx tsc --noEmit && npm run build`
Expected: aucune erreur de type ; build Next.js réussi.

- [ ] **Step 9: Vérifier les tests**

Run: `npm test`
Expected: tous les tests passent.

- [ ] **Step 10: Vérification visuelle (manuel)**

Lancer `npm run dev`, ouvrir `/historique`. Vérifier :
- Cinq colonnes par mois : Budg., Dép., Reçu, Reste, Solde.
- Ligne « Argent de départ » en haut, « Solde actuel » en bas.
- La colonne Solde monte sur les rémunérations, descend sur les dépenses, et la ligne « Solde actuel » du mois courant égale le solde de la banque (comparer avec « Solde actuel » de la carte Prévisionnel / l'en-tête du mois courant).
- Sur les lignes de rémunération : Budg. et Reste vides, Reçu rempli.

- [ ] **Step 11: Commit**

```bash
git add src/components/history-grid.tsx src/app/historique/page.tsx
git commit -m "feat(history): colonne Solde = solde du compte cumulé, colonne Reste, lignes départ et solde actuel"
```

---

## Self-Review

- **Couverture du spec** : colonne Reste (Task 2 Step 3/4), Solde cumulé (Task 1 + Task 2 Step 5), lignes Argent de départ / Solde actuel (Task 2 Step 6/7), rembobinage depuis le solde banque (Task 1), enchaînement des mois et projection future (Task 1 tests), rémunérations Budg./Reste vides (Task 2 Step 3). Tous couverts.
- **Placeholders** : aucun ; tout le code et les commandes sont explicites.
- **Cohérence des types** : `SoldeColumn` défini en Task 1 et consommé tel quel en Task 2 (`rowRunning[r.id]`, `openings`, `closings`, `uncategorizedRunning`). `computeSolde(sections, months, currentMonth, balance)` : mêmes paramètres à l'appel (page.tsx) et à la définition.
