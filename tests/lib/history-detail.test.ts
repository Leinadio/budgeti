import { expect, describe, it } from "vitest";
import type { HistoryRow, HistorySection, HistoryTxn, MonthCell, SoldeColumn } from "../../src/lib/history";
import { netCol, colOf, groupNode, sectionNode, negateNode, txnChildren, budgetNodes, labelOfSection, sectionRowKey, soldeActuelDetail, budgetEditOfGroup, budgetEditOfLine, detailKey } from "../../src/lib/history-detail";
import type { DetailNode } from "../../src/lib/history-explain";

function cell(p: Partial<MonthCell> = {}): MonthCell {
  return { budgeted: 0, depense: 0, recu: 0, balance: 0, ...p };
}

function txn(id: string, date: string, amount: number, label = "ACHAT"): HistoryTxn {
  return { id, date, label, amount, month: date.slice(0, 7), groupId: null, lineId: null };
}

// Courses : enveloppe de 300, 350 dépensés en juillet (donc 50 de dépassement).
const courses: HistoryRow = {
  id: 1,
  name: "Courses",
  direction: "out",
  cells: [cell({ budgeted: 300, depense: 0, balance: 300 }), cell({ budgeted: 300, depense: 350, balance: -50 })],
  aliveMonths: [true, true],
  subRows: [],
  txns: [txn("t1", "2026-07-10", -200, "CARREFOUR"), txn("t2", "2026-07-20", -150, "LIDL")],
};

// Salaire : rémunération principale de 2000, reçue en juillet.
const salaire: HistoryRow = {
  id: 9,
  name: "Salaire",
  direction: "in",
  cells: [cell({ budgeted: 2000, recu: 2000 }), cell({ budgeted: 2000, recu: 0 })],
  aliveMonths: [true, true],
  subRows: [],
  txns: [txn("t3", "2026-06-01", 2000, "VIREMENT PAIE")],
};

const envelopeSec: HistorySection = {
  kind: "expense",
  rows: [courses],
  totals: [cell({ budgeted: 300, balance: 300 }), cell({ budgeted: 300, depense: 350, balance: -50 })],
};

const incomeSec: HistorySection = {
  kind: "income",
  rows: [salaire],
  totals: [cell({ budgeted: 2000, recu: 2000 }), cell({ budgeted: 2000 })],
};

// Non catégorisés côté dépenses : 120 sortis en juillet, aucune provision.
const uncatOut: HistorySection = {
  kind: "uncategorized",
  rows: [],
  uncatDirection: "out",
  totals: [cell(), cell({ depense: 120, balance: -120 })],
  txns: [txn("t4", "2026-07-05", -120, "SANS GROUPE")],
};

// Non catégorisés côté reçus : 40 encaissés en juillet.
const uncatIn: HistorySection = {
  kind: "uncategorized",
  rows: [],
  uncatDirection: "in",
  totals: [cell(), cell({ recu: 40 })],
  txns: [txn("t5", "2026-07-06", 40, "REMBOURSEMENT")],
};

// Parcourt tout l'arbre d'un détail, nœuds compris.
function walk(nodes: DetailNode[], visit: (n: DetailNode) => void): void {
  for (const n of nodes) {
    visit(n);
    if (n.children) walk(n.children, visit);
  }
}

describe("La colonne du tableau où tombe le montant d'un nœud", () => {
  it("devrait envoyer un mouvement purement sortant dans la colonne Dép.", () => {
    expect(netCol(cell({ depense: 350 }))).toBe("depense");
  });

  it("devrait envoyer un mouvement purement entrant dans la colonne Reçu", () => {
    expect(netCol(cell({ recu: 2000 }))).toBe("recu");
  });

  it("devrait retomber sur la colonne Solde quand le mois mélange entrées et sorties", () => {
    // Aucune des deux colonnes ne porte seule le net : c'est le Solde qui le montre.
    expect(netCol(cell({ depense: 350, recu: 40 }))).toBe("solde");
  });

  it("devrait donner à chaque nature de montant sa colonne", () => {
    const c = cell({ depense: 350, budgeted: 300 });
    expect(colOf("depense", c)).toBe("depense");
    expect(colOf("recu", c)).toBe("recu");
    expect(colOf("budget", c)).toBe("budget");
  });
});

