# Prévisionnel par compte et groupes de budget — Plan d'implémentation (étape 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter un prévisionnel par compte (solde estimé fin du mois courant et du mois suivant) alimenté par un modèle unifié « tout est un groupe ».

**Architecture:** Deux tables (`groups`, `group_lines`), une fonction pure `computeForecast` par compte, deux écrans (Groupes pour saisir, Prévisionnel pour lire). Les anciens écrans Récurrents/Budgets et leur code sont retirés. Non destructif côté données : les tables `budgets` et `recurring_payments` restent en place mais dormantes.

**Tech Stack:** Next.js (App Router, TypeScript, React), SQLite via better-sqlite3, Vitest, shadcn/ui.

## Global Constraints

- App locale, mono-utilisateur, SQLite `data/budget.db`. Les données bancaires ne quittent pas la machine.
- Réponses/copie d'interface en français, sans emoji ni symbole décoratif.
- `schema.sql` utilise `CREATE TABLE IF NOT EXISTS` ; ajouter des tables ne casse pas l'existant. `foreign_keys = ON` est déjà activé dans `getDb`.
- Toutes les requêtes SQL sont paramétrées. Rapprochement des transactions : `label.toLowerCase().includes(keyword.toLowerCase())`.
- Montants stockés positifs dans `group_lines` ; le signe se déduit de `direction` (`in` = +, `out` = -).
- Une ligne avec `day` non nul est un récurrent daté ; `day` nul est une enveloppe (toujours une sortie).
- Composant `Table` de shadcn : pas de `TableFooter` exporté ; toute ligne de total est une `TableRow` ordinaire dans `TableBody`.
- Vérification finale en lançant le vrai serveur (les DB `:memory:` ne voient pas certains bugs runtime — cf. CLAUDE.md).

---

## Ordre et découpage

1. Schéma `groups` + `group_lines`
2. Repository `groups`
3. Lib `forecast`
4. Écran Groupes (saisie) + nav
5. Écran Prévisionnel (lecture) + nav
6. Tableau de bord épuré
7. Nettoyage des anciens écrans et du code mort

Les tâches 1 à 5 sont additives : l'app compile et tourne à chaque étape, avec les anciens écrans encore présents. La tâche 7 supprime l'ancien monde en dernier.

---

### Task 1: Schéma des tables groups et group_lines

**Files:**
- Modify: `src/db/schema.sql` (ajouter deux tables à la fin)
- Test: `tests/db/schema.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces: tables `groups (id, account_id, name, direction)` et `group_lines (id, group_id, name, amount, day, keyword)`.

- [ ] **Step 1: Étendre l'assertion de schéma (test rouge)**

Dans `tests/db/schema.test.ts`, ajouter `"groups"` et `"group_lines"` à la liste des tables attendues :

```ts
  for (const t of ["accounts", "categories", "rules", "transactions", "budgets", "settings", "recurring_payments", "groups", "group_lines"]) {
    expect(tables).toContain(t);
  }
```

- [ ] **Step 2: Lancer le test, vérifier l'échec**

Run: `npx vitest run tests/db/schema.test.ts`
Expected: FAIL — `expected [ ... ] to contain 'groups'`.

- [ ] **Step 3: Ajouter les tables au schéma**

À la fin de `src/db/schema.sql`, ajouter :

```sql
CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  name TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out'))
);

CREATE TABLE IF NOT EXISTS group_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  amount REAL NOT NULL,
  day INTEGER,
  keyword TEXT NOT NULL
);
```

- [ ] **Step 4: Lancer le test, vérifier le succès**

Run: `npx vitest run tests/db/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.sql tests/db/schema.test.ts
git commit -m "feat: schéma groups + group_lines pour le prévisionnel"
```

---

### Task 2: Repository groups

**Files:**
- Create: `src/db/repositories/groups.ts`
- Test: `tests/db/repositories.test.ts` (ajouts)

**Interfaces:**
- Consumes: tables de la Task 1 ; `getDb` de `src/db/index`.
- Produces :
  - `type GroupRow = { id: number; accountId: string; name: string; direction: "in" | "out"; lines: { id: number; name: string; amount: number; day: number | null; keyword: string }[] }`
  - `listGroups(db): GroupRow[]`
  - `insertGroup(db, accountId: string, name: string, direction: "in" | "out"): number`
  - `deleteGroup(db, id: number): void`
  - `insertLine(db, groupId: number, name: string, amount: number, day: number | null, keyword: string): void`
  - `deleteLine(db, id: number): void`

- [ ] **Step 1: Écrire les tests (rouge)**

Ajouter à la fin de `tests/db/repositories.test.ts` :

```ts
import {
  listGroups,
  insertGroup,
  deleteGroup,
  insertLine,
  deleteLine,
} from "../../src/db/repositories/groups";

