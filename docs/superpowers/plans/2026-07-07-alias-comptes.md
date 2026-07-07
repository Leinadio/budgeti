# Alias de compte persistant — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre de renommer les comptes via un alias `custom_name` qui survit aux synchronisations Enable Banking, éditable dans Réglages et affiché partout.

**Architecture:** Nouvelle colonne `custom_name` sur `accounts`, jamais écrite par `upsertAccount` (donc préservée à la synchro). Migration idempotente pour les bases existantes. Un helper d'affichage centralisé applique le repli alias -> nom banque. Renommage via une carte dans Réglages.

**Tech Stack:** Next.js (App Router, TypeScript, React), SQLite via better-sqlite3, Vitest, shadcn/ui.

## Global Constraints

- App locale mono-utilisateur, SQLite `data/budget.db`. Données bancaires jamais hors machine.
- Français sans emoji ni symbole décoratif.
- `schema.sql` en `CREATE TABLE IF NOT EXISTS` ; les modifications de tables existantes passent par une migration idempotente appelée dans `getDb`, sur le modèle de `migrateBudgets`.
- Requêtes SQL paramétrées.
- `custom_name` NULL (ou vide) signifie « utiliser le nom banque ». Vider le champ dans Réglages réinitialise l'alias.
- `upsertAccount` ne doit jamais écrire `custom_name`.
- Composant `Table` de shadcn : pas de `TableFooter`.
- Vérification finale en lançant le vrai serveur (les DB `:memory:` ne voient pas certains bugs runtime — cf. CLAUDE.md).

---

## Ordre et découpage

1. Colonne + migration + tests migration
2. Repository accounts (type, upsert préservant l'alias, setAccountAlias) + tests
3. Helper d'affichage centralisé + câblage dans les écrans + libellé transactions
4. Écran Réglages : carte de renommage + action serveur

Chaque tâche laisse l'app compilable et testable.

---

### Task 1: Colonne custom_name + migration

**Files:**
- Modify: `src/db/schema.sql` (table `accounts`)
- Modify: `src/db/migrations.ts` (ajouter `migrateAccountCustomName`)
- Modify: `src/db/index.ts` (appeler la migration dans `getDb`)
- Test: `tests/db/migration.test.ts` (ajouts)

**Interfaces:**
- Consumes: rien.
- Produces: `migrateAccountCustomName(db: Database.Database): void` ; colonne `accounts.custom_name TEXT`.

- [ ] **Step 1: Écrire le test de migration (rouge)**

Ajouter à la fin de `tests/db/migration.test.ts` :

```ts
import { migrateAccountCustomName } from "../../src/db/migrations";

test("migrateAccountCustomName adds the column to an old accounts table, idempotent", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, iban_masked TEXT,
      balance REAL NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'EUR', last_synced TEXT
    );
    INSERT INTO accounts (id, name, balance) VALUES ('a1', 'CIC', 100);
  `);
  migrateAccountCustomName(db);
  let cols = db.prepare("PRAGMA table_info(accounts)").all() as { name: string }[];
  expect(cols.some((c) => c.name === "custom_name")).toBe(true);
  // valeur par défaut NULL
  expect(db.prepare("SELECT custom_name FROM accounts WHERE id='a1'").get()).toEqual({ custom_name: null });
  // idempotent : deuxième passage sans erreur
  migrateAccountCustomName(db);
  cols = db.prepare("PRAGMA table_info(accounts)").all() as { name: string }[];
  expect(cols.filter((c) => c.name === "custom_name")).toHaveLength(1);
});
```

`Database` est déjà importé en tête du fichier (`import Database from "better-sqlite3";`).

- [ ] **Step 2: Lancer le test, vérifier l'échec**

Run: `npx vitest run tests/db/migration.test.ts`
Expected: FAIL — `migrateAccountCustomName` n'est pas exporté.

- [ ] **Step 3: Implémenter la migration**

Ajouter à la fin de `src/db/migrations.ts` :

```ts
// Ajoute la colonne custom_name (alias utilisateur) aux bases antérieures.
// Idempotent : no-op si la colonne existe déjà. Ne touche à aucune donnée.
export function migrateAccountCustomName(db: Database.Database): void {
  const cols = db.prepare("PRAGMA table_info(accounts)").all() as { name: string }[];
  if (cols.some((c) => c.name === "custom_name")) return;
  db.exec(`ALTER TABLE accounts ADD COLUMN custom_name TEXT`);
}
```

- [ ] **Step 4: Ajouter la colonne au schéma des bases neuves**

Dans `src/db/schema.sql`, table `accounts`, ajouter la colonne `custom_name` après `last_synced` :

```sql
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,             -- Enable Banking account uid
  name TEXT NOT NULL,
  iban_masked TEXT,
  balance REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EUR',
  last_synced TEXT,                -- ISO datetime
  custom_name TEXT                 -- alias utilisateur ; NULL = utiliser name
);
```

- [ ] **Step 5: Appeler la migration dans getDb**

Dans `src/db/index.ts`, importer et appeler la migration après `migrateBudgets(db);` :

```ts
import { migrateBudgets, migrateAccountCustomName } from "./migrations";
```

et dans `getDb`, juste après `migrateBudgets(db);` :

```ts
  migrateAccountCustomName(db);
