import { expect, test } from "vitest";
import { resteExplanation, sumExplanation, runningExplanation, soldeActuelExplanation } from "../../src/lib/history-explain";

test("resteExplanation: Budget − Dépensé", () => {
  const e = resteExplanation(150.95, 114.82);
  expect(e.steps).toEqual([
    { label: "Budget", amount: 150.95 },
    { label: "Dépensé", amount: -114.82 },
  ]);
  expect(e.result).toBeCloseTo(36.13, 2);
});

test("sumExplanation additionne les entrées", () => {
  const e = sumExplanation("Dépensé", [
    { label: "CARREFOUR", amount: 50 },
    { label: "LECLERC", amount: 64.82 },
  ]);
  expect(e.result).toBeCloseTo(114.82, 2);
  expect(e.title).toBe("Dépensé");
});

test("runningExplanation: solde précédent + net de la ligne", () => {
  const e = runningExplanation(530.21, -114.82);
  expect(e.steps).toEqual([
    { label: "Solde ligne précédente", amount: 530.21 },
    { label: "Mouvement de cette ligne", amount: -114.82 },
  ]);
  expect(e.result).toBeCloseTo(415.39, 2);
});

test("soldeActuelExplanation: départ + reçu − dépensé", () => {
  const e = soldeActuelExplanation(-121.88, 1157.58, 1222.85);
  expect(e.result).toBeCloseTo(-187.15, 2);
  expect(e.steps.map((s) => s.label)).toEqual(["Argent de départ", "Total reçu", "Total dépensé"]);
});
