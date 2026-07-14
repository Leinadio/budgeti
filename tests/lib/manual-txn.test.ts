import { expect, test } from "vitest";
import { isValidManualForm, toManualInput, type ManualFormInput } from "../../src/lib/manual-txn";

const base: ManualFormInput = {
  accountId: "a1", date: "2026-07-01", direction: "in", amount: 652.09, label: "Rémunération",
  groupId: null, lineId: null, incomeKind: "principal",
};

test("toManualInput signs amount by direction and clears incomeKind for expenses", () => {
  expect(toManualInput(base).amount).toBeCloseTo(652.09, 2);
  const out = toManualInput({ ...base, direction: "out", amount: 30, incomeKind: "principal" });
  expect(out.amount).toBeCloseTo(-30, 2);
  expect(out.incomeKind).toBeNull();
});

test("toManualInput defaults incomeKind to principal and label when missing", () => {
  const r = toManualInput({ ...base, incomeKind: null, label: "  " });
  expect(r.incomeKind).toBe("principal");
  expect(r.label).toBe("Entrée manuelle");
});

test("isValidManualForm rejects bad date, zero and non-finite amounts, empty account", () => {
  expect(isValidManualForm(base)).toBe(true);
  expect(isValidManualForm({ ...base, date: "2026/07/01" })).toBe(false);
  expect(isValidManualForm({ ...base, amount: 0 })).toBe(false);
  expect(isValidManualForm({ ...base, amount: Number.NaN })).toBe(false);
  expect(isValidManualForm({ ...base, accountId: "" })).toBe(false);
});
