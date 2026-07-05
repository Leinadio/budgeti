# Paiements récurrents et refonte des budgets

Date : 2026-07-06

## Objectif

Ajouter deux fonctionnalités à Budget CIC :

1. Paiements récurrents (abonnements) : définir un paiement avec un nom, un
   mot-clé et un montant mensuel prévu ; l'app relie le mot-clé aux vraies
   transactions du compte et calcule la dépense courante du mois.
2. Budgets : pouvoir créer un budget directement (nom + montant prévu) sans
   passer par la création manuelle d'une catégorie, avec un montant mensuel
   récurrent.

Les deux couches sont indépendantes et suivent le modèle de la feuille de
calcul de l'utilisateur (deux totaux séparés : Total Abonnements, Total
Budgets).

## Contraintes

- App locale, mono-utilisateur, SQLite (`data/budget.db`). Les données
  bancaires ne quittent pas la machine.
- Réutiliser les patterns existants : mot-clé insensible à la casse comme les
  règles ; `ensureCategory` pour créer une catégorie ; server actions +
  `revalidatePath` ; composants shadcn/ui déjà en place.
- Les montants prévus sont récurrents par défaut : définis une fois, appliqués
  à tous les mois. La dépense courante se calcule sur le mois affiché (mois en
  cours).
- Vérification finale en lançant le vrai serveur (les DB `:memory:` ne voient
  pas les bugs runtime — cf. CLAUDE.md).

## Modèle de données

### Table `recurring_payments` (nouvelle)

```sql
CREATE TABLE IF NOT EXISTS recurring_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  keyword TEXT NOT NULL,            -- matché insensiblement à la casse contre le libellé
  expected_amount REAL NOT NULL    -- montant mensuel prévu, euros positifs
);
```

### Table `budgets` (refonte)

Avant : `(id, category_id, month, limit_amount, UNIQUE(category_id, month))`.
Après :

```sql
CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  monthly_limit REAL NOT NULL,
  UNIQUE(category_id)
);
```

Le budget n'a plus de dimension mensuelle : un montant s'applique à tous les
mois.

### Migration

`schema.sql` utilise `CREATE TABLE IF NOT EXISTS` : il ne modifie pas une table
existante. Une migration idempotente dans `getDb()` (après `db.exec(SCHEMA)`)
détecte l'ancien schéma et le convertit :

- Détecter la présence de la colonne `month` sur `budgets` via
  `PRAGMA table_info(budgets)`.
- Si présente : créer une table temporaire au nouveau schéma, y insérer une
  ligne par `category_id` avec le montant du mois le plus récent (dernier
  montant connu), supprimer l'ancienne table, renommer la temporaire.
- Idempotent : si la colonne `month` est absente, ne rien faire.

## Logique métier (lib)

### `src/lib/recurring.ts` (nouveau)

```ts
export type RecurringPayment = { id: number; name: string; keyword: string; expected: number };
export type RecurringLine = { id: number; name: string; keyword: string; expected: number; spent: number };
export type RecurringSummary = { lines: RecurringLine[]; totalExpected: number; totalSpent: number };

export function computeRecurring(
  payments: RecurringPayment[],
  txns: { date: string; amount: number; label: string }[],
  month: string,
): RecurringSummary;
```

- Pour chaque paiement : `spent` = somme des `Math.abs(amount)` des transactions
  du mois (`monthKey(t.date) === month`) qui sont des débits (`amount < 0`) et
  dont le libellé contient le mot-clé, comparaison insensible à la casse.
- `totalExpected` = somme des `expected` ; `totalSpent` = somme des `spent`.

### `src/lib/budget.ts` (mise à jour)

`Budget` perd `month`. Signature :

```ts
export type Budget = { category: string; limit: number };
export function computeEnvelopes(txns: Txn[], budgets: Budget[], month: string): Envelope[];
```

`computeEnvelopes` ne filtre plus les budgets par mois (ils s'appliquent à tous
les mois). La dépense reste calculée sur les transactions catégorisées du mois
passé en argument. `Envelope` inchangé.

## Repositories

### `src/db/repositories/recurring.ts` (nouveau)

