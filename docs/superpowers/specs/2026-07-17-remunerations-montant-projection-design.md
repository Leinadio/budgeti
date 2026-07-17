# Rémunérations : montant dédié, colonnes Historique et projection

## Objectif

Donner aux deux rémunérations (principale, supplémentaire) un montant saisi à la
création, et distinguer clairement leur comportement dans l'Historique et les
projections :

- La **principale** : son montant s'affiche dans la colonne Budget et est projeté
  sur les mois suivants.
- La **supplémentaire** : son montant ne s'affiche pas dans Budget et n'est pas
  projeté sur les mois suivants, mais compte comme entrée attendue du mois courant.

Dans les deux cas, le nom est figé, et les transactions rangées dans le groupe
alimentent la colonne Reçu.

## Contexte (état actuel)

- Groupe : `kind` (`envelope` | `recurring`), `direction` (`in` | `out`),
  `income_kind` (`principal` | `supplementary` | `null`), `monthly_amount` (enveloppe)
  ou lignes (`group_lines`, récurrent). `kind` et `income_kind` sont immuables après
  création (`updateGroup` ne les touche pas).
- Aujourd'hui : principale = récurrent (`income_kind='principal'`, montant = somme des
  lignes) ; supplémentaire = enveloppe (`income_kind='supplementary'`, `monthly_amount`
  figé à 0). Aucun champ montant à la création.
- Historique (`cellsFor`, `history.ts`) : pour une entrée, `budgeted = budgetOf(g)`,
  `recu = realizedOf(m)` (transactions du mois), `depense = balance = 0` ; mois futurs :
  `recu = budgeted` (donc la principale est déjà projetée, la supplémentaire vaut 0
  car son budget est 0).
- Affichage (`history-grid.tsx`, `AmountCells` en `mode="in"`) : colonne Budget rendue
  vide pour toute rémunération, Reçu = `c.recu`, Reste vide.
- `computeForecast` ignore `income_kind` : il ne branche que sur `kind`/`direction`.

## Décisions

1. **Modèle** : les deux rémunérations deviennent des **enveloppes** (`kind='envelope'`,
   `direction='in'`) avec `monthly_amount` = le montant saisi et le bon `income_kind`.
   Une seule de chaque type par compte. Nom figé :
   - principale → `"Rémunération principale"`
   - supplémentaire → `"Rémunération supplémentaire"`
2. **Montant supplémentaire** : entre dans l'estimé du **mois courant** (entrée
   attendue, comme la principale) mais **jamais** dans la colonne Budget ni dans les
   projections des mois suivants.
3. **Reste** : vide pour les deux (inchangé, `balance = 0` pour une entrée).

## Règles principale vs supplémentaire

| Aspect | Principale | Supplémentaire |
|---|---|---|
| Champs à la création | Compte, Montant (nom figé) | Compte, Montant (nom figé) |
| Colonne Budget (Historique) | montant (tous les mois) | vide |
| Colonne Reçu (mois passés/courant) | transactions rangées | transactions rangées |
| Colonne Reçu (mois futurs) | montant projeté | 0 (rien) |
| Colonne Reste | vide | vide |
| Solde courant (transactions réelles) | compté | compté |
| Estimé fin de mois courant | montant attendu (− déjà reçu) | montant attendu (− déjà reçu) |
| Projection mois suivants | oui (montant) | non |

## Modèle de données et migration

- Table `groups` inchangée (colonnes déjà présentes : `monthly_amount`, `income_kind`).
- **Migration ponctuelle** (base locale personnelle) : convertir les groupes existants
  `income_kind='principal'` et `kind='recurring'` en `kind='envelope'` avec
  `monthly_amount = SUM(group_lines.amount)` du groupe, puis supprimer leurs lignes.
  Les supplémentaires existantes restent des enveloppes (`monthly_amount` éventuellement
  0 jusqu'à édition).
- Fichier de migration idempotent dans `src/db/` (appliqué au démarrage comme le reste
  du schéma), qui ne touche que les groupes concernés.

## Création / édition (onglet Groupes)

- **Création** (`new-group-form.tsx` + `actions.ts`) :
  - Nature inchangée : `expense` / `principal` / `supplementary`.
  - Pour `principal` / `supplementary` : afficher **Compte + Montant** uniquement.
    Le sélecteur de type (enveloppe/récurrent) reste masqué. Le champ Nom est retiré
    (nom imposé côté serveur).
  - L'action crée une **enveloppe** `direction='in'`, `income_kind` correspondant,
    `monthly_amount` = montant, `name` = nom figé.
  - **Unicité** : si une rémunération du même `income_kind` existe déjà sur le compte,
    la création est refusée (garde côté action) et l'option de nature correspondante est
    désactivée dans le formulaire (avec mention « déjà créée »).
- **Édition** (`group-editors.tsx`) : pour une rémunération, le montant (`monthly_amount`)
  est modifiable ; le nom et le sens sont verrouillés (figés).

## Historique (`history.ts` + `history-grid.tsx`)

- `HistoryRow` porte désormais `incomeKind` (`principal` | `supplementary` | `null`),
  renseigné depuis le groupe.
- **Projection** (`cellsFor`) : le montant projeté des mois futurs devient
  paramétrable. Pour une entrée : futur = `budgeted` si principale, `0` si
  supplémentaire. Pour une sortie : inchangé (`budgeted + overspend`).
- **Affichage** (`AmountCells` / `IncomeTotalCells`) : en `mode="in"`, la colonne
  Budget affiche `fmt(c.budgeted)` si `incomeKind === 'principal'`, sinon vide. Reçu et
  Reste inchangés. La ligne « Total rémunérations » additionne les Reçu (inchangé) et
  peut afficher en Budget la somme des budgets principaux (à préciser au plan ; par
  défaut : Budget de la ligne Total = somme des budgets principaux).

## Projection (`forecast.ts`)

- `computeForecast` prend en compte `income_kind` pour les entrées :
  - **Principale** : montant attendu ajouté à l'estimé du mois courant (comme
    aujourd'hui, via `remaining = montant − déjà reçu`) **et** au delta du mois suivant.
  - **Supplémentaire** : montant attendu ajouté à l'estimé du mois courant uniquement,
    **exclu** du delta du mois suivant.
- Cohérence avec l'Historique : les colonnes Solde/Estimé restent alignées (la
  supplémentaire n'apparaît pas dans les projections des mois > courant).

## Hors périmètre

- `monthRemuneration` / carte « Rémunération par mois » : inchangés (basés sur les
  transactions réellement reçues).
- Étiquetage de revenu au niveau transaction (`transactions.income_kind`) : inchangé
  (déjà non utilisé).

## Points tranchés

- Ligne « Total rémunérations », colonne Budget : **somme des budgets principaux**
  (les supplémentaires n'y comptent pas).
- Montant d'une supplémentaire : ajouté à l'estimé du mois courant **même sans
  transaction rangée** (entrée attendue, réduite par ce qui est déjà reçu), comme la
  principale.
