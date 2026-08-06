import { expect, describe, it } from "vitest";
import { computeHistory, monthsWithData, nextMonthKey, grandTotals, monthlyOverspend, addMonthsKey, monthRange, isMonthKey, clampMonth, monthsDiff, computeSolde, computePlannedSoldes, budgetInForce, lineAmountInForce, toDatedBudgets, toDatedLineAmounts, computeOverspends, groupsWithPending, overspentCells, budgetKey, budgetsByMonth, rowRevenus, rowOverspend, uncatOverspend, uncatOverspendOf, type HistoryRow, type DatedBudgets, type Overspend } from "../../src/lib/history";
import { isGroupAlive, isLineAlive, type Group, type Txn } from "../../src/lib/forecast";
import { seedDated, mergeDated } from "./dated-fixtures";

// Fixtures partagées : une enveloppe « Courses » avec un budget mensuel, un groupe
// récurrent « Abonnements » fait de deux lignes, et une rémunération « Salaire ».
const courses: Group = {
  id: 1, accountId: "a1", name: "Courses", direction: "out", kind: "envelope",
  monthlyAmount: 300, lines: [],
};
const abo: Group = {
  id: 2, accountId: "a1", name: "Abonnements", direction: "out", kind: "recurring",
  monthlyAmount: null,
  lines: [
    { id: 11, name: "Spotify", amount: 10, day: 3 },
    { id: 12, name: "Netflix", amount: 15, day: 8 },
  ],
};
const salaire: Group = {
  id: 9, accountId: "a1", name: "Salaire", direction: "in", kind: "envelope",
  monthlyAmount: 2000, lines: [],
};

function tx(p: Partial<Txn>): Txn {
  return { id: "t", date: "2026-07-05", amount: -10, label: "", accountId: "a1", groupId: null, ...p };
}

// Enveloppes locales : sèment les montants des fixtures comme le fait la reprise
// de données, pour que les tests continuent d'exprimer leurs montants dans les
// fixtures plutôt que dans des tables datées écrites à la main.
const hist = (
  groups: Group[], txns: Txn[], months: string[], current: string, extra?: DatedBudgets,
) => {
  const { dated, datedLines } = seedDated(groups);
  return computeHistory(groups, txns, months, current, mergeDated(dated, extra), datedLines);
};
const over = (groups: Group[], txns: Txn[], current: string, extra?: DatedBudgets) => {
  const { dated, datedLines } = seedDated(groups);
  return computeOverspends(groups, txns, current, mergeDated(dated, extra), datedLines);
};

describe("Montants affichés dans le tableau de l'historique", () => {
  it("devrait afficher, pour chaque groupe, ce qui a été dépensé chaque mois", () => {
    const txns = [
      tx({ id: "1", date: "2026-06-10", amount: -120, label: "CARREFOUR", groupId: 1 }),
      tx({ id: "2", date: "2026-07-10", amount: -50, label: "CARREFOUR", groupId: 1 }),
      tx({ id: "3", date: "2026-07-15", amount: -30, label: "CARREFOUR", groupId: 1 }),
    ];
    const sections = hist([courses], txns, ["2026-06", "2026-07"], "2026-07");
    const row = sections[0].rows[0];
    expect(row.cells[0].depense).toBe(120); // juin
    expect(row.cells[1].depense).toBe(80); // juillet 50 + 30
  });

  it("devrait budgéter une enveloppe par son montant mensuel, un récurrent par la somme de ses lignes, et afficher le reste", () => {
    const txns = [tx({ id: "1", date: "2026-07-10", amount: -120, label: "CARREFOUR", groupId: 1 })];
    const sections = hist([courses, abo], txns, ["2026-07"], "2026-07");
    const env = sections.find((s) => s.kind === "envelope")!.rows[0];
    const rec = sections.find((s) => s.kind === "recurring")!.rows[0];
    expect(env.cells[0]).toEqual({ budgeted: 300, depense: 120, recu: 0, balance: 180 });
    expect(rec.cells[0].budgeted).toBe(25); // 10 + 15
  });

  it("devrait ignorer les transactions exclues", () => {
    const txns = [tx({ id: "1", date: "2026-07-10", amount: -120, label: "CARREFOUR", excluded: true })];
    const sections = hist([courses], txns, ["2026-07"], "2026-07");
    expect(sections[0].rows[0].cells[0].depense).toBe(0);
  });

  it("devrait additionner les groupes d'une section dans le total de cette section", () => {
    const courses2: Group = { ...courses, id: 3, name: "Courses2", monthlyAmount: 100 };
    const txns = [
      tx({ id: "1", date: "2026-07-10", amount: -120, label: "CARREFOUR", groupId: 1 }),
      tx({ id: "2", date: "2026-07-10", amount: -40, label: "LECLERC", groupId: 3 }),
    ];
    const sections = hist([courses, courses2], txns, ["2026-07"], "2026-07");
    expect(sections[0].totals[0]).toEqual({ budgeted: 400, depense: 160, recu: 0, balance: 240 });
  });

  it("devrait compter une rémunération comme argent reçu, jamais comme une dépense", () => {
    const income: Group = { id: 9, accountId: "a1", name: "Salaire", direction: "in", kind: "envelope", monthlyAmount: 2000, lines: [] };
    const txns = [tx({ id: "1", date: "2026-07-01", amount: 2000, label: "VIR REMU", groupId: 9 })];
    const sections = hist([income], txns, ["2026-07"], "2026-07");
    expect(sections[0].rows[0].cells[0]).toEqual({ budgeted: 2000, depense: 0, recu: 2000, balance: 0 });
  });

  it("devrait laisser un reste à zéro pour une rémunération, car l'argent reçu n'est pas un budget", () => {
    const remu: Group = {
      id: 21, accountId: "a1", name: "Rémunération", direction: "in", kind: "recurring",
      monthlyAmount: null, lines: [],
    };
    const txns = [
      tx({ id: "1", date: "2026-07-01", amount: 652.09, label: "VIR", groupId: 21 }),
      tx({ id: "2", date: "2026-07-05", amount: -10, label: "SPOTIFY", groupId: 2, lineId: 11 }),
    ];
    const sections = hist([remu, abo], txns, ["2026-07"], "2026-07");
    // La rémunération vit dans son propre bloc, en tête.
    const income = sections.find((s) => s.kind === "income")!;
    const remuRow = income.rows[0];
    // La rémunération n'a pas de budget de dépense : son reste est nul, l'argent reçu n'y entre pas.
    expect(remuRow.cells[0].balance).toBe(0);
    // Le bloc récurrent ne garde plus que la dépense (abo : budget 25 - dépensé 10 = 15).
    const rec = sections.find((s) => s.kind === "recurring")!;
    expect(rec.rows.every((r) => r.direction === "out")).toBe(true);
    expect(rec.totals[0].balance).toBe(15);
  });

  it("devrait afficher les rémunérations dans un bloc à part, en haut, séparé des récurrents et des enveloppes", () => {
    const remuRec: Group = {
      id: 30, accountId: "a1", name: "Salaire", direction: "in", kind: "recurring",
      monthlyAmount: null, lines: [], incomeKind: "principal",
    };
    const remuEnv: Group = {
      id: 31, accountId: "a1", name: "Prime", direction: "in", kind: "envelope",
      monthlyAmount: null, lines: [], incomeKind: "supplementary",
    };
    const txns = [
      tx({ id: "1", date: "2026-07-01", amount: 2000, label: "SAL", groupId: 30 }),
      tx({ id: "2", date: "2026-07-02", amount: 300, label: "PRIME", groupId: 31 }),
      tx({ id: "3", date: "2026-07-10", amount: -120, label: "CARREFOUR", groupId: 1 }),
    ];
    const sections = hist([remuRec, remuEnv, courses], txns, ["2026-07"], "2026-07");
    // Bloc rémunérations en tête, la principale avant la supplémentaire.
    expect(sections[0].kind).toBe("income");
    expect(sections[0].rows.map((r) => r.name)).toEqual(["Salaire", "Prime"]);
    // Le seul groupe récurrent était une rémunération : plus de bloc récurrent.
    expect(sections.find((s) => s.kind === "recurring")).toBeUndefined();
    // Le bloc enveloppe ne garde que la dépense.
    const env = sections.find((s) => s.kind === "envelope")!;
    expect(env.rows.map((r) => r.name)).toEqual(["Courses"]);
  });

  it("devrait laisser un reste à zéro pour les non catégorisés qui entrent, qui n'ont pas de budget", () => {
    const txns = [
      tx({ id: "1", date: "2026-07-01", amount: 500, label: "DIVERS", groupId: null }),
      tx({ id: "2", date: "2026-07-05", amount: -80, label: "DIVERS2", groupId: null }),
    ];
    const sections = hist([], txns, ["2026-07"], "2026-07");
    const uncatIn = sections.find((s) => s.kind === "uncategorized" && s.uncatDirection === "in")!;
    expect(uncatIn.totals[0].balance).toBe(0);
  });

  it("devrait donner un budget (provision) et un solde prévu aux non catégorisés", () => {
    const dated = { 0: [{ effectiveMonth: "2026-07", amount: 200 }] };
    const txns = [tx({ id: "a", date: "2026-07-05", amount: -50, label: "SANS GROUPE" })];
    const months = ["2026-07"];
    const sections = hist([], txns, months, "2026-07", dated);
    const uncatOut = sections.find((s) => s.kind === "uncategorized" && (s.uncatDirection ?? "out") === "out")!;
    // La provision s'affiche comme budget, et la Balance = provision − dépensé net (200 − 50 = 150).
    expect(uncatOut.totals[0].budgeted).toBeCloseTo(200, 2);
    expect(uncatOut.totals[0].balance).toBeCloseTo(150, 2);
  });

  it("devrait laisser un mois à venir sans dépense, avec tout le budget encore disponible", () => {
    const txns = [tx({ id: "1", date: "2026-07-10", amount: -120, label: "CARREFOUR", groupId: 1 })];
    const sections = hist([courses], txns, ["2026-07", "2026-08"], "2026-07");
    const row = sections[0].rows[0];
    expect(row.cells[0]).toEqual({ budgeted: 300, depense: 120, recu: 0, balance: 180 }); // juillet, réel
    expect(row.cells[1]).toEqual({ budgeted: 300, depense: 0, recu: 0, balance: 300 }); // août : rien dépensé encore
  });

  it("devrait garder un dépassement du mois en cours hors des cellules des mois futurs", () => {
    // Le dépassement est gardé dans les chaînes du prévisionnel, pas dans les cellules du tableau.
    const txns = [tx({ id: "1", date: "2026-07-10", amount: -450, label: "CARREFOUR", groupId: 1 })]; // 450 > 300
    const sections = hist([courses], txns, ["2026-07", "2026-08"], "2026-07");
    const row = sections[0].rows[0];
    expect(row.cells[0]).toEqual({ budgeted: 300, depense: 450, recu: 0, balance: -150 }); // juillet, réel
    expect(row.cells[1]).toEqual({ budgeted: 300, depense: 0, recu: 0, balance: 300 }); // août : rien dépensé encore
  });

  it("devrait réunir tous les blocs dans les totaux du mois, dépenses comme rémunérations", () => {
    const income: Group = { id: 9, accountId: "a1", name: "Salaire", direction: "in", kind: "recurring", monthlyAmount: null, lines: [{ id: 91, name: "Paie", amount: 2000, day: 1 }], incomeKind: "principal" };
    const txns = [
      tx({ id: "1", date: "2026-07-10", amount: -120, label: "CARREFOUR", groupId: 1 }),
      tx({ id: "2", date: "2026-07-01", amount: 2000, label: "VIR REMU", groupId: 9 }),
    ];
    const sections = hist([courses, income], txns, ["2026-07"], "2026-07");
    const grand = grandTotals(sections, 1);
    expect(grand[0]).toEqual({ budgeted: 2300, depense: 120, recu: 2000, balance: 180 });
  });

  it("devrait ne compter que ce qui dépasse le budget chaque mois, en ignorant les groupes sous leur budget et les rémunérations", () => {
    const c2: Group = { ...courses, id: 3, name: "C2", monthlyAmount: 50 };
    const income: Group = { id: 9, accountId: "a1", name: "Salaire", direction: "in", kind: "envelope", monthlyAmount: 2000, lines: [] };
    const txns = [
      tx({ id: "1", date: "2026-07-10", amount: -450, label: "CARREFOUR", groupId: 1 }), // budget 300 -> dépassement 150
      tx({ id: "2", date: "2026-07-10", amount: -20, label: "LECLERC", groupId: 3 }), // budget 50 -> sous le budget, 0
      tx({ id: "3", date: "2026-07-01", amount: 2500, label: "VIR REMU", groupId: 9 }), // rémunération, ignorée
    ];
    const sections = hist([courses, c2, income], txns, ["2026-07"], "2026-07");
    expect(monthlyOverspend(sections, 1)).toEqual([150]);
  });

  it("devrait ne pas compter la rémunération principale comme reçue dans le futur, mais continuer d'afficher son montant attendu", () => {
    const principal: Group = {
      id: 30, accountId: "a1", name: "Rémunération principale", direction: "in",
      kind: "envelope", monthlyAmount: 2000, lines: [], incomeKind: "principal",
    };
    const sections = hist([principal], [], ["2026-07", "2026-08"], "2026-07");
    const row = sections.find((s) => s.kind === "income")!.rows[0];
    expect(row.incomeKind).toBe("principal");
    expect(row.cells[1].recu).toBe(0); // mois futur : rien de reçu encore
    expect(row.cells[1].budgeted).toBe(2000); // le montant attendu reste affiché
  });

  it("devrait ne pas afficher la rémunération supplémentaire comme reçue dans un mois futur", () => {
    const supp: Group = {
      id: 31, accountId: "a1", name: "Rémunération supplémentaire", direction: "in",
      kind: "envelope", monthlyAmount: 500, lines: [], incomeKind: "supplementary",
    };
    const sections = hist([supp], [], ["2026-07", "2026-08"], "2026-07");
    const row = sections.find((s) => s.kind === "income")!.rows[0];
    expect(row.incomeKind).toBe("supplementary");
    expect(row.cells[1].recu).toBe(0); // mois futur : rien
    expect(row.cells[1].budgeted).toBe(500); // le montant reste stocké (masqué à l'affichage)
  });

  it("devrait ne compter que la rémunération principale dans le total du budget des rémunérations, pas la supplémentaire", () => {
    const principal: Group = {
      id: 40, accountId: "a1", name: "Rémunération principale", direction: "in",
      kind: "envelope", monthlyAmount: 2000, lines: [], incomeKind: "principal",
    };
    const supplementaire: Group = {
      id: 41, accountId: "a1", name: "Rémunération supplémentaire", direction: "in",
      kind: "envelope", monthlyAmount: 500, lines: [], incomeKind: "supplementary",
    };
    const sections = hist([principal, supplementaire], [], ["2026-07"], "2026-07");
    const income = sections.find((s) => s.kind === "income")!;
    // Le total du bloc rémunérations n'inclut que le budget de la principale.
    expect(income.totals[0].budgeted).toBe(2000);
    // Le total général (« Solde actuel ») suit la même règle.
    expect(grandTotals(sections, 1)[0].budgeted).toBe(2000);
  });
});

