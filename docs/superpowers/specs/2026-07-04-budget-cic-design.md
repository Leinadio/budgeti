# Budget CIC — Spécification de conception

**Date :** 2026-07-04
**Auteur :** Daniel Dupont
**Statut :** Validé (en attente de relecture finale)

## 1. Objectif

Application web personnelle de suivi de budget, tournant en local sur l'ordinateur
de l'utilisateur. Elle se connecte au compte bancaire CIC via un agrégateur Open
Banking, récupère le solde et les transactions, les catégorise automatiquement,
permet de gérer des enveloppes de budget mensuelles, et affiche des alertes.

**Usage strictement personnel et non commercial** : l'utilisateur ne connecte que
ses propres comptes. Aucune obligation réglementaire lourde.

## 2. Contraintes réelles (non négociables)

Ces contraintes viennent de la réglementation bancaire (DSP2) et de l'agrégateur ;
aucun outil ne peut les contourner.

- **Ré-autorisation ~90 jours** : l'accès aux données doit être renouvelé par une
  reconnexion à CIC environ tous les 90 jours (consentement DSP2).
- **Rafraîchissement limité, pas de temps réel à la seconde** : les données sont
  rafraîchies à la demande, un nombre limité de fois par jour sur l'offre gratuite.
  Le solde et les dépenses sont donc « quasi temps réel » (à jour au dernier
  rafraîchissement), pas en streaming continu.
- **Redirection HTTPS en Production** : l'agrégateur refuse les URL de redirection
  en `http://` en environnement Production (scheme non supporté). Le Sandbox
  accepte `http://localhost`.

## 3. Agrégateur : Enable Banking

GoCardless Bank Account Data n'accepte plus de nouvelles inscriptions depuis juillet
2025. On utilise donc **Enable Banking**, qui propose un mode gratuit pour usage
individuel non commercial (connexion à ses propres comptes).

- **Inscription** : https://enablebanking.com/sign-in/ (connexion par lien email à
  usage unique).
- **Control Panel** : on y déclare une « application » (nom, URLs de redirection).
  Le navigateur génère une **clé privée RSA** téléchargée localement + un
  **Application ID**.
- **Authentification** : `Generate in the browser (using SubtleCrypto)` — clé privée
  exportée et conservée localement.

### Stratégie Sandbox → Production

- **Phase de développement** : on construit et teste toute l'application contre
  l'app **Sandbox** existante (« Budgeti », déjà `Active`), qui utilise des banques
  de test factices. Redirection : `http://localhost:3000/api/callback`.
- **Bascule vers le vrai CIC** : une fois l'app fonctionnelle, on crée une app
  **Production**. Il faudra alors :
  - une redirection en **`https://localhost:3000/api/callback`** — Next.js sait
    servir l'app en HTTPS localement (certificat auto-généré et de confiance via
    `next dev --experimental-https`). Pas de domaine ni de tunnel nécessaire.
  - des URLs **Privacy** et **Terms** valides (une URL de dépôt GitHub public suffit,
    réutilisable pour les deux champs).
  - Seuls les secrets/clés changent dans le code ; la logique reste identique.

## 4. Architecture

- **Framework** : Next.js (App Router). Sert l'interface utilisateur et la logique
  serveur qui dialogue avec Enable Banking (les secrets ne transitent jamais côté
  navigateur).
- **Base de données** : SQLite, un simple fichier local. Aucun serveur de base de
  données à installer.
- **Pont bancaire** : API Enable Banking. Application ID + clé privée rangés
  localement dans le projet (fichier de config non versionné, par exemple
  `.env.local` + fichier de clé), jamais partagés.
- **Exécution** : entièrement en local sur `localhost`. Les données bancaires ne
  quittent pas la machine, hormis l'aller-retour vers Enable Banking pour les
  récupérer.

### Flux de connexion à la banque

1. L'utilisateur clique « Connecter ma banque » dans l'app.
2. L'app demande à Enable Banking un lien de connexion pour CIC.
3. Le lien mène à la page d'authentification sécurisée de CIC. L'utilisateur
   s'identifie directement chez sa banque ; l'app ne voit jamais ses identifiants
   bancaires.
