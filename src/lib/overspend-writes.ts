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

// Une décision « permanent » sur un récurrent n'a de sens que ventilée sur ses
// lignes : un récurrent n'a pas de montant à lui (son budget est la somme de
// ses lignes), il n'y a donc rien de sûr à écrire au niveau du groupe. Sans
// ventilation fournie (lineAmounts absent ou vide), la décision doit être
// refusée — plutôt que d'écrire un montant mort sur le groupe (jamais lu) ou
// d'enregistrer une décision qui fait taire l'alerte sans rien relever.
export function canDecidePermanent(
  groupKind: "envelope" | "recurring",
  lineAmounts: { lineId: number; amount: number }[] | undefined,
): boolean {
  return groupKind === "envelope" || !!lineAmounts?.length;
}

// Une décision qui ne pose aucune écriture ne doit jamais garder un tableau
// vide : ça laisserait croire qu'une ventilation a été calculée alors qu'il ne
// s'est rien passé. Normalise vers null dans ce cas.
export function normalizeWrites(writes: BudgetWrite[] | null): BudgetWrite[] | null {
  return writes && writes.length === 0 ? null : writes;
}