describe("Un groupe vu comme une ligne du calcul affiché dans le panneau", () => {
  it("devrait porter le montant dépensé du mois et renvoyer vers sa case Dép.", () => {
    const n = groupNode(courses, 1, "2026-07", "depense");
    expect(n.label).toBe("Courses");
    expect(n.amount).toBe(350);
    expect(n.ref).toBe("group:1::depense::1");
  });

  it("devrait se déplier en les transactions du mois demandé, et d'aucun autre", () => {
    const n = groupNode(courses, 1, "2026-07", "depense");
    expect(n.children).toHaveLength(2);
    expect(n.children!.map((c) => c.label)).toEqual([
      "2026-07-10 · CARREFOUR",
      "2026-07-20 · LIDL",
    ]);
    // Juin n'a aucune transaction : la ligne reste non dépliable.
    expect(groupNode(courses, 0, "2026-06", "depense").children).toBeUndefined();
  });

  it("devrait renvoyer une rémunération vers sa case Reçu même quand rien n'est encore arrivé", () => {
    // netCol seul retomberait sur « Dép. » pour une entrée à 0 : la case surlignée
    // serait alors vide, du mauvais côté du tableau.
    const n = groupNode(salaire, 1, "2026-07", "net");
    expect(n.amount).toBe(0);
    expect(n.ref).toBe("group:9::recu::1");
  });

  it("ne devrait pas proposer de transactions sous un budget : un budget n'en a pas", () => {
    expect(groupNode(courses, 1, "2026-07", "budget").children).toBeUndefined();
  });
});

describe("Une section vue comme une ligne du calcul", () => {
  it("devrait nommer chaque section comme le tableau la nomme", () => {
    expect(labelOfSection("income")).toBe("Revenus");
    expect(labelOfSection("expense")).toBe("Dépenses");
    expect(labelOfSection("uncategorized")).toBe("Non catégorisés");
  });

  it("devrait distinguer les deux lignes « Non catégorisés » du tableau", () => {
    // Les reçus et les dépenses non catégorisés sont deux lignes distinctes : sans
    // clés distinctes, cliquer l'une surlignerait l'autre.
    expect(sectionRowKey(uncatIn)).not.toBe(sectionRowKey(uncatOut));
    expect(sectionRowKey(uncatOut)).toBe("section:uncategorized");
  });

  it("devrait se déplier en ses groupes, transactions comprises", () => {
    const n = sectionNode(envelopeSec, 1, "2026-07", "depense");
    expect(n.amount).toBe(350);
    expect(n.children).toHaveLength(1);
    expect(n.children![0].children).toHaveLength(2);
  });

  it("devrait se déplier directement en transactions pour les non catégorisés, qui n'ont pas de groupes", () => {
    const n = sectionNode(uncatOut, 1, "2026-07", "depense");
    expect(n.children).toHaveLength(1);
    expect(n.children![0].label).toBe("2026-07-05 · SANS GROUPE");
    // Colonne Dép. : le montant est pris positivement, comme la case du tableau.
    expect(n.children![0].amount).toBe(120);
  });

  it("devrait garder le vrai signe de chaque transaction dans le mouvement net des non catégorisés", () => {
    // Une section « out » ne contient que des sorties, mais le net doit rester lisible
    // comme une somme signée, sinon le Solde ne retombe pas.
    const n = sectionNode(uncatOut, 1, "2026-07", "net");
    expect(n.children![0].amount).toBe(-120);
  });

  it("devrait écarter les groupes à zéro d'une colonne chiffrée, mais pas d'un net", () => {
    const dep = sectionNode(incomeSec, 1, "2026-07", "depense");
    expect(dep.children ?? []).toHaveLength(0);
    // En « net », toutes les lignes restent : la chaîne du solde les traverse toutes.
    expect(sectionNode(incomeSec, 1, "2026-07", "net").children).toHaveLength(1);
  });
});

describe("Inverser une ligne pour la poser en soustraction", () => {
  it("devrait inverser le montant et celui de chacune de ses transactions", () => {
    const n = negateNode(groupNode(courses, 1, "2026-07", "depense"));
    expect(n.amount).toBe(-350);
    expect(n.children!.map((c) => c.amount)).toEqual([-200, -150]);
  });

  it("devrait laisser le renvoi vers la case du tableau intact", () => {
    const src = groupNode(courses, 1, "2026-07", "depense");
    expect(negateNode(src).ref).toBe(src.ref);
  });
});

