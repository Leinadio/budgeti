import { expect, test } from "vitest";
import { resolveOwnership, type OwnableGroup, type OwnedTxn } from "../../src/lib/ownership";

const courses: OwnableGroup = { id: 1, accountId: "a1", direction: "out", kind: "envelope", keywords: ["CARREFOUR", "LECLERC"] };
const abo: OwnableGroup = { id: 2, accountId: "a1", direction: "out", kind: "recurring", keywords: ["SPOTIFY"] };
const salaire: OwnableGroup = { id: 3, accountId: "a1", direction: "in", kind: "recurring", keywords: ["REMU"] };
const groups = [courses, abo, salaire];

function txn(p: Partial<OwnedTxn>): OwnedTxn {
  return { id: "t", date: "2026-07-01", amount: -10, label: "", accountId: "a1", groupId: null, ...p };
}

test("manual attachment wins", () => {
  expect(resolveOwnership(txn({ groupId: 2, label: "CARREFOUR" }), groups)).toEqual({ status: "manual", groupId: 2 });
});

test("single keyword match -> auto", () => {
  expect(resolveOwnership(txn({ label: "PAIEMENT CARREFOUR CITY" }), groups)).toEqual({ status: "auto", groupId: 1 });
});

test("excluded forces none, overriding keyword match and manual group", () => {
  expect(resolveOwnership(txn({ label: "CARREFOUR", excluded: true }), groups)).toEqual({ status: "none" });
  expect(resolveOwnership(txn({ groupId: 1, excluded: true }), groups)).toEqual({ status: "none" });
});

test("multiple matches -> ambiguous", () => {
  const dup: OwnableGroup = { id: 4, accountId: "a1", direction: "out", kind: "envelope", keywords: ["CARREFOUR"] };
  expect(resolveOwnership(txn({ label: "CARREFOUR" }), [...groups, dup])).toEqual({ status: "ambiguous" });
});

test("no match -> none", () => {
  expect(resolveOwnership(txn({ label: "BOULANGERIE" }), groups)).toEqual({ status: "none" });
});

test("sign must match direction", () => {
  // crédit ne matche pas une enveloppe out
  expect(resolveOwnership(txn({ amount: 10, label: "CARREFOUR" }), groups)).toEqual({ status: "none" });
  // crédit matche un groupe in
  expect(resolveOwnership(txn({ amount: 2000, label: "VIR REMU" }), groups)).toEqual({ status: "auto", groupId: 3 });
});

test("other account is ignored", () => {
  expect(resolveOwnership(txn({ accountId: "a2", label: "CARREFOUR" }), groups)).toEqual({ status: "none" });
});

test("manual to a group of another account falls through to keyword", () => {
  const other: OwnableGroup = { id: 9, accountId: "a2", direction: "out", kind: "envelope", keywords: [] };
  expect(resolveOwnership(txn({ groupId: 9, label: "CARREFOUR" }), [...groups, other])).toEqual({ status: "auto", groupId: 1 });
});
