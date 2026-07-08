# Refonte des groupes : types, mots-clés multiples, appartenance unique, rattachement manuel

Date : 2026-07-08

## Objectif

Unifier tout le classement des dépenses autour des groupes, en remplaçant le
système de catégories. Rendre le modèle clair (type de groupe explicite),
puissant (enveloppes multi-mots-clés, rattachement manuel) et juste (chaque
transaction compte dans un seul groupe).

## Décisions actées

- Un groupe a un type : enveloppe ou récurrents.
- Enveloppe : un montant mensuel unique + plusieurs mots-clés, dépensé au fil de
  l'eau.
- Récurrents : une liste de lignes datées (montant + jour + mot-clé), total =
  somme des lignes.
- Appartenance unique : une transaction appartient à au plus un groupe.
- Résolution de l'appartenance (dans l'ordre) : rattachement manuel s'il existe ;
  sinon le groupe dont un mot-clé matche (si un seul) ; si plusieurs matchent,
  ambiguë et laissée non assignée ; si aucun, non budgétée.
- Les catégories et les règles disparaissent (écran, code) ; remplacées par les
  groupes et leurs mots-clés.
- Migration : repartir à zéro sur les groupes. Comptes, soldes, transactions
  conservés.

## Modèle de données

### Table `groups` (refonte)

Avant : `(id, account_id, name, direction)`.
Après :

```sql
CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  name TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  kind TEXT NOT NULL CHECK (kind IN ('envelope', 'recurring')),
  monthly_amount REAL             -- montant mensuel de l'enveloppe ; NULL pour un groupe récurrents
);
```

### Table `group_keywords` (nouvelle)

```sql
CREATE TABLE IF NOT EXISTS group_keywords (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL           -- matché insensiblement à la casse contre le libellé
);
```

Utilisée par les groupes enveloppe (plusieurs mots-clés). Un groupe récurrents
n'a pas de mots-clés de groupe : ses mots-clés vivent sur ses lignes.

### Table `group_lines` (inchangée, réservée aux récurrents)

`(id, group_id, name, amount, day, keyword)`. Pour un groupe récurrents, chaque
ligne a un `day` (jour du mois) non nul et un `keyword`.

### Table `transactions` (ajout)

```sql
group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL
```

Rattachement manuel : `NULL` = pas de rattachement manuel (résolution
automatique). La colonne `category_id` existante devient dormante (non lue).

### Migration

`schema.sql` porte les nouvelles définitions (bases neuves). Une migration
idempotente dans `getDb` (après les migrations existantes) traite les bases
existantes :

- Si la table `groups` n'a pas la colonne `kind` : supprimer les données de
  groupes (`group_lines`, `group_keywords`, `groups`) et recréer ces trois
  tables avec les nouvelles définitions (repart à zéro sur les groupes).
- Si la table `transactions` n'a pas la colonne `group_id` :
  `ALTER TABLE transactions ADD COLUMN group_id INTEGER REFERENCES groups(id)`.
- Idempotente : ne rien faire si les colonnes existent déjà.

Les tables `categories`, `rules`, `budgets`, `recurring_payments` restent en
base (dormantes) ; leur code applicatif est retiré.

## Logique métier (lib)

### `src/lib/ownership.ts` (nouveau)

Résolution de l'appartenance, partagée par le prévisionnel et l'écran
Transactions.

```ts
export type Direction = "in" | "out";
export type OwnedTxn = { id: string; date: string; amount: number; label: string; accountId: string; groupId: number | null };
export type OwnableGroup = {
  id: number;
  accountId: string;
  direction: Direction;
  kind: "envelope" | "recurring";
  keywords: string[];        // enveloppe : mots-clés du groupe ; récurrents : mots-clés des lignes
};

export type Ownership =
  | { status: "manual"; groupId: number }
  | { status: "auto"; groupId: number }
  | { status: "ambiguous" }
  | { status: "none" };

export function resolveOwnership(txn: OwnedTxn, groups: OwnableGroup[]): Ownership;
```

