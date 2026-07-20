# Design : décisions sur les dépassements et budgets datés

Date : 2026-07-20. Périmètre : onglet Historique, calcul des budgets et des
chaînes de solde. Statut : validé en brainstorm avec l'utilisateur.

## Problème

Aujourd'hui, l'app suppose que tout dépassement du mois courant se répétera
chaque mois futur (« dépassement maintenu »). C'est une supposition aveugle :
elle ne distingue pas un accident ponctuel d'une vraie dérive de budget, et
l'utilisateur n'a aucun moyen de corriger cette hypothèse. Par ailleurs, le
budget d'un groupe est un montant unique sans mémoire : le modifier réécrirait
rétroactivement l'historique des mois passés.

## Vue d'ensemble

Chaque dépassement (un groupe × un mois) porte un statut décidé par
l'utilisateur :

- **Non tranché** (état de naissance) : la colonne « Solde si dépassement »
  des mois futurs continue de le compter — hypothèse défavorable tant que
  rien n'est décidé (proposition « pessimiste en attendant »).
- **Exceptionnel** : c'était un coup unique. Il sort des projections ; seule
  sa trace historique reste (Balance rouge du mois concerné).
- **Permanent** : le poste coûte vraiment plus cher. Le budget du groupe est
  relevé via une fenêtre de validation (montant pré-rempli, ajustable),
  effectif au mois courant — jamais rétroactif. Le dépassement disparaît des
  projections parce qu'il est devenu du budget assumé, visible dans le
  Solde prévu.

L'écart entre « Solde prévu » et « Solde si dépassement » d'un mois futur
devient ainsi une jauge : il mesure exactement les dépassements encore non
tranchés, et se referme à mesure que l'utilisateur décide.

## Règles de calcul

### Dépassements retenus dans les projections

Pour chaque groupe de dépense, la projection retient **son dépassement non
tranché le plus récent** (mois courant inclus), pas la somme de tous ses mois
non tranchés — pour éviter les empilements si un groupe déborde plusieurs
mois de suite sans décision. Ce montant est soustrait dans la chaîne « Solde
si dépassement » de chaque mois futur, à la position du groupe (lecture de
haut en bas inchangée).

Le débordement net des Non catégorisés (dépensé au-delà des reçus non
catégorisés) suit la même règle : il est un « dépassement » comme les autres,
identifié par (non-catégorisés × mois), avec les mêmes trois statuts. Le cas
« permanent » n'a pas de budget à relever pour eux : l'option n'est pas
proposée, seuls « non tranché » et « exceptionnel » existent pour ce cas.

### Budgets datés

Le budget d'un groupe devient une suite de montants datés : « 85 jusqu'à
juillet 2026, puis 92,71 à partir d'août 2026 ». Concrètement :

- Nouvelle table `budget_amounts` : `group_id`, `effective_month`
  (« YYYY-MM »), `amount`. Le montant en vigueur pour un mois M est celui de
  la ligne avec le plus grand `effective_month` ≤ M ; s'il n'y a aucune ligne
  applicable, on retombe sur le `monthly_amount` du groupe. Aucune migration
  de données : la table démarre vide, le comportement actuel est le repli.
- `computeHistory` lit le budget en vigueur mois par mois : `budgeted` n'est
  plus constant sur la ligne. Les lignes d'un récurrent (postes) gardent leur
  montant propre ; la hausse « permanent » s'applique au budget du groupe.
- Les mois passés restent calculés avec le budget qui était en vigueur à
  l'époque : une hausse d'août ne change rien à juillet.

### Décisions

Nouvelle table `overspend_decisions` : `group_id` (nullable pour les non
catégorisés), `month` (« YYYY-MM »), `decision` (« exceptional » |
« permanent »), `decided_at`. L'absence de ligne = non tranché. Une décision
est modifiable : rouvrir le panneau permet de changer le statut (le dernier
choix gagne ; repasser de « permanent » à autre chose ne supprime pas la
hausse de budget déjà validée — le budget se corrige dans sa propre page).

Une décision prise pendant le mois en cours vaut pour le mois entier, même si
le dépassement grossit ensuite.

## Parcours dans l'interface

### Side panel (lieu de décision)

Cliquer la Balance rouge d'un groupe (ou la pastille d'alerte) ouvre le side
panel avec le détail du calcul comme aujourd'hui, complété d'un bloc de
décision quand la case est un dépassement :

> Dépassement de 7,71 € en juillet — que veux-tu en faire ?
> [ Exceptionnel ] [ Permanent ]

« Exceptionnel » enregistre en un clic. « Permanent » ouvre une fenêtre de
validation : nouveau budget pré-rempli à (budget actuel + dépassement),
champ ajustable, boutons Valider / Annuler. Valider enregistre la décision et
crée la ligne de budget daté effective au mois courant. Si une décision
existe déjà, le bloc l'affiche (« Décidé : exceptionnel ») avec la
possibilité de changer.

### Rappels

- **Bandeau** en haut de l'onglet Historique, visible dès qu'un mois terminé
  a des dépassements non tranchés : « Des dépassements de juillet attendent
  une décision : Carburant (7,71 €), Vêtement (149,34 €) ». Chaque nom est
  cliquable et ouvre le side panel de décision du bon groupe et du bon mois.
  Le bandeau disparaît quand plus rien n'est en attente.
- **Pastille** d'alerte à côté du nom du groupe dans la première colonne
  (colonne collante, donc toujours visible). Cliquable, elle ouvre le même
  panneau. Elle disparaît dès que la décision est prise.

Les dépassements du mois en cours ne déclenchent ni bandeau ni pastille (le
mois n'est pas fini) ; la décision y est déjà possible via la Balance rouge.

## Renommage et explication

La colonne « Solde dépass. » est renommée « Solde si dépassement » (en-tête
complet). Son explication d'en-tête (clic sur le titre) est réécrite : c'est
l'hypothèse défavorable, fondée sur les dépassements en attente de décision ;
l'écart avec le Solde prévu mesure ce qui reste à trancher ; les décisions
« exceptionnel » et « permanent » referment cet écart.

La ligne « Dépassement hors budget » en bas du tableau ne change pas : elle
constate les montants rouges réels de chaque mois.

## Hors périmètre

- Pas de modification du Prévisionnel ni du panneau « Détail du calcul »
  (computeForecast) dans ce chantier.
- Pas d'historique d'audit des décisions (seul le dernier choix est gardé).
- Pas de notification en dehors de l'onglet Historique (pas d'alerte sur le
  Tableau de bord pour l'instant).

## Tests

- Lib : budget en vigueur par mois (avant / après une hausse datée) ;
  dépassement retenu = le plus récent non tranché par groupe ; effet de
  chaque statut sur la chaîne « Solde si dépassement » ; non-rétroactivité
  (les mois passés gardent l'ancien budget).
- Repositories : lecture/écriture des décisions et des budgets datés.
- Interface (vérification manuelle dans le navigateur, comme d'habitude) :
  bloc de décision dans le side panel, fenêtre de validation, bandeau,
  pastille, disparition des rappels après décision.
