# Shell à sidebar + Transactions par mois — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Passer l'app en pleine largeur avec une sidebar gauche (Réglages), et afficher la page Transactions sans card, groupée par compte puis par mois.

**Architecture:** Deux helpers purs (formatage du mois, regroupement par mois) ; un shell global dans layout.tsx (nav en haut sans Réglages + sidebar Réglages + contenu pleine largeur) ; réécriture de l'affichage de la page Transactions.

**Tech Stack:** Next.js (App Router, TypeScript, React), Vitest, shadcn/ui.

## Global Constraints

- App locale mono-utilisateur. Français sans emoji ni symbole décoratif.
- Contenu pleine largeur pour toutes les pages (plus de `max-w-3xl` centré).
- Barre de nav du haut : Tableau de bord, Transactions, Prévisionnel, Groupes (sans Réglages). Réglages dans la sidebar gauche.
- Transactions : plus de `Card` ; par compte puis par mois, ordre décroissant, colonnes conservées (Date, Libellé, Groupe, Appartenance, Montant).
- Composant `Table` de shadcn : pas de `TableFooter`.
- Vérification finale en lançant le vrai serveur (les DB `:memory:` ne voient pas certains bugs runtime — cf. CLAUDE.md).

---

### Task 1: Helpers de regroupement par mois

**Files:**
- Create: `src/lib/transactions-view.ts`
- Test: `tests/lib/transactions-view.test.ts`

**Interfaces:**
- Produces:
  - `monthLabel(ym: string): string` — "2026-07" -> "Juillet 2026".
  - `groupByMonth<T extends { date: string }>(items: T[]): { month: string; label: string; items: T[] }[]`.

- [ ] **Step 1: Écrire les tests (rouge)**

Créer `tests/lib/transactions-view.test.ts` :

```ts
import { expect, test } from "vitest";
import { monthLabel, groupByMonth } from "../../src/lib/transactions-view";

test("monthLabel formats the French month with a capital initial", () => {
  expect(monthLabel("2026-07")).toBe("Juillet 2026");
  expect(monthLabel("2026-01")).toBe("Janvier 2026");
});

test("groupByMonth groups by month, first-seen order, items order preserved", () => {
  const txns = [
    { id: "a", date: "2026-07-03" },
    { id: "b", date: "2026-07-01" },
    { id: "c", date: "2026-06-30" },
    { id: "d", date: "2026-06-25" },
  ];
  const g = groupByMonth(txns);
  expect(g.map((x) => x.month)).toEqual(["2026-07", "2026-06"]);
  expect(g.map((x) => x.label)).toEqual(["Juillet 2026", "Juin 2026"]);
  expect(g[0].items.map((x) => x.id)).toEqual(["a", "b"]);
  expect(g[1].items.map((x) => x.id)).toEqual(["c", "d"]);
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run tests/lib/transactions-view.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter**

Créer `src/lib/transactions-view.ts` :

```ts
export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const s = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(
    new Date(y, m - 1, 1),
  );
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function groupByMonth<T extends { date: string }>(
  items: T[],
): { month: string; label: string; items: T[] }[] {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const key = it.date.slice(0, 7);
    const arr = map.get(key);
    if (arr) arr.push(it);
    else map.set(key, [it]);
  }
  return [...map.entries()].map(([month, monthItems]) => ({
    month,
    label: monthLabel(month),
    items: monthItems,
  }));
}
```

- [ ] **Step 4: Vérifier le succès**

Run: `npx vitest run tests/lib/transactions-view.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/transactions-view.ts tests/lib/transactions-view.test.ts
git commit -m "feat: helpers monthLabel + groupByMonth"
```

---

### Task 2: Shell à sidebar (layout global)

**Files:**
- Modify: `src/app/layout.tsx` (réécriture)

**Interfaces:**
- Consumes: rien. Produit le shell (nav haut + sidebar Réglages + contenu pleine largeur).

- [ ] **Step 1: Réécrire le layout**

Remplacer `src/app/layout.tsx` par :

```tsx
import "./globals.css";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Budget CIC" };

const NAV = [
  { href: "/", label: "Tableau de bord" },
  { href: "/transactions", label: "Transactions" },
  { href: "/previsionnel", label: "Prévisionnel" },
  { href: "/groupes", label: "Groupes" },
];

const themeScript =
  "document.documentElement.classList.toggle('dark', window.matchMedia('(prefers-color-scheme: dark)').matches)";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <nav className="flex flex-wrap gap-1 border-b bg-card px-4 py-2">
          {NAV.map((n) => (
            <Button key={n.href} asChild variant="ghost" size="sm">
              <Link href={n.href}>{n.label}</Link>
            </Button>
          ))}
        </nav>
        <div className="flex">
          <aside className="w-48 shrink-0 border-r p-3">
            <Button asChild variant="ghost" size="sm">
              <Link href="/settings">Réglages</Link>
            </Button>
          </aside>
          <main className="flex-1 px-6 py-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 3: Commit**

```bash
git add src/app/layout.tsx
git commit -m "feat: shell à sidebar (Réglages) + contenu pleine largeur"
```

