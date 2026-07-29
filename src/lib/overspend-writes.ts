import { nextMonthKey } from "./history";

// Une écriture de montant posée par une décision « permanent ». `before` est le
// montant qui existait à ce mois avant la décision (null s'il n'y en avait aucun) :
// c'est lui qui permet d'annuler exactement, sans écraser un montant saisi depuis.
export type BudgetWrite = {
  target: "group" | "line";
  id: number;              // identifiant de groupe ou de ligne selon `target`
  month: string;           // YYYY-MM, mois d'entrée en vigueur
  amount: number;
  before: number | null;
};

// Seuil sous lequel un écart est un arrondi, pas un dépassement (même seuil que
// computeOverspends).
const EPS = 0.005;

// Lignes d'un récurrent dont la dépense du mois excède le budget du mois.
export function overspentLines(
  lines: { id: number; name: string }[],
  budgetOf: (lineId: number) => number,
  spentOf: (lineId: number) => number,
): { lineId: number; name: string; budget: number; spent: number }[] {
  return lines
    .map((l) => ({ lineId: l.id, name: l.name, budget: budgetOf(l.id), spent: spentOf(l.id) }))
    .filter((l) => l.spent - l.budget > EPS);
}

// Hausse permanente d'une enveloppe : elle prend effet au mois qui SUIT celui du
// dépassement. Le mois du dépassement garde son budget réel, c'est un fait passé.
export function envelopeWrites(
  groupId: number, month: string, amount: number, before: number | null,
): BudgetWrite[] {
  return [{ target: "group", id: groupId, month: nextMonthKey(month), amount, before }];
}

// Hausse permanente d'un récurrent : une écriture par ligne retenue, au mois qui
// suit le dépassement.
export function lineWrites(
  month: string, choix: { lineId: number; amount: number; before: number | null }[],
): BudgetWrite[] {
  const m = nextMonthKey(month);
  return choix.map((c) => ({ target: "line", id: c.lineId, month: m, amount: c.amount, before: c.before }));
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
export function amountAt(serie: { effectiveMonth: string; amount: number }[], month: string): number | null {
  return serie.find((e) => e.effectiveMonth === month)?.amount ?? null;
}

// Un montant de ligne que decideOverspend retiendra réellement pour écrire (même
// filtre que celui appliqué avant lineWrites dans actions.ts). Partagé ici pour
// que le garde-fou et l'écriture jugent exactement la même chose — sinon un
// montant que l'un accepte et l'autre rejette rouvre la faille que ce garde-fou
// doit fermer (voir canDecidePermanent).
export function isValidLineAmount(l: { amount: number }): boolean {
  return Number.isFinite(l.amount) && l.amount > 0;
}

// Une décision « permanent » sur un récurrent n'a de sens que ventilée sur ses
// lignes : un récurrent n'a pas de montant à lui (son budget est la somme de
// ses lignes), il n'y a donc rien de sûr à écrire au niveau du groupe. Sans
// ventilation fournie (lineAmounts absent ou vide), la décision doit être
// refusée — plutôt que d'écrire un montant mort sur le groupe (jamais lu) ou
// d'enregistrer une décision qui fait taire l'alerte sans rien relever. Il ne
// suffit pas que la liste soit non vide : decideOverspend filtre ensuite les
// montants non finis, négatifs ou nuls avant d'écrire (lineWrites), donc le
// garde-fou exige qu'au moins un montant SURVIVE à ce même filtre.
//
// Ce test sur lineAmounts s'applique QUEL QUE SOIT groupKind, pas seulement pour
// un récurrent : decideOverspend aiguille sur `lineAmounts?.length` avant même de
// regarder newBudget, sans se soucier de groupKind. Un appel « envelope » avec un
// lineAmounts non vide mais entièrement invalide prendrait donc, lui aussi, la
// branche lineWrites — écrivant une liste vide tout en enregistrant la décision,
// la même faille que celle visée ci-dessus, sur l'autre branche. D'où l'ordre : on
// juge d'abord ce que lineAmounts, quand il est fourni, laissera réellement
// écrire ; on ne retombe sur la simple nature du groupe que lorsqu'aucune
// ventilation n'a été envoyée du tout (le cas normal d'une enveloppe, qui passe
// newBudget à la place).
export function canDecidePermanent(
  groupKind: "envelope" | "recurring",
  lineAmounts: { lineId: number; amount: number }[] | undefined,
): boolean {
  if (lineAmounts !== undefined) return lineAmounts.some(isValidLineAmount);
  return groupKind === "envelope";
}

// Une décision qui ne pose aucune écriture ne doit jamais garder un tableau
// vide : ça laisserait croire qu'une ventilation a été calculée alors qu'il ne
// s'est rien passé. Normalise vers null dans ce cas.
export function normalizeWrites(writes: BudgetWrite[] | null): BudgetWrite[] | null {
  return writes && writes.length === 0 ? null : writes;
}
