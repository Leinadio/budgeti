# Historique : détail du calcul en sidebar — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer le popover de détail par une sidebar non-modale à droite qui montre, au clic sur un montant, le calcul complet sous forme arithmétique (opérateurs +/−, total), avec composants dépliables jusqu'aux transactions.

**Architecture:** Un modèle d'arbre pur testé (`DetailNode`/`CellDetail`) dans `history-explain.ts`. Un composant `history-detail-sidebar.tsx` (panneau fixe non-modal, calcul dépliable). Dans `history-grid.tsx`, un état « montant sélectionné » ; chaque cellule cliquable construit un `CellDetail` et appelle `onSelect`.

**Tech Stack:** TypeScript, React (Next.js), Vitest.

## Global Constraints

- Textes en français, sans emoji.
- Le total en bas de la sidebar égale toujours le montant de la cellule cliquée ; le total d'un sous-calcul égale la valeur du composant déplié.
- Montants signés : `Σ nodes.amount === result`. Le signe pilote l'opérateur (+ / −) ; on affiche la valeur absolue via le helper `fmt`.
- Sidebar NON-modale : `position: fixed` à droite, pas d'overlay, pas de fermeture au clic extérieur (seulement ×). Le tableau derrière reste cliquable.
- Pas de sidebar sur : cellules vides, « — », montants de transactions individuelles.
- Ne pas modifier les calculs (`computeHistory`, `computeSolde`, forecast). `popover.tsx` reste dans le repo (inutilisé ici).

---

### Task 1: Modèle d'arbre `history-explain.ts` (remplace le modèle plat)

**Files:**
- Modify (réécrit): `src/lib/history-explain.ts`
- Modify (réécrit): `tests/lib/history-explain.test.ts`

**Interfaces:**
- Produces :
  ```ts
  export type DetailNode = { label: string; amount: number; children?: DetailNode[] };
  export type CellDetail = { title: string; subtitle?: string; nodes: DetailNode[]; result: number; note?: string };
  export function sumOf(nodes: DetailNode[]): number;
  export function makeDetail(title: string, nodes: DetailNode[], opts?: { subtitle?: string; note?: string; result?: number }): CellDetail;
  export function txnNode(date: string, label: string, signedAmount: number): DetailNode;
  ```

- [ ] **Step 1: Réécrire les tests (échec attendu)**

Remplacer tout le contenu de `tests/lib/history-explain.test.ts` par :

```ts
import { expect, test } from "vitest";
import { sumOf, makeDetail, txnNode, type DetailNode } from "../../src/lib/history-explain";

test("sumOf additionne les montants signés", () => {
  const nodes: DetailNode[] = [
    { label: "Budget", amount: 150.95 },
    { label: "Dépensé", amount: -114.82 },
  ];
  expect(sumOf(nodes)).toBeCloseTo(36.13, 2);
});

test("makeDetail: result = somme des nodes par défaut", () => {
  const d = makeDetail("Reste", [
    { label: "Budget", amount: 150.95 },
    { label: "Dépensé", amount: -114.82 },
  ]);
  expect(d.title).toBe("Reste");
  expect(d.result).toBeCloseTo(36.13, 2);
});

test("makeDetail: result explicite quand fourni (montant affiché forcé)", () => {
  const d = makeDetail("Argent de départ", [{ label: "x", amount: 1 }], { result: -121.88, subtitle: "Juillet" });
  expect(d.result).toBe(-121.88);
  expect(d.subtitle).toBe("Juillet");
});

test("un nœud dépliable : ses enfants totalisent la valeur du nœud", () => {
  const depense: DetailNode = {
    label: "Dépensé",
    amount: -114.82,
    children: [
      txnNode("2026-07-13", "AVANSSUR", -81.84),
      txnNode("2026-07-09", "ORANGE", -30.99),
      txnNode("2026-07-07", "PAYPAL", -1.99),
    ],
  };
  expect(sumOf(depense.children!)).toBeCloseTo(-114.82, 2);
});

test("txnNode: libellé date · label et montant signé", () => {
  const n = txnNode("2026-07-13", "AVANSSUR", -81.84);
  expect(n.label).toBe("2026-07-13 · AVANSSUR");
  expect(n.amount).toBe(-81.84);
  expect(n.children).toBeUndefined();
});
```