describe("Répartition des transactions sous les groupes", () => {
  it("devrait ranger une transaction sous la bonne ligne d'un récurrent quand une ligne lui est assignée", () => {
    const txns = [
      tx({ id: "1", date: "2026-07-03", amount: -10, label: "PRLV SPOTIFY", groupId: 2, lineId: 11 }),
      tx({ id: "2", date: "2026-07-08", amount: -15, label: "NETFLIX.COM", groupId: 2, lineId: 12 }),
    ];
    const sections = hist([abo], txns, ["2026-07"], "2026-07");
    const rec = sections.find((s) => s.kind === "recurring")!.rows[0];
    const spotify = rec.subRows.find((s) => s.id === 11)!;
    const netflix = rec.subRows.find((s) => s.id === 12)!;
    expect(spotify.cells[0].depense).toBe(10);
    expect(spotify.txns.map((t) => t.id)).toEqual(["1"]);
    expect(netflix.txns.map((t) => t.id)).toEqual(["2"]);
    expect(rec.txns).toEqual([]); // toutes rattachées à une ligne
  });

  it("devrait ranger une transaction sous une ligne dès qu'on la lui assigne à la main, même sans mot-clé", () => {
    const txns = [tx({ id: "1", date: "2026-07-05", amount: -15, label: "PRLV DIVERS 4821", groupId: 2, lineId: 12 })];
    const sections = hist([abo], txns, ["2026-07"], "2026-07");
    const netflix = sections.find((s) => s.kind === "recurring")!.rows[0].subRows.find((s) => s.id === 12)!;
    expect(netflix.txns.map((t) => t.id)).toEqual(["1"]);
    expect(netflix.cells[0].depense).toBe(15);
  });

  it("devrait afficher les transactions d'une enveloppe directement sous le groupe, sans sous-ligne", () => {
    const txns = [tx({ id: "1", date: "2026-07-10", amount: -120, label: "CARREFOUR", groupId: 1 })];
    const sections = hist([courses], txns, ["2026-07"], "2026-07");
    const env = sections[0].rows[0];
    expect(env.subRows).toEqual([]);
    expect(env.txns.map((t) => t.id)).toEqual(["1"]);
  });

  it("devrait laisser une transaction de récurrent sans ligne correspondante directement sous le groupe", () => {
    const txns = [tx({ id: "1", date: "2026-07-10", amount: -40, label: "ACHAT INCONNU", groupId: 2 })];
    const sections = hist([abo], txns, ["2026-07"], "2026-07");
    const rec = sections.find((s) => s.kind === "recurring")!.rows[0];
    expect(rec.txns.map((t) => t.id)).toEqual(["1"]);
    expect(rec.subRows.every((s) => s.txns.length === 0)).toBe(true);
  });

  it("devrait masquer les sections vides", () => {
    const txns = [tx({ id: "1", date: "2026-07-10", amount: -120, label: "CARREFOUR", groupId: 1 })];
    const sections = hist([courses], txns, ["2026-07"], "2026-07");
    expect(sections.map((s) => s.kind)).toEqual(["envelope"]);
  });

  it("devrait séparer les transactions sans groupe en deux blocs : l'argent qui entre et l'argent qui sort, avec une Balance « out » qui inclut les reçus croisés du bloc « in »", () => {
    const txns = [
      tx({ id: "1", date: "2026-07-05", amount: -40, label: "ACHAT X" }), // non catégorisée, qui sort
      tx({ id: "2", date: "2026-07-06", amount: 100, label: "REMBOURSEMENT" }), // non catégorisée, qui entre
      tx({ id: "3", date: "2026-07-07", amount: -25, label: "CARREFOUR", groupId: 1 }), // catégorisée
    ];
    const sections = hist([courses], txns, ["2026-07"], "2026-07");
    const uncatIn = sections.find((s) => s.kind === "uncategorized" && s.uncatDirection === "in")!;
    const uncatOut = sections.find((s) => s.kind === "uncategorized" && s.uncatDirection === "out")!;
    // L'argent qui entre dans le bloc « in » (affiché sous les rémunérations)…
    expect(uncatIn.txns!.map((t) => t.id)).toEqual(["2"]);
    expect(uncatIn.totals[0]).toEqual({ budgeted: 0, depense: 0, recu: 100, balance: 0 });
    // … et l'argent qui sort dans le bloc « out » (après les enveloppes). Sans
    // provision (aucun budget daté du groupe 0), la Balance = reçus non catégorisés
    // du bloc « in » (100) − dépensé (40) = 60. Le `recu` de CETTE section (« out »)
    // reste 0 (elle ne contient que les sorties) : c'est bien le reçu croisé du bloc
    // « in » qui alimente la Balance, comme le Reste affiché dans la grille.
    expect(uncatOut.txns!.map((t) => t.id)).toEqual(["1"]);
    expect(uncatOut.totals[0]).toEqual({ budgeted: 0, depense: 40, recu: 0, balance: 60 });
    expect([...uncatIn.txns!, ...uncatOut.txns!].every((t) => t.groupId === null)).toBe(true);
    // Ordre : l'argent qui entre juste après les rémunérations (ici : en tête), l'argent qui sort en dernier.
    expect(sections.map((s) => (s.kind === "uncategorized" ? `uncat-${s.uncatDirection}` : s.kind))).toEqual([
      "uncat-in",
      "envelope",
      "uncat-out",
    ]);
  });

  it("devrait n'afficher aucun bloc de non catégorisés quand chaque transaction a déjà un groupe", () => {
    const txns = [tx({ id: "1", date: "2026-07-05", amount: -40, label: "X", groupId: 1 })];
    const sections = hist([courses], txns, ["2026-07"], "2026-07");
    expect(sections.some((s) => s.kind === "uncategorized")).toBe(false);
  });
});

