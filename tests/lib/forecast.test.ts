import { expect, test } from "vitest";
import { computeForecast, type Group, type Txn } from "../../src/lib/forecast";

const courses: Group = {
  id: 1, accountId: "a1", name: "Courses", direction: "out", kind: "envelope",
  monthlyAmount: 300, keywords: ["CARREFOUR", "LECLERC"], lines: [],
};
const abo: Group = {
  id: 2, accountId: "a1", name: "Abonnements", direction: "out", kind: "recurring",
  monthlyAmount: null, keywords: [],
  lines: [
    { id: 11, name: "Spotify", amount: 10, day: 3, keyword: "SPOTIFY" },
    { id: 12, name: "Netflix", amount: 15, day: 8, keyword: "NETFLIX" },
  ],
};
const salaire: Group = {
  id: 3, accountId: "a1", name: "Salaire", direction: "in", kind: "recurring",
  monthlyAmount: null, keywords: [],
  lines: [{ id: 31, name: "Rémunération", amount: 2000, day: 1, keyword: "REMU" }],
};

function tx(p: Partial<Txn>): Txn {
  return { id: "t", date: "2026-07-05", amount: -10, label: "", accountId: "a1", groupId: null, ...p };
}

test("envelope: spent via ownership, remaining floored, subtracted from current", () => {
  const txns = [tx({ id: "t1", amount: -120, label: "CARREFOUR CITY" }), tx({ id: "t2", amount: -30, label: "LECLERC" })];
  const f = computeForecast("a1", 1000, [courses], txns, "2026-07");
  // dépensé 150 / 300 -> reste 150
  expect(f.currentEstimate).toBe(850);
  const gv = f.groups.find((g) => g.id === 1)!;
  expect(gv.total).toBe(300);
  expect(gv.spent).toBe(150);
});

test("envelope overspend: remaining floored at 0 but spent kept real", () => {
  const txns = [tx({ id: "t1", amount: -450, label: "CARREFOUR" })];
  const f = computeForecast("a1", 1000, [courses], txns, "2026-07");
  expect(f.currentEstimate).toBe(1000);
  const gv = f.groups[0];
  expect(gv.spent).toBe(450); // dépense réelle, non plafonnée
  expect(gv.overspend).toBe(150); // 450 - 300
});

test("no overspend: overspend and prevOverspend are 0", () => {
  const txns = [tx({ id: "t1", amount: -120, label: "CARREFOUR" })];
  const f = computeForecast("a1", 1000, [courses], txns, "2026-07");
  const gv = f.groups[0];
  expect(gv.overspend).toBe(0);
  expect(gv.prevOverspend).toBe(0);
});

test("overspend this month only: current overspend set, previous month clean", () => {
  const txns = [tx({ id: "t1", date: "2026-07-05", amount: -500, label: "CARREFOUR" })];
  const f = computeForecast("a1", 1000, [courses], txns, "2026-07");
  const gv = f.groups[0];
  expect(gv.overspend).toBe(200); // 500 - 300
  expect(gv.prevSpent).toBe(0);
  expect(gv.prevOverspend).toBe(0);
});

test("overspend last month only: prev recap set, current month clean", () => {
  const txns = [tx({ id: "t1", date: "2026-06-10", amount: -500, label: "CARREFOUR" })];
  const f = computeForecast("a1", 1000, [courses], txns, "2026-07");
  const gv = f.groups[0];
  expect(gv.overspend).toBe(0);
  expect(gv.spent).toBe(0);
  expect(gv.prevSpent).toBe(500);
  expect(gv.prevOverspend).toBe(200); // 500 - 300
});

test("overspend both months: current and previous both set", () => {
  const txns = [
    tx({ id: "t1", date: "2026-07-05", amount: -450, label: "CARREFOUR" }),
    tx({ id: "t2", date: "2026-06-10", amount: -520, label: "LECLERC" }),
  ];
  const f = computeForecast("a1", 1000, [courses], txns, "2026-07");
  const gv = f.groups[0];
  expect(gv.overspend).toBe(150); // 450 - 300
  expect(gv.prevOverspend).toBe(220); // 520 - 300
});

test("prevMonthKey handles year boundary (january -> previous december)", () => {
  const txns = [tx({ id: "t1", date: "2025-12-15", amount: -500, label: "CARREFOUR" })];
  const f = computeForecast("a1", 1000, [courses], txns, "2026-01");
  expect(f.groups[0].prevSpent).toBe(500);
  expect(f.groups[0].prevOverspend).toBe(200);
});

test("recurring line unseen subtracted; seen ignored; timeline sorted", () => {
  const txns = [tx({ id: "t1", amount: -10, label: "PRLV SPOTIFY" })]; // Spotify vue
  const f = computeForecast("a1", 1000, [abo], txns, "2026-07");
  // Spotify vue -> ignorée ; Netflix non vue -> -15
  expect(f.currentEstimate).toBe(985);
  expect(f.timeline.map((i) => [i.day, i.name, i.seen])).toEqual([[3, "Spotify", true], [8, "Netflix", false]]);
});

test("recurring in-line added when unseen", () => {
  const f = computeForecast("a1", 500, [salaire], [], "2026-07");
  expect(f.currentEstimate).toBe(2500);
});

test("ambiguous transaction counts in no group", () => {
  const dup: Group = { ...courses, id: 4, name: "Courses2", keywords: ["CARREFOUR"] };
  const txns = [tx({ id: "t1", amount: -50, label: "CARREFOUR" })];
  const f = computeForecast("a1", 1000, [courses, dup], txns, "2026-07");
  // ambiguë -> non comptée : les deux enveloppes gardent reste plein (300 chacune)
  expect(f.currentEstimate).toBe(1000 - 300 - 300);
  expect(f.groups.find((g) => g.id === 1)!.spent).toBe(0);
});

test("manual attachment overrides keyword", () => {
  // "CARREFOUR" matcherait Courses, mais rattaché manuellement à l'enveloppe id 5
  const autre: Group = { id: 5, accountId: "a1", name: "Autre", direction: "out", kind: "envelope", monthlyAmount: 100, keywords: [], lines: [] };
  const txns = [tx({ id: "t1", amount: -40, label: "CARREFOUR", groupId: 5 })];
  const f = computeForecast("a1", 1000, [courses, autre], txns, "2026-07");
  expect(f.groups.find((g) => g.id === 5)!.spent).toBe(40); // compte dans Autre
  expect(f.groups.find((g) => g.id === 1)!.spent).toBe(0);  // pas dans Courses
});

test("next month starts from current estimate and applies full amounts", () => {
  const f = computeForecast("a1", 1000, [courses, abo, salaire], [], "2026-07");
  // courant : -300 (courses reste plein) -10 -15 (abo) +2000 (salaire) = 2675
  expect(f.currentEstimate).toBe(2675);
  // suivant : 2675 + (2000 - 10 - 15 - 300) = 4350
  expect(f.nextEstimate).toBe(4350);
});
