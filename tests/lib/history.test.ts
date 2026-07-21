import { expect, describe, it } from "vitest";
import { computeHistory, monthsWithData, nextMonthKey, grandTotals, monthlyOverspend, addMonthsKey, monthRange, isMonthKey, clampMonth, monthsDiff, computeSolde, computePlannedSoldes, budgetInForce, toDatedBudgets, computeOverspends, onceBudgetWrites } from "../../src/lib/history";
import { isGroupAlive, type Group, type Txn } from "../../src/lib/forecast";

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

describe("Montants affichés dans le tableau de l'historique", () => {
  it("devrait afficher, pour chaque groupe, ce qui a été dépensé chaque mois", () => {
    const txns = [
      tx({ id: "1", date: "2026-06-10", amount: -120, label: "CARREFOUR", groupId: 1 }),
      tx({ id: "2", date: "2026-07-10", amount: -50, label: "CARREFOUR", groupId: 1 }),
      tx({ id: "3", date: "2026-07-15", amount: -30, label: "CARREFOUR", groupId: 1 }),
    ];
    const sections = computeHistory([courses], txns, ["2026-06", "2026-07"], "2026-07");
    const row = sections[0].rows[0];
    expect(row.cells[0].depense).toBe(120); // juin
    expect(row.cells[1].depense).toBe(80); // juillet 50 + 30
  });

  it("devrait budgéter une enveloppe par son montant mensuel, un récurrent par la somme de ses lignes, et afficher le reste", () => {
    const txns = [tx({ id: "1", date: "2026-07-10", amount: -120, label: "CARREFOUR", groupId: 1 })];
    const sections = computeHistory([courses, abo], txns, ["2026-07"], "2026-07");
    const env = sections.find((s) => s.kind === "envelope")!.rows[0];
    const rec = sections.find((s) => s.kind === "recurring")!.rows[0];
    expect(env.cells[0]).toEqual({ budgeted: 300, depense: 120, recu: 0, balance: 180 });
    expect(rec.cells[0].budgeted).toBe(25); // 10 + 15
  });

  it("devrait ignorer les transactions exclues", () => {
    const txns = [tx({ id: "1", date: "2026-07-10", amount: -120, label: "CARREFOUR", excluded: true })];
    const sections = computeHistory([courses], txns, ["2026-07"], "2026-07");
    expect(sections[0].rows[0].cells[0].depense).toBe(0);
  });

  it("devrait additionner les groupes d'une section dans le total de cette section", () => {
    const courses2: Group = { ...courses, id: 3, name: "Courses2", monthlyAmount: 100 };
    const txns = [
      tx({ id: "1", date: "2026-07-10", amount: -120, label: "CARREFOUR", groupId: 1 }),
      tx({ id: "2", date: "2026-07-10", amount: -40, label: "LECLERC", groupId: 3 }),
    ];
    const sections = computeHistory([courses, courses2], txns, ["2026-07"], "2026-07");
    expect(sections[0].totals[0]).toEqual({ budgeted: 400, depense: 160, recu: 0, balance: 240 });
  });

  it("devrait compter une rémunération comme argent reçu, jamais comme une dépense", () => {
    const income: Group = { id: 9, accountId: "a1", name: "Salaire", direction: "in", kind: "envelope", monthlyAmount: 2000, lines: [] };
    const txns = [tx({ id: "1", date: "2026-07-01", amount: 2000, label: "VIR REMU", groupId: 9 })];
    const sections = computeHistory([income], txns, ["2026-07"], "2026-07");
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
    const sections = computeHistory([remu, abo], txns, ["2026-07"], "2026-07");
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
    const sections = computeHistory([remuRec, remuEnv, courses], txns, ["2026-07"], "2026-07");
    // Bloc rémunérations en tête, la principale avant la supplémentaire.
    expect(sections[0].kind).toBe("income");
    expect(sections[0].rows.map((r) => r.name)).toEqual(["Salaire", "Prime"]);
    // Le seul groupe récurrent était une rémunération : plus de bloc récurrent.
    expect(sections.find((s) => s.kind === "recurring")).toBeUndefined();
    // Le bloc enveloppe ne garde que la dépense.
    const env = sections.find((s) => s.kind === "envelope")!;
    expect(env.rows.map((r) => r.name)).toEqual(["Courses"]);
  });

  it("devrait laisser un reste à zéro pour les non catégorisés, qui n'ont pas de budget", () => {
    const txns = [
      tx({ id: "1", date: "2026-07-01", amount: 500, label: "DIVERS", groupId: null }),
      tx({ id: "2", date: "2026-07-05", amount: -80, label: "DIVERS2", groupId: null }),
    ];
    const sections = computeHistory([], txns, ["2026-07"], "2026-07");
    const uncat = sections.find((s) => s.kind === "uncategorized")!;
    expect(uncat.totals[0].balance).toBe(0);
  });

  it("devrait laisser un mois à venir sans dépense, avec tout le budget encore disponible", () => {
    const txns = [tx({ id: "1", date: "2026-07-10", amount: -120, label: "CARREFOUR", groupId: 1 })];
    const sections = computeHistory([courses], txns, ["2026-07", "2026-08"], "2026-07");
    const row = sections[0].rows[0];
    expect(row.cells[0]).toEqual({ budgeted: 300, depense: 120, recu: 0, balance: 180 }); // juillet, réel
    expect(row.cells[1]).toEqual({ budgeted: 300, depense: 0, recu: 0, balance: 300 }); // août : rien dépensé encore
  });

  it("devrait garder un dépassement du mois en cours hors des cellules des mois futurs", () => {
    // Le dépassement est gardé dans les chaînes du prévisionnel, pas dans les cellules du tableau.
    const txns = [tx({ id: "1", date: "2026-07-10", amount: -450, label: "CARREFOUR", groupId: 1 })]; // 450 > 300
    const sections = computeHistory([courses], txns, ["2026-07", "2026-08"], "2026-07");
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
    const sections = computeHistory([courses, income], txns, ["2026-07"], "2026-07");
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
    const sections = computeHistory([courses, c2, income], txns, ["2026-07"], "2026-07");
    expect(monthlyOverspend(sections, 1)).toEqual([150]);
  });

  it("devrait ne pas compter la rémunération principale comme reçue dans le futur, mais continuer d'afficher son montant attendu", () => {
    const principal: Group = {
      id: 30, accountId: "a1", name: "Rémunération principale", direction: "in",
      kind: "envelope", monthlyAmount: 2000, lines: [], incomeKind: "principal",
    };
    const sections = computeHistory([principal], [], ["2026-07", "2026-08"], "2026-07");
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
    const sections = computeHistory([supp], [], ["2026-07", "2026-08"], "2026-07");
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
    const sections = computeHistory([principal, supplementaire], [], ["2026-07"], "2026-07");
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
    const sections = computeHistory([abo], txns, ["2026-07"], "2026-07");
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
    const sections = computeHistory([abo], txns, ["2026-07"], "2026-07");
    const netflix = sections.find((s) => s.kind === "recurring")!.rows[0].subRows.find((s) => s.id === 12)!;
    expect(netflix.txns.map((t) => t.id)).toEqual(["1"]);
    expect(netflix.cells[0].depense).toBe(15);
  });

  it("devrait afficher les transactions d'une enveloppe directement sous le groupe, sans sous-ligne", () => {
    const txns = [tx({ id: "1", date: "2026-07-10", amount: -120, label: "CARREFOUR", groupId: 1 })];
    const sections = computeHistory([courses], txns, ["2026-07"], "2026-07");
    const env = sections[0].rows[0];
    expect(env.subRows).toEqual([]);
    expect(env.txns.map((t) => t.id)).toEqual(["1"]);
  });

  it("devrait laisser une transaction de récurrent sans ligne correspondante directement sous le groupe", () => {
    const txns = [tx({ id: "1", date: "2026-07-10", amount: -40, label: "ACHAT INCONNU", groupId: 2 })];
    const sections = computeHistory([abo], txns, ["2026-07"], "2026-07");
    const rec = sections.find((s) => s.kind === "recurring")!.rows[0];
    expect(rec.txns.map((t) => t.id)).toEqual(["1"]);
    expect(rec.subRows.every((s) => s.txns.length === 0)).toBe(true);
  });

  it("devrait masquer les sections vides", () => {
    const txns = [tx({ id: "1", date: "2026-07-10", amount: -120, label: "CARREFOUR", groupId: 1 })];
    const sections = computeHistory([courses], txns, ["2026-07"], "2026-07");
    expect(sections.map((s) => s.kind)).toEqual(["envelope"]);
  });

  it("devrait séparer les transactions sans groupe en deux blocs : l'argent qui entre et l'argent qui sort", () => {
    const txns = [
      tx({ id: "1", date: "2026-07-05", amount: -40, label: "ACHAT X" }), // non catégorisée, qui sort
      tx({ id: "2", date: "2026-07-06", amount: 100, label: "REMBOURSEMENT" }), // non catégorisée, qui entre
      tx({ id: "3", date: "2026-07-07", amount: -25, label: "CARREFOUR", groupId: 1 }), // catégorisée
    ];
    const sections = computeHistory([courses], txns, ["2026-07"], "2026-07");
    const uncatIn = sections.find((s) => s.kind === "uncategorized" && s.uncatDirection === "in")!;
    const uncatOut = sections.find((s) => s.kind === "uncategorized" && s.uncatDirection === "out")!;
    // L'argent qui entre dans le bloc « in » (affiché sous les rémunérations)…
    expect(uncatIn.txns!.map((t) => t.id)).toEqual(["2"]);
    expect(uncatIn.totals[0]).toEqual({ budgeted: 0, depense: 0, recu: 100, balance: 0 });
    // … et l'argent qui sort dans le bloc « out » (après les enveloppes).
    expect(uncatOut.txns!.map((t) => t.id)).toEqual(["1"]);
    expect(uncatOut.totals[0]).toEqual({ budgeted: 0, depense: 40, recu: 0, balance: 0 });
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
    const sections = computeHistory([courses], txns, ["2026-07"], "2026-07");
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
    const sections = computeHistory([salaire, courses], txns, months, "2026-07");
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
    const sections = computeHistory([salaire, courses], txns, months, "2026-07");
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
    const sections = computeHistory([salaire, courses], txns, months, "2026-07");
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
    const sections = computeHistory([salaire, courses], txns, months, "2026-07");
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
    const sections = computeHistory([principal, courses2], txns, months, "2026-07");
    const solde = computeSolde(sections, months, "2026-07", 5000);
    const p = computePlannedSoldes(sections, months, "2026-07", solde.openings);
    const open = solde.openings[0]; // argent de départ réel du mois courant
    // Mois courant : prévu = open + 2000 − 300 ; ligne dépassement = prévu − 50.
    expect(p.prevuClosings[0]).toBeCloseTo(open + 2000 - 300, 2);
    expect(p.depassClosings[0]).toBeCloseTo(open + 2000 - 300 - 50, 2);
    // Mois futur : chaîné depuis la clôture du mois courant (même net prévu).
    expect(p.prevuClosings[1]).toBeCloseTo((open + 2000 - 300) + (2000 - 300), 2);
    expect(p.depassClosings[1]).toBeCloseTo((open + 2000 - 300 - 50) + (2000 - 300 - 50), 2);
    // Avec l'estimation de fin du mois courant : le premier mois futur repart de là.
    const pe = computePlannedSoldes(sections, months, "2026-07", solde.openings, 4200);
    expect(pe.prevuClosings[0]).toBeCloseTo(open + 2000 - 300, 2); // mois courant inchangé
    expect(pe.prevuClosings[1]).toBeCloseTo(4200 + (2000 - 300), 2);
    expect(pe.depassClosings[1]).toBeCloseTo(4200 + (2000 - 300 - 50), 2);
  });

  it("devrait faire baisser la ligne des dépassements avec l'argent dépensé sans groupe, l'argent reçu sans groupe n'y changeant rien", () => {
    // 500 dépensés sans groupe, 200 reçus sans groupe -> débordement net 300.
    const txns = [
      tx({ id: "a", date: "2026-07-05", amount: -500, label: "ACHAT X" }),
      tx({ id: "b", date: "2026-07-06", amount: 200, label: "REMBOURSEMENT" }),
    ];
    const months = ["2026-07", "2026-08"];
    const sections = computeHistory([], txns, months, "2026-07");
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
    // Maintenu sur le mois futur.
    expect(p.depassClosings[1]).toBeCloseTo((p.depassClosings[0] ?? 0) - 300, 2);
  });

  it("devrait compter la rémunération supplémentaire dans le mois en cours, mais ne jamais la projeter dans le futur", () => {
    const supp: Group = { id: 3, accountId: "a1", name: "Rémunération supplémentaire", direction: "in", kind: "envelope", monthlyAmount: 500, lines: [], incomeKind: "supplementary" };
    const months = ["2026-07", "2026-08"];
    const sections = computeHistory([supp], [], months, "2026-07");
    const solde = computeSolde(sections, months, "2026-07", 1000);
    const p = computePlannedSoldes(sections, months, "2026-07", solde.openings);
    const open = solde.openings[0];
    expect(p.prevuClosings[0]).toBeCloseTo(open + 500, 2); // courant : +500
    expect(p.prevuClosings[1]).toBeCloseTo(open + 500, 2); // futur : +0 (pas de projection)
  });

  it("devrait reporter un dépassement non tranché sur les mois suivants, et l'oublier une fois tranché", () => {
    const principal: Group = { id: 1, accountId: "a1", name: "Rémunération principale", direction: "in", kind: "envelope", monthlyAmount: 2000, lines: [], incomeKind: "principal" };
    const courses2: Group = { id: 2, accountId: "a1", name: "Courses", direction: "out", kind: "envelope", monthlyAmount: 300, lines: [], incomeKind: null };
    const txns = [
      tx({ id: "s", date: "2026-07-01", amount: 2000, label: "REMU", groupId: 1 }),
      tx({ id: "c", date: "2026-07-10", amount: -350, label: "CARREFOUR", groupId: 2 }), // dépassement courant : 50
    ];
    const months = ["2026-07", "2026-08"];
    const sections = computeHistory([principal, courses2], txns, months, "2026-07");
    const solde = computeSolde(sections, months, "2026-07", 5000);
    const open = solde.openings[0];
    // Non tranché : 50 est retenu -> août le soustrait (comme avant).
    const pending = computePlannedSoldes(sections, months, "2026-07", solde.openings, null, { byGroup: { 2: 50 }, uncat: 0 });
    expect(pending.depassClosings[1]).toBeCloseTo((open + 2000 - 300 - 50) + (2000 - 300 - 50), 2);
    // Tranché (exceptionnel) : plus rien de retenu -> août ne soustrait plus rien.
    const decided = computePlannedSoldes(sections, months, "2026-07", solde.openings, null, { byGroup: {}, uncat: 0 });
    expect(decided.depassClosings[1]).toBeCloseTo((open + 2000 - 300 - 50) + (2000 - 300), 2);
    // Le mois courant reste factuel dans les deux cas (dépassement réel de 50).
    expect(decided.depassClosings[0]).toBeCloseTo(open + 2000 - 300 - 50, 2);
  });
});

