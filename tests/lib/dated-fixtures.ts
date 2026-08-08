import { toDatedBudgets, toDatedLineAmounts, type DatedBudgets, type DatedLineAmounts } from "../../src/lib/history";
import type { Group } from "../../src/lib/forecast";

// Reproduit migrateSeedDatedAmounts sur des fixtures : le montant porté par la
// fixture (monthlyAmount pour une dépense plate, amount pour un sous-poste) devient
// la première entrée datée, au mois de départ du groupe.
export function seedDated(groups: Group[]): { dated: DatedBudgets; datedLines: DatedLineAmounts } {
  const start = (g: Group) => g.startMonth ?? "2000-01";
  const budgets = groups
    .filter((g) => g.lines.length === 0)
    .map((g) => ({ groupId: g.id, effectiveMonth: start(g), amount: g.monthlyAmount ?? 0 }));
  const lines = groups.flatMap((g) =>
    g.lines.map((l) => ({ lineId: l.id, effectiveMonth: start(g), amount: l.amount })),
  );
  return { dated: toDatedBudgets(budgets), datedLines: toDatedLineAmounts(lines) };
}

// Fusionne les entrées de départ et celles posées explicitement par un test, en
// gardant chaque suite triée par mois croissant. À mois égal, l'entrée du test gagne.
export function mergeDated(a: DatedBudgets, b?: DatedBudgets): DatedBudgets {
  if (!b) return a;
  const out: DatedBudgets = {};
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const id = Number(key);
    const parMois = new Map<string, number>();
    for (const e of a[id] ?? []) parMois.set(e.effectiveMonth, e.amount);
    for (const e of b[id] ?? []) parMois.set(e.effectiveMonth, e.amount);
    out[id] = [...parMois.entries()]
      .map(([effectiveMonth, amount]) => ({ effectiveMonth, amount }))
      .sort((x, y) => (x.effectiveMonth < y.effectiveMonth ? -1 : 1));
  }
  return out;
}