Règles :
- Signe cohérent avec le sens : un groupe `out` ne matche que les débits
  (`amount < 0`), un groupe `in` que les crédits (`amount > 0`).
- Même compte (`group.accountId === txn.accountId`).
- Manuel : si `txn.groupId` est non nul et pointe un groupe du même compte,
  `{ status: "manual", groupId }`.
- Sinon, mots-clés : groupes dont un `keyword` est contenu dans le libellé
  (casse ignorée). Un seul -> `{ status: "auto", groupId }`. Plusieurs ->
  `{ status: "ambiguous" }`. Aucun -> `{ status: "none" }`.

### `src/lib/forecast.ts` (refonte)

`computeForecast` s'appuie sur l'appartenance au lieu du matching par ligne.

```ts
export type GroupLine = { id: number; name: string; amount: number; day: number; keyword: string };
export type Group = {
  id: number;
  accountId: string;
  name: string;
  direction: "in" | "out";
  kind: "envelope" | "recurring";
  monthlyAmount: number | null;
  keywords: string[];
  lines: GroupLine[];
};
export type Txn = { id: string; date: string; amount: number; label: string; accountId: string; groupId: number | null };
// TimelineItem, GroupView, AccountForecast : inchangés
export function computeForecast(accountId, balance, groups, txns, month): AccountForecast;
```

- Calculer d'abord, pour chaque transaction du mois du compte, son groupe
  propriétaire via `resolveOwnership` (les statuts `ambiguous`/`none` ne
  possèdent aucun groupe).
- Groupe enveloppe : `dépensé` = somme des `Math.abs(amount)` des transactions
  qui lui appartiennent ce mois-ci ; `reste` = `max(0, monthlyAmount - dépensé)` ;
  `current -= reste`. Mois suivant : `nextDelta -= monthlyAmount`.
  `GroupView.total = monthlyAmount`, `spent = min(dépensé, monthlyAmount)`.
- Groupe récurrents : pour chaque ligne, `vue` s'il existe une transaction
  appartenant au groupe ce mois-ci dont le libellé contient le mot-clé de la
  ligne. Ligne non vue : `current += sign * amount`. `nextDelta += sign * amount`
  pour toutes les lignes. `total = somme des lignes`, `spent = somme des lignes
  vues`. Frise : lignes datées, triées par jour, `seen` selon ce qui précède.
- Bascule d'année : le mois suivant reste `current + nextDelta` (inchangé).

## Repositories

### `src/db/repositories/groups.ts` (refonte)

```ts
export type GroupLineRow = { id: number; name: string; amount: number; day: number; keyword: string };
export type GroupRow = {
  id: number;
  accountId: string;
  name: string;
  direction: "in" | "out";
  kind: "envelope" | "recurring";
  monthlyAmount: number | null;
  keywords: string[];
  lines: GroupLineRow[];
};

export function listGroups(db): GroupRow[];                              // triés par nom, keywords + lines imbriqués
export function insertEnvelopeGroup(db, accountId, name, direction, monthlyAmount): number;
export function insertRecurringGroup(db, accountId, name, direction): number;
export function deleteGroup(db, id): void;                              // cascade keywords + lines
export function addKeyword(db, groupId, keyword): void;
export function removeKeyword(db, id): void;
export function insertLine(db, groupId, name, amount, day, keyword): void;
export function deleteLine(db, id): void;
```

### `src/db/repositories/transactions.ts` (mise à jour)

- `listTransactions` renvoie `groupId` (rattachement manuel) au lieu de la
  catégorie ; conserve `id, date, amount, label, accountId, accountLabel`.
- Nouvelle fonction `setTransactionGroup(db, id, groupId | null)` (UPDATE
  paramétré ; `null` détache = résolution automatique).
- Retirer `setTransactionCategory` et l'usage de `category_id`.

## Écrans

### Page Groupes (`src/app/groupes/`)

