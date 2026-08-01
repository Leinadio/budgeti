// Le mois courant : la seule source du « où en est-on » dans l'app, écran comme
// actions serveur.
import { describe, expect, it } from "vitest";
import { currentMonthKey } from "../../src/lib/current-month";

describe("currentMonthKey", () => {
  it("rend le mois d'une date, avec son zéro devant", () => {
    expect(currentMonthKey(new Date("2026-01-15T10:00:00Z"))).toBe("2026-01");
    expect(currentMonthKey(new Date("2026-11-30T12:00:00Z"))).toBe("2026-11");
  });

  // Le mois se juge à l'heure de Paris, pas en UTC. La nuit du changement de mois,
  // entre minuit à Paris et minuit UTC, l'utilisateur est déjà passé au mois suivant
  // alors qu'UTC traîne encore dans le précédent : lire l'UTC lui montrerait juillet
  // le 1er août. Le fuseau est fixé et non pris du serveur — Vercel tourne en UTC.
  it("lit le mois à l'heure de Paris, pas en UTC", () => {
    // 1er août 01:30 à Paris (été, UTC+2) : le mois courant est bien août.
    expect(currentMonthKey(new Date("2026-07-31T23:30:00Z"))).toBe("2026-08");
    // 1er janvier 00:30 à Paris (hiver, UTC+1) : le changement d'année suit aussi.
    expect(currentMonthKey(new Date("2025-12-31T23:30:00Z"))).toBe("2026-01");
    // 31 juillet 23:00 à Paris : on est encore en juillet, l'UTC ne doit pas
    // faire basculer en avance non plus.
    expect(currentMonthKey(new Date("2026-07-31T21:00:00Z"))).toBe("2026-07");
  });
});
