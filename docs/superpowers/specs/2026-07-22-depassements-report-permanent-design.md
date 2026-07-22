# Refonte des décisions de dépassement : report opt-in et bandeaux par mois

Date : 2026-07-22

## Contexte

Aujourd'hui, un dépassement de budget non tranché est reconduit **par défaut**
sur tous les mois futurs dans la colonne « Solde si dépassement » (mécanisme
`retained` dans `computeOverspends`). Ce comportement s'est révélé trop
pessimiste et illisible : il suppose qu'un accident ponctuel (un plein d'essence
cher en juin) va se répéter chaque mois pour toujours, ce qui fait plonger les
soldes projetés et rend le tableau incompréhensible.

En parallèle, le choix « Permanent » relève automatiquement le budget du groupe
concerné (`setBudgetAmount` au mois courant + 1), modifiant le plan de
l'utilisateur « en douce ». Et les non catégorisés (groupe 0), faute de budget,
n'ont pas d'option « Permanent » du tout.

## Objectif

Inverser la logique : un dépassement est **exceptionnel (ponctuel) par défaut**.
Rien n'est reconduit tant que l'utilisateur ne l'a pas explicitement décidé. Le
choix « Permanent » devient le seul moyen de dire « ce dépassement va revenir »,
et son seul effet est de le reporter dans la colonne « Solde si dépassement » des
mois futurs — **sans jamais toucher au budget ni au « Solde prévu »**. La même
règle unique s'applique aux enveloppes, aux récurrents et aux non catégorisés.

## Le modèle

### Rôle des trois colonnes de solde (inchangé sur le principe)

- **Solde réel** : ce que dit vraiment le compte (transactions réelles).
- **Solde prévu** : le plan (argent de départ + revenus prévus − budgets). Il ne
  bouge **que** quand l'utilisateur modifie un budget à la main. Aucune décision
  de dépassement ne le touche.
