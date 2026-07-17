# Historique : colonnes de projection (prévu / réel / dépassement) — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dans le tableau Historique, remplacer les faux « Dépensé/Reçu » des mois futurs par des colonnes de solde dédiées (prévu / si dépassement), et comparer prévu vs réel sur le mois courant.

**Architecture:** Une fonction lib pure `computePlannedSoldes` calcule deux chaînes de solde (prévu = revenus − budget ; si dépassement = prévu − dépassement) ancrées à l'argent de départ réel du mois courant et enchaînées vers le futur. Le tableau rend des colonnes dont la liste dépend du type de mois (passé / courant / projection), via un modèle de colonnes piloté par données.

**Tech Stack:** Next.js (App Router, TS, React), Vitest. Pas de changement de base.

## Global Constraints

- Colonnes par type de mois :
  - Passé : `Budg | Dép | Reçu | Reste | Solde` (Solde = réel ; inchangé).
  - Courant (8) : `Budg | Dép | Reçu | Reste | Dépassement | Solde réel | Solde prévu | Solde si dépass.`
  - Projection : `Budget | Revenus | Dépassement | Solde prévu | Solde si dépass.`
- Formules (soldes cumulés ligne par ligne) :
  - Solde réel = argent de départ + mouvements réels (ancré banque). Inchangé (`computeSolde`).
  - Solde prévu = argent de départ + revenus projetés − budget de dépenses.
  - Solde si dépass. = Solde prévu − dépassement.
- `revenus[m]` = montant de la principale (tous mois) + montant de la supplémentaire au **mois courant seulement**.
- `budget[m]` = somme des budgets de dépenses. `dépassement[m]` = dépense au-delà du budget (réel au mois courant, maintenu en projection).
- Les chaînes prévu/dépass. démarrent à `openings[currentMonth]` (argent de départ réel rembobiné) et s'enchaînent vers le futur ; non affichées pour les mois passés.
- Les lignes du bas « Estimé fin de mois » et « Dépassement » sont **conservées** telles quelles.
- Solde prévu du mois courant = « plan complet » (argent de départ + revenus − budget), même s'il diffère de la ligne « Estimé fin de mois ».
- Non catégorisés : exclus des chaînes prévu/dépass. (aucun budget/revenu planifié).
- Style : commentaires en français, pas d'emoji.

---

### Task 1 : Lib — chaînes de solde prévu / si dépassement

**Files:**
- Modify: `src/lib/history.ts` (ajouter le type `PlannedSoldes`, les helpers de ligne, et `computePlannedSoldes` après `computeSolde`)
- Test: `tests/lib/history.test.ts` (ajouter les tests ci-dessous)

**Interfaces:**
- Consumes: `HistorySection`, `HistoryRow`, `MonthCell`, et `computeSolde(...).openings` (argent de départ réel par mois).
- Produces:
  ```ts
  export type PlannedSoldes = {
    prevuClosings: (number | null)[];      // par mois ; null avant le mois courant
    depassClosings: (number | null)[];
    prevuRowRunning: Record<number, (number | null)[]>;   // par id de ligne, par mois
    depassRowRunning: Record<number, (number | null)[]>;
  };
  export function computePlannedSoldes(
    sections: HistorySection[], months: string[], currentMonth: string, openingsReal: number[],
  ): PlannedSoldes;
  ```

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajouter à `tests/lib/history.test.ts` (importer `computePlannedSoldes` et, si besoin, `computeSolde`) :

