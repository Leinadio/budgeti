// --- Un revenu vaut ce que sa durée dit --------------------------------------
//
// Un compte n'avait droit qu'à deux revenus : une « rémunération principale », comptée
// dans le total et projetée sur tous les mois à venir, et une « rémunération
// supplémentaire », qui ne comptait ni dans le total ni au-delà du mois courant. Deux
// places figées pour dire une seule chose : ce revenu se reproduit, ou non.
//
// C'est la durée qui le dit maintenant, comme pour les dépenses. Un salaire vaut
// depuis toujours et sans fin, donc il se projette. Un don d'ami vaut sur août, donc
// il pèse en août et nulle part ailleurs — sans qu'on ait eu à le ranger dans une
// catégorie à part.
import { describe, expect, it } from "vitest";
import { computeForecast, type Group, type Txn } from "../../src/lib/forecast";
import { computeHistory, computeSolde, computePlannedSoldes, grandTotals, rowRevenus } from "../../src/lib/history";
import { seedDated } from "./dated-fixtures";

const salaire: Group = {
  id: 1, accountId: "a1", name: "Rémunération dirigeant", direction: "in",
  monthlyAmount: 2000, lines: [], startMonth: null, endMonth: null,
};

// L'ancienne « supplémentaire », dite par sa durée : un seul mois, août.
const don: Group = {
  id: 2, accountId: "a1", name: "Don d'ami", direction: "in",
  monthlyAmount: 300, lines: [], startMonth: "2026-08", endMonth: "2026-08",
};

const MOIS = ["2026-08", "2026-09"];

function tx(p: Partial<Txn>): Txn {
  return { id: "t", date: "2026-08-05", amount: 100, label: "", accountId: "a1", groupId: null, ...p };
}

// Les montants datés reconstitués comme le fait la base : une entrée au mois de départ
// du groupe. Sans eux, tout budget vaudrait 0 et les tests passeraient pour de mauvaises
// raisons.
const hist = (groups: Group[], months = MOIS, current = "2026-08") => {
  const { dated, datedLines } = seedDated(groups);
  return computeHistory(groups, [], months, current, dated, datedLines);
};

const fc = (balance: number, groups: Group[], txns: Txn[], month: string) => {
  const { dated, datedLines } = seedDated(groups);
  return computeForecast("a1", balance, groups, txns, month, dated, datedLines);
};

describe("le total des revenus", () => {
  // Avant, la supplémentaire était retirée de ce total : on lisait 2000 là où le mois
  // en attendait 2300. Tous les revenus vivants y entrent désormais.
  it("compte tous les revenus vivants du mois", () => {
    const sections = hist([salaire, don]);
    const income = sections.find((s) => s.kind === "income")!;
    expect(income.totals[0].budgeted).toBe(2300); // août : les deux
    expect(income.totals[1].budgeted).toBe(2000); // septembre : le don a fini
  });

  it("suit dans le total général", () => {
    const sections = hist([salaire, don]);
    expect(grandTotals(sections, 1)[0].budgeted).toBe(2300);
  });
});

describe("ce qu'une ligne de revenu apporte au plan du mois", () => {
  it("se projette sur les mois où le revenu vit", () => {
    const row = hist([salaire]).find((s) => s.kind === "income")!.rows[0];
    expect(rowRevenus(row, 0)).toBe(2000);
    expect(rowRevenus(row, 1)).toBe(2000); // mois futur : toujours attendu
  });

  // La règle qui remplace « ne jamais projeter la supplémentaire » : hors de sa durée,
  // un revenu ne vaut rien, et c'est vrai du mois courant comme des suivants.
  it("ne se projette plus une fois le revenu fini", () => {
    const row = hist([don]).find((s) => s.kind === "income")!.rows[0];
    expect(rowRevenus(row, 0)).toBe(300); // août
    expect(rowRevenus(row, 1)).toBe(0); // septembre : fini
  });

  it("n'attend aucune rentrée d'une dépense", () => {
    const courses: Group = {
      id: 3, accountId: "a1", name: "Courses", direction: "out", monthlyAmount: 400, lines: [],
    };
    const row = hist([courses]).find((s) => s.kind === "expense")!.rows[0];
    expect(rowRevenus(row, 0)).toBe(0);
  });
});

// Les soldes prévus du tableau lisent la même règle : sans ça, la colonne et son
// détail annonceraient deux chiffres différents pour le même mois.
describe("les soldes prévus", () => {
  it("ajoutent un revenu tant qu'il vit, et plus après", () => {
    const sections = hist([don]);
    const solde = computeSolde(sections, MOIS, "2026-08", 1000);
    const p = computePlannedSoldes(sections, MOIS, "2026-08", solde.openings);
    expect(p.prevuClosings[0]).toBeCloseTo(solde.openings[0] + 300, 2);
    // Septembre repart de la clôture d'août sans rien ajouter : le don a fini.
    expect(p.prevuClosings[1]! - p.prevuClosings[0]!).toBeCloseTo(0, 2);
  });
});

describe("la prévision", () => {
  it("ajoute un revenu sans fin au mois courant et au mois suivant", () => {
    const f = fc(100, [salaire], [], "2026-08");
    expect(f.currentEstimate).toBe(2100);
    expect(f.nextEstimate).toBe(4100);
  });

  // Le cas qui justifiait la « supplémentaire » : un revenu qu'on ne veut pas parier
  // sur le mois prochain. Sa durée suffit à le dire.
  it("n'ajoute pas au mois suivant un revenu qui finit ce mois-ci", () => {
    const f = fc(100, [don], [], "2026-08");
    expect(f.currentEstimate).toBe(400); // 100 + 300 attendus en août
    expect(f.nextEstimate).toBe(400); // septembre : rien de plus
  });

  // Reçu pour de bon, il ne reste plus rien à attendre : le solde a déjà bougé.
  it("n'attend plus que le reste une fois le revenu encaissé", () => {
    const f = fc(400, [don], [tx({ amount: 300, groupId: 2 })], "2026-08");
    expect(f.currentEstimate).toBe(400);
  });
});
