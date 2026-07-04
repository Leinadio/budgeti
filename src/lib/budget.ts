import { monthKey } from "./money";

export type Txn = { date: string; amount: number; category: string | null };
export type Budget = { category: string; month: string; limit: number };
export type Envelope = {
  category: string;
  limit: number;
  spent: number;
  remaining: number;
  ratio: number;
};

export function computeEnvelopes(txns: Txn[], budgets: Budget[], month: string): Envelope[] {
  return budgets
    .filter((b) => b.month === month)
    .map((b) => {
      const spent = txns
        .filter((t) => monthKey(t.date) === month && t.category === b.category && t.amount < 0)
        .reduce((sum, t) => sum + Math.abs(t.amount), 0);
      const remaining = b.limit - spent;
      const ratio = b.limit > 0 ? spent / b.limit : 0;
      return { category: b.category, limit: b.limit, spent, remaining, ratio };
    });
}
