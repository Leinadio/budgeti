# Budget CIC

Application web **locale et personnelle** de suivi de budget. Elle se connecte à ton
compte CIC via l'agrégateur Open Banking **Enable Banking**, range tes dépenses dans
des enveloppes de budget, et t'affiche solde, dépenses et alertes — le tout sur ton
ordinateur, tes données ne quittent pas ta machine.

> **Rappel honnêteté** : ce ne sera jamais du « temps réel à la seconde ». Les données
> sont rafraîchies quand tu cliques sur « Synchroniser » (offre gratuite = quelques
> rafraîchissements par jour). Et la loi bancaire (DSP2) impose de **te reconnecter à
> CIC environ tous les 90 jours** — c'est incontournable, pareil pour tous les outils
> du genre.

---

## 1. Ce qu'il te faut

- **Node.js 18+** et **npm** (vérifie avec `node --version`).
- Un **compte Enable Banking** (gratuit, usage perso) : https://enablebanking.com/sign-in/
  — tu t'y connectes par un lien reçu par email, pas de mot de passe à créer.

---

## 2. Installer le projet

Dans le dossier du projet :

```bash
npm install
```

---

## 3. Configurer Enable Banking

Tu as déjà créé une **application Sandbox** (« Budgeti ») dans le Control Panel
d'Enable Banking. Il te faut deux choses depuis cette application :

1. **L'Application ID** : la longue suite de caractères affichée à côté du nom de ton
   application dans le Control Panel.
2. **Le fichier de clé privée** : le `.pem` qui s'est téléchargé automatiquement quand
   tu as créé l'application.

Puis :

- **Range la clé privée** dans le projet, dans un dossier `secrets/` (déjà ignoré par
  git, donc jamais partagé) :
  ```
  secrets/private_key.pem
  ```
- **Crée ton fichier de config** en copiant l'exemple :
  ```bash
  cp .env.local.example .env.local
  ```
- **Remplis `.env.local`** avec tes valeurs :
  ```
  ENABLEBANKING_APPLICATION_ID=colle-ton-application-id-ici
  ENABLEBANKING_KEY_PATH=./secrets/private_key.pem
  ENABLEBANKING_REDIRECT_URL=http://localhost:3000/api/callback
  ```

> ⚠️ **Ne partage jamais** `secrets/private_key.pem` ni `.env.local`. Ils restent chez
> toi ; git est déjà configuré pour les ignorer.

---

## 4. Lancer l'application

```bash
npm run dev
```

Puis ouvre **http://localhost:3000** dans ton navigateur.

Tu verras la barre de navigation (Tableau de bord, Transactions, Budgets, Catégories,
Réglages). Au premier démarrage, l'app crée sa base de données locale (`data/budget.db`)
et remplit des catégories et des règles de départ.

---

## 5. Connecter ta banque

1. Va dans **Réglages**.
2. Clique sur **« Connecter ma banque (CIC) »**. L'app te redirige vers la page de
   connexion (en Sandbox : une banque de test factice ; en Production : la vraie page
   CIC).
3. Authentifie-toi. À la fin, tu es renvoyé vers l'app.
4. Clique sur **« Synchroniser »** pour importer solde et transactions.

> **Sandbox vs Production** : ton app actuelle est en **Sandbox** — elle se connecte à
> de **fausses banques de test**, pas à ton vrai CIC. C'est parfait pour vérifier que
> tout s'enchaîne. Pour voir tes **vraies** données, il faut passer en Production
> (voir §8).

---

## 6. Utiliser l'app au quotidien

- **Tableau de bord** : ton solde, tes dépenses du mois, les alertes, tes enveloppes
  (barre verte / orange à 80 % / rouge en dépassement), tes dernières transactions.
- **Transactions** : reclasse une dépense d'un clic. Coche « règle » pour que le même
  type de libellé soit rangé automatiquement la prochaine fois.
- **Budgets** : fixe un plafond mensuel par catégorie.
- **Catégories** : ajoute des catégories et des règles de mots-clés.
- **Réglages** : définis ton seuil d'alerte de solde, vois le compte à rebours des
  90 jours, et lance une synchro.

---

## 7. Lancer les tests

```bash
npm test
```

(19 tests couvrant le « cerveau » : montants, catégorisation, budgets, alertes,
base de données, et la synchronisation.)

---

## 8. Passer au vrai CIC (Production)

Quand tu es prêt à brancher ton vrai compte :

1. Dans le **Control Panel** Enable Banking, crée une application **Production** :
   - **Redirect URL** : `https://localhost:3000/api/callback` (⚠️ **https**, pas http —
     la Production refuse le http).
   - **Privacy URL** et **Terms URL** : une simple URL de dépôt GitHub public suffit
     (la même dans les deux champs). Pas besoin de nom de domaine.
   - Récupère le nouvel Application ID et le nouveau fichier de clé.
2. Mets à jour `.env.local` :
   ```
   ENABLEBANKING_APPLICATION_ID=nouvel-id-production
   ENABLEBANKING_KEY_PATH=./secrets/private_key.pem   (la nouvelle clé)
   ENABLEBANKING_REDIRECT_URL=https://localhost:3000/api/callback
   ```
3. Lance l'app **en HTTPS** (Next.js génère un certificat local de confiance tout seul) :
   ```bash
   npm run dev -- --experimental-https
   ```
   Puis ouvre **https://localhost:3000**.
4. Refais §5 (Connecter ma banque) — cette fois tu t'authentifies sur la **vraie** page
   CIC.

> **Note technique** : au tout premier essai en conditions réelles, il est possible que
> les noms exacts des champs échangés avec Enable Banking (dans
> `src/enablebanking/connection.ts`, endpoints `/auth` et `/sessions`) diffèrent
> légèrement de ce qui est codé. Un commentaire dans le fichier le signale. Si la
> connexion échoue à cette étape, c'est probablement là qu'il faut ajuster un nom de
> champ — le reste de la logique (synchro, catégorisation) est indépendant de ça et
> déjà testé.

---

## Où vivent les choses

```
src/lib/            le "cerveau" : montants, catégorisation, budgets, alertes (fonctions pures, testées)
src/db/             base SQLite : schéma, accès aux données (repositories)
src/enablebanking/  connexion à CIC via Enable Banking (JWT, client HTTP, sync)
src/app/            les écrans (Next.js) + routes API
data/budget.db      ta base de données locale (ignorée par git)
secrets/            ta clé privée Enable Banking (ignorée par git)
docs/superpowers/   la spec et le plan de construction
```
