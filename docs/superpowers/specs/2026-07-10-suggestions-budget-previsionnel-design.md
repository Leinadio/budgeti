# Suggestions d'ajustement de budget dans le Prévisionnel

Date : 2026-07-10

## Objectif

Sur l'onglet Prévisionnel, aider l'utilisateur à ajuster ses budgets de groupe
en montrant les dépassements et en suggérant un nouveau montant.

Deux situations, sur les groupes qui ont un budget (enveloppes de dépense) :

1. Dépassement du mois en cours : afficher la vraie dépense et suggérer de
   monter le budget le mois prochain.
2. Rappel du mois dernier : si le mois précédent a dépassé, rappeler le montant
   dépensé et le budget conseillé.

## Problème actuel

Dans `src/lib/forecast.ts`, la dépense d'une enveloppe est plafonnée au budget :

```
spent: Math.min(spent, amount)
```

Si le budget est 400€ et la dépense réelle 600€, la valeur exposée est 400.
Le dépassement de 200€ est donc perdu et n'apparaît jamais à l'écran. Il faut
exposer la dépense réelle avant de pouvoir suggérer quoi que ce soit.

## Comportement attendu

### Calcul

Pour chaque groupe de type `envelope` et de direction `out` :

- `spent` = dépense réelle du mois en cours (non plafonnée).
- `overspend` = `max(0, spent - budget)` pour le mois en cours.
- `prevSpent` = dépense réelle du mois précédent.
- `prevOverspend` = `max(0, prevSpent - budget)`.
- `suggestedBudget` = `spent` (la dépense réelle exacte du mois en cours).
  Pour le rappel, le budget conseillé est `prevSpent`.

Le mois précédent est recalculé à partir des transactions déjà en base, en
réutilisant la même résolution d'ownership que le mois courant. Aucune nouvelle
donnée n'est stockée.

Les groupes sans budget (revenus, groupes `recurring`) ne produisent aucune
suggestion : `overspend` et `prevOverspend` valent 0.

### Limite assumée

Le budget (`monthlyAmount`) n'a pas d'historique : une seule valeur "actuelle"
existe. Le rappel du mois dernier utilise donc le budget actuel comme référence.
C'est juste tant que l'utilisateur n'a pas encore modifié le budget, ce qui est
précisément le moment où le rappel est utile.

### Affichage (`src/app/previsionnel/page.tsx`)

Sur chaque groupe concerné :

- Barre de progression : affiche la vraie dépense, ex. "600 / 400", pleine et
  rouge quand le ratio dépasse 100 % (le plafonnement visuel `Math.min(100, …)`
  reste en place pour la largeur de la barre).
- Si `overspend > 0` : message rouge sous la barre, ex.
  "Dépassement de 200€. Le mois prochain, pense à monter ce budget à 600€."
- Si `prevOverspend > 0` : message rouge de rappel, ex.
  "Le mois dernier : 600€ dépensés sur 400€ de budget. Budget conseillé : 600€."

Les deux messages sont indépendants : un groupe peut n'en afficher aucun, un
seul, ou les deux.

## Fichiers touchés

- `src/lib/forecast.ts` : retirer le plafonnement ; ajouter au `GroupView` les
  champs `spent` (réel), `overspend`, `prevSpent`, `prevOverspend`,
  `suggestedBudget`.
- `src/lib/forecast.test.ts` : cas pas de dépassement, dépassement mois en cours,
  dépassement mois dernier seul, les deux ensemble.
- `src/app/previsionnel/page.tsx` : brancher les deux messages rouges.

## Hors périmètre

- Pas d'historique de budget.
- Pas de suggestion de baisse de budget (quand on dépense moins que prévu).
- Pas de moyenne multi-mois : la suggestion se base sur la dépense réelle exacte.
