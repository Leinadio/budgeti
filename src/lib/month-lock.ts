// --- Le verrou des mois passés ---------------------------------------------
// Un mois écoulé est clos : son budget est un fait, plus rien ne peut y être
// écrit ni retiré. C'est la règle qui tient tout le reste debout — sans elle, un
// dépassement tranché des mois plus tard réécrirait après coup des mois déjà
// vécus, et le tableau raconterait une histoire qui n'a jamais eu lieu.
//
// Le verrou se juge partout avec cette seule fonction, écran comme actions
// serveur : deux définitions du « passé » qui divergeraient laisseraient une
// porte ouverte du côté où la règle est la plus laxiste.

// Vrai si `month` est antérieur au mois courant. Les clés « YYYY-MM » se
// comparent comme du texte, l'ordre alphabétique y est l'ordre chronologique.
export function isMonthClosed(month: string, currentMonth: string): boolean {
  return month < currentMonth;
}

// Mois courant d'une horloge, en UTC — exactement comme la page d'historique le
// lit (new Date().toISOString()). Les actions serveur n'ont pas accès au
// currentMonth calculé par la page : elles le recalculent ici, avec la même
// règle, pour qu'un même mois ne soit jamais clos d'un côté et ouvert de l'autre.
export function currentMonthKey(now: Date): string {
  return now.toISOString().slice(0, 7);
}
