// La durée de vie d'un groupe, telle que le formulaire de création la demande :
// un seul mois, une plage bornée, ou un début sans fin.
import { describe, expect, it } from "vitest";
import { groupPeriod } from "../../src/lib/group-period";

describe("groupPeriod", () => {
  it("un seul mois se termine le mois où il commence", () => {
    expect(groupPeriod("single", "2026-08")).toEqual({ startMonth: "2026-08", endMonth: "2026-08" });
  });

  // Le mois de fin choisi est ignoré : « un seul mois » ne peut pas en avoir un autre.
  it("un seul mois ne retient pas un mois de fin resté d'un autre choix", () => {
    expect(groupPeriod("single", "2026-08", "2026-12")).toEqual({ startMonth: "2026-08", endMonth: "2026-08" });
  });

  it("une plage garde ses deux bornes", () => {
    expect(groupPeriod("range", "2026-08", "2026-12")).toEqual({ startMonth: "2026-08", endMonth: "2026-12" });
  });

  it("une plage d'un seul mois est valide", () => {
    expect(groupPeriod("range", "2026-08", "2026-08")).toEqual({ startMonth: "2026-08", endMonth: "2026-08" });
  });

  // Une fin avant le début ne décrit aucune période : le groupe ne vivrait aucun mois.
  // Refuser plutôt que réparer en silence — l'écran doit pouvoir le dire.
  it("refuse une plage qui finit avant de commencer", () => {
    expect(groupPeriod("range", "2026-08", "2026-05")).toBeNull();
  });

  it("refuse une plage sans mois de fin", () => {
    expect(groupPeriod("range", "2026-08")).toBeNull();
  });

  it("« à partir de » n'a pas de fin", () => {
    expect(groupPeriod("from", "2026-08")).toEqual({ startMonth: "2026-08", endMonth: null });
  });

  it("refuse un mois de départ mal formé", () => {
    expect(groupPeriod("from", "août 2026")).toBeNull();
    expect(groupPeriod("range", "2026-08", "décembre")).toBeNull();
  });
});
