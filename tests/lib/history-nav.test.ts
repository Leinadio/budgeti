import { expect, describe, it } from "vitest";
import type { HistorySection, HistoryRow, HistoryTxn, MonthCell, SoldeColumn, PlannedSoldes } from "../../src/lib/history";
import {
  computeRevealKeys, computePrevDisplayed, rowOpenKey, lineOpenKey, uncatOpenKey,
  flattenNodes, cellsForNode, cellsForTotal, highlightedCells, rowKeyOf, withRevealed,
  selectionForDetail, selectionForRow, TOTAL_ROW,
} from "../../src/lib/history-nav";
import type { DetailNode } from "../../src/lib/history-explain";

function cell(p: Partial<MonthCell> = {}): MonthCell {
  return { budgeted: 0, depense: 0, recu: 0, balance: 0, ...p };
}

function txn(id: string): HistoryTxn {
  return { id, date: "2026-07-10", label: "ACHAT", amount: -10, month: "2026-07", groupId: null, lineId: null };
}

function row(p: Partial<HistoryRow> & { id: number }): HistoryRow {
  return {
    name: `G${p.id}`, kind: "envelope", direction: "out", incomeKind: null,
    cells: [cell()], aliveMonths: [true], subRows: [], txns: [], ...p,
  };
}

describe("Retrouver ce qu'il faut déplier pour montrer une ligne choisie dans le panneau", () => {
  it("devrait déplier le groupe qui porte une transaction", () => {
    const sec: HistorySection = {
      kind: "envelope",
      rows: [row({ id: 1, txns: [txn("t1")] })],
      totals: [cell()],
    };
    expect(computeRevealKeys([sec]).get("txn:t1")).toEqual([rowOpenKey(1)]);
  });

  it("devrait déplier le groupe ET le poste qui portent une transaction de récurrent", () => {
    // Une transaction rangée sous un poste est masquée deux fois : il faut ouvrir
    // les deux niveaux, sinon la surbrillance vise une ligne qui n'existe pas.
    const sec: HistorySection = {
      kind: "recurring",
      rows: [row({ id: 2, kind: "recurring", subRows: [{ id: 21, name: "Spotify", cells: [cell()], txns: [txn("t2")] }] })],
      totals: [cell()],
    };
    const keys = computeRevealKeys([sec]);
    expect(keys.get("txn:t2")).toEqual([rowOpenKey(2), lineOpenKey(21)]);
    // Le poste lui-même n'a besoin que de son groupe.
    expect(keys.get("subrow:21")).toEqual([rowOpenKey(2)]);
  });

  it("devrait distinguer les deux blocs de non catégorisés", () => {
    const secIn: HistorySection = { kind: "uncategorized", uncatDirection: "in", rows: [], totals: [cell()], txns: [txn("t3")] };
    const secOut: HistorySection = { kind: "uncategorized", uncatDirection: "out", rows: [], totals: [cell()], txns: [txn("t4")] };
    const keys = computeRevealKeys([secIn, secOut]);
    expect(keys.get("txn:t3")).toEqual([uncatOpenKey("in")]);
    expect(keys.get("txn:t4")).toEqual([uncatOpenKey("out")]);
    expect(uncatOpenKey("in")).not.toBe(uncatOpenKey("out"));
  });

  it("ne devrait rien demander à déplier pour une ligne toujours visible", () => {
    const sec: HistorySection = { kind: "envelope", rows: [row({ id: 1 })], totals: [cell()] };
    expect(computeRevealKeys([sec]).get("group:1")).toBeUndefined();
  });
});

