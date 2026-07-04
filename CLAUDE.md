# Style de réponse

- Réponses courtes, l'essentiel uniquement.
- Langage humain, clair et compréhensible.
- Pas d'emoji, pas de symboles décoratifs (flèches, puces fantaisie, etc.).
- Aller droit au but.

# Le projet : Budget CIC

App web locale et personnelle de suivi de budget. Elle se connecte au compte CIC
de l'utilisateur via l'agrégateur Open Banking Enable Banking, catégorise les
dépenses, gère des enveloppes de budget mensuelles et affiche des alertes. Tout
tourne en local (localhost), les données bancaires ne quittent pas la machine.

## Stack
- Next.js (App Router, TypeScript, React) + SQLite (better-sqlite3) + Vitest.
- Enable Banking pour la connexion bancaire (JWT RS256 signé avec une clé privée).

## Structure
- `src/lib/` : logique pure testée (montants, catégorisation par règles, budgets, alertes).
- `src/db/` : schéma SQLite + repositories d'accès aux données. Base dans `data/budget.db`.
- `src/enablebanking/` : JWT, client HTTP, flux de connexion, synchronisation.
- `src/app/` : écrans (Tableau de bord, Transactions, Budgets, Catégories, Réglages) + routes API.
- `docs/superpowers/` : spec et plan de construction.
- `scripts/list-aspsps.mjs` : liste les banques dispo pour l'app Enable Banking (debug).

## Config (.env.local, jamais commité)
- `ENABLEBANKING_APPLICATION_ID`, `ENABLEBANKING_KEY_PATH` (clé dans `secrets/`, jamais commitée),
  `ENABLEBANKING_REDIRECT_URL`, `ENABLEBANKING_ASPSP_NAME`.
- Sandbox : banques de test seulement (Mock ASPSP, BBVA), pas le vrai CIC.
- Production : vrai CIC. Redirect en `https://localhost:3000/api/callback`, lancer avec
  `npm run dev -- --experimental-https`. L'app Enable Banking doit être "Active"
  (comptes liés dans le Control Panel).

## Lancer
- `npm run dev` (ou `npm run dev -- --experimental-https` pour la Production).
- `npm test` pour les tests.

## État actuel (à jour du 2026-07-04)
- App complète, testée, mergée sur `main`. Connexion réelle au CIC de l'utilisateur validée.
- Contraintes DSP2 assumées : reconnexion ~90 jours, rafraîchissement non temps réel.
- Dernier ajout : affichage par compte (chaque compte a sa carte solde + transactions ;
  Transactions regroupées par compte). Le libellé de compte utilise l'IBAN masqué,
  récupéré via `/accounts/{uid}/details` pendant la synchro (champs devinés
  `account_id.iban` et `name` — à confirmer avec le vrai CIC, non fatal si absents).

## Pièges connus
- Enable Banking : le nom de banque (ASPSP) doit correspondre EXACTEMENT au catalogue de
  l'environnement. Production rejette les redirect en http (https obligatoire).
- Next.js ne relit `.env.local` qu'au démarrage : redémarrer après modification.
- Les tests utilisent des DB `:memory:` — ils ne voient pas certains bugs runtime
  (dossier `data/` manquant, mot réservé SQL). Vérifier en lançant le vrai serveur.