describe("Budgets qui changent à partir d'un mois donné", () => {
  it("devrait appliquer le budget en vigueur mois par mois, sans toucher aux mois d'avant", () => {
    const dated = { 1: [{ effectiveMonth: "2026-08", amount: 400 }] };
    const txns = [tx({ id: "1", date: "2026-07-10", amount: -350, label: "CARREFOUR", groupId: 1 })];
    const sections = computeHistory([courses], txns, ["2026-07", "2026-08"], "2026-07", dated);
    const row = sections[0].rows[0];
    // Juillet garde l'ancien budget (300) : le dépassement de 50 reste visible.
    expect(row.cells[0]).toEqual({ budgeted: 300, depense: 350, recu: 0, balance: -50 });
    // Août applique le nouveau budget (400), rien de dépensé encore.
    expect(row.cells[1]).toEqual({ budgeted: 400, depense: 0, recu: 0, balance: 400 });
  });

  it("devrait prendre le dernier budget daté à cette date ou avant, et sinon revenir au montant de base", () => {
    const dated = { 1: [{ effectiveMonth: "2026-08", amount: 400 }, { effectiveMonth: "2026-10", amount: 450 }] };
    expect(budgetInForce(courses, "2026-07", dated)).toBe(300); // avant tout changement daté
    expect(budgetInForce(courses, "2026-08", dated)).toBe(400);
    expect(budgetInForce(courses, "2026-09", dated)).toBe(400);
    expect(budgetInForce(courses, "2026-11", dated)).toBe(450);
    expect(budgetInForce(courses, "2026-07")).toBe(300); // aucun changement daté
  });

  it("devrait regrouper les changements de budget par groupe, dans l'ordre des mois", () => {
    expect(
      toDatedBudgets([
        { groupId: 1, effectiveMonth: "2026-08", amount: 400 },
        { groupId: 2, effectiveMonth: "2026-09", amount: 50 },
        { groupId: 1, effectiveMonth: "2026-10", amount: 450 },
      ]),
    ).toEqual({ 1: [{ effectiveMonth: "2026-08", amount: 400 }, { effectiveMonth: "2026-10", amount: 450 }], 2: [{ effectiveMonth: "2026-09", amount: 50 }] });
  });
});

