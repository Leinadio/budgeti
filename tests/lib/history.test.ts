import { expect, test } from "vitest";
import { computeHistory, monthsWithData, nextMonthKey, grandTotals, monthlyOverspend, addMonthsKey, monthRange, isMonthKey, clampMonth, monthsDiff, computeSolde, computePlannedSoldes, budgetInForce, toDatedBudgets } from "../../src/lib/history";
import type { Group, Txn } from "../../src/lib/forecast";

const courses: Group = {
  id: 1, accountId: "a1", name: "Courses", direction: "out", kind: "envelope",
  monthlyAmount: 300, keywords: ["CARREFOUR"], lines: [],
};
const abo: Group = {
  id: 2, accountId: "a1", name: "Abonnements", direction: "out", kind: "recurring",
  monthlyAmount: null, keywords: [],
  lines: [
    { id: 11, name: "Spotify", amount: 10, day: 3, keyword: "SPOTIFY" },
    { id: 12, name: "Netflix", amount: 15, day: 8, keyword: "NETFLIX" },
  ],
};

function tx(p: Partial<Txn>): Txn {
  return { id: "t", date: "2026-07-05", amount: -10, label: "", accountId: "a1", groupId: null, ...p };
}

test("monthsWithData returns distinct sorted months", () => {
  const txns = [tx({ date: "2026-07-05" }), tx({ date: "2026-06-20" }), tx({ date: "2026-07-28" }), tx({ date: "2026-05-01" })];
  expect(monthsWithData(txns)).toEqual(["2026-05", "2026-06", "2026-07"]);
});