test("group + lines insert, list nested, delete line", () => {
  const db = getDb(":memory:");
  upsertAccount(db, { id: "acc1", name: "CIC", iban_masked: null, balance: 0, currency: "EUR", last_synced: null });
  const gid = insertGroup(db, "acc1", "Abonnements", "out");
  insertLine(db, gid, "Spotify", 10, 3, "SPOTIFY");
  insertLine(db, gid, "Courses", 300, null, "CARREFOUR");

  const groups = listGroups(db);
  expect(groups).toHaveLength(1);
  expect(groups[0]).toMatchObject({ id: gid, accountId: "acc1", name: "Abonnements", direction: "out" });
  expect(groups[0].lines).toHaveLength(2);
  expect(groups[0].lines[0]).toMatchObject({ name: "Spotify", amount: 10, day: 3, keyword: "SPOTIFY" });
  expect(groups[0].lines[1]).toMatchObject({ name: "Courses", amount: 300, day: null, keyword: "CARREFOUR" });

  deleteLine(db, groups[0].lines[0].id);
  expect(listGroups(db)[0].lines).toHaveLength(1);
});

test("deleteGroup cascades to its lines", () => {
  const db = getDb(":memory:");
  upsertAccount(db, { id: "acc1", name: "CIC", iban_masked: null, balance: 0, currency: "EUR", last_synced: null });
  const gid = insertGroup(db, "acc1", "Abonnements", "out");
  insertLine(db, gid, "Spotify", 10, 3, "SPOTIFY");
  deleteGroup(db, gid);
  expect(listGroups(db)).toHaveLength(0);
  const orphans = db.prepare("SELECT COUNT(*) AS n FROM group_lines").get() as { n: number };
  expect(orphans.n).toBe(0);
});
```

- [ ] **Step 2: Lancer les tests, vérifier l'échec**

Run: `npx vitest run tests/db/repositories.test.ts`
Expected: FAIL — module `../../src/db/repositories/groups` introuvable.

- [ ] **Step 3: Implémenter le repository**

Créer `src/db/repositories/groups.ts` :

```ts
import type Database from "better-sqlite3";

export type GroupLineRow = {
  id: number;
  name: string;
  amount: number;
  day: number | null;
  keyword: string;
};

export type GroupRow = {
  id: number;
  accountId: string;
  name: string;
  direction: "in" | "out";
  lines: GroupLineRow[];
};

export function listGroups(db: Database.Database): GroupRow[] {
  const groups = db
    .prepare(
      `SELECT id, account_id AS accountId, name, direction FROM groups ORDER BY name`,
    )
    .all() as Omit<GroupRow, "lines">[];
  const lineStmt = db.prepare(
    `SELECT id, name, amount, day, keyword FROM group_lines WHERE group_id = ? ORDER BY id`,
  );
  return groups.map((g) => ({
    ...g,
    lines: lineStmt.all(g.id) as GroupLineRow[],
  }));
}

export function insertGroup(
  db: Database.Database,
  accountId: string,
  name: string,
  direction: "in" | "out",
): number {
  const info = db
    .prepare(`INSERT INTO groups (account_id, name, direction) VALUES (?, ?, ?)`)
    .run(accountId, name, direction);
  return Number(info.lastInsertRowid);
}

export function deleteGroup(db: Database.Database, id: number): void {
  db.prepare(`DELETE FROM groups WHERE id = ?`).run(id);
}

export function insertLine(
  db: Database.Database,
  groupId: number,
  name: string,
  amount: number,
  day: number | null,
  keyword: string,
): void {
  db.prepare(
    `INSERT INTO group_lines (group_id, name, amount, day, keyword) VALUES (?, ?, ?, ?, ?)`,
  ).run(groupId, name, amount, day, keyword);
}

