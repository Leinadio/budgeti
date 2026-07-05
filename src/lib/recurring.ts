import { monthKey } from "./money";

export type RecurringPayment = { id: number; name: string; keyword: string; expected: number };
export type RecurringLine = {
  id: number;
  name: string;
  keyword: string;
  expected: number;
  spent: number;
};
export type RecurringSummary = {
  lines: RecurringLine[];
  totalExpected: number;
  totalSpent: number;
};

export function computeRecurring(
  payments: RecurringPayment[],
  txns: { date: string; amount: number; label: string }[],
  month: string,
): RecurringSummary {
  const lines = payments.map((p) => {
    const needle = p.keyword.toLowerCase();
    const spent = txns
      .filter(
        (t) =>
          monthKey(t.date) === month &&
          t.amount < 0 &&
          t.label.toLowerCase().includes(needle),
      )
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);
    return { id: p.id, name: p.name, keyword: p.keyword, expected: p.expected, spent };
  });
  const totalExpected = lines.reduce((s, l) => s + l.expected, 0);
  const totalSpent = lines.reduce((s, l) => s + l.spent, 0);
  return { lines, totalExpected, totalSpent };
}
