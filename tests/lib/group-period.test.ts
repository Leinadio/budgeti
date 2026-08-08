// La durée de vie d'un groupe, telle que le formulaire de création la demande :
// un seul mois, une plage bornée, ou un début sans fin.
import { describe, expect, it } from "vitest";
import { groupPeriod, minEndMonth, fitEndMonth, draftMode, draftOfPeriod, draftStart, ORIGIN_MONTH } from "../../src/lib/group-period";

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

// Le formulaire pose trois choix : depuis toujours, à partir d'un mois sans fin, ou
// des mois précis. Les deux premiers ne diffèrent que par leur début — d'où le même
// mode « from » en base. « Un seul mois » et « d'un mois à un autre » ne sont pas
// deux natures différentes, c'est la même chose avec ou sans mois de fin — d'où un
// « + » plutôt qu'un choix.
describe("draftMode", () => {
  it("depuis toujours n'a pas de fin", () => {
    expect(draftMode({ choice: "always", start: "2026-08", end: null })).toBe("from");
  });

  it("à partir d'un mois n'a pas de fin non plus", () => {
    expect(draftMode({ choice: "from", start: "2026-08", end: null })).toBe("from");
  });

  it("des mois précis sans fin, c'est un seul mois", () => {
    expect(draftMode({ choice: "dates", start: "2026-08", end: null })).toBe("single");
  });

  it("des mois précis avec une fin, c'est une plage", () => {
    expect(draftMode({ choice: "dates", start: "2026-08", end: "2026-12" })).toBe("range");
  });

  // Le mois de fin resté d'un aller-retour dans le menu ne doit pas ressurgir.
  it("ignore une fin laissée sur un choix sans fin", () => {
    expect(draftMode({ choice: "from", start: "2026-08", end: "2026-12" })).toBe("from");
  });
});

// « Depuis toujours » ne demande aucun mois : l'écran n'affiche pas de champ, donc le
// mois resté dans le brouillon (celui d'un aller-retour dans le menu, ou le mois par
// défaut de l'écran) ne doit pas ressortir. C'est ici qu'on l'écrase par l'origine.
describe("draftStart", () => {
  it("depuis toujours part de l'origine, quoi que dise le brouillon", () => {
    expect(draftStart({ choice: "always", start: "2026-08", end: null })).toBe(ORIGIN_MONTH);
  });

  it("les autres choix gardent le mois saisi", () => {
    expect(draftStart({ choice: "from", start: "2026-08", end: null })).toBe("2026-08");
    expect(draftStart({ choice: "dates", start: "2026-08", end: "2026-12" })).toBe("2026-08");
  });
});

// L'inverse, pour ouvrir le formulaire d'un groupe qui existe déjà sur ce qu'il est.
describe("draftOfPeriod", () => {
  // Le mois de l'origine est le début du monde : un groupe ancré là n'a pas « démarré
  // en janvier 2000 », il a toujours été là. Le formulaire doit le rouvrir sur ce
  // choix-là, sinon l'enregistrer à nouveau le figerait sur une date qu'on n'a jamais
  // choisie.
  it("l'origine rouvre sur depuis toujours", () => {
    expect(draftOfPeriod(ORIGIN_MONTH, null)).toEqual({ choice: "always", start: ORIGIN_MONTH, end: null });
  });

  it("sans fin, un départ daté rouvre sur à partir d'un mois", () => {
    expect(draftOfPeriod("2026-08", null)).toEqual({ choice: "from", start: "2026-08", end: null });
  });

  it("une fin égale au début, c'est un seul mois", () => {
    expect(draftOfPeriod("2026-08", "2026-08")).toEqual({ choice: "dates", start: "2026-08", end: null });
  });

  it("deux bornes distinctes rouvrent la plage telle quelle", () => {
    expect(draftOfPeriod("2026-08", "2026-12")).toEqual({ choice: "dates", start: "2026-08", end: "2026-12" });
  });

  // Les groupes hérités n'ont pas de mois de départ : rien ne les a jamais bornés, ils
  // valent donc depuis toujours. Le mois proposé par l'écran reste dans le brouillon
  // pour le cas où on bascule sur un autre choix.
  it("sans mois de départ, le groupe vaut depuis toujours", () => {
    expect(draftOfPeriod(null, null, "2026-08")).toEqual({ choice: "always", start: "2026-08", end: null });
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
