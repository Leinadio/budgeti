// La grille d'un calendrier qui ne montre que des mois : douze cases par année,
// celles qui sortent des bornes proposées restent affichées mais inertes.
import { describe, expect, it } from "vitest";
import { monthsOfYear, yearHasMonth, yearOf } from "../../src/lib/month-calendar";

describe("yearOf", () => {
  it("rend l'année d'une clé de mois", () => {
    expect(yearOf("2026-08")).toBe(2026);
    expect(yearOf("2030-01")).toBe(2030);
  });
});

describe("monthsOfYear", () => {
  it("rend les douze mois de l'année, dans l'ordre et zéro-paddés", () => {
    const cells = monthsOfYear(2026, "2000-01", "2099-12");
    expect(cells.map((c) => c.month)).toEqual([
      "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
      "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12",
    ]);
  });

  it("ne désactive rien quand l'année tient entière dans les bornes", () => {
    const cells = monthsOfYear(2026, "2026-01", "2026-12");
    expect(cells.filter((c) => c.disabled)).toEqual([]);
  });

  // Le mois du minimum est choisissable : la borne est incluse, sinon on ne
  // pourrait jamais créer un groupe le mois où on est.
  it("désactive les mois d'avant le minimum, borne incluse", () => {
    const cells = monthsOfYear(2026, "2026-03", "2099-12");
    expect(cells.filter((c) => c.disabled).map((c) => c.month)).toEqual(["2026-01", "2026-02"]);
  });

  it("désactive les mois d'après le maximum, borne incluse", () => {
    const cells = monthsOfYear(2026, "2000-01", "2026-10");
    expect(cells.filter((c) => c.disabled).map((c) => c.month)).toEqual(["2026-11", "2026-12"]);
  });

  it("désactive les douze mois d'une année hors des bornes", () => {
    expect(monthsOfYear(2020, "2026-01", "2026-12").every((c) => c.disabled)).toBe(true);
    expect(monthsOfYear(2030, "2026-01", "2026-12").every((c) => c.disabled)).toBe(true);
  });
});

// De quoi savoir si les flèches d'année mènent quelque part : une année sans
// aucun mois choisissable n'a pas à être atteignable.
describe("yearHasMonth", () => {
  it("reconnaît une année qui contient au moins un mois choisissable", () => {
    expect(yearHasMonth(2026, "2026-11", "2027-02")).toBe(true);
    expect(yearHasMonth(2027, "2026-11", "2027-02")).toBe(true);
  });

  it("rejette une année entièrement avant ou après les bornes", () => {
    expect(yearHasMonth(2025, "2026-11", "2027-02")).toBe(false);
    expect(yearHasMonth(2028, "2026-11", "2027-02")).toBe(false);
  });
});
