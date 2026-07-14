import { expect, test } from "vitest";
import { filterTransactions, summarize, EMPTY_FILTERS, hasActiveFilters, type TxnFilters } from "../../src/lib/transactions-filter";
import type { OwnableGroup } from "../../src/lib/ownership";
import type { TxnView } from "../../src/db/repositories/transactions";

const ownable: OwnableGroup[] = [
  { id: 1, accountId: "a1", direction: "out", kind: "envelope", keywords: ["CARREFOUR"] },
  { id: 2, accountId: "a1", direction: "in", kind: "envelope", keywords: ["REMU"] },
];

function tx(p: Partial<TxnView>): TxnView {
  return { id: "t", date: "2026-07-05", amount: -10, label: "", accountId: "a1", accountLabel: "A1", groupId: null, lineId: null, excluded: false, ...p };
}

const filters = (p: Partial<TxnFilters>): TxnFilters => ({ ...EMPTY_FILTERS, ...p });

test("text filter is case-insensitive on label", () => {
  const txns = [tx({ id: "1", label: "PAIEMENT CARREFOUR" }), tx({ id: "2", label: "SPOTIFY" })];
  const r = filterTransactions(txns, filters({ text: "carrefour" }), ownable);
  expect(r.map((t) => t.id)).toEqual(["1"]);
});

test("group filter matches the manually assigned owner", () => {
  const txns = [tx({ id: "1", label: "ACHAT CARREFOUR", amount: -20, groupId: 1 }), tx({ id: "2", label: "SPOTIFY", amount: -10 })];
  const r = filterTransactions(txns, filters({ group: 1 }), ownable);
  expect(r.map((t) => t.id)).toEqual(["1"]);
});

test("group filter 'none' matches transactions with no manual group", () => {
  const txns = [tx({ id: "1", label: "ACHAT CARREFOUR", amount: -20, groupId: 1 }), tx({ id: "2", label: "INCONNU", amount: -10 })];
  const r = filterTransactions(txns, filters({ group: "none" }), ownable);
  expect(r.map((t) => t.id)).toEqual(["2"]);
});

test("excluded transaction is uncategorised", () => {
  const txns = [tx({ id: "1", label: "ACHAT CARREFOUR", amount: -20, groupId: 1, excluded: true })];
  // groupe assigné mais exclu -> hors catégorie
  expect(filterTransactions(txns, filters({ group: 1 }), ownable)).toEqual([]);
  expect(filterTransactions(txns, filters({ group: "none" }), ownable).map((t) => t.id)).toEqual(["1"]);
});

test("amount filter uses absolute value, bounds inclusive", () => {
  const txns = [tx({ id: "1", amount: -18 }), tx({ id: "2", amount: 18 }), tx({ id: "3", amount: -5 }), tx({ id: "4", amount: -50 })];
  const r = filterTransactions(txns, filters({ amountMin: 18, amountMax: 18 }), ownable);
  expect(r.map((t) => t.id).sort()).toEqual(["1", "2"]);
});

test("period filter is inclusive on both bounds", () => {
  const txns = [tx({ id: "1", date: "2026-06-30" }), tx({ id: "2", date: "2026-07-01" }), tx({ id: "3", date: "2026-07-31" }), tx({ id: "4", date: "2026-08-01" })];
  const r = filterTransactions(txns, filters({ dateFrom: "2026-07-01", dateTo: "2026-07-31" }), ownable);
  expect(r.map((t) => t.id)).toEqual(["2", "3"]);
});

test("multiple filters combine with AND", () => {
  const txns = [
    tx({ id: "1", label: "CARREFOUR", amount: -60, date: "2026-07-10" }),
    tx({ id: "2", label: "CARREFOUR", amount: -5, date: "2026-07-10" }),
    tx({ id: "3", label: "CARREFOUR", amount: -60, date: "2026-05-10" }),
  ];
  const r = filterTransactions(txns, filters({ text: "carrefour", amountMin: 50, dateFrom: "2026-07-01" }), ownable);
  expect(r.map((t) => t.id)).toEqual(["1"]);
});

test("no filter returns everything", () => {
  const txns = [tx({ id: "1" }), tx({ id: "2" })];
  expect(filterTransactions(txns, EMPTY_FILTERS, ownable)).toHaveLength(2);
  expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
  expect(hasActiveFilters(filters({ text: "x" }))).toBe(true);
});

test("summarize splits out/in and computes net", () => {
  const txns = [tx({ amount: -18 }), tx({ amount: -12 }), tx({ amount: 652 })];
  expect(summarize(txns)).toEqual({ count: 3, out: 30, in: 652, net: 622 });
});