```ts
export type RecurringRow = { id: number; name: string; keyword: string; expected: number };
export function listRecurring(db): RecurringRow[];          // ORDER BY id
export function insertRecurring(db, name, keyword, expected): void;
export function deleteRecurring(db, id): void;
```

### `src/db/repositories/budgets.ts` (mise à jour)

```ts
export type BudgetRow = { category: string; limit: number };
export function listBudgets(db): BudgetRow[];               // JOIN categories, ORDER BY c.name
export function setBudget(db, category, limit): void;       // ensureCategory + upsert sur UNIQUE(category_id)
export function deleteBudget(db, category): void;
```

## Écrans

### Page Récurrents (`src/app/recurring/page.tsx` + `actions.ts`, nouveaux)

- `export const dynamic = "force-dynamic"`.
- Formulaire d'ajout (`<form action={addRecurring}>`) : `Input` nom, `Input`
  mot-clé, `Input type="number"` montant prévu, `Button`.
- `Card` + `Table` : colonnes Nom, Mot-clé, Dépense courante (mois en cours),
  Dépense prévue, action supprimer (`<form action={removeRecurring}>` +
  `Button variant` avec `input hidden name="id"`).
- Ligne de total en bas : Total courant / Total prévu.
- Actions serveur : `addRecurring` (name, keyword, expected), `removeRecurring`
  (id). `revalidatePath("/recurring")`.

### Page Budgets (`src/app/budgets/page.tsx` + `actions.ts`, refonte)

- Formulaire de création directe (`<form action={saveBudget}>`) : `Input` nom,
  `Input type="number"` montant prévu, `Button`. `saveBudget` lit `category` et
  `limit`, appelle `setBudget` (qui fait `ensureCategory`).
- `Card` + liste des budgets existants : Nom, Dépense courante (mois en cours),
  Dépense prévue éditable (`Input` + `Button` dans un form `saveBudget`),
  supprimer (`<form action={deleteBudgetAction}>` + id/catégorie).
- `saveBudget` conserve le nom `category`/`limit` dans le FormData ;
  `deleteBudgetAction` lit `category`. `revalidatePath("/budgets")`.

### Tableau de bord (`src/app/page.tsx`, mise à jour)

- Enveloppes : adaptées à `Budget` sans `month` (l'appel à `computeEnvelopes`
  passe les budgets sans dimension mensuelle). Rendu visuel inchangé.
- Nouvelle carte « Récurrents » : total courant / total prévu du mois via
  `computeRecurring`.

### Navigation (`src/app/layout.tsx`, mise à jour)

- Ajouter `{ href: "/recurring", label: "Récurrents" }` à la liste des liens
  (après Transactions, avant Budgets).

## Tests

- Nouveau `tests/lib/recurring.test.ts` : matching insensible à la casse, débits
  uniquement, filtre par mois, totaux.
- Nouveau `tests/db/repositories.test.ts` (ajouts) : `recurring` upsert/list/
  delete ; `budgets` set/list/delete au nouveau modèle.
- Mise à jour `tests/lib/budget.test.ts` : `Budget` sans `month`,
  `computeEnvelopes` sans filtre mensuel.
- Mise à jour `tests/db/schema.test.ts` et tests repo budgets existants : reflet
  du nouveau schéma `budgets` et de `recurring_payments`.
- Test de migration : partir d'une DB à l'ancien schéma `budgets` (avec `month`)
  et vérifier qu'après `getDb` la table est convertie en gardant le dernier
  montant par catégorie.

## Risques

- Migration de `budgets` sur la vraie base de l'utilisateur : la conversion doit
  être idempotente et préserver un montant par catégorie. Mitigation : test de
  migration dédié + vérification runtime sur le vrai serveur.
- Un paiement récurrent et un budget peuvent matcher la même transaction (couche
  parallèle) : comportement voulu, pas de déduplication.

## Hors périmètre

- Catégorisation automatique des transactions par les paiements récurrents.
- Historique mensuel des budgets (montants récurrents uniquement).
- Sélection/liaison manuelle de transactions individuelles (mot-clé auto seul).
- Édition du nom/mot-clé d'un récurrent après création (supprimer + recréer).
