import { expect, test } from "vitest";
import { monthRemuneration } from "../../src/lib/remuneration";
import type { Group, Txn } from "../../src/lib/forecast";

const principalGroup: Group = {
  id: 1, accountId: "a1", name: "Rémunération principale", direction: "in", kind: "recurring",
  monthlyAmount: null, keywords: [], lines: [], incomeKind: "principal",
};
const supGroup: Group = {
  id: 2, accountId: "a1", name: "Rémunération supplémentaire", direction: "in", kind: "envelope",
  monthlyAmount: 0, keywords: [], lines: [], incomeKind: "supplementary",
};
const courses: Group = {
  id: 3, accountId: "a1", name: "Courses", direction: "out", kind: "envelope",
  monthlyAmount: 652.09, keywords: [], lines: [], incomeKind: null,
};

function txn(p: Partial<Txn> & { id: string; date: string; amount: number; groupId: number | null }): Txn {
  return { label: "x", accountId: "a1", excluded: false, lineId: null, incomeKind: null, ...p };
}

test("principal/supplementary come from the owning group's income_kind", () => {
  const txns: Txn[] = [
    txn({ id: "t1", date: "2026-07-01", amount: 652.09, groupId: 1 }),
    txn({ id: "t2", date: "2026-07-15", amount: 47.91, groupId: 2 }),
    txn({ id: "t3", date: "2026-07-15", amount: -700, groupId: 3 }),
  ];
  const r = monthRemuneration([principalGroup, supGroup, courses], txns, "2026-07");
  expect(r.principal).toBeCloseTo(652.09, 2);
  expect(r.supplementary).toBeCloseTo(47.91, 2);
  expect(r.expenses).toBeCloseTo(700, 2);
  expect(r.balanceVsPrincipal).toBeCloseTo(-47.91, 2);
  expect(r.balanceVsTotal).toBeCloseTo(0, 2);
  expect(r.suggestedNextPrincipal).toBeCloseTo(700, 2);
});

test("other months and uncategorized ignored; multiple principal groups summed", () => {
  const principal2: Group = { ...principalGroup, id: 4, name: "Prime récurrente" };
  const txns: Txn[] = [
    txn({ id: "t1", date: "2026-07-01", amount: 500, groupId: 1 }),
    txn({ id: "t2", date: "2026-07-03", amount: 300, groupId: 4 }),
    txn({ id: "t3", date: "2026-06-01", amount: 999, groupId: 1 }),
    txn({ id: "t4", date: "2026-07-10", amount: -30, groupId: null }),
  ];
  const r = monthRemuneration([principalGroup, principal2, supGroup, courses], txns, "2026-07");
  expect(r.principal).toBeCloseTo(800, 2);
  expect(r.supplementary).toBe(0);
  expect(r.expenses).toBe(0);
});