4. Après validation, CIC redirige vers l'app (URL de callback locale). L'app obtient
   alors le droit de lire comptes, solde et transactions.

### Flux de synchronisation

- Bouton « Synchroniser » (et synchro automatique à l'ouverture si les données sont
  trop anciennes).
- Récupération des nouvelles transactions depuis Enable Banking.
- Insertion dans SQLite avec déduplication (identifiant de transaction unique fourni
  par la banque).
- Catégorisation automatique des transactions non encore catégorisées.

## 5. Modèle de données (SQLite)

- **accounts** : nom du compte, IBAN masqué, solde actuel, devise, date de dernière
  synchronisation.
- **transactions** : date, montant, libellé brut de la banque, référence au compte,
  catégorie attribuée, identifiant unique bancaire (pour dédup).
- **categories** : liste des enveloppes (Courses, Resto, Transport, Loisirs,
  Abonnements…), modifiable par l'utilisateur.
- **rules** : règles de catégorisation par mot-clé (mot-clé → catégorie).
- **budgets** : pour une catégorie + un mois donné, le plafond mensuel.
- **settings** : préférences utilisateur (seuil d'alerte de solde, date d'expiration
  de l'autorisation, métadonnées de connexion Enable Banking).

## 6. Fonctionnalités

### Catégorisation automatique (règles par mot-clé)

- Chaque transaction est rangée par correspondance de mots-clés dans son libellé
  (ex. « CARREFOUR », « LECLERC » → Courses ; « SNCF », « UBER » → Transport).
- Un jeu de règles de départ couvrant les cas courants en France est fourni.
- Les transactions non reconnues tombent dans **« À catégoriser »**.
- L'utilisateur reclasse une dépense d'un clic ; l'app propose alors de **créer une
  règle** à partir du libellé pour automatiser les fois suivantes.
- Évolution possible (non incluse au départ) : catégorisation par modèle Claude pour
  les libellés difficiles.

### Enveloppes de budget

- Plafond mensuel par catégorie.
- Calcul en direct du montant dépensé dans le mois et du reste à dépenser.
- Barre de progression visuelle : verte (OK), orange (approche), rouge (dépassement).

### Alertes (dans l'app)

Évaluées à chaque ouverture, affichées en haut du tableau de bord :

- 🟠 dépassement de **80 %** d'une enveloppe.
- 🔴 **dépassement** d'une enveloppe.
- 🔴 **solde** sous un seuil défini par l'utilisateur.

Pas d'email ni de push (choix « sur mon ordinateur seulement »).

## 7. Écrans

- **Tableau de bord** : solde total, dépenses du mois, alertes, aperçu des enveloppes
  avec barres de progression, dernières transactions.
- **Transactions** : liste complète, filtres (mois, catégorie), reclassement d'un
  clic.
- **Budgets** : création et ajustement des enveloppes mensuelles.
- **Catégories & règles** : gestion des catégories et des règles de mots-clés.
- **Réglages / Connexion** : connexion bancaire, compte à rebours des 90 jours,
  seuil de solde, synchronisation manuelle.

## 8. Gestion des erreurs

- **Accès expiré (90 jours)** : bandeau « Reconnexion à CIC nécessaire » + bouton de
  reconnexion.
- **Limite de synchronisation atteinte** : message « Déjà synchronisé récemment,
  réessaie plus tard » au lieu d'une erreur brute.
- **Panne réseau / banque indisponible** : affichage des dernières données locales
  connues + message discret, jamais de page blanche.

## 9. Tests

- **Priorité** : moteur de catégorisation (un libellé tombe-t-il dans la bonne
  catégorie ?) et calculs de budget/alertes (dépensé / restant / seuils). Fonctions
  pures et isolées, faciles à tester.
- **Intégration Enable Banking** : testée avec des réponses simulées (mocks), sans
  dépendre de la vraie banque.

## 10. Hors périmètre (YAGNI)

- Multi-utilisateurs / comptes d'autres personnes.
- Hébergement en ligne, accès mobile, notifications email/push.
- Catégorisation par IA (repoussée, activable plus tard si besoin).
- Initiation de paiement (l'app lit les données, elle ne déclenche pas de virement).
