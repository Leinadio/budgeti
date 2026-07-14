# Transactions manuelles + distinction rémunération principale / supplémentaire

Date : 2026-07-14

## Problème

Deux besoins liés de l'utilisateur.

1. Certains paiements, virements ou versements de rémunération ne sont pas
   synchronisés immédiatement par Enable Banking. La transaction n'apparaît donc
   pas tout de suite dans l'onglet Transactions. L'utilisateur veut pouvoir en
   saisir manuellement (entrée ou sortie) pour que ses vues restent à jour.

2. En début de mois l'utilisateur se verse une rémunération principale (montant
   variable : 652,09, 800, 900…). En cours de mois, s'il dépense trop, il doit se
   verser des rémunérations supplémentaires depuis un autre compte. Il veut
   différencier le principal du supplémentaire pour savoir de combien ajuster son
   versement principal les mois suivants, et voir ses dépenses du mois selon deux
   lectures : face au principal seul, et face au principal + supplémentaire.

Exemple : 1er juillet, versement principal 652,09. Le 15, dépenses 700, soit
47,91 de dépassement, donc virement supplémentaire de 47,91. Le mois prochain il
devrait se verser 700 au lieu de 652,09.

## État actuel (rappel)

- Toutes les transactions viennent de la synchro Enable Banking. Aucune voie de
  saisie manuelle. `upsertTransaction` fait un `INSERT OR IGNORE` sur un `id`
  fourni par la banque.
- Aucune colonne ne distingue « manuel » de « synchronisé ». Le seul flag est
  `excluded` (forcer « non catégorisé »).
- Un revenu n'est pas un concept à part : c'est une transaction à montant positif
  rattachée manuellement (`group_id`) à un groupe de sens `in`.
- `computeForecast` et `computeHistory` lisent toutes les transactions ; une
  transaction insérée alimente donc automatiquement dépensé/reçu, budgets et
  estimations.

## Décisions de conception

### Étiquetage manuel (pas automatique)

Le principal variant d'un mois à l'autre, on ne peut pas le déduire d'un montant
de référence fixe. Chaque revenu porte donc une étiquette explicite,
« principale » par défaut ; l'utilisateur marque les versements en plus comme
« supplémentaire ». Le principal du mois = somme des entrées non marquées
« supplémentaire » (une entrée non étiquetée compte comme principale).

### Rapprochement assisté, jamais automatique

Les virements saisis à la main finissent par arriver de la banque avec leur
propre identifiant, créant un doublon. L'app ne supprime jamais rien seule : elle
détecte les paires probables et propose la fusion. À la fusion, on garde la ligne
bancaire (nom, identifiant), on lui reporte le groupe et l'étiquette de la
saisie manuelle, le libellé manuel devient un petit commentaire, et la ligne
manuelle est supprimée. Un refus mémorise la paire pour ne plus la reproposer.

### Solde inchangé

« Solde actuel » reste le vrai chiffre de la banque. Une transaction manuelle en
attente n'y apparaît qu'une fois synchronisée ou fusionnée : honnête, sans double
comptage. Les transactions manuelles comptent en revanche comme les autres dans
les budgets et estimations. Un solde « provisoire » incluant les manuelles en
attente n'est pas dans le périmètre (option future).

## Modèle de données

Trois colonnes ajoutées à `transactions`, via migrations idempotentes basées sur
`PRAGMA table_info`, sur le modèle de `migrateTransactionExcluded` /
`migrateTransactionLineId`, appelées dans `getDb()` (`src/db/index.ts`).

- `manual INTEGER NOT NULL DEFAULT 0` — 1 = saisie à la main.
- `income_kind TEXT` — `'principal'` | `'supplementary'` | NULL. Renseignée pour
  une entrée ; NULL pour une dépense ou une entrée non étiquetée (traitée comme
  principale).
- `note TEXT` — commentaire libre ; reçoit le libellé manuel après une fusion.

Nouvelle table pour les rapprochements écartés :

```sql
CREATE TABLE IF NOT EXISTS reconcile_ignored (
  manual_id TEXT NOT NULL,
  synced_id TEXT NOT NULL,
  PRIMARY KEY (manual_id, synced_id)
);
```

Le schéma `src/db/schema.sql` est mis à jour pour refléter les colonnes et la
table (les bases neuves les obtiennent via le schéma, les bases existantes via
les migrations).

Génération d'`id` pour une transaction manuelle : `manual:` + `crypto.randomUUID()`.
Le préfixe évite toute collision avec un identifiant bancaire et se repère d'un
coup d'œil ; `manual = 1` reste la source de vérité pour la logique.

## Repository (`src/db/repositories/transactions.ts`)

- `TxnView` étendu : `manual: boolean`, `incomeKind: 'principal' | 'supplementary' | null`,
  `note: string | null`. `listTransactions` sélectionne les nouvelles colonnes.
- `insertManualTransaction(db, { accountId, date, amount, label, groupId, lineId, incomeKind })`
  — génère l'id, `manual = 1`, insère toutes les colonnes.
- `updateManualTransaction(db, id, { date, amount, label, groupId, lineId, incomeKind })`
  — édition d'une ligne manuelle (refuse si la ligne n'est pas `manual`).
- `deleteTransaction(db, id)` — suppression (utilisée par l'utilisateur et par la
  fusion). Restreinte aux lignes `manual` côté action.
- `setIncomeKind(db, id, kind)` — étiqueter une entrée principale/supplémentaire,
  y compris sur une ligne synchronisée (le principal peut arriver par la synchro).
- `findReconcileSuggestions(db)` — renvoie les paires { manual, synced } : même
  `account_id`, même `amount`, `|date manual − date synced| ≤ 5 jours`, `synced`
  non manuelle, paire absente de `reconcile_ignored`. Une ligne manuelle sans
  candidat n'apparaît pas.
