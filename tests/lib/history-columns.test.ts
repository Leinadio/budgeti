import { expect, describe, it } from "vitest";
import { monthType, monthColumns, COL_LABEL, COL_INFO, budgetChangePoints, type ColKey } from "../../src/lib/history-columns";

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

describe("repère de changement de budget", () => {
  it("marque le mois où le budget change", () => {
    expect(budgetChangePoints([{ budgeted: 250 }, { budgeted: 250 }, { budgeted: 300 }]))
      .toEqual([false, false, true]);
  });

  it("ne marque jamais la première colonne", () => {
    expect(budgetChangePoints([{ budgeted: 300 }])).toEqual([false]);
  });

  it("ignore un écart d'arrondi", () => {
    expect(budgetChangePoints([{ budgeted: 250 }, { budgeted: 250.001 }])).toEqual([false, false]);
  });

  it("rend une liste vide sans cellule", () => {
    expect(budgetChangePoints([])).toEqual([]);
  });

  // budgetChangePoints ne sait rien de « groupe » ou « ligne » : il ne fait que
  // suivre le tableau `alive` qu'on lui donne. La vie du groupe force le budget à
  // 0 sur ses mois morts (cf. src/lib/history.ts), et une ligne a désormais la
  // sienne propre, distincte (cf. HistorySubRow.aliveMonths, testé dans
  // tests/lib/history.test.ts) : dans les deux cas, sans en tenir compte, le saut
  // de 0 vers le vrai budget à la reprise se lirait à tort comme une hausse. Ce
  // test-ci ne prouve que le mécanisme générique ; il ne prouve pas qu'une ligne
  // reçoit la bonne vie — c'est le test de history.test.ts qui ferme cette boucle.
  it("ne marque pas un changement quand l'un des deux mois comparés est mort (mécanisme générique, utilisé aussi bien pour un groupe que pour une ligne)", () => {
    expect(
      budgetChangePoints(
        [{ budgeted: 0 }, { budgeted: 0 }, { budgeted: 250 }],
        [false, false, true],
      ),
    ).toEqual([false, false, false]);
  });

  it("ne marque pas la reprise après une pause au milieu de la fenêtre", () => {
    expect(
      budgetChangePoints(
        [{ budgeted: 250 }, { budgeted: 0 }, { budgeted: 300 }],
        [true, false, true],
      ),
    ).toEqual([false, false, false]);
  });

  it("marque toujours un vrai changement entre deux mois vivants", () => {
    expect(budgetChangePoints([{ budgeted: 250 }, { budgeted: 300 }], [true, true])).toEqual([false, true]);
  });
});