- [ ] **Step 2: Lancer les tests (échec attendu)**

Run: `npx vitest run tests/lib/history-explain.test.ts`
Expected: FAIL (nouvelles exports absentes).

- [ ] **Step 3: Réécrire le module**

Remplacer tout le contenu de `src/lib/history-explain.ts` par :

```ts
// Détail d'un calcul affiché dans la sidebar de l'Historique, sous forme d'arbre :
// des nœuds signés (Σ = result) dont certains sont dépliables (children), jusqu'aux
// transactions. Le signe pilote l'opérateur affiché (+ / −).
export type DetailNode = { label: string; amount: number; children?: DetailNode[] };
export type CellDetail = { title: string; subtitle?: string; nodes: DetailNode[]; result: number; note?: string };

export function sumOf(nodes: DetailNode[]): number {
  return nodes.reduce((s, n) => s + n.amount, 0);
}

export function makeDetail(
  title: string,
  nodes: DetailNode[],
  opts?: { subtitle?: string; note?: string; result?: number },
): CellDetail {
  return {
    title,
    subtitle: opts?.subtitle,
    nodes,
    result: opts?.result ?? sumOf(nodes),
    note: opts?.note,
  };
}

// Feuille = une transaction : « date · libellé », montant signé.
export function txnNode(date: string, label: string, signedAmount: number): DetailNode {
  return { label: `${date} · ${label}`, amount: signedAmount };
}
```

- [ ] **Step 4: Lancer les tests (succès attendu)**

Run: `npx vitest run tests/lib/history-explain.test.ts`
Expected: PASS.

- [ ] **Step 5: Typage + suite complète**

Run: `npx tsc --noEmit && npm test`
Expected: `tsc` échoue UNIQUEMENT dans `history-grid.tsx` (usages de l'ancien modèle) — c'est attendu, Task 3 le corrige. La suite `history-explain.test.ts` passe. Si `npm test` échoue seulement à cause de `history-grid.tsx` non compilé, c'est normal à ce stade.

Note pour l'implémenteur : cette task laisse volontairement `history-grid.tsx` cassé (il référence l'ancien modèle). Ne pas tenter de le réparer ici. Committer quand même le module + tests (les tests lib passent ; le build global est réparé en Task 3). Si le pré-commit refuse à cause de tsc, committer avec `--no-verify` n'est pas nécessaire ici car il n'y a pas de hook ; sinon signaler.

- [ ] **Step 6: Commit**

```bash
git add src/lib/history-explain.ts tests/lib/history-explain.test.ts
git commit -m "feat(history): modèle d'arbre CellDetail/DetailNode pour le détail en sidebar"
```

---

### Task 2: Composant `history-detail-sidebar.tsx`

**Files:**
- Create: `src/components/history-detail-sidebar.tsx`

**Interfaces:**
- Consumes : `CellDetail`, `DetailNode` (Task 1).
- Produces : `HistoryDetailSidebar` (props `{ detail: CellDetail | null; onClose: () => void }`).

- [ ] **Step 1: Créer le composant**

Créer `src/components/history-detail-sidebar.tsx` :

