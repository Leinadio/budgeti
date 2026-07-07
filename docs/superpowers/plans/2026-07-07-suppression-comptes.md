# Suppression durable d'un compte — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter dans Réglages un bouton pour supprimer durablement un compte (ses transactions, ses groupes et son uid de synchro), avec une confirmation en deux temps.

**Architecture:** Une fonction repo transactionnelle `deleteAccount` supprime transactions, groupes (lignes en cascade), compte, puis retire l'uid de `account_uids`. Un composant client à confirmation en deux temps déclenche une action serveur.

**Tech Stack:** Next.js (App Router, TypeScript, React), SQLite via better-sqlite3, Vitest, shadcn/ui.

## Global Constraints

- App locale mono-utilisateur, SQLite `data/budget.db`. Données bancaires jamais hors machine.
- Français sans emoji ni symbole décoratif.
- Requêtes SQL paramétrées.
- La suppression est tout-ou-rien (`db.transaction`). `foreign_keys = ON` est déjà activé dans `getDb` (la cascade `group_lines` fonctionne donc).
- Ordre de suppression obligatoire (FK sans cascade sur transactions et groups) : transactions, puis groups, puis accounts, puis mise à jour de `account_uids`.
- Confirmation en deux temps, sans fenêtre native (`confirm()` interdit).
- Vérification finale en lançant le vrai serveur (les DB `:memory:` ne voient pas certains bugs runtime — cf. CLAUDE.md).

---

### Task 1: Fonction repo deleteAccount

**Files:**
- Modify: `src/db/repositories/accounts.ts`
- Test: `tests/db/repositories.test.ts` (ajouts)

**Interfaces:**
- Consumes: `getSetting`, `setSetting` de `src/db/repositories/settings`.
- Produces: `deleteAccount(db: Database.Database, id: string): void`.

- [ ] **Step 1: Écrire le test (rouge)**

Ajouter à la fin de `tests/db/repositories.test.ts`. Le fichier importe déjà `getDb`, `upsertAccount`/`listAccounts`/`setAccountAlias` (accounts), `upsertTransaction`/`listTransactions` (transactions), `setSetting`/`getSetting` (settings), et `insertGroup`/`insertLine`/`listGroups` (groups). Ajouter `deleteAccount` à l'import existant depuis `../../src/db/repositories/accounts`, puis :

```ts
test("deleteAccount removes the account, its transactions, its groups+lines, and its sync uid", () => {
  const db = getDb(":memory:");
  upsertAccount(db, { id: "a1", name: "CIC", iban_masked: null, balance: 100, currency: "EUR", last_synced: null });
  upsertAccount(db, { id: "a2", name: "CIC", iban_masked: null, balance: 50, currency: "EUR", last_synced: null });
  upsertTransaction(db, { id: "t1", account_id: "a1", date: "2026-07-01", amount: -10, label: "X", category_id: null });
  upsertTransaction(db, { id: "t2", account_id: "a2", date: "2026-07-01", amount: -20, label: "Y", category_id: null });
  const g1 = insertGroup(db, "a1", "Abonnements", "out");
  insertLine(db, g1, "Spotify", 10, 3, "SPOTIFY");
  const g2 = insertGroup(db, "a2", "Courses", "out");
  setSetting(db, "account_uids", JSON.stringify(["a1", "a2"]));

  deleteAccount(db, "a1");

  expect(listAccounts(db).map((a) => a.id)).toEqual(["a2"]);
  expect(listTransactions(db).map((t) => t.id)).toEqual(["t2"]);
  expect(listGroups(db).map((g) => g.id)).toEqual([g2]);
  // la ligne de g1 (Spotify) a été supprimée en cascade ; g2 n'avait pas de ligne
  expect(db.prepare("SELECT COUNT(*) AS n FROM group_lines").get()).toEqual({ n: 0 });
  // l'uid a1 est retiré de la liste de synchro
  expect(JSON.parse(getSetting(db, "account_uids")!)).toEqual(["a2"]);
});
```

- [ ] **Step 2: Lancer le test, vérifier l'échec**

Run: `npx vitest run tests/db/repositories.test.ts`
Expected: FAIL — `deleteAccount` n'est pas exporté.

- [ ] **Step 3: Implémenter deleteAccount**

Dans `src/db/repositories/accounts.ts`, ajouter en tête l'import :

```ts
import { getSetting, setSetting } from "./settings";
```

et à la fin la fonction :

```ts
export function deleteAccount(db: Database.Database, id: string): void {
  db.transaction(() => {
    db.prepare("DELETE FROM transactions WHERE account_id = ?").run(id);
    db.prepare("DELETE FROM groups WHERE account_id = ?").run(id);
    db.prepare("DELETE FROM accounts WHERE id = ?").run(id);
    const raw = getSetting(db, "account_uids");
    if (raw) {
      const uids = (JSON.parse(raw) as string[]).filter((u) => u !== id);
      setSetting(db, "account_uids", JSON.stringify(uids));
    }
  })();
}
```