describe("Manipulation des mois", () => {
  it("devrait lister, dans l'ordre, les mois qui ont vraiment des transactions", () => {
    const txns = [tx({ date: "2026-07-05" }), tx({ date: "2026-06-20" }), tx({ date: "2026-07-28" }), tx({ date: "2026-05-01" })];
    expect(monthsWithData(txns)).toEqual(["2026-05", "2026-06", "2026-07"]);
  });

  it("devrait passer au mois suivant, et repartir sur janvier après décembre", () => {
    expect(nextMonthKey("2026-07")).toBe("2026-08");
    expect(nextMonthKey("2026-12")).toBe("2027-01");
  });

  it("devrait avancer ou reculer de plusieurs mois, même d'une année à l'autre", () => {
    expect(addMonthsKey("2026-07", 3)).toBe("2026-10");
    expect(addMonthsKey("2026-07", -1)).toBe("2026-06");
    expect(addMonthsKey("2026-01", -1)).toBe("2025-12");
    expect(addMonthsKey("2026-07", 12)).toBe("2027-07");
  });

  it("devrait lister tous les mois entre deux bornes incluses, quel que soit l'ordre des bornes", () => {
    expect(monthRange("2026-05", "2026-08")).toEqual(["2026-05", "2026-06", "2026-07", "2026-08"]);
    expect(monthRange("2026-08", "2026-05")).toEqual(["2026-05", "2026-06", "2026-07", "2026-08"]);
    expect(monthRange("2026-07", "2026-07")).toEqual(["2026-07"]);
  });

  it("devrait n'accepter qu'un mois au format AAAA-MM valide et rejeter le reste", () => {
    expect(isMonthKey("2026-07")).toBe(true);
    expect(isMonthKey("2026-13")).toBe(false);
    expect(isMonthKey("2026-00")).toBe(false);
    expect(isMonthKey("2026-7")).toBe(false);
    expect(isMonthKey(undefined)).toBe(false);
  });

  it("devrait dire combien de mois séparent deux mois, en positif comme en négatif", () => {
    expect(monthsDiff("2026-07", "2026-08")).toBe(1);
    expect(monthsDiff("2026-07", "2026-12")).toBe(5);
    expect(monthsDiff("2026-07", "2027-01")).toBe(6);
    expect(monthsDiff("2026-07", "2026-07")).toBe(0);
    expect(monthsDiff("2026-07", "2026-05")).toBe(-2);
  });

  it("devrait ramener un mois dans une plage autorisée", () => {
    expect(clampMonth("2026-01", "2026-05", "2026-09")).toBe("2026-05");
    expect(clampMonth("2026-12", "2026-05", "2026-09")).toBe("2026-09");
    expect(clampMonth("2026-07", "2026-05", "2026-09")).toBe("2026-07");
  });
});

describe("La ligne de solde courant", () => {
  it("devrait faire tomber la fin du mois en cours pile sur le vrai solde bancaire", () => {
    const txns = [
      tx({ id: "1", date: "2026-07-01", amount: 2000, label: "VIR REMU", groupId: 9 }),
      tx({ id: "2", date: "2026-07-10", amount: -120, label: "CARREFOUR", groupId: 1 }),
    ];
    const months = ["2026-07"];
    const sections = hist([salaire, courses], txns, months, "2026-07");
    const solde = computeSolde(sections, months, "2026-07", 1500);
    // net juillet = 2000 - 120 = 1880 ; ouverture = 1500 - 1880 = -380
    expect(solde.closings[0]).toBe(1500);
    expect(solde.openings[0]).toBe(-380);
    // la rémunération d'abord (-380 + 2000 = 1620), puis la dépense (1620 - 120 = 1500)
    expect(solde.rowRunning[9][0]).toBe(1620);
    expect(solde.rowRunning[1][0]).toBe(1500);
  });

  it("devrait enchaîner les mois : un mois finit là où le suivant commence", () => {
    const txns = [
      tx({ id: "1", date: "2026-06-10", amount: -100, label: "CARREFOUR", groupId: 1 }),
      tx({ id: "2", date: "2026-07-01", amount: 2000, label: "VIR REMU", groupId: 9 }),
      tx({ id: "3", date: "2026-07-10", amount: -120, label: "CARREFOUR", groupId: 1 }),
    ];
    const months = ["2026-06", "2026-07"];
    const sections = hist([salaire, courses], txns, months, "2026-07");
    const solde = computeSolde(sections, months, "2026-07", 1500);
    expect(solde.closings[1]).toBe(1500);
    expect(solde.openings[1]).toBe(-380); // 1500 - 1880
    expect(solde.closings[0]).toBe(solde.openings[1]); // enchaînement
    expect(solde.openings[0]).toBe(-280); // -380 - (-100)
  });

  it("devrait garder un mois futur plat, à partir du solde bancaire ou de l'estimation donnée", () => {
    const txns = [
      tx({ id: "1", date: "2026-07-01", amount: 2000, label: "VIR REMU", groupId: 9 }),
      tx({ id: "2", date: "2026-07-10", amount: -120, label: "CARREFOUR", groupId: 1 }),
    ];
    const months = ["2026-07", "2026-08"];
    const sections = hist([salaire, courses], txns, months, "2026-07");
    // Sans estimation : août s'ouvre sur la fin de juillet et n'a aucun mouvement réel.
    const solde = computeSolde(sections, months, "2026-07", 1500);
    expect(solde.openings[1]).toBe(1500); // = fin de juillet
    expect(solde.closings[1]).toBe(1500); // net futur = 0
    // Avec l'estimation de fin du mois courant : août s'ouvre dessus.
    const soldeEst = computeSolde(sections, months, "2026-07", 1500, 1800);
    expect(soldeEst.openings[1]).toBe(1800);
    expect(soldeEst.closings[1]).toBe(1800);
  });

  it("devrait faire partir une période entièrement future du solde d'aujourd'hui", () => {
    const txns = [
      tx({ id: "1", date: "2026-07-01", amount: 2000, label: "VIR REMU", groupId: 9 }),
      tx({ id: "2", date: "2026-07-10", amount: -120, label: "CARREFOUR", groupId: 1 }),
    ];
    const months = ["2026-08", "2026-09"];
    const sections = hist([salaire, courses], txns, months, "2026-07");
    const solde = computeSolde(sections, months, "2026-07", 1500);
    // Mois futurs : rien de réalisé, la chaîne reste plate sur le solde d'aujourd'hui.
    expect(solde.openings[0]).toBe(1500); // = solde d'aujourd'hui
    expect(solde.closings[0]).toBe(1500); // net futur = 0
    expect(solde.openings[1]).toBe(1500); // enchaînement
    expect(solde.closings[1]).toBe(1500);
  });
});

