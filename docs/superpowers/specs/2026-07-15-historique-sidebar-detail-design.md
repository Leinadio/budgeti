# Historique : détail du calcul dans une sidebar (au lieu du popover)

## Contexte

L'onglet Historique affiche un tableau où chaque montant est cliquable. Aujourd'hui
le clic ouvre un popover (petit encart flottant) avec un détail plat. On remplace
ce popover par une **sidebar à droite** montrant le détail complet, hiérarchique,
jusqu'aux transactions, présenté comme un **vrai calcul** (opérateurs +/−, total).

## Objectif

Au clic sur un montant, ouvrir une sidebar non-modale à droite qui explique
entièrement ce montant : les composants du calcul (dépliables), jusqu'aux
transactions individuelles, avec les additions et soustractions affichées comme
une opération arithmétique aboutissant au montant cliqué.

## Design

### Comportement

- On **retire le popover** du tableau (le composant `popover.tsx` reste dans le
  repo, simplement inutilisé ici).
- Cliquer un montant non vide **sélectionne** ce montant (cellule surlignée) et
  ouvre la sidebar. Cliquer un autre montant **remplace** le contenu. Un bouton
  **×** ferme la sidebar.
- **Non-modale** : pas de fond grisé, pas de fermeture au clic extérieur. Le
  tableau derrière reste cliquable et scrollable ; la sidebar est un panneau
  `position: fixed` à droite (pleine hauteur, ~380–420 px, défilement interne,
  bordure/ombre à gauche).
- État « montant sélectionné » porté dans le composant client `HistoryGrid`.

### Contenu de la sidebar

- **En-tête** : ce que représente le montant (ex. « Solde actuel · Juillet 2026 »,
  « Dépensé · Abonnements · Juillet 2026 ») et sa valeur (rouge si négatif). Bouton ×.
- **Le calcul**, présenté comme une opération :
  - Une ligne par composant : un **opérateur** (+ ou −), le **montant** (valeur
    absolue, aligné à droite), et le **libellé**.
  - Un **trait** de séparation, puis une ligne **« = »** avec le total, qui égale
    le montant cliqué.
  - Un composant qui est un **groupe** ou une **section** est **dépliable** :
    l'ouvrir affiche, en retrait, son propre sous-calcul (ses sous-groupes puis,
    au niveau le plus fin, ses transactions : date · libellé · montant). Le
    sous-calcul totalise la valeur du composant.
  - Une **transaction** est une feuille (non dépliable).

Les montants sont **signés** de façon cohérente : la somme signée des composants
d'un niveau égale la valeur du parent. Le signe pilote l'opérateur affiché (+ / −)
et on montre la valeur absolue.

### Détail par type de montant cliqué

| Montant cliqué | Composants (niveau 1) | Dépliables vers |
|----------------|-----------------------|-----------------|
| Dépensé / Reçu d'un groupe (ou d'un poste) | les transactions du mois | (feuilles) |
| Budget d'un récurrent | les postes (lignes) | (feuilles) |
| Reste | + Budget, − Dépensé | Dépensé → transactions |
| Solde (colonne, ligne de groupe) | + Solde précédent, ± mouvement de la ligne | mouvement → transactions |
| Sous-total de section (Dép./Reçu/Budget) | les groupes de la section | groupe → transactions |
| Solde actuel | + Argent de départ, puis chaque section (± net) | section → groupes → transactions |
| Argent de départ | + Solde banque, − mouvements de la période (rembobinés) | (feuilles) |
| Estimé fin de mois (mois courant) | + Solde actuel, ± étapes du Prévisionnel | (feuilles) |
| Estimé fin de mois (autres mois) | même détail que Solde actuel projeté | comme Solde actuel |
| Dépassement | les groupes en dépassement | (feuilles) |
| Reste vide / « — » / montant de transaction / cellule vide | non cliquable | — |

**Invariant** : le total affiché en bas de la sidebar égale toujours le montant
de la cellule cliquée ; le total de chaque sous-calcul égale la valeur du
composant déplié.

## Découpage technique

- **`src/lib/history-explain.ts`** (remplace la structure plate) : type d'arbre
  ```ts
  export type DetailNode = { label: string; amount: number; children?: DetailNode[] };
  export type CellDetail = { title: string; subtitle?: string; nodes: DetailNode[]; result: number; note?: string };
  ```
  et des fonctions pures (testées) construisant les `CellDetail`/`DetailNode` à
  partir d'entrées simples (montants + listes de transactions), sur le modèle des
  helpers actuels. `result = Σ nodes.amount` (signés).
- **`src/components/history-detail-sidebar.tsx`** (nouveau) : rend un `CellDetail`
  sous forme de calcul, avec nœuds dépliables (état d'ouverture local) et le
  panneau fixe non-modal + bouton ×.
- **`src/components/history-grid.tsx`** :
  - Retirer l'usage du Popover (`CellAmount` devient une cellule cliquable qui
    appelle `onSelect(detail)` au lieu d'ouvrir un popover ; garde le style
    « cliquable »). Marquer la cellule sélectionnée.
  - État `selected: CellDetail | null` ; rendre `<HistoryDetailSidebar detail={selected} onClose={...} />`.
  - Chaque site de rendu construit le `CellDetail` du montant (réutilise les
    transactions déjà disponibles : `r.txns`, `r.subRows[].txns`, `sec.rows`, etc.).

## Tests

`tests/lib/history-explain.test.ts` (adapté au nouveau modèle) :
- Un `CellDetail` de type somme : `result === Σ amounts`, opérateurs corrects.
- Reste : nodes `[+budget, −depense]`, result = budget − depense.
- Un nœud dépliable (groupe) dont les enfants (transactions) totalisent la valeur
  du nœud.
- Solde actuel : nodes `[départ, …sections]`, result = solde.

Affichage (sidebar, panneau, dépliage) : vérifié visuellement (`npm run dev`).

## Hors périmètre

- Pas de changement des calculs du tableau ni du Prévisionnel.
- On ne supprime pas `popover.tsx` (laissé pour un usage futur).
- Pas de sidebar sur les cellules vides, « — », ni les montants de transactions
  individuelles.
