import { expect, test } from "vitest";
import { monthRemuneration } from "../../src/lib/remuneration";
import type { Group, Txn } from "../../src/lib/forecast";

const remun: Group = {
  id: 1, accountId: "a1", name: "Rémunération", direction: "in", kind: "envelope",
  monthlyAmount: null, keywords: [], lines: [],
};
const courses: Group = {
  id: 2, accountId: "a1", name: "Courses", direction: "out", kind: "envelope",
  monthlyAmount: 652.09, keywords: [], lines: [],
};

function txn(p: Partial<Txn> & { id: string; date: string; amount: number; groupId: number | null }): Txn {
  return { label: "x", accountId: "a1", excluded: false, lineId: null, incomeKind: null, ...p };
}

test("splits principal vs supplementary and computes both readings", () => {
  const txns: Txn[] = [
    txn({ id: "t1", date: "2026-07-01", amount: 652.09, groupId: 1, incomeKind: "principal" }),
    txn({ id: "t2", date: "2026-07-15", amount: 47.91, groupId: 1, incomeKind: "supplementary" }),
    txn({ id: "t3", date: "2026-07-15", amount: -700, groupId: 2 }),
  ];
  const r = monthRemuneration([remun, courses], txns, "2026-07");
  expect(r.principal).toBeCloseTo(652.09, 2);
  expect(r.supplementary).toBeCloseTo(47.91, 2);
  expect(r.expenses).toBeCloseTo(700, 2);
  expect(r.balanceVsPrincipal).toBeCloseTo(-47.91, 2);
  expect(r.balanceVsTotal).toBeCloseTo(0, 2);
  expect(r.suggestedNextPrincipal).toBeCloseTo(700, 2);
});

test("untagged income counts as principal; other months and uncategorized ignored", () => {
  const txns: Txn[] = [
    txn({ id: "t1", date: "2026-07-01", amount: 800, groupId: 1, incomeKind: null }), // non étiqueté -> principal
    txn({ id: "t2", date: "2026-06-01", amount: 500, groupId: 1, incomeKind: "principal" }), // autre mois
    txn({ id: "t3", date: "2026-07-10", amount: -30, groupId: null }), // non catégorisé -> ignoré
  ];
  const r = monthRemuneration([remun, courses], txns, "2026-07");
  expect(r.principal).toBeCloseTo(800, 2);
  expect(r.supplementary).toBe(0);
  expect(r.expenses).toBe(0);
});