describe("Changer un budget pour un seul mois", () => {
  const BASE = 100;

  it("devrait poser le nouveau montant sur le mois choisi et remettre le montant de base le mois suivant", () => {
    const { writes } = onceBudgetWrites([], BASE, "2026-08", 150);
    expect(writes).toEqual([
      { effectiveMonth: "2026-08", amount: 150 },
      { effectiveMonth: "2026-09", amount: 100 },
    ]);
  });

  it("devrait laisser le mois suivant sur le montant de base quand on remodifie le même mois", () => {
    // État après le premier changement : un montant ponctuel à 2026-08 et la base remise à 2026-09.
    const existing = [
      { effectiveMonth: "2026-08", amount: 150 },
      { effectiveMonth: "2026-09", amount: 100 },
    ];
    const { writes } = onceBudgetWrites(existing, BASE, "2026-08", 200);
    // Le mois est réécrit ; 2026-09 existe déjà → pas d'écriture, il garde la base 100
    // (l'ancien comportement aurait restauré 150, corrompant le mois suivant).
    expect(writes).toEqual([{ effectiveMonth: "2026-08", amount: 200 }]);
    expect(writes.some((w) => w.effectiveMonth === "2026-09")).toBe(false);
  });

  it("devrait ne pas écraser un changement de budget déjà prévu pour le mois suivant", () => {
    // Un vrai changement futur posé à 2026-09 (500), rien à 2026-08.
    const existing = [{ effectiveMonth: "2026-09", amount: 500 }];
    const { writes } = onceBudgetWrites(existing, BASE, "2026-08", 150);
    expect(writes).toEqual([{ effectiveMonth: "2026-08", amount: 150 }]);
    expect(writes.some((w) => w.effectiveMonth === "2026-09")).toBe(false);
  });

  it("devrait remettre le mois suivant au montant qui était vraiment en vigueur, pas au montant de base", () => {
    // Une hausse durable à 2026-05 (300) ; un changement d'un mois à 2026-08 doit laisser
    // le mois suivant revenir à 300 (le montant en vigueur), pas à la base.
    const existing = [{ effectiveMonth: "2026-05", amount: 300 }];
    const { writes } = onceBudgetWrites(existing, BASE, "2026-08", 150);
    expect(writes).toEqual([
      { effectiveMonth: "2026-08", amount: 150 },
      { effectiveMonth: "2026-09", amount: 300 },
    ]);
  });
});