```

- [ ] **Step 6: Lancer les tests, vérifier le succès**

Run: `npx vitest run tests/db/migration.test.ts`
Expected: PASS (3 tests : les 2 existants + le nouveau).

- [ ] **Step 7: Commit**

```bash
git add src/db/schema.sql src/db/migrations.ts src/db/index.ts tests/db/migration.test.ts
git commit -m "feat: colonne accounts.custom_name + migration idempotente"
```

---

### Task 2: Repository accounts (alias préservé à la synchro)

**Files:**
- Modify: `src/db/repositories/accounts.ts`
- Test: `tests/db/repositories.test.ts` (ajouts)

**Interfaces:**
- Consumes: colonne `custom_name` (Task 1) ; `getDb`, `upsertAccount`, `listAccounts`.
- Produces:
  - `Account` gagne `custom_name: string | null`.
  - `upsertAccount(db, a: Omit<Account, "custom_name">): void` (SQL inchangé).
  - `setAccountAlias(db, id: string, alias: string | null): void`.

- [ ] **Step 1: Écrire les tests (rouge)**

Ajouter à la fin de `tests/db/repositories.test.ts`. Le fichier importe déjà `getDb` et, depuis `../../src/db/repositories/accounts`, `upsertAccount` et `totalBalance` — mais PAS `listAccounts`. Ajouter `setAccountAlias` et `listAccounts` :

```ts
import { setAccountAlias, listAccounts } from "../../src/db/repositories/accounts";

test("setAccountAlias sets and resets the alias", () => {
  const db = getDb(":memory:");
  upsertAccount(db, { id: "a1", name: "CIC", iban_masked: null, balance: 0, currency: "EUR", last_synced: null });
  setAccountAlias(db, "a1", "Perso");
  expect(listAccounts(db)[0].custom_name).toBe("Perso");
  setAccountAlias(db, "a1", null);
  expect(listAccounts(db)[0].custom_name).toBeNull();
});

test("upsertAccount preserves a custom alias across a resync", () => {
  const db = getDb(":memory:");
  upsertAccount(db, { id: "a1", name: "CIC", iban_masked: null, balance: 100, currency: "EUR", last_synced: null });
  setAccountAlias(db, "a1", "Compte joint");
  // resynchro : même id, name/balance mis à jour
  upsertAccount(db, { id: "a1", name: "CIC", iban_masked: null, balance: 250, currency: "EUR", last_synced: "2026-07-07" });
  const a = listAccounts(db).find((x) => x.id === "a1")!;
  expect(a.custom_name).toBe("Compte joint"); // alias préservé
  expect(a.balance).toBe(250);                 // solde mis à jour
});
```

- [ ] **Step 2: Lancer les tests, vérifier l'échec**

Run: `npx vitest run tests/db/repositories.test.ts`
Expected: FAIL — `setAccountAlias` n'est pas exporté (et/ou `custom_name` absent du type).

- [ ] **Step 3: Mettre à jour le repository**

Dans `src/db/repositories/accounts.ts` :

Étendre le type `Account` avec `custom_name` :

```ts
export type Account = {
  id: string;
  name: string;
  iban_masked: string | null;
  balance: number;
  currency: string;
  last_synced: string | null;
  custom_name: string | null;
};
```

Changer la signature de `upsertAccount` pour exclure `custom_name` (le corps SQL reste identique) :

```ts
export function upsertAccount(db: Database.Database, a: Omit<Account, "custom_name">): void {
  db.prepare(
    `INSERT INTO accounts (id, name, iban_masked, balance, currency, last_synced)
     VALUES (@id, @name, @iban_masked, @balance, @currency, @last_synced)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, iban_masked = excluded.iban_masked,
       balance = excluded.balance, currency = excluded.currency,
       last_synced = excluded.last_synced`,
  ).run(a);
}
```

Ajouter la fonction d'alias :

```ts
export function setAccountAlias(db: Database.Database, id: string, alias: string | null): void {
  db.prepare("UPDATE accounts SET custom_name = ? WHERE id = ?").run(alias, id);
}
```

`listAccounts` (`SELECT *`) et `totalBalance` restent inchangés.

- [ ] **Step 4: Lancer les tests, vérifier le succès**

Run: `npx vitest run tests/db/repositories.test.ts`
Expected: PASS (tous les tests du fichier).

- [ ] **Step 5: Vérifier la compilation (sync.ts inchangé)**

Run: `npx tsc --noEmit`
Expected: aucune erreur. `src/enablebanking/sync.ts` passe un objet sans `custom_name` à `upsertAccount`, compatible avec `Omit<Account, "custom_name">`.

- [ ] **Step 6: Commit**

```bash
git add src/db/repositories/accounts.ts tests/db/repositories.test.ts
git commit -m "feat: setAccountAlias + upsertAccount préserve custom_name"
```

---

### Task 3: Helper d'affichage centralisé + câblage

**Files:**
- Create: `src/lib/account.ts`
- Test: `tests/lib/account.test.ts`
- Modify: `src/app/page.tsx`, `src/app/previsionnel/page.tsx`, `src/app/groupes/page.tsx`
- Modify: `src/db/repositories/transactions.ts`

**Interfaces:**
- Consumes: rien (helpers purs, paramètres structuraux).
- Produces:
  - `accountDisplayName(a: { name: string; custom_name: string | null }): string`
  - `accountLabel(a: { name: string; custom_name: string | null; iban_masked: string | null }): string`

- [ ] **Step 1: Écrire les tests du helper (rouge)**

Créer `tests/lib/account.test.ts` :

```ts
import { expect, test } from "vitest";
import { accountDisplayName, accountLabel } from "../../src/lib/account";

