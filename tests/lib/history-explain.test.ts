import { expect, describe, it } from "vitest";
import {
  sumOf,
  makeDetail,
  makeInfo,
  txnNode,
  cellKey,
  openingRow,
  sectionRow,
  groupRow,
  subRow,
  txnRow,
  type DetailNode,
} from "../../src/lib/history-explain";

describe("Le détail affiché dans le panneau latéral quand on clique une cellule", () => {
  it("devrait additionner les montants signés de chaque ligne du détail", () => {
    const nodes: DetailNode[] = [
      { label: "Budget", amount: 150.95 },
      { label: "Dépensé", amount: -114.82 },
    ];
    expect(sumOf(nodes)).toBeCloseTo(36.13, 2);
  });

  it("devrait donner zéro quand le détail est vide", () => {
    expect(sumOf([])).toBe(0);
  });

  it("devrait totaliser le détail à partir de ses propres lignes par défaut", () => {
    const d = makeDetail("Reste", [
      { label: "Budget", amount: 150.95 },
      { label: "Dépensé", amount: -114.82 },
    ]);
    expect(d.title).toBe("Reste");
    expect(d.result).toBeCloseTo(36.13, 2);
  });

  it("devrait permettre de fixer le total affiché à part quand il diffère de la somme des lignes", () => {
    const d = makeDetail("Argent de départ", [{ label: "x", amount: 1 }], { result: -121.88, subtitle: "Juillet" });
    expect(d.result).toBe(-121.88);
    expect(d.subtitle).toBe("Juillet");
  });

  it("devrait garder le sous-titre et la note attachés au détail", () => {
    const d = makeDetail("Reste", [{ label: "x", amount: 1 }], { subtitle: "Juillet", note: "arrondi" });
    expect(d.subtitle).toBe("Juillet");
    expect(d.note).toBe("arrondi");
  });

  it("devrait permettre à une ligne de se déplier en les transactions qui la composent", () => {
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

  it("devrait étiqueter une transaction avec sa date, son libellé et un montant signé", () => {
    const n = txnNode("2026-07-13", "AVANSSUR", -81.84);
    expect(n.label).toBe("2026-07-13 · AVANSSUR");
    expect(n.amount).toBe(-81.84);
    expect(n.children).toBeUndefined();
  });

  it("devrait retenir vers quelle cellule du tableau pointe une transaction", () => {
    const ref = cellKey(txnRow("t1"), "depense", 0);
    const n = txnNode("2026-07-13", "AVANSSUR", -81.84, ref);
    expect(n.ref).toBe(ref);
  });
});

describe("Une explication de colonne en texte, au lieu d'un calcul", () => {
  it("devrait construire une explication en texte seul, sans total ni lignes", () => {
    const d = makeInfo("Solde prévu", ["Un paragraphe.", "Un autre."]);
    expect(d.title).toBe("Solde prévu");
    expect(d.nodes).toEqual([]);
    expect(d.result).toBe(0);
    expect(d.description).toEqual(["Un paragraphe.", "Un autre."]);
  });
});

describe("Relier le panneau latéral à la bonne cellule du tableau", () => {
  it("devrait construire une référence de cellule à partir d'une ligne, d'une colonne et d'un mois", () => {
    expect(cellKey(openingRow, "solde", 0)).toBe("opening::solde::0");
    expect(cellKey(groupRow(7), "reste", 3)).toBe("group:7::reste::3");
  });

  it("devrait donner à chaque type de ligne du tableau sa propre référence distincte", () => {
    expect(openingRow).toBe("opening");
    expect(sectionRow("envelope")).toBe("section:envelope");
    expect(groupRow(42)).toBe("group:42");
    expect(subRow(11)).toBe("subrow:11");
    expect(txnRow("abc")).toBe("txn:abc");
  });

  it("devrait construire des références différentes pour deux cellules qui diffèrent par la colonne ou le mois", () => {
    const a = cellKey(groupRow(1), "depense", 0);
    const b = cellKey(groupRow(1), "recu", 0);
    const c = cellKey(groupRow(1), "depense", 1);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});