```ts
test("computePlannedSoldes: prévu = départ + revenus − budget ; si dépassement retire le dépassement", () => {
  // Principale 2000 (in), une dépense budget 300 dont on a dépensé 350 ce mois (dépassement 50).
  const principal: Group = { id: 1, accountId: "a1", name: "Rémunération principale", direction: "in", kind: "envelope", monthlyAmount: 2000, keywords: [], lines: [], incomeKind: "principal" };
  const courses: Group = { id: 2, accountId: "a1", name: "Courses", direction: "out", kind: "envelope", monthlyAmount: 300, keywords: [], lines: [], incomeKind: null };
  const txns = [
    tx({ id: "s", date: "2026-07-01", amount: 2000, label: "REMU", groupId: 1 }),
    tx({ id: "c", date: "2026-07-10", amount: -350, label: "CARREFOUR", groupId: 2 }),
  ];
  const months = ["2026-07", "2026-08"];
  const sections = computeHistory([principal, courses], txns, months, "2026-07");
  const solde = computeSolde(sections, months, "2026-07", 5000);
  const p = computePlannedSoldes(sections, months, "2026-07", solde.openings);
  const open = solde.openings[0]; // argent de départ réel du mois courant
  // Mois courant : prévu = open + 2000 − 300 ; si dépass = prévu − 50.
  expect(p.prevuClosings[0]).toBeCloseTo(open + 2000 - 300, 2);
  expect(p.depassClosings[0]).toBeCloseTo(open + 2000 - 300 - 50, 2);
  // Mois futur : chaîne à partir de la clôture du mois courant (même net planifié).
  expect(p.prevuClosings[1]).toBeCloseTo((open + 2000 - 300) + (2000 - 300), 2);
  expect(p.depassClosings[1]).toBeCloseTo((open + 2000 - 300 - 50) + (2000 - 300 - 50), 2);
});

test("computePlannedSoldes: la supplémentaire compte au mois courant mais pas en projection", () => {
  const supp: Group = { id: 3, accountId: "a1", name: "Rémunération supplémentaire", direction: "in", kind: "envelope", monthlyAmount: 500, keywords: [], lines: [], incomeKind: "supplementary" };
  const months = ["2026-07", "2026-08"];
  const sections = computeHistory([supp], [], months, "2026-07");
  const solde = computeSolde(sections, months, "2026-07", 1000);
  const p = computePlannedSoldes(sections, months, "2026-07", solde.openings);
  const open = solde.openings[0];
  expect(p.prevuClosings[0]).toBeCloseTo(open + 500, 2); // courant : +500
  expect(p.prevuClosings[1]).toBeCloseTo(open + 500, 2); // futur : +0 (pas de projection)
});
```

- [ ] **Step 2 : Lancer pour vérifier l'échec**