describe("Les soldes prévisionnels", () => {
  it("devrait calculer le solde prévu comme départ + rémunérations − budget, avec une seconde ligne qui enlève aussi les dépassements", () => {
    // Rémunération principale 2000 (in), une dépense budget 300 dont on a dépensé 350 ce mois (dépassement 50).
    const principal: Group = { id: 1, accountId: "a1", name: "Rémunération principale", direction: "in", kind: "envelope", monthlyAmount: 2000, lines: [], incomeKind: "principal" };
    const courses2: Group = { id: 2, accountId: "a1", name: "Courses", direction: "out", kind: "envelope", monthlyAmount: 300, lines: [], incomeKind: null };
    const txns = [
      tx({ id: "s", date: "2026-07-01", amount: 2000, label: "REMU", groupId: 1 }),
      tx({ id: "c", date: "2026-07-10", amount: -350, label: "CARREFOUR", groupId: 2 }),
    ];
    const months = ["2026-07", "2026-08"];
    const sections = hist([principal, courses2], txns, months, "2026-07");
    const solde = computeSolde(sections, months, "2026-07", 5000);
    const p = computePlannedSoldes(sections, months, "2026-07", solde.openings);
    const open = solde.openings[0]; // argent de départ réel du mois courant
    // Mois courant : prévu = open + 2000 − 300 ; ligne dépassement = prévu − 50.
    expect(p.prevuClosings[0]).toBeCloseTo(open + 2000 - 300, 2);
    expect(p.depassClosings[0]).toBeCloseTo(open + 2000 - 300 - 50, 2);
    // Mois futur : chaîné depuis la clôture du mois courant (même net prévu). Plus
    // aucun dépassement n'y est ajouté (le budget de Courses n'y dépasse plus), mais
    // l'écart réel du mois courant (50) reste constant, sans grandir davantage.
    expect(p.prevuClosings[1]).toBeCloseTo((open + 2000 - 300) + (2000 - 300), 2);
    expect(p.depassClosings[1]).toBeCloseTo(p.prevuClosings[1]! - 50, 2);
    // Avec l'estimation de fin du mois courant : le premier mois futur repart de là,
    // les deux chaînes reparties du même point -> plus aucun écart.
    const pe = computePlannedSoldes(sections, months, "2026-07", solde.openings, 4200);
    expect(pe.prevuClosings[0]).toBeCloseTo(open + 2000 - 300, 2); // mois courant inchangé
    expect(pe.prevuClosings[1]).toBeCloseTo(4200 + (2000 - 300), 2);
    expect(pe.depassClosings[1]).toBeCloseTo(pe.prevuClosings[1]!, 2);
  });

  it("devrait faire baisser la ligne des dépassements avec l'argent dépensé sans groupe, l'argent reçu sans groupe n'y changeant rien", () => {
    // 500 dépensés sans groupe, 200 reçus sans groupe -> débordement net 300.
    const txns = [
      tx({ id: "a", date: "2026-07-05", amount: -500, label: "ACHAT X" }),
      tx({ id: "b", date: "2026-07-06", amount: 200, label: "REMBOURSEMENT" }),
    ];
    const months = ["2026-07", "2026-08"];
    const sections = hist([], txns, months, "2026-07");
    const solde = computeSolde(sections, months, "2026-07", 1000);
    const p = computePlannedSoldes(sections, months, "2026-07", solde.openings);
    const open = solde.openings[0];
    // Prévu simple : les non catégorisés ne changent rien (aucun budget).
    expect(p.prevuClosings[0]).toBeCloseTo(open, 2);
    // Ligne dépassement : la clôture retire le débordement net (300), en continu avec
    // la valeur courue à l'étape « dépenses ».
    expect(p.depassClosings[0]).toBeCloseTo(open - 300, 2);
    expect(p.uncatDepassRunning.out?.[0]).toBeCloseTo(open - 300, 2);
    expect(p.uncatDepassRunning.in?.[0]).toBeCloseTo(open, 2); // le reçu ne retire rien
    // Mois futur : plus aucun report, le « si dépassement » rejoint le « prévu ».
    expect(p.depassClosings[1]).toBeCloseTo(p.prevuClosings[1]!, 2);
  });

  it("devrait égaler le « si dépassement » au « prévu » quand la provision des non catégorisés couvre la dépense (sous-dépensé)", () => {
    // Provision de 200, seulement 50 dépensés sans groupe : la provision couvre large,
    // aucun débordement. Le « si dépassement » ne doit PAS rester au-dessus du prévu
    // (bug : l'ancien code ne retirait la provision que du prévu, pas du dépassement).
    const dated = { 0: [{ effectiveMonth: "2026-07", amount: 200 }] };
    const txns = [tx({ id: "a", date: "2026-07-05", amount: -50, label: "SANS GROUPE" })];
    const months = ["2026-07"];
    const sections = hist([], txns, months, "2026-07", dated);
    const solde = computeSolde(sections, months, "2026-07", 1000);
    const p = computePlannedSoldes(sections, months, "2026-07", solde.openings, undefined, dated);
    const open = solde.openings[0];
    expect(p.prevuClosings[0]).toBeCloseTo(open - 200, 2);
    expect(p.depassClosings[0]).toBeCloseTo(p.prevuClosings[0]!, 2);
  });

  it("devrait retirer la provision ET l'excès du « si dépassement » quand la dépense sans groupe dépasse la provision (sur-dépensé)", () => {
    // Provision de 200, 500 dépensés sans groupe : excès de 300 au-delà de la provision.
    // Le « si dépassement » doit retirer la dépense réelle en entier (200 + 300 = 500),
    // pas seulement l'excès (ce qu'aurait laissé passer le bug).
    const dated = { 0: [{ effectiveMonth: "2026-07", amount: 200 }] };
    const txns = [tx({ id: "a", date: "2026-07-05", amount: -500, label: "SANS GROUPE" })];
    const months = ["2026-07"];
    const sections = hist([], txns, months, "2026-07", dated);
    const solde = computeSolde(sections, months, "2026-07", 1000);
    const p = computePlannedSoldes(sections, months, "2026-07", solde.openings, undefined, dated);
    const open = solde.openings[0];
    expect(p.prevuClosings[0]).toBeCloseTo(open - 200, 2);
    expect(p.depassClosings[0]).toBeCloseTo(open - 500, 2);
    expect(p.prevuClosings[0]! - p.depassClosings[0]!).toBeCloseTo(300, 2);
  });

  it("devrait compter la rémunération supplémentaire dans le mois en cours, mais ne jamais la projeter dans le futur", () => {
    const supp: Group = { id: 3, accountId: "a1", name: "Rémunération supplémentaire", direction: "in", kind: "envelope", monthlyAmount: 500, lines: [], incomeKind: "supplementary" };
    const months = ["2026-07", "2026-08"];
    const sections = hist([supp], [], months, "2026-07");
    const solde = computeSolde(sections, months, "2026-07", 1000);
    const p = computePlannedSoldes(sections, months, "2026-07", solde.openings);
    const open = solde.openings[0];
    expect(p.prevuClosings[0]).toBeCloseTo(open + 500, 2); // courant : +500
    expect(p.prevuClosings[1]).toBeCloseTo(open + 500, 2); // futur : +0 (pas de projection)
  });

  it("devrait ne rien reporter sur les mois suivants : le « si dépassement » futur rejoint le « prévu »", () => {
    const principal: Group = { id: 1, accountId: "a1", name: "Rémunération principale", direction: "in", kind: "envelope", monthlyAmount: 2000, lines: [], incomeKind: "principal" };
    const courses2: Group = { id: 2, accountId: "a1", name: "Courses", direction: "out", kind: "envelope", monthlyAmount: 300, lines: [], incomeKind: null };
    const txns = [
      tx({ id: "s", date: "2026-07-01", amount: 2000, label: "REMU", groupId: 1 }),
      tx({ id: "c", date: "2026-07-10", amount: -350, label: "CARREFOUR", groupId: 2 }), // dépassement courant : 50
    ];
    const months = ["2026-07", "2026-08", "2026-09"];
    const sections = hist([principal, courses2], txns, months, "2026-07");
    const solde = computeSolde(sections, months, "2026-07", 5000);
    const open = solde.openings[0];
    const p = computePlannedSoldes(sections, months, "2026-07", solde.openings);
    // Le mois courant reste factuel : le dépassement réel de 50 est retiré.
    expect(p.depassClosings[0]).toBeCloseTo(open + 2000 - 300 - 50, 2);
    // Les mois futurs ne reportent plus rien de NOUVEAU (Courses reste dans son budget
    // en août et septembre) : l'écart avec le prévu reste constant (celui du mois
    // courant, 50), il ne grandit plus mois après mois comme le faisait l'ancien
    // mécanisme de report (qui aurait redonné -50 sur chaque mois futur en plus).
    expect(p.depassClosings[1]).toBeCloseTo(p.prevuClosings[1]! - 50, 2);
    expect(p.depassClosings[2]).toBeCloseTo(p.prevuClosings[2]! - 50, 2);
  });

  it("devrait cumuler le « si dépassement » d'un seul tenant : une enveloppe hérite des dépassements des sections du dessus", () => {
    const principal: Group = { id: 1, accountId: "a1", name: "Rémunération principale", direction: "in", kind: "envelope", monthlyAmount: 2000, lines: [], incomeKind: "principal" };
    const loyer: Group = { id: 2, accountId: "a1", name: "Loyer", direction: "out", kind: "recurring", monthlyAmount: null, lines: [{ id: 21, name: "Loyer", amount: 100, day: 5 }], incomeKind: null };
    const courses2: Group = { id: 3, accountId: "a1", name: "Courses", direction: "out", kind: "envelope", monthlyAmount: 100, lines: [], incomeKind: null };
    const txns = [
      tx({ id: "s", date: "2026-07-01", amount: 2000, label: "REMU", groupId: 1 }),
      tx({ id: "l", date: "2026-07-05", amount: -150, label: "LOYER", groupId: 2 }), // budget 100 -> dépassement 50 (section Récurrents)
      tx({ id: "c", date: "2026-07-10", amount: -130, label: "CARREFOUR", groupId: 3 }), // budget 100 -> dépassement 30 (section Enveloppes)
      tx({ id: "u", date: "2026-07-12", amount: -40, label: "SANS GROUPE" }), // débordement non catégorisé : 40
    ];
    const months = ["2026-07"];
    const sections = hist([principal, loyer, courses2], txns, months, "2026-07");
    const solde = computeSolde(sections, months, "2026-07", 5000);
    const p = computePlannedSoldes(sections, months, "2026-07", solde.openings);
    // Le récurrent qui dépasse : son solde si dépassement = son solde prévu − ses 50.
    expect(p.prevuRowRunning[2][0]! - p.depassRowRunning[2][0]!).toBeCloseTo(50, 2);
    // L'enveloppe, section suivante : la chaîne est continue, elle hérite donc des 50 du
    // récurrent au-dessus + ses propres 30 = 80.
    expect(p.prevuRowRunning[3][0]! - p.depassRowRunning[3][0]!).toBeCloseTo(80, 2);
    // Les non catégorisés récapitulent tout : 50 + 30 + 40, égal à la clôture globale.
    expect(p.uncatDepassRunning.out?.[0]).toBeCloseTo(p.depassClosings[0]!, 2);
    expect(p.prevuClosings[0]! - p.depassClosings[0]!).toBeCloseTo(120, 2);
  });
});

describe("Budgets qui changent à partir d'un mois donné", () => {
  it("devrait appliquer le budget en vigueur mois par mois, sans toucher aux mois d'avant", () => {
    const dated = { 1: [{ effectiveMonth: "2026-08", amount: 400 }] };
    const txns = [tx({ id: "1", date: "2026-07-10", amount: -350, label: "CARREFOUR", groupId: 1 })];
    const sections = hist([courses], txns, ["2026-07", "2026-08"], "2026-07", dated);
    const row = sections[0].rows[0];
    // Juillet garde l'ancien budget (300) : le dépassement de 50 reste visible.
    expect(row.cells[0]).toEqual({ budgeted: 300, depense: 350, recu: 0, balance: -50 });
    // Août applique le nouveau budget (400), rien de dépensé encore.
    expect(row.cells[1]).toEqual({ budgeted: 400, depense: 0, recu: 0, balance: 400 });
  });

  it("devrait prendre le dernier budget daté à cette date ou avant", () => {
    // L'entrée de départ (semée par la reprise, cf. seedDated) porte le montant de la
    // fixture ; le test y ajoute deux changements datés ultérieurs.
    const { dated: base, datedLines } = seedDated([courses]);
    const dated = mergeDated(base, { 1: [{ effectiveMonth: "2026-08", amount: 400 }, { effectiveMonth: "2026-10", amount: 450 }] });
    expect(budgetInForce(courses, "2026-07", dated, datedLines)).toBe(300); // avant tout changement daté
    expect(budgetInForce(courses, "2026-08", dated, datedLines)).toBe(400);
    expect(budgetInForce(courses, "2026-09", dated, datedLines)).toBe(400);
    expect(budgetInForce(courses, "2026-11", dated, datedLines)).toBe(450);
    // Sans aucune entrée datée, il n'y a plus de montant de base sur lequel retomber : 0.
    expect(budgetInForce(courses, "2026-07")).toBe(0);
  });

  it("devrait regrouper les changements de budget par groupe, dans l'ordre des mois", () => {
    expect(
      toDatedBudgets([
        { groupId: 1, effectiveMonth: "2026-08", amount: 400, scope: "ongoing" },
        { groupId: 2, effectiveMonth: "2026-09", amount: 50, scope: "ongoing" },
        { groupId: 1, effectiveMonth: "2026-10", amount: 450, scope: "once" },
      ]),
      // La portée est transportée telle quelle : c'est elle qui décide, à la lecture,
      // si un montant vaut pour son seul mois ou pour les suivants.
    ).toEqual({
      1: [
        { effectiveMonth: "2026-08", amount: 400, scope: "ongoing" },
        { effectiveMonth: "2026-10", amount: 450, scope: "once" },
      ],
      2: [{ effectiveMonth: "2026-09", amount: 50, scope: "ongoing" }],
    });
  });
});

