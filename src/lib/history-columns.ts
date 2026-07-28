// --- Modèle de colonnes par type de mois -----------------------------------
// Les colonnes affichées dépendent de la position du mois par rapport au mois
// courant : un mois passé garde les colonnes réelles, le mois courant y ajoute
// les projections (prévu / dépassement), un mois futur ne montre plus le réel.
export type MonthType = "past" | "current" | "future";
export type ColKey =
  | "budgetRem" | "budgetDep" | "dep" | "recu" | "reste"
  | "soldeReel" | "soldePrevu" | "soldeDepass";

export function monthType(m: string, currentMonth: string): MonthType {
  return m < currentMonth ? "past" : m === currentMonth ? "current" : "future";
}

export function monthColumns(type: MonthType): ColKey[] {
  const base: ColKey[] = ["budgetRem", "budgetDep", "dep", "recu", "reste", "soldeReel", "soldePrevu"];
  // Sur les mois de projection, « Solde si dépassement » ne dirait que la même chose
  // que « Solde prévu » (les dépassements permanents sont passés dans le budget) : on
  // ne l'affiche que sur les mois passés et le mois en cours.
  return type === "future" ? base : [...base, "soldeDepass"];
}

export const COL_LABEL: Record<ColKey, string> = {
  budgetRem: "Budget rém.",
  budgetDep: "Budget dép.",
  dep: "Dép.",
  recu: "Reçu",
  reste: "Balance",
  soldeReel: "Solde réel",
  soldePrevu: "Solde prévu",
  soldeDepass: "Solde si dépassement",
};

