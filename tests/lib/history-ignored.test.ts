import { expect, describe, it } from "vitest";
import { computeIgnoredBlocks, computeHistory, grandTotals, type DatedBudgets } from "../../src/lib/history";
import type { Group, Txn } from "../../src/lib/forecast";
import { seedDated, mergeDated } from "./dated-fixtures";

function tx(p: Partial<Txn>): Txn {
  return { id: "t", date: "2026-07-05", amount: -10, label: "", accountId: "a1", groupId: null, ...p };
}

const months = ["2026-06", "2026-07"];

// Enveloppe locale : sème les montants des fixtures comme le fait la reprise de
// données (cf. tests/lib/history.test.ts).
const hist = (
  groups: Group[], txns: Txn[], monthList: string[], current: string, extra?: DatedBudgets,
) => {
  const { dated, datedLines } = seedDated(groups);
  return computeHistory(groups, txns, monthList, current, mergeDated(dated, extra), datedLines);
};

describe("Section « Non comptabilisées » du tableau de l'historique", () => {
  it("devrait séparer les reçus des dépenses en deux blocs", () => {
    const blocks = computeIgnoredBlocks(
      [
        tx({ id: "a", date: "2026-07-02", amount: -30, label: "PRET AMI" }),
        tx({ id: "b", date: "2026-07-24", amount: 24.56, label: "VIR JONATHAN" }),
      ],
      months,
    );
    expect(blocks.map((b) => b.direction)).toEqual(["in", "out"]);
    expect(blocks[0].txns.map((t) => t.id)).toEqual(["b"]);
    expect(blocks[1].txns.map((t) => t.id)).toEqual(["a"]);
  });

  it("devrait totaliser chaque bloc par mois, dans la bonne colonne", () => {
    const blocks = computeIgnoredBlocks(
      [
        tx({ id: "a", date: "2026-06-10", amount: -30 }),
        tx({ id: "b", date: "2026-07-02", amount: -12 }),
        tx({ id: "c", date: "2026-07-24", amount: 24.56 }),
      ],
      months,
    );
    const out = blocks.find((b) => b.direction === "out")!;
    const inn = blocks.find((b) => b.direction === "in")!;
    expect(out.totals).toEqual([{ depense: 30, recu: 0 }, { depense: 12, recu: 0 }]);
    expect(inn.totals).toEqual([{ depense: 0, recu: 0 }, { depense: 0, recu: 24.56 }]);
  });

  it("ne devrait garder que les transactions des mois affichés", () => {
    const blocks = computeIgnoredBlocks([tx({ id: "vieux", date: "2026-01-05", amount: -50 })], months);
    expect(blocks).toEqual([]);
  });

  it("ne devrait produire aucun bloc sans transaction non comptabilisée", () => {
    expect(computeIgnoredBlocks([], months)).toEqual([]);
  });

  it("ne devrait peser sur aucun total du tableau", () => {
    // Les non comptabilisées n'entrent jamais dans computeHistory : le grand total
    // est identique qu'elles existent ou non.
    const compte = [tx({ id: "a", date: "2026-07-02", amount: -30 })];
    const sections = hist([], compte, months, "2026-07");
    const grand = grandTotals(sections, months.length);
    const blocks = computeIgnoredBlocks([tx({ id: "z", date: "2026-07-03", amount: -999 })], months);
    expect(blocks).toHaveLength(1);
    expect(grandTotals(hist([], compte, months, "2026-07"), months.length)).toEqual(grand);
  });
});
