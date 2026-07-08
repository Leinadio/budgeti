# Transactions : un onglet par compte + colonnes alignées

Date : 2026-07-08

## Objectif

Sur la page Transactions : présenter chaque compte dans un onglet distinct
(composant Tabs de shadcn), et aligner les colonnes entre les mois d'un même
compte.

## Décisions actées

- Un onglet par compte synchronisé ; libellé = nom du compte ; premier compte
  actif par défaut.
- Alignement : un seul tableau par compte, avec le mois rendu comme ligne-titre
  à l'intérieur du tableau (plus de tableau séparé par mois).

## Le décalage actuel et sa cause

Chaque mois est aujourd'hui un `<Table>` séparé. Chaque table calcule ses
largeurs de colonnes selon son propre contenu, donc les colonnes de juillet et
de juin ne s'alignent pas. En mettant tous les mois d'un compte dans un seul
tableau, les largeurs sont calculées une seule fois : les colonnes s'alignent.

## Installation

Ajouter le composant Tabs de shadcn via la CLI :
`npx shadcn@latest add tabs --yes`. Cela crée `src/components/ui/tabs.tsx`
(et la dépendance radix associée). `components.json` existe déjà (ajouté avec le
Sidebar), donc l'ajout est non interactif.

## Page Transactions (`src/app/transactions/page.tsx`, refonte de l'affichage)

- `export const dynamic = "force-dynamic"` conservé. Toute la logique existante
  conservée : `ownable`, `statusLabel` (via `resolveOwnership`), `groupsOfAccount`,
  regroupement `byAccount`, câblage `setGroup` + `GroupSelectField`.
- Onglets : un `<Tabs defaultValue={premier accountId}>` avec :
  - `<TabsList>` : un `<TabsTrigger value={accountId}>` par compte, texte = le
    libellé du compte (`accountLabel`).
  - un `<TabsContent value={accountId}>` par compte.
- Contenu d'un onglet : un SEUL `<Table>` avec une seule ligne d'en-tête (Date,
  Libellé, Groupe, Appartenance, Montant), puis, pour chaque mois issu de
  `groupByMonth(items)` :
  - une ligne-titre de mois : une `TableRow` avec une seule `TableCell`
    `colSpan={5}` affichant le `label` du mois (style discret, `text-muted-foreground`) ;
  - les `TableRow` des transactions du mois (colonnes inchangées).
- Cas vide (aucune transaction) : message « Aucune transaction. Va dans Réglages
  pour synchroniser. » (sans onglets).

Note : `Tabs` est un composant client ; la page reste un composant serveur qui
lui passe les `TabsContent` en enfants (les formulaires à server action à
l'intérieur restent valides).

## Tests

- Pas de nouvelle logique pure à tester (le regroupement par mois est déjà
  couvert par `groupByMonth`). Affichage vérifié en lançant le vrai serveur (les
  DB `:memory:` ne voient pas les bugs runtime — cf. CLAUDE.md) : onglets par
  compte, bascule d'onglet, colonnes alignées entre les mois, ligne-titre de
  mois, menu Groupe fonctionnel.

## Hors périmètre

- Persistance de l'onglet actif entre navigations.
- Filtrage / recherche dans les transactions.
- Totaux par mois.
- Modification de la logique d'appartenance ou du prévisionnel.
