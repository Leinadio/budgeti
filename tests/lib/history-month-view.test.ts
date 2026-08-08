// Ce qu'un tableau de mois montre dans sa colonne de gauche : les groupes qui
// vivent CE mois-là, et rien d'autre. Un tableau par mois, donc une liste de
// lignes par mois — c'est ce que cette découpe fabrique.
import { describe, expect, it } from "vitest";
import type { HistoryRow, HistorySection, HistoryTxn, MonthCell } from "../../src/lib/history";
import { sectionsAtMonth, sectionSlots } from "../../src/lib/history-month-view";

const MOIS = ["2026-06", "2026-07"];

function cell(p: Partial<MonthCell> = {}): MonthCell {
  return { budgeted: 0, depense: 0, recu: 0, balance: 0, ...p };
}

function txn(id: string, date: string, amount: number): HistoryTxn {
  return { id, date, label: "ACHAT", amount, month: date.slice(0, 7), groupId: null, lineId: null };
}

function row(p: Partial<HistoryRow> & { id: number; name: string }): HistoryRow {
  return { direction: "out", cells: [cell(), cell()], aliveMonths: [true, true], subRows: [], txns: [],
    ...p,
  };
}

// Courses vit les deux mois, Stage seulement en juillet : c'est exactement le cas
// qui justifie un tableau par mois plutôt qu'un tableau à colonnes.
const courses = row({ id: 1, name: "Courses", txns: [txn("t1", "2026-06-10", -80), txn("t2", "2026-07-12", -90)] });
const stage = row({ id: 2, name: "Stage", aliveMonths: [false, true] });
const depenses: HistorySection = {
  kind: "expense",
  rows: [courses, stage],
  totals: [cell({ budgeted: 300 }), cell({ budgeted: 420 })],
};

describe("sectionsAtMonth", () => {
  it("ne garde que les lignes vivantes ce mois-là", () => {
    expect(sectionsAtMonth([depenses], 0, MOIS[0])[0].rows.map((r) => r.name)).toEqual(["Courses"]);
    expect(sectionsAtMonth([depenses], 1, MOIS[1])[0].rows.map((r) => r.name)).toEqual(["Courses", "Stage"]);
  });

  // Les cellules gardent leur longueur : tout le tableau est indexé par mois, une
  // ligne raccourcie ferait lire la mauvaise colonne.
  it("laisse les cellules et les totaux intacts", () => {
    const [sec] = sectionsAtMonth([depenses], 1, MOIS[1]);
    expect(sec.totals).toEqual(depenses.totals);
    expect(sec.rows[0].cells).toHaveLength(2);
    expect(sec.rows[0].aliveMonths).toEqual([true, true]);
  });

  it("ne garde que les transactions du mois", () => {
    expect(sectionsAtMonth([depenses], 0, MOIS[0])[0].rows[0].txns.map((t) => t.id)).toEqual(["t1"]);
    expect(sectionsAtMonth([depenses], 1, MOIS[1])[0].rows[0].txns.map((t) => t.id)).toEqual(["t2"]);
  });

  it("retire les sous-lignes mortes ce mois-là et leurs transactions d'ailleurs", () => {
    const recurrent = row({
      id: 3, name: "Abonnements",
      subRows: [
        { id: 31, name: "Spotify", cells: [cell(), cell()], aliveMonths: [true, true], txns: [txn("s1", "2026-06-03", -10), txn("s2", "2026-07-03", -10)] },
        { id: 32, name: "Salle", cells: [cell(), cell()], aliveMonths: [false, true], txns: [txn("s3", "2026-07-05", -30)] },
      ],
    });
    const sec: HistorySection = { kind: "expense", rows: [recurrent], totals: [cell(), cell()] };

    const juin = sectionsAtMonth([sec], 0, MOIS[0])[0].rows[0];
    expect(juin.subRows.map((s) => s.name)).toEqual(["Spotify"]);
    expect(juin.subRows[0].txns.map((t) => t.id)).toEqual(["s1"]);
    expect(sectionsAtMonth([sec], 1, MOIS[1])[0].rows[0].subRows.map((s) => s.name)).toEqual(["Spotify", "Salle"]);
  });

  it("ne garde que les transactions du mois dans la section des non catégorisés", () => {
    const uncat: HistorySection = {
      kind: "uncategorized", uncatDirection: "out", rows: [], totals: [cell(), cell()],
      txns: [txn("u1", "2026-06-02", -12), txn("u2", "2026-07-02", -15)],
    };
    expect(sectionsAtMonth([uncat], 1, MOIS[1])[0].txns?.map((t) => t.id)).toEqual(["u2"]);
  });

  // Une ligne dont on ne sait rien reste affichée : mieux vaut une ligne de trop
  // qu'un budget qui disparaît sans qu'on sache pourquoi.
  it("garde une ligne sans information de vie", () => {
    const inconnue = row({ id: 4, name: "Sans repère", aliveMonths: [] });
    const sec: HistorySection = { kind: "expense", rows: [inconnue], totals: [cell(), cell()] };
    expect(sectionsAtMonth([sec], 0, MOIS[0])[0].rows).toHaveLength(1);
  });
});

// Les emplacements du tableau, sections présentes ou non. Un compte sans aucun groupe
// n'avait ni section de rémunération ni section de dépenses — donc aucun en-tête, donc
// aucun bouton pour en créer un : le compte restait inutilisable, et il fallait un
// groupe pour obtenir le bouton qui crée un groupe.
const uncatIn: HistorySection = { kind: "uncategorized", uncatDirection: "in", rows: [], totals: [cell(), cell()] };
const uncatOut: HistorySection = { kind: "uncategorized", uncatDirection: "out", rows: [], totals: [cell(), cell()] };

const nature = (s: ReturnType<typeof sectionSlots>[number]) =>
  s.kind === "empty" ? `vide:${s.sectionKind}` : `${s.section.kind}${s.section.uncatDirection ? `-${s.section.uncatDirection}` : ""}`;

describe("sectionSlots", () => {
  it("ouvre un emplacement pour chaque section structurelle absente", () => {
    expect(sectionSlots([uncatOut]).map(nature)).toEqual([
      "vide:income", "vide:expense", "uncategorized-out",
    ]);
  });

  it("n'ouvre rien quand toutes les sections sont là", () => {
    const toutes = [
      { kind: "income", rows: [], totals: [cell(), cell()] } as HistorySection,
      uncatIn,
      depenses,
      uncatOut,
    ];
    expect(sectionSlots(toutes).every((s) => s.kind === "section")).toBe(true);
    expect(sectionSlots(toutes)).toHaveLength(4);
  });

  // L'emplacement vide se glisse à la place qu'aurait occupée la section : les
  // dépenses restent après les rémunérations, quoi qu'il manque.
  it("garde l'ordre du tableau", () => {
    expect(sectionSlots([depenses]).map(nature)).toEqual(["vide:income", "expense"]);
  });

  it("ne perd aucune section, même vide de lignes", () => {
    const slots = sectionSlots([depenses]);
    expect(slots.find((s) => s.kind === "section" && s.section.kind === "expense")).toBeDefined();
  });
});