test("accountDisplayName prefers the alias, falls back to the bank name", () => {
  expect(accountDisplayName({ name: "CIC", custom_name: "Joint" })).toBe("Joint");
  expect(accountDisplayName({ name: "CIC", custom_name: null })).toBe("CIC");
  expect(accountDisplayName({ name: "CIC", custom_name: "" })).toBe("CIC");
});

test("accountLabel appends the masked IBAN when present", () => {
  expect(accountLabel({ name: "CIC", custom_name: "Joint", iban_masked: "…1234" })).toBe("Joint …1234");
  expect(accountLabel({ name: "CIC", custom_name: null, iban_masked: "…1234" })).toBe("CIC …1234");
  expect(accountLabel({ name: "CIC", custom_name: null, iban_masked: null })).toBe("CIC");
});
```

- [ ] **Step 2: Lancer le test, vérifier l'échec**

Run: `npx vitest run tests/lib/account.test.ts`
Expected: FAIL — module `../../src/lib/account` introuvable.

- [ ] **Step 3: Implémenter le helper**

Créer `src/lib/account.ts` :

```ts
export function accountDisplayName(a: { name: string; custom_name: string | null }): string {
  return a.custom_name && a.custom_name.trim() !== "" ? a.custom_name : a.name;
}

export function accountLabel(a: {
  name: string;
  custom_name: string | null;
  iban_masked: string | null;
}): string {
  const base = accountDisplayName(a);
  return a.iban_masked ? `${base} ${a.iban_masked}` : base;
}
```

- [ ] **Step 4: Lancer le test, vérifier le succès**

Run: `npx vitest run tests/lib/account.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Câbler le tableau de bord**

Dans `src/app/page.tsx`, ajouter l'import :

```ts
import { accountLabel } from "../lib/account";
```

et supprimer la fonction locale `accountLabel` (les lignes) :

```ts
  const accountLabel = (a: (typeof accounts)[number]) =>
    a.iban_masked ? `${a.name} ${a.iban_masked}` : a.name;
```

Les appels `accountLabel(a)` restent identiques.

- [ ] **Step 6: Câbler l'écran Prévisionnel**

Dans `src/app/previsionnel/page.tsx`, ajouter l'import :

```ts
import { accountLabel } from "../../lib/account";
```

et supprimer la fonction locale `accountLabel` :

```ts
  const accountLabel = (a: (typeof accounts)[number]) =>
    a.iban_masked ? `${a.name} ${a.iban_masked}` : a.name;
```

Les appels `accountLabel(a)` restent identiques.

- [ ] **Step 7: Câbler l'écran Groupes**

Dans `src/app/groupes/page.tsx`, ajouter l'import :

```ts
import { accountDisplayName } from "../../lib/account";
```

et remplacer la fonction locale `accountName` :

```ts
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? id;
```

par :

```ts
  const accountName = (id: string) => {
    const a = accounts.find((acc) => acc.id === id);
    return a ? accountDisplayName(a) : id;
  };
```

- [ ] **Step 8: Préférer l'alias dans le libellé des transactions**

Dans `src/db/repositories/transactions.ts`, remplacer la ligne du `SELECT` de `listTransactions` :