export function deleteLine(db: Database.Database, id: number): void {
  db.prepare(`DELETE FROM group_lines WHERE id = ?`).run(id);
}
```

- [ ] **Step 4: Lancer les tests, vérifier le succès**

Run: `npx vitest run tests/db/repositories.test.ts`
Expected: PASS (tous les tests du fichier, anciens et nouveaux).

- [ ] **Step 5: Commit**

```bash
git add src/db/repositories/groups.ts tests/db/repositories.test.ts
git commit -m "feat: repository groups (groupes + lignes, cascade)"
```

---

### Task 3: Lib forecast (moteur de calcul)

**Files:**
- Create: `src/lib/forecast.ts`
- Test: `tests/lib/forecast.test.ts`

**Interfaces:**
- Consumes: `monthKey` de `src/lib/money`.
- Produces:
  - `type Direction = "in" | "out"`
  - `type GroupLine = { id: number; name: string; amount: number; day: number | null; keyword: string }`
  - `type Group = { id: number; accountId: string; name: string; direction: Direction; lines: GroupLine[] }`
  - `type Txn = { date: string; amount: number; label: string; accountId: string }`
  - `type TimelineItem = { day: number; name: string; amount: number; seen: boolean }`
  - `type GroupView = { id: number; name: string; direction: Direction; total: number; spent: number }`
  - `type AccountForecast = { accountId: string; balance: number; currentEstimate: number; nextEstimate: number; timeline: TimelineItem[]; groups: GroupView[] }`
  - `computeForecast(accountId: string, balance: number, groups: Group[], txns: Txn[], month: string): AccountForecast`

Règles de calcul :
- Mois courant : partir du `balance`. Pour chaque ligne datée non vue ce mois, appliquer `+montant` (entrée) ou `-montant` (sortie). Pour chaque enveloppe, retrancher `max(0, montant - déjà dépensé)`.
- « Vue » : au moins une transaction du mois, du compte, de signe cohérent (`out` → débit `amount < 0`, `in` → crédit `amount > 0`), dont le libellé contient le mot-clé (casse ignorée).
- « Déjà dépensé » d'une enveloppe : somme des `Math.abs(amount)` des débits du mois qui matchent le mot-clé.
- Mois suivant : `currentEstimate` + somme de toutes les lignes (signe selon `direction`, montant plein).
- `total` d'un groupe : somme des montants de ses lignes. `spent` : pour une ligne datée, `montant` si vue sinon `0` ; pour une enveloppe, `min(déjà dépensé, montant)`.
- `timeline` : lignes datées uniquement, triées par `day` croissant, `amount` signé.

- [ ] **Step 1: Écrire les tests (rouge)**

Créer `tests/lib/forecast.test.ts` :

```ts
import { expect, test } from "vitest";
import { computeForecast, type Group, type Txn } from "../../src/lib/forecast";

const abonnements: Group = {
  id: 1,
  accountId: "acc1",
  name: "Abonnements",
  direction: "out",
  lines: [
    { id: 11, name: "Spotify", amount: 10, day: 3, keyword: "SPOTIFY" },
    { id: 12, name: "Netflix", amount: 15, day: 8, keyword: "NETFLIX" },
  ],
};

const courses: Group = {
  id: 2,
  accountId: "acc1",
  name: "Courses",
  direction: "out",
  lines: [{ id: 21, name: "Courses", amount: 300, day: null, keyword: "CARREFOUR" }],
};

const remuneration: Group = {
  id: 3,
  accountId: "acc1",
  name: "Rémunération",
  direction: "in",
  lines: [{ id: 31, name: "Salaire", amount: 2000, day: 1, keyword: "REMU" }],
};

test("dated out line not seen is subtracted; seen is ignored", () => {
  const txns: Txn[] = [
    { date: "2026-07-05", amount: -10, label: "PRLV SPOTIFY", accountId: "acc1" }, // Spotify vue
  ];
  const f = computeForecast("acc1", 1000, [abonnements], txns, "2026-07");
  // Spotify vue (déjà dans le solde) → ignorée ; Netflix non vue → -15
  expect(f.currentEstimate).toBe(985);
});

test("envelope subtracts its remaining, floored at 0", () => {
  const txns: Txn[] = [
    { date: "2026-07-02", amount: -120, label: "CARREFOUR CITY", accountId: "acc1" },
    { date: "2026-07-06", amount: -30, label: "carrefour market", accountId: "acc1" },
  ];
  const f = computeForecast("acc1", 1000, [courses], txns, "2026-07");
  // dépensé 150 sur 300 → reste 150 → 1000 - 150
  expect(f.currentEstimate).toBe(850);
  expect(f.groups[0].spent).toBe(150);
});

test("envelope overspend does not add money back", () => {
  const txns: Txn[] = [
    { date: "2026-07-02", amount: -450, label: "CARREFOUR", accountId: "acc1" },
  ];
  const f = computeForecast("acc1", 1000, [courses], txns, "2026-07");
  // reste = max(0, 300 - 450) = 0
  expect(f.currentEstimate).toBe(1000);
  expect(f.groups[0].spent).toBe(300);
});

test("dated in line not seen is added", () => {
  const f = computeForecast("acc1", 500, [remuneration], [], "2026-07");
  expect(f.currentEstimate).toBe(2500);
});

test("matching filters by account and by sign", () => {
  const txns: Txn[] = [
    { date: "2026-07-05", amount: -10, label: "SPOTIFY", accountId: "acc2" }, // autre compte
    { date: "2026-07-05", amount: 10, label: "SPOTIFY", accountId: "acc1" },  // crédit, pas un débit
  ];
  const f = computeForecast("acc1", 1000, [abonnements], txns, "2026-07");
  // Spotify jamais vue comme débit sur acc1 → -10 ; Netflix -15
  expect(f.currentEstimate).toBe(975);
});