describe("Les transactions et les postes d'une ligne", () => {
  it("devrait porter le signe demandé par le contexte de lecture", () => {
    // Dans une colonne Dépensé, les montants s'additionnent positivement ; sous un
    // « Reste », les mêmes transactions se soustraient.
    expect(txnChildren(courses, "2026-07", 1, 1)!.map((n) => n.amount)).toEqual([200, 150]);
    expect(txnChildren(courses, "2026-07", -1, 1)!.map((n) => n.amount)).toEqual([-200, -150]);
  });

  it("devrait renvoyer chaque transaction vers sa case, du bon côté du tableau", () => {
    const [first] = txnChildren(courses, "2026-07", 1, 1)!;
    expect(first.ref).toBe("txn:t1::depense::1");
  });

  it("ne devrait pas décomposer le budget d'une enveloppe, qui n'a pas de postes", () => {
    expect(budgetNodes(courses, 1)).toBeUndefined();
  });

  it("devrait décomposer le budget d'un récurrent en ses postes non nuls", () => {
    const loyer: HistoryRow = {
      ...courses,
      id: 2,
      name: "Loyer",
      subRows: [
        { id: 21, name: "Loyer", cells: [cell({ budgeted: 800 }), cell({ budgeted: 800 })], aliveMonths: [true, true], txns: [] },
        { id: 22, name: "Assurance", cells: [cell(), cell()], aliveMonths: [true, true], txns: [] },
      ],
    };
    const nodes = budgetNodes(loyer, 1)!;
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ label: "Loyer", amount: 800, ref: "subrow:21::budget::1" });
  });
});

describe("Le détail du Solde actuel", () => {
  const solde: SoldeColumn = {
    openings: [1000, 1500],
    closings: [1500, 1420],
    rowRunning: {},
    uncategorizedRunning: null,
  };

  it("devrait partir de l'argent de départ, puis enchaîner chaque section", () => {
    const d = soldeActuelDetail([incomeSec, envelopeSec, uncatOut], solde, 1, "2026-07", {
      title: "Solde actuel",
      result: 1420,
    });
    expect(d.title).toBe("Solde actuel");
    expect(d.nodes.map((n) => n.label)).toEqual([
      "Argent de départ",
      "Revenus",
      "Dépenses",
      "Non catégorisés",
    ]);
    expect(d.nodes[0].amount).toBe(1500);
    expect(d.result).toBe(1420);
  });

  it("devrait retomber exactement sur le solde affiché", () => {
    // 1500 d'ouverture, 0 reçu, 350 dépensés, 120 non catégorisés → 1030.
    const d = soldeActuelDetail([incomeSec, envelopeSec, uncatOut], solde, 1, "2026-07", {
      title: "Solde actuel",
      result: 1030,
    });
    expect(d.nodes.reduce((s, n) => s + n.amount, 0)).toBeCloseTo(d.result, 5);
  });
});

describe("L'invariant de lecture du panneau : un total est la somme de ce qu'il déplie", () => {
  const sections = [incomeSec, uncatIn, envelopeSec, uncatOut];
  const cases: { name: string; nodes: DetailNode[] }[] = [
    { name: "Dépensé du mois", nodes: sections.map((s) => sectionNode(s, 1, "2026-07", "depense")) },
    { name: "Reçu du mois", nodes: sections.map((s) => sectionNode(s, 1, "2026-07", "recu")) },
    { name: "Mouvement net du mois", nodes: sections.map((s) => sectionNode(s, 1, "2026-07", "net")) },
    { name: "Dépensé d'un groupe", nodes: [groupNode(courses, 1, "2026-07", "depense")] },
  ];

  for (const c of cases) {
    it(`devrait, pour « ${c.name} », faire retomber chaque ligne dépliée sur son propre montant`, () => {
      walk(c.nodes, (n) => {
        if (!n.children || n.children.length === 0) return;
        const sum = n.children.reduce((s, k) => s + k.amount, 0);
        expect(sum, `« ${n.label} » annonce ${n.amount} mais déplie ${sum}`).toBeCloseTo(n.amount, 5);
      });
    });
  }

  it("devrait donner à chaque ligne un renvoi vers une case bien formée du bon mois", () => {
    // Un renvoi mal formé (mauvaise colonne, mauvais mois) n'échoue pas : il surligne
    // silencieusement dans le vide. On vérifie donc la forme « ligne::colonne::mois ».
    const cols = ["budget", "depense", "recu", "reste", "solde", "revenus", "depassement", "soldePrevu", "soldeDepass"];
    walk(
      cases.flatMap((c) => c.nodes),
      (n) => {
        if (!n.ref) return;
        const parts = n.ref.split("::");
        expect(parts, `renvoi mal formé : ${n.ref}`).toHaveLength(3);
        expect(cols, `colonne inconnue dans ${n.ref}`).toContain(parts[1]);
        expect(parts[2], `mois inattendu dans ${n.ref}`).toBe("1");
      },
    );
  });
});

