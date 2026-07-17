# Historique : colonnes de projection (prévu / réel / dépassement)

## Objectif

Dans le tableau de l'Historique, cesser d'afficher de faux « Dépensé/Reçu » dans les
mois de projection, et rendre lisible la différence entre le prévu (budget), le réel,
et le scénario avec dépassements. On introduit des colonnes de solde dédiées, dont le
contenu dépend du type de mois.

## Problème actuel

Les mois futurs (marqués « projection ») remplissent Dépensé/Reçu avec des hypothèses
(`cellsFor` : réalisé futur = budget + dépassement pour une dépense, = montant pour la
principale). Ces cases ressemblent à des données réelles alors qu'elles sont des
projections. La colonne « Solde » d'un mois futur vaut aujourd'hui
`ouverture + revenus − (budget + dépassement)` : c'est déjà le scénario pessimiste,
mais sans distinction claire du scénario « je dépense pile mon budget ».

## Colonnes par type de mois

### Mois passés (terminés) — inchangés
`Budg | Dép | Reçu | Reste | Solde`
(Solde = réel. Aucune modification.)

### Mois courant — réel + prévisionnel côte à côte (8 colonnes)
`Budg | Dép | Reçu | Reste | Dépassement | Solde réel | Solde prévu | Solde si dépass.`
- Budg/Dép/Reçu/Reste : comme aujourd'hui (réel du mois en cours).
- Dépassement : dépense au-delà du budget, réellement constatée ce mois-ci (— si aucune).
- Solde réel : solde cumulé réel (ancré au solde banque). C'est l'actuelle colonne Solde.
- Solde prévu / Solde si dépass. : voir Formules.

### Mois de projection (futurs)
`Budget | Revenus | Dépassement | Solde prévu | Solde si dépass.`
- Budget : budget de dépenses de la ligne (— pour un revenu).
- Revenus : revenu projeté de la ligne (montant de la principale ; — / 0 pour une
  dépense et pour la supplémentaire, non projetée).
- Dépassement : dépense au-delà du budget, reportée du mois courant (— si aucune).
- Solde prévu / Solde si dépass. : voir Formules.

Les deux lignes du bas actuelles (« Estimé fin de mois », « Dépassement ») sont
**conservées** telles quelles.

## Formules

Trois chaînes de solde, chacune cumulée ligne par ligne dans l'ordre d'affichage
(comme l'actuelle colonne Solde) :

1. **Solde réel** — inchangé : chaîne réelle de `computeSolde`, ancrée au solde banque
   au mois courant, rembobinée pour le passé. Affichée sur les mois passés et courant.
2. **Solde prévu** — net planifié `revenus projetés − budget de dépenses` :
   - `ouverture[m] + revenus[m] − budget[m]`, cumulé ligne par ligne.
   - Scénario « je dépense pile mon budget ». Affiché mois courant + projection.
3. **Solde si dépass.** — `Solde prévu − dépassement` :
   - `ouverture[m] + revenus[m] − (budget[m] + dépassement[m])`, cumulé.
   - Scénario pessimiste (les dépassements du mois courant sont maintenus). C'est,
     pour les mois futurs, l'actuelle colonne Solde.

Grandeurs par mois :
- `budget[m]` = somme des budgets de dépenses (constant d'un mois à l'autre).
- `revenus[m]` = montant de la principale (tous les mois) + montant de la
  supplémentaire uniquement pour le mois courant (aligné sur la règle déjà livrée :
  la supplémentaire compte dans l'estimé du mois courant, pas dans les projections).
- `dépassement[m]` = dépense au-delà du budget. Mois courant : dépassement réel
  constaté. Mois futurs : dépassement du mois courant reporté (« maintenu »),
  comme aujourd'hui.

## Ancrage des chaînes prévues (décision de modélisation)

- Les chaînes « Solde prévu » et « Solde si dépass. » démarrent à l'**argent de départ
  réel du mois courant** (`openings[currentMonth]` de `computeSolde`, rembobiné depuis
  la banque), puis s'enchaînent : la clôture prévue d'un mois est l'ouverture prévue du
  suivant. Elles ignorent délibérément le réel déjà passé du mois courant (c'est un
  scénario « plan »), d'où l'écart visible avec « Solde réel » au mois courant — c'est
  l'intérêt de la comparaison.
- Cas limites (fenêtre entièrement future ou entièrement passée) : reprendre la logique
  d'ancrage de `computeSolde` (si le mois courant est hors plage, ancrer sur la borne la
  plus proche ; si tout est passé, les colonnes prévu/dépass. ne s'affichent pas).

## Impact technique (esquisse, à détailler au plan)

- `src/lib/history.ts` :
  - `cellsFor` : ne plus fabriquer de faux `depense/recu` futurs pour l'affichage
    granulaire (les mois futurs n'affichent plus Dép/Reçu). Le calcul des soldes passe
    par les nouvelles chaînes plutôt que par des cellules « réalisées » projetées.
  - Nouvelle sortie de `computeSolde` (ou fonction sœur) : exposer, en plus de la
    chaîne réelle, les chaînes `prévu` et `dépassement` (openings/closings + running par
    ligne), à partir de `budget[m]`, `revenus[m]`, `dépassement[m]`.
- `src/components/history-grid.tsx` :
  - Le sous-en-tête (Budg/Dép/…) et le nombre de colonnes deviennent **fonction du type
    de mois** (passé = 5, courant = 7, projection = 5 aux libellés différents). Le
    `colSpan` de l'en-tête de mois s'ajuste.
  - Rendu des nouvelles colonnes (Budget/Revenus/Dépassement/Solde prévu/Solde si
    dépass.) par ligne, sous-total de section, et grand total.
  - Les lignes du bas « Estimé fin de mois » et « Dépassement » restent affichées.
- Détail cliquable / surbrillance croisée (side panel) : les nouvelles colonnes peuvent
  rester non cliquables dans un premier temps (le mécanisme `data-cellkey` connaît
  aujourd'hui budget/depense/recu/reste/solde ; l'étendre est un ajout séparé).
- Aucun changement de schéma / base : purement calcul + affichage.

## Hors périmètre

- Le modèle de données des groupes (rémunérations) : inchangé.
- `computeForecast` : inchangé (les lignes du bas continuent de l'utiliser).

## Points tranchés

1. **Solde prévu du mois courant** = « plan complet » `ouverture + revenus − budget`.
   Assumé : ce chiffre peut différer de la ligne « Estimé fin de mois » (qui part du
   solde banque + le restant) ; les deux coexistent, c'est accepté.
2. **Supplémentaire dans « Solde prévu »** : incluse au mois courant, exclue en
   projection (aligné sur l'existant).
3. **Colonne Dépassement** : affichée au mois courant ET dans les mois de projection.
4. **Largeur** : mois courant = 8 colonnes, accepté.
