import { expect, test } from "vitest";
import { monthLabel, groupByMonth } from "../../src/lib/transactions-view";

test("monthLabel formats the French month with a capital initial", () => {
  expect(monthLabel("2026-07")).toBe("Juillet 2026");
  expect(monthLabel("2026-01")).toBe("Janvier 2026");
});

test("groupByMonth groups by month, first-seen order, items order preserved", () => {
  const txns = [
    { id: "a", date: "2026-07-03" },
    { id: "b", date: "2026-07-01" },
    { id: "c", date: "2026-06-30" },
    { id: "d", date: "2026-06-25" },
  ];
  const g = groupByMonth(txns);
  expect(g.map((x) => x.month)).toEqual(["2026-07", "2026-06"]);
  expect(g.map((x) => x.label)).toEqual(["Juillet 2026", "Juin 2026"]);
  expect(g[0].items.map((x) => x.id)).toEqual(["a", "b"]);
  expect(g[1].items.map((x) => x.id)).toEqual(["c", "d"]);
});