// Le montant d'un budget se modifie depuis SA case « Budget dép. », au mois de la
// colonne cliquée. C'est le seul endroit où le mois est visible, donc le seul où un
// montant daté a un sens : le panneau de gestion du groupe, lui, ne montre aucun
// mois et n'affiche donc plus de montant du tout.
describe("Ce qu'une case « Budget dép. » laisse modifier", () => {
  const courses = {
    id: 7,
    name: "Courses",
    lines: [] as { id: number }[],
    changes: [
      { month: "2026-01", amount: 300, isStart: true, scope: "ongoing" as const },
      { month: "2026-06", amount: 350, isStart: false, scope: "ongoing" as const },
    ],
  };

  it("laisse modifier le montant d'une enveloppe, au mois de la case", () => {
    expect(budgetEditOfGroup(courses, "2026-07", "2026-07")).toEqual({
      target: "group",
      id: 7,
      name: "Courses",
      month: "2026-07",
      amount: 350,
      changes: courses.changes,
      currentMonth: "2026-07",
    });
  });

  it("propose le montant en vigueur au mois cliqué, pas le dernier de la frise", () => {
    // Vu depuis février : c'est 300 qui s'applique alors, et la hausse à 350 est
    // encore devant. Un changement futur déjà posé ne doit pas fuir dans le montant
    // proposé pour ce mois-ci.
    expect(budgetEditOfGroup(courses, "2026-02", "2026-02")?.amount).toBe(300);
  });

  // Un récurrent n'a pas de montant à lui : son budget est la somme de ses lignes.
  // Il n'y a rien à écrire au niveau du groupe, donc rien à modifier depuis sa case.
  it("ne laisse rien modifier sur la case d'un groupe récurrent", () => {
    expect(budgetEditOfGroup({ ...courses, lines: [{ id: 1 }] }, "2026-07", "2026-07")).toBeNull();
  });

  // Un mois révolu s'édite comme les autres : on y corrige un budget après coup, la
  // case doit donc proposer son formulaire, avec le montant qui valait CE mois-là.
  it("laisse modifier un mois passé", () => {
    expect(budgetEditOfGroup(courses, "2026-03", "2026-07")).toMatchObject({ month: "2026-03", amount: 300 });
  });

  it("laisse modifier un mois futur", () => {
    expect(budgetEditOfGroup(courses, "2026-09", "2026-07")?.month).toBe("2026-09");
  });

  it("ne laisse rien modifier quand le groupe est inconnu", () => {
    expect(budgetEditOfGroup(undefined, "2026-07", "2026-07")).toBeNull();
  });

  // Une ligne de récurrent porte son propre montant daté : elle s'édite comme une
  // enveloppe, depuis sa case à elle.
  it("laisse modifier le montant d'une ligne de récurrent", () => {
    const netflix = { id: 12, name: "Netflix", changes: [{ month: "2026-01", amount: 13.99, isStart: true, scope: "ongoing" as const }] };
    expect(budgetEditOfLine(netflix, "2026-07", "2026-07")).toEqual({
      target: "line",
      id: 12,
      name: "Netflix",
      month: "2026-07",
      amount: 13.99,
      changes: netflix.changes,
      currentMonth: "2026-07",
    });
  });

  it("laisse modifier une ligne dans un mois passé, mais rien sur une ligne inconnue", () => {
    const netflix = { id: 12, name: "Netflix", changes: [{ month: "2026-01", amount: 13.99, isStart: true, scope: "ongoing" as const }] };
    expect(budgetEditOfLine(netflix, "2026-03", "2026-07")).toMatchObject({ month: "2026-03", amount: 13.99 });
    expect(budgetEditOfLine(undefined, "2026-07", "2026-07")).toBeNull();
  });

  // La clé de montage doit distinguer deux cases différentes, sinon le panneau garde
  // l'état du budget précédemment ouvert (montant saisi, portée) en changeant de case.
  it("donne une identité distincte à chaque case de budget", () => {
    const base = { title: "Budget dépense", nodes: [], result: 0 };
    const groupe = { ...base, budgetEdit: budgetEditOfGroup(courses, "2026-07", "2026-07")! };
    const autreMois = { ...base, budgetEdit: budgetEditOfGroup(courses, "2026-08", "2026-07")! };
    const ligne = {
      ...base,
      budgetEdit: budgetEditOfLine({ id: 7, name: "Netflix", changes: [] }, "2026-07", "2026-07")!,
    };
    expect(detailKey(groupe)).toBe("budget:group:7:2026-07");
    expect(detailKey(autreMois)).toBe("budget:group:7:2026-08");
    // Même id, même mois, mais une ligne n'est pas un groupe : les clés diffèrent.
    expect(detailKey(ligne)).toBe("budget:line:7:2026-07");
  });
});

