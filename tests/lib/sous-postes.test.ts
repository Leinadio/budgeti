// --- Ce qui décide, ce sont les sous-postes, plus la nature du groupe ------------
//
// « Enveloppe » et « récurrent » promettaient deux comportements différents et n'en
// donnaient qu'un seul : même budget mensuel, mêmes transactions rattachées, même
// règle de dépassement, même poids dans l'estimé de fin de mois. La seule différence
// réelle était de forme — un récurrent se découpe en sous-postes, une enveloppe non.
//
// D'où la bascule vérifiée ici : la question n'est plus « quelle est sa nature » mais
// « a-t-elle des sous-postes ». Une dépense découpée porte le budget de ses sous-postes
// et déborde poste par poste ; une dépense plate porte le sien et déborde en bloc. Un
// seul jeu de règles, choisi sur un fait vérifiable.
import { describe, expect, it } from "vitest";
import { computeForecast, type Group, type Txn } from "../../src/lib/forecast";
import { budgetInForce } from "../../src/lib/budget-in-force";
import { computeHistory, computeOverspends, toDatedBudgets, toDatedLineAmounts } from "../../src/lib/history";
import { budgetEditOfGroup } from "../../src/lib/history-detail";

const MOIS = "2026-07";

// Courses : découpée en trois sous-postes. Sous l'ancienne règle, une « enveloppe »
// n'avait pas le droit d'en avoir, et son montant propre aurait fait foi.
const courses: Group = {
  id: 1, accountId: "a1", name: "Courses", direction: "out",
  monthlyAmount: 999, // montant propre : il ne doit plus compter, la somme fait foi
  lines: [
    { id: 11, name: "Boulangerie", amount: 50 },
    { id: 12, name: "Supermarché", amount: 300 },
    { id: 13, name: "Marché", amount: 50 },
  ],
};

// Carburant : aucun sous-poste. Son budget est donc le sien, écrit à la main.
const carburant: Group = {
  id: 2, accountId: "a1", name: "Carburant", direction: "out",
  monthlyAmount: 120, lines: [],
};

const dated = toDatedBudgets([
  { groupId: 1, effectiveMonth: "2000-01", amount: 999 },
  { groupId: 2, effectiveMonth: "2000-01", amount: 120 },
]);
const datedLines = toDatedLineAmounts([
  { lineId: 11, effectiveMonth: "2000-01", amount: 50 },
  { lineId: 12, effectiveMonth: "2000-01", amount: 300 },
  { lineId: 13, effectiveMonth: "2000-01", amount: 50 },
]);

function tx(p: Partial<Txn>): Txn {
  return { id: "t", date: "2026-07-05", amount: -10, label: "", accountId: "a1", groupId: null, ...p };
}

describe("le budget d'une dépense", () => {
  it("est la somme de ses sous-postes dès qu'elle en a", () => {
    expect(budgetInForce(courses, MOIS, dated, datedLines)).toBe(400);
  });

  it("est son propre montant quand elle n'en a pas", () => {
    expect(budgetInForce(carburant, MOIS, dated, datedLines)).toBe(120);
  });
});

describe("le dépassement d'une dépense", () => {
  // Découpée, elle déborde sous-poste par sous-poste : c'est là que le budget vit,
  // donc c'est là que le débordement se lit.
  it("se lit sous-poste par sous-poste quand elle est découpée", () => {
    const txns = [tx({ id: "t1", amount: -80, groupId: 1, lineId: 11 })]; // Boulangerie, 50 budgétés
    const { byMonth } = computeOverspends([courses], txns, MOIS, dated, datedLines);
    expect(byMonth[MOIS]).toEqual([
      { groupId: 1, lineId: 11, name: "Boulangerie", month: MOIS, amount: 30 },
    ]);
  });

  it("se lit sur la dépense elle-même quand elle est plate", () => {
    const txns = [tx({ id: "t1", amount: -150, groupId: 2 })]; // Carburant, 120 budgétés
    const { byMonth } = computeOverspends([carburant], txns, MOIS, dated, datedLines);
    expect(byMonth[MOIS]).toEqual([
      { groupId: 2, lineId: null, name: "Carburant", month: MOIS, amount: 30 },
    ]);
  });
});

