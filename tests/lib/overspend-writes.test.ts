import { describe, it, expect } from "vitest";
import { overspentLines, envelopeWrites, lineWrites, undoWrites, type BudgetWrite } from "../../src/lib/overspend-writes";

describe("lignes en dépassement", () => {
  const lignes = [
    { id: 101, name: "Direct Assurance voiture" },
    { id: 102, name: "Sosh Internet" },
    { id: 105, name: "iCloud" },
  ];
  const budgets: Record<number, number> = { 101: 81.84, 102: 30.99, 105: 9.99 };
  const depenses: Record<number, number> = { 101: 151.84, 102: 30.99, 105: 1.99 };

  it("ne retient que les lignes qui ont dépassé", () => {
    expect(overspentLines(lignes, (id) => budgets[id], (id) => depenses[id])).toEqual([
      { lineId: 101, name: "Direct Assurance voiture", budget: 81.84, spent: 151.84 },
    ]);
  });

  it("ignore un écart d'arrondi sous le centime", () => {
    const b = { 101: 10 } as Record<number, number>;
    const d = { 101: 10.004 } as Record<number, number>;
    expect(overspentLines([{ id: 101, name: "X" }], (id) => b[id], (id) => d[id])).toEqual([]);
  });

  it("rend une liste vide quand la dépense vient du groupe et non d'une ligne", () => {
    expect(overspentLines([], () => 0, () => 0)).toEqual([]);
  });
});

describe("écritures d'une décision permanente", () => {
  it("relève une enveloppe au mois qui suit le dépassement", () => {
    expect(envelopeWrites(16, "2026-07", 468.19, 250)).toEqual([
      { target: "group", id: 16, month: "2026-08", amount: 468.19, before: 250 },
    ]);
  });

  it("garde before à null quand aucun montant n'existait à ce mois", () => {
    expect(envelopeWrites(16, "2026-07", 300, null)).toEqual([
      { target: "group", id: 16, month: "2026-08", amount: 300, before: null },
    ]);
  });

  it("relève chaque ligne choisie au mois qui suit le dépassement", () => {
    expect(lineWrites("2026-07", [{ lineId: 101, amount: 151.84, before: null }])).toEqual([
      { target: "line", id: 101, month: "2026-08", amount: 151.84, before: null },
    ]);
  });

  it("passe correctement d'une année à l'autre", () => {
    expect(envelopeWrites(1, "2026-12", 100, null)[0].month).toBe("2027-01");
  });
});

describe("annulation d'une décision permanente", () => {
  const w: BudgetWrite[] = [
    { target: "group", id: 16, month: "2026-08", amount: 300, before: 250 },
    { target: "line", id: 101, month: "2026-08", amount: 151.84, before: null },
  ];

  it("restaure le montant d'avant, ou supprime l'entrée s'il n'y en avait pas", () => {
    const r = undoWrites(w, (x) => (x.target === "group" ? 300 : 151.84));
    expect(r.restore).toEqual([{ target: "group", id: 16, month: "2026-08", amount: 300, before: 250 }]);
    expect(r.remove).toEqual([{ target: "line", id: 101, month: "2026-08", amount: 151.84, before: null }]);
  });

  it("ne touche pas une entrée modifiée à la main depuis la décision", () => {
    const r = undoWrites(w, () => 999);
    expect(r.restore).toEqual([]);
    expect(r.remove).toEqual([]);
  });

  it("ne fait rien quand la décision n'avait rien écrit", () => {
    expect(undoWrites([], () => null)).toEqual({ restore: [], remove: [] });
  });
});
