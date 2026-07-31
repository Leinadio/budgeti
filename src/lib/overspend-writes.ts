// Une écriture de montant posée par une décision « permanent ». `before` est le
// montant qui existait à ce mois avant la décision (null s'il n'y en avait aucun) :
// c'est lui qui permet d'annuler exactement, sans écraser un montant saisi depuis.
// Ces écritures sont toujours DURABLES (« ongoing ») : une hausse permanente n'a de
// sens que reconduite sur les mois suivants. La portée n'est donc pas portée ici — les
// repositories l'ont par défaut — mais amountAt, juste en dessous, doit le savoir.
export type BudgetWrite = {
  target: "group" | "line";
  id: number;              // identifiant de groupe ou de ligne selon `target`
  month: string;           // YYYY-MM, mois d'entrée en vigueur
  amount: number;
  before: number | null;
};

import type { DatedEntry } from "./budget-in-force";

// Seuil sous lequel un écart est un arrondi, pas un dépassement (même seuil que
// computeOverspends).
const EPS = 0.005;

// Hausse permanente d'une enveloppe : elle prend effet au mois qui SUIT celui du
// dépassement. Le mois du dépassement garde son budget réel, c'est un fait passé.
// `cible` (le mois d'effet) est déterminé une seule fois par l'appelant
// (decideOverspend, dans actions.ts, via nextMonthKey(month)) : c'est aussi lui
// qui sert à capturer `before` avant d'écrire ici. Le recalculer une seconde fois
// ici referait diverger silencieusement les deux si l'un des deux calculs
// changeait sans l'autre — rien ne tsc ne le verrait.
export function envelopeWrites(
  groupId: number, cible: string, amount: number, before: number | null,
): BudgetWrite[] {
  return [{ target: "group", id: groupId, month: cible, amount, before }];
}

// Défait des écritures : on ne touche qu'aux entrées dont le montant est encore
// celui que la décision avait posé. Celles qu'on a modifiées depuis restent en
// place. `restore` reçoit un montant d'avant, `remove` n'en avait pas.
export function undoWrites(
  writes: BudgetWrite[],
  enPlace: (w: BudgetWrite) => number | null,
): { restore: BudgetWrite[]; remove: BudgetWrite[] } {
  const restore: BudgetWrite[] = [];
  const remove: BudgetWrite[] = [];
  for (const w of writes) {
    const actuel = enPlace(w);
    if (actuel === null || Math.abs(actuel - w.amount) > EPS) continue;
    if (w.before === null) remove.push(w);
    else restore.push(w);
  }
  return { restore, remove };
}

// Montant posé EXACTEMENT à `month` dans une série d'entrées datées — distinct
// de lineAmountInForce/budgetInForce, qui retombent sur la dernière entrée
// <= month. Null si aucune entrée n'existe précisément à ce mois, même s'il en
// existe une antérieure : c'est cette nuance qui fait que `undoWrites`
// SUPPRIME (au lieu de restaurer une valeur) une écriture dont le `before`
// avait été capturé alors qu'aucun montant n'était explicitement posé à ce
// mois avant la décision.
export function amountAt(serie: DatedEntry[], month: string): number | null {
  // Les exceptions (« ce mois seulement ») sont écartées : une décision « permanent »
  // écrit un montant DURABLE, c'est donc le montant durable de ce mois-là qu'elle
  // écrase et qu'il faut savoir restaurer. Capturer une exception ici la ferait
  // ressusciter en montant permanent à l'annulation, et tous les mois suivants la
  // reprendraient.
  return serie.find((e) => e.scope !== "once" && e.effectiveMonth === month)?.amount ?? null;
}

// Une décision qui ne pose aucune écriture ne doit jamais garder un tableau
// vide : ça laisserait croire qu'une ventilation a été calculée alors qu'il ne
// s'est rien passé. Normalise vers null dans ce cas.
export function normalizeWrites(writes: BudgetWrite[] | null): BudgetWrite[] | null {
  return writes && writes.length === 0 ? null : writes;
}
