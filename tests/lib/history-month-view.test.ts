// Ce qu'un tableau de mois montre dans sa colonne de gauche : les groupes qui
// vivent CE mois-là, et rien d'autre. Un tableau par mois, donc une liste de
// lignes par mois — c'est ce que cette découpe fabrique.
import { describe, expect, it } from "vitest";
import type { HistoryRow, HistorySection, HistoryTxn, MonthCell } from "../../src/lib/history";
import { sectionsAtMonth } from "../../src/lib/history-month-view";

const MOIS = ["2026-06", "2026-07"];

function cell(p: Partial<MonthCell> = {}): MonthCell {
  return { budgeted: 0, depense: 0, recu: 0, balance: 0, ...p };
}

function txn(id: string, date: string, amount: number): HistoryTxn {
  return { id, date, label: "ACHAT", amount, month: date.slice(0, 7), groupId: null, lineId: null };
}

function row(p: Partial<HistoryRow> & { id: number; name: string }): HistoryRow {
  return {
    kind: "envelope", direction: "out", incomeKind: null,
    cells: [cell(), cell()], aliveMonths: [true, true], subRows: [], txns: [],
    ...p,
  };
}

// Courses vit les deux mois, Stage seulement en juillet : c'est exactement le cas
// qui justifie un tableau par mois plutôt qu'un tableau à colonnes.
const courses = row({ id: 1, name: "Courses", txns: [txn("t1", "2026-06-10", -80), txn("t2", "2026-07-12", -90)] });
const stage = row({ id: 2, name: "Stage", aliveMonths: [false, true] });
const enveloppes: HistorySection = {
  kind: "envelope",
  rows: [courses, stage],
  totals: [cell({ budgeted: 300 }), cell({ budgeted: 420 })],
};

describe("sectionsAtMonth", () => {
  it("ne garde que les lignes vivantes ce mois-là", () => {
    expect(sectionsAtMonth([enveloppes], 0, MOIS[0])[0].rows.map((r) => r.name)).toEqual(["Courses"]);
    expect(sectionsAtMonth([enveloppes], 1, MOIS[1])[0].rows.map((r) => r.name)).toEqual(["Courses", "Stage"]);
  });

  // Les cellules gardent leur longueur : tout le tableau est indexé par mois, une
  // ligne raccourcie ferait lire la mauvaise colonne.
  it("laisse les cellules et les totaux intacts", () => {
    const [sec] = sectionsAtMonth([enveloppes], 1, MOIS[1]);
    expect(sec.totals).toEqual(enveloppes.totals);
    expect(sec.rows[0].cells).toHaveLength(2);
    expect(sec.rows[0].aliveMonths).toEqual([true, true]);
  });

  it("ne garde que les transactions du mois", () => {
    expect(sectionsAtMonth([enveloppes], 0, MOIS[0])[0].rows[0].txns.map((t) => t.id)).toEqual(["t1"]);
    expect(sectionsAtMonth([enveloppes], 1, MOIS[1])[0].rows[0].txns.map((t) => t.id)).toEqual(["t2"]);
  });

  it("retire les sous-lignes mortes ce mois-là et leurs transactions d'ailleurs", () => {
    const recurrent = row({
      id: 3, name: "Abonnements", kind: "recurring",
      subRows: [
        { id: 31, name: "Spotify", cells: [cell(), cell()], aliveMonths: [true, true], txns: [txn("s1", "2026-06-03", -10), txn("s2", "2026-07-03", -10)] },
        { id: 32, name: "Salle", cells: [cell(), cell()], aliveMonths: [false, true], txns: [txn("s3", "2026-07-05", -30)] },
      ],
    });
    const sec: HistorySection = { kind: "recurring", rows: [recurrent], totals: [cell(), cell()] };

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
    const sec: HistorySection = { kind: "envelope", rows: [inconnue], totals: [cell(), cell()] };
    expect(sectionsAtMonth([sec], 0, MOIS[0])[0].rows).toHaveLength(1);
  });
});
