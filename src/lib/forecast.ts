import { monthKey } from "./money";

export type Direction = "in" | "out";

export type GroupLine = {
  id: number;
  name: string;
  amount: number;
  day: number | null;
  keyword: string;
};

export type Group = {
  id: number;
  accountId: string;
  name: string;
  direction: Direction;
  lines: GroupLine[];
};

export type Txn = { date: string; amount: number; label: string; accountId: string };

// La bascule d'année n'a pas besoin d'être calculée : le mois suivant se déduit
// de currentEstimate + la somme signée de toutes les lignes (montant plein),
// indépendamment de la valeur de la chaîne de mois.

export type TimelineItem = { day: number; name: string; amount: number; seen: boolean };

export type GroupView = {
  id: number;
  name: string;
  direction: Direction;
  total: number;
  spent: number;
};

export type AccountForecast = {
  accountId: string;
  balance: number;
  currentEstimate: number;
  nextEstimate: number;
  timeline: TimelineItem[];
  groups: GroupView[];
};

export function computeForecast(
  accountId: string,
  balance: number,
  groups: Group[],
  txns: Txn[],
  month: string,
): AccountForecast {
  const monthTxns = txns.filter((t) => monthKey(t.date) === month);
  let current = balance;
  let nextDelta = 0;
  const timeline: TimelineItem[] = [];
  const groupViews: GroupView[] = [];

  for (const g of groups) {
    const sign = g.direction === "in" ? 1 : -1;
    let total = 0;
    let spent = 0;

    for (const line of g.lines) {
      total += line.amount;
      nextDelta += sign * line.amount;

      const kw = line.keyword.toLowerCase();
      const lineMatches = (t: Txn) => {
        const signOk = g.direction === "out" ? t.amount < 0 : t.amount > 0;
        return t.accountId === accountId && signOk && t.label.toLowerCase().includes(kw);
      };

      if (line.day !== null) {
        const seen = monthTxns.some(lineMatches);
        if (!seen) current += sign * line.amount;
        if (seen) spent += line.amount;
        timeline.push({ day: line.day, name: line.name, amount: sign * line.amount, seen });
      } else {
        const paid = monthTxns.filter(lineMatches).reduce((s, t) => s + Math.abs(t.amount), 0);
        const remaining = Math.max(0, line.amount - paid);
        current -= remaining;
        spent += Math.min(paid, line.amount);
      }
    }

    groupViews.push({ id: g.id, name: g.name, direction: g.direction, total, spent });
  }

  timeline.sort((a, b) => a.day - b.day);
  return {
    accountId,
    balance,
    currentEstimate: current,
    nextEstimate: current + nextDelta,
    timeline,
    groups: groupViews,
  };
}