// La portée vit désormais DANS le montant : une entrée sait si elle vaut pour son
// seul mois (« once ») ou à partir de son mois (« ongoing », le défaut quand rien
// n'est dit). Appliquer un montant à un seul mois n'écrit donc plus rien nulle part
// ailleurs — avant, une restauration était posée au mois suivant, et cette entrée
// fantôme apparaissait dans la frise sans que personne l'ait créée.
describe("Changer un budget pour un seul mois", () => {
  it("ne vaut que pour son mois, les suivants reprenant le dernier montant permanent", () => {
    const dated: DatedBudgets = {
      1: [
        { effectiveMonth: "2026-03", amount: 250 },
        { effectiveMonth: "2026-07", amount: 400, scope: "once" },
      ],
    };
    expect(budgetInForce(courses, "2026-06", dated, {})).toBe(250);
    expect(budgetInForce(courses, "2026-07", dated, {})).toBe(400);
    expect(budgetInForce(courses, "2026-08", dated, {})).toBe(250);
    expect(budgetInForce(courses, "2027-01", dated, {})).toBe(250);
  });

  it("ne vaut que pour son mois même sans aucun montant permanent avant", () => {
    const dated: DatedBudgets = { 1: [{ effectiveMonth: "2026-07", amount: 400, scope: "once" }] };
    expect(budgetInForce(courses, "2026-07", dated, {})).toBe(400);
    expect(budgetInForce(courses, "2026-08", dated, {})).toBe(0);
    expect(budgetInForce(courses, "2026-06", dated, {})).toBe(0);
  });

  // Les deux portées peuvent cohabiter au même mois : on relève durablement à partir
  // de juillet ET on fait une exception pour juillet lui-même. Le ponctuel gagne son
  // mois, le permanent vaut pour la suite. Sans ça, appliquer l'un effacerait l'autre.
  it("l'emporte sur un montant permanent posé au même mois, sans l'effacer pour la suite", () => {
    const dated: DatedBudgets = {
      1: [
        { effectiveMonth: "2026-07", amount: 300 },
        { effectiveMonth: "2026-07", amount: 500, scope: "once" },
      ],
    };
    expect(budgetInForce(courses, "2026-07", dated, {})).toBe(500);
    expect(budgetInForce(courses, "2026-08", dated, {})).toBe(300);
  });

  it("ne perturbe pas un changement permanent déjà prévu plus tard", () => {
    const dated: DatedBudgets = {
      1: [
        { effectiveMonth: "2026-03", amount: 250 },
        { effectiveMonth: "2026-07", amount: 400, scope: "once" },
        { effectiveMonth: "2026-09", amount: 320 },
      ],
    };
    expect(budgetInForce(courses, "2026-08", dated, {})).toBe(250);
    expect(budgetInForce(courses, "2026-09", dated, {})).toBe(320);
  });

  it("s'applique de la même façon au montant d'une ligne de récurrent", () => {
    const datedLines = {
      11: [
        { effectiveMonth: "2026-03", amount: 10 },
        { effectiveMonth: "2026-07", amount: 25, scope: "once" as const },
      ],
    };
    expect(lineAmountInForce(11, "2026-06", datedLines)).toBe(10);
    expect(lineAmountInForce(11, "2026-07", datedLines)).toBe(25);
    expect(lineAmountInForce(11, "2026-08", datedLines)).toBe(10);
  });
});

describe("Rappels d'argent dépensé au-delà du budget", () => {
  // Un dépassement ne se tranche plus : il se signale, et c'est tout. Relever un budget
  // pour la suite est un geste à part, que l'utilisateur fait dans les cases du mois
  // qu'il veut changer. Les mois révolus sont donc signalés comme les autres — leur
  // dépassement a bien eu lieu, il n'y a simplement rien à décider dessus.
  it("signale les dépassements de tous les mois écoulés, mois courant compris", () => {
    const txns = [
      tx({ id: "1", date: "2026-06-10", amount: -350, label: "CARREFOUR", groupId: 1 }), // juin : dépassement 50
      tx({ id: "2", date: "2026-07-10", amount: -380, label: "CARREFOUR", groupId: 1 }), // juillet (courant) : 80
      tx({ id: "3", date: "2026-06-05", amount: -120, label: "SANS GROUPE" }), // uncat juin : 120 dépensés
      tx({ id: "4", date: "2026-06-06", amount: 40, label: "REMBOURSEMENT" }), // uncat juin : 40 reçus -> net 80
    ];
    const r = over([courses], txns, "2026-07");
    expect(r.byMonth["2026-06"]).toEqual([
      { groupId: 1, lineId: null, name: "Courses", month: "2026-06", amount: 50, kind: "envelope" },
      { groupId: 0, lineId: null, name: "Non catégorisés", month: "2026-06", amount: 80, kind: "envelope" },
    ]);
    expect(r.byMonth["2026-07"]).toEqual([
      { groupId: 1, lineId: null, name: "Courses", month: "2026-07", amount: 80, kind: "envelope" },
    ]);
  });

  // Un mois à venir n'a rien de réel : aucune dépense n'y a encore eu lieu.
  it("ne signale rien sur un mois à venir", () => {
    const txns = [tx({ id: "1", date: "2026-07-10", amount: -380, label: "CARREFOUR", groupId: 1 })];
    expect(over([courses], txns, "2026-06").byMonth["2026-07"]).toBeUndefined();
  });

  it("devrait dire la nature de ce qui dépasse, enveloppe ou ligne de récurrent", () => {
    // Une enveloppe (Courses, 300) et la ligne d'un récurrent (Loyer, 100) dépassent le
    // même mois. L'enveloppe remonte telle quelle ; le récurrent remonte par sa LIGNE,
    // qui est ce qui porte un budget et donc ce qui peut déborder.
    const loyer: Group = {
      id: 2, accountId: "a1", name: "Loyer", direction: "out", kind: "recurring",
      monthlyAmount: null, lines: [{ id: 21, name: "Loyer", amount: 100, day: 5 }], incomeKind: null,
    };
    const txns = [
      tx({ id: "1", date: "2026-07-10", amount: -350, label: "CARREFOUR", groupId: 1 }), // enveloppe : 50
      tx({ id: "2", date: "2026-07-05", amount: -130, label: "LOYER", groupId: 2, lineId: 21 }), // ligne : 30
    ];
    const r = over([courses, loyer], txns, "2026-07");
    expect(r.byMonth["2026-07"]).toEqual([
      { groupId: 1, lineId: null, name: "Courses", month: "2026-07", amount: 50, kind: "envelope" },
      { groupId: 2, lineId: 21, name: "Loyer", month: "2026-07", amount: 30, kind: "recurring" },
    ]);
  });

  it("devrait, de bout en bout, ne reporter aucun dépassement sur le prévisionnel des mois à venir", () => {
    const txns = [tx({ id: "1", date: "2026-07-10", amount: -380, label: "CARREFOUR", groupId: 1 })]; // budget 300 -> dépassement 80
    const months = ["2026-07", "2026-08"];
    const sections = hist([courses], txns, months, "2026-07");
    const solde = computeSolde(sections, months, "2026-07", 1000);
    const estimate = solde.openings[0] - 380; // estimé de fin du mois courant, comme le fait la page Historique
    // Un dépassement ne se reconduit jamais tout seul : relever un budget pour les mois
    // à venir se fait à la main, depuis les cases concernées.
    const p = computePlannedSoldes(sections, months, "2026-07", solde.openings, estimate);
    // Le mois courant reste factuel : le dépassement réel de 80 est retiré.
    expect(p.prevuClosings[0]! - p.depassClosings[0]!).toBeCloseTo(80, 2);
    // Le mois futur ne reporte plus rien : le « si dépassement » rejoint le « prévu ».
    expect(p.depassClosings[1]).toBeCloseTo(p.prevuClosings[1]!, 2);
  });
});

// Un récurrent n'a pas de budget à lui : ce sont ses lignes qui en portent un, et
// c'est donc chacune d'elles qui déborde ou non. Le dépassement se constate au niveau
// de la ligne : Sosh Internet, pas Abonnements. Le groupe n'est qu'une somme.
describe("Le dépassement d'un récurrent se constate ligne par ligne", () => {
  const sosh = { id: 31, name: "Sosh Internet", amount: 30, day: 12 };
  const assurance = { id: 32, name: "Direct Assurance", amount: 80, day: 5 };
  const abonnements: Group = {
    id: 3, accountId: "a1", name: "Abonnements", direction: "out", kind: "recurring",
    monthlyAmount: null, lines: [sosh, assurance], startMonth: "2026-01", endMonth: null, incomeKind: null,
  };
  const datedLines = toDatedLineAmounts([
    { lineId: 31, effectiveMonth: "2026-01", amount: 30 },
    { lineId: 32, effectiveMonth: "2026-01", amount: 80 },
  ]);
  const over = (txns: Txn[]) => computeOverspends([abonnements], txns, "2026-07", {}, datedLines);

  it("signale la ligne qui déborde, et elle seule", () => {
    const txns = [
      tx({ id: "a", date: "2026-07-12", amount: -45, label: "SOSH", groupId: 3, lineId: 31 }),
      tx({ id: "b", date: "2026-07-05", amount: -80, label: "ASSURANCE", groupId: 3, lineId: 32 }),
    ];
    expect(over(txns).byMonth["2026-07"]).toEqual([
      { groupId: 3, lineId: 31, name: "Sosh Internet", month: "2026-07", amount: 15, kind: "recurring" },
    ]);
  });

  // Le groupe n'apparaît jamais : son débordement n'est que la somme de ceux de ses
  // lignes, il n'y a rien à trancher à son niveau.
  it("ne signale jamais le groupe lui-même", () => {
    const txns = [
      tx({ id: "a", date: "2026-07-12", amount: -45, label: "SOSH", groupId: 3, lineId: 31 }),
      tx({ id: "b", date: "2026-07-05", amount: -95, label: "ASSURANCE", groupId: 3, lineId: 32 }),
    ];
    expect(over(txns).byMonth["2026-07"]!.some((p) => p.lineId === null)).toBe(false);
  });

  it("signale chaque ligne qui déborde, séparément", () => {
    const txns = [
      tx({ id: "a", date: "2026-07-12", amount: -45, label: "SOSH", groupId: 3, lineId: 31 }),
      tx({ id: "b", date: "2026-07-05", amount: -95, label: "ASSURANCE", groupId: 3, lineId: 32 }),
    ];
    expect(over(txns).byMonth["2026-07"]).toEqual([
      { groupId: 3, lineId: 32, name: "Direct Assurance", month: "2026-07", amount: 15, kind: "recurring" },
      { groupId: 3, lineId: 31, name: "Sosh Internet", month: "2026-07", amount: 15, kind: "recurring" },
    ]);
  });

  it("laisse une enveloppe sans ligne, comme avant", () => {
    const txns = [tx({ id: "c", date: "2026-07-10", amount: -350, label: "CARREFOUR", groupId: 1 })];
    const r = computeOverspends([courses], txns, "2026-07", seedDated([courses]).dated, {});
    expect(r.byMonth["2026-07"]).toEqual([
      { groupId: 1, lineId: null, name: "Courses", month: "2026-07", amount: 50, kind: "envelope" },
    ]);
  });
});

