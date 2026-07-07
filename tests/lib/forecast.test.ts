import { expect, test } from "vitest";
import { computeForecast, type Group, type Txn } from "../../src/lib/forecast";

const abonnements: Group = {
  id: 1,
  accountId: "acc1",
  name: "Abonnements",
  direction: "out",
  lines: [
    { id: 11, name: "Spotify", amount: 10, day: 3, keyword: "SPOTIFY" },
    { id: 12, name: "Netflix", amount: 15, day: 8, keyword: "NETFLIX" },
  ],
};

const courses: Group = {
  id: 2,
  accountId: "acc1",
  name: "Courses",
  direction: "out",
  lines: [{ id: 21, name: "Courses", amount: 300, day: null, keyword: "CARREFOUR" }],
};

const remuneration: Group = {
  id: 3,
  accountId: "acc1",
  name: "Rémunération",
  direction: "in",
  lines: [{ id: 31, name: "Salaire", amount: 2000, day: 1, keyword: "REMU" }],
};

test("dated out line not seen is subtracted; seen is ignored", () => {
  const txns: Txn[] = [
    { date: "2026-07-05", amount: -10, label: "PRLV SPOTIFY", accountId: "acc1" }, // Spotify vue
  ];
  const f = computeForecast("acc1", 1000, [abonnements], txns, "2026-07");
  // Spotify vue (déjà dans le solde) → ignorée ; Netflix non vue → -15
  expect(f.currentEstimate).toBe(985);
});

test("envelope subtracts its remaining, floored at 0", () => {
  const txns: Txn[] = [
    { date: "2026-07-02", amount: -120, label: "CARREFOUR CITY", accountId: "acc1" },
    { date: "2026-07-06", amount: -30, label: "carrefour market", accountId: "acc1" },
  ];
  const f = computeForecast("acc1", 1000, [courses], txns, "2026-07");
  // dépensé 150 sur 300 → reste 150 → 1000 - 150
  expect(f.currentEstimate).toBe(850);
  expect(f.groups[0].spent).toBe(150);
});

test("envelope overspend does not add money back", () => {
  const txns: Txn[] = [
    { date: "2026-07-02", amount: -450, label: "CARREFOUR", accountId: "acc1" },
  ];
  const f = computeForecast("acc1", 1000, [courses], txns, "2026-07");
  // reste = max(0, 300 - 450) = 0
  expect(f.currentEstimate).toBe(1000);
  expect(f.groups[0].spent).toBe(300);
});

test("dated in line not seen is added", () => {
  const f = computeForecast("acc1", 500, [remuneration], [], "2026-07");
  expect(f.currentEstimate).toBe(2500);
});

test("matching filters by account and by sign", () => {
  const txns: Txn[] = [
    { date: "2026-07-05", amount: -10, label: "SPOTIFY", accountId: "acc2" }, // autre compte
    { date: "2026-07-05", amount: 10, label: "SPOTIFY", accountId: "acc1" },  // crédit, pas un débit
  ];
  const f = computeForecast("acc1", 1000, [abonnements], txns, "2026-07");
  // Spotify jamais vue comme débit sur acc1 → -10 ; Netflix -15
  expect(f.currentEstimate).toBe(975);
});

test("next month starts from current estimate and applies full amounts", () => {
  const txns: Txn[] = [];
  const f = computeForecast("acc1", 1000, [abonnements, courses, remuneration], txns, "2026-07");
  // courant : rien vu → -10 -15 -300 (reste plein) +2000 = 2675
  expect(f.currentEstimate).toBe(2675);
  // suivant : 2675 + (2000 - 10 - 15 - 300) = 2675 + 1675 = 4350
  expect(f.nextEstimate).toBe(4350);
});

test("timeline sorted by day with seen status; envelopes excluded", () => {
  const txns: Txn[] = [
    { date: "2026-07-05", amount: -10, label: "SPOTIFY", accountId: "acc1" },
  ];
  const f = computeForecast("acc1", 1000, [abonnements, courses], txns, "2026-07");
  expect(f.timeline.map((i) => [i.day, i.name, i.amount, i.seen])).toEqual([
    [3, "Spotify", -10, true],
    [8, "Netflix", -15, false],
  ]);
});

test("december rolls over to january of next year", () => {
  const f = computeForecast("acc1", 1000, [courses], [], "2026-12");
  // courant : -300 → 700 ; suivant : 700 - 300 = 400
  expect(f.currentEstimate).toBe(700);
  expect(f.nextEstimate).toBe(400);
});