Run: `npx vitest run tests/lib/history.test.ts`
Expected: FAIL (`computePlannedSoldes` n'existe pas).

- [ ] **Step 3 : Implémenter les helpers et la fonction**

Ajouter dans `src/lib/history.ts`, après `computeSolde` :

```ts
// Revenu projeté d'une ligne pour un mois : montant de la principale (tous mois),
// montant de la supplémentaire au mois courant seulement, 0 pour une dépense.
function rowRevenus(r: HistoryRow, i: number, isCurrent: boolean): number {
  if (r.direction !== "in") return 0;
  if (r.incomeKind === "supplementary") return isCurrent ? r.cells[i].budgeted : 0;
  return r.cells[i].budgeted;
}
// Budget de dépense d'une ligne (0 pour une entrée). budgeted est constant sur les mois.
function rowBudget(r: HistoryRow, i: number): number {
  return r.direction === "out" ? r.cells[i].budgeted : 0;
}
// Dépassement maintenu d'une ligne = dépassement réel constaté au mois courant.
function rowOverspend(r: HistoryRow, ci: number): number {
  if (r.direction !== "out") return 0;
  return Math.max(0, r.cells[ci].depense - r.cells[ci].budgeted);
}

export type PlannedSoldes = {
  prevuClosings: (number | null)[];
  depassClosings: (number | null)[];
  prevuRowRunning: Record<number, (number | null)[]>;
  depassRowRunning: Record<number, (number | null)[]>;
};

// Chaînes de solde « plan » : prévu (revenus − budget) et « si dépassement »
// (prévu − dépassement), ancrées à l'argent de départ réel du mois courant et
// enchaînées vers le futur. Nulles avant le mois courant (colonnes non affichées).
export function computePlannedSoldes(
  sections: HistorySection[], months: string[], currentMonth: string, openingsReal: number[],
): PlannedSoldes {
  const n = months.length;
  let ci = months.indexOf(currentMonth);
  if (ci === -1) ci = n > 0 && currentMonth < months[0] ? 0 : n - 1;

  const prevuClosings = new Array<number | null>(n).fill(null);
  const depassClosings = new Array<number | null>(n).fill(null);
  const prevuRowRunning: Record<number, (number | null)[]> = {};
  const depassRowRunning: Record<number, (number | null)[]> = {};
  for (const sec of sections) for (const r of sec.rows) {
    prevuRowRunning[r.id] = new Array<number | null>(n).fill(null);
    depassRowRunning[r.id] = new Array<number | null>(n).fill(null);
  }
  if (n === 0 || ci >= n) return { prevuClosings, depassClosings, prevuRowRunning, depassRowRunning };

  for (let i = ci; i < n; i++) {
    const isCurrent = months[i] === currentMonth;
    let runP = i === ci ? openingsReal[ci] : prevuClosings[i - 1]!;
    let runD = i === ci ? openingsReal[ci] : depassClosings[i - 1]!;
    for (const sec of sections) {
      // Non catégorisés exclus du plan (aucun budget/revenu planifié).
      if (sec.kind === "uncategorized") continue;
      for (const r of sec.rows) {
        const net = rowRevenus(r, i, isCurrent) - rowBudget(r, i);
        runP += net;
        runD += net - rowOverspend(r, ci);
        prevuRowRunning[r.id][i] = runP;
        depassRowRunning[r.id][i] = runD;
      }
    }
    prevuClosings[i] = runP;
    depassClosings[i] = runD;
  }
  return { prevuClosings, depassClosings, prevuRowRunning, depassRowRunning };
}
```

- [ ] **Step 4 : Lancer pour vérifier le succès**

Run: `npx vitest run tests/lib/history.test.ts`
Expected: PASS (tests existants toujours verts — aucune signature modifiée).

- [ ] **Step 5 : Commit**

```bash
git add src/lib/history.ts tests/lib/history.test.ts
git commit -m "feat(historique): chaînes de solde prévu et si dépassement"
```

---

### Task 2 : Affichage — colonnes variables selon le type de mois

**Files:**
- Modify: `src/components/history-grid.tsx` (modèle de colonnes par type de mois ; en-tête ; rendu des lignes, sous-totaux, grand total, ligne d'ouverture ; lignes du bas conservées)
- Modify: `src/app/historique/page.tsx` (calculer `computePlannedSoldes` et le passer à la grille)
- Modify: `src/components/history-with-detail.tsx` (transmettre la nouvelle prop `planned`)

**Interfaces:**
- Consumes: `PlannedSoldes` (Task 1) ; `SoldeColumn` (existant, pour Solde réel).
- Le composant `HistoryGrid` gagne une prop `planned: PlannedSoldes`.

**Contexte de conception (à suivre) :**

Aujourd'hui chaque mois rend **5 colonnes fixes** (Budg/Dép/Reçu/Reste/Solde) via
`AmountCells`, `SectionTotalsCells`, `GrandTotalsCells`, plus un en-tête à 5
`TableHead` par mois (`colSpan={5}`). On remplace ce schéma fixe par un **modèle de
colonnes piloté par le type de mois**.

Type de mois : `past` (`m < currentMonth`), `current` (`m === currentMonth`),
`future` (`m > currentMonth`).

Colonnes par type (identifiants) :
- past : `["budg", "dep", "recu", "reste", "soldeReel"]`
- current : `["budg", "dep", "recu", "reste", "depassement", "soldeReel", "soldePrevu", "soldeDepass"]`
- future : `["budget", "revenus", "depassement", "soldePrevu", "soldeDepass"]`

Étiquettes : Budg. / Dép. / Reçu / Reste / Dépass. / Solde / Solde prévu / Solde
dépass. (et pour future : Budget / Revenus / Dépass. / Solde prévu / Solde dépass.).

Valeur d'une colonne pour une **ligne de groupe** `r`, au mois d'index `i` (helpers de
Task 1 réutilisés ; `solde` = SoldeColumn réel ; `planned` = PlannedSoldes) :
- `budg` : `r.direction === "in" ? (r.incomeKind === "principal" ? fmt(budgeted) : "") : fmt(budgeted)` (identique à l'actuel Budget).
- `budget` (future, dépense seule) : `r.direction === "out" ? fmt(budgeted) : "—"`.
- `revenus` (future) : `rowRevenus(r, i, false)` formaté (principale = montant ; supplémentaire = 0 ; dépense = "—").
- `dep` : `mode "in" ? "—" : fmt(depense)` (réel).
- `recu` : `mode "out" ? "—" : fmt(recu)` (réel).
- `reste` : `mode "in" ? "" : fmt(balance)` (réel).
- `depassement` : `r.direction === "out" ? fmt(max(0, depense − budgeted)) au mois courant, ou fmt(overspend maintenu) en projection` — en pratique `fmt(Math.max(0, r.cells[i].depense - r.cells[i].budgeted))` fonctionne pour courant ET futur (en futur `depense = budget + overspend`, donc la différence = overspend). `—` pour une entrée.
- `soldeReel` : `solde.rowRunning[r.id][i]` formaté.
- `soldePrevu` : `planned.prevuRowRunning[r.id][i]` formaté (peut être null → "").
- `soldeDepass` : `planned.depassRowRunning[r.id][i]` formaté (peut être null → "").

Pour les **sous-totaux de section** et le **grand total**, mêmes colonnes, en
utilisant `sec.totals[i]` / `grand[i]` pour budg/dep/recu/reste, `solde.closings` (grand)
ou l'accumulation de section pour soldeReel, `planned.prevuClosings/depassClosings` pour
les soldes prévu/dépass. (au grand total), et pour la ligne « Total rémunérations » la
même logique que Task 5 (budget principal-only). Pour `depassement` au total : somme des
dépassements des lignes de dépense.

Ligne **« Argent de départ »** : n'a qu'un solde (colonne Solde). Sous le nouveau
modèle, elle remplit la (ou les) colonne(s) de solde du type de mois : au courant,
`openings[i]` sous Solde réel / Solde prévu / Solde si dépass. (l'ouverture est commune
aux trois chaînes) ; en projection, `planned` n'a pas d'« ouverture de ligne » — afficher
l'argent de départ sous Solde prévu et Solde si dépass. via `openings`-équivalents
(l'ouverture prévue du mois = clôture prévue du mois précédent). Simplest : réutiliser
`solde.openings[i]` pour Solde réel (courant/passé) et, pour les colonnes prévu/dépass.,
l'ouverture de la chaîne = `i === ci ? solde.openings[ci] : planned.prevuClosings[i-1]`
(resp. depass). Détailler à l'implémentation ; garder la cohérence « ouverture = clôture
du mois précédent ».

Lignes du bas **« Estimé fin de mois »** et **« Dépassement »** : conservées. Elles
n'occupent que la colonne Solde (resp. Reste) aujourd'hui ; les faire tomber dans la
colonne de solde correspondante du type de mois (au minimum : Estimé sous « Solde prévu »
en projection / « Solde réel » ailleurs ; Dépassement sous la colonne « Dépassement »
quand elle existe, sinon sous Reste). Conserver leurs valeurs actuelles
(`forecast.currentEstimate` / `solde.closings` / `monthlyOverspend`).

Détail cliquable / surbrillance (side panel) : les colonnes existantes du réel
(budg/dep/recu/reste/soldeReel) gardent leur comportement cliquable actuel ; les
**nouvelles** colonnes (revenus, depassement, soldePrevu, soldeDepass) restent en
**affichage simple non cliquable** dans cette itération (extension possible plus tard).

**En-tête :** le `colSpan` de chaque en-tête de mois = nombre de colonnes de son type
(5 / 8 / 5). Le sous-en-tête rend un `TableHead` par colonne du type, avec l'étiquette
correspondante et `border-l` sur la première colonne du mois.

- [ ] **Step 1 : Câbler le calcul dans la page**

Dans `src/app/historique/page.tsx`, après `const solde = computeSolde(...)` (vers la
ligne 89), ajouter :

```ts
const planned = computePlannedSoldes(sections, months, currentMonth, solde.openings);
```

Importer `computePlannedSoldes` depuis `../../lib/history`, et passer `planned` à
`<HistoryWithDetail ... planned={planned} />`. Propager la prop dans
`src/components/history-with-detail.tsx` jusqu'à `<HistoryGrid ... planned={planned} />`
(ajouter `planned: PlannedSoldes` aux props des deux composants ; importer le type).

- [ ] **Step 2 : Introduire le modèle de colonnes + l'en-tête**

Dans `src/components/history-grid.tsx` :
- Ajouter un type de colonne et une fonction `monthColumns(type): ColKey[]` (listes
  ci-dessus) et une table d'étiquettes.
- Réécrire l'en-tête (les deux `TableRow` de `TableHeader`) pour rendre, par mois, un
  en-tête de `colSpan = monthColumns(type).length` puis un sous-en-tête d'un `TableHead`
  par colonne (étiquette + `border-l` sur la première).
- Déterminer le type de mois par comparaison `m` vs `currentMonth` (helper local).

- [ ] **Step 3 : Rendu piloté par colonnes (lignes, sous-totaux, grand total)**

Remplacer `AmountCells` / `SectionTotalsCells` / `GrandTotalsCells` par un rendu qui,
pour chaque mois, itère `monthColumns(type)` et rend une cellule par colonne selon les
fonctions de valeur ci-dessus (bloc « Contexte de conception »). Conserver le rendu
cliquable + `data-cellkey` pour les colonnes réelles existantes (budg/dep/recu/reste/
soldeReel) ; les nouvelles colonnes sont des `TableCell` simples (droite, tabular-nums,
rouge si négatif pour un solde). Garder `TxnCells` (transactions) aligné sur le nombre de
colonnes du mois (les transactions n'ont qu'un montant, dans la colonne dep/recu du mois
si le mois est de type past/current ; en projection, la ligne de transaction reste vide).

- [ ] **Step 4 : Ligne d'ouverture + lignes du bas**

Adapter la ligne « Argent de départ », « Solde actuel » (grand total), « Estimé fin de
mois » et « Dépassement » au modèle de colonnes (cf. « Contexte de conception »). Les
lignes du bas restent affichées avec leurs valeurs actuelles.

- [ ] **Step 5 : Vérifier tsc + build + navigateur**

Run: `npx tsc --noEmit && npm run build`
Expected: vert.
Vérification (dev, onglet Historique) :
- Mois passés : inchangés.
- Mois courant : 8 colonnes ; Solde réel = solde banque ; Solde prévu = départ + revenus − budget ; Solde si dépass. = prévu − dépassement.
- Mois de projection : plus de Dép/Reçu ; colonnes Budget/Revenus/Dépassement/Solde prévu/Solde si dépass. cohérentes ; le Solde prévu ≥ Solde si dépass. quand il y a dépassement.
- Lignes du bas « Estimé fin de mois » et « Dépassement » toujours présentes.

- [ ] **Step 6 : Commit**

```bash
git add src/components/history-grid.tsx src/app/historique/page.tsx src/components/history-with-detail.tsx
git commit -m "feat(historique): colonnes de projection prévu/réel/dépassement par type de mois"
```

---

## Notes d'exécution

- Ordre : Task 1 (lib, testée) puis Task 2 (affichage).
- La Task 2 est un remaniement cohérent et couplé du rendu de `history-grid.tsx` : elle
  se vérifie surtout par tsc/build + contrôle navigateur (peu de tests unitaires
  d'affichage). Elle convient à une exécution soignée d'un seul tenant.
- Aucune migration / aucun changement de base.
