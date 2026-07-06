import { expect, test } from "vitest";
import { computeRecurring, type RecurringPayment } from "../../src/lib/recurring";

const payments: RecurringPayment[] = [
  { id: 1, name: "Spotify", keyword: "SPOTIFY", expected: 12.14 },
  { id: 2, name: "iCloud", keyword: "icloud", expected: 9.99 },
];

const txns = [
  { date: "2026-07-03", amount: -12.14, label: "PRLV SPOTIFY AB" },
  { date: "2026-07-05", amount: -9.99, label: "APPLE ICLOUD" }, // casse différente
  { date: "2026-06-03", amount: -12.14, label: "PRLV SPOTIFY AB" }, // autre mois
  { date: "2026-07-20", amount: 12.14, label: "REMBOURSEMENT SPOTIFY" }, // crédit, ignoré
];

test("matches by keyword case-insensitively, current month, debits only", () => {
  const s = computeRecurring(payments, txns, "2026-07");
  const spotify = s.lines.find((l) => l.name === "Spotify")!;
  const icloud = s.lines.find((l) => l.name === "iCloud")!;
  expect(spotify.spent).toBeCloseTo(12.14);
  expect(icloud.spent).toBeCloseTo(9.99);
});

test("totals sum expected and spent", () => {
  const s = computeRecurring(payments, txns, "2026-07");
  expect(s.totalExpected).toBeCloseTo(22.13);
  expect(s.totalSpent).toBeCloseTo(22.13);
});

test("spent is 0 when nothing matches the month", () => {
  const s = computeRecurring(payments, txns, "2026-05");
  expect(s.totalSpent).toBe(0);
  expect(s.lines.every((l) => l.spent === 0)).toBe(true);
});
