// --- La durée de vie d'un groupe -------------------------------------------
// Un groupe de dépense ne vit pas forcément pour toujours. Trois façons de dire
// jusqu'à quand, telles que le formulaire de création les propose :
//
//   single  un seul mois       — une dépense qui ne revient pas (des vacances)
//   range   de tel à tel mois  — une dépense qui s'arrête (un crédit, un stage)
//   from    à partir de tel mois, sans fin — le cas courant (les courses)
//
// La traduction en bornes de base (start_month / end_month, où null veut dire
// « sans fin ») vit ici et pas dans le formulaire : c'est une règle, elle se teste.
import { isMonthKey, nextMonthKey } from "./history";

export type PeriodMode = "single" | "range" | "from";

// Le début du monde. Un groupe ancré là ne « démarre » pas en janvier 2000 : il vaut
// pour tous les mois, ceux d'avant aujourd'hui comme ceux d'après. C'est le seul mois
// qui ne se choisit pas dans un calendrier, d'où cette constante plutôt qu'un littéral
// recopié à chaque endroit qui en a besoin.
export const ORIGIN_MONTH = "2000-01";

// Le plus tôt qu'une fin de plage puisse tomber : le mois SUIVANT le début. Une
// plage qui commence et finit le même mois décrit « un seul mois », qui a son propre
// choix dans le formulaire — deux façons d'écrire la même chose, dont l'une passe par
// un mois de fin qu'on croit avoir choisi. D'où cette borne, tenue à la fois par le
// calendrier du formulaire (ce qu'on peut cliquer) et par groupPeriod (ce qui entre
// en base).
export function minEndMonth(startMonth: string): string {
  return nextMonthKey(startMonth);
}

// Ramène un mois de fin dans le domaine permis. Sert quand on change le DÉBUT : la
// fin déjà affichée peut se retrouver rattrapée, et vaut mieux repartir au premier
// mois encore permis que rester sur un mois que le formulaire refusera.
export function fitEndMonth(startMonth: string, endMonth: string): string {
  const min = minEndMonth(startMonth);
  return endMonth < min ? min : endMonth;
}

// --- Ce que le formulaire demande, et ce que ça vaut -------------------------
// À l'écran, la durée pose TROIS questions : depuis toujours, à partir d'un mois sans
// fin, ou des mois précis ? Et dans le dernier cas, un « + » ajoute un mois de fin.
// Parce que « un seul mois » et « d'un mois à un autre » ne sont pas deux natures
// différentes : c'est la même chose avec ou sans fin, et en faire deux entrées de menu
// obligeait à choisir avant de savoir.
//
// Les deux premiers choix ne diffèrent que par leur début, pas par leur fin : ils
// donnent tous deux le mode « from ». « Depuis toujours » ne demande donc aucun mois —
// c'est draftStart qui le pose, plutôt qu'un champ qu'il faudrait remplir pour dire
// une évidence.
//
// Les trois modes ci-dessus restent le langage de la base ; la traduction entre les
// deux se fait ici, une fois, plutôt que dans chaque formulaire.
export type PeriodChoice = "always" | "from" | "dates";
export type PeriodDraft = { choice: PeriodChoice; start: string; end: string | null };

export function draftMode(d: PeriodDraft): PeriodMode {
  if (d.choice === "always" || d.choice === "from") return "from";
  return d.end === null ? "single" : "range";
}

// Le mois de départ qui entre en base. « Depuis toujours » écrase ce que le brouillon
// garde en réserve : l'écran ne montre pas de champ dans ce cas, donc le mois qui y
// traîne (celui d'un aller-retour dans le menu, ou le mois par défaut) n'a jamais été
// choisi et ne doit pas ressortir.
export function draftStart(d: PeriodDraft): string {
  return d.choice === "always" ? ORIGIN_MONTH : d.start;
}

// L'inverse : ouvrir le formulaire d'un groupe qui existe déjà sur ce qu'il est.
// `defaut` sert de mois de départ aux groupes hérités, qui n'en ont pas — il reste dans
// le brouillon pour le cas où l'on bascule sur un autre choix, même quand le groupe
// vaut depuis toujours et que le champ est caché.
export function draftOfPeriod(
  startMonth: string | null | undefined,
  endMonth: string | null | undefined,
  defaut = "",
): PeriodDraft {
  const start = startMonth ?? defaut;
  if (endMonth == null) {
    // Sans mois de départ, rien n'a jamais borné le groupe : il vaut depuis toujours,
    // au même titre que celui qu'on a explicitement ancré à l'origine. Le « <= » plutôt
    // qu'une égalité stricte couvre les rares groupes ancrés encore plus tôt.
    const toujours = startMonth == null || startMonth <= ORIGIN_MONTH;
    return { choice: toujours ? "always" : "from", start, end: null };
  }
  return { choice: "dates", start, end: endMonth === start ? null : endMonth };
}

// Rend les deux bornes à écrire, ou null si la période demandée ne décrit aucun
// mois vécu — au formulaire de le dire, plutôt qu'à cette fonction de réparer en
// silence une saisie que personne n'a voulue.
export function groupPeriod(
  mode: PeriodMode,
  startMonth: string,
  endMonth?: string,
): { startMonth: string; endMonth: string | null } | null {
  if (!isMonthKey(startMonth)) return null;
  if (mode === "from") return { startMonth, endMonth: null };
  // Un seul mois commence et finit au même endroit. Un mois de fin resté d'un autre
  // choix est ignoré : le formulaire garde ses champs montés d'un mode à l'autre.
  if (mode === "single") return { startMonth, endMonth: startMonth };
  // Une fin qui ne dépasse pas le début ne décrit aucune plage : soit elle précède le
  // début (le groupe ne vivrait aucun mois), soit elle l'égale (c'est « un seul mois »,
  // cf. minEndMonth). Refuser plutôt que réparer en silence — l'écran doit pouvoir le dire.
  if (!isMonthKey(endMonth) || endMonth < minEndMonth(startMonth)) return null;
  return { startMonth, endMonth };
}