describe("À quelle case renvoie le « Solde précédent » d'une ligne", () => {
  // Trois groupes empilés. En colonne Solde : 100 → 90 → 90 (le 2e groupe n'a rien
  // bougé, sa case est donc VIDE dans le tableau) → 70.
  const sections: HistorySection[] = [
    { kind: "envelope", rows: [row({ id: 1 }), row({ id: 2 }), row({ id: 3 })], totals: [cell()] },
  ];
  const solde: SoldeColumn = {
    openings: [100],
    closings: [70],
    rowRunning: { 1: [90], 2: [90], 3: [70] },
    uncategorizedRunning: null,
  };
  const planned: PlannedSoldes = {
    prevuClosings: [70],
    depassClosings: [70],
    prevuRowRunning: { 1: [90], 2: [90], 3: [70] },
    depassRowRunning: { 1: [90], 2: [90], 3: [70] },
    uncatPrevuRunning: {},
    uncatDepassRunning: {},
  };
  const prev = computePrevDisplayed(sections, ["2026-07"], "2026-07", solde, planned);

  it("devrait renvoyer la première ligne vers l'argent de départ", () => {
    expect(prev.solde.get("group:1")).toEqual(["opening"]);
  });

  it("devrait renvoyer une ligne vers celle juste au-dessus quand celle-ci a bougé le solde", () => {
    expect(prev.solde.get("group:2")).toEqual(["group:1"]);
  });

  it("devrait sauter une case vide et pointer la dernière valeur réellement affichée", () => {
    // Le groupe 2 n'a rien bougé : sa case est vide. Surligner une case vide ne
    // montrerait rien — on remonte au groupe 1.
    expect(prev.solde.get("group:3")).toEqual(["group:1"]);
  });

  it("devrait tenir le même raisonnement sur les trois colonnes de solde", () => {
    expect(prev.soldePrevu.get("group:3")).toEqual(["group:1"]);
    expect(prev.soldeDepass.get("group:3")).toEqual(["group:1"]);
  });

  it("ne devrait donner aucun précédent à l'argent de départ, qui ouvre la colonne", () => {
    expect(prev.solde.get("opening")).toEqual([undefined]);
  });

  it("devrait donner une réponse par mois affiché", () => {
    const twoMonths = computePrevDisplayed(
      sections,
      ["2026-06", "2026-07"],
      "2026-07",
      { openings: [100, 100], closings: [70, 70], rowRunning: { 1: [90, 100], 2: [90, 90], 3: [70, 70] }, uncategorizedRunning: null },
      {
        prevuClosings: [70, 70], depassClosings: [70, 70],
        prevuRowRunning: { 1: [90, 100], 2: [90, 90], 3: [70, 70] },
        depassRowRunning: { 1: [90, 100], 2: [90, 90], 3: [70, 70] },
        uncatPrevuRunning: {}, uncatDepassRunning: {},
      },
    );
    // Juin : le groupe 1 a bougé (100 → 90), il est affiché. Juillet : il n'a rien
    // bougé (100 → 100), donc le groupe 2 remonte jusqu'à l'ouverture.
    expect(twoMonths.solde.get("group:2")).toEqual(["group:1", "opening"]);
  });

  it("devrait traverser les non catégorisés comme n'importe quelle étape", () => {
    const withUncat: HistorySection[] = [
      { kind: "envelope", rows: [row({ id: 1 })], totals: [cell()] },
      { kind: "uncategorized", uncatDirection: "out", rows: [], totals: [cell()], txns: [] },
    ];
    const p = computePrevDisplayed(
      withUncat,
      ["2026-07"],
      "2026-07",
      { openings: [100], closings: [50], rowRunning: { 1: [90] }, uncategorizedRunning: { out: [50] } },
      {
        prevuClosings: [50], depassClosings: [50],
        prevuRowRunning: { 1: [90] }, depassRowRunning: { 1: [90] },
        uncatPrevuRunning: { out: [50] }, uncatDepassRunning: { out: [50] },
      },
    );
    expect(p.solde.get("section:uncategorized")).toEqual(["group:1"]);
  });
});

// --- La chaîne du clic dans le side panel ------------------------------------
// Cliquer une ligne du panneau doit allumer les bonnes cases du tableau, révéler
// celles qui sont repliées, et laisser l'ancre allumée. Tout ce qui suit était
// jusqu'ici enfermé dans le JSX des composants, donc invérifiable.

