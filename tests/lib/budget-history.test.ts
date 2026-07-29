import { describe, it, expect } from "vitest";
import { budgetChanges, amountAtMonth, canRemoveBudgetChange } from "../../src/lib/budget-history";

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

describe("protection du montant de départ contre la suppression", () => {
  it("refuse de supprimer l'entrée la plus ancienne, même s'il existe un changement plus tardif", () => {
    const entries = [
      { effectiveMonth: "2000-01", amount: 250 },
      { effectiveMonth: "2026-08", amount: 300 },
    ];
    expect(canRemoveBudgetChange(entries, "2000-01")).toBe(false);
  });

  it("refuse de supprimer l'unique entrée d'un groupe", () => {
    const entries = [{ effectiveMonth: "2000-01", amount: 250 }];
    expect(canRemoveBudgetChange(entries, "2000-01")).toBe(false);
  });

  it("autorise la suppression d'un changement postérieur au montant de départ", () => {
    const entries = [
      { effectiveMonth: "2000-01", amount: 250 },
      { effectiveMonth: "2026-08", amount: 300 },
    ];
    expect(canRemoveBudgetChange(entries, "2026-08")).toBe(true);
  });

  it("refuse aussi quand l'entrée la plus ancienne n'est pas 2000-01 (pas de repli)", () => {
    // Cas tordu : si la vraie base a déjà disparu, la nouvelle entrée la plus
    // ancienne joue le même rôle et doit être protégée de la même façon.
    const entries = [
      { effectiveMonth: "2026-08", amount: 300 },
      { effectiveMonth: "2026-11", amount: 280 },
    ];
    expect(canRemoveBudgetChange(entries, "2026-08")).toBe(false);
    expect(canRemoveBudgetChange(entries, "2026-11")).toBe(true);
  });

  it("protège aussi le montant de départ d'une ligne de récurrent (removeLineAmount réutilise la même fonction)", () => {
    // Une ligne créée en juin puis relevée en juillet : la même règle doit
    // interdire de retirer l'entrée de juin (la ligne se retrouverait sans
    // montant, donc à 0) mais autoriser de retirer celle de juillet.
    const entries = [
      { effectiveMonth: "2026-06", amount: 12.14 },
      { effectiveMonth: "2026-07", amount: 151.84 },
    ];
    expect(canRemoveBudgetChange(entries, "2026-06")).toBe(false);
    expect(canRemoveBudgetChange(entries, "2026-07")).toBe(true);
  });
});
