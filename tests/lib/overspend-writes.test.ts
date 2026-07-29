import { describe, it, expect } from "vitest";
import {
  overspentLines, envelopeWrites, lineWrites, undoWrites,
  amountAt, canDecidePermanent, normalizeWrites,
  type BudgetWrite,
} from "../../src/lib/overspend-writes";

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

describe("amountAt : montant exactement posé à un mois (pas « en vigueur »)", () => {
  it("rend null quand la série est vide", () => {
    expect(amountAt([], "2026-08")).toBeNull();
  });

  it("rend null quand seule une entrée ANTÉRIEURE existe : ce n'est pas le même avoir qu'« en vigueur »", () => {
    // C'est cette subtilité qui fait que l'annulation d'une décision SUPPRIME
    // l'entrée (au lieu de la restaurer à une valeur) quand rien n'avait été
    // explicitement posé au mois exact avant la décision.
    expect(amountAt([{ effectiveMonth: "2026-01", amount: 50 }], "2026-08")).toBeNull();
  });

  it("rend le montant quand une entrée existe exactement à ce mois", () => {
    expect(amountAt([{ effectiveMonth: "2026-08", amount: 80 }], "2026-08")).toBe(80);
  });

  it("choisit la bonne entrée parmi plusieurs, dont une antérieure", () => {
    const serie = [
      { effectiveMonth: "2026-01", amount: 50 },
      { effectiveMonth: "2026-08", amount: 80 },
    ];
    expect(amountAt(serie, "2026-08")).toBe(80);
  });
});

describe("canDecidePermanent : refuse un récurrent sans ventilation par ligne", () => {
  it("autorise une enveloppe, avec ou sans lignes fournies", () => {
    expect(canDecidePermanent("envelope", undefined)).toBe(true);
    expect(canDecidePermanent("envelope", [{ lineId: 101, amount: 50 }])).toBe(true);
  });

  it("refuse un récurrent sans ventilation par ligne", () => {
    expect(canDecidePermanent("recurring", undefined)).toBe(false);
  });

  it("refuse un récurrent avec une ventilation vide", () => {
    expect(canDecidePermanent("recurring", [])).toBe(false);
  });

  it("autorise un récurrent dès qu'une ventilation par ligne est fournie", () => {
    expect(canDecidePermanent("recurring", [{ lineId: 101, amount: 50 }])).toBe(true);
  });

  // decideOverspend (actions.ts) filtre ensuite les montants non finis, négatifs ou
  // nuls avant d'écrire (lineWrites ne retient que ceux-là). Si TOUS les montants
  // envoyés sont invalides, le garde-fou doit refuser au même titre qu'une
  // ventilation vide ou absente — sinon une décision « permanent » se retrouve
  // enregistrée sans qu'aucun montant ait réellement bougé.
  it("refuse un récurrent dont tous les montants fournis sont invalides (non finis, négatifs ou nuls)", () => {
    expect(canDecidePermanent("recurring", [{ lineId: 101, amount: NaN }])).toBe(false);
    expect(canDecidePermanent("recurring", [{ lineId: 101, amount: -5 }])).toBe(false);
    expect(canDecidePermanent("recurring", [{ lineId: 101, amount: 0 }])).toBe(false);
    expect(
      canDecidePermanent("recurring", [
        { lineId: 101, amount: 0 },
        { lineId: 102, amount: -1 },
      ]),
    ).toBe(false);
  });

  it("autorise un récurrent dès qu'au moins un montant fourni est valide, même si d'autres ne le sont pas", () => {
    expect(
      canDecidePermanent("recurring", [
        { lineId: 101, amount: 0 },
        { lineId: 102, amount: 50 },
      ]),
    ).toBe(true);
  });

  // decideOverspend aiguille sur `lineAmounts?.length` AVANT de regarder newBudget,
  // quel que soit groupKind : un appel « envelope » avec un lineAmounts non vide
  // mais entièrement invalide prendrait donc la branche lineWrites, écrirait une
  // liste vide, et enregistrerait quand même la décision — la même faille que
  // celle refermée ci-dessus pour un récurrent, sur l'autre branche.
  it("refuse une enveloppe dont le lineAmounts fourni est entièrement invalide (même faille que sur un récurrent)", () => {
    expect(canDecidePermanent("envelope", [{ lineId: 101, amount: 0 }])).toBe(false);
    expect(canDecidePermanent("envelope", [{ lineId: 101, amount: -5 }])).toBe(false);
    expect(canDecidePermanent("envelope", [{ lineId: 101, amount: NaN }])).toBe(false);
  });
});

describe("normalizeWrites : une décision qui n'a rien écrit ne garde jamais un tableau vide", () => {
  it("rend null pour null", () => {
    expect(normalizeWrites(null)).toBeNull();
  });

  it("rend null pour un tableau vide", () => {
    expect(normalizeWrites([])).toBeNull();
  });

  it("garde les écritures telles quelles quand il y en a", () => {
    const w: BudgetWrite[] = [{ target: "line", id: 101, month: "2026-08", amount: 151.84, before: null }];
    expect(normalizeWrites(w)).toEqual(w);
  });
});
