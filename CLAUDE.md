# Répondre court, et humainement compréhensible

Toujours : des phrases courtes, un langage humain, pas de jargon inutile. Aller
droit au but. Si une explication tient en trois phrases, elle ne doit pas en
faire dix.

# Le projet : Budget CIC

App web locale et personnelle de suivi de budget. Elle se connecte au compte CIC
de l'utilisateur via l'agrégateur Open Banking Enable Banking, catégorise les
dépenses, gère des enveloppes de budget mensuelles et affiche des alertes. Tout
tourne en local (localhost), les données bancaires ne quittent pas la machine.

## Config (.env.local, jamais commité)
- `ENABLEBANKING_APPLICATION_ID`, `ENABLEBANKING_KEY_PATH` (clé dans `secrets/`, jamais commitée),
  `ENABLEBANKING_REDIRECT_URL`, `ENABLEBANKING_ASPSP_NAME`.
- Sandbox : banques de test seulement (Mock ASPSP, BBVA), pas le vrai CIC.
- Production : vrai CIC. Redirect en `https://localhost:3000/api/callback`, lancer avec
  `npm run dev -- --experimental-https`. L'app Enable Banking doit être "Active"
  (comptes liés dans le Control Panel).

## Méthode de développement : le test d'abord
- **TOUJOURS** lancer `npm test` AVANT de toucher au code. On doit savoir ce qui était
  déjà rouge : ne jamais attribuer un échec préexistant à son propre travail, ni
  l'inverse.
- **TOUJOURS** écrire le test avant le code, et le lancer pour le VOIR échouer. Un test
  qui n'a jamais échoué ne prouve rien.
- **JAMAIS** dire « c'est corrigé » ou « ça marche » sans la sortie de `npm test` sous
  les yeux. Si un test échoue, le dire, avec sa sortie.
- Un bug corrigé commence par un test qui le reproduit. Sinon il revient.
- La logique de calcul vit dans `src/lib/` et se teste dans `tests/lib/`. Une nouvelle
  règle métier commence là, pas dans un composant.
- Avant de changer une fonction ou un type de `src/lib/` ou `src/db/` : chercher ses
  appelants (`grep`) et vérifier qu'ils sont couverts AVANT de toucher la signature.
  La base est grosse, un effet de bord non testé se paie des semaines plus tard.
- Un correctif purement visuel ou de routage n'a pas de test unitaire utile : il se
  vérifie en lançant le vrai serveur, et on le dit explicitement.

## Pièges connus
- Contraintes DSP2 assumées : reconnexion au CIC tous les ~90 jours, données jamais
  en temps réel.
- Enable Banking : le nom de banque (ASPSP) doit correspondre EXACTEMENT au catalogue de
  l'environnement. Production rejette les redirect en http (https obligatoire).
- Next.js ne relit `.env.local` qu'au démarrage : redémarrer après modification.
- Les tests utilisent des DB `:memory:` — ils ne voient pas certains bugs runtime
  (dossier `data/` manquant, mot réservé SQL). Vérifier en lançant le vrai serveur.
