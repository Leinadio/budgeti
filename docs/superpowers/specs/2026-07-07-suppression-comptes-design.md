# Suppression durable d'un compte

Date : 2026-07-07

## Objectif

Permettre de supprimer un compte depuis Réglages. La suppression est durable :
le compte, ses transactions et ses groupes de budget disparaissent, et le compte
ne réapparaît pas aux synchronisations suivantes.

## Contexte

La liste des comptes synchronisés vient du réglage `account_uids` (tableau JSON
d'uids Enable Banking), rempli à la connexion (`connection.ts`). La synchro
(`sync.ts`) itère ces uids et fait un `upsertAccount` pour chacun. Donc supprimer
la seule ligne `accounts` ne suffit pas : la prochaine synchro recrée le compte.
Pour une suppression durable, il faut aussi retirer l'uid de `account_uids`.

Un compte est référencé par des clés étrangères :
- `transactions.account_id REFERENCES accounts(id)` (sans cascade),
- `groups.account_id REFERENCES accounts(id)` (sans cascade), et
  `group_lines.group_id REFERENCES groups(id) ON DELETE CASCADE`.

Avec `foreign_keys = ON`, supprimer un compte encore référencé échoue. Il faut
donc supprimer d'abord ses transactions et ses groupes.

## Comportement

Supprimer un compte, dans une transaction (tout ou rien) :

1. Supprimer les transactions du compte.
2. Supprimer les groupes du compte (les `group_lines` suivent en cascade).
3. Supprimer la ligne `accounts`.
4. Retirer l'uid du compte du réglage `account_uids`.

Après suppression, le compte ne revient pas aux synchros suivantes. Il ne
réapparaît que si l'utilisateur reconnecte la banque (nouvelle session Enable
Banking), ce qui repeuple `account_uids` avec tous les comptes liés.

## Repository (`src/db/repositories/accounts.ts`)

```ts
export function deleteAccount(db: Database.Database, id: string): void;
```

Implémentation, dans `db.transaction(() => { ... })()` :

```ts
db.prepare("DELETE FROM transactions WHERE account_id = ?").run(id);
db.prepare("DELETE FROM groups WHERE account_id = ?").run(id);
db.prepare("DELETE FROM accounts WHERE id = ?").run(id);
const raw = getSetting(db, "account_uids");
if (raw) {
  const uids = (JSON.parse(raw) as string[]).filter((u) => u !== id);
  setSetting(db, "account_uids", JSON.stringify(uids));
}
```

`getSetting`/`setSetting` viennent de `src/db/repositories/settings.ts`. Les
requêtes SQL sont paramétrées. La cascade `group_lines` fonctionne car
`foreign_keys = ON` est activé dans `getDb`.

## Interface

### Composant client `DeleteAccountButton` (`src/app/settings/DeleteAccountButton.tsx`, nouveau)

Confirmation en deux temps, sans fenêtre native :
- État initial : un bouton « Supprimer » (variant destructif discret).
- Au clic : le bouton laisse place à « Confirmer » (destructif) et « Annuler ».
- « Annuler » revient à l'état initial.
- « Confirmer » soumet un `<form action={deleteAccountAction}>` avec un
  `input hidden name="id"` = id du compte.

Le composant reçoit `accountId` en prop et l'action serveur en prop (ou l'importe
directement ; l'action est un module server importable dans un client component
via `"use server"`).

### Action serveur (`src/app/settings/actions.ts`)

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

### Placement (`src/app/settings/page.tsx`)

Dans la carte « Noms des comptes », sur chaque ligne de compte, ajouter le
`DeleteAccountButton` à côté du bouton « Enregistrer » du renommage.

## Tests

`tests/db/repositories.test.ts` (ajouts) :
- `deleteAccount` supprime le compte, ses transactions, ses groupes et leurs
  lignes, et retire l'uid de `account_uids` (les autres uids restent).
- Un second compte et ses données ne sont pas affectés par la suppression du
  premier.

## Hors périmètre

- Annuler une suppression (pas de corbeille).
- Masquer un compte sans le supprimer.
- Gérer une reconnexion partielle (choisir quels comptes relier) : hors sujet,
  la reconnexion relie tout comme aujourd'hui.
