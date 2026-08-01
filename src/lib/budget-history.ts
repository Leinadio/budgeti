import { amountInForce, type BudgetScope, type DatedEntry } from "./budget-in-force";

// Un montant dans la vie d'un budget : le mois où il prend effet, sa valeur, sa portée
// (« ongoing » = à partir de ce mois / « once » = ce mois seulement), et s'il s'agit du
// montant de départ — la première entrée DURABLE, celle qui ne se supprime pas.
export type BudgetChange = { month: string; amount: number; isStart: boolean; scope: BudgetScope };

// Liste lisible des montants d'un budget, triée par mois croissant, et à mois égal le
// montant durable avant l'exception (l'ordre de lecture : la règle, puis ce qui y
// déroge). Un changement DURABLE qui répète le montant déjà en vigueur est masqué : il
// n'apprend rien. Une exception, elle, s'affiche toujours, même si son montant est le
// même — c'est une décision explicite, et il faut pouvoir la retirer.
export function budgetChanges(entries: DatedEntry[]): BudgetChange[] {
  const rang = (e: DatedEntry) => (e.scope === "once" ? 1 : 0);
  const triees = [...entries].sort((a, b) =>
    a.effectiveMonth === b.effectiveMonth ? rang(a) - rang(b) : a.effectiveMonth < b.effectiveMonth ? -1 : 1,
  );
  const out: BudgetChange[] = [];
  // Dernier montant durable rencontré : c'est à lui qu'on compare pour masquer un
  // changement sans effet. Une exception ne le met pas à jour — elle ne vaut que pour
  // son mois, elle ne devient jamais le montant de référence des mois suivants.
  let courant: number | null = null;
  let departPose = false;
  for (const e of triees) {
    if (e.scope === "once") {
      out.push({ month: e.effectiveMonth, amount: e.amount, isStart: false, scope: "once" });
      continue;
    }
    if (courant !== null && Math.abs(e.amount - courant) < 0.005) continue;
    // Le montant de départ est le premier montant durable, pas la première entrée : une
    // exception antérieure ne peut pas servir de socle aux mois qui suivent.
    out.push({ month: e.effectiveMonth, amount: e.amount, isStart: !departPose, scope: "ongoing" });
    departPose = true;
    courant = e.amount;
  }
  return out;
}

// Montant en vigueur à `month` dans une liste de changements déjà triée (celle que rend
// budgetChanges) : même règle que partout ailleurs — une exception posée exactement à ce
// mois l'emporte, sinon le dernier montant durable atteint, 0 par défaut.
export function amountAtMonth(changes: BudgetChange[], month: string): number {
  return amountInForce(
    changes.map((c) => ({ effectiveMonth: c.month, amount: c.amount, scope: c.scope })),
    month,
  );
}

// Une entrée de la frise porte-t-elle encore une corbeille ? Une seule raison de dire
// non : le montant de départ, dont rien ne prendrait le relais pour les mois qui le
// précèdent (cf. canRemoveBudgetChange). Le calendrier n'entre pas dans la question —
// une entrée posée sur un mois écoulé se retire comme les autres, sans quoi un montant
// mis là par erreur ne pourrait plus jamais en repartir. Une exception n'est jamais un
// montant de départ : elle se retire toujours. La question se pose par ENTRÉE et non
// par mois : deux portées peuvent partager un mois, et retirer l'exception ne doit pas
// emporter le montant durable.
export function canRemoveChange(c: BudgetChange): boolean {
  return !c.isStart;
}

// Une entrée DURABLE ne se supprime que s'il en existe une autre, durable et antérieure,
// pour prendre le relais. Sinon `month` est (au moins à égalité) le plus ancien montant
// durable du groupe — le montant de départ, ou ce qui en tient lieu — et le retirer
// laisserait sans budget tous les mois qui le précédaient, jusqu'au prochain changement
// s'il y en a un, ou le groupe entier s'il n'y en a pas. Une exception, elle, ne sert de
// socle à personne : elle se retire toujours.
//
// La règle porte sur la donnée telle qu'elle est en base (les `entries` passées ici),
// jamais sur un `isStart` calculé côté client : c'est justement ce qui manquait —
// l'affichage cachait la corbeille sur le montant de départ, mais rien n'empêchait
// d'appeler l'action serveur directement avec ce mois-là.
export function canRemoveBudgetChange(
  entries: DatedEntry[],
  month: string,
  scope: BudgetScope = "ongoing",
): boolean {
  if (scope === "once") return true;
  return entries.some((e) => e.scope !== "once" && e.effectiveMonth < month);
}
