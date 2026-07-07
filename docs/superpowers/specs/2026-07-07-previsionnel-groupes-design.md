# Prévisionnel par compte et groupes de budget

Date : 2026-07-07

## Objectif

Recentrer Budget CIC sur une question unique : combien d'argent me restera-t-il
à la fin du mois, et où j'atterris le mois suivant. L'app passe d'un suivi
rétrospectif (catégoriser le passé) à un prévisionnel (estimer l'avenir).

Étape 1 (ce document) : le coeur. Le modèle unifié en groupes, le moteur de
calcul, et l'écran Prévisionnel par compte.

Étape 2 (hors périmètre ici) : l'alerte de dépassement d'enveloppe avec
suggestion d'ajustement.

## Le principe : tout est un groupe

Un groupe est un poste de budget rattaché à un compte, avec un sens (entrée ou
sortie). Un groupe contient une ou plusieurs lignes. Le total d'un groupe est la
somme de ses lignes : c'est son poids mensuel.

Deux natures de lignes :

- Ligne datée (récurrent) : montant, jour du mois, mot-clé. Attendue une fois
  dans le mois. Exemple : Spotify 10 € le 3, crédit immo 1450 € le 5,
  locataires 1500 € le 1er. Sert aussi à la frise datée.
- Ligne enveloppe : montant, mot-clé, sans jour. Dépensée au fil de l'eau.
  Exemple : Courses 300 €, Carburant 80 €, Sorties 200 €.

La nature d'une ligne est déterminée par la présence d'un jour : jour renseigné
= récurrent daté ; jour absent = enveloppe. Les enveloppes sont toujours des
sorties (il n'existe pas d'enveloppe de rentrée).

Exemples chez l'utilisateur :

- Groupe Abonnements (courant, sortie) : Spotify le 3, Netflix le 8, iCloud le
  12... total ~100 €.
- Groupe Courses (courant, sortie) : une enveloppe de 300 €.
- Groupe Rémunération (courant, entrée) : une ligne datée, la rémunération de
  base le 1er.
- Groupe Crédit immo (joint, sortie) : une ligne datée 1450 € le 5.
- Groupe Locataires (joint, entrée) : une ligne datée 1500 € le 1er.

## Le moteur de prévisionnel

Le calcul est une fonction pure, par compte, sur le mois affiché.

### Rapprochement des vraies transactions

Une ligne « a été vue » ce mois-ci si au moins une vraie transaction du compte,
du mois courant, correspond :

- même compte que le groupe (`transaction.account_id = group.account_id`) ;
- libellé contient le mot-clé, comparaison insensible à la casse ;
- signe cohérent avec le sens : ligne « sortie » ne matche que les débits
  (`amount < 0`), ligne « entrée » ne matche que les crédits (`amount > 0`).

Le dépensé d'une enveloppe = somme des `Math.abs(amount)` des débits du compte,
du mois, dont le libellé contient le mot-clé.

### Mois en cours

```
estimé fin de mois (compte) =
    solde réel actuel du compte
  + pour chaque ligne d'entrée non encore vue ce mois : + son montant
  - pour chaque ligne datée de sortie non encore vue ce mois : - son montant
  - pour chaque ligne enveloppe : - le reste (max(0, montant - déjà dépensé))
```

Ce qui est déjà passé est déjà dans le solde réel, donc on ne compte que ce qui
n'a pas encore bougé : pas de double comptage. Les extras de rémunération non
déclarés ne sont pas prévus ; ils montent le solde réel à réception et
l'estimation se réajuste.

### Mois suivant

Aucune transaction réelle : projection pure.

```
début (compte)       = estimé fin de mois en cours (compte)
estimé fin (compte)  = début
                       + somme de toutes les lignes d'entrée
                       - somme de toutes les lignes de sortie (datées + enveloppes, montant plein)
```

La fin d'un mois alimente le début du suivant. Une dépense excessive ce mois-ci
fait baisser le solde réel, donc l'estimé courant, donc le point de départ du
mois prochain.

### Frise datée

Pour l'affichage : la liste des lignes datées du compte, triées par jour, avec
leur statut (vue / à venir) selon le rapprochement du mois courant. Les
enveloppes n'apparaissent pas dans la frise (pas de date).

## Modèle de données

### Table `groups` (nouvelle)

```sql
CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  name TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out'))
);
```

### Table `group_lines` (nouvelle)

```sql
CREATE TABLE IF NOT EXISTS group_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  amount REAL NOT NULL,          -- euros positifs, toujours >= 0
  day INTEGER,                   -- 1..31 pour un récurrent daté ; NULL pour une enveloppe
  keyword TEXT NOT NULL          -- matché insensiblement à la casse contre le libellé
);
```

Le sens vit sur le groupe (toutes les lignes d'un groupe partagent le même
sens). Le montant est toujours positif ; le signe se déduit de `direction`.

### Migration

`schema.sql` crée les nouvelles tables via `CREATE TABLE IF NOT EXISTS`. La
migration est non destructive : on ajoute `groups` et `group_lines`, on ne
touche pas aux tables existantes.

Les tables `budgets` et `recurring_payments` deviennent dormantes (plus lues par
l'app une fois les écrans Récurrents et Budgets remplacés). On ne les supprime
pas : pas de perte de données, migration triviale et idempotente. Le nettoyage
du code mort (repos/lib/tests des anciens budgets et récurrents) fait partie du
périmètre ; la suppression des tables elles-mêmes est repoussée.

## Logique métier (lib)

### `src/lib/forecast.ts` (nouveau)

```ts
export type Direction = "in" | "out";

export type GroupLine = {
  id: number;
  name: string;
  amount: number;       // euros positifs
  day: number | null;   // récurrent daté si non nul, enveloppe si nul
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

export type TimelineItem = {
  day: number;
  name: string;
  amount: number;       // signé : négatif pour une sortie, positif pour une entrée
  seen: boolean;
};

export type GroupView = {
  id: number;
  name: string;
  direction: Direction;
  total: number;        // somme des montants des lignes
  spent: number;        // pour les groupes de sortie : somme des enveloppes déjà dépensées + datées vues
};

export type AccountForecast = {
  accountId: string;
  balance: number;          // solde réel actuel
  currentEstimate: number;  // estimé fin du mois courant
  nextEstimate: number;     // estimé fin du mois suivant
  timeline: TimelineItem[]; // lignes datées du compte, triées par jour
  groups: GroupView[];      // groupes du compte pour l'affichage
};

export function computeForecast(
  balance: number,
  groups: Group[],          // groupes d'UN compte
  txns: Txn[],              // transactions du compte (tous mois confondus)
  month: string,            // mois en cours, format YYYY-MM
): AccountForecast;
```

- `month` obtenu via `monthKey` (déjà dans `src/lib/money.ts`).
- Une ligne datée est « vue » s'il existe une transaction du mois, du compte, de
  signe cohérent, dont le libellé contient le mot-clé (casse ignorée).
- `spent` d'une enveloppe = somme des `Math.abs(amount)` des débits du mois qui
  matchent le mot-clé.
- Le calcul du mois suivant applique tous les montants pleins (aucune
  transaction réelle du mois suivant n'est considérée).

## Repositories

### `src/db/repositories/groups.ts` (nouveau)

```ts
export type GroupRow = {
  id: number;
  accountId: string;
  name: string;
  direction: "in" | "out";
  lines: {
    id: number;
    name: string;
    amount: number;
    day: number | null;
    keyword: string;
  }[];
};

export function listGroups(db): GroupRow[];                 // tous les groupes, lignes incluses, triés par nom
export function insertGroup(db, accountId, name, direction): number;   // retourne l'id du groupe
export function deleteGroup(db, id): void;                  // supprime le groupe et ses lignes (ON DELETE CASCADE)
export function insertLine(db, groupId, name, amount, day, keyword): void;
export function deleteLine(db, id): void;
```

Toutes les requêtes paramétrées. `deleteGroup` s'appuie sur `ON DELETE CASCADE` ;
`foreign_keys` est déjà activé dans `getDb`.

## Écrans

### Page Prévisionnel (`src/app/previsionnel/page.tsx`, nouvelle)

- `export const dynamic = "force-dynamic"`.
- Une `Card` par compte synchronisé. En tête : le nom du compte. Trois chiffres
  en évidence : Solde actuel, Estimé fin de mois, Estimé mois prochain.
- La frise datée : liste des lignes datées du compte triées par jour, montant
  signé, celles déjà vues grisées, celles à venir en clair.
- Les groupes du compte avec leur total ; pour les groupes de sortie, un
  indicateur dépensé / total (réutiliser `Progress` comme les enveloppes
  actuelles).
- Données : `listAccounts`, `listTransactions`, `listGroups`, puis
  `computeForecast` par compte (filtrer groupes et transactions du compte).

### Page Groupes (`src/app/groupes/page.tsx` + `actions.ts`, nouvelle)

- `export const dynamic = "force-dynamic"`.
- Formulaire de création de groupe : `Input` nom, sélecteur de compte (liste des
  comptes), sélecteur de sens (Entrée / Sortie), `Button`.
- Pour chaque groupe : son total, la liste de ses lignes, un formulaire d'ajout
  de ligne (`Input` nom, `Input type="number"` montant, `Input type="number"`
  jour optionnel, `Input` mot-clé, `Button`), et la suppression de ligne et de
  groupe (`<form>` + `Button` + `input hidden`).
- Actions serveur : `addGroup`, `removeGroup`, `addLine`, `removeLine`. Chacune
  `revalidatePath("/groupes")` et `revalidatePath("/previsionnel")`.

### Navigation (`src/app/layout.tsx`, mise à jour)

- Ajouter `Prévisionnel` et `Groupes`.
- Retirer `Récurrents` et `Budgets` (remplacés par le modèle unifié).

### Tableau de bord (`src/app/page.tsx`, mise à jour)

- Retirer les cartes Récurrents et Enveloppes (portées désormais par
  Prévisionnel). Conserver le solde total, le dépensé du mois, et les cartes par
  compte avec leurs dernières transactions.

### Nettoyage

- Supprimer les pages `src/app/recurring/` et `src/app/budgets/` et leurs
  `actions.ts`.
- Supprimer le code mort une fois non référencé : `src/lib/recurring.ts`,
  `src/lib/budget.ts`, `src/db/repositories/recurring.ts`,
  `src/db/repositories/budgets.ts`, et les tests associés. Les tables SQL
  correspondantes restent en place (dormantes).

## Tests

- `tests/lib/forecast.test.ts` (nouveau) :
  - ligne datée de sortie non vue : soustraite du courant ; vue : ignorée (déjà
    dans le solde) ;
  - ligne datée d'entrée non vue : ajoutée ; vue : ignorée ;
  - enveloppe : reste = max(0, montant - dépensé), soustrait ; dépassement borné
    à 0 ;
  - rapprochement insensible à la casse, filtré par compte et par signe ;
  - mois suivant : part de l'estimé courant, applique tous les montants pleins ;
  - frise triée par jour avec le bon statut vu/à venir.
- `tests/db/repositories.test.ts` (ajouts) : groupes et lignes, insert/list/
  delete ; suppression en cascade des lignes à la suppression d'un groupe.
- `tests/db/schema.test.ts` (mise à jour) : présence de `groups` et
  `group_lines`.

## Risques

- Le rapprochement par mot-clé dépend de la qualité des libellés bancaires. Un
  mot-clé trop large peut matcher plusieurs lignes ; comportement assumé, à
  l'utilisateur de choisir des mots-clés discriminants.
- L'estimé du mois suivant ignore les dépenses variables non budgétées : c'est
  voulu, il ne projette que ce qui est déclaré.

## Hors périmètre (étape 2 ou plus tard)

- Alerte de dépassement d'enveloppe et suggestion d'ajuster le montant.
- Suppression des tables SQL `budgets` et `recurring_payments`.
- Groupes partagés entre comptes ; ordre d'affichage personnalisé.
- Prévision au-delà du mois suivant.
- Rentrées ponctuelles déclarées à l'avance (les extras restent à réception).
