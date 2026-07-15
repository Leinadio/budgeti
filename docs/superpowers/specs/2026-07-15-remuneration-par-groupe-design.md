# Rémunération par groupe (principale / supplémentaire au niveau du groupe)

Date : 2026-07-15

## Problème

La fonctionnalité livrée le 2026-07-14 étiquette chaque transaction de revenu
« principale » ou « supplémentaire » via un menu par ligne. À l'usage,
l'utilisateur veut que cette distinction porte sur le **groupe**, pas sur chaque
transaction : il crée un groupe « Rémunération principale » et un groupe
« Rémunération supplémentaire », range chaque entrée dans l'un ou l'autre, et
l'app additionne. Trois demandes explicites :

1. À la création d'un groupe, voir une distinction claire entre entrée et sortie.
2. Pouvoir créer un groupe « entrée principale » et un groupe « entrée
   supplémentaire ».
3. Voir que l'entrée principale est de type récurrent et l'entrée supplémentaire
   une enveloppe dont le montant n'est pas connu à l'avance.

Décision de conception validée avec l'utilisateur : le type de revenu vient du
**groupe** ; le menu principale/supplémentaire par transaction est retiré ; les
montants du mois se **calculent** à partir des transactions rangées dans chaque
groupe (aucun montant à saisir, la variation d'un mois à l'autre est naturelle).

## État actuel (après le merge du 2026-07-14)

- `transactions` porte une colonne `income_kind` ('principal'|'supplementary'|NULL)
  et un composant `IncomeKindSelect` (menu par ligne) appelant l'action
  `setIncomeKind`.
- `monthRemuneration(groups, txns, month)` (`src/lib/remuneration.ts`) calcule
  principal/supplémentaire en lisant `txn.incomeKind` pour les transactions
  rattachées à un groupe de sens `in`.
- `groups` : colonnes `id, account_id, name, direction ('in'|'out'),
  kind ('envelope'|'recurring'), monthly_amount`. Création via `NewGroupForm`
  (champs Type, Nom, Compte, Sens, Montant) et l'action `addGroup`
  (`insertEnvelopeGroup` / `insertRecurringGroup`).
- L'encart `RemunerationSummary` de l'Historique affiche déjà, par mois :
  principal, supplémentaire, dépenses, les deux lectures et « à te verser le mois
  prochain ».

## Nouveau modèle

### Classification au niveau du groupe

Un groupe d'entrée porte une classification de revenu : **principale** ou
**supplémentaire**. On ajoute une colonne `income_kind TEXT`
('principal'|'supplementary'|NULL) sur la table `groups`. NULL pour une dépense
ou tout groupe non-revenu. Le comptage s'appuie sur cette colonne, indépendante
du type (récurrent/enveloppe) — le type reste une caractéristique visible
(demande 3) mais ne pilote pas le calcul.

### Formulaire de création (demandes 1 à 3)

Le formulaire « Nouveau groupe » commence par un choix unique **Nature** :

- **Dépense** → `direction = out`, `income_kind = NULL`. On garde ensuite le choix
  Enveloppe/Récurrent et, pour une enveloppe, le montant — comme aujourd'hui.
- **Rémunération principale** → `direction = in`, `kind = recurring`,
  `income_kind = 'principal'`. Pas de montant à saisir.
- **Rémunération supplémentaire** → `direction = in`, `kind = envelope`,
  `income_kind = 'supplementary'`, `monthly_amount = 0`. Pas de montant à saisir.

Le champ « Sens » disparaît (déduit de la Nature). Le champ « Type » et le champ
« Montant » ne s'affichent que pour une Dépense. Ainsi la distinction entrée /
sortie est explicite (demande 1), les deux types d'entrée sont créables
(demande 2), et le lien principale = récurrent / supplémentaire = enveloppe est
visible et imposé (demande 3).

Les groupes de revenu ne nécessitent ni ligne ni montant : ils servent à
collecter les transactions rangées dedans. L'utilisateur peut en créer plusieurs
de chaque sorte ; les sommes s'additionnent par classification.

### Rangement des entrées

Aucun nouveau geste : dans l'onglet Transactions, chaque entrée se range dans
« Rémunération principale » ou « Rémunération supplémentaire » via le menu Groupe
existant (`GroupSelectField`), exactement comme pour une dépense.

### Calcul mensuel

`monthRemuneration` change de source :

- `principal` = somme des `Math.abs(montant)` des transactions du mois rattachées
  (ownership manuel) à un groupe dont `income_kind = 'principal'`.
- `supplementary` = idem pour `income_kind = 'supplementary'`.
- `expenses` = inchangé (groupes de sens `out`).
- `balanceVsPrincipal`, `balanceVsTotal`, `suggestedNextPrincipal` : formules
  inchangées.