test("next month starts from current estimate and applies full amounts", () => {
  const txns: Txn[] = [];
  const f = computeForecast("acc1", 1000, [abonnements, courses, remuneration], txns, "2026-07");
  // courant : rien vu → -10 -15 -300 (reste plein) +2000 = 2675
  expect(f.currentEstimate).toBe(2675);
  // suivant : 2675 + (2000 - 10 - 15 - 300) = 2675 + 1675 = 4350
  expect(f.nextEstimate).toBe(4350);
});

test("timeline sorted by day with seen status; envelopes excluded", () => {
  const txns: Txn[] = [
    { date: "2026-07-05", amount: -10, label: "SPOTIFY", accountId: "acc1" },
  ];
  const f = computeForecast("acc1", 1000, [abonnements, courses], txns, "2026-07");
  expect(f.timeline.map((i) => [i.day, i.name, i.amount, i.seen])).toEqual([
    [3, "Spotify", -10, true],
    [8, "Netflix", -15, false],
  ]);
});

test("december rolls over to january of next year", () => {
  const f = computeForecast("acc1", 1000, [courses], [], "2026-12");
  // courant : -300 → 700 ; suivant : 700 - 300 = 400
  expect(f.currentEstimate).toBe(700);
  expect(f.nextEstimate).toBe(400);
});
```

- [ ] **Step 2: Lancer les tests, vérifier l'échec**

Run: `npx vitest run tests/lib/forecast.test.ts`
Expected: FAIL — module `../../src/lib/forecast` introuvable.

- [ ] **Step 3: Implémenter la lib**

Créer `src/lib/forecast.ts` :

```ts
import { monthKey } from "./money";

export type Direction = "in" | "out";

export type GroupLine = {
  id: number;
  name: string;
  amount: number;
  day: number | null;
  keyword: string;
};

export type Group = {
  id: number;
  accountId: string;
  name: string;
  direction: Direction;
  lines: GroupLine[];
};

export type Txn = { date: string; amount: number; label: string; accountId: string };

// La bascule d'année n'a pas besoin d'être calculée : le mois suivant se déduit
// de currentEstimate + la somme signée de toutes les lignes (montant plein),
// indépendamment de la valeur de la chaîne de mois.

export type TimelineItem = { day: number; name: string; amount: number; seen: boolean };

export type GroupView = {
  id: number;
  name: string;
  direction: Direction;
  total: number;
  spent: number;
};

export type AccountForecast = {
  accountId: string;
  balance: number;
  currentEstimate: number;
  nextEstimate: number;
  timeline: TimelineItem[];
  groups: GroupView[];
};

export function computeForecast(
  accountId: string,
  balance: number,
  groups: Group[],
  txns: Txn[],
  month: string,
): AccountForecast {
  const monthTxns = txns.filter((t) => monthKey(t.date) === month);
  let current = balance;
  let nextDelta = 0;
  const timeline: TimelineItem[] = [];
  const groupViews: GroupView[] = [];

  for (const g of groups) {
    const sign = g.direction === "in" ? 1 : -1;
    let total = 0;
    let spent = 0;

    for (const line of g.lines) {
      total += line.amount;
      nextDelta += sign * line.amount;

      const kw = line.keyword.toLowerCase();
      const lineMatches = (t: Txn) => {
        const signOk = g.direction === "out" ? t.amount < 0 : t.amount > 0;
        return signOk && t.label.toLowerCase().includes(kw);
      };

      if (line.day !== null) {
        const seen = monthTxns.some(lineMatches);
        if (!seen) current += sign * line.amount;
        if (seen) spent += line.amount;
        timeline.push({ day: line.day, name: line.name, amount: sign * line.amount, seen });
      } else {
        const paid = monthTxns.filter(lineMatches).reduce((s, t) => s + Math.abs(t.amount), 0);
        const remaining = Math.max(0, line.amount - paid);
        current -= remaining;
        spent += Math.min(paid, line.amount);
      }
    }

    groupViews.push({ id: g.id, name: g.name, direction: g.direction, total, spent });
  }

  timeline.sort((a, b) => a.day - b.day);
  return {
    accountId,
    balance,
    currentEstimate: current,
    nextEstimate: current + nextDelta,
    timeline,
    groups: groupViews,
  };
}
```

- [ ] **Step 4: Lancer les tests, vérifier le succès**

Run: `npx vitest run tests/lib/forecast.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/forecast.ts tests/lib/forecast.test.ts
git commit -m "feat: moteur de prévisionnel (computeForecast)"
```

---

### Task 4: Écran Groupes (saisie) + navigation

**Files:**
- Create: `src/app/groupes/page.tsx`
- Create: `src/app/groupes/actions.ts`
- Modify: `src/app/layout.tsx` (ajouter le lien Groupes)

**Interfaces:**
- Consumes: `listGroups`, `insertGroup`, `deleteGroup`, `insertLine`, `deleteLine` (Task 2) ; `listAccounts` de `src/db/repositories/accounts` ; `formatEur` de `src/lib/money`.
- Produces: actions serveur `addGroup`, `removeGroup`, `addLine`, `removeLine`.

- [ ] **Step 1: Écrire les actions serveur**

Créer `src/app/groupes/actions.ts` :

```ts
"use server";
import { db } from "../../db/index";
import {
  insertGroup,
  deleteGroup,
  insertLine,
  deleteLine,
} from "../../db/repositories/groups";
import { revalidatePath } from "next/cache";

