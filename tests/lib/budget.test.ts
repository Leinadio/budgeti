import { expect, test } from "vitest";
import { computeEnvelopes, type Txn, type Budget } from "../../src/lib/budget";

const txns: Txn[] = [
  { date: "2026-07-01", amount: -30, category: "Courses" },
  { date: "2026-07-15", amount: -50, category: "Courses" },
  { date: "2026-07-10", amount: -20, category: "Transport" },
  { date: "2026-06-30", amount: -999, category: "Courses" }, // other month, ignored
  { date: "2026-07-20", amount: 100, category: "Courses" },  // credit, ignored in spend
];

const budgets: Budget[] = [
  { category: "Courses", month: "2026-07", limit: 400 },
  { category: "Transport", month: "2026-07", limit: 100 },
];

test("computes spent/remaining/ratio for the month", () => {
  const env = computeEnvelopes(txns, budgets, "2026-07");
  const courses = env.find((e) => e.category === "Courses")!;
  expect(courses.spent).toBe(80);
  expect(courses.remaining).toBe(320);
  expect(courses.ratio).toBeCloseTo(0.2);
});

test("ratio is 0 when limit is 0", () => {
  const env = computeEnvelopes(txns, [{ category: "X", month: "2026-07", limit: 0 }], "2026-07");
  expect(env[0].ratio).toBe(0);
});
