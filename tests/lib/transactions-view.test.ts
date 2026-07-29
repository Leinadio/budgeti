import { expect, test, describe } from "vitest";
import { monthLabel, groupByMonth, monthPhrase, deMonthPhrase } from "../../src/lib/transactions-view";

test("monthLabel formats the French month with a capital initial", () => {
  expect(monthLabel("2026-07")).toBe("Juillet 2026");
  expect(monthLabel("2026-01")).toBe("Janvier 2026");
});

// Les 12 mois français, avec ce que monthPhrase (minuscule, pour une insertion en
// milieu de phrase) et deMonthPhrase (idem, précédé de la préposition « de »,
// élidée en « d' » devant les 3 mois qui commencent par une voyelle) doivent
// produire. Couvrir les 12 évite qu'une règle approximative (ex. juin/juillet mal
// classés comme voyelles à cause du son, ou un mois oublié) passe inaperçue.
describe("monthPhrase : le mois en minuscule, pour une insertion en milieu de phrase", () => {
  const cases: [string, string][] = [
    ["2026-01", "janvier 2026"],
    ["2026-02", "février 2026"],
    ["2026-03", "mars 2026"],
    ["2026-04", "avril 2026"],
    ["2026-05", "mai 2026"],
    ["2026-06", "juin 2026"],
    ["2026-07", "juillet 2026"],
    ["2026-08", "août 2026"],
    ["2026-09", "septembre 2026"],
    ["2026-10", "octobre 2026"],
    ["2026-11", "novembre 2026"],
    ["2026-12", "décembre 2026"],
  ];
  for (const [ym, expected] of cases) {
    test(`${ym} -> "${expected}"`, () => {
      expect(monthPhrase(ym)).toBe(expected);
    });
  }
});

describe("deMonthPhrase : « de »/« d' » + le mois, élidé devant une voyelle (avril, août, octobre)", () => {
  const cases: [string, string][] = [
    ["2026-01", "de janvier 2026"],
    ["2026-02", "de février 2026"],
    ["2026-03", "de mars 2026"],
    ["2026-04", "d'avril 2026"], // élision : voyelle
    ["2026-05", "de mai 2026"],
    ["2026-06", "de juin 2026"],
    ["2026-07", "de juillet 2026"],
    ["2026-08", "d'août 2026"], // élision : voyelle
    ["2026-09", "de septembre 2026"],
    ["2026-10", "d'octobre 2026"], // élision : voyelle
    ["2026-11", "de novembre 2026"],
    ["2026-12", "de décembre 2026"],
  ];
  for (const [ym, expected] of cases) {
    test(`${ym} -> "${expected}"`, () => {
      expect(deMonthPhrase(ym)).toBe(expected);
    });
  }
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
