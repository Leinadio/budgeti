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
