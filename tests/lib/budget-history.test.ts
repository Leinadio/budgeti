import { describe, it, expect } from "vitest";
import { budgetChanges, amountAtMonth } from "../../src/lib/budget-history";

describe("vie d'un budget", () => {
  it("marque la première entrée comme montant de départ", () => {
    expect(budgetChanges([{ effectiveMonth: "2000-01", amount: 250 }])).toEqual([
      { month: "2000-01", amount: 250, isStart: true },
    ]);
  });

  it("trie par mois croissant et ne marque que la première", () => {
    expect(
      budgetChanges([
        { effectiveMonth: "2026-08", amount: 300 },
        { effectiveMonth: "2000-01", amount: 250 },
        { effectiveMonth: "2026-11", amount: 280 },
      ]),
    ).toEqual([
      { month: "2000-01", amount: 250, isStart: true },
      { month: "2026-08", amount: 300, isStart: false },
      { month: "2026-11", amount: 280, isStart: false },
    ]);
  });

  it("masque un changement qui ne change rien", () => {
    expect(
      budgetChanges([
        { effectiveMonth: "2000-01", amount: 250 },
        { effectiveMonth: "2026-08", amount: 250 },
      ]),
    ).toEqual([{ month: "2000-01", amount: 250, isStart: true }]);
  });

  it("rend une liste vide sans entrée", () => {
    expect(budgetChanges([])).toEqual([]);
  });

  it("rend le montant en vigueur à un mois donné", () => {
    const c = budgetChanges([
      { effectiveMonth: "2000-01", amount: 250 },
      { effectiveMonth: "2026-08", amount: 300 },
    ]);
    expect(amountAtMonth(c, "2026-07")).toBe(250);
    expect(amountAtMonth(c, "2026-08")).toBe(300);
    expect(amountAtMonth([], "2026-08")).toBe(0);
  });
});
