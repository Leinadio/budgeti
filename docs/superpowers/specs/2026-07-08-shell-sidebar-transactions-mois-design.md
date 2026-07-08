# Shell à sidebar + Transactions pleine largeur groupées par mois

Date : 2026-07-08

## Objectif

Passer l'app en pleine largeur avec une sidebar gauche globale (contenant
uniquement Réglages), et refondre la page Transactions : plus de card, pleine
largeur, transactions regroupées par compte puis par mois.

## Décisions actées

- Shell global : la barre de navigation du haut reste (Tableau de bord,
  Transactions, Prévisionnel, Groupes), sans Réglages. Réglages passe dans une
  sidebar gauche.
- Contenu pleine largeur pour toutes les pages (plus de colonne centrée
  `max-w-3xl`).
- Transactions : plus de card ; par compte, puis par mois (titre de mois),
  ordre décroissant.

## Mise en page (`src/app/layout.tsx`)

- `NAV` (barre du haut) perd l'entrée Réglages ; garde les quatre autres.
- Sous la barre du haut, une rangée flex :
  - une sidebar `<aside>` étroite (bordure droite) contenant le seul lien
    Réglages (`/settings`) ;
  - une zone `<main>` `flex-1` en pleine largeur, avec un padding
    (`px-6 py-6`), sans `max-w`.
- La sidebar est présente sur toutes les pages (shell global). Elle ne contient
  que Réglages pour l'instant.

Structure indicative :

```tsx
<body>
  <nav>...(4 liens)...</nav>
  <div className="flex">
    <aside className="w-48 shrink-0 border-r p-3">
      <Button asChild variant="ghost" size="sm">
        <Link href="/settings">Réglages</Link>
      </Button>
    </aside>
    <main className="flex-1 px-6 py-6">{children}</main>
  </div>
</body>
```

## Helpers (lib, testés)

### `src/lib/transactions-view.ts` (nouveau)

```ts
export function monthLabel(ym: string): string;
// "2026-07" -> "Juillet 2026" (mois en toutes lettres, français, initiale
// capitalisée)

export function groupByMonth<T extends { date: string }>(
  items: T[],
): { month: string; label: string; items: T[] }[];
// Regroupe par mois (clé "YYYY-MM"), en conservant l'ordre d'entrée à
// l'intérieur de chaque mois et l'ordre de première apparition des mois.
// Comme les transactions arrivent triées par date décroissante, les mois
// ressortent du plus récent au plus ancien et les lignes restent en ordre
// décroissant.
```

- `monthLabel` : construit la date `new Date(annee, mois-1, 1)` et formate via
  `Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" })`, puis
  capitalise la première lettre.
- `groupByMonth` : itère `items`, clé = `date.slice(0,7)`, accumule dans l'ordre
  de première apparition, `label = monthLabel(month)`.

## Page Transactions (`src/app/transactions/page.tsx`, refonte de l'affichage)

- Plus de `Card`. `export const dynamic = "force-dynamic"` conservé.
- Regroupement inchangé côté données : d'abord par compte
  (`accountId` -> `{ label, items }`), les `items` déjà triés par date
  décroissante par `listTransactions`.
- Rendu, par compte :
  - un titre de compte (nom du compte via `accountLabel`, ex. `<h2>`),
  - pour chaque mois issu de `groupByMonth(items)` : un titre de mois
    (`label`, ex. `<h3>`), puis une `Table` des transactions du mois.
- Colonnes de la table inchangées : Date, Libellé, Groupe (menu
  `GroupSelectField` + form `setGroup`), Appartenance (via `resolveOwnership`),
  Montant. Toute la logique existante (`ownable`, `statusLabel`,
  `groupsOfAccount`, `setGroup`) est conservée.
- Cas vide : message « Aucune transaction. Va dans Réglages pour synchroniser. »

## Tests

- `tests/lib/transactions-view.test.ts` (nouveau) :
  - `monthLabel("2026-07")` = « Juillet 2026 » ; `monthLabel("2026-01")` =
    « Janvier 2026 ».
  - `groupByMonth` : transactions sur plusieurs mois (ordre date décroissant en
    entrée) -> groupes en ordre de mois décroissant, lignes conservées dans
    l'ordre d'entrée, `label` correct.
- Le shell et la page Transactions restent de l'affichage : vérification en
  lançant le vrai serveur (les DB `:memory:` ne voient pas les bugs runtime —
  cf. CLAUDE.md).

## Hors périmètre

- Contenu de la sidebar au-delà de Réglages (filtres, navigation secondaire).
- Sélecteur de mois / navigation temporelle interactive (le regroupement affiche
  tous les mois présents).
- Modification de la logique d'appartenance ou du prévisionnel.
- Pagination ou repli des mois anciens.
