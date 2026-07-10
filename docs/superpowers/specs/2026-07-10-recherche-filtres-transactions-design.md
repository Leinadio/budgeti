# Recherche et filtres des transactions

Date : 2026-07-10

## Objectif

Permettre de retrouver des transactions et de répondre à des questions comme
« combien j'ai dépensé chez X ? », en filtrant la page Transactions par texte,
groupe, montant et période, avec un total sur les résultats.

## Comportement

### Barre de filtres (haut de la page Transactions)

Quatre contrôles :

- **Texte** : recherche insensible à la casse dans le libellé.
- **Groupe** : menu — Tous / un groupe précis / Non catégorisées.
- **Montant** : min et max, appliqués sur la valeur absolue (18 € matche -18 € comme +18 €).
- **Période** : date de début et date de fin, inclusives.

Un bouton **Réinitialiser** efface tous les filtres.

### Deux modes d'affichage

- **Aucun filtre actif** : la page est inchangée — onglets par compte,
  regroupement par mois, comme aujourd'hui.
- **Au moins un filtre actif** : les onglets laissent place à une **liste à plat,
  tous comptes et tous mois confondus**, triée par date décroissante.

### Résumé des résultats

En tête de la liste filtrée : « N transactions », le total des **sorties**, le
total des **entrées**, et le **net**. C'est le cœur de la valeur : transformer
une recherche en réponse chiffrée.

### Lignes de résultat

Mêmes colonnes que le tableau actuel (Date, Libellé, Groupe, Appartenance,
Montant) plus une indication du **compte** (puisqu'on est multi-comptes). Le
libellé et l'appartenance gardent la troncature + tooltip existante. Le menu
Groupe reste actif : on peut catégoriser directement depuis un résultat.

## Décisions

- Recherche sur **tous les comptes** dès qu'un filtre est actif.
- Montant filtré sur la **valeur absolue**.
- Filtrage **en mémoire côté navigateur** (instantané, suffisant pour un volume
  personnel). Pas d'URL params.
- Le filtre Groupe s'appuie sur le **propriétaire résolu** (`resolveOwnership`) :
  un groupe précis matche les transactions rattachées (manuel ou auto) ;
  « Non catégorisées » matche les statuts `none` et `ambiguous`.

## Architecture

- `src/lib/transactions-filter.ts` (pur, testé) :
  - `type TxnFilters` (texte, groupe, montant min/max, dates)
  - `filterTransactions(txns, filters, ownable)` → transactions filtrées
  - `summarize(txns)` → `{ count, out, in, net }`
- `src/components/transactions-browser.tsx` (client) : détient l'état des
  filtres, affiche le mode groupé (actuel) ou la liste filtrée + résumé.
  Réutilise `GroupSelectField`, `TruncatedText`, `resolveOwnership`,
  `groupByMonth`, `formatEur`.
- `src/app/transactions/page.tsx` (serveur) : charge comptes, groupes et
  transactions, passe le tout au `TransactionsBrowser`.

La logique testable (filtrage + résumé) vit dans `lib`. Le composant client ne
fait que gérer l'état des champs et l'affichage.

## Tests

`tests/lib/transactions-filter.test.ts` :
- filtre texte insensible à la casse
- filtre groupe (propriétaire résolu) et « Non catégorisées »
- filtre montant sur valeur absolue (bornes incluses)
- filtre période (bornes incluses)
- combinaison de plusieurs filtres (ET logique)
- `summarize` : count, sorties, entrées, net

## Hors périmètre

- Pas de tri configurable (tri par date décroissante fixe).
- Pas de sauvegarde de recherches ni d'URL partageable.
- Pas d'export des résultats.
