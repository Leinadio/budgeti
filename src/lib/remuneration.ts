import { resolveOwnership, type OwnableGroup, type OwnedTxn } from "./ownership";
import type { Group, Txn } from "./forecast";

export type MonthRemuneration = {
  month: string;
  principal: number;
  supplementary: number;
  expenses: number;
  balanceVsPrincipal: number; // principal - dépenses
  balanceVsTotal: number; // principal + supplémentaire - dépenses
  suggestedNextPrincipal: number; // principal + supplémentaire
};

function toOwnable(g: Group): OwnableGroup {
  return {
    id: g.id,
    accountId: g.accountId,
    direction: g.direction,
    kind: g.kind,
    keywords: g.kind === "envelope" ? g.keywords : g.lines.map((l) => l.keyword),
  };
}

// Analyse d'un mois : principal vs supplémentaire reçus, dépenses, et les deux
// lectures. Seules les transactions rattachées à un groupe comptent.
export function monthRemuneration(groups: Group[], txns: Txn[], month: string): MonthRemuneration {
  const ownable = groups.map(toOwnable);
  const byId = new Map(groups.map((g) => [g.id, g] as const));
  let principal = 0;
  let supplementary = 0;
  let expenses = 0;
  for (const t of txns) {
    if (t.date.slice(0, 7) !== month) continue;
    const o: OwnedTxn = { id: t.id, date: t.date, amount: t.amount, label: t.label, accountId: t.accountId, groupId: t.groupId, excluded: t.excluded };
    const res = resolveOwnership(o, ownable);
    if (res.status !== "manual") continue;
    const g = byId.get(res.groupId);
    if (!g) continue;
    // La classe de revenu vient du groupe, et non plus de l'étiquette de transaction.
    if (g.incomeKind === "principal") principal += Math.abs(t.amount);
    else if (g.incomeKind === "supplementary") supplementary += Math.abs(t.amount);
    else if (g.direction === "out") expenses += Math.abs(t.amount);
  }
  return {
    month,
    principal,
    supplementary,
    expenses,
    balanceVsPrincipal: principal - expenses,
    balanceVsTotal: principal + supplementary - expenses,
    suggestedNextPrincipal: principal + supplementary,
  };
}