- [ ] **Step 4: Lancer le test, vérifier le succès**

Run: `npx vitest run tests/db/repositories.test.ts`
Expected: PASS (tous les tests du fichier).

- [ ] **Step 5: Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 6: Commit**

```bash
git add src/db/repositories/accounts.ts tests/db/repositories.test.ts
git commit -m "feat: deleteAccount (cascade transactions/groupes + retrait uid de synchro)"
```

---

### Task 2: Action serveur + bouton de suppression dans Réglages

**Files:**
- Modify: `src/app/settings/actions.ts`
- Create: `src/app/settings/DeleteAccountButton.tsx`
- Modify: `src/app/settings/page.tsx`

**Interfaces:**
- Consumes: `deleteAccount` (Task 1).
- Produces: action serveur `deleteAccountAction(formData: FormData)` ; composant client `DeleteAccountButton`.

- [ ] **Step 1: Ajouter l'action serveur**

Dans `src/app/settings/actions.ts`, ajouter l'import de `deleteAccount` à la ligne d'import existante depuis `../../db/repositories/accounts` (qui importe déjà `setAccountAlias`), puis l'action (`db` et `revalidatePath` sont déjà importés) :

```ts
export async function deleteAccountAction(formData: FormData) {
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  deleteAccount(db(), id);
  revalidatePath("/settings");
  revalidatePath("/");
  revalidatePath("/previsionnel");
  revalidatePath("/groupes");
  revalidatePath("/transactions");
}
```

- [ ] **Step 2: Créer le composant client de confirmation en deux temps**

Créer `src/app/settings/DeleteAccountButton.tsx` :

```tsx
"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { deleteAccountAction } from "./actions";

export function DeleteAccountButton({ accountId }: { accountId: string }) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(true)}>
        Supprimer
      </Button>
    );
  }

  return (
    <form action={deleteAccountAction} className="flex items-center gap-2">
      <input type="hidden" name="id" value={accountId} />
      <Button type="submit" size="sm" variant="destructive">
        Confirmer
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
        Annuler
      </Button>
    </form>
  );
}
```

- [ ] **Step 3: Câbler le bouton dans la carte « Noms des comptes »**

Dans `src/app/settings/page.tsx`, ajouter l'import :

```ts
import { DeleteAccountButton } from "./DeleteAccountButton";
```

Puis, dans la carte « Noms des comptes », remplacer le bloc `{accounts.map((a) => ( ... ))}` actuel :

```tsx
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
```

par (le renommage et la suppression sont deux formulaires distincts, réunis dans une même ligne) :

```tsx
            {accounts.map((a) => (
              <div key={a.id} className="flex items-center gap-2">
                <form action={renameAccount} className="flex items-center gap-2">
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
                <DeleteAccountButton accountId={a.id} />
              </div>
            ))}
```

- [ ] **Step 4: Vérifier compilation et suite complète**

Run: `npx tsc --noEmit && npm test`
Expected: aucune erreur ; tous les tests passent.

- [ ] **Step 5: Commit**

```bash
git add src/app/settings/actions.ts src/app/settings/DeleteAccountButton.tsx src/app/settings/page.tsx
git commit -m "feat: bouton de suppression de compte (confirmation en deux temps) dans Réglages"
```

---

## Vérification runtime finale (après Task 2)

Les DB `:memory:` ne voient pas certains bugs runtime (cf. CLAUDE.md). Lancer le vrai serveur :

- [ ] `npm run dev`, ouvrir `/settings` : carte « Noms des comptes », chaque compte a un bouton « Supprimer ».
- [ ] Cliquer « Supprimer » affiche « Confirmer » et « Annuler ». « Annuler » revient à l'état initial.
- [ ] Vérifier le comportement sur un compte de test (si tu ne veux pas perdre un vrai compte, teste puis resynchronise pour le récupérer) : après « Confirmer », le compte disparaît de `/settings`, `/`, `/previsionnel`, `/groupes`, `/transactions`.
- [ ] Aucune erreur dans la console serveur.

Note : la vérification runtime ne doit PAS supprimer un vrai compte de l'utilisateur sans son accord. Se limiter à vérifier le rendu et le mécanisme de confirmation (état « Confirmer »/« Annuler ») sans cliquer « Confirmer » sur un vrai compte, sauf demande explicite.

## Self-review (auteur du plan)

- Couverture spec : `deleteAccount` transactionnel avec ordre FK correct + retrait uid (Task 1), action serveur + composant confirmation deux temps + câblage Réglages (Task 2), tests repo (Task 1). Tous les points de la spec ont une tâche.
- Types cohérents : `deleteAccount(db, id: string)` défini en Task 1, consommé par `deleteAccountAction` (Task 2) ; `DeleteAccountButton({ accountId: string })` prend l'id passé par la page. `getSetting`/`setSetting` réutilisés depuis le repo settings.
- Pas de placeholder : chaque étape de code contient le code complet.