describe("Rappels d'argent dépensé au-delà du budget", () => {
  it("devrait lister les dépassements non tranchés des mois terminés et retenir le plus récent pour le prévisionnel", () => {
    const txns = [
      tx({ id: "1", date: "2026-06-10", amount: -350, label: "CARREFOUR", groupId: 1 }), // juin : dépassement 50
      tx({ id: "2", date: "2026-07-10", amount: -380, label: "CARREFOUR", groupId: 1 }), // juillet (courant) : dépassement 80
      tx({ id: "3", date: "2026-06-05", amount: -120, label: "SANS GROUPE" }), // uncat juin : 120 dépensés
      tx({ id: "4", date: "2026-06-06", amount: 40, label: "REMBOURSEMENT" }), // uncat juin : 40 reçus -> net 80
    ];
    const r = computeOverspends([courses], txns, "2026-07", []);
    // Mois terminés, non tranchés : Courses juin (50) et Non catégorisés juin (80).
    expect(r.pendingClosed).toEqual([
      { groupId: 1, name: "Courses", month: "2026-06", amount: 50 },
      { groupId: 0, name: "Non catégorisés", month: "2026-06", amount: 80 },
    ]);
    // Retenu pour le prévisionnel : le plus récent non tranché de Courses = juillet (80).
    expect(r.retained.byGroup[1]).toBe(80);
    expect(r.retained.uncat).toBe(80); // juin, seul mois uncat non tranché
    // Pastilles : un dépassement non tranché par élément (le plus récent), mois courant
    // inclus — Courses pointe sur juillet (80, le mois courant), les non catégorisés sur juin.
    expect(r.pending).toEqual([
      { groupId: 0, name: "Non catégorisés", month: "2026-06", amount: 80 },
      { groupId: 1, name: "Courses", month: "2026-07", amount: 80 },
    ]);
  });

  it("devrait retirer un dépassement des rappels et du prévisionnel une fois qu'il est tranché", () => {
    const txns = [
      tx({ id: "1", date: "2026-06-10", amount: -350, label: "CARREFOUR", groupId: 1 }),
      tx({ id: "2", date: "2026-07-10", amount: -380, label: "CARREFOUR", groupId: 1 }),
    ];
    // Juillet tranché : il ne reste que juin, à la fois en attente (mois terminé) et retenu.
    const r = computeOverspends([courses], txns, "2026-07", [{ groupId: 1, month: "2026-07" }]);
    expect(r.pendingClosed).toEqual([{ groupId: 1, name: "Courses", month: "2026-06", amount: 50 }]);
    expect(r.retained.byGroup[1]).toBe(50);
    // Tout tranché : plus rien nulle part.
    const r2 = computeOverspends([courses], txns, "2026-07", [
      { groupId: 1, month: "2026-06" },
      { groupId: 1, month: "2026-07" },
    ]);
    expect(r2.pendingClosed).toEqual([]);
    expect(r2.retained.byGroup[1] ?? 0).toBe(0);
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
    const sections = computeHistory([ponctuel], [], months, "2026-07");
    const row = sections.flatMap((s) => s.rows).find((r) => r.id === 50)!;
    expect(row.cells[0].budgeted).toBe(0); // juin : pas encore actif
    expect(row.cells[1].budgeted).toBe(300); // juillet : actif
    expect(row.cells[2].budgeted).toBe(0); // août : plus actif
    expect(row.aliveMonths).toEqual([false, true, false]);
  });

  it("devrait cacher un groupe qui n'est actif sur aucun des mois affichés", () => {
    const futur: Group = { ...courses, id: 51, name: "Futur", startMonth: "2026-10", endMonth: null };
    const sections = computeHistory([futur], [], ["2026-07", "2026-08"], "2026-07");
    expect(sections.flatMap((s) => s.rows).some((r) => r.id === 51)).toBe(false);
  });

  it("devrait renvoyer une transaction dans les non catégorisés quand elle tombe un mois où le groupe n'existe plus", () => {
    const ponctuel: Group = { ...courses, id: 52, name: "Cadeau", startMonth: "2026-07", endMonth: "2026-07" };
    const txn: Txn = { id: "t1", date: "2026-08-05", amount: -40, label: "x", accountId: "a1", groupId: 52 };
    const sections = computeHistory([ponctuel], [txn], ["2026-07", "2026-08"], "2026-07");
    const uncatOut = sections.find((s) => s.kind === "uncategorized" && s.uncatDirection === "out");
    expect(uncatOut?.totals[1].depense).toBe(40); // août : la dépense retombe en non catégorisés
    const row = sections.flatMap((s) => s.rows).find((r) => r.id === 52)!;
    expect(row.cells[1].depense).toBe(0); // le groupe, plus actif, ne la porte pas
  });

  it("devrait mettre aussi à zéro les lignes d'un récurrent les mois où le groupe n'est pas actif", () => {
    const aboBorne: Group = { ...abo, id: 53, name: "Abonnements bornés", startMonth: "2026-07", endMonth: "2026-08" };
    const months = ["2026-06", "2026-07", "2026-08", "2026-09"];
    const sections = computeHistory([aboBorne], [], months, "2026-07");
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

  it("devrait ne signaler aucun dépassement pour un groupe qui n'est plus actif", () => {
    const ponctuel: Group = { ...courses, id: 60, name: "Cadeau", startMonth: "2026-06", endMonth: "2026-06" };
    // dépense en juillet, un mois où le groupe n'est plus actif : elle est non catégorisée, pas un dépassement de groupe
    const txn: Txn = { id: "t1", date: "2026-07-10", amount: -500, label: "x", accountId: "a1", groupId: 60 };
    const r = computeOverspends([ponctuel], [txn], "2026-07", []);
    expect(r.retained.byGroup[60]).toBeUndefined();
  });
});