- `mergeTransactions(db, { syncedId, manualId })` — dans une transaction SQLite :
  copie `group_id`, `line_id`, `income_kind` de la manuelle sur la synchronisée,
  met `note` de la synchronisée au libellé de la manuelle, supprime la manuelle.
- `ignoreMatch(db, manualId, syncedId)` — insère la paire dans `reconcile_ignored`.

`upsertTransaction` (voie de synchro) est inchangé : il insère les 6 colonnes de
base, les nouvelles prennent leurs valeurs par défaut (`manual = 0`, autres NULL).

## Server actions (`src/app/transactions/actions.ts`)

Nouvelles actions, chacune revalide `/transactions`, `/previsionnel`,
`/historique`, `/` :

- `addTransaction(input)` — validation (compte existant, date `YYYY-MM-DD`,
  montant fini non nul, sens), applique le signe selon Entrée/Sortie, appelle
  `insertManualTransaction`.
- `editTransaction(id, input)` — via `updateManualTransaction`.
- `removeTransaction(id)` — via `deleteTransaction`, seulement si `manual`.
- `mergeTransaction(syncedId, manualId)` — via `mergeTransactions`.
- `ignoreMatch(manualId, syncedId)` — via `ignoreMatch`.
- `setIncomeKind(id, kind)` — via `setIncomeKind`.

## UI

### Onglet Transactions (`src/components/transactions-browser.tsx`)

- Bouton « Ajouter une transaction » ouvrant un formulaire (Dialog shadcn) :
  compte (select), date, sens Entrée/Sortie (toggle), montant (positif saisi, le
  signe vient du sens), libellé, groupe (réutiliser `GroupSelectField` ou un
  select), et, seulement pour une Entrée, choix principale/supplémentaire.
- Les lignes manuelles portent un badge « manuel » ; « en attente » tant que non
  fusionnée. Actions modifier / supprimer sur ces lignes.
- Après fusion, la ligne bancaire affiche son libellé et, en dessous, en petit,
  le commentaire issu de `note` (le nom manuel).
- Bandeau de rapprochement en haut quand `findReconcileSuggestions` renvoie des
  paires : pour chaque paire, les deux lignes côte à côte, « Fusionner » et
  « Ce n'est pas la même ».

Les suggestions sont calculées côté serveur (page) et passées au composant.

### Onglet Historique (`src/app/historique/page.tsx`, nouveau composant d'encart)

Un encart par mois affiché, aligné sur les colonnes de la grille existante,
calculé à partir des transactions du compte et du mois :

- Principal reçu = somme des entrées du mois non marquées « supplémentaire ».
- Supplémentaire reçu = somme des entrées marquées « supplémentaire ».
- Total des dépenses du mois (groupes de sens `out`, cohérent avec la grille).
- Lecture 1 : dépenses face au principal → solde `principal − dépenses`, en
  rouge si négatif (dépassement visible).
- Lecture 2 : dépenses face au principal + supplémentaire → solde.
- Action : « verse-toi X le mois prochain », `X = principal + supplémentaire`.

La logique de calcul vit dans `src/lib/` (fonction pure testée), la page fournit
les données, l'encart n'affiche.

## Flux de données

1. Saisie manuelle → `addTransaction` → `insertManualTransaction` → la ligne
   existe (`manual = 1`), alimente immédiatement budgets, estimations et l'encart
   Historique via `computeForecast` / `computeHistory` / calcul de l'encart.
2. Synchro ultérieure → la vraie ligne bancaire est importée (id bancaire,
   `manual = 0`).
3. Page Transactions → `findReconcileSuggestions` détecte la paire → bandeau.
4. Fusion → `mergeTransactions` : une seule ligne subsiste (la bancaire), taguée
   comme la manuelle, avec le nom manuel en commentaire. Plus de doublon.
5. Refus → `reconcile_ignored`, paire non reproposée.

## Cas limites

- Ligne manuelle sans candidat de synchro : reste telle quelle, badge
  « en attente », aucune suggestion.
- Deux virements identiques la même semaine : détectés tous deux comme candidats ;
  l'utilisateur tranche à la main (jamais de fusion automatique).
- Suppression d'un groupe : `group_id` / `line_id` passent à NULL
  (`ON DELETE SET NULL` déjà en place) ; sans effet sur `manual` / `income_kind`.
- Entrée non étiquetée (ex. principal arrivé par synchro non encore tagué) :
  comptée comme principale dans l'encart.
- `editTransaction` / `removeTransaction` refusent d'agir sur une ligne non
  manuelle (garde-fou côté action).

## Tests

Logique pure dans `src/lib/`, testée avec des DB `:memory:` :

- Calcul de l'encart : principal, supplémentaire, dépenses, les deux soldes, la
  suggestion, y compris entrées non étiquetées comptées comme principales et mois
  sans revenu.
- `findReconcileSuggestions` : match même compte/montant/±5 jours ; pas de match
  au-delà de la fenêtre, autre compte, autre montant, paire déjà ignorée.
- `mergeTransactions` : report groupe/ligne/étiquette, `note` = libellé manuel,
  suppression de la manuelle, unicité finale.
- `insertManualTransaction` : id préfixé `manual:`, `manual = 1`, signe correct
  selon le sens.

Rappel connu : les tests `:memory:` ne voient pas certains bugs runtime ; vérifier
en lançant le vrai serveur (dossier `data/`, mots réservés SQL).

## Hors périmètre

- Solde provisoire incluant les transactions manuelles en attente.
- Rapprochement automatique sans confirmation.
- Étiquetage principal/supplémentaire limité à un groupe « rémunération » désigné
  (aujourd'hui : toutes les entrées ; en pratique la seule entrée est la
  rémunération).
