// La mention affichée à côté du nom d'un groupe, dans la colonne de gauche : sa
// durée de vie, dite en clair. Un groupe qui ne vaut que pour un mois doit se
// distinguer d'un groupe permanent sans qu'on ait à ouvrir sa fiche.
import { describe, expect, it } from "vitest";
import { groupPeriodLabel } from "../../src/lib/group-period-label";

describe("groupPeriodLabel", () => {
  // Sans fin, il reste à dire depuis quand. Le formulaire distingue maintenant deux
  // façons de n'avoir pas de fin — depuis toujours, ou à partir d'un mois — et la
  // colonne doit dire la même chose que lui, sinon on lit deux durées différentes
  // pour un même groupe selon qu'on ouvre sa fiche ou non.
  it("dit depuis toujours quand le groupe est ancré à l'origine", () => {
    expect(groupPeriodLabel("2000-01", null)).toBe("depuis toujours");
  });

  it("dit le mois de départ quand il y en a un", () => {
    expect(groupPeriodLabel("2026-07", null)).toBe("depuis juillet 2026");
  });

  // Un groupe hérité, sans mois de départ ni fin : rien ne l'a jamais borné.
  it("dit depuis toujours quand le départ est inconnu", () => {
    expect(groupPeriodLabel(null, null)).toBe("depuis toujours");
  });

  // Le cas des enveloppes créées pour un seul mois (vacances, sucreries d'été).
  it("dit le mois unique quand début et fin se confondent", () => {
    expect(groupPeriodLabel("2026-07", "2026-07")).toBe("ce mois uniquement");
  });

  // Dans la même année, l'année ne se dit qu'une fois : la colonne est étroite.
  it("dit la plage sans répéter l'année", () => {
    expect(groupPeriodLabel("2026-03", "2026-05")).toBe("de mars à mai 2026");
  });

  it("dit les deux années quand la plage les traverse", () => {
    expect(groupPeriodLabel("2026-11", "2027-02")).toBe("de novembre 2026 à février 2027");
  });

  // Un groupe hérité, sans mois de départ mais avec une fin : la fin seule se dit.
  it("dit la fin seule quand le départ est inconnu", () => {
    expect(groupPeriodLabel(null, "2026-05")).toBe("jusqu'à mai 2026");
  });
});
