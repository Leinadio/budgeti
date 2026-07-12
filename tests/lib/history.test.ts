import { expect, test } from "vitest";
import { computeHistory, monthsWithData, nextMonthKey, grandTotals, monthlyOverspend } from "../../src/lib/history";
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
    tx({ id: "1", date: "2026-06-10", amount: -120, label: "CARREFOUR" }),
    tx({ id: "2", date: "2026-07-10", amount: -50, label: "CARREFOUR" }),
    tx({ id: "3", date: "2026-07-15", amount: -30, label: "CARREFOUR" }),
  ];
  const sections = computeHistory([courses], txns, ["2026-06", "2026-07"], "2026-07");
  const row = sections[0].rows[0];
  expect(row.cells[0].depense).toBe(120); // juin
  expect(row.cells[1].depense).toBe(80); // juillet 50 + 30
});

test("budgeted: envelope monthlyAmount, recurring sum of lines; balance = budgeted - spent", () => {
  const txns = [tx({ id: "1", date: "2026-07-10", amount: -120, label: "CARREFOUR" })];
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
    tx({ id: "1", date: "2026-07-10", amount: -120, label: "CARREFOUR" }),
    tx({ id: "2", date: "2026-07-10", amount: -40, label: "LECLERC" }),
  ];
  const sections = computeHistory([courses, courses2], txns, ["2026-07"], "2026-07");
  expect(sections[0].totals[0]).toEqual({ budgeted: 400, depense: 160, recu: 0, balance: 240 });
});

test("income group fills recu, not depense", () => {
  const salaire: Group = { id: 9, accountId: "a1", name: "Salaire", direction: "in", kind: "envelope", monthlyAmount: 2000, keywords: ["REMU"], lines: [] };
  const txns = [tx({ id: "1", date: "2026-07-01", amount: 2000, label: "VIR REMU" })];
  const sections = computeHistory([salaire], txns, ["2026-07"], "2026-07");
  expect(sections[0].rows[0].cells[0]).toEqual({ budgeted: 2000, depense: 0, recu: 2000, balance: 0 });
});

test("future projection within budget: spent = budgeted, balance = 0", () => {
  const txns = [tx({ id: "1", date: "2026-07-10", amount: -120, label: "CARREFOUR" })];
  const sections = computeHistory([courses], txns, ["2026-07", "2026-08"], "2026-07");
  const row = sections[0].rows[0];
  expect(row.cells[0]).toEqual({ budgeted: 300, depense: 120, recu: 0, balance: 180 }); // juillet réel
  expect(row.cells[1]).toEqual({ budgeted: 300, depense: 300, recu: 0, balance: 0 }); // août projeté (pas de dépassement)
});

test("future projection carries the current-month overspend (like Previsionnel)", () => {
  const txns = [tx({ id: "1", date: "2026-07-10", amount: -450, label: "CARREFOUR" })]; // 450 > 300
  const sections = computeHistory([courses], txns, ["2026-07", "2026-08"], "2026-07");
  const row = sections[0].rows[0];
  expect(row.cells[0]).toEqual({ budgeted: 300, depense: 450, recu: 0, balance: -150 }); // juillet réel
  expect(row.cells[1]).toEqual({ budgeted: 300, depense: 450, recu: 0, balance: -150 }); // août : dépassement maintenu
});

test("nextMonthKey advances one month, handles year boundary", () => {
  expect(nextMonthKey("2026-07")).toBe("2026-08");
  expect(nextMonthKey("2026-12")).toBe("2027-01");
});

test("grandTotals sum all sections per month (expenses and income)", () => {
  const salaire: Group = { id: 9, accountId: "a1", name: "Salaire", direction: "in", kind: "recurring", monthlyAmount: null, keywords: [], lines: [{ id: 91, name: "Paie", amount: 2000, day: 1, keyword: "REMU" }] };
  const txns = [
    tx({ id: "1", date: "2026-07-10", amount: -120, label: "CARREFOUR" }),
    tx({ id: "2", date: "2026-07-01", amount: 2000, label: "VIR REMU" }),
  ];
  const sections = computeHistory([courses, salaire], txns, ["2026-07"], "2026-07");
  const grand = grandTotals(sections, 1);
  expect(grand[0]).toEqual({ budgeted: 2300, depense: 120, recu: 2000, balance: 180 });
});

test("monthlyOverspend sums out-group overspends per month, ignores under-budget and income", () => {
  const c2: Group = { ...courses, id: 3, name: "C2", monthlyAmount: 50, keywords: ["LECLERC"] };
  const salaire: Group = { id: 9, accountId: "a1", name: "Salaire", direction: "in", kind: "envelope", monthlyAmount: 2000, keywords: ["REMU"], lines: [] };
  const txns = [
    tx({ id: "1", date: "2026-07-10", amount: -450, label: "CARREFOUR" }), // budget 300 -> dépassement 150
    tx({ id: "2", date: "2026-07-10", amount: -20, label: "LECLERC" }), // budget 50 -> sous budget, 0
    tx({ id: "3", date: "2026-07-01", amount: 2500, label: "VIR REMU" }), // entrée, ignorée
  ];
  const sections = computeHistory([courses, c2, salaire], txns, ["2026-07"], "2026-07");
  expect(monthlyOverspend(sections, 1)).toEqual([150]);
});

test("empty sections are omitted", () => {
  const txns = [tx({ id: "1", date: "2026-07-10", amount: -120, label: "CARREFOUR" })];
  const sections = computeHistory([courses], txns, ["2026-07"], "2026-07");
  expect(sections.map((s) => s.kind)).toEqual(["envelope"]);
});
