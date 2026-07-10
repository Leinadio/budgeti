import { monthKey } from "./money";
import { resolveOwnership, type OwnableGroup, type OwnedTxn } from "./ownership";

export type Direction = "in" | "out";

export type GroupLine = {
  id: number;
  name: string;
  amount: number;
  day: number;
  keyword: string;
};

export type Group = {
  id: number;
  accountId: string;
  name: string;
  direction: Direction;
  kind: "envelope" | "recurring";
  monthlyAmount: number | null;
  keywords: string[];
  lines: GroupLine[];
};

export type Txn = {
  id: string;
  date: string;
  amount: number;
  label: string;
  accountId: string;
  groupId: number | null;
};

export type TimelineItem = { day: number; name: string; amount: number; seen: boolean };

export type GroupView = {
  id: number;
  name: string;
  direction: Direction;
  total: number;
  spent: number;
  overspend: number;
  prevSpent: number;
  prevOverspend: number;
};

export type AccountForecast = {
  accountId: string;
  balance: number;
  currentEstimate: number;
  nextEstimate: number;
  timeline: TimelineItem[];
  groups: GroupView[];
};

function prevMonthKey(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1, 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function toOwnable(g: Group): OwnableGroup {
  return {
    id: g.id,
    accountId: g.accountId,
    direction: g.direction,
    kind: g.kind,
    keywords: g.kind === "envelope" ? g.keywords : g.lines.map((l) => l.keyword),
  };
}

export function computeForecast(
  accountId: string,
  balance: number,
  groups: Group[],
  txns: Txn[],
  month: string,
): AccountForecast {
  const ownable = groups.map(toOwnable);
  const prevMonth = prevMonthKey(month);
  // Transactions de ce compte, avec leur groupe propriétaire résolu (indépendant du mois).
  const owned = txns
    .filter((t) => t.accountId === accountId)
    .map((t) => {
      const o: OwnedTxn = { id: t.id, date: t.date, amount: t.amount, label: t.label, accountId: t.accountId, groupId: t.groupId };
      const res = resolveOwnership(o, ownable);
      const ownerId = res.status === "manual" || res.status === "auto" ? res.groupId : null;
      return { t, ownerId };
    });

  const ownedBy = (gid: number, m: string = month) =>
    owned.filter((o) => o.ownerId === gid && monthKey(o.t.date) === m).map((o) => o.t);
  const spentIn = (gid: number, m: string) =>
    ownedBy(gid, m).reduce((s, t) => s + Math.abs(t.amount), 0);

  let current = balance;
  let nextDelta = 0;
  const timeline: TimelineItem[] = [];
  const groupViews: GroupView[] = [];

  for (const g of groups) {
    const sign = g.direction === "in" ? 1 : -1;

    if (g.kind === "envelope") {
      const amount = g.monthlyAmount ?? 0;
      const spent = spentIn(g.id, month);
      const remaining = Math.max(0, amount - spent);
      current -= remaining;
      nextDelta -= amount;
      const overspend = Math.max(0, spent - amount);
      const prevSpent = spentIn(g.id, prevMonth);
      const prevOverspend = Math.max(0, prevSpent - amount);
      groupViews.push({ id: g.id, name: g.name, direction: g.direction, total: amount, spent, overspend, prevSpent, prevOverspend });
    } else {
      const mine = ownedBy(g.id);
      let total = 0;
      let seenSum = 0;
      for (const line of g.lines) {
        total += line.amount;
        nextDelta += sign * line.amount;
        const kw = line.keyword.toLowerCase();
        const seen = mine.some((t) => t.label.toLowerCase().includes(kw));
        if (!seen) current += sign * line.amount;
        if (seen) seenSum += line.amount;
        timeline.push({ day: line.day, name: line.name, amount: sign * line.amount, seen });
      }
      groupViews.push({ id: g.id, name: g.name, direction: g.direction, total, spent: seenSum, overspend: 0, prevSpent: 0, prevOverspend: 0 });
    }
  }

  timeline.sort((a, b) => a.day - b.day);
  return { accountId, balance, currentEstimate: current, nextEstimate: current + nextDelta, timeline, groups: groupViews };
}