describe("Aplatir l'arbre du panneau en lignes cliquables", () => {
  const tree: DetailNode[] = [
    { label: "Budget", amount: 300, ref: "group:1::budget::0" },
    {
      label: "Dépensé",
      amount: -350,
      ref: "group:1::depense::0",
      children: [
        { label: "2026-07-10 · CARREFOUR", amount: -200, ref: "txn:t1::depense::0" },
        { label: "2026-07-20 · LIDL", amount: -150, ref: "txn:t2::depense::0" },
      ],
    },
  ];

  it("ne devrait montrer que les lignes de premier niveau tant que rien n'est déplié", () => {
    const rows = flattenNodes(tree, new Set());
    expect(rows.map((r) => r.label)).toEqual(["Budget", "Dépensé"]);
    expect(rows.map((r) => r.path)).toEqual(["0", "1"]);
  });

  it("devrait insérer les enfants juste sous la ligne dépliée, avec un retrait", () => {
    const rows = flattenNodes(tree, new Set(["1"]));
    expect(rows.map((r) => r.path)).toEqual(["0", "1", "1.0", "1.1"]);
    expect(rows.map((r) => r.depth)).toEqual([0, 0, 1, 1]);
  });

  it("devrait signaler quelles lignes se déplient et lesquelles sont ouvertes", () => {
    const rows = flattenNodes(tree, new Set(["1"]));
    expect(rows[0].hasChildren).toBe(false);
    expect(rows[1].hasChildren).toBe(true);
    expect(rows[1].expanded).toBe(true);
  });

  it("ne devrait pas croire dépliable une ligne dont la liste d'enfants est vide", () => {
    const rows = flattenNodes([{ label: "Vide", amount: 0, children: [] }], new Set(["0"]));
    expect(rows[0].hasChildren).toBe(false);
    expect(rows[0].expanded).toBe(false);
  });

  it("devrait donner à chaque ligne un chemin unique, même à plusieurs niveaux", () => {
    const rows = flattenNodes(tree, new Set(["1"]));
    expect(new Set(rows.map((r) => r.path)).size).toBe(rows.length);
  });
});

describe("Quelles cases s'allument quand on clique une ligne du panneau", () => {
  const detail = { title: "Reste", nodes: [], result: 0, cellRef: "group:1::reste::0" };

  it("devrait allumer la case propre de la ligne", () => {
    expect(cellsForNode({ label: "Budget", amount: 300, ref: "group:1::budget::0" }, detail.cellRef))
      .toEqual(["group:1::budget::0"]);
  });

  it("devrait allumer ensemble toutes les cases d'une somme éclatée dans le tableau", () => {
    // « Dépassement cumulé » n'apparaît nulle part tel quel : on allume les Balances
    // rouges qui le composent.
    const node = {
      label: "Dépassement cumulé",
      amount: -80,
      refs: ["group:1::reste::0", "group:2::reste::0"],
      ref: "ignoré",
    };
    expect(cellsForNode(node, detail.cellRef)).toEqual(["group:1::reste::0", "group:2::reste::0"]);
  });

  it("devrait retomber sur la case qui a ouvert le calcul quand la ligne ne vise rien", () => {
    expect(cellsForNode({ label: "Solde précédent", amount: 10 }, detail.cellRef)).toEqual(["group:1::reste::0"]);
  });

  it("ne devrait rien allumer quand ni la ligne ni le calcul ne visent de case", () => {
    expect(cellsForNode({ label: "x", amount: 1 }, undefined)).toBeNull();
  });

  it("devrait faire allumer au Total la case dont il montre le calcul", () => {
    expect(cellsForTotal(detail)).toEqual(["group:1::reste::0"]);
    expect(cellsForTotal({ title: "Colonne", nodes: [], result: 0 })).toBeNull();
  });

  it("devrait donner au Total une identité distincte des lignes du calcul", () => {
    // Sans ça, cliquer une ligne intermédiaire qui vise la même case activerait
    // aussi la ligne « Total ».
    expect(TOTAL_ROW).not.toBe("0");
    expect(TOTAL_ROW).not.toMatch(/^\d/);
  });
});

describe("Ce que le tableau garde allumé", () => {
  it("devrait garder l'ancre allumée en plus de la case choisie dans le panneau", () => {
    // L'ancre est le montant cliqué dans le tableau : il reste visible tant que le
    // panneau est ouvert, sinon on perd de vue d'où vient le calcul affiché.
    const set = highlightedCells("group:1::reste::0", ["group:1::budget::0"]);
    expect([...set].sort()).toEqual(["group:1::budget::0", "group:1::reste::0"]);
  });

  it("devrait allumer toutes les cases d'une somme à la fois", () => {
    expect(highlightedCells(null, ["a::reste::0", "b::reste::0"]).size).toBe(2);
  });

  it("ne devrait rien allumer quand rien n'est sélectionné", () => {
    expect(highlightedCells(null, null).size).toBe(0);
  });

  it("ne devrait pas allumer deux fois la case qui est à la fois l'ancre et la sélection", () => {
    expect(highlightedCells("group:1::reste::0", ["group:1::reste::0"]).size).toBe(1);
  });
});