function refresh() {
  revalidatePath("/groupes");
  revalidatePath("/previsionnel");
}

export async function addGroup(formData: FormData) {
  const accountId = String(formData.get("accountId") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const direction = String(formData.get("direction") ?? "");
  if (!accountId || !name || (direction !== "in" && direction !== "out")) return;
  insertGroup(db(), accountId, name, direction);
  refresh();
}

export async function removeGroup(formData: FormData) {
  const id = Number.parseInt(String(formData.get("id")), 10);
  if (Number.isFinite(id)) deleteGroup(db(), id);
  refresh();
}

export async function addLine(formData: FormData) {
  const groupId = Number.parseInt(String(formData.get("groupId")), 10);
  const name = String(formData.get("name") ?? "").trim();
  const keyword = String(formData.get("keyword") ?? "").trim();
  const amount = Number.parseFloat(String(formData.get("amount")));
  const dayRaw = String(formData.get("day") ?? "").trim();
  const dayParsed = Number.parseInt(dayRaw, 10);
  const day = dayRaw !== "" && Number.isFinite(dayParsed) ? dayParsed : null;
  if (!Number.isFinite(groupId) || !name || !keyword) return;
  insertLine(db(), groupId, name, Number.isFinite(amount) ? amount : 0, day, keyword);
  refresh();
}

export async function removeLine(formData: FormData) {
  const id = Number.parseInt(String(formData.get("id")), 10);
  if (Number.isFinite(id)) deleteLine(db(), id);
  refresh();
}
```

- [ ] **Step 2: Écrire la page**

Créer `src/app/groupes/page.tsx` :

```tsx
import { db } from "../../db/index";
import { listGroups } from "../../db/repositories/groups";
import { listAccounts } from "../../db/repositories/accounts";
import { formatEur } from "../../lib/money";
import { addGroup, removeGroup, addLine, removeLine } from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export const dynamic = "force-dynamic";

export default function GroupesPage() {
  const database = db();
  const accounts = listAccounts(database);
  const groups = listGroups(database);
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? id;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Nouveau groupe</CardTitle>
        </CardHeader>
        <CardContent>
          {accounts.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Aucun compte. Synchronise d&apos;abord dans Réglages.
            </p>
          ) : (
            <form action={addGroup} className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="grp-name" className="font-normal">Nom</Label>
                <Input id="grp-name" name="name" placeholder="Ex: Abonnements" required />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="grp-account" className="font-normal">Compte</Label>
                <select
                  id="grp-account"
                  name="accountId"
                  className="border-input bg-background h-9 rounded-md border px-3 text-sm"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="grp-direction" className="font-normal">Sens</Label>
                <select
                  id="grp-direction"
                  name="direction"
                  className="border-input bg-background h-9 rounded-md border px-3 text-sm"
                >
                  <option value="out">Sortie</option>
                  <option value="in">Entrée</option>
                </select>
              </div>
              <Button type="submit" size="sm">Ajouter</Button>
            </form>
          )}
        </CardContent>
      </Card>

      {groups.length === 0 && (
        <Card>
          <CardContent>
            <p className="text-muted-foreground text-sm">Aucun groupe défini.</p>
          </CardContent>
        </Card>
      )}

      {groups.map((g) => {
        const total = g.lines.reduce((s, l) => s + l.amount, 0);
        return (
          <Card key={g.id}>
            <CardHeader className="flex-row items-baseline justify-between">
              <CardTitle>
                {g.name}{" "}
                <span className="text-muted-foreground text-sm font-normal">
                  {accountName(g.accountId)} · {g.direction === "in" ? "Entrée" : "Sortie"}
                </span>
              </CardTitle>
              <span className="flex items-center gap-2">
                <span className="text-sm font-medium">{formatEur(total)}</span>
                <form action={removeGroup}>
                  <input type="hidden" name="id" value={g.id} />
                  <Button type="submit" size="sm" variant="ghost">Supprimer</Button>
                </form>
              </span>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {g.lines.map((l) => (
                <div key={l.id} className="flex items-center justify-between text-sm">
                  <span>
                    {l.name}
                    <span className="text-muted-foreground">
                      {" "}· {l.keyword}
                      {l.day !== null ? ` · le ${l.day}` : " · enveloppe"}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span>{formatEur(l.amount)}</span>
                    <form action={removeLine}>
                      <input type="hidden" name="id" value={l.id} />
                      <Button type="submit" size="sm" variant="ghost">×</Button>
                    </form>
                  </span>
                </div>
              ))}

              <form action={addLine} className="flex flex-wrap items-end gap-2 pt-2">
                <input type="hidden" name="groupId" value={g.id} />
                <div className="flex flex-col gap-1">
                  <Label className="font-normal">Nom</Label>
                  <Input name="name" placeholder="Ex: Spotify" required className="max-w-40" />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="font-normal">Montant €</Label>
                  <Input type="number" name="amount" step="0.01" placeholder="0.00" className="max-w-28" />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="font-normal">Jour (vide = enveloppe)</Label>
                  <Input type="number" name="day" min="1" max="31" placeholder="—" className="max-w-28" />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="font-normal">Mot-clé</Label>
                  <Input name="keyword" placeholder="Ex: SPOTIFY" required className="max-w-40" />
                </div>
                <Button type="submit" size="sm" variant="secondary">Ajouter la ligne</Button>
              </form>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Ajouter le lien de navigation**

Dans `src/app/layout.tsx`, ajouter à `NAV`, après Transactions :

```ts
  { href: "/previsionnel", label: "Prévisionnel" },
  { href: "/groupes", label: "Groupes" },
```

(le lien Prévisionnel pointe vers une page créée en Task 5 ; il ne casse rien d'ici là car la nav est de simples liens.)

- [ ] **Step 4: Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 5: Commit**

```bash
git add src/app/groupes/ src/app/layout.tsx
git commit -m "feat: écran Groupes (saisie groupes + lignes) + nav"
```

---

### Task 5: Écran Prévisionnel (lecture)

**Files:**
- Create: `src/app/previsionnel/page.tsx`

**Interfaces:**
- Consumes: `listAccounts` (`src/db/repositories/accounts`), `listTransactions` (`src/db/repositories/transactions`), `listGroups` (`src/db/repositories/groups`), `computeForecast` + types (`src/lib/forecast`), `formatEur`, `monthKey` (`src/lib/money`), `cn` (`@/lib/utils`), `Progress` (`@/components/ui/progress`).
- Produces: page `/previsionnel`.

- [ ] **Step 1: Écrire la page**

Créer `src/app/previsionnel/page.tsx` :

```tsx
import { db } from "../../db/index";
import { listAccounts } from "../../db/repositories/accounts";
import { listTransactions } from "../../db/repositories/transactions";
import { listGroups } from "../../db/repositories/groups";
import { computeForecast, type Group, type Txn } from "../../lib/forecast";
import { formatEur, monthKey } from "../../lib/money";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

export const dynamic = "force-dynamic";

export default function PrevisionnelPage() {
  const database = db();
  const month = monthKey(new Date().toISOString().slice(0, 10));
  const accounts = listAccounts(database);
  const allGroups = listGroups(database);
  const allTxns: Txn[] = listTransactions(database).map((t) => ({
    date: t.date,
    amount: t.amount,
    label: t.label,
    accountId: t.accountId,
  }));

  const accountLabel = (a: (typeof accounts)[number]) =>
    a.iban_masked ? `${a.name} ${a.iban_masked}` : a.name;

  return (
    <div className="flex flex-col gap-4">
      {accounts.length === 0 && (
        <Card>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              Aucun compte. Synchronise d&apos;abord dans Réglages.
            </p>
          </CardContent>
        </Card>
      )}

      {accounts.map((a) => {
        const groups = allGroups.filter((g) => g.accountId === a.id) as Group[];
        const txns = allTxns.filter((t) => t.accountId === a.id);
        const f = computeForecast(a.id, a.balance, groups, txns, month);
        return (
          <Card key={a.id}>
            <CardHeader>
              <CardTitle>{accountLabel(a)}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-6">
                <div className="flex flex-col">
                  <span className="text-muted-foreground text-xs">Solde actuel</span>
                  <span className="text-xl font-bold">{formatEur(f.balance)}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-muted-foreground text-xs">Estimé fin de mois</span>
                  <span className="text-xl font-bold">{formatEur(f.currentEstimate)}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-muted-foreground text-xs">Estimé mois prochain</span>
                  <span className="text-xl font-bold">{formatEur(f.nextEstimate)}</span>
                </div>
              </div>

              {f.timeline.length > 0 && (
                <div className="flex flex-col gap-1">
                  <span className="text-muted-foreground text-xs">Frise du mois</span>
                  {f.timeline.map((i, idx) => (
                    <div
                      key={idx}
                      className={cn(
                        "flex justify-between text-sm",
                        i.seen && "text-muted-foreground line-through",
                      )}
                    >
                      <span>Le {i.day} · {i.name}</span>
                      <span>{formatEur(i.amount)}</span>
                    </div>
                  ))}
                </div>
              )}

              {f.groups.length > 0 && (
                <div className="flex flex-col gap-3">
                  <span className="text-muted-foreground text-xs">Groupes</span>
                  {f.groups.map((g) => {
                    const ratio = g.total > 0 ? g.spent / g.total : 0;
                    return (
                      <div key={g.id} className="flex flex-col gap-1">
                        <div className="flex justify-between text-sm">
                          <span>{g.name}</span>
                          <span>{formatEur(g.spent)} / {formatEur(g.total)}</span>
                        </div>
                        {g.direction === "out" && (
                          <Progress
                            value={Math.min(100, ratio * 100)}
                            indicatorClassName={
                              ratio >= 1 ? "bg-red-500" : ratio >= 0.8 ? "bg-amber-500" : "bg-green-500"
                            }
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 3: Vérifier la suite complète**

Run: `npm test`
Expected: tous les tests passent.

- [ ] **Step 4: Commit**

```bash
git add src/app/previsionnel/
git commit -m "feat: écran Prévisionnel par compte (soldes estimés, frise, groupes)"
```

---

### Task 6: Tableau de bord épuré

**Files:**
- Modify: `src/app/page.tsx` (retirer les cartes Récurrents, Enveloppes et le bloc d'alertes)

**Interfaces:**
- Consumes: `totalBalance`, `listAccounts` (`src/db/repositories/accounts`), `listTransactions` (`src/db/repositories/transactions`), `formatEur`, `monthKey` (`src/lib/money`).
- Produces: un tableau de bord sans dépendance aux libs budget/recurring/alerts.

- [ ] **Step 1: Réécrire la page**

Remplacer l'intégralité de `src/app/page.tsx` par :

```tsx
import { db } from "../db/index";
import { totalBalance, listAccounts } from "../db/repositories/accounts";
import { listTransactions } from "../db/repositories/transactions";
import { formatEur, monthKey } from "../lib/money";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";

export const dynamic = "force-dynamic";

export default function Dashboard() {
  const database = db();
  const month = monthKey(new Date().toISOString().slice(0, 10));
  const balance = totalBalance(database);
  const accounts = listAccounts(database);
  const allTxns = listTransactions(database);

  const monthSpend = allTxns
    .filter((t) => monthKey(t.date) === month && t.amount < 0)
    .reduce((s, t) => s + Math.abs(t.amount), 0);

  const accountLabel = (a: (typeof accounts)[number]) =>
    a.iban_masked ? `${a.name} ${a.iban_masked}` : a.name;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-1">
          <div className="text-3xl font-bold">{formatEur(balance)}</div>
          <div className="text-muted-foreground text-sm">
            Solde total ({accounts.length} compte{accounts.length > 1 ? "s" : ""})
          </div>
          <div className="text-muted-foreground text-sm">
            Dépensé ce mois-ci : {formatEur(monthSpend)}
          </div>
        </CardContent>
      </Card>

      {accounts.map((a) => {
        const accountTxns = allTxns.filter((t) => t.accountId === a.id).slice(0, 8);
        return (
          <Card key={a.id}>
            <CardHeader className="flex-row items-baseline justify-between">
              <CardTitle>{accountLabel(a)}</CardTitle>
              <span className="text-xl font-bold">{formatEur(a.balance)}</span>
            </CardHeader>
            <CardContent>
              <Table>
                <TableBody>
                  {accountTxns.length === 0 && (
                    <TableRow>
                      <TableCell className="text-muted-foreground">Aucune transaction.</TableCell>
                    </TableRow>
                  )}
                  {accountTxns.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="text-muted-foreground">{t.date}</TableCell>
                      <TableCell>{t.label}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {t.category ?? "À catégoriser"}
                      </TableCell>
                      <TableCell className="text-right font-medium">{formatEur(t.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "refactor: tableau de bord épuré (prévisionnel porté par sa page)"
```

---

### Task 7: Nettoyage de l'ancien monde

**Files:**
- Delete: `src/app/recurring/page.tsx`, `src/app/recurring/actions.ts`
- Delete: `src/app/budgets/page.tsx`, `src/app/budgets/actions.ts`
- Delete: `src/lib/recurring.ts`, `src/lib/budget.ts`, `src/lib/alerts.ts`
- Delete: `src/db/repositories/recurring.ts`, `src/db/repositories/budgets.ts`
- Delete: `tests/lib/recurring.test.ts`, `tests/lib/budget.test.ts`, `tests/lib/alerts.test.ts`
- Modify: `tests/db/repositories.test.ts` (retirer imports et cas budgets/récurrents)
- Modify: `src/app/layout.tsx` (retirer les liens Récurrents et Budgets)

**Interfaces:**
- Consumes: rien de nouveau. La suppression n'est valide que parce que les Tasks 4-6 ont retiré toutes les références (vérifié : seuls les fichiers ci-dessus et l'ancien tableau de bord les utilisaient).

- [ ] **Step 1: Retirer les liens de navigation obsolètes**

Dans `src/app/layout.tsx`, supprimer ces deux entrées de `NAV` :

```ts
  { href: "/recurring", label: "Récurrents" },
  { href: "/budgets", label: "Budgets" },
```

- [ ] **Step 2: Retirer les imports et cas de test budgets/récurrents**

Dans `tests/db/repositories.test.ts` :

Supprimer ces deux lignes d'import :

```ts
import { setBudget, listBudgets, deleteBudget } from "../../src/db/repositories/budgets";
import { listRecurring, insertRecurring, deleteRecurring } from "../../src/db/repositories/recurring";
```

Supprimer les trois tests `budget set and list round-trip (limit is a reserved word)`, `budget delete removes the row`, et `recurring payment insert, list, delete round-trip` (lignes 35 à 62 du fichier d'origine). Conserver les tests categories, transactions, settings, et les deux tests groups ajoutés en Task 2.

- [ ] **Step 3: Supprimer les fichiers morts**

```bash
git rm src/app/recurring/page.tsx src/app/recurring/actions.ts \
       src/app/budgets/page.tsx src/app/budgets/actions.ts \
       src/lib/recurring.ts src/lib/budget.ts src/lib/alerts.ts \
       src/db/repositories/recurring.ts src/db/repositories/budgets.ts \
       tests/lib/recurring.test.ts tests/lib/budget.test.ts tests/lib/alerts.test.ts
```

- [ ] **Step 4: Vérifier qu'aucune référence ne subsiste**

Run: `grep -rn -E "lib/budget|lib/recurring|lib/alerts|repositories/budgets|repositories/recurring|computeEnvelopes|computeRecurring|buildAlerts|listBudgets|listRecurring" src tests --include='*.ts' --include='*.tsx'`
Expected: aucune sortie (aucune référence restante).

- [ ] **Step 5: Vérifier compilation et suite complète**

Run: `npx tsc --noEmit && npm test`
Expected: aucune erreur de type ; tous les tests passent (schema, repositories dont groups, forecast, migration, money, plus les tests conservés).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: retirer anciens écrans Récurrents/Budgets et code mort"
```

---

## Vérification runtime finale (après Task 7)

Les DB `:memory:` ne voient pas certains bugs runtime (cf. CLAUDE.md). Lancer le vrai serveur et vérifier à la main :

- [ ] `npm run dev`, ouvrir `/groupes` : créer un groupe (compte + sens), ajouter une ligne datée et une enveloppe, supprimer une ligne, supprimer un groupe.
- [ ] Ouvrir `/previsionnel` : chaque compte affiche solde actuel, estimé fin de mois, estimé mois prochain, la frise datée et les groupes.
- [ ] Ouvrir `/` : plus de cartes Récurrents/Enveloppes/alertes ; soldes et transactions par compte intacts.
- [ ] La nav ne montre plus Récurrents ni Budgets ; Prévisionnel et Groupes présents.
- [ ] Aucune erreur dans la console serveur.

## Self-review (auteur du plan)

- Couverture spec : schéma (Task 1), migration non destructive (schéma additif, Task 1), lib forecast avec toutes les règles (Task 3), repository groups (Task 2), écran Prévisionnel (Task 5), écran Groupes (Task 4), nav (Tasks 4 et 7), tableau de bord épuré (Task 6), nettoyage y compris alerts (Task 7), tests forecast/repos/schema (Tasks 1-3). Tout point de la spec a une tâche.
- Types cohérents : `Group`/`GroupLine`/`Txn`/`AccountForecast` identiques entre `src/lib/forecast.ts` (Task 3) et la page Prévisionnel (Task 5) ; `GroupRow` du repository (Task 2) est structurellement compatible avec `Group` (mêmes champs `id/accountId/name/direction/lines`), d'où le cast `as Group[]` en Task 5.
- Pas de placeholder : chaque étape de code contient le code complet.
