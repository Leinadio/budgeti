import { describe, it, expect } from "vitest";
import { budgetChanges, amountAtMonth, canRemoveBudgetChange, canRemoveChange, type BudgetChange } from "../../src/lib/budget-history";

// La frise affichée sous une case de budget propose une corbeille sur ses entrées.
// Une seule raison de ne pas la proposer : le montant de départ, dont plus rien ne
// prendrait le relais pour les mois d'avant. Le calendrier n'entre pas dans la
// question — une entrée d'un mois écoulé se retire comme les autres. Elle se pose
// par ENTRÉE et non par mois : deux portées peuvent partager un mois, et l'exception
// s'y retire sans toucher au permanent.
describe("entrées de la frise encore supprimables", () => {
  const changes = budgetChanges([
    { effectiveMonth: "2026-01", amount: 300 },
    { effectiveMonth: "2026-03", amount: 320 },
    { effectiveMonth: "2026-07", amount: 350 },
    { effectiveMonth: "2026-09", amount: 400 },
  ]);
  const removables = (cs: BudgetChange[]) => cs.filter(canRemoveChange).map((c) => c.month);

  // Y compris 2026-03 et 2026-07, révolus si l'on est en 2027 : un mois passé n'est
  // pas figé, on y corrige un budget après coup.
  it("garde toutes les entrées sauf le montant de départ", () => {
    expect(removables(changes)).toEqual(["2026-03", "2026-07", "2026-09"]);
  });

  it("exclut le montant de départ", () => {
    const seule = budgetChanges([{ effectiveMonth: "2026-07", amount: 300 }]);
    expect(removables(seule)).toEqual([]);
  });

  // Une exception n'est jamais le montant de départ : rien ne dépend d'elle, elle se
  // retire toujours — même si c'est la seule entrée.
  it("laisse toujours retirer une exception", () => {
    const seule = budgetChanges([{ effectiveMonth: "2026-07", amount: 400, scope: "once" }]);
    expect(removables(seule)).toEqual(["2026-07"]);
  });
});

// Ce que la frise raconte : les montants d'un budget, du plus ancien au plus récent,
// chacun avec sa portée. Une exception (« ce mois seulement ») s'y lit comme telle et
// ne se confond pas avec un changement durable.
describe("la portée dans la frise", () => {
  it("porte la portée de chaque entrée", () => {
    expect(
      budgetChanges([
        { effectiveMonth: "2026-03", amount: 250 },
        { effectiveMonth: "2026-07", amount: 400, scope: "once" },
      ]),
    ).toEqual([
      { month: "2026-03", amount: 250, isStart: true, scope: "ongoing" },
      { month: "2026-07", amount: 400, isStart: false, scope: "once" },
    ]);
  });

  // Le montant de départ, c'est le premier montant DURABLE. Une exception antérieure
  // ne prend pas ce rôle : elle ne vaut que pour son mois, elle ne peut pas servir de
  // socle aux mois qui suivent.
  it("ne prend jamais une exception pour le montant de départ", () => {
    expect(
      budgetChanges([
        { effectiveMonth: "2026-02", amount: 400, scope: "once" },
        { effectiveMonth: "2026-03", amount: 250 },
      ]),
    ).toEqual([
      { month: "2026-02", amount: 400, isStart: false, scope: "once" },
      { month: "2026-03", amount: 250, isStart: true, scope: "ongoing" },
    ]);
  });

  // Un changement durable qui répète le montant déjà en vigueur n'apprend rien : on le
  // masque. Une exception, elle, se montre toujours — c'est une décision explicite, et
  // il faut pouvoir la retirer.
  it("masque un changement durable qui ne change rien, mais jamais une exception", () => {
    expect(
      budgetChanges([
        { effectiveMonth: "2026-03", amount: 250 },
        { effectiveMonth: "2026-05", amount: 250 },
        { effectiveMonth: "2026-07", amount: 250, scope: "once" },
      ]),
    ).toEqual([
      { month: "2026-03", amount: 250, isStart: true, scope: "ongoing" },
      { month: "2026-07", amount: 250, isStart: false, scope: "once" },
    ]);
  });

  it("rend le montant en vigueur en respectant la portée", () => {
    const c = budgetChanges([
      { effectiveMonth: "2026-03", amount: 250 },
      { effectiveMonth: "2026-07", amount: 400, scope: "once" },
    ]);
    expect(amountAtMonth(c, "2026-06")).toBe(250);
    expect(amountAtMonth(c, "2026-07")).toBe(400);
    expect(amountAtMonth(c, "2026-08")).toBe(250);
  });
});

describe("vie d'un budget", () => {
  it("marque la première entrée comme montant de départ", () => {
    expect(budgetChanges([{ effectiveMonth: "2000-01", amount: 250 }])).toEqual([
      { month: "2000-01", amount: 250, isStart: true, scope: "ongoing" },
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
      { month: "2000-01", amount: 250, isStart: true, scope: "ongoing" },
      { month: "2026-08", amount: 300, isStart: false, scope: "ongoing" },
      { month: "2026-11", amount: 280, isStart: false, scope: "ongoing" },
    ]);
  });

  it("masque un changement qui ne change rien", () => {
    expect(
      budgetChanges([
        { effectiveMonth: "2000-01", amount: 250 },
        { effectiveMonth: "2026-08", amount: 250 },
      ]),
    ).toEqual([{ month: "2000-01", amount: 250, isStart: true, scope: "ongoing" }]);
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
