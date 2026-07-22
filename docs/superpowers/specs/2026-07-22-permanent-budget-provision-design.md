# « Permanent » = budget, provision des non catégorisés, retrait du « Solde si dépassement » en projection

Date : 2026-07-22

## Contexte

Le chantier précédent (report opt-in) a fait de « Permanent » un report du
dépassement dans la colonne « Solde si dépassement » des mois futurs, sans
toucher au budget. À l'usage, deux problèmes sont apparus :

1. Le détail d'un « Solde si dépassement » futur renvoie vers le mois SOURCE du
   dépassement (ex. cliquer octobre saute la surbrillance sur juin), ce qui est
   déroutant.
2. La ligne « Non catégorisés » n'a pas de budget, elle se comporte donc
   différemment des enveloppes et récurrents.

Décision de l'utilisateur, après usage réel : revenir au modèle « Permanent =
ça entre dans mon budget » pour TOUS les types de dépassement, donner un vrai
budget (une provision) aux non catégorisés, et retirer la colonne « Solde si
dépassement » sur les mois de projection puisqu'elle n'y dit plus rien de neuf.

## Le modèle de décision

Sur un dépassement (case Balance rouge d'un mois passé ou en cours), la carte de
décision propose :

- **Exceptionnel** : enregistre le choix, sans aucun effet sur le budget ni la
  projection. (inchangé)
- **Permanent** : le dépassement entre dans le budget. Le bouton rouvre un petit
  champ pré-rempli avec « budget actuel + dépassement », ajustable, et à la
  validation relève le budget **à partir du mois de projection suivant** (mois
  courant + 1).
  - Enveloppe / récurrent : relève le budget du groupe (`setBudgetAmount(groupId,
    moisCourant+1, nouveauBudget)`), comme le faisait l'ancien comportement.
  - Non catégorisés (groupe 0) : le montant devient leur **provision** (un budget
    daté du groupe 0). Pré-remplissage = provision en vigueur + dépassement.
- **Annuler** : supprime le choix ; pour un « permanent », retire aussi l'entrée
  de budget / la provision que le choix avait posée (`deleteBudgetAmount` au mois
  courant + 1). Best-effort : un budget daté antérieur au même mois n'est pas
  restauré (cas rare, non mémorisé).

## Provision des non catégorisés (budget du groupe 0)

On autorise le « groupe 0 » (non catégorisés) à avoir un budget daté, stocké dans
le même mécanisme que les budgets de groupe (`budget_amounts`, `group_id = 0`).

- **Affichage** : la provision en vigueur un mois s'affiche dans la colonne
  « Budget dép. » de la ligne « Non catégorisés » (aujourd'hui « — »).
- **Dépassement** : le dépassement non catégorisé d'un mois devient
  `max(0, dépensé − reçu − provision)` au lieu de `max(0, dépensé − reçu)`.
- **Solde prévu** : la provision est une dépense planifiée ; elle est retirée de
  la chaîne « Solde prévu » à l'étape des non catégorisés, sur les mois où elle
  s'applique (comme un budget d'enveloppe).
- **Édition manuelle** : la case « Budget dép. » des non catégorisés est éditable
  comme celle d'une enveloppe — un champ « Provision pour [mois] » avec le montant,
  un choix « À partir de ce mois » / « Ce mois seulement », et « Appliquer ». Elle
  réutilise le mécanisme des budgets datés (via une action `setGroupAmount(0, …)`
  ou équivalente). Le bouton « Permanent » n'est qu'un raccourci qui la pré-remplit
  depuis un dépassement constaté.

## Retrait de la colonne « Solde si dépassement » en projection

- La colonne « Solde si dépassement » reste affichée sur les **mois passés et le
  mois en cours** (là où il y a de vrais dépassements retirés du plan).
- Elle **disparaît sur les mois de projection (futurs)** : puisque « Permanent »
  fait entrer le dépassement dans le budget, elle n'y dirait plus que la même
  chose que « Solde prévu ».
- Mécanisme : `monthColumns(type)` renvoie les colonnes selon la nature du mois et
  **exclut `soldeDepass` pour les mois futurs**. Le `<colgroup>`, les en-têtes et
  toutes les lignes (qui passent par `monthColumns` / `renderCols`) suivent
  automatiquement.

## Retrait du report (`retained`)

Comme « Permanent » relève désormais le budget (donc c'est déjà dans le « Solde
prévu »), on ne reporte plus les dépassements dans le « Solde si dépassement » des
mois futurs. On retire ce mécanisme :

- `computeOverspends` : ne renvoie plus `retained`. Il continue de renvoyer
  `pending`, `pendingClosed`, `pendingByMonth` (bandeaux et pastilles).
- `computePlannedSoldes` : le paramètre `retained` disparaît ; sur les mois
  futurs, aucun dépassement supposé n'est retiré (le « Solde si dépassement » n'y
  est de toute façon plus affiché). Le calcul du « Solde si dépassement » sur les
  mois passés / courant (dépassements réels retirés) reste inchangé.

## Pastilles sur la colonne Balance

Le montant de Balance d'un dépassement (ligne sortante, Balance rouge, mois passé
ou en cours) porte une pastille dont la couleur reflète l'état de la décision :

- **À trancher** (non tranché) : ambre.
- **Exceptionnel** (tranché) : gris.
- **Permanent** (tranché) : bleu.

La pastille est un petit point posé sur la case Balance. Elle s'applique aux
lignes de groupe (enveloppes / récurrents) et à la ligne « Non catégorisés ».
L'état vient de `decisionByKey` (déjà disponible). La pastille ambre existante sur
le NOM des non catégorisés reste telle quelle (indicateur au niveau de la section) ;
les nouvelles pastilles s'ajoutent sur les cases Balance, une par dépassement.

## Le bandeau du haut se met à jour

Le bandeau « Des dépassements attendent une décision » en haut du tableau doit se
rafraîchir immédiatement quand l'utilisateur tranche (exceptionnel / permanent) ou
annule : l'élément disparaît une fois tranché, et réapparaît si le choix est
annulé. La revalidation (`revalidatePath` dans les actions + `router.refresh()`
dans la carte) doit suffire ; à vérifier et corriger si le bandeau reste figé.

## Ce qui revient / ce qui part (par rapport au chantier précédent)

- **Revient** : la hausse de budget sur « Permanent » (avec formulaire ajustable),
  et l'annulation qui retire cette hausse.
- **Part** : la colonne « Solde si dépassement » sur les mois futurs, et le report
  automatique des dépassements (`retained`).
- **Nouveau** : la provision des non catégorisés (budget du groupe 0, éditable),
  les pastilles de Balance en trois couleurs, l'exclusion de `soldeDepass` des
  mois futurs dans `monthColumns`.

## Tests

- `computeOverspends` : le dépassement non catégorisé tient compte de la provision
  (`max(0, dépensé − reçu − provision)`) ; plus de `retained` dans le retour.
- Provision : un budget daté du groupe 0 s'affiche comme budget des non
  catégorisés, réduit leur « Solde prévu » et leur dépassement.
- `decideOverspend` « permanent » : relève le budget du groupe (ou la provision du
  groupe 0) au mois courant + 1 ; « exceptionnel » ne touche à rien.
- `undoOverspendDecision` : retire la hausse de budget / la provision d'un
  « permanent ».
- `monthColumns` : `soldeDepass` présent sur passé / courant, absent sur futur.
- Adapter les tests du chantier précédent qui supposaient le report `retained` ou
  la carte à deux boutons sans formulaire.

## Hors périmètre (plus tard)

- Convertir un dépassement non catégorisé récurrent en vraie enveloppe.
