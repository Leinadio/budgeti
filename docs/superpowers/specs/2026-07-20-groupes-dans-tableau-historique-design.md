# Création et gestion des groupes dans le tableau de l'Historique

## Objectif

Supprimer l'onglet Groupes et déplacer toute la gestion des groupes
(enveloppes et récurrents) directement dans le tableau de l'Historique. Un
groupe gagne une durée de vie : un mois de départ, et une fin soit immédiate
(ponctuel) soit jamais (permanent). Au passage, retirer le code mort des
mots-clés, obsolète depuis le passage au rattachement manuel des transactions.

## Contexte actuel

- Les groupes vivent dans la table `groups` (`id`, `account_id`, `name`,
  `direction` in/out, `kind` envelope/recurring, `monthly_amount`,
  `income_kind`). Ils apparaissent aujourd'hui dans **tous** les mois.
- Un groupe enveloppe a un `monthly_amount`. Un groupe récurrent a des lignes
  (`group_lines` : `name`, `amount`, `day`) dont la somme fait son budget ; les
  jours servent au Prévisionnel pour placer les prélèvements.
- Le rattachement transaction → groupe est **100 % manuel** via `group_id`
  (voir `src/lib/ownership.ts`). Les mots-clés (`group_keywords`,
  `group_lines.keyword`, `OwnableGroup.keywords`) ne servent plus à rien :
  `resolveOwnership` les ignore. C'est du code mort.
- Les budgets datés (`budget_amounts`, `budgetInForce`) permettent déjà de
  changer le montant d'un groupe à partir d'un mois précis, sans rétroactivité.
