import { expect, describe, it } from "vitest";
import { monthType, monthColumns, COL_LABEL, COL_INFO, type ColKey } from "../../src/lib/history-columns";

describe("La nature d'un mois par rapport au mois courant", () => {
  it("devrait classer un mois en passé, courant ou futur", () => {
    expect(monthType("2026-06", "2026-07")).toBe("past");
    expect(monthType("2026-07", "2026-07")).toBe("current");
    expect(monthType("2026-08", "2026-07")).toBe("future");
  });
});

describe("Les colonnes affichées sous un mois", () => {
  it("devrait montrer les mêmes colonnes sur un mois passé et sur le mois courant", () => {
    expect(monthColumns("past")).toEqual(monthColumns("current"));
  });

  it("devrait retirer « Solde si dépassement » des mois de projection", () => {
    // Sur un mois futur, plus aucun dépassement n'est reporté : la colonne ne dirait
    // que la même chose que « Solde prévu ».
    expect(monthColumns("past")).toContain("soldeDepass");
    expect(monthColumns("future")).not.toContain("soldeDepass");
  });

  it("devrait garder les colonnes de projection dans le même ordre partout", () => {
    const future = monthColumns("future");
    const past = monthColumns("past");
    // Le futur est exactement le passé privé de sa dernière colonne : les colonnes
    // ne doivent jamais se réordonner d'un mois à l'autre, sinon les en-têtes de la
    // première rangée ne coiffent plus les bonnes cases.
    expect(past.slice(0, future.length)).toEqual(future);
  });
});

describe("Ce que chaque colonne annonce et explique", () => {
  it("devrait donner un libellé à chaque colonne affichable", () => {
    for (const col of monthColumns("past")) {
      expect(COL_LABEL[col], `libellé manquant pour ${col}`).toBeTruthy();
    }
  });

  it("devrait donner une explication non vide à chaque colonne affichable", () => {
    // L'en-tête d'une colonne est cliquable et ouvre son explication dans le panneau :
    // une colonne sans texte ouvrirait un panneau vide.
    for (const col of monthColumns("past")) {
      const paragraphs = COL_INFO[col as ColKey];
      expect(paragraphs, `explication manquante pour ${col}`).toBeDefined();
      expect(paragraphs.length).toBeGreaterThan(0);
      for (const p of paragraphs) expect(p.trim().length).toBeGreaterThan(0);
    }
  });
});