describe("Retrouver la ligne du tableau visée par une case", () => {
  it("devrait isoler la ligne d'une clé de case", () => {
    expect(rowKeyOf("txn:abc::depense::2")).toBe("txn:abc");
    expect(rowKeyOf("group:7::reste::0")).toBe("group:7");
    expect(rowKeyOf("opening::solde::0")).toBe("opening");
  });

  it("ne devrait rien répondre quand aucune case n'est active", () => {
    expect(rowKeyOf(null)).toBeNull();
  });

  it("ne devrait rien inventer face à une clé qui n'en est pas une", () => {
    expect(rowKeyOf("nimportequoi")).toBeNull();
  });
});

describe("Révéler dans le tableau la ligne choisie dans le panneau", () => {
  const reveal = new Map<string, string[]>([["txn:t1", ["g:1", "l:21"]]]);

  it("devrait ouvrir les dépliages qui la cachent, sans toucher à ceux de l'utilisateur", () => {
    const open = new Set(["g:9"]);
    const eff = withRevealed(open, "txn:t1", reveal);
    expect([...eff].sort()).toEqual(["g:1", "g:9", "l:21"]);
    // L'état de l'utilisateur n'est pas muté : refermer le panneau le retrouve intact.
    expect([...open]).toEqual(["g:9"]);
  });

  it("devrait rendre l'état inchangé quand la ligne est déjà visible", () => {
    // Même objet : la grille ne se redessine pas pour rien.
    const open = new Set(["g:1", "l:21"]);
    expect(withRevealed(open, "txn:t1", reveal)).toBe(open);
  });

  it("devrait rendre l'état inchangé quand rien n'est sélectionné", () => {
    const open = new Set(["g:1"]);
    expect(withRevealed(open, null, reveal)).toBe(open);
  });

  it("devrait rendre l'état inchangé pour une ligne toujours visible, qui n'a rien à révéler", () => {
    const open = new Set<string>();
    expect(withRevealed(open, "group:3", reveal)).toBe(open);
  });
});

describe("Ce que devient la sélection quand on ouvre un nouveau calcul", () => {
  it("devrait prendre pour ancre le montant cliqué dans le tableau et repartir sans sélection", () => {
    const s = selectionForDetail({ title: "Reste", nodes: [], result: 0, cellRef: "group:1::reste::0" });
    expect(s).toEqual({ anchor: "group:1::reste::0", selected: null, panel: null });
  });

  it("ne devrait poser aucune ancre pour un panneau ouvert autrement qu'en cliquant une case", () => {
    // Explication de colonne, gestion de groupe : rien à surligner dans le tableau.
    expect(selectionForDetail({ title: "Colonne", nodes: [], result: 0, description: ["…"] }).anchor).toBeNull();
  });

  it("devrait tout éteindre à la fermeture du panneau", () => {
    expect(selectionForDetail(null)).toEqual({ anchor: null, selected: null, panel: null });
  });

  it("devrait garder l'ancre quand on clique une ligne du calcul", () => {
    const opened = selectionForDetail({ title: "Reste", nodes: [], result: 0, cellRef: "group:1::reste::0" });
    const clicked = selectionForRow(opened, ["group:1::budget::0"], "0");
    expect(clicked.anchor).toBe("group:1::reste::0");
    expect(clicked.selected).toEqual(["group:1::budget::0"]);
    expect(clicked.panel).toBe("0");
  });

  it("devrait remplacer la sélection précédente, pas s'y ajouter", () => {
    const first = selectionForRow({ anchor: null, selected: null, panel: null }, ["a::reste::0"], "0");
    const second = selectionForRow(first, ["b::reste::0"], "1");
    expect(second.selected).toEqual(["b::reste::0"]);
    expect(second.panel).toBe("1");
  });
});