```ts
            COALESCE(a.name || ' ' || a.iban_masked, a.name) AS accountLabel
```

par :

```ts
            COALESCE(COALESCE(a.custom_name, a.name) || ' ' || a.iban_masked, COALESCE(a.custom_name, a.name)) AS accountLabel
```

- [ ] **Step 9: Vérifier compilation et suite complète**

Run: `npx tsc --noEmit && npm test`
Expected: aucune erreur de type ; tous les tests passent.

- [ ] **Step 10: Commit**

```bash
git add src/lib/account.ts tests/lib/account.test.ts src/app/page.tsx src/app/previsionnel/page.tsx src/app/groupes/page.tsx src/db/repositories/transactions.ts
git commit -m "feat: helper d'affichage alias + câblage écrans et transactions"
```

---

### Task 4: Écran Réglages — renommage

**Files:**
- Modify: `src/app/settings/actions.ts`
- Modify: `src/app/settings/page.tsx`

**Interfaces:**
- Consumes: `setAccountAlias` (Task 2), `listAccounts`.
- Produces: action serveur `renameAccount(formData: FormData)`.

- [ ] **Step 1: Ajouter l'action serveur**

Dans `src/app/settings/actions.ts`, ajouter l'import et l'action :

```ts
import { setAccountAlias } from "../../db/repositories/accounts";

export async function renameAccount(formData: FormData) {
  const id = String(formData.get("id") ?? "").trim();
  const aliasRaw = String(formData.get("alias") ?? "").trim();
  if (!id) return;
  setAccountAlias(db(), id, aliasRaw === "" ? null : aliasRaw);
  revalidatePath("/settings");
  revalidatePath("/");
  revalidatePath("/previsionnel");
  revalidatePath("/groupes");
  revalidatePath("/transactions");
}
```

(`db` et `revalidatePath` sont déjà importés dans ce fichier.)

- [ ] **Step 2: Ajouter la carte de renommage**

Dans `src/app/settings/page.tsx`, ajouter `renameAccount` à l'import des actions :

```ts
import { saveThreshold, renameAccount } from "./actions";
```

et insérer une carte après la carte « Seuil d'alerte de solde » (avant la fermeture du `</div>` racine) :

```tsx
      {accounts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Noms des comptes</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {accounts.map((a) => (
              <form key={a.id} action={renameAccount} className="flex items-center gap-2">
                <input type="hidden" name="id" value={a.id} />
                <Input
                  name="alias"
                  defaultValue={a.custom_name ?? ""}
                  placeholder={a.name}
                  className="max-w-60"
                />
                <Button type="submit" size="sm">
                  Enregistrer
                </Button>
              </form>
            ))}
            <p className="text-muted-foreground text-xs">
              Videz le champ pour revenir au nom de la banque.
            </p>
          </CardContent>
        </Card>
      )}
```

`accounts`, `Card*`, `Input`, `Button` sont déjà disponibles dans ce fichier.

- [ ] **Step 3: Vérifier compilation et suite complète**

Run: `npx tsc --noEmit && npm test`
Expected: aucune erreur ; tous les tests passent.

- [ ] **Step 4: Commit**

```bash
git add src/app/settings/actions.ts src/app/settings/page.tsx
git commit -m "feat: renommage des comptes dans Réglages (alias)"
```

---

## Vérification runtime finale (après Task 4)

Les DB `:memory:` ne voient pas certains bugs runtime (cf. CLAUDE.md). Lancer le vrai serveur :

- [ ] `npm run dev`, ouvrir `/settings` : carte « Noms des comptes », renommer un compte, vérifier que le nom change.
- [ ] Vérifier l'affichage du nouveau nom sur `/`, `/previsionnel`, `/groupes`, `/transactions`.
- [ ] Vider le champ d'un compte + Enregistrer : retour au nom banque.
- [ ] Relancer une synchronisation (Réglages) et vérifier que l'alias n'est PAS écrasé.
- [ ] Aucune erreur dans la console serveur.

## Self-review (auteur du plan)

- Couverture spec : colonne + migration (Task 1), repo type/upsert/setAccountAlias (Task 2), helper + câblage + libellé transactions (Task 3), écran Réglages (Task 4). Tous les points de la spec ont une tâche.
- Types cohérents : `Account.custom_name: string | null` (Task 2) utilisé par le helper (Task 3, paramètre structural compatible) et Réglages (`a.custom_name ?? ""`, Task 4) ; `upsertAccount` en `Omit<Account, "custom_name">` cohérent avec `sync.ts` inchangé ; `migrateAccountCustomName` défini en Task 1 et appelé en Task 1.
- Pas de placeholder : chaque étape de code contient le code complet.