---

### Task 3: Page Transactions par compte puis par mois

**Files:**
- Modify: `src/app/transactions/page.tsx` (réécriture de l'affichage)

**Interfaces:**
- Consumes: `groupByMonth` (Task 1) ; `listTransactions`/`TxnView`, `listGroups`, `resolveOwnership`/`OwnableGroup`, `formatEur`, `setGroup`, `GroupSelectField` (existants).

- [ ] **Step 1: Réécrire la page**

Remplacer `src/app/transactions/page.tsx` par :

```tsx
import { db } from "../../db/index";
import { listTransactions, type TxnView } from "../../db/repositories/transactions";
import { listGroups } from "../../db/repositories/groups";
import { resolveOwnership, type OwnableGroup } from "../../lib/ownership";
import { formatEur } from "../../lib/money";
import { groupByMonth } from "../../lib/transactions-view";
import { setGroup } from "./actions";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { GroupSelectField } from "@/components/group-select-field";

export const dynamic = "force-dynamic";

export default function TransactionsPage() {
  const database = db();
  const txns = listTransactions(database);
  const groups = listGroups(database);
  const ownable: OwnableGroup[] = groups.map((g) => ({
    id: g.id, accountId: g.accountId, direction: g.direction, kind: g.kind,
    keywords: g.kind === "envelope" ? g.keywords : g.lines.map((l) => l.keyword),
  }));
  const groupName = (id: number) => groups.find((g) => g.id === id)?.name ?? "?";

  const statusLabel = (t: TxnView): string => {
    const res = resolveOwnership(
      { id: t.id, date: t.date, amount: t.amount, label: t.label, accountId: t.accountId, groupId: t.groupId },
      ownable,
    );
    if (res.status === "manual") return `${groupName(res.groupId)} (manuel)`;
    if (res.status === "auto") return `${groupName(res.groupId)} (auto)`;
    if (res.status === "ambiguous") return "à répartir";
    return "non budgétée";
  };

  const groupsOfAccount = (accountId: string) =>
    groups.filter((g) => g.accountId === accountId).map((g) => ({ id: g.id, name: g.name }));

  const byAccount = new Map<string, { label: string; items: TxnView[] }>();
  for (const t of txns) {
    const g = byAccount.get(t.accountId) ?? { label: t.accountLabel ?? "Compte", items: [] };
    g.items.push(t);
    byAccount.set(t.accountId, g);
  }

  return (
    <div className="flex flex-col gap-8">
      {byAccount.size === 0 && (
        <p className="text-muted-foreground text-sm">
          Aucune transaction. Va dans Réglages pour synchroniser.
        </p>
      )}
      {[...byAccount.entries()].map(([accountId, group]) => (
        <section key={accountId} className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">{group.label}</h2>
          {groupByMonth(group.items).map((m) => (
            <div key={m.month} className="flex flex-col gap-2">
              <h3 className="text-muted-foreground text-sm font-medium">{m.label}</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Libellé</TableHead>
                    <TableHead>Groupe</TableHead>
                    <TableHead>Appartenance</TableHead>
                    <TableHead className="text-right">Montant</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {m.items.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="text-muted-foreground">{t.date}</TableCell>
                      <TableCell>{t.label}</TableCell>
                      <TableCell>
                        <form action={setGroup}>
                          <input type="hidden" name="txnId" value={t.id} />
                          <GroupSelectField name="group" options={groupsOfAccount(t.accountId)} defaultValue={t.groupId} />
                        </form>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{statusLabel(t)}</TableCell>
                      <TableCell className="text-right font-medium">{formatEur(t.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Vérifier compilation et suite complète**

Run: `npx tsc --noEmit && npm test`
Expected: aucune erreur ; tous les tests passent.

- [ ] **Step 3: Commit**

```bash
git add src/app/transactions/page.tsx
git commit -m "feat: Transactions pleine largeur groupées par compte puis par mois"
```

---

## Vérification runtime finale (après Task 3)

Les DB `:memory:` ne voient pas certains bugs runtime (cf. CLAUDE.md). Lancer le vrai serveur :

- [ ] `npm run dev`, ouvrir n'importe quelle page : sidebar gauche avec le lien Réglages, nav du haut sans Réglages, contenu pleine largeur.
- [ ] Ouvrir `/transactions` : plus de card ; par compte un titre, puis des sections de mois (« Juillet 2026 », « Juin 2026 »...) avec leurs tables ; menu Groupe et colonne Appartenance fonctionnels.
- [ ] Le lien Réglages de la sidebar mène bien à `/settings`.
- [ ] Aucune erreur dans la console serveur.

## Self-review (auteur du plan)

- Couverture spec : helpers monthLabel + groupByMonth (Task 1), shell sidebar + pleine largeur (Task 2), Transactions par compte puis par mois (Task 3). Tous les points de la spec ont une tâche.
- Types cohérents : `groupByMonth` générique `{ date: string }` consommé avec `TxnView` (qui a `date`) ; retour `{ month, label, items }` utilisé tel quel dans la page.
- Pas de placeholder : chaque étape de code porte le code complet.