describe("la prévision", () => {
  // Découpée : chaque sous-poste non encore rattaché pèse pour son montant entier.
  it("retire les sous-postes non rattachés d'une dépense découpée", () => {
    const txns = [tx({ id: "t1", amount: -50, groupId: 1, lineId: 11 })]; // Boulangerie passée
    const f = computeForecast("a1", 1000, [courses], txns, MOIS, dated, datedLines);
    expect(f.currentEstimate).toBe(1000 - 300 - 50); // Supermarché et Marché restent à venir
  });

  it("retire le reste à dépenser d'une dépense plate", () => {
    const txns = [tx({ id: "t1", amount: -100, groupId: 2 })];
    const f = computeForecast("a1", 1000, [carburant], txns, MOIS, dated, datedLines);
    expect(f.currentEstimate).toBe(980); // 120 budgétés, 100 dépensés, reste 20
  });
});

describe("la case budget d'une dépense", () => {
  // Découpée, son budget n'est plus à elle : il n'y a rien à y écrire, c'est chaque
  // sous-poste qui porte son montant dans SA case.
  it("ne s'édite plus dès qu'il y a des sous-postes", () => {
    const g = { id: 1, name: "Courses", lines: [{ id: 11 }], changes: [] };
    expect(budgetEditOfGroup(g, MOIS, MOIS)).toBeNull();
  });

  it("s'édite tant que la dépense est plate", () => {
    const g = { id: 2, name: "Carburant", lines: [], changes: [] };
    expect(budgetEditOfGroup(g, MOIS, MOIS)).toMatchObject({ target: "group", id: 2, name: "Carburant" });
  });
});

// --- Quand les deux durées se contredisent --------------------------------------
// Une dépense a sa durée, chacun de ses sous-postes a la sienne. Rien n'oblige les
// deux à s'accorder : on peut donner une durée permanente à un sous-poste d'une
// dépense qui, elle, s'arrête en août. La règle est la même partout — un sous-poste
// n'existe un mois donné que si SA dépense existe aussi ce mois-là. La durée du
// parent l'emporte, toujours.
describe("une durée de sous-poste qui déborde celle de sa dépense", () => {
  const bornee: Group = {
    id: 3, accountId: "a1", name: "Vacances", direction: "out", monthlyAmount: null,
    startMonth: "2026-07", endMonth: "2026-08",
    lines: [{ id: 31, name: "Camping", amount: 200 }], // sans bornes : permanent
  };
  const lignesDatees = toDatedLineAmounts([{ lineId: 31, effectiveMonth: "2026-07", amount: 200 }]);

  it("s'arrête avec elle, quoi qu'elle dise", () => {
    expect(budgetInForce(bornee, "2026-08", undefined, lignesDatees)).toBe(200);
    const sections = computeHistory([bornee], [], ["2026-08", "2026-09"], "2026-08", undefined, lignesDatees);
    const ligne = sections.find((s) => s.kind === "expense")!.rows[0];
    // Août : la dépense vit, son sous-poste aussi. Septembre : ni l'une ni l'autre.
    expect(ligne.cells.map((c) => c.budgeted)).toEqual([200, 0]);
    expect(ligne.subRows[0].aliveMonths).toEqual([true, false]);
  });

  // L'inverse : une dépense permanente dont le seul sous-poste s'arrête. Elle reste
  // affichée — elle n'est pas finie — mais son budget tombe à zéro, puisqu'il n'est
  // que la somme de ses sous-postes et qu'il n'en reste aucun.
  it("laisse la dépense continuer, avec un budget devenu nul", () => {
    const permanente: Group = {
      id: 4, accountId: "a1", name: "Abonnements", direction: "out", monthlyAmount: null,
      startMonth: "2026-07", endMonth: null,
      lines: [{ id: 41, name: "Netflix", amount: 15, startMonth: null, endMonth: "2026-07" }],
    };
    const datees = toDatedLineAmounts([{ lineId: 41, effectiveMonth: "2026-07", amount: 15 }]);
    const sections = computeHistory([permanente], [], ["2026-07", "2026-08"], "2026-08", undefined, datees);
    const ligne = sections.find((s) => s.kind === "expense")!.rows[0];

    expect(ligne.cells.map((c) => c.budgeted)).toEqual([15, 0]);
    expect(ligne.aliveMonths).toEqual([true, true]);
    expect(ligne.subRows[0].aliveMonths).toEqual([true, false]);
  });
});