- **Solde si dépassement** : le plan mis à l'épreuve. Il retire, mois par mois,
  les dépassements « qui vont continuer ».
  - Passé et mois en cours : retire les dépassements **réels** (comme
    aujourd'hui).
  - Mois futurs : retire uniquement les dépassements marqués **Permanent**. Si
    rien n'est marqué permanent, « Solde si dépassement » = « Solde prévu » sur le
    futur.

### La décision

Sur un dépassement (case Balance rouge d'un mois passé ou en cours), la carte de
décision pose une seule question, « ce dépassement va-t-il revenir ? », avec deux
boutons :

- **Exceptionnel** : ponctuel. Non reporté. Retiré des bandeaux.
- **Permanent** : va revenir. Reporté dans « Solde si dépassement » sur les mois
  futurs (montant retiré chaque mois, cumulé dans le solde courant). Retiré des
  bandeaux.
- **Non tranché** (défaut) : traité comme exceptionnel côté chiffres (non
  reporté), mais reste listé dans les bandeaux pour pouvoir être passé en
  permanent plus tard.

Cette carte est identique partout : enveloppes, récurrents et non catégorisés.
Le champ « nouveau budget » et le formulaire « permanent » disparaissent : deux
simples boutons.

### Report visuel (rappel de l'effet attendu)

Carburant, budget 85 €, dépassement de 7,71 € en juillet marqué permanent. Le
« Solde prévu » ne bouge pas ; « Solde si dépassement » décroche de 7,71 € de
plus chaque mois futur (l'écart se cumule) :

| Mois | Solde prévu | Solde si dépassement |
|------|-------------|----------------------|
| Août | 100,00 | 92,29 |
| Septembre | 60,00 | 44,58 |
| Octobre | 20,00 | −3,13 |

Les non catégorisés fonctionnent exactement pareil (même mécanique, aucun budget
ni provision créés). Un dépassement non catégorisé de 308,50 € marqué permanent
se retire de la même façon sur les mois futurs.

### Bandeaux par mois

En plus du bandeau global en haut (qui récapitule tous les dépassements à
trancher), chaque mois affiche, sous son en-tête, un bandeau listant les
dépassements **de ce mois-là** encore à trancher. Chaque élément, au clic, ouvre
la **même** carte de décision que le bandeau du haut (via
`overspendDecisionDetail`).

## Ce qu'on abandonne

- L'idée de « provision » pour les non catégorisés (un budget dédié au groupe 0)
  est **écartée** : le report opt-in via « Permanent » rend cette complexité
  inutile.
- « Permanent » ne relève plus de budget.

## Changements techniques

### `src/lib/history.ts` — `computeOverspends`

Le sens de `retained` s'inverse. Aujourd'hui `retained` = dépassement **non
tranché** le plus récent par groupe. Demain :

- `retained.byGroup[g]` / `retained.uncat` = dépassement marqué **permanent** le
  plus récent (c'est lui, et lui seul, que la projection reporte).
- `pending` / `pendingClosed` = dépassements **non tranchés** (inchangé, pour les
  bandeaux).
- Un dépassement tranché **exceptionnel** n'alimente ni `pending` ni `retained`.

Ajout : `pendingByMonth: Record<string, PendingOverspend[]>` (dépassements non
tranchés groupés par mois, mois courant inclus) pour les bandeaux par mois.

`computePlannedSoldes` n'a **pas** besoin de changer : il lit déjà `retained`
pour le `os` des mois futurs. Comme `retained` contient désormais les permanents,
le report devient opt-in automatiquement. La logique d'affichage par section
(remise à zéro du cumul par section, cumul global pour la clôture) reste telle
quelle.

### `src/app/historique/actions.ts`

- `decideOverspend` : supprimer la hausse de budget (`setBudgetAmount` +
  `newBudget`). Ne fait plus qu'enregistrer la décision. Le paramètre `newBudget`
  disparaît.
- `undoOverspendDecision` : simplifier — ne plus retirer d'entrée de budget
  (puisque permanent n'en crée plus). Ne fait que supprimer la décision.

### `src/db/repositories/*`

- `overspend-decisions.ts` : inchangé (les fonctions `set` / `get` / `delete`
  existent déjà).
- `budget-amounts.ts` : `deleteBudgetAmount` (ajouté récemment) devient inutile
  pour ce flux ; le laisser s'il ne sert nulle part ailleurs, sinon le retirer.

### `src/components/history-detail-sidebar.tsx` — `OverspendActionBlock`

- Deux boutons simples « Exceptionnel » / « Permanent », plus de formulaire de
  budget ni de champ « nouveau budget ».
- `decide(decision)` sans `newBudget`.
- Le bloc « décidé » garde « Modifier » et « Annuler » (déjà en place).

### `src/components/history-grid.tsx`

- Attacher `overspendAction` avec l'option **Permanent** aussi sur la ligne des
  non catégorisés (aujourd'hui « pas d'option permanent »).
- `currentBudget` sur `overspendAction` devient inutile (plus de formulaire) :
  nettoyer.
- Nouveau : un bandeau par mois sous l'en-tête, alimenté par `pendingByMonth`,
  ouvrant `overspendDecisionDetail` au clic. Placement dans la zone d'en-tête de
  chaque colonne de mois (sous le libellé mois/année).

### `src/components/overspend-banner.tsx`

- Réutiliser `overspendDecisionDetail` tel quel pour les bandeaux par mois
  (extraire un composant `OverspendChip` si utile pour éviter la duplication).

## Tests

- `computeOverspends` : un dépassement **permanent** alimente `retained` ; un
  **exceptionnel** n'alimente rien ; un **non tranché** alimente `pending` mais
  pas `retained`.
- `computePlannedSoldes` : sur un mois futur, seul un dépassement permanent est
  retiré du « Solde si dépassement » ; un non tranché ne l'est plus (régression
  de l'ancien comportement à retirer/adapter).
- `decideOverspend` : ne modifie plus aucun budget.
- Vérifier / mettre à jour les tests existants qui supposaient l'ancien report
  par défaut ou la hausse de budget sur « permanent ».

## Hors périmètre (idées pour plus tard)

- Convertir un dépassement non catégorisé récurrent en vraie enveloppe.
- Masquer/fusionner la colonne « Solde si dépassement » sur les mois futurs quand
  elle est identique à « Solde prévu ».
- Règle plus fine « ne reporter que ce qui dépasse plusieurs mois de suite ».
