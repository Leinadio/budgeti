import { resolveOwnership, type OwnableGroup } from "./ownership";
import type { TxnView } from "../db/repositories/transactions";

// "all" = tous les groupes, "none" = non catégorisées, number = un groupe précis.
export type GroupFilter = "all" | "none" | number;

export type TxnFilters = {
  text: string;
  group: GroupFilter;
  amountMin: number | null;
  amountMax: number | null;
  dateFrom: string | null;
  dateTo: string | null;
};

export const EMPTY_FILTERS: TxnFilters = {
  text: "",
  group: "all",
  amountMin: null,
  amountMax: null,
  dateFrom: null,
  dateTo: null,
};

export function hasActiveFilters(f: TxnFilters): boolean {
  return (
    f.text.trim() !== "" ||
    f.group !== "all" ||
    f.amountMin != null ||
    f.amountMax != null ||
    !!f.dateFrom ||
    !!f.dateTo
  );
}

export function filterTransactions(txns: TxnView[], filters: TxnFilters, ownable: OwnableGroup[]): TxnView[] {
  const text = filters.text.trim().toLowerCase();
  return txns.filter((t) => {
    if (text && !t.label.toLowerCase().includes(text)) return false;

    const abs = Math.abs(t.amount);
    if (filters.amountMin != null && abs < filters.amountMin) return false;
    if (filters.amountMax != null && abs > filters.amountMax) return false;

    if (filters.dateFrom && t.date < filters.dateFrom) return false;
    if (filters.dateTo && t.date > filters.dateTo) return false;

    if (filters.group !== "all") {
      const res = resolveOwnership(
        { id: t.id, date: t.date, amount: t.amount, label: t.label, accountId: t.accountId, groupId: t.groupId, excluded: t.excluded },
        ownable,
      );
      if (filters.group === "none") {
        if (res.status !== "none") return false;
      } else {
        const owner = res.status === "manual" ? res.groupId : null;
        if (owner !== filters.group) return false;
      }
    }

    return true;
  });
}

export type Summary = { count: number; out: number; in: number; net: number };

export function summarize(txns: TxnView[]): Summary {
  let out = 0;
  let inc = 0;
  for (const t of txns) {
    if (t.amount < 0) out += -t.amount;
    else inc += t.amount;
  }
  return { count: txns.length, out, in: inc, net: inc - out };
}
