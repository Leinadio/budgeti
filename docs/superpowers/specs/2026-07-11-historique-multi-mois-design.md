# Page Historique — grille multi-mois

Date : 2026-07-11

## Objectif

Comparer les mois entre eux : une grille en lecture seule inspirée d'Actual
Budget, groupes en lignes, mois en colonnes, pour répondre à « est-ce que je
dépense plus en carburant qu'il y a 3 mois ? ».

## Placement

Nouvelle page `/historique`, ajoutée à la barre latérale (à côté de Prévisionnel).

## Structure

Onglets par compte (comme Transactions et Prévisionnel). Dans chaque onglet, une
grille :

- **Lignes** = les groupes du compte, rangés en deux sections **Enveloppes** puis
  **Récurrents**, avec une ligne de **sous-total** par section.
- **Colonnes** = les mois présents dans les transactions du compte (pilotés par
  les données, pas de colonnes vides), du plus ancien au plus récent. Défilement
  horizontal si nécessaire (`overflow-x-auto`).
- Chaque mois = trois sous-colonnes **Budgété / Dépensé / Solde** (en-tête sur
  deux rangées : le mois en `colSpan=3`, puis les trois libellés).

## Chiffres

Pour un groupe et un mois :

- **Budgété** = budget du groupe, fixe. Enveloppe : `monthlyAmount`. Récurrent :
  somme des montants des lignes.
- **Dépensé** = somme des montants (valeur absolue) des transactions rattachées
  au groupe ce mois-là (propriétaire résolu via `resolveOwnership`, manuel ou
  auto ; les transactions forcées « non catégorisé » sont exclues).
- **Solde** = Budgété − Dépensé (mois par mois, **sans report**).

Sous-total de section par mois : somme des Budgété / Dépensé / Solde des groupes
de la section.

Couleur : le Solde s'affiche en rouge seulement pour un **dépassement réel**,
c'est-à-dire un groupe de **sortie** dont le Solde est négatif. Les groupes
d'entrée ne rougissent pas (recevoir plus que prévu n'est pas un problème).

## Architecture

- `src/lib/history.ts` (pur, testé) :
  - `type MonthCell = { budgeted: number; spent: number; balance: number }`
  - `type HistoryRow = { id, name, kind, direction, cells: MonthCell[] }`
    (cells alignées sur la liste des mois)
  - `type HistorySection = { kind: "envelope" | "recurring", rows: HistoryRow[], totals: MonthCell[] }`
  - `monthsWithData(txns): string[]` — mois distincts « YYYY-MM », triés croissant
  - `computeHistory(groups, txns, months): HistorySection[]`
- `src/app/historique/page.tsx` (serveur) : charge comptes, groupes,
  transactions ; par compte, calcule les mois et les sections, rend la grille.
- Barre latérale (`src/components/app-sidebar.tsx`) : nouvel item « Historique ».

Réutilise `resolveOwnership`, `formatEur`, `monthLabel`, et les composants
`Tabs`/`Table`.

## Tests

`tests/lib/history.test.ts` :
- `monthsWithData` : mois distincts, triés, ignore les doublons
- Dépensé par groupe et par mois (propriétaire résolu)
- transactions exclues non comptées
- Budgété : enveloppe (`monthlyAmount`) et récurrent (somme des lignes)
- Solde = Budgété − Dépensé
- sous-totaux de section par mois
- sections vides omises

## Hors périmètre

- Pas de report de solde d'un mois à l'autre (chaque mois est indépendant).
- Pas de budget par mois (le budget reste fixe).
- Pas de colonne « catégorie » figée au défilement (raffinement éventuel).
- Pas d'édition depuis la grille (lecture seule).