test("spent is summed per group and per month", () => {
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

test("budgeted: envelope monthlyAmount, recurring sum of lines; balance = budgeted - spent", () => {
  const txns = [tx({ id: "1", date: "2026-07-10", amount: -120, label: "CARREFOUR", groupId: 1 })];
  const sections = computeHistory([courses, abo], txns, ["2026-07"], "2026-07");
  const env = sections.find((s) => s.kind === "envelope")!.rows[0];
  const rec = sections.find((s) => s.kind === "recurring")!.rows[0];
  expect(env.cells[0]).toEqual({ budgeted: 300, depense: 120, recu: 0, balance: 180 });
  expect(rec.cells[0].budgeted).toBe(25); // 10 + 15
});

test("excluded transactions are not counted", () => {
  const txns = [tx({ id: "1", date: "2026-07-10", amount: -120, label: "CARREFOUR", excluded: true })];
  const sections = computeHistory([courses], txns, ["2026-07"], "2026-07");
  expect(sections[0].rows[0].cells[0].depense).toBe(0);
});

test("section totals sum the rows per month", () => {
  const courses2: Group = { ...courses, id: 3, name: "Courses2", monthlyAmount: 100, keywords: ["LECLERC"] };
  const txns = [
    tx({ id: "1", date: "2026-07-10", amount: -120, label: "CARREFOUR", groupId: 1 }),
    tx({ id: "2", date: "2026-07-10", amount: -40, label: "LECLERC", groupId: 3 }),
  ];
  const sections = computeHistory([courses, courses2], txns, ["2026-07"], "2026-07");
  expect(sections[0].totals[0]).toEqual({ budgeted: 400, depense: 160, recu: 0, balance: 240 });
});

test("income group fills recu, not depense", () => {
  const salaire: Group = { id: 9, accountId: "a1", name: "Salaire", direction: "in", kind: "envelope", monthlyAmount: 2000, keywords: ["REMU"], lines: [] };
  const txns = [tx({ id: "1", date: "2026-07-01", amount: 2000, label: "VIR REMU", groupId: 9 })];
  const sections = computeHistory([salaire], txns, ["2026-07"], "2026-07");
  expect(sections[0].rows[0].cells[0]).toEqual({ budgeted: 2000, depense: 0, recu: 2000, balance: 0 });
});

test("le Reste de section ignore l'argent reçu (rémunération sans budget)", () => {
  const remu: Group = {
    id: 21, accountId: "a1", name: "Rémunération", direction: "in", kind: "recurring",
    monthlyAmount: null, keywords: [], lines: [],
  };
  const txns = [
    tx({ id: "1", date: "2026-07-01", amount: 652.09, label: "VIR", groupId: 21 }),
    tx({ id: "2", date: "2026-07-05", amount: -10, label: "SPOTIFY", groupId: 2, lineId: 11 }),
  ];
  const sections = computeHistory([remu, abo], txns, ["2026-07"], "2026-07");
  // La rémunération est désormais dans sa propre section « income », en tête.
  const income = sections.find((s) => s.kind === "income")!;
  const remuRow = income.rows[0];
  // La rémunération n'a pas de budget de dépense : son Reste est nul, l'argent reçu n'y entre pas.
  expect(remuRow.cells[0].balance).toBe(0);
  // La section récurrente ne contient plus que la dépense (abo : budget 25 - dépensé 10 = 15).
  const rec = sections.find((s) => s.kind === "recurring")!;
  expect(rec.rows.every((r) => r.direction === "out")).toBe(true);
  expect(rec.totals[0].balance).toBe(15);
});

test("les rémunérations forment une section 'income' en tête, hors Récurrents/Enveloppes", () => {
  const remuRec: Group = {
    id: 30, accountId: "a1", name: "Salaire", direction: "in", kind: "recurring",
    monthlyAmount: null, keywords: [], lines: [], incomeKind: "principal",
  };
  const remuEnv: Group = {
    id: 31, accountId: "a1", name: "Prime", direction: "in", kind: "envelope",
    monthlyAmount: null, keywords: [], lines: [], incomeKind: "supplementary",
  };
  const txns = [
    tx({ id: "1", date: "2026-07-01", amount: 2000, label: "SAL", groupId: 30 }),
    tx({ id: "2", date: "2026-07-02", amount: 300, label: "PRIME", groupId: 31 }),
    tx({ id: "3", date: "2026-07-10", amount: -120, label: "CARREFOUR", groupId: 1 }),
  ];
  const sections = computeHistory([remuRec, remuEnv, courses], txns, ["2026-07"], "2026-07");
  // Section income en tête, principale avant supplémentaire.
  expect(sections[0].kind).toBe("income");
  expect(sections[0].rows.map((r) => r.name)).toEqual(["Salaire", "Prime"]);
  // Le seul récurrent était une rémunération : plus de section récurrente.
  expect(sections.find((s) => s.kind === "recurring")).toBeUndefined();
  // La section enveloppe ne garde que la dépense.
  const env = sections.find((s) => s.kind === "envelope")!;
  expect(env.rows.map((r) => r.name)).toEqual(["Courses"]);
});

test("le Reste des non catégorisés est nul (aucun budget)", () => {
  const txns = [
    tx({ id: "1", date: "2026-07-01", amount: 500, label: "DIVERS", groupId: null }),
    tx({ id: "2", date: "2026-07-05", amount: -80, label: "DIVERS2", groupId: null }),
  ];
  const sections = computeHistory([], txns, ["2026-07"], "2026-07");
  const uncat = sections.find((s) => s.kind === "uncategorized")!;
  expect(uncat.totals[0].balance).toBe(0);
});

test("mois futur : rien de réalisé (Dépensé 0, Balance = budget entier)", () => {
  const txns = [tx({ id: "1", date: "2026-07-10", amount: -120, label: "CARREFOUR", groupId: 1 })];
  const sections = computeHistory([courses], txns, ["2026-07", "2026-08"], "2026-07");
  const row = sections[0].rows[0];
  expect(row.cells[0]).toEqual({ budgeted: 300, depense: 120, recu: 0, balance: 180 }); // juillet réel
  expect(row.cells[1]).toEqual({ budgeted: 300, depense: 0, recu: 0, balance: 300 }); // août : rien dépensé encore
});

test("mois futur : le dépassement du mois courant n'est pas projeté dans les cellules", () => {
  // Il est maintenu dans les chaînes de plan (computePlannedSoldes), pas ici.
  const txns = [tx({ id: "1", date: "2026-07-10", amount: -450, label: "CARREFOUR", groupId: 1 })]; // 450 > 300
  const sections = computeHistory([courses], txns, ["2026-07", "2026-08"], "2026-07");
  const row = sections[0].rows[0];
  expect(row.cells[0]).toEqual({ budgeted: 300, depense: 450, recu: 0, balance: -150 }); // juillet réel
  expect(row.cells[1]).toEqual({ budgeted: 300, depense: 0, recu: 0, balance: 300 }); // août : rien dépensé encore
});

test("nextMonthKey advances one month, handles year boundary", () => {
  expect(nextMonthKey("2026-07")).toBe("2026-08");
  expect(nextMonthKey("2026-12")).toBe("2027-01");
});

test("addMonthsKey shifts by n months, forward and backward, across years", () => {
  expect(addMonthsKey("2026-07", 3)).toBe("2026-10");
  expect(addMonthsKey("2026-07", -1)).toBe("2026-06");
  expect(addMonthsKey("2026-01", -1)).toBe("2025-12");
  expect(addMonthsKey("2026-07", 12)).toBe("2027-07");
});

test("monthRange lists inclusive months, and sorts swapped bounds", () => {
  expect(monthRange("2026-05", "2026-08")).toEqual(["2026-05", "2026-06", "2026-07", "2026-08"]);
  expect(monthRange("2026-08", "2026-05")).toEqual(["2026-05", "2026-06", "2026-07", "2026-08"]);
  expect(monthRange("2026-07", "2026-07")).toEqual(["2026-07"]);
});

test("isMonthKey validates YYYY-MM and month bounds", () => {
  expect(isMonthKey("2026-07")).toBe(true);
  expect(isMonthKey("2026-13")).toBe(false);
  expect(isMonthKey("2026-00")).toBe(false);
  expect(isMonthKey("2026-7")).toBe(false);
  expect(isMonthKey(undefined)).toBe(false);
});

test("monthsDiff counts months between keys, across years, signed", () => {
  expect(monthsDiff("2026-07", "2026-08")).toBe(1);
  expect(monthsDiff("2026-07", "2026-12")).toBe(5);
  expect(monthsDiff("2026-07", "2027-01")).toBe(6);
  expect(monthsDiff("2026-07", "2026-07")).toBe(0);
  expect(monthsDiff("2026-07", "2026-05")).toBe(-2);
});

test("clampMonth bounds within [min, max]", () => {
  expect(clampMonth("2026-01", "2026-05", "2026-09")).toBe("2026-05");
  expect(clampMonth("2026-12", "2026-05", "2026-09")).toBe("2026-09");
  expect(clampMonth("2026-07", "2026-05", "2026-09")).toBe("2026-07");
});

test("grandTotals sum all sections per month (expenses and income)", () => {
  const salaire: Group = { id: 9, accountId: "a1", name: "Salaire", direction: "in", kind: "recurring", monthlyAmount: null, keywords: [], lines: [{ id: 91, name: "Paie", amount: 2000, day: 1, keyword: "REMU" }], incomeKind: "principal" };
  const txns = [
    tx({ id: "1", date: "2026-07-10", amount: -120, label: "CARREFOUR", groupId: 1 }),
    tx({ id: "2", date: "2026-07-01", amount: 2000, label: "VIR REMU", groupId: 9 }),
  ];
  const sections = computeHistory([courses, salaire], txns, ["2026-07"], "2026-07");
  const grand = grandTotals(sections, 1);
  expect(grand[0]).toEqual({ budgeted: 2300, depense: 120, recu: 2000, balance: 180 });
});

test("monthlyOverspend sums out-group overspends per month, ignores under-budget and income", () => {
  const c2: Group = { ...courses, id: 3, name: "C2", monthlyAmount: 50, keywords: ["LECLERC"] };
  const salaire: Group = { id: 9, accountId: "a1", name: "Salaire", direction: "in", kind: "envelope", monthlyAmount: 2000, keywords: ["REMU"], lines: [] };
  const txns = [
    tx({ id: "1", date: "2026-07-10", amount: -450, label: "CARREFOUR", groupId: 1 }), // budget 300 -> dépassement 150
    tx({ id: "2", date: "2026-07-10", amount: -20, label: "LECLERC", groupId: 3 }), // budget 50 -> sous budget, 0
    tx({ id: "3", date: "2026-07-01", amount: 2500, label: "VIR REMU", groupId: 9 }), // entrée, ignorée
  ];
  const sections = computeHistory([courses, c2, salaire], txns, ["2026-07"], "2026-07");
  expect(monthlyOverspend(sections, 1)).toEqual([150]);
});

test("recurring: transactions attributed to sub-groups by manual line_id", () => {
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

test("manual line_id attaches a transaction to a sub-group even without keyword", () => {
  const txns = [tx({ id: "1", date: "2026-07-05", amount: -15, label: "PRLV DIVERS 4821", groupId: 2, lineId: 12 })];
  const sections = computeHistory([abo], txns, ["2026-07"], "2026-07");
  const netflix = sections.find((s) => s.kind === "recurring")!.rows[0].subRows.find((s) => s.id === 12)!;
  expect(netflix.txns.map((t) => t.id)).toEqual(["1"]);
  expect(netflix.cells[0].depense).toBe(15);
});

test("envelope transactions are listed directly under the group (no sub-rows)", () => {
  const txns = [tx({ id: "1", date: "2026-07-10", amount: -120, label: "CARREFOUR", groupId: 1 })];
  const sections = computeHistory([courses], txns, ["2026-07"], "2026-07");
  const env = sections[0].rows[0];
  expect(env.subRows).toEqual([]);
  expect(env.txns.map((t) => t.id)).toEqual(["1"]);
});

test("recurring transaction matching no line stays directly under the group", () => {
  const txns = [tx({ id: "1", date: "2026-07-10", amount: -40, label: "ACHAT INCONNU", groupId: 2 })];
  const sections = computeHistory([abo], txns, ["2026-07"], "2026-07");
  const rec = sections.find((s) => s.kind === "recurring")!.rows[0];
  expect(rec.txns.map((t) => t.id)).toEqual(["1"]);
  expect(rec.subRows.every((s) => s.txns.length === 0)).toBe(true);
});

test("empty sections are omitted", () => {
  const txns = [tx({ id: "1", date: "2026-07-10", amount: -120, label: "CARREFOUR", groupId: 1 })];
  const sections = computeHistory([courses], txns, ["2026-07"], "2026-07");
  expect(sections.map((s) => s.kind)).toEqual(["envelope"]);
});

test("transactions with no group are split into two uncategorized sections (in / out)", () => {
  const txns = [
    tx({ id: "1", date: "2026-07-05", amount: -40, label: "ACHAT X" }), // sortie non catégorisée
    tx({ id: "2", date: "2026-07-06", amount: 100, label: "REMBOURSEMENT" }), // entrée non catégorisée
    tx({ id: "3", date: "2026-07-07", amount: -25, label: "CARREFOUR", groupId: 1 }), // catégorisée
  ];
  const sections = computeHistory([courses], txns, ["2026-07"], "2026-07");
  const uncatIn = sections.find((s) => s.kind === "uncategorized" && s.uncatDirection === "in")!;
  const uncatOut = sections.find((s) => s.kind === "uncategorized" && s.uncatDirection === "out")!;
  // Les reçus dans la section « in » (affichée sous les rémunérations)…
  expect(uncatIn.txns!.map((t) => t.id)).toEqual(["2"]);
  expect(uncatIn.totals[0]).toEqual({ budgeted: 0, depense: 0, recu: 100, balance: 0 });
  // … et les dépenses dans la section « out » (après les enveloppes).
  expect(uncatOut.txns!.map((t) => t.id)).toEqual(["1"]);
  expect(uncatOut.totals[0]).toEqual({ budgeted: 0, depense: 40, recu: 0, balance: 0 });
  expect([...uncatIn.txns!, ...uncatOut.txns!].every((t) => t.groupId === null)).toBe(true);
  // Ordre : les reçus juste après les rémunérations (ici : en tête), les dépenses en dernier.
  expect(sections.map((s) => (s.kind === "uncategorized" ? `uncat-${s.uncatDirection}` : s.kind))).toEqual([
    "uncat-in",
    "envelope",
    "uncat-out",
  ]);
});

test("no uncategorized section when every transaction has a group", () => {
  const txns = [tx({ id: "1", date: "2026-07-05", amount: -40, label: "X", groupId: 1 })];
  const sections = computeHistory([courses], txns, ["2026-07"], "2026-07");
  expect(sections.some((s) => s.kind === "uncategorized")).toBe(false);
});

test("la rémunération principale n'est pas réalisée sur les mois futurs (Reçu 0, budget conservé)", () => {
  const principal: Group = {
    id: 30, accountId: "a1", name: "Rémunération principale", direction: "in",
    kind: "envelope", monthlyAmount: 2000, keywords: [], lines: [], incomeKind: "principal",
  };
  const sections = computeHistory([principal], [], ["2026-07", "2026-08"], "2026-07");
  const row = sections.find((s) => s.kind === "income")!.rows[0];
  expect(row.incomeKind).toBe("principal");
  expect(row.cells[1].recu).toBe(0); // mois futur : rien de reçu encore
  expect(row.cells[1].budgeted).toBe(2000); // le budget reste projeté (colonne Budget rém.)
});

test("la rémunération supplémentaire n'est pas projetée (Reçu futur = 0)", () => {
  const supp: Group = {
    id: 31, accountId: "a1", name: "Rémunération supplémentaire", direction: "in",
    kind: "envelope", monthlyAmount: 500, keywords: [], lines: [], incomeKind: "supplementary",
  };
  const sections = computeHistory([supp], [], ["2026-07", "2026-08"], "2026-07");
  const row = sections.find((s) => s.kind === "income")!.rows[0];
  expect(row.incomeKind).toBe("supplementary");
  expect(row.cells[1].recu).toBe(0); // mois futur : rien
  expect(row.cells[1].budgeted).toBe(500); // le montant reste stocké (masqué à l'affichage)
});

const salaire: Group = {
  id: 9, accountId: "a1", name: "Salaire", direction: "in", kind: "envelope",
  monthlyAmount: 2000, keywords: ["REMU"], lines: [],
};

test("computeSolde: le bas du mois courant colle au solde de la banque", () => {
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
  // rémunération d'abord (-380 + 2000 = 1620), puis dépense (1620 - 120 = 1500)
  expect(solde.rowRunning[9][0]).toBe(1620);
  expect(solde.rowRunning[1][0]).toBe(1500);
});

test("computeSolde: les mois s'enchaînent (fin du mois N = début du mois N+1)", () => {
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

test("computeSolde: un mois futur reste plat (rien de réalisé), ancré sur le solde ou l'estimé", () => {
  const txns = [
    tx({ id: "1", date: "2026-07-01", amount: 2000, label: "VIR REMU", groupId: 9 }),
    tx({ id: "2", date: "2026-07-10", amount: -120, label: "CARREFOUR", groupId: 1 }),
  ];
  const months = ["2026-07", "2026-08"];
  const sections = computeHistory([salaire, courses], txns, months, "2026-07");
  // Sans estimé : août s'ouvre sur la fin de juillet et n'a aucun mouvement réel.
  const solde = computeSolde(sections, months, "2026-07", 1500);
  expect(solde.openings[1]).toBe(1500); // = fin de juillet
  expect(solde.closings[1]).toBe(1500); // net futur = 0
  // Avec l'estimé de fin du mois courant : août s'ouvre dessus.
  const soldeEst = computeSolde(sections, months, "2026-07", 1500, 1800);
  expect(soldeEst.openings[1]).toBe(1800);
  expect(soldeEst.closings[1]).toBe(1800);
});

test("Total rémunérations, colonne Budget : ne compte que la principale (pas la supplémentaire)", () => {
  const principal: Group = {
    id: 40, accountId: "a1", name: "Rémunération principale", direction: "in",
    kind: "envelope", monthlyAmount: 2000, keywords: [], lines: [], incomeKind: "principal",
  };
  const supplementaire: Group = {
    id: 41, accountId: "a1", name: "Rémunération supplémentaire", direction: "in",
    kind: "envelope", monthlyAmount: 500, keywords: [], lines: [], incomeKind: "supplementary",
  };
  const sections = computeHistory([principal, supplementaire], [], ["2026-07"], "2026-07");
  const income = sections.find((s) => s.kind === "income")!;
  // Le total de la section income n'inclut que le budget de la principale.
  expect(income.totals[0].budgeted).toBe(2000);
  // Le total général (« Solde actuel ») doit refléter la même règle.
  expect(grandTotals(sections, 1)[0].budgeted).toBe(2000);
});

test("computeSolde: fenêtre entièrement future ancre l'ouverture sur le solde d'aujourd'hui", () => {
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

test("computePlannedSoldes: prévu = départ + revenus − budget ; si dépassement retire le dépassement", () => {
  // Principale 2000 (in), une dépense budget 300 dont on a dépensé 350 ce mois (dépassement 50).
  const principal: Group = { id: 1, accountId: "a1", name: "Rémunération principale", direction: "in", kind: "envelope", monthlyAmount: 2000, keywords: [], lines: [], incomeKind: "principal" };
  const courses2: Group = { id: 2, accountId: "a1", name: "Courses", direction: "out", kind: "envelope", monthlyAmount: 300, keywords: [], lines: [], incomeKind: null };
  const txns = [
    tx({ id: "s", date: "2026-07-01", amount: 2000, label: "REMU", groupId: 1 }),
    tx({ id: "c", date: "2026-07-10", amount: -350, label: "CARREFOUR", groupId: 2 }),
  ];
  const months = ["2026-07", "2026-08"];
  const sections = computeHistory([principal, courses2], txns, months, "2026-07");
  const solde = computeSolde(sections, months, "2026-07", 5000);
  const p = computePlannedSoldes(sections, months, "2026-07", solde.openings);
  const open = solde.openings[0]; // argent de départ réel du mois courant
  // Mois courant : prévu = open + 2000 − 300 ; si dépass = prévu − 50.
  expect(p.prevuClosings[0]).toBeCloseTo(open + 2000 - 300, 2);
  expect(p.depassClosings[0]).toBeCloseTo(open + 2000 - 300 - 50, 2);
  // Mois futur : chaîne à partir de la clôture du mois courant (même net planifié).
  expect(p.prevuClosings[1]).toBeCloseTo((open + 2000 - 300) + (2000 - 300), 2);
  expect(p.depassClosings[1]).toBeCloseTo((open + 2000 - 300 - 50) + (2000 - 300 - 50), 2);
  // Avec l'estimé de fin du mois courant : le premier mois futur repart de lui.
  const pe = computePlannedSoldes(sections, months, "2026-07", solde.openings, 4200);
  expect(pe.prevuClosings[0]).toBeCloseTo(open + 2000 - 300, 2); // mois courant inchangé
  expect(pe.prevuClosings[1]).toBeCloseTo(4200 + (2000 - 300), 2);
  expect(pe.depassClosings[1]).toBeCloseTo(4200 + (2000 - 300 - 50), 2);
});

test("computePlannedSoldes: le débordement net des non catégorisés entre dans la chaîne « si dépassement »", () => {
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
  // Prévu : les non catégorisés ne changent rien (aucun budget).
  expect(p.prevuClosings[0]).toBeCloseTo(open, 2);
  // Si dépassement : la clôture retire le débordement net (300), en continu avec
  // la valeur courue à l'étape « dépenses ».
  expect(p.depassClosings[0]).toBeCloseTo(open - 300, 2);
  expect(p.uncatDepassRunning.out?.[0]).toBeCloseTo(open - 300, 2);
  expect(p.uncatDepassRunning.in?.[0]).toBeCloseTo(open, 2); // les reçus ne retirent rien
  // Maintenu sur le mois futur.
  expect(p.depassClosings[1]).toBeCloseTo((p.depassClosings[0] ?? 0) - 300, 2);
});

test("computePlannedSoldes: la supplémentaire compte au mois courant mais pas en projection", () => {
  const supp: Group = { id: 3, accountId: "a1", name: "Rémunération supplémentaire", direction: "in", kind: "envelope", monthlyAmount: 500, keywords: [], lines: [], incomeKind: "supplementary" };
  const months = ["2026-07", "2026-08"];
  const sections = computeHistory([supp], [], months, "2026-07");
  const solde = computeSolde(sections, months, "2026-07", 1000);
  const p = computePlannedSoldes(sections, months, "2026-07", solde.openings);
  const open = solde.openings[0];
  expect(p.prevuClosings[0]).toBeCloseTo(open + 500, 2); // courant : +500
  expect(p.prevuClosings[1]).toBeCloseTo(open + 500, 2); // futur : +0 (pas de projection)
});

test("budgets datés : le budget en vigueur dépend du mois, sans rétroactivité", () => {
  const dated = { 1: [{ effectiveMonth: "2026-08", amount: 400 }] };
  const txns = [tx({ id: "1", date: "2026-07-10", amount: -350, label: "CARREFOUR", groupId: 1 })];
  const sections = computeHistory([courses], txns, ["2026-07", "2026-08"], "2026-07", dated);
  const row = sections[0].rows[0];
  // Juillet garde l'ancien budget (300) : le dépassement de 50 reste visible.
  expect(row.cells[0]).toEqual({ budgeted: 300, depense: 350, recu: 0, balance: -50 });
  // Août applique le nouveau budget (400), rien de dépensé encore.
  expect(row.cells[1]).toEqual({ budgeted: 400, depense: 0, recu: 0, balance: 400 });
});

test("budgetInForce : dernier montant daté <= mois, repli sur monthlyAmount", () => {
  const dated = { 1: [{ effectiveMonth: "2026-08", amount: 400 }, { effectiveMonth: "2026-10", amount: 450 }] };
  expect(budgetInForce(courses, "2026-07", dated)).toBe(300); // avant toute ligne datée
  expect(budgetInForce(courses, "2026-08", dated)).toBe(400);
  expect(budgetInForce(courses, "2026-09", dated)).toBe(400);
  expect(budgetInForce(courses, "2026-11", dated)).toBe(450);
  expect(budgetInForce(courses, "2026-07")).toBe(300); // sans budgets datés
});

test("toDatedBudgets regroupe et conserve l'ordre par mois", () => {
  expect(
    toDatedBudgets([
      { groupId: 1, effectiveMonth: "2026-08", amount: 400 },
      { groupId: 2, effectiveMonth: "2026-09", amount: 50 },
      { groupId: 1, effectiveMonth: "2026-10", amount: 450 },
    ]),
  ).toEqual({ 1: [{ effectiveMonth: "2026-08", amount: 400 }, { effectiveMonth: "2026-10", amount: 450 }], 2: [{ effectiveMonth: "2026-09", amount: 50 }] });
});
