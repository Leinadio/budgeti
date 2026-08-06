// La durée de vie d'un groupe, telle que le formulaire de création la demande :
// un seul mois, une plage bornée, ou un début sans fin.
import { describe, expect, it } from "vitest";
import { groupPeriod, minEndMonth, fitEndMonth } from "../../src/lib/group-period";

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

  // Une plage qui commence et finit le même mois, c'est « un seul mois » : elle a son
  // propre choix dans le formulaire. La refuser ici évite deux façons d'écrire la même
  // chose, dont l'une passe par un mois de fin que l'utilisateur croit avoir choisi.
  it("refuse une plage qui finit le mois où elle commence", () => {
    expect(groupPeriod("range", "2026-08", "2026-08")).toBeNull();
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

// La même règle, vue du formulaire : c'est elle qui décide ce que le calendrier du
// mois de fin propose, pour qu'on ne puisse pas saisir ce que groupPeriod refusera.
describe("minEndMonth", () => {
  it("le plus tôt qu'une fin puisse tomber est le mois suivant le début", () => {
    expect(minEndMonth("2026-08")).toBe("2026-09");
  });

  it("passe l'année", () => {
    expect(minEndMonth("2026-12")).toBe("2027-01");
  });
});

describe("fitEndMonth", () => {
  it("laisse une fin déjà postérieure au début", () => {
    expect(fitEndMonth("2026-08", "2026-12")).toBe("2026-12");
  });

  // Changer le début peut rattraper la fin : elle repart au premier mois encore
  // permis, plutôt que de rester affichée sur un mois que le formulaire refuserait.
  it("repousse une fin devenue égale au début", () => {
    expect(fitEndMonth("2026-08", "2026-08")).toBe("2026-09");
  });

  it("repousse une fin devenue antérieure au début", () => {
    expect(fitEndMonth("2026-08", "2026-03")).toBe("2026-09");
  });
});
