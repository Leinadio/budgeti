# Alias de compte persistant

Date : 2026-07-07

## Objectif

Permettre de renommer les comptes (ils s'appellent tous « CIC »), avec un alias
qui survit aux synchronisations Enable Banking. Aujourd'hui `upsertAccount`
réécrit le champ `name` depuis la banque à chaque synchro, donc un renommage
direct de `name` serait écrasé.

## Principe

Un alias vit dans une colonne séparée `custom_name` que la synchro ne touche
jamais. L'affichage utilise l'alias s'il existe, sinon le nom banque. Le
renommage se fait dans Réglages.

## Modèle de données

Ajout d'une colonne à `accounts` :

```sql
custom_name TEXT   -- alias défini par l'utilisateur ; NULL = utiliser name (nom banque)
```

- `schema.sql` : ajouter `custom_name TEXT` à la définition de `accounts` (pour
  les bases neuves).
- Migration idempotente pour les bases existantes : si la colonne est absente
  (`PRAGMA table_info(accounts)`), `ALTER TABLE accounts ADD COLUMN custom_name
  TEXT`. Appelée dans `getDb` après `migrateBudgets`.

## Persistance à la synchro

`upsertAccount` n'écrit que les champs banque (`name`, `iban_masked`, `balance`,
`currency`, `last_synced`) et ne mentionne pas `custom_name` dans son
`INSERT ... ON CONFLICT DO UPDATE`. L'alias est donc préservé automatiquement à
chaque resynchro.

Pour éviter que le type l'exige à la synchro, le paramètre de `upsertAccount`
est `Omit<Account, "custom_name">` : `sync.ts` et les tests existants restent
inchangés.

## Repository (`src/db/repositories/accounts.ts`)

- `Account` gagne `custom_name: string | null`.
- `listAccounts` (déjà `SELECT *`) renvoie donc `custom_name`.
- `upsertAccount(db, a: Omit<Account, "custom_name">)` : SQL inchangé.
- Nouvelle fonction :

```ts
export function setAccountAlias(db, id: string, alias: string | null): void;
// UPDATE accounts SET custom_name = ? WHERE id = ?  (alias null = réinitialise)
```

## Affichage centralisé (`src/lib/account.ts`, nouveau)

Deux helpers purs, paramètre structural (pas d'import du type repo) :

```ts
type NamedAccount = { name: string; custom_name: string | null; iban_masked: string | null };

export function accountDisplayName(a: { name: string; custom_name: string | null }): string;
// custom_name si non vide, sinon name

export function accountLabel(a: NamedAccount): string;
// accountDisplayName(a) + " " + iban_masked si présent
```

Remplacements :
- `src/app/page.tsx` et `src/app/previsionnel/page.tsx` : remplacer la fonction
  `accountLabel` locale par l'import de `accountLabel`.
- `src/app/groupes/page.tsx` : `accountName` utilise `accountDisplayName` au lieu
  de `a.name`.
- `src/db/repositories/transactions.ts` : le libellé de compte est construit en
  SQL (`COALESCE(a.name || ' ' || a.iban_masked, a.name)`). Le remplacer pour
  préférer l'alias :
  `COALESCE(COALESCE(a.custom_name, a.name) || ' ' || a.iban_masked, COALESCE(a.custom_name, a.name)) AS accountLabel`.

## Écran Réglages (`src/app/settings/page.tsx` + `actions.ts`)

Nouvelle carte « Noms des comptes » : une ligne par compte avec un formulaire
(`<form action={renameAccount}>`) :
- `input hidden name="id"` = id du compte,
- `Input name="alias"` avec `defaultValue = custom_name ?? ""` et `placeholder`
  = nom banque (pour indiquer la valeur par défaut),
- `Button` « Enregistrer ».

Vider le champ puis enregistrer réinitialise l'alias (retour au nom banque).

Action serveur `renameAccount(formData)` : lit `id` et `alias` (trim ; vide =>
`null`), appelle `setAccountAlias`, puis `revalidatePath` sur `/settings`, `/`,
`/previsionnel`, `/groupes`, `/transactions`.

## Tests

- `tests/db/migration.test.ts` (ajouts) : partir d'une table `accounts` sans
  `custom_name`, exécuter la migration, vérifier la présence de la colonne ;
  idempotence (deuxième passage sans erreur).
- `tests/db/repositories.test.ts` (ajouts) :
  - `setAccountAlias` définit puis réinitialise (`null`) l'alias ;
  - point critique : après `setAccountAlias`, un nouvel `upsertAccount` (même id,
    `name` et `balance` différents) met à jour `name`/`balance` mais préserve
    `custom_name`.
- `tests/lib/account.test.ts` (nouveau) : `accountDisplayName` (alias sinon nom),
  `accountLabel` (avec et sans IBAN, avec et sans alias).

## Hors périmètre

- Édition inline (double-clic) : abandonnée au profit de Réglages.
- Renommage des comptes non synchronisés (il n'y en a pas ; tous viennent du
  CIC).
- Suppression / masquage de comptes.
