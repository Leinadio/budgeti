// Le verrou des mois passés : une fois un mois écoulé, son budget est de
// l'histoire et plus rien ne peut y être écrit ni retiré.
import { describe, expect, it } from "vitest";
import { isMonthClosed, currentMonthKey } from "../../src/lib/month-lock";

describe("isMonthClosed", () => {
  it("un mois antérieur au mois courant est clos", () => {
    expect(isMonthClosed("2026-03", "2026-07")).toBe(true);
  });

  it("le mois courant reste ouvert", () => {
    expect(isMonthClosed("2026-07", "2026-07")).toBe(false);
  });

  it("un mois futur reste ouvert", () => {
    expect(isMonthClosed("2026-08", "2026-07")).toBe(false);
  });

  // Les clés « YYYY-MM » se comparent comme du texte : décembre de l'année d'avant
  // doit sortir clos, et janvier de l'année d'après ouvert. C'est le seul endroit
  // où une comparaison de texte pourrait mentir si le format changeait.
  it("juge correctement de part et d'autre d'un changement d'année", () => {
    expect(isMonthClosed("2025-12", "2026-01")).toBe(true);
    expect(isMonthClosed("2027-01", "2026-12")).toBe(false);
  });
});

describe("currentMonthKey", () => {
  it("rend le mois d'une date, avec son zéro devant", () => {
    expect(currentMonthKey(new Date("2026-01-15T10:00:00Z"))).toBe("2026-01");
    expect(currentMonthKey(new Date("2026-11-30T23:59:59Z"))).toBe("2026-11");
  });

  // La page lit le mois courant en UTC (new Date().toISOString()). Les actions
  // serveur doivent lire le même, sinon un même mois serait clos d'un côté et
  // ouvert de l'autre le jour où les deux fuseaux ne tombent pas d'accord.
  it("lit le mois en UTC, comme la page", () => {
    expect(currentMonthKey(new Date("2026-08-01T00:30:00Z"))).toBe("2026-08");
    expect(currentMonthKey(new Date("2026-07-31T23:30:00Z"))).toBe("2026-07");
  });
});