describe("L'identité d'un détail, qui décide quand le panneau repart de zéro", () => {
  it("devrait identifier un calcul par la case du tableau qui l'a ouvert", () => {
    expect(detailKey({ title: "Dépensé", nodes: [], result: 12, cellRef: "group:1::depense::0" })).toBe("group:1::depense::0");
  });

  it("devrait distinguer deux cases différentes qui affichent le même montant", () => {
    // Deux groupes au même budget, même mois : sans cette distinction, ouvrir l'un
    // puis l'autre gardait les dépliages du premier.
    const a = detailKey({ title: "Budget dépense", subtitle: "Juillet", nodes: [], result: 300, cellRef: "group:1::budget::0" });
    const b = detailKey({ title: "Budget dépense", subtitle: "Juillet", nodes: [], result: 300, cellRef: "group:2::budget::0" });
    expect(a).not.toBe(b);
  });

  it("devrait donner son identité propre à la gestion d'un groupe", () => {
    const k = detailKey({
      title: "Courses", nodes: [], result: 0,
      groupManage: { groupId: 3, name: "Courses", month: "2026-07", stripMin: "2026-01", stripMax: "2027-01", changes: [], lines: [] },
    });
    expect(k).toContain("3");
    expect(k).toContain("2026-07");
  });

  // Chaque ligne d'un récurrent a son propre crayon, donc son propre panneau : sa clé
  // doit être distincte de celle du groupe qui la porte, sinon ouvrir une ligne
  // rouvrirait le panneau du groupe (même id possible de part et d'autre).
  it("devrait donner son identité propre à la gestion d'une ligne, distincte du groupe", () => {
    const ligne = detailKey({
      title: "Sosh Internet", nodes: [], result: 0,
      lineManage: { lineId: 3, name: "Sosh Internet", month: "2026-07", stripMin: "2026-01", stripMax: "2027-01", changes: [] },
    });
    const groupe = detailKey({
      title: "Abonnements", nodes: [], result: 0,
      groupManage: { groupId: 3, name: "Abonnements", month: "2026-07", stripMin: "2026-01", stripMax: "2027-01", changes: [], lines: [] },
    });
    expect(ligne).toBe("line:3");
    expect(ligne).not.toBe(groupe);
  });

  it("devrait donner son identité propre à l'explication d'une colonne", () => {
    const info = detailKey({ title: "Solde prévu", nodes: [], result: 0, description: ["…"] });
    const calcul = detailKey({ title: "Solde prévu", nodes: [], result: 0, cellRef: "grand::soldePrevu::0" });
    expect(info).not.toBe(calcul);
  });

  it("devrait retomber sur le titre et le montant quand aucune case n'est visée", () => {
    expect(detailKey({ title: "Dépassement", subtitle: "Courses · juin", nodes: [], result: 50 }))
      .toBe("Dépassement·Courses · juin·50");
  });
});
