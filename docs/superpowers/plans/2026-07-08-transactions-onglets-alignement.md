# Transactions : onglets par compte + colonnes alignées — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Afficher chaque compte dans un onglet (Tabs shadcn) sur la page Transactions, et aligner les colonnes entre les mois via un tableau unique par compte.

**Architecture:** Installer le composant Tabs de shadcn (CLI), puis réécrire l'affichage de la page Transactions : un `Tabs` avec un onglet par compte, et pour chaque compte un seul `Table` où le mois est une ligne-titre (colSpan) suivie des transactions.

**Tech Stack:** Next.js (App Router, TypeScript, React), shadcn/ui, Vitest.

## Global Constraints

- App locale mono-utilisateur. Français sans emoji ni symbole décoratif.
- `export const dynamic = "force-dynamic"` conservé sur la page Transactions.
- Logique conservée à l'identique : `ownable`, `statusLabel` (via `resolveOwnership`), `groupsOfAccount`, regroupement `byAccount`, câblage `setGroup` + `GroupSelectField`.
- Un seul tableau par compte (colonnes alignées) ; mois = ligne-titre `colSpan={5}`.
- Composant `Table` de shadcn : pas de `TableFooter`.
- Vérification finale en lançant le vrai serveur (les DB `:memory:` ne voient pas certains bugs runtime — cf. CLAUDE.md).

---

### Task 1: Installer le composant Tabs de shadcn

**Files:**
- Create (via CLI) : `src/components/ui/tabs.tsx`
- Modify (via CLI) : `package.json`, `package-lock.json` (dépendance radix tabs)

**Interfaces:**
- Produces : composant `@/components/ui/tabs` exportant `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`.

- [ ] **Step 1: Installer via la CLI shadcn**

`components.json` existe déjà (ajouté avec le Sidebar), donc l'ajout est non interactif :

```bash
npx shadcn@latest add tabs --yes
```

Résultat attendu : création de `src/components/ui/tabs.tsx`, éventuellement mise à jour de `package.json`/`package-lock.json`. La CLI peut réécrire des primitives déjà présentes ; ne pas accepter d'écrasement d'un composant existant utilisé (button, input) au point de retirer une variante — vérifier ensuite.

- [ ] **Step 2: Vérifier l'intégrité**

Run: `npx tsc --noEmit && npm test`
Expected: aucune erreur de type ; les 38 tests passent (l'ajout n'introduit pas de logique testée).

Vérifier aussi que `src/components/ui/tabs.tsx` exporte bien `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` :

```bash
grep -oE "export (function|const) [A-Za-z]+|^  Tabs[A-Za-z]*," src/components/ui/tabs.tsx | sort -u
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: installer le composant Tabs de shadcn"
```

---

### Task 2: Onglets par compte + tableau unique par compte

**Files:**
- Modify: `src/app/transactions/page.tsx` (réécriture de l'affichage)

**Interfaces:**
- Consumes: `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent` (Task 1) ; `groupByMonth`, `listTransactions`/`TxnView`, `listGroups`, `resolveOwnership`/`OwnableGroup`, `formatEur`, `setGroup`, `GroupSelectField` (existants) ; `Fragment` de React.

- [ ] **Step 1: Réécrire la page**

Remplacer `src/app/transactions/page.tsx` par :

```tsx
import { Fragment } from "react";
import { db } from "../../db/index";
import { listTransactions, type TxnView } from "../../db/repositories/transactions";
import { listGroups } from "../../db/repositories/groups";
import { resolveOwnership, type OwnableGroup } from "../../lib/ownership";
import { formatEur } from "../../lib/money";
import { groupByMonth } from "../../lib/transactions-view";
import { setGroup } from "./actions";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
  const accounts = [...byAccount.entries()];

  if (accounts.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Aucune transaction. Va dans Réglages pour synchroniser.
      </p>
    );
  }

  return (
    <Tabs defaultValue={accounts[0][0]}>
      <TabsList>
        {accounts.map(([accountId, group]) => (
          <TabsTrigger key={accountId} value={accountId}>
            {group.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {accounts.map(([accountId, group]) => (
        <TabsContent key={accountId} value={accountId}>
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
              {groupByMonth(group.items).map((m) => (
                <Fragment key={m.month}>
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={5} className="text-muted-foreground text-sm font-medium">
                      {m.label}
                    </TableCell>
                  </TableRow>
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
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </TabsContent>
      ))}
    </Tabs>
  );
}
```

- [ ] **Step 2: Vérifier compilation et suite complète**

Run: `npx tsc --noEmit && npm test`
Expected: aucune erreur ; les 38 tests passent.

- [ ] **Step 3: Commit**

```bash
git add src/app/transactions/page.tsx
git commit -m "feat: Transactions en onglets par compte, tableau unique par compte (colonnes alignées)"
```

---

## Vérification runtime finale (après Task 2)

Les DB `:memory:` ne voient pas certains bugs runtime (cf. CLAUDE.md). Lancer le vrai serveur :

- [ ] `npm run dev`, ouvrir `/transactions` : un onglet par compte ; le premier est actif. Cliquer un autre onglet affiche ses transactions.
- [ ] À l'intérieur d'un onglet, les colonnes (Date, Libellé, Groupe, Appartenance, Montant) sont alignées entre les mois ; chaque mois a sa ligne-titre.
- [ ] Le menu Groupe et la colonne Appartenance fonctionnent (rattacher une transaction met à jour l'appartenance).
- [ ] Aucune erreur dans la console serveur.

## Self-review (auteur du plan)

- Couverture spec : installation Tabs (Task 1), onglets par compte + tableau unique avec mois en ligne-titre (Task 2). Tous les points de la spec ont une tâche.
- Types cohérents : `accounts = [...byAccount.entries()]` ; `defaultValue={accounts[0][0]}` (accountId string) ; `Fragment key={m.month}` ; colonnes et câblage inchangés.
- Pas de placeholder : le code de la page est complet ; l'installation Tabs est une commande CLI déterministe (components.json présent).