```tsx
"use client";
import { useState } from "react";
import { X, ChevronRight, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CellDetail, DetailNode } from "@/lib/history-explain";

const NUM = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtAbs = (n: number) => NUM.format(Math.abs(n) < 0.005 ? 0 : Math.abs(n)).replace(/[  ]/g, " ");
const fmtSigned = (n: number) => NUM.format(Math.abs(n) < 0.005 ? 0 : n).replace(/[  ]/g, " ");
const opOf = (n: number) => (n < 0 ? "−" : "+");

// Une ligne de nœud : opérateur, montant (valeur absolue), libellé ; dépliable si children.
function NodeRow({ node, path, depth }: { node: DetailNode; path: string; depth: number }) {
  const [open, setOpen] = useState(false);
  const hasChildren = !!node.children && node.children.length > 0;
  return (
    <>
      <div
        className={cn("flex items-center gap-2 py-1 text-sm", hasChildren && "cursor-pointer")}
        style={{ paddingLeft: `${depth * 1.25}rem` }}
        onClick={hasChildren ? () => setOpen((o) => !o) : undefined}
      >
        <span className="w-3 shrink-0 text-muted-foreground">
          {hasChildren ? (open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />) : null}
        </span>
        <span className="w-4 shrink-0 text-center tabular-nums text-muted-foreground">{opOf(node.amount)}</span>
        <span className={cn("w-24 shrink-0 text-right tabular-nums", node.amount < 0 && "text-red-600")}>{fmtAbs(node.amount)}</span>
        <span className="min-w-0 flex-1 truncate">{node.label}</span>
      </div>
      {hasChildren && open && node.children!.map((c, i) => (
        <NodeRow key={`${path}.${i}`} node={c} path={`${path}.${i}`} depth={depth + 1} />
      ))}
    </>
  );
}

export function HistoryDetailSidebar({ detail, onClose }: { detail: CellDetail | null; onClose: () => void }) {
  if (!detail) return null;
  return (
    <aside className="bg-background fixed top-0 right-0 z-40 flex h-screen w-[400px] max-w-[90vw] flex-col border-l shadow-xl">
      <div className="flex items-start justify-between gap-2 border-b p-4">
        <div className="min-w-0">
          <h2 className="font-semibold">{detail.title}</h2>
          {detail.subtitle && <p className="text-muted-foreground text-sm">{detail.subtitle}</p>}
          <p className={cn("mt-1 text-lg font-semibold tabular-nums", detail.result < 0 && "text-red-600")}>{fmtSigned(detail.result)}</p>
        </div>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground shrink-0 rounded p-1" aria-label="Fermer">
          <X className="size-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {detail.nodes.map((n, i) => (
          <NodeRow key={i} node={n} path={`${i}`} depth={0} />
        ))}
        <div className="mt-2 flex items-center gap-2 border-t pt-2 text-sm font-semibold">
          <span className="w-3 shrink-0" />
          <span className="w-4 shrink-0 text-center">=</span>
          <span className={cn("w-24 shrink-0 text-right tabular-nums", detail.result < 0 && "text-red-600")}>{fmtAbs(detail.result)}</span>
          <span className="min-w-0 flex-1 truncate">Total</span>
        </div>
        {detail.note && <p className="text-muted-foreground mt-3 text-xs">{detail.note}</p>}
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Typage**

Run: `npx tsc --noEmit`
Expected: pas de nouvelle erreur dans ce fichier (les erreurs restantes dans `history-grid.tsx` de Task 1 sont attendues jusqu'à Task 3).

- [ ] **Step 3: Commit**

```bash
git add src/components/history-detail-sidebar.tsx
git commit -m "feat(historique): sidebar de détail (calcul dépliable, non-modale)"
```

---

### Task 3: `history-grid.tsx` — sélection + sidebar + cellules du corps

**Files:**
- Modify: `src/components/history-grid.tsx`

**Interfaces:**
- Consumes : `CellDetail`, `DetailNode`, `makeDetail`, `txnNode`, `sumOf` (Task 1) ; `HistoryDetailSidebar` (Task 2).

- [ ] **Step 1: Imports et retrait du popover**

Dans `src/components/history-grid.tsx` :
- Supprimer l'import de `@/components/ui/popover` et l'import depuis `@/lib/history-explain` de l'ancien modèle.
- Ajouter :
  ```tsx
  import { HistoryDetailSidebar } from "@/components/history-detail-sidebar";
  import { type CellDetail, type DetailNode, makeDetail, txnNode } from "@/lib/history-explain";
  ```
- Supprimer les composants `ExplanationContent` et l'ancien `CellAmount` (basé sur Popover) — remplacés à l'étape 2.

- [ ] **Step 2: Nouveau `CellAmount` (clic → sélection, sans popover)**

Le composant a besoin d'un callback de sélection. On l'injecte via un contexte léger de module (variable de closure passée en prop) : le plus simple est de faire de `CellAmount` un composant qui reçoit `detail` et `onSelect`. Remplacer `CellAmount` par :

```tsx
function CellAmount({ children, className, detail, onSelect, selected }: {
  children: React.ReactNode;
  className?: string;
  detail?: CellDetail | null;
  onSelect?: (d: CellDetail) => void;
  selected?: boolean;
}) {
  if (!detail || !onSelect) return <TableCell className={className}>{children}</TableCell>;
  return (
    <TableCell className={cn(className, selected && "bg-muted ring-primary/40 ring-1 ring-inset")}>
      <button
        type="button"
        onClick={() => onSelect(detail)}
        className="cursor-pointer decoration-dotted underline-offset-2 hover:underline"
      >
        {children}
      </button>
    </TableCell>
  );
}
```

Note : la sélection visuelle (`selected`) peut rester simple (surlignage de la cellule). Si suivre la cellule exacte est trop coûteux, se limiter à ne rien surligner et ne passer que `detail`/`onSelect`. L'implémenteur choisit ; l'essentiel est le clic → `onSelect(detail)`.

- [ ] **Step 3: État de sélection + rendu de la sidebar**

Dans `HistoryGrid`, ajouter l'état et le rendu. Comme `HistoryGrid` retourne un `<Table>`, envelopper le retour dans un fragment :

```tsx
  const [selected, setSelected] = useState<CellDetail | null>(null);
  const onSelect = (d: CellDetail) => setSelected(d);
