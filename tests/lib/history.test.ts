import { expect, test } from "vitest";
import { computeHistory, monthsWithData, nextMonthKey, grandTotals, monthlyOverspend, addMonthsKey, monthRange, isMonthKey, clampMonth, monthsDiff } from "../../src/lib/history";
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

test("future projection within budget: spent = budgeted, balance = 0", () => {
  const txns = [tx({ id: "1", date: "2026-07-10", amount: -120, label: "CARREFOUR", groupId: 1 })];
  const sections = computeHistory([courses], txns, ["2026-07", "2026-08"], "2026-07");
  const row = sections[0].rows[0];
  expect(row.cells[0]).toEqual({ budgeted: 300, depense: 120, recu: 0, balance: 180 }); // juillet réel
  expect(row.cells[1]).toEqual({ budgeted: 300, depense: 300, recu: 0, balance: 0 }); // août projeté (pas de dépassement)
});

test("future projection carries the current-month overspend (like Previsionnel)", () => {
  const txns = [tx({ id: "1", date: "2026-07-10", amount: -450, label: "CARREFOUR", groupId: 1 })]; // 450 > 300
  const sections = computeHistory([courses], txns, ["2026-07", "2026-08"], "2026-07");
  const row = sections[0].rows[0];
  expect(row.cells[0]).toEqual({ budgeted: 300, depense: 450, recu: 0, balance: -150 }); // juillet réel
  expect(row.cells[1]).toEqual({ budgeted: 300, depense: 450, recu: 0, balance: -150 }); // août : dépassement maintenu
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
  const salaire: Group = { id: 9, accountId: "a1", name: "Salaire", direction: "in", kind: "recurring", monthlyAmount: null, keywords: [], lines: [{ id: 91, name: "Paie", amount: 2000, day: 1, keyword: "REMU" }] };
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

test("transactions with no group go to the uncategorized section with per-month totals", () => {
  const txns = [
    tx({ id: "1", date: "2026-07-05", amount: -40, label: "ACHAT X" }), // sortie non catégorisée
    tx({ id: "2", date: "2026-07-06", amount: 100, label: "REMBOURSEMENT" }), // entrée non catégorisée
    tx({ id: "3", date: "2026-07-07", amount: -25, label: "CARREFOUR", groupId: 1 }), // catégorisée
  ];
  const sections = computeHistory([courses], txns, ["2026-07"], "2026-07");
  const uncat = sections.find((s) => s.kind === "uncategorized")!;
  expect(uncat.txns!.map((t) => t.id).sort()).toEqual(["1", "2"]);
  expect(uncat.txns!.every((t) => t.groupId === null)).toBe(true);
  expect(uncat.totals[0]).toEqual({ budgeted: 0, depense: 40, recu: 100, balance: 60 });
});

test("no uncategorized section when every transaction has a group", () => {
  const txns = [tx({ id: "1", date: "2026-07-05", amount: -40, label: "X", groupId: 1 })];
  const sections = computeHistory([courses], txns, ["2026-07"], "2026-07");
  expect(sections.some((s) => s.kind === "uncategorized")).toBe(false);
});

import { computeSolde } from "../../src/lib/history";

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

test("computeSolde: un mois futur part du solde de fin du mois courant", () => {
  const txns = [
    tx({ id: "1", date: "2026-07-01", amount: 2000, label: "VIR REMU", groupId: 9 }),
    tx({ id: "2", date: "2026-07-10", amount: -120, label: "CARREFOUR", groupId: 1 }),
  ];
  const months = ["2026-07", "2026-08"];
  const sections = computeHistory([salaire, courses], txns, months, "2026-07");
  const solde = computeSolde(sections, months, "2026-07", 1500);
  // août projeté : salaire reçu 2000, courses dépensé = budget 300 -> net 1700
  expect(solde.openings[1]).toBe(1500); // = fin de juillet
  expect(solde.closings[1]).toBe(3200); // 1500 + 1700
});