// Un groupe récurrent ne se tranche plus lui-même, mais il doit continuer de MONTRER
// qu'il reste à trancher chez lui : replié, aucune de ses lignes n'est visible, et rien
// ne dirait qu'une décision attend. C'est un signal, pas une décision.
// L'étiquette « dépassement » sous un montant se lit dans la liste des dépassements, et
// nulle part ailleurs : c'est ce qui la fait disparaître quand l'utilisateur clique
// « Vu » — acquitter retire le dépassement de la liste, et l'étiquette suit.
describe("Cases qui portent l'étiquette dépassement", () => {
  const item = (groupId: number, lineId: number | null, month: string): Overspend => ({
    groupId, lineId, name: "x", month, amount: 10, kind: lineId === null ? "envelope" : "recurring",
  });

  it("marque la case de ce qui déborde, au bon mois", () => {
    const s = overspentCells({ "2026-07": [item(16, null, "2026-07"), item(13, 3, "2026-07")] });
    expect(s.has("16::0::2026-07")).toBe(true);
    expect(s.has("13::3::2026-07")).toBe(true);
  });

  it("ne marque ni un autre mois, ni une autre ligne", () => {
    const s = overspentCells({ "2026-07": [item(13, 3, "2026-07")] });
    expect(s.has("13::3::2026-08")).toBe(false);
    expect(s.has("13::4::2026-07")).toBe(false);
    expect(s.has("13::0::2026-07")).toBe(false);
  });

  it("ne marque rien quand rien ne déborde", () => {
    expect([...overspentCells({})]).toEqual([]);
  });
});

describe("Ce qu'un groupe signale à trancher chez ses lignes", () => {
  const item = (groupId: number, lineId: number | null, month: string): Overspend => ({
    groupId, lineId, name: "x", month, amount: 10, kind: lineId === null ? "envelope" : "recurring",
  });

  it("marque le groupe au mois où une de ses lignes attend une décision", () => {
    const s = groupsWithPending({ "2026-07": [item(13, 3, "2026-07")] });
    expect(s.has("13::2026-07")).toBe(true);
  });

  it("ne marque ni un autre mois, ni un autre groupe", () => {
    const s = groupsWithPending({ "2026-07": [item(13, 3, "2026-07")] });
    expect(s.has("13::2026-08")).toBe(false);
    expect(s.has("14::2026-07")).toBe(false);
  });

  it("ne marque qu'une fois un groupe dont plusieurs lignes attendent", () => {
    const s = groupsWithPending({ "2026-07": [item(13, 3, "2026-07"), item(13, 4, "2026-07")] });
    expect([...s]).toEqual(["13::2026-07"]);
  });

  // Une enveloppe se tranche sur place : elle est marquée aussi, mais sa case porte de
  // toute façon sa propre décision — le signal ne fait alors que confirmer.
  it("marque aussi une enveloppe, qui n'a pas de lignes", () => {
    expect(groupsWithPending({ "2026-07": [item(16, null, "2026-07")] }).has("16::2026-07")).toBe(true);
  });

  it("ne marque rien quand rien n'attend", () => {
    expect([...groupsWithPending({})]).toEqual([]);
  });
});

// Une ligne de récurrent a sa propre durée de vie, indépendante de celle du groupe :
// un abonnement se résilie sans emporter le récurrent qui le porte, et un poste posé
// pour un seul mois ne doit pas traîner sur les suivants.
describe("Durée de vie d'une ligne de récurrent", () => {
  it("devrait considérer une ligne vivante seulement entre ses deux bornes", () => {
    const l = { startMonth: "2026-07", endMonth: "2026-08" };
    expect(isLineAlive(l, "2026-06")).toBe(false);
    expect(isLineAlive(l, "2026-07")).toBe(true);
    expect(isLineAlive(l, "2026-08")).toBe(true);
    expect(isLineAlive(l, "2026-09")).toBe(false);
    // Sans bornes, la ligne est permanente : c'est le cas de toutes celles créées
    // avant qu'une durée puisse se choisir.
    expect(isLineAlive({ startMonth: null, endMonth: null }, "2026-07")).toBe(true);
    expect(isLineAlive({ startMonth: "2026-07", endMonth: null }, "2030-01")).toBe(true);
  });

  it("devrait ne budgéter une ligne ponctuelle que le mois où elle vit", () => {
    const aboPonctuel: Group = {
      ...abo,
      lines: [
        { id: 11, name: "Spotify", amount: 10, day: 3 },
        { id: 12, name: "Assurance vacances", amount: 15, day: 8, startMonth: "2026-07", endMonth: "2026-07" },
      ],
    };
    const sections = hist([aboPonctuel], [], ["2026-06", "2026-07", "2026-08"], "2026-07");
    const row = sections.find((s) => s.kind === "recurring")!.rows[0];
    const ponctuelle = row.subRows.find((s) => s.id === 12)!;
    expect(ponctuelle.cells.map((c) => c.budgeted)).toEqual([0, 15, 0]);
    expect(ponctuelle.aliveMonths).toEqual([false, true, false]);
  });

  // Le budget d'un récurrent est la somme de ses lignes TELLES QU'ELLES VIVENT ce
  // mois-là : une ligne morte n'y compte plus, sinon le groupe garderait un budget
  // pour un poste qui n'existe plus.
  it("devrait retirer une ligne finie du budget de son récurrent", () => {
    const aboFini: Group = {
      ...abo,
      lines: [
        { id: 11, name: "Spotify", amount: 10, day: 3 },
        { id: 12, name: "Netflix", amount: 15, day: 8, startMonth: null, endMonth: "2026-07" },
      ],
    };
    const sections = hist([aboFini], [], ["2026-06", "2026-07", "2026-08"], "2026-07");
    const row = sections.find((s) => s.kind === "recurring")!.rows[0];
    expect(row.cells.map((c) => c.budgeted)).toEqual([25, 25, 10]);
  });
});