```

et à la fin :

```tsx
  return (
    <>
      <Table>
        {/* … contenu existant … */}
      </Table>
      <HistoryDetailSidebar detail={selected} onClose={() => setSelected(null)} />
    </>
  );
```

- [ ] **Step 4: Helper de nœuds de transactions**

Ajouter dans `HistoryGrid` (avant `renderGroup`) :

```tsx
  // Transactions d'un groupe (et de ses lignes) pour un mois → nœuds feuilles signés.
  // sign = +1 pour un contexte « addition » (ex. colonne Dépensé/Reçu prise positivement),
  //        -1 pour un contexte « soustraction » (ex. sous-nœud Dépensé d'un Reste).
  const txnChildren = (r: HistoryRow, month: string, sign: 1 | -1): DetailNode[] | undefined => {
    const all = [...r.txns, ...r.subRows.flatMap((s) => s.txns)].filter((t) => t.month === month);
    if (all.length === 0) return undefined;
    return all.map((t) => txnNode(t.date, t.label, sign * Math.abs(t.amount)));
  };
```

- [ ] **Step 5: `AmountCells` construit des `CellDetail`**

Réécrire la signature et le corps de `AmountCells` pour produire, par cellule, un `CellDetail` (ou `null`) et le passer à `CellAmount`. La logique par colonne (mois `i`, `month = months[i]`, cellule `c`) :

- **Budget** (`mode !== "in"`, `c.budgeted !== 0`, groupe récurrent avec postes) :
  `makeDetail("Budget", budgetNodes(i), { subtitle, result: c.budgeted })` où `budgetNodes` = les postes `{ label: sub.name, amount: sub.cells[i].budgeted }`. Sinon `null`.
- **Dépensé** (`mode !== "in"`, `c.depense !== 0`, transactions dispo) :
  `makeDetail("Dépensé", txnChildrenAsNodes(+1), { subtitle, result: c.depense })`. Les nœuds sont les transactions elles-mêmes (pas un nœud parent) : `txnChildren(r, month, +1)` (feuilles positives sommant à `c.depense`). Sinon `null`.
- **Reçu** : symétrique, `result: c.recu`, `txnChildren(r, month, +1)`.
- **Reste** (`mode !== "in"` et `|budgeted − depense − balance| < 0.005`) :
  `makeDetail("Reste", [ { label: "Budget", amount: c.budgeted }, { label: "Dépensé", amount: -c.depense, children: txnChildren(r, month, -1) } ], { subtitle, result: c.balance })`.
- **Solde** (colonne de droite, `s = solde?.[i]` non nul) : `net = c.recu − c.depense` ;
  `makeDetail("Solde", [ { label: "Solde précédent", amount: s - net }, { label: "Mouvement du mois", amount: net, children: txnChildren(r, month, net < 0 ? -1 : 1) } ], { subtitle, result: s })`.

`AmountCells` doit recevoir : `mode`, `cells`, `solde`, `onSelect`, `subtitleOf: (i) => string`, et des accès aux transactions/postes. Le plus simple : passer `rowForDetail?: HistoryRow` (la ligne de groupe) quand il s'agit d'une ligne de groupe, et pour les sous-totaux passer des constructeurs de nœuds dédiés (Task 4). Concrètement, remplacer les props `depEntries/recuEntries/budgetEntries` par :

```tsx
function AmountCells({ cells, mode, solde, onSelect, subtitleOf, detailRow }: {
  cells: MonthCell[];
  mode: "out" | "in" | "total";
  solde?: (number | null)[];
  onSelect?: (d: CellDetail) => void;
  subtitleOf?: (i: number) => string;
  detailRow?: HistoryRow;   // ligne de groupe : sert à lister transactions/postes
}) {
```

Chaque `CellAmount` reçoit `detail={...}` (le `CellDetail` construit ou `null`) et `onSelect={onSelect}`. Quand `detailRow` est absent (ex. certains sous-totaux gérés en Task 4), les colonnes Dépensé/Reçu/Budget passent `null` ici et sont fournies par des rendus dédiés en Task 4.

Construire les `CellDetail` avec les helpers ci-dessus. `subtitleOf(i)` fournit p.ex. `"Abonnements · " + monthLabel(months[i])` (passer `monthLabel` déjà importé).

- [ ] **Step 6: Brancher les lignes de groupe**

Dans `renderGroup`, remplacer l'appel `AmountCells` par :

```tsx
          <AmountCells
            cells={r.cells}
            mode={r.direction}
            solde={solde.rowRunning[r.id]}
            onSelect={onSelect}
            subtitleOf={(i) => `${r.name} · ${monthLabel(months[i])}`}
            detailRow={r}
          />
```

(Les sous-lignes `sub.cells` peuvent rester non cliquables pour cette task — passer sans `onSelect` — ou être branchées de la même façon avec `detailRow={sub}` adapté ; laisser non cliquable si `HistorySubRow` n'a pas la forme attendue par `txnChildren`.)

- [ ] **Step 7: Vérifier typage + build + tests**

Run: `npx tsc --noEmit && npm run build && npm test`
Expected: aucune erreur ; build OK ; suite verte (les tests lib d'explain passent).

- [ ] **Step 8: Vérification visuelle**

`npm run dev`, `/historique`, compte avec groupes. Cliquer un « Dépensé » de groupe → la sidebar s'ouvre à droite (non-modale), liste les transactions comme un calcul (+ … + … = total). Cliquer un « Reste » → Budget + (−Dépensé) dépliable = Reste. Cliquer un autre montant → la sidebar se met à jour. × ferme. Le tableau derrière reste cliquable.

- [ ] **Step 9: Commit**

```bash
git add src/components/history-grid.tsx
git commit -m "feat(historique): clic sur un montant du corps ouvre le détail en sidebar (remplace le popover)"
```

---

### Task 4: Lignes de synthèse en sidebar (arbres complets)

**Files:**
- Modify: `src/components/history-grid.tsx`

**Interfaces:**
- Consumes : `makeDetail`, `txnNode`, `CellDetail`, `DetailNode` (Task 1).

Construire les `CellDetail` des lignes de synthèse, avec dépliage jusqu'aux transactions. Ajouter un helper qui transforme un groupe (HistoryRow) en nœud dépliable pour un mois et une colonne :

- [ ] **Step 1: Helper « groupe → nœud »**

```tsx
  // Un groupe comme nœud d'un calcul de section/total : montant = sa contribution
  // (signée), enfants = ses transactions du mois.
  const groupNode = (r: HistoryRow, i: number, kind: "depense" | "recu" | "budget" | "net"): DetailNode => {
    const c = r.cells[i];
    const amount = kind === "depense" ? c.depense : kind === "recu" ? c.recu : kind === "budget" ? c.budgeted : c.recu - c.depense;
    const sign: 1 | -1 = amount < 0 ? -1 : 1;
    return { label: r.name, amount, children: kind === "budget" ? undefined : txnChildren(r, months[i], sign) };
  };
```

- [ ] **Step 2: Sous-totaux de section cliquables**

Pour les en-têtes de section (récurrents, enveloppes, income) rendus via `AmountCells cells={sec.totals} mode="total"`, ces cellules n'ont pas de `detailRow` unique. Rendre leurs colonnes Dépensé/Reçu/Budget cliquables en construisant un `CellDetail` = liste des groupes de la section (`groupNode`), résultat = `sec.totals[i].depense/recu/budgeted`.

Le plus propre : rendre ces lignes de sous-total avec un rendu dédié (pas via `AmountCells`), 5 cellules par mois :
- Budg. : `makeDetail("Budget", sec.rows.map((r) => groupNode(r, i, "budget")), { subtitle, result: c.budgeted })` si `c.budgeted !== 0`.
- Dép. : `makeDetail("Dépensé", sec.rows.map((r) => groupNode(r, i, "depense")), { result: c.depense })` si `c.depense !== 0`.
- Reçu : symétrique.
- Reste : `makeDetail("Reste", [ { label: "Budget", amount: c.budgeted }, { label: "Dépensé", amount: -c.depense, children: sec.rows.map((r) => groupNode(r, i, "depense")).map(negateNode) } ], { result: c.balance })` uniquement si `|budgeted−depense−balance| < 0.005`.
- Solde : vide (comme aujourd'hui).

où `negateNode(n) = { ...n, amount: -n.amount, children: n.children?.map(negateNode) }` (helper local, pour que le sous-nœud Dépensé soit négatif). Si cela alourdit trop, se limiter à rendre le Reste de section non cliquable (déjà acceptable). Documenter le choix.

- [ ] **Step 3: Ligne « Solde actuel »**

Rendu dédié (5 cellules/mois). Colonne Solde :
```tsx
makeDetail("Solde actuel", [
  { label: "Argent de départ", amount: solde.openings[i] },
  ...sections.map((sec) => ({
    label: labelOfSection(sec.kind),
    amount: sec.totals[i].recu - sec.totals[i].depense,
    children: sec.kind === "uncategorized"
      ? uncatTxnNodes(sec, i)
      : sec.rows.map((r) => groupNode(r, i, "net")),
  })),
], { subtitle: monthLabel(months[i]), result: solde.closings[i] })
```
Colonnes Dép./Reçu : liste des sections (`{ label: labelOfSection(sec.kind), amount: sec.totals[i].depense|recu, children: … }`), result = `grand[i].depense|recu`. Colonne Budg. : liste des sections (budget). Colonne Reste : `resteDetail` sur le grand total, seulement si `|budgeted−depense−balance|<0.005` (souvent faux → non cliquable, OK).

Helpers : `labelOfSection` (`income→"Rémunérations"`, `recurring→"Récurrents"`, `envelope→"Enveloppes"`, `uncategorized→"Non catégorisés"`) ; `uncatTxnNodes(sec, i)` = `sec.txns` du mois `months[i]` → `txnNode(t.date, t.label, t.amount)` (montant signé tel quel).

- [ ] **Step 4: « Argent de départ »**

Colonne Solde de la ligne « Argent de départ » :
```tsx
i === 0
  ? makeDetail("Argent de départ", [
      { label: "Solde du compte (banque)", amount: forecast.balance },
      { label: "Mouvements de la période (rembobinés)", amount: solde.openings[0] - forecast.balance },
    ], { subtitle: monthLabel(months[0]), result: solde.openings[0], note: "Reconstitué en rembobinant les mouvements depuis le solde réel de la banque." })
  : makeDetail("Argent de départ", [
      { label: "Solde de fin du mois précédent", amount: solde.closings[i - 1] },
    ], { subtitle: monthLabel(months[i]), result: solde.openings[i] })
```

- [ ] **Step 5: « Estimé fin de mois » et « Dépassement »**

- Estimé (mois courant) :
  ```tsx
  makeDetail("Estimé fin de mois", [
    { label: "Solde actuel", amount: forecast.balance },
    ...forecast.currentSteps.map((s) => ({ label: s.label, amount: s.amount })),
  ], { subtitle: monthLabel(m), result: forecast.currentEstimate })
  ```
  Estimé (autres mois) : même détail que « Solde actuel » du mois (réutiliser le constructeur de Solde actuel, result = `solde.closings[i]`).
- Dépassement (colonne Reste, si `overspend[i] > 0`) :
  ```tsx
  makeDetail("Dépassement", sections.flatMap((s) => s.rows)
    .filter((r) => r.direction === "out" && r.cells[i].balance < 0)
    .map((r) => ({ label: r.name, amount: -r.cells[i].balance })),
    { subtitle: monthLabel(months[i]), result: overspend[i] })
  ```

- [ ] **Step 6: Vérifier typage + build + tests**

Run: `npx tsc --noEmit && npm run build && npm test`
Expected: aucune erreur ; build OK ; suite verte.

- [ ] **Step 7: Vérification visuelle**

`/historique` : cliquer « Solde actuel » → Argent de départ + sections (dépliables → groupes → transactions), total = solde banque. Cliquer « Estimé fin de mois » (mois courant → étapes du Prévisionnel ; mois futur → détail projeté). Cliquer un sous-total de section → groupes dépliables. « Argent de départ », « Dépassement ». Chaque total de sidebar = la cellule ; chaque sous-calcul déplié totalise la valeur de son nœud.

- [ ] **Step 8: Commit**

```bash
git add src/components/history-grid.tsx
git commit -m "feat(historique): détail en sidebar sur les lignes de synthèse (arbres jusqu'aux transactions)"
```

---

## Self-Review

- **Couverture du spec** : modèle arbre (Task 1) ; sidebar non-modale + calcul dépliable + × (Task 2) ; retrait popover + clic→sidebar + cellules du corps avec transactions (Task 3) ; lignes de synthèse dépliables jusqu'aux transactions (Task 4) ; opérateurs +/− et total (Task 2 `NodeRow`/footer). Cellules vides/« — »/transactions non cliquables (guards conservés).
- **Placeholders** : code fourni pour le modèle, la sidebar, `CellAmount`, `txnChildren`, `groupNode`, et chaque constructeur de `CellDetail`. Les répétitions par colonne suivent le même patron.
- **Cohérence des types** : `DetailNode`/`CellDetail` (Task 1) consommés en Task 2/3/4 ; `makeDetail(title, nodes, opts)` et `txnNode(date, label, amount)` mêmes signatures partout ; invariant `result === Σ nodes.amount` sauf `result` explicite (montant affiché forcé, toujours égal à la cellule par construction).