// Explication complète de chaque colonne, affichée dans le side panel quand on clique
// son en-tête (un paragraphe par entrée).
export const COL_INFO: Record<ColKey, string[]> = {
  budgetRem: [
    "C'est l'argent que tu comptes recevoir ce mois-ci : tes rentrées d'argent. C'est une prévision, le montant que tu attends — pas encore celui qui est arrivé sur le compte. Ce qui est vraiment arrivé, tu le vois dans la colonne « Reçu » juste à côté.",
    "Tu peux avoir deux sortes de rentrées. Celle de tous les mois, ton revenu habituel : on la reporte sur tous les mois du tableau, parce qu'on sait qu'elle va revenir. Et une rentrée exceptionnelle, un coup de pouce que tu te verses quand le mois est serré : celle-là, on ne la compte que ce mois-ci, parce qu'on ne peut pas parier qu'elle reviendra.",
    "Par exemple : si d'habitude tu reçois 650 € et que ce mois-ci tu ajoutes 500 € exceptionnels, la case affiche 1 150 € ce mois-ci, mais elle repasse à 650 € les mois d'après.",
  ],
  budgetDep: [
    "C'est la limite que tu te fixes pour tes dépenses ce mois-ci : le « je ne veux pas dépenser plus que ça » de chaque poste. Juste à côté, « Dépensé » te dit combien tu as vraiment sorti, et « Reste/Manque » te dit s'il te reste de la marge ou si tu as débordé.",
    "Il y a deux genres de dépenses là-dedans. Celles qui tombent tous les mois, toujours pareilles, comme les abonnements, le loyer ou les impôts : tu connais le montant à l'avance. Et les enveloppes, une sorte de cagnotte que tu te donnes pour les postes qui bougent, comme les courses, les sorties ou l'essence.",
    "Cette case ne concerne que ce qui sort de ton compte. Pour l'argent qui rentre, c'est l'autre colonne, le budget rémunération, qui s'en occupe.",
    "Par exemple : 220 € de dépenses régulières plus 335 € d'enveloppes, ça fait un budget de dépenses de 555 € pour le mois.",
  ],
  dep: [
    "C'est l'argent qui est vraiment parti de ton compte ce mois-ci pour ce poste. Pas une prévision : le vrai, ce que tes achats t'ont coûté.",
    "À ne pas confondre avec le budget dépense, qui est ce que tu avais prévu de dépenser. En comparant les deux, tu vois d'un coup d'œil si tu es resté dans ton budget ou si tu l'as dépassé — c'est justement ce que t'affiche la colonne « Reste/Manque » juste après.",
    "Par exemple : si tu as payé 114 € d'abonnements et 100 € d'essence, ces montants s'additionnent dans ce que tu as dépensé sur le mois.",
  ],
  recu: [
    "C'est l'argent qui est vraiment arrivé sur ton compte ce mois-ci pour cette catégorie. Le vrai encaissement, pas la prévision.",
    "Ça n'a de sens que pour tes rentrées d'argent, comme ta paie ou un virement, et pour les opérations que tu n'as pas encore rangées dans une catégorie. Pour tes enveloppes et tes dépenses régulières, la case reste vide : ce sont des postes de dépense, tu n'y reçois jamais rien.",
    "Par exemple : tu attends 650 €. Tant qu'ils ne sont pas là, cette case affiche 0. Dès qu'ils tombent sur le compte, elle passe à 650 €.",
  ],
  reste: [
    "Ça répond à une question toute simple : sur ce budget, est-ce qu'il me reste de la marge, ou est-ce que j'ai trop dépensé ?",
    "Si le chiffre est positif, c'est ce qu'il te reste à dépenser avant d'épuiser le budget. S'il est négatif et en rouge, c'est que tu as dépensé plus que prévu, et le chiffre te dit de combien tu as débordé.",
    "Par exemple : un budget de 250 € où tu as dépensé 144 €, il te reste 106 €. Un budget de 85 € où tu as dépensé 100 €, tu es à −15 € : tu as débordé de 15 €.",
  ],
  soldeReel: [
    "C'est l'argent que tu as vraiment sur ton compte, reconstitué étape par étape.",
    "On part du vrai solde de ta banque aujourd'hui, et on remonte le fil des opérations pour retrouver où tu en étais à chaque mois. Chaque rentrée le fait monter, chaque dépense le fait descendre.",
    "C'est le chiffre le plus sûr, parce qu'il ne repose sur aucune supposition : que du réel. C'est ce qui le différencie des deux colonnes « Solde prévu » et « Solde si dépassement », qui sont des estimations.",
    "Pour les mois à venir, il n'y a pas encore de réel : la colonne prolonge alors l'estimé de fin du mois en cours, la meilleure idée qu'on ait de ce que sera vraiment ton compte.",
  ],
  soldePrevu: [
    "Ça répond à : combien me restera-t-il si je dépense pile ce que j'ai prévu, sans aucun dérapage ?",
    "On prend ce que tu as au départ, on ajoute ce que tu comptes recevoir, on enlève ce que tu comptes dépenser, et on enchaîne mois après mois : ce qui reste à la fin d'un mois devient ton point de départ pour le suivant.",
    "Sur le mois en cours, il peut être différent du solde réel. Le solde réel tient compte de ce que tu as déjà fait, alors que celui-ci applique ton plan en entier. Comparer les deux te dit si tu es en avance ou en retard sur ton plan.",
    "Par exemple : tu démarres à −120 €, tu attends 650 €, tu prévois 555 € de dépenses. Il te resterait −25 € en fin de mois.",
  ],
  soldeDepass: [
    "C'est ton plan mis à l'épreuve : le Solde prévu, duquel on retire les dépassements qui risquent de continuer.",
    "Sur les mois passés et le mois en cours, ce sont tes dépassements réels qui sont retirés. Sur les mois à venir, uniquement ceux que tu as marqués « Permanent » : par défaut un dépassement est vu comme un accident ponctuel, on ne le reconduit pas tout seul.",
    "Quand un budget déborde, l'app te demande de décider : exceptionnel (un accident, on l'oublie) ou permanent (ça va revenir). « Permanent » ne touche ni à ton budget ni à ton Solde prévu : il reporte simplement le dépassement ici, sur les mois futurs.",
    "Tant que rien n'est marqué permanent, cette colonne rejoint le Solde prévu sur les mois à venir. L'écart entre les deux mesure ce que tes dépassements récurrents coûtent vraiment à ta projection.",
  ],
};