L'encart `RemunerationSummary` de l'Historique est inchangé dans sa forme ; seule
sa source de données change.

### Ce qui est retiré

- Le composant `IncomeKindSelect` et son rendu dans `TransactionsBrowser`.
- L'action `setIncomeKind` et la fonction repo `setIncomeKind`.
- La lecture de `txn.incomeKind` dans `monthRemuneration` et le seuil
  `owningDirection === 'in'` du browser lié à l'étiquette par ligne.

La colonne `transactions.income_kind` devient inutilisée. On la **laisse en
place** (la retirer imposerait une reconstruction de table en SQLite ; sa
présence est inoffensive). Le report de `income_kind` lors d'une fusion
(`mergeTransactions`) devient sans effet ; on peut le laisser tel quel.

## Modèle de données

Migration idempotente (sur le modèle des migrations existantes basées sur
`PRAGMA table_info`), appelée dans `getDb()` :

```sql
ALTER TABLE groups ADD COLUMN income_kind TEXT; -- 'principal' | 'supplementary' | NULL
```

`schema.sql` reflète la colonne pour les bases neuves. Les groupes existants
gardent `income_kind = NULL` (l'utilisateur a de toute façon supprimé son ancien
groupe de rémunération ; il recréera les deux groupes via le nouveau formulaire).

## Repository (`src/db/repositories/groups.ts`)

- `GroupRow` / le type `Group` gagnent `incomeKind: 'principal' | 'supplementary' | null`.
  `listGroups` lit la colonne.
- Les insertions posent `income_kind` :
  - `insertRecurringGroup(db, accountId, name, direction, incomeKind = null)`.
  - `insertEnvelopeGroup(db, accountId, name, direction, monthlyAmount, incomeKind = null)`.
  (Signatures étendues avec un paramètre optionnel, rétrocompatibles.)

## Server action (`src/app/groupes/actions.ts`)

`addGroup` interprète un champ `nature` du formulaire :

- `nature = 'expense'` → lit `kind` et `monthlyAmount` comme aujourd'hui,
  `direction = 'out'`, `incomeKind = null`.
- `nature = 'principal'` → `insertRecurringGroup(..., 'in', 'principal')`.
- `nature = 'supplementary'` → `insertEnvelopeGroup(..., 'in', 0, 'supplementary')`.

`editGroup` : l'édition d'un groupe de revenu conserve sa nature (pas de
changement de classification via l'édition dans cette version ; hors périmètre).

## UI (`src/components/new-group-form.tsx`)

Le formulaire pilote l'affichage selon la Nature choisie :

- Un select **Nature** : « Dépense », « Rémunération principale »,
  « Rémunération supplémentaire ».
- Nom et Compte : toujours présents.
- Type (Enveloppe/Récurrent) et Montant : affichés uniquement pour « Dépense ».
- Le champ « Sens » est supprimé.

## Lib pure (`src/lib/remuneration.ts`)

`monthRemuneration` s'appuie sur `income_kind` du groupe propriétaire au lieu de
`txn.incomeKind`. Le champ `Txn.incomeKind` n'est plus lu ici (il peut rester
dans le type sans usage, ou être retiré si aucun autre code ne le lit — à
vérifier).

## Cas limites

- Plusieurs groupes « principale » ou « supplémentaire » : les sommes
  s'additionnent par classification.
- Entrée non catégorisée (rangée dans aucun groupe) : non comptée.
- Entrée rangée dans un groupe de sens `in` sans `income_kind` (cas théorique,
  non produit par le nouveau formulaire) : non comptée comme principal ni
  supplémentaire.
- Le solde affiché reste le chiffre de la banque ; comportement inchangé.

## Tests

- `monthRemuneration` : principal/supplémentaire calculés depuis la
  classification du groupe (un groupe principal récurrent, un groupe
  supplémentaire enveloppe, transactions rangées dedans), mois filtré,
  non-catégorisé ignoré, plusieurs groupes de même classification additionnés.
- `groups` repository : `insertRecurringGroup`/`insertEnvelopeGroup` posent et
  relisent `income_kind` ; `listGroups` le renvoie.
- Migration : ajout idempotent de la colonne `income_kind` sur `groups`.
- Rappel : vérifier au serveur réel (pas seulement `:memory:`).

## Hors périmètre

- Changer la classification d'un groupe existant via l'édition (on recrée si
  besoin).
- Retirer physiquement la colonne `transactions.income_kind` (laissée inutilisée).
- Réintroduire un montant attendu de rémunération ou un champ saisi par mois.
