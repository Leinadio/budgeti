# Budgets datés : une seule source de vérité

Date : 2026-07-29

## Le problème

Le montant d'un groupe se lit aujourd'hui à deux endroits qui peuvent se
contredire.

D'un côté un montant de base : `groups.monthly_amount` pour une enveloppe, la
somme des `group_lines.amount` pour un récurrent. De l'autre la table
`budget_amounts`, qui pose un montant à partir d'un mois donné et écrase le
montant de base pour ce mois et les suivants.

Deux écrans écrivent dans `budget_amounts` : le bouton « Permanent » d'un
dépassement, et le champ « Montant pour <mois> » du panneau « Gérer le groupe ».
Mais ce même champ **affiche** le montant de base. Dès qu'un montant daté existe,
ce qui est affiché n'est plus ce qui s'applique.

Pour un récurrent c'est pire : « Permanent » pose un montant sur le groupe, alors
que le budget du groupe est censé être la somme de ses lignes. Le groupe et ses
lignes divergent sans que rien ne le signale.

Deux défauts secondaires, tant qu'on y est.

`decideOverspend` écrit la hausse à `mois courant + 1`, pas à
`mois du dépassement + 1`. Trancher un vieux dépassement relève donc le budget au
mauvais endroit. `undoOverspendDecision` supprime au même mauvais mois.

`updateGroupMonthlyAmount` et `updateLineAmount` (`src/db/repositories/groups.ts`)
n'ont aucun appelant : code mort.

## Ce qu'on décide

Le budget d'un groupe **est** une suite de montants datés. Rien d'autre. Le
montant saisi à la création devient la première entrée de la suite, au mois de
départ du groupe.

Pour un récurrent, la suite descend au niveau des lignes. Chaque ligne a son
propre historique de montants ; le budget du groupe pour un mois est la somme de
ses lignes telles qu'elles sont ce mois-là. Un récurrent n'a plus jamais de
montant à lui, donc plus aucun écart possible entre le groupe et ses lignes.

### Hors périmètre

Le verrouillage des mois passés a été envisagé puis abandonné. Tout reste
modifiable, y compris un mois passé.

« Exceptionnel » continue de ne changer aucun montant. Il note seulement que le
dépassement ne reviendra pas, pour que les mois suivants ne le reportent pas.

## Modèle de données

`budget_amounts` ne change pas. Elle reste la suite des montants des enveloppes,
et du groupe 0 (provision des non catégorisés).

Nouvelle table, même forme, pour les lignes de récurrent :

```sql
CREATE TABLE IF NOT EXISTS line_amounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  line_id INTEGER NOT NULL REFERENCES group_lines(id) ON DELETE CASCADE,
  effective_month TEXT NOT NULL,   -- YYYY-MM
  amount REAL NOT NULL,
  UNIQUE(line_id, effective_month)
);
```

`ON DELETE CASCADE` : supprimer une ligne emporte son historique.

Les colonnes `groups.monthly_amount` et `group_lines.amount` restent en place —
les retirer coûterait une reconstruction de table pour rien — mais **aucun calcul
ne les lit plus**. Elles ne sont conservées que parce que les `INSERT` existants
les remplissent encore. `updateGroupMonthlyAmount` et `updateLineAmount` sont
supprimés : garder un moyen d'écrire dans un champ que personne ne lit est
exactement le piège dont on sort.

## Résolution d'un montant

Le montant en vigueur à un mois `M` est celui de la dernière entrée dont
`effective_month <= M`. **S'il n'y en a aucune, le montant est 0**, sans repli sur
le montant de base : c'est ce repli qui créait la double source de vérité.

La reprise de données garantit qu'une entrée existe toujours au mois de départ, et
l'interface interdit de supprimer cette première entrée (elle se modifie, elle ne
s'efface pas). Le cas « 0 par absence d'entrée » ne doit donc jamais se produire,
mais il est défini plutôt que laissé au hasard.

Dans `src/lib/history.ts` :

- `budgetInForce(g, month, dated, datedLines)` : pour une enveloppe, la suite du
  groupe ; pour un récurrent, la somme de `lineAmountInForce` sur ses lignes.
- `lineAmountInForce(lineId, month, datedLines)` : nouvelle fonction, même règle.
- `budgetOf` disparaît.

`computeHistory` reçoit les montants datés des lignes en plus de ceux des groupes.
La ligne de détail d'un récurrent (`history.ts:240`) affiche aujourd'hui `l.amount`
constant sur tous les mois : elle doit afficher le montant du mois.

`computeForecast` (`src/lib/forecast.ts`) lit encore `monthlyAmount` et
`line.amount`. Il est appelé par la page Historique pour le détail du mois courant.
Il reçoit les mêmes montants datés, sinon le prévisionnel affiche des chiffres
faux dès la première hausse.

## Reprise de données

Migration, en une passe, à faire une seule fois :