- Le tableau affiche une plage de mois (`MonthRangePicker`, de `from` à `to`,
  jusqu'à 12 mois dans le futur). `currentMonth` est le vrai mois calendaire.

## Durée de vie d'un groupe

C'est la nouveauté structurante. Un groupe reçoit deux bornes :

- **Mois de départ** (`start_month`, clé `YYYY-MM`) : le groupe n'apparaît
  jamais dans un mois strictement antérieur. Choisi à la création (par défaut le
  mois affiché, mais librement décalable vers un mois futur).
- **Mois de fin** (`end_month`, clé `YYYY-MM`, nullable) :
  - Groupe **ponctuel** : `end_month = start_month`. Le groupe n'existe que ce
    mois-là et disparaît dès le mois suivant.
  - Groupe **permanent** : `end_month = NULL`. Le groupe vit indéfiniment à
    partir de son mois de départ.

Règle d'existence, appliquée partout où l'app parcourt les groupes : un groupe
est visible au mois `m` si et seulement si `start_month <= m` et
(`end_month` est NULL ou `m <= end_month`).

Cette règle touche : l'Historique (`computeHistory`), les projections, le
Prévisionnel (`computeForecast`), et les dépassements (`computeOverspends`). Le
montant continue de reposer sur `monthly_amount` (montant de base) et sur les
budgets datés (`budget_amounts`) pour les changements ultérieurs.

## Écran : tableau de l'Historique

### Séparation visuelle entrant / sortant

Un léger fond teinté sépare le bloc du haut (ce qui rentre : Rémunérations) du
bloc du bas (ce qui sort : Récurrents et Enveloppes). Teinte discrète, cohérente
avec les colgroup tints existants.

### Bouton + par section sortante

Chaque section sortante (Récurrents, Enveloppes) porte un bouton + à gauche.
Le clic ouvre un formulaire de création inline dans cette section.

### Formulaire de création — enveloppe

Champs : **nom**, **montant**, **mois de départ** (select, valeurs possibles de
`currentMonth` jusqu'à `stripMax` ; défaut = le mois affiché s'il est dans cette
plage, sinon `currentMonth` — jamais un mois passé), **portée** (ponctuel /
permanent).

À la validation : insertion d'un groupe enveloppe avec `monthly_amount = montant`,
`start_month`, `end_month` (= `start_month` si ponctuel, sinon NULL).

### Formulaire de création — récurrent

Champs : **nom**, **mois de départ**, **portée**. Pas de montant (il vient des
lignes). Les lignes (`name`, `amount`, `day`) s'ajoutent ensuite dans le side
panel. À la validation : insertion d'un groupe récurrent avec `start_month`,
`end_month`.

## Side panel : gestion d'un groupe existant

Au survol de la ligne d'un groupe, un petit menu (icône discrète) apparaît. Le
clic ouvre le side panel de droite (le même que le détail des montants) en mode
gestion du groupe, avec :

- **Renommer** le groupe.
- **Changer le montant** (enveloppes), avec un choix de portée : soit seulement
  pour le mois affiché, soit à partir de ce mois pour la suite. Réutilise les
  budgets datés (`budget_amounts`) : « ce mois seulement » et « à partir de ce
  mois » se traduisent en écritures datées.
- **Gérer les lignes** (récurrents) : ajouter, modifier, supprimer une ligne
  (`name`, `amount`, `day`).
- **Supprimer** le groupe.

Le clic sur le **nom** du groupe reste réservé au dépliage/repliage des
transactions ; il ne déclenche pas la gestion.

### Suppression

Supprimer un groupe le fait disparaître partout (tous les mois). Ses
transactions perdent leur rattachement (`group_id` remis à NULL) et retombent
dans Non catégorisés, y compris dans les mois passés. L'historique se recalcule.

## Rémunérations

Les rémunérations (principale, supplémentaire) restent un type à part, sans
durée de vie ni ponctuel : elles restent permanentes et présentes dans tous les
mois comme aujourd'hui. Comme l'onglet Groupes disparaît, on ajoute dans
l'Historique un **bouton dédié** pour créer la Rémunération principale et la
supplémentaire, en réutilisant la mécanique existante (`insertEnvelopeGroup` /
type revenu, limite d'une principale et une supplémentaire par compte via
`hasIncomeGroup`).

## Nettoyages

Deux nettoyages vont de pair avec ce chantier :

1. **Suppression de l'onglet Groupes** : retirer la page
   `src/app/groupes/page.tsx`, la route, les actions
   (`src/app/groupes/actions.ts`), l'entrée de menu dans la navigation, et les
   composants devenus inutiles (`NewGroupForm`, `group-editors`) une fois leurs
   fonctions reprises côté Historique.
2. **Retrait du code mort des mots-clés** : supprimer l'usage de
   `group_keywords`, du champ `group_lines.keyword`, de `OwnableGroup.keywords`
   et des branches `keywords` dans `history.ts`, `forecast.ts`,
   `remuneration.ts`. La table peut être laissée en place (inoffensive) mais
   n'est plus lue ni écrite. Vérifier qu'aucun chemin de catégorisation
   automatique ne subsiste.

## Modèle de données

Ajouts à la table `groups` (via `IF NOT EXISTS` / `ALTER TABLE` idempotent
au démarrage, cohérent avec la convention du projet) :

- `start_month TEXT` : clé `YYYY-MM`. Pour les groupes existants avant
  migration, valeur par défaut = `'2000-01'` (un mois très ancien) pour
  préserver leur visibilité actuelle dans tous les mois.
- `end_month TEXT NULL` : clé `YYYY-MM` ou NULL. Défaut NULL (permanent) pour
  les groupes existants.

Aucune nouvelle table. `budget_amounts` et `group_lines` restent tels quels.

## Tests

- **Durée de vie** (`src/lib/history.ts`, tests unitaires) : un groupe ponctuel
  n'apparaît que dans son mois de départ ; un permanent apparaît à partir de son
  mois de départ et jamais avant ; combiné avec les budgets datés et les
  dépassements.
- **Existence dans le Prévisionnel** (`forecast.ts`) : mêmes bornes respectées.
- **Suppression** (repository) : `group_id` des transactions remis à NULL, le
  groupe retiré, l'historique recalculé les fait apparaître en Non catégorisés.
- **Création** (repository) : enveloppe et récurrent créés avec les bonnes
  bornes selon la portée choisie.
- **Non-régression mots-clés** : après nettoyage, la catégorisation reste
  purement manuelle ; les tests existants d'`ownership` passent inchangés.
- Vérifier `tsc` propre et le serveur réel (les tests `:memory:` ne voient pas
  certains bugs runtime).

## Hors périmètre

- Refonte des rémunérations avec durée de vie (elles restent permanentes).
- Suppression physique de la table `group_keywords` (laissée inerte).
- Backdating d'un groupe avant le mois courant réel (le mois de départ va du
  mois affiché vers le futur, pas vers un passé arbitraire).