describe("Durée de vie d'un groupe", () => {
  it("devrait considérer un groupe actif seulement entre son mois de début et son mois de fin", () => {
    const g = { startMonth: "2026-07", endMonth: "2026-08" };
    expect(isGroupAlive(g, "2026-06")).toBe(false);
    expect(isGroupAlive(g, "2026-07")).toBe(true);
    expect(isGroupAlive(g, "2026-08")).toBe(true);
    expect(isGroupAlive(g, "2026-09")).toBe(false);
    expect(isGroupAlive({ startMonth: null, endMonth: null }, "2026-07")).toBe(true);
    expect(isGroupAlive({ startMonth: "2026-07", endMonth: null }, "2030-01")).toBe(true);
  });

  it("devrait donner un budget à un groupe ponctuel seulement le mois où il existe", () => {
    const ponctuel: Group = { ...courses, id: 50, name: "Cadeau", startMonth: "2026-07", endMonth: "2026-07" };
    const months = ["2026-06", "2026-07", "2026-08"];
    const sections = hist([ponctuel], [], months, "2026-07");
    const row = sections.flatMap((s) => s.rows).find((r) => r.id === 50)!;
    expect(row.cells[0].budgeted).toBe(0); // juin : pas encore actif
    expect(row.cells[1].budgeted).toBe(300); // juillet : actif
    expect(row.cells[2].budgeted).toBe(0); // août : plus actif
    expect(row.aliveMonths).toEqual([false, true, false]);
  });

  it("devrait cacher un groupe qui n'est actif sur aucun des mois affichés", () => {
    const futur: Group = { ...courses, id: 51, name: "Futur", startMonth: "2026-10", endMonth: null };
    const sections = hist([futur], [], ["2026-07", "2026-08"], "2026-07");
    expect(sections.flatMap((s) => s.rows).some((r) => r.id === 51)).toBe(false);
  });

  it("devrait renvoyer une transaction dans les non catégorisés quand elle tombe un mois où le groupe n'existe plus", () => {
    const ponctuel: Group = { ...courses, id: 52, name: "Cadeau", startMonth: "2026-07", endMonth: "2026-07" };
    const txn: Txn = { id: "t1", date: "2026-08-05", amount: -40, label: "x", accountId: "a1", groupId: 52 };
    const sections = hist([ponctuel], [txn], ["2026-07", "2026-08"], "2026-07");
    const uncatOut = sections.find((s) => s.kind === "uncategorized" && s.uncatDirection === "out");
    expect(uncatOut?.totals[1].depense).toBe(40); // août : la dépense retombe en non catégorisés
    const row = sections.flatMap((s) => s.rows).find((r) => r.id === 52)!;
    expect(row.cells[1].depense).toBe(0); // le groupe, plus actif, ne la porte pas
  });

  it("devrait mettre aussi à zéro les lignes d'un récurrent les mois où le groupe n'est pas actif", () => {
    const aboBorne: Group = { ...abo, id: 53, name: "Abonnements bornés", startMonth: "2026-07", endMonth: "2026-08" };
    const months = ["2026-06", "2026-07", "2026-08", "2026-09"];
    const sections = hist([aboBorne], [], months, "2026-07");
    const row = sections.flatMap((s) => s.rows).find((r) => r.id === 53)!;
    const spotify = row.subRows.find((s) => s.id === 11)!;
    const netflix = row.subRows.find((s) => s.id === 12)!;
    // La ligne du groupe : cohérente avec ses mois actifs (déjà couvert plus haut).
    expect(row.cells[0].budgeted).toBe(0); // juin : pas actif
    expect(row.cells[3].budgeted).toBe(0); // septembre : pas actif
    // Les lignes doivent suivre le même sort que la ligne du groupe.
    expect(spotify.cells[0].budgeted).toBe(0); // juin : pas actif
    expect(spotify.cells[1].budgeted).toBe(10); // juillet : actif
    expect(spotify.cells[2].budgeted).toBe(10); // août : actif
    expect(spotify.cells[3].budgeted).toBe(0); // septembre : pas actif
    expect(netflix.cells[0].budgeted).toBe(0); // juin : pas actif
    expect(netflix.cells[1].budgeted).toBe(15); // juillet : actif
    expect(netflix.cells[2].budgeted).toBe(15); // août : actif
    expect(netflix.cells[3].budgeted).toBe(0); // septembre : pas actif
  });

  it("devrait donner à une ligne sa propre vie, distincte de celle de son groupe : une ligne ajoutée après coup, dans un groupe qui n'est jamais mort, n'a pas de repère de changement à sa naissance", () => {
    // Abonnements n'a pas de startMonth : le groupe est vivant sur toute la
    // fenêtre. Netflix, elle, ne reçoit sa première entrée datée qu'en août —
    // exactement ce qui se passe quand une ligne est ajoutée en cours de route
    // (addGroupLine pose sa première entrée au mois choisi, pas au début du
    // groupe). Avant août, lineAmountInForce rend 0 : pas encore de budget, la
    // ligne n'existait pas, ce n'est pas un vrai changement.
    const months = ["2026-06", "2026-07", "2026-08"];
    const { dated, datedLines } = seedDated([abo]);
    const datedLinesNetflixLater = { ...datedLines, 12: [{ effectiveMonth: "2026-08", amount: 15 }] };
    const sections = computeHistory([abo], [], months, "2026-07", dated, datedLinesNetflixLater);
    const row = sections.flatMap((s) => s.rows).find((r) => r.id === 2)!;
    const netflix = row.subRows.find((s) => s.id === 12)!;
    expect(netflix.cells.map((c) => c.budgeted)).toEqual([0, 0, 15]);
    // Une ligne a sa vie propre, distincte de celle de son groupe : le groupe est
    // vivant partout, la ligne ne naît qu'en août. Confondre les deux ferait lire
    // le saut de 0 vers 15 comme une hausse alors que la ligne vient de naître.
    expect(row.aliveMonths).toEqual([true, true, true]);
    expect(netflix.aliveMonths).toEqual([false, false, true]);
  });

  it("devrait ne signaler aucun dépassement pour un groupe qui n'est plus actif", () => {
    const ponctuel: Group = { ...courses, id: 60, name: "Cadeau", startMonth: "2026-06", endMonth: "2026-06" };
    // dépense en juillet, un mois où le groupe n'est plus actif : elle est non catégorisée, pas un dépassement de groupe
    const txn: Txn = { id: "t1", date: "2026-07-10", amount: -500, label: "x", accountId: "a1", groupId: 60 };
    const r = over([ponctuel], [txn], "2026-07");
    expect(r.byMonth["2026-07"]?.some((p) => p.groupId === 60) ?? false).toBe(false);
  });

  it("devrait retirer la provision du dépassement non catégorisé", () => {
    const txns = [
      tx({ id: "a", date: "2026-06-05", amount: -300, label: "SANS GROUPE" }), // dépensé 300 sans groupe
      tx({ id: "b", date: "2026-06-06", amount: 40, label: "REMB" }), // reçu 40 -> net 260
    ];
    // Juin est ici le mois courant : c'est le seul qui se tranche encore.
    // Sans provision : dépassement = 260.
    const sans = over([], txns, "2026-06");
    expect(sans.byMonth["2026-06"]).toEqual([{ groupId: 0, lineId: null, name: "Non catégorisés", month: "2026-06", amount: 260, kind: "envelope" }]);
    // Provision de 100 en vigueur en juin (budget daté du groupe 0) : dépassement = 160.
    const dated = { 0: [{ effectiveMonth: "2026-06", amount: 100 }] };
    const avec = over([], txns, "2026-06", dated);
    expect(avec.byMonth["2026-06"]).toEqual([{ groupId: 0, lineId: null, name: "Non catégorisés", month: "2026-06", amount: 160, kind: "envelope" }]);
  });
});

// Ces deux règles pilotent à la fois les chaînes de solde et ce que le side panel
// affiche quand on ouvre une case de projection. Elles sont exportées justement
// pour que la grille ne les réécrive pas de son côté : si elles divergeaient, le
// détail n'additionnerait plus le chiffre de la case qu'il prétend expliquer.
describe("Ce qu'une ligne apporte au plan du mois", () => {
  const row = (p: Partial<HistoryRow>): HistoryRow => ({
    id: 1, name: "L", kind: "envelope", direction: "out", incomeKind: null,
    cells: [{ budgeted: 100, depense: 0, recu: 0, balance: 100 }],
    aliveMonths: [true], subRows: [], txns: [], ...p,
  });

  it("devrait projeter une rémunération principale sur tous les mois", () => {
    const r = row({ direction: "in", incomeKind: "principal", cells: [{ budgeted: 2000, depense: 0, recu: 0, balance: 0 }] });
    expect(rowRevenus(r, 0, true)).toBe(2000);
    expect(rowRevenus(r, 0, false)).toBe(2000);
  });

  it("ne devrait projeter une rémunération supplémentaire que sur le mois courant", () => {
    // Un coup de pouce ponctuel ne se parie pas sur les mois suivants.
    const r = row({ direction: "in", incomeKind: "supplementary", cells: [{ budgeted: 500, depense: 0, recu: 0, balance: 0 }] });
    expect(rowRevenus(r, 0, true)).toBe(500);
    expect(rowRevenus(r, 0, false)).toBe(0);
  });

  it("ne devrait attendre aucune rentrée d'une ligne de dépense", () => {
    expect(rowRevenus(row({}), 0, true)).toBe(0);
  });

  it("devrait mesurer le dépassement d'une dépense par la part sortie au-delà du budget", () => {
    expect(rowOverspend(row({ cells: [{ budgeted: 100, depense: 130, recu: 0, balance: -30 }] }), 0)).toBe(30);
  });

  it("ne devrait voir aucun dépassement quand la dépense reste dans le budget", () => {
    expect(rowOverspend(row({ cells: [{ budgeted: 100, depense: 80, recu: 0, balance: 20 }] }), 0)).toBe(0);
  });

  it("ne devrait jamais voir de dépassement sur une rentrée d'argent", () => {
    const r = row({ direction: "in", cells: [{ budgeted: 0, depense: 0, recu: 2000, balance: 0 }] });
    expect(rowOverspend(r, 0)).toBe(0);
  });

  it("devrait rester muet sur un mois hors de la plage plutôt que d'échouer", () => {
    // La grille interroge parfois l'index du mois courant alors qu'il est hors
    // fenêtre : mieux vaut 0 qu'une lecture de cellule inexistante.
    expect(rowOverspend(row({}), 5)).toBe(0);
  });
});

// La grille affichait ce calcul une seconde fois de son côté (resteVal). Ce test
// verrouille la règle ici, à sa place : la Balance stockée EST celle que le tableau
// montre, il n'y a plus qu'une seule vérité à maintenir.
describe("La Balance des non catégorisés, telle que le tableau la lit", () => {
  it("devrait valoir provision + reçus sans groupe − dépenses sans groupe", () => {
    const dated = { 0: [{ effectiveMonth: "2026-07", amount: 100 }] };
    const txns = [
      tx({ id: "a", date: "2026-07-05", amount: -180, label: "SANS GROUPE" }),
      tx({ id: "b", date: "2026-07-06", amount: 40, label: "REMBOURSEMENT" }),
    ];
    const sections = hist([], txns, ["2026-07"], "2026-07", dated);
    const out = sections.find((s) => s.kind === "uncategorized" && (s.uncatDirection ?? "out") === "out")!;
    const inSec = sections.find((s) => s.kind === "uncategorized" && s.uncatDirection === "in")!;
    // 100 de provision + 40 remboursés − 180 dépensés = −40.
    expect(out.totals[0].balance).toBeCloseTo(-40, 5);
    expect(out.totals[0].balance).toBeCloseTo(
      out.totals[0].budgeted + inSec.totals[0].recu - out.totals[0].depense,
      5,
    );
  });

  it("devrait laisser la Balance des reçus sans groupe à zéro : ils n'ont pas de budget", () => {
    const txns = [tx({ id: "b", date: "2026-07-06", amount: 40, label: "REMBOURSEMENT" })];
    const sections = hist([], txns, ["2026-07"], "2026-07");
    const inSec = sections.find((s) => s.kind === "uncategorized" && s.uncatDirection === "in")!;
    expect(inSec.totals[0].balance).toBe(0);
  });
});

// Le débordement des non catégorisés alimente à la fois la chaîne « si dépassement »,
// la ligne « Dépassement hors budget » et le rappel à trancher : une seule formule,
// testée une fois.
describe("Le débordement des dépenses sans groupe", () => {
  const sectionsOf = (dated?: { 0: { effectiveMonth: string; amount: number }[] }) =>
    computeHistory([], [
      tx({ id: "a", date: "2026-07-05", amount: -180, label: "SANS GROUPE" }),
      tx({ id: "b", date: "2026-07-06", amount: 40, label: "REMBOURSEMENT" }),
    ], ["2026-07"], "2026-07", dated);

  it("devrait compter ce qui est sorti au-delà des remboursements et de la provision", () => {
    // 180 sortis, 40 remboursés, 100 de provision -> 40 de débordement.
    expect(uncatOverspend(sectionsOf({ 0: [{ effectiveMonth: "2026-07", amount: 100 }] }), 0)).toBeCloseTo(40, 5);
  });

  it("devrait retomber à zéro quand la provision et les remboursements couvrent tout", () => {
    expect(uncatOverspend(sectionsOf({ 0: [{ effectiveMonth: "2026-07", amount: 200 }] }), 0)).toBe(0);
  });

  it("devrait tout compter comme débordement quand aucune provision n'est posée", () => {
    expect(uncatOverspend(sectionsOf(), 0)).toBeCloseTo(140, 5);
  });

  it("devrait donner le même résultat à partir des deux totaux directement", () => {
    // La grille appelle cette forme-là : les deux chemins doivent coïncider, sinon
    // la case et son explication afficheraient deux chiffres différents.
    const sections = sectionsOf({ 0: [{ effectiveMonth: "2026-07", amount: 100 }] });
    const out = sections.find((s) => s.kind === "uncategorized" && (s.uncatDirection ?? "out") === "out")!;
    const inSec = sections.find((s) => s.kind === "uncategorized" && s.uncatDirection === "in")!;
    expect(uncatOverspendOf(out.totals[0], inSec.totals[0])).toBeCloseTo(uncatOverspend(sections, 0), 5);
  });

  it("ne devrait rien voir déborder quand il n'y a aucune dépense sans groupe", () => {
    expect(uncatOverspendOf(undefined, undefined)).toBe(0);
  });
});