1. Pour chaque enveloppe, y compris les rémunérations, écrire `monthly_amount` dans
   `budget_amounts` à `start_month` (ou `2000-01` si `start_month` est vide), sauf
   si une entrée existe déjà à ce mois.
2. Pour chaque ligne de récurrent, écrire `amount` dans `line_amounts` au
   `start_month` de son groupe, même règle.
3. Les entrées datées déjà posées sur un groupe **récurrent** devraient être
   converties en montants de lignes. La base réelle n'en contient aucune
   aujourd'hui (seules deux entrées existent, sur le groupe 0, à 0). La migration
   journalise donc ce cas et le laisse tel quel plutôt que d'inventer une
   répartition. Si le cas se présente, il sera traité à la main.

Après passage, tous les chiffres affichés doivent être identiques au centime.
C'est la première chose testée, et rien n'avance tant que ce n'est pas vrai.

## Les deux boutons d'un dépassement

### Exceptionnel

Inchangé. Enregistre la décision, n'écrit aucun montant.

### Permanent, sur une enveloppe

Le formulaire ne change pas : un montant, pré-rempli à budget + dépassement,
ajustable. Seul le mois d'effet change, de `mois courant + 1` à
`mois du dépassement + 1`.

### Permanent, sur un récurrent

Le formulaire liste les lignes qui ont dépassé ce mois-là, chacune avec son
nouveau montant pré-rempli au montant réellement payé, ajustable. Valider écrit
une entrée `line_amounts` par ligne, à `mois du dépassement + 1`.

Si le groupe dépasse sans qu'aucune de ses lignes ne dépasse — la dépense est
rattachée au groupe par mot-clé, sans ligne — le formulaire le dit et renvoie vers
l'édition des lignes. Il n'invente pas de répartition.

Le calcul de ces écritures est une fonction pure de `src/lib/`, qui prend le
groupe, le mois, et le dépensé par ligne, et rend la liste des écritures à poser.
L'action serveur ne fait que les appliquer.

### Annuler une décision

Symétrique : les entrées posées par « Permanent » sont retirées, au bon mois et
sur les bonnes lignes. Pour retrouver quoi retirer sans stocker de lien, on
recalcule les écritures qu'aurait produites la décision et on supprime celles qui
existent encore à l'identique. Une entrée modifiée à la main depuis n'est pas
touchée.

## Interface

### Panneau d'une enveloppe

Le champ « Montant pour <mois> » affiche le montant en vigueur à ce mois. Le choix
entre « à partir de ce mois » et « ce mois seulement » reste.

En dessous, la vie du budget : une liste courte, du genre « montant de départ 250 »
puis « 300 à partir d'août 2026 ». Chaque changement se supprime d'un clic, ce qui
ramène au montant précédent. Le montant de départ ne se supprime pas, il se
modifie.

Tous les groupes actuels démarrent en `2000-01` : la première entrée s'affiche
« montant de départ », pas une date qui ne voudrait rien dire.

### Panneau d'un récurrent

Le champ montant du groupe disparaît, le groupe n'ayant plus de montant propre.
À la place, ses lignes avec leur montant du mois affiché, modifiables sur place,
même choix « ce mois seulement » ou « à partir de ce mois », même petite liste des
changements sous chacune.

### Tableau

Un montant qui change d'un mois sur l'autre reçoit un repère discret, pour voir la
hausse sans ouvrir le panneau.

## Tests

Tout commence par le test qui échoue. La logique vit dans `src/lib`, jamais dans un
composant.

1. **Reprise de données** (`tests/db/`) : sur une base peuplée comme la vraie, les
   budgets calculés avant et après migration sont égaux au centime, sur tous les
   groupes et tous les mois.
2. **Résolution** (`tests/lib/history.test.ts`) : montant en vigueur avant la
   première entrée, entre deux entrées, après la dernière ; somme des lignes pour
   un récurrent ; ligne créée après le début du groupe ; ligne supprimée.
3. **Écritures de « Permanent »** : enveloppe et récurrent, mois d'effet correct,
   ventilation sur les seules lignes en dépassement, cas sans ligne en
   dépassement, annulation symétrique, annulation après modification manuelle.
4. **`onceBudgetWrites`** : les tests existants restent verts, la sémantique « ce
   mois seulement » ne change pas.
5. **Panneau et repère du tableau** : pas de test unitaire utile. Vérification en
   lançant le vrai serveur, et c'est dit explicitement.

Les 273 tests existants sont verts avant de commencer et doivent le rester.

## Ordre de construction

1. Reprise de données, sous test d'égalité stricte.
2. Suite des montants de lignes, budget d'un récurrent devenu leur somme,
   `budgetOf` supprimé, `computeForecast` aligné.
3. « Permanent » au bon mois, ventilation sur les lignes, annulation symétrique.
4. Panneau d'édition et repère du tableau.
