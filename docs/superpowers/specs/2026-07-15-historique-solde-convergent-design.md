# Historique : le tableau converge vers le solde du compte

## Contexte

Dans l'onglet Historique, le tableau affiche, mois par mois, les groupes
(rémunérations et dépenses) avec quatre colonnes : Budg., Dép., Reçu, Solde.

Aujourd'hui la colonne « Solde » ne veut pas dire la même chose selon la ligne :
pour une dépense c'est un écart au budget (budget − dépensé), pour une
rémunération c'est le montant reçu. Additionner cette colonne ne donne rien de
cohérent, et surtout pas le solde réel du compte affiché par la banque.

L'utilisateur veut que le tableau se lise de haut en bas comme son argent qui
bouge, et que le bas converge vers le **solde actuel du compte** (`f.balance`,
fourni par la banque).

## Objectif

Transformer la colonne « Solde » en **solde du compte cumulé** : en descendant
les lignes, chaque rémunération fait monter le solde, chaque dépense le fait
descendre, et la dernière ligne tombe exactement sur le solde de la banque pour
le mois en cours. Déplacer le suivi de budget (écart budget/dépensé) dans une
nouvelle colonne « Reste ».

## Design

### Colonnes (par mois)

Cinq colonnes au lieu de quatre :

| Colonne | Contenu | Lignes de rémunération (sens « in ») |
|---------|---------|--------------------------------------|
| Budg.   | Budget prévu | vide |
| Dép.    | Dépensé réel (sortie) | « — » |
| Reçu    | Reçu réel (entrée) | montant reçu |
| Reste   | Budget − dépensé ; rouge si négatif | vide |
| Solde   | Solde du compte cumulé (voir plus bas) | valeur cumulée |

La colonne « Reste » reprend l'ancienne sémantique budgétaire de « Solde »
(budget − dépensé, positif = dans les clous, négatif = dépassement en rouge).

### Deux nouvelles lignes

- **Argent de départ** : première ligne du corps du tableau. Seule la colonne
  Solde est remplie (= solde au début du mois affiché). Les autres colonnes
  sont vides.
- **Solde actuel** : dernière ligne (remplace / prolonge l'actuelle ligne
  « Total »). Colonne Solde = solde de fin (= `f.balance` pour le mois courant).
  On peut y afficher aussi les totaux Dép. / Reçu de la période.

### Solde cumulé

Le solde de la colonne Solde s'accumule en descendant les lignes, dans l'ordre
d'affichage déjà en place (rémunérations en tête de section, puis dépenses) :

```
Argent de départ                        1 050
─ Récurrents ─
  Rémunération principale   + 2 500     3 550
  Loyer                     -   800     2 750
  Assurance                 -   120     2 630
─ Enveloppes ─
  Rémunération suppl.       + 1 000     3 630
  Courses                   -   400     3 230
  ...
─ Non catégorisés ─         (net)       ...
Solde actuel                             2 450   (= banque)
```

- Chaque ligne de **groupe** (feuille) affiche dans Solde le montant du compte
  après application de cette ligne : solde précédent + Reçu (rémunération) ou
  − Dép. (dépense).
- Les **en-têtes de section** (Récurrents, Enveloppes, Non catégorisés) gardent
  leurs sous-totaux Dép. / Reçu / Reste mais laissent la colonne Solde **vide**,
  pour ne pas casser la lecture (un en-tête apparaît avant son contenu).
- Les transactions détaillées (lignes dépliées) n'ont pas de solde cumulé : ce
  sont des détails.
- Les **non-catégorisés** sont comptés dans le cumul (leur net entre/sort).

L'effet net d'un groupe utilise les montants **réalisés** (Dép. / Reçu réels),
pas le budget — c'est ce qui a réellement bougé sur le compte.

### Calcul de l'argent de départ (rembobinage)

On ne stocke pas le solde d'ouverture : on le retrouve à partir du solde de la
banque.

```
argent de départ (1er mois affiché)
  = solde banque (maintenant)
  − (somme signée de toutes les transactions affichées de la période,
     du début du 1er mois affiché jusqu'à maintenant)
```

où « signée » = entrées positives, sorties négatives.

**Propriété clé — convergence par construction** : comme l'argent de départ est
dérivé du solde de la banque et des lignes qu'on affiche, le bas du tableau
retombe **toujours exactement** sur le solde de la banque pour le mois courant.
Les mouvements exclus (`excluded`) ou antérieurs à la période sont absorbés dans
« Argent de départ » : on reste cohérent, on ne triche pas.

### Enchaînement des mois

- L'argent de départ d'un mois = solde de fin du mois précédent.
- **Mois passés / courant** : départ + mouvements réalisés du mois. Le mois
  courant se pin sur `f.balance` (solde maintenant, mois partiel) ; les mois
  passés se déduisent en rembobinant depuis là.
- **Mois futurs** : départ = solde estimé de fin du mois précédent, puis on
  applique les budgets prévus (comme la projection actuelle de `history.ts`,
  qui pose réalisé = budgété + dépassement pour les mois > courant). La colonne
  Solde devient la trajectoire de solde projeté, cohérente avec le Prévisionnel.

## Découpage technique

- **`src/lib/history.ts`** porte tout le calcul :
  - solde d'ouverture par mois (rembobinage depuis `f.balance`),
  - champ « reste » (budget − dépensé) par cellule,
  - solde cumulé par ligne de groupe, dans l'ordre d'affichage,
  - lignes « Argent de départ » et « Solde actuel » (ou données équivalentes
    exposées au composant).
  Le solde de la banque (`balance`) doit être passé à `computeHistory` (il vient
  déjà du forecast dans `historique/page.tsx`).
- **`src/components/history-grid.tsx`** ne fait qu'afficher : cinquième colonne
  « Reste », ligne de départ en haut, ligne de solde en bas, colonne Solde vide
  sur les en-têtes de section.

## Tests

Dans `src/lib/history.test.ts` (nouveau ou existant) :

- Le solde cumulé de la dernière ligne du mois courant égale `f.balance`.
- L'argent de départ + net des lignes affichées = solde de fin, mois par mois.
- Les soldes de fin s'enchaînent : fin du mois N = départ du mois N+1.
- La colonne « Reste » = budget − dépensé, négative en cas de dépassement.
- Les lignes de rémunération : Budg. et Reste vides, Reçu rempli, Solde cumulé
  en hausse.
- Un mois futur : la trajectoire de solde projeté part du solde estimé de fin du
  mois courant.

## Hors périmètre

- Pas de refonte du Prévisionnel ni du forecast lui-même.
- Pas de changement de la logique de catégorisation ni d'appartenance.
- Pas de stockage persistant du solde d'ouverture (toujours recalculé).