describe("montant en vigueur", () => {
  const spotify = { id: 11, name: "Spotify", amount: 10, day: 3 };
  const netflix = { id: 12, name: "Netflix", amount: 15, day: 8 };
  const recurrent: Group = {
    id: 2, accountId: "a1", name: "Abonnements", direction: "out", kind: "recurring",
    monthlyAmount: null, lines: [spotify, netflix], startMonth: "2026-01", endMonth: null,
  };
  const enveloppe: Group = {
    id: 1, accountId: "a1", name: "Courses", direction: "out", kind: "envelope",
    monthlyAmount: 300, lines: [], startMonth: "2026-01", endMonth: null,
  };

  it("rend 0 quand aucune entrée n'existe", () => {
    expect(budgetInForce(enveloppe, "2026-07", {}, {})).toBe(0);
    expect(lineAmountInForce(11, "2026-07", {})).toBe(0);
  });

  it("rend 0 pour les mois antérieurs à la première entrée", () => {
    const { dated, datedLines } = seedDated([enveloppe]);
    expect(budgetInForce(enveloppe, "2025-12", dated, datedLines)).toBe(0);
    expect(budgetInForce(enveloppe, "2026-01", dated, datedLines)).toBe(300);
  });

  it("rend la dernière entrée dont le mois est atteint", () => {
    const dated = toDatedBudgets([
      { groupId: 1, effectiveMonth: "2026-01", amount: 300 },
      { groupId: 1, effectiveMonth: "2026-08", amount: 400 },
      { groupId: 1, effectiveMonth: "2026-11", amount: 450 },
    ]);
    expect(budgetInForce(enveloppe, "2026-07", dated, {})).toBe(300);
    expect(budgetInForce(enveloppe, "2026-08", dated, {})).toBe(400);
    expect(budgetInForce(enveloppe, "2026-10", dated, {})).toBe(400);
    expect(budgetInForce(enveloppe, "2026-11", dated, {})).toBe(450);
  });

  it("fait du budget d'un récurrent la somme de ses lignes du mois", () => {
    const { dated, datedLines } = seedDated([recurrent]);
    expect(budgetInForce(recurrent, "2026-07", dated, datedLines)).toBe(25);
  });

  it("suit une hausse posée sur une seule ligne", () => {
    const datedLines = toDatedLineAmounts([
      { lineId: 11, effectiveMonth: "2026-01", amount: 10 },
      { lineId: 12, effectiveMonth: "2026-01", amount: 15 },
      { lineId: 12, effectiveMonth: "2026-08", amount: 20 },
    ]);
    expect(budgetInForce(recurrent, "2026-07", {}, datedLines)).toBe(25);
    expect(budgetInForce(recurrent, "2026-08", {}, datedLines)).toBe(30);
    expect(lineAmountInForce(12, "2026-08", datedLines)).toBe(20);
  });

  it("ignore un montant daté posé sur un groupe récurrent", () => {
    const dated = toDatedBudgets([{ groupId: 2, effectiveMonth: "2026-01", amount: 999 }]);
    const { datedLines } = seedDated([recurrent]);
    expect(budgetInForce(recurrent, "2026-07", dated, datedLines)).toBe(25);
  });

  it("compte une ligne créée après le départ du groupe seulement à partir de son entrée", () => {
    const datedLines = toDatedLineAmounts([
      { lineId: 11, effectiveMonth: "2026-01", amount: 10 },
      { lineId: 12, effectiveMonth: "2026-06", amount: 15 },
    ]);
    expect(budgetInForce(recurrent, "2026-05", {}, datedLines)).toBe(10);
    expect(budgetInForce(recurrent, "2026-06", {}, datedLines)).toBe(25);
  });

  it("date le budget des lignes affichées d'un récurrent", () => {
    const datedLines = toDatedLineAmounts([
      { lineId: 11, effectiveMonth: "2026-01", amount: 10 },
      { lineId: 12, effectiveMonth: "2026-01", amount: 15 },
      { lineId: 12, effectiveMonth: "2026-08", amount: 20 },
    ]);
    const sections = computeHistory([recurrent], [], ["2026-07", "2026-08"], "2026-07", {}, datedLines);
    const row = sections.flatMap((s) => s.rows).find((r) => r.id === 2)!;
    const netflix = row.subRows.find((sr) => sr.id === 12)!;
    expect(netflix.cells.map((c) => c.budgeted)).toEqual([15, 20]);
    expect(row.cells.map((c) => c.budgeted)).toEqual([25, 30]);
  });

  it("voit un dépassement disparaître quand la ligne est relevée", () => {
    // Le dépassement d'un récurrent se lit sur le total de ses lignes (budgetInForce
    // additionne tout le groupe) : Spotify est payée pile son budget (10) les deux
    // mois, seule Netflix bouge. Le total budgété suit donc exactement Netflix.
    const txns = [
      tx({ id: "s1", date: "2026-07-03", amount: -10, label: "SPOTIFY", groupId: 2, lineId: 11 }),
      tx({ id: "a", date: "2026-07-08", amount: -20, label: "NETFLIX", groupId: 2, lineId: 12 }),
      tx({ id: "s2", date: "2026-08-03", amount: -10, label: "SPOTIFY", groupId: 2, lineId: 11 }),
      tx({ id: "b", date: "2026-08-08", amount: -20, label: "NETFLIX", groupId: 2, lineId: 12 }),
    ];
    const datedLines = toDatedLineAmounts([
      { lineId: 11, effectiveMonth: "2026-01", amount: 10 },
      { lineId: 12, effectiveMonth: "2026-01", amount: 15 },
      { lineId: 12, effectiveMonth: "2026-08", amount: 20 },
    ]);
    // C'est Netflix qui déborde de 5 en juillet (20 dépensés pour 15 budgétés) : le
    // rappel porte son nom, pas celui du groupe. Spotify, payée pile son budget, ne
    // remonte pas.
    const enJuillet = computeOverspends([recurrent], txns, "2026-07", {}, datedLines);
    expect(enJuillet.byMonth["2026-07"]).toEqual([
      { groupId: 2, lineId: 12, name: "Netflix", month: "2026-07", amount: 5, kind: "recurring" },
    ]);
    // Vu depuis août, la ligne relevée a absorbé la dépense : plus aucun dépassement en
    // août. Celui de juillet, lui, a bien eu lieu et reste signalé — c'est un fait, pas
    // une question en attente.
    const enAout = computeOverspends([recurrent], txns, "2026-08", {}, datedLines);
    expect(enAout.byMonth["2026-08"]).toBeUndefined();
    expect(enAout.byMonth["2026-07"]).toHaveLength(1);
  });
});

// Budgets en vigueur pour chaque mois affiché, table plate franchissant la frontière
// serveur/client. Le budget d'un mois ne se déduit pas de celui d'un autre : chaque
// mois a le sien, et c'est bien un budget PAR MOIS qu'il faut transmettre.
describe("budgets par mois", () => {
  const courses: Group = {
    id: 1, accountId: "a1", name: "Courses", direction: "out", kind: "envelope",
    monthlyAmount: null, lines: [], startMonth: "2026-01", endMonth: null,
  };
  const abo: Group = {
    id: 2, accountId: "a1", name: "Abonnements", direction: "out", kind: "recurring",
    monthlyAmount: null, startMonth: "2026-01", endMonth: null,
    lines: [{ id: 11, name: "Spotify", amount: 10, day: 3 }],
  };
  // Budget relevé de 300 à 500 en juin : trancher un dépassement de mars doit
  // proposer 300, pas 500.
  const dated = toDatedBudgets([
    { groupId: 1, effectiveMonth: "2026-01", amount: 300 },
    { groupId: 1, effectiveMonth: "2026-06", amount: 500 },
    { groupId: 0, effectiveMonth: "2026-01", amount: 20 },
    { groupId: 0, effectiveMonth: "2026-06", amount: 40 },
  ]);
  const datedLines = toDatedLineAmounts([
    { lineId: 11, effectiveMonth: "2026-01", amount: 10 },
    { lineId: 11, effectiveMonth: "2026-06", amount: 15 },
  ]);

  it("rend le budget du mois demandé, pas celui du mois courant", () => {
    const b = budgetsByMonth([courses], ["2026-03", "2026-07"], dated, datedLines);
    expect(b[budgetKey(1, "2026-03")]).toBe(300);
    expect(b[budgetKey(1, "2026-07")]).toBe(500);
  });

  it("couvre la provision des non catégorisés au même titre", () => {
    const b = budgetsByMonth([], ["2026-03", "2026-07"], dated, datedLines);
    expect(b[budgetKey(0, "2026-03")]).toBe(20);
    expect(b[budgetKey(0, "2026-07")]).toBe(40);
  });

  it("somme les lignes du mois demandé pour un récurrent", () => {
    const b = budgetsByMonth([abo], ["2026-03", "2026-07"], dated, datedLines);
    expect(b[budgetKey(2, "2026-03")]).toBe(10);
    expect(b[budgetKey(2, "2026-07")]).toBe(15);
  });

  it("ne rend rien pour un mois qu'on ne lui a pas demandé", () => {
    const b = budgetsByMonth([courses], ["2026-03"], dated, datedLines);
    expect(b[budgetKey(1, "2026-07")]).toBeUndefined();
  });

  it("dédoublonne les mois demandés deux fois", () => {
    const b = budgetsByMonth([courses], ["2026-03", "2026-03"], dated, datedLines);
    expect(Object.keys(b).filter((k) => k.startsWith("1::"))).toEqual([budgetKey(1, "2026-03")]);
  });
});