- Création : choisir le type (Enveloppe ou Récurrents).
  - Enveloppe : nom, sens, montant mensuel. Puis, sur la carte du groupe, ajout
    de mots-clés (liste, ajout/suppression).
  - Récurrents : nom, sens. Puis ajout de lignes datées (nom, montant, jour,
    mot-clé).
- Affichage adapté au type ; total du groupe = montant mensuel (enveloppe) ou
  somme des lignes (récurrents).

### Page Transactions (`src/app/transactions/`)

- Le menu « Catégorie » devient un menu « Groupe » : liste des groupes du compte
  de la transaction + une option « Automatique » (détache, `group_id = NULL`).
- Chaque ligne indique son appartenance résolue : le groupe (manuel ou auto),
  ou « à répartir » (ambiguë), ou « non budgétée » (aucune).
- Retirer la case « règle » et le `CategorySelectField`/`RuleCheckboxField`.
- Action serveur `setGroup` (remplace `recategorize`).

### Navigation et retrait

- Retirer l'entrée de nav « Catégories » et la page `src/app/categories/`.
- Retirer le code des catégories/règles : repositories `categories`, `rules`,
  composants `CategorySelectField`, `RuleCheckboxField`, action `recategorize`,
  usages de `ensureCategory`. Les tables SQL restent dormantes.

### Tableau de bord et Prévisionnel

- Prévisionnel : inchangé à l'écran ; il consomme le nouveau `computeForecast`.
- Tableau de bord : les transactions par compte n'affichent plus la colonne
  catégorie (ou affichent le groupe résolu). Choix : afficher le groupe résolu
  quand il existe, sinon rien.

## Tests

- `tests/lib/ownership.test.ts` : manuel prime ; un seul mot-clé -> auto ;
  plusieurs -> ambiguë ; aucun -> none ; filtre compte et signe.
- `tests/lib/forecast.test.ts` (refonte) : enveloppe (dépensé via appartenance,
  reste planché à 0, mois suivant plein) ; récurrents (ligne vue/non vue via
  appartenance, frise) ; une transaction ambiguë/non budgétée ne compte dans
  aucun groupe ; rattachement manuel prioritaire.
- `tests/db/repositories.test.ts` : groupes enveloppe/récurrents create/list
  (keywords et lines imbriqués), mots-clés add/remove, lignes, delete cascade ;
  `setTransactionGroup` set/detach.
- `tests/db/migration.test.ts` : ancienne table `groups` sans `kind` -> tables
  recréées (clean slate) ; `transactions` sans `group_id` -> colonne ajoutée ;
  idempotence.
- `tests/db/schema.test.ts` : présence de `group_keywords`.

## Découpage (pour le plan)

1. Modèle de données : schéma + migration (clean slate groupes, `group_id`) +
   tests migration/schéma.
2. Repository groupes (types, enveloppe/récurrents, mots-clés, lignes) + tests.
3. Repository transactions (`group_id`, `setTransactionGroup`) + tests.
4. Lib `ownership` (résolution) + tests.
5. Lib `forecast` (refonte sur l'appartenance) + tests.
6. Écran Groupes (création selon type, mots-clés, lignes).
7. Écran Transactions (menu Groupe, appartenance affichée) + Prévisionnel/
   Tableau de bord adaptés.
8. Retrait des catégories/règles (écran, nav, code) + nettoyage.

Chaque étape est testable seule.

## Risques

- Refonte large touchant modèle, moteur et plusieurs écrans. Mitigation :
  découpage en étapes testables, vérification runtime finale sur le vrai serveur.
- Mots-clés qui se chevauchent : géré par le statut « à répartir » (pas de
  mauvais comptage automatique).

## Hors périmètre

- Apprentissage automatique d'un mot-clé lors d'un rattachement manuel (on
  rattache seulement la transaction ; ajouter le mot-clé au groupe reste manuel).
- Exclure explicitement une transaction auto-matchée (« forcer non budgétée »).
- Suppression physique des tables catégories/règles (restent dormantes).
- Répartir une transaction sur plusieurs groupes (appartenance unique).
