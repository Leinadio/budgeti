import { expect, test } from "vitest";
import { resolveOwnership, type OwnableGroup, type OwnedTxn } from "../../src/lib/ownership";

const courses: OwnableGroup = { id: 1, accountId: "a1", direction: "out", kind: "envelope" };
const abo: OwnableGroup = { id: 2, accountId: "a1", direction: "out", kind: "recurring" };
const salaire: OwnableGroup = { id: 3, accountId: "a1", direction: "in", kind: "recurring" };
const groups = [courses, abo, salaire];

function txn(p: Partial<OwnedTxn>): OwnedTxn {
  return { id: "t", date: "2026-07-01", amount: -10, label: "", accountId: "a1", groupId: null, ...p };
}

test("manual attachment to a group of the same account -> manual", () => {
  expect(resolveOwnership(txn({ groupId: 2, label: "CARREFOUR" }), groups)).toEqual({ status: "manual", groupId: 2 });
});

test("keyword no longer auto-matches -> none", () => {
  expect(resolveOwnership(txn({ label: "PAIEMENT CARREFOUR CITY" }), groups)).toEqual({ status: "none" });
});

test("multiple groups sharing a keyword: still none without manual attachment", () => {
  const dup: OwnableGroup = { id: 4, accountId: "a1", direction: "out", kind: "envelope" };
  expect(resolveOwnership(txn({ label: "CARREFOUR" }), [...groups, dup])).toEqual({ status: "none" });
});

test("excluded forces none, overriding a manual group", () => {
  expect(resolveOwnership(txn({ label: "CARREFOUR", excluded: true }), groups)).toEqual({ status: "none" });
  expect(resolveOwnership(txn({ groupId: 1, excluded: true }), groups)).toEqual({ status: "none" });
});

test("no manual group -> none (even if a keyword would have matched)", () => {
  expect(resolveOwnership(txn({ label: "BOULANGERIE" }), groups)).toEqual({ status: "none" });
  expect(resolveOwnership(txn({ amount: 2000, label: "VIR REMU" }), groups)).toEqual({ status: "none" });
});

test("manual to a group of another account -> none (not owned)", () => {
  const other: OwnableGroup = { id: 9, accountId: "a2", direction: "out", kind: "envelope" };
  expect(resolveOwnership(txn({ groupId: 9, label: "CARREFOUR" }), [...groups, other])).toEqual({ status: "none" });
});

test("manual group on another account is ignored", () => {
  expect(resolveOwnership(txn({ accountId: "a2", groupId: 1 }), groups)).toEqual({ status: "none" });
});
