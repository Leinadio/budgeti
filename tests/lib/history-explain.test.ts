import { expect, test } from "vitest";
import { sumOf, makeDetail, txnNode, type DetailNode } from "../../src/lib/history-explain";

test("sumOf additionne les montants signés", () => {
  const nodes: DetailNode[] = [
    { label: "Budget", amount: 150.95 },
    { label: "Dépensé", amount: -114.82 },
  ];
  expect(sumOf(nodes)).toBeCloseTo(36.13, 2);
});

test("makeDetail: result = somme des nodes par défaut", () => {
  const d = makeDetail("Reste", [
    { label: "Budget", amount: 150.95 },
    { label: "Dépensé", amount: -114.82 },
  ]);
  expect(d.title).toBe("Reste");
  expect(d.result).toBeCloseTo(36.13, 2);
});

test("makeDetail: result explicite quand fourni (montant affiché forcé)", () => {
  const d = makeDetail("Argent de départ", [{ label: "x", amount: 1 }], { result: -121.88, subtitle: "Juillet" });
  expect(d.result).toBe(-121.88);
  expect(d.subtitle).toBe("Juillet");
});

test("un nœud dépliable : ses enfants totalisent la valeur du nœud", () => {
  const depense: DetailNode = {
    label: "Dépensé",
    amount: -114.82,
    children: [
      txnNode("2026-07-13", "AVANSSUR", -81.84),
      txnNode("2026-07-09", "ORANGE", -30.99),
      txnNode("2026-07-07", "PAYPAL", -1.99),
    ],
  };
  expect(sumOf(depense.children!)).toBeCloseTo(-114.82, 2);
});

test("txnNode: libellé date · label et montant signé", () => {
  const n = txnNode("2026-07-13", "AVANSSUR", -81.84);
  expect(n.label).toBe("2026-07-13 · AVANSSUR");
  expect(n.amount).toBe(-81.84);
  expect(n.children).toBeUndefined();
});
