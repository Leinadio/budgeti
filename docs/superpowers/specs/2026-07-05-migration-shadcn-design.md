# Migration de l'UI vers shadcn/ui

Date : 2026-07-05

## Objectif

Remplacer la couche de présentation actuelle (CSS custom dans `globals.css`,
balises HTML brutes) par les composants shadcn/ui sur l'ensemble de l'app Budget
CIC. Thème clair et sombre.

## Contraintes

- Migration purement présentation : les server actions, l'accès DB (`src/db`) et
  la logique métier (`src/lib`) ne changent pas.
- Les tests (`src/lib`, `src/db`, DB `:memory:`) restent verts sans modification.
- `ConnectButtons` reste un composant client (`"use client"`).
- Vérification finale en lançant le vrai serveur, pas seulement les tests (les
  DB `:memory:` ne voient pas les bugs runtime — cf. CLAUDE.md).

## Tooling

- Tailwind CSS v4 via `@tailwindcss/postcss` (plugin PostCSS) + `postcss.config.mjs`.
- `tailwindcss-animate` pour les animations des composants.
- Init shadcn : `components.json`, alias `@/components` et `@/lib/utils` (helper `cn`
  basé sur `clsx` + `tailwind-merge`).
- Tokens de thème (variables CSS `--background`, `--foreground`, `--card`,
  `--primary`, `--muted`, `--border`, etc.) définis dans `globals.css`, avec un
  bloc `.dark`. Le CSS custom actuel (`.nav`, `.card`, `.bar`, `.alert`, `table`)
  est supprimé.
- Le thème sombre suit le réglage système (classe `dark` posée sur `<html>` via
  `media (prefers-color-scheme: dark)` ou stratégie équivalente). Pas de bouton de
  bascule manuel dans cette itération.

## Composants shadcn ajoutés

Dans `src/components/ui/` :

- Button
- Card (Card, CardHeader, CardTitle, CardContent)
- Table (Table, TableHeader, TableBody, TableRow, TableHead, TableCell)
- Input
- Select
- Checkbox
- Label
- Badge
- Progress

## Réécriture écran par écran

### Layout (`src/app/layout.tsx`)
- Barre de navigation avec les liens en `Button variant="ghost"` (via `asChild` +
  `Link`).
- Conteneur `main` centré (max-width, padding) en classes Tailwind.

### Dashboard (`src/app/page.tsx`)
- Carte solde total et dépensé du mois en `Card`.
- Alertes rendues en blocs colorés (`Badge` ou div avec variantes selon `a.level`
  `warn`/`danger`).
- Enveloppes : `Progress` par catégorie, couleur selon ratio (vert < 0.8, ambre
  0.8–1, rouge ≥ 1) via classe conditionnelle.
- Transactions par compte : `Table`.

### Transactions (`src/app/transactions/page.tsx`)
- Un `Card` + `Table` par compte.
- Recatégorisation : `<form action={recategorize}>` conservé, avec `Select`
  (catégorie), `Checkbox` + `Label` (créer une règle), `Button` de soumission.

### Budgets (`src/app/budgets/page.tsx`)
- Une ligne par catégorie : `Label` + `Input type="number"` + `Button`, dans le
  `<form action={saveBudget}>` existant.

### Catégories (`src/app/categories/page.tsx`)
- Liste des catégories + `Input`/`Button` pour ajouter (form `addCategory`).
- Règles en `Table` + form `createRule` avec `Input` (mot-clé), `Select`
  (catégorie), `Button`.

### Settings (`src/app/settings/page.tsx` + `ConnectButtons.tsx`)
- `Card` connexion bancaire ; `ConnectButtons` utilise `Button`.
- Statut de reconnexion en `Badge` (variante d'alerte si < 7 jours).
- Seuil d'alerte : `Input type="number"` + `Button` dans le form `saveThreshold`.

## Risques

- Ajouter Tailwind modifie `globals.css` global et la config PostCSS ; risque de
  casser le rendu si mal configuré pour Next.js 16 / React 19.
- Mitigation : vérification en lançant le serveur réel (`npm run dev`) et contrôle
  visuel de chaque écran, en plus de `npm test`.

## Hors périmètre

- Bouton de bascule de thème manuel.
- Refonte de la logique métier, des server actions ou du schéma DB.
- Nouveaux écrans ou fonctionnalités.
