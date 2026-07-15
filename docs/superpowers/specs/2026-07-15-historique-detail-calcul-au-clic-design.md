# Historique : estimé fin de mois partout + détail du calcul au clic

## Contexte

Onglet Historique, tableau (composant `history-grid.tsx`). Deux ajouts liés :

1. La ligne « Estimé fin de mois » n'est remplie que sur le mois courant. On veut
   l'afficher sur tous les mois.
2. Chaque montant du tableau doit devenir cliquable : au clic, un popover montre
   le détail du calcul qui aboutit à ce montant.

## Objectif

Rendre le tableau « auto-explicatif » : l'utilisateur clique sur n'importe quel
chiffre et comprend d'où il vient, sans quitter le tableau.

## Design

### 1. Estimé fin de mois sur tous les mois

La ligne « Estimé fin de mois », colonne Solde :
- **mois courant** = `forecast.currentEstimate` (comme aujourd'hui, −370,00).
- **autres mois** (passés et futurs) = `solde.closings[i]` (le solde projeté,
  identique à ce que porte la ligne « Solde actuel » sur ces colonnes).
- Rouge si négatif.

C'est le choix « Option B » validé avec l'utilisateur : sur les mois futurs, la
valeur est la même que « Solde actuel » (il n'y a pas de « réel » dans le futur,
seulement l'estimé).

### 2. Détail du calcul au clic (popover)

Chaque **montant non vide** du tableau devient le déclencheur d'un Popover
(clic ; reste ouvert jusqu'à un clic ailleurs — composant Radix Popover, pas une
infobulle au survol). Le contenu est un petit bloc « libellé → montant » avec un
total en bas.

Type de détail selon la cellule cliquée :

| Cellule | Détail affiché |
|---------|----------------|
| Budget d'un récurrent | Liste des postes (lignes) et leur montant → total |
| Budget d'une enveloppe | « Montant mensuel » = la valeur (pas de décomposition) |
| Dépensé / Reçu d'un groupe ou d'une ligne | Liste des transactions du mois → total |
| Dépensé projeté (mois futur) | « Budget X (+ dépassement reporté Y) » |
| Reste | Budget − Dépensé = Reste |
| Solde (colonne de droite, ligne de groupe) | Solde de la ligne précédente ± montant de la ligne = Solde |
| Sous-total de section (Budg/Dép/Reçu/Reste) | Somme des groupes de la section → total |
| Solde actuel (bas, colonne Solde) | Argent de départ + Total reçu − Total dépensé = Solde |
| Argent de départ | 1er mois : Solde banque − mouvements du mois ; sinon : solde de fin du mois précédent |
| Estimé fin de mois (mois courant) | Étapes du Prévisionnel (`forecast.currentSteps`) |
| Estimé fin de mois (autres mois) | = solde projeté de fin de mois (même détail que Solde actuel) |
| Dépassement | Liste des groupes en dépassement et leur montant → total |
| Montant d'une transaction individuelle | Pas de popover (rien à détailler) |
| Cellule vide, « — », en-tête | Pas de popover |

Format du popover : un titre court (ce que représente le montant), une liste
`libellé · montant` (montants signés, rouge/vert), et une ligne total en gras.
Réutilise le style du panneau « Détail du calcul » existant
(`forecast-detail-sheet.tsx` : composants `Line` / `Amount` / `Breakdown`).

## Découpage technique

- **`src/components/ui/popover.tsx`** : composant Popover shadcn/Radix (via le
  méta-paquet `radix-ui`, même pattern que `tooltip.tsx`).
- **`src/lib/history-explain.ts`** (nouveau, pur, testé) : type `CellExplanation`
  = `{ title: string; steps: { label: string; amount: number }[]; result: number; note?: string }`
  et des fonctions pures construisant l'explication à partir des données déjà
  disponibles :
  - `resteExplanation(budgeted, depense)`
  - `sumExplanation(title, entries)` (liste libellé/montant → total)
  - `runningExplanation(prevSolde, netLine)` (solde précédent ± net)
  - `soldeActuelExplanation(opening, recu, depense)`
  - Les cas « liste de transactions », « postes du récurrent », « dépassements »
    se ramènent à `sumExplanation`.
- **`src/components/history-grid.tsx`** :
  - Un wrapper `AmountCell` : rend la valeur ; si une `CellExplanation` est
    fournie, enveloppe la valeur dans un Popover cliquable (curseur pointer,
    léger soulignement au survol pour signaler la cliquabilité). Sinon rend une
    cellule normale.
  - Remplacer les cellules de montant (`AmountCells`, `TxnCells`, lignes du bas)
    par `AmountCell` en fournissant l'explication adaptée au contexte local
    (chaque site de rendu connaît sa ligne, sa colonne, son mois).
  - Ligne « Estimé fin de mois » remplie sur tous les mois (voir §1).

Toutes les données nécessaires sont déjà passées au composant (`sections`,
`solde`, `grand`, `forecast`, `overspend`, `months`, `currentMonth`) ou
présentes sur les lignes (`r.cells`, `r.subRows`, `r.txns`). Le détail
Dépensé/Reçu d'un groupe utilise `r.txns` + `r.subRows[].txns` du mois.

## Tests

Dans `tests/lib/history-explain.test.ts` :
- `resteExplanation(150.95, 114.82)` → steps Budget +150,95 / Dépensé −114,82,
  result 36,13.
- `sumExplanation` additionne les entrées et pose le bon total.
- `runningExplanation(530.21, -114.82)` → result 415,39.
- `soldeActuelExplanation(opening, recu, depense)` → opening + recu − depense.

La partie affichage (Popover) est vérifiée visuellement (`npm run dev`) : pas de
tests React dans le projet.

## Hors périmètre

- Aucun changement des calculs eux-mêmes ni du Prévisionnel.
- Pas de popover sur les cellules vides, les « — », les en-têtes, ni les montants
  de transactions individuelles.
- Pas de survol (hover) : uniquement au clic.
