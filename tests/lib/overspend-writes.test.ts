import { describe, it, expect } from "vitest";
import {
  envelopeWrites, undoWrites,
  amountAt, normalizeWrites,
  type BudgetWrite,
} from "../../src/lib/overspend-writes";

describe("écritures d'une décision permanente", () => {
  // Le mois d'effet (mois du dépassement + 1) n'est déterminé qu'à un seul
  // endroit : decideOverspend (actions.ts), qui calcule `nextMonthKey(month)`
  // une fois et le passe ici tel quel — à la fois pour capturer `before` au bon
  // mois et pour écrire la nouvelle valeur. envelopeWrites ne recalcule
  // rien : elle reçoit directement le mois d'effet déjà
  // déterminé et l'utilisent tel quel, sans lui appliquer nextMonthKey une
  // seconde fois. La preuve : un mois d'effet identique au mois qu'on leur donne
  // ressort inchangé (s'il y avait un second nextMonthKey caché ici, il
  // avancerait encore d'un mois).
  it("relève une enveloppe exactement au mois d'effet reçu, sans le recalculer", () => {
    expect(envelopeWrites(16, "2026-08", 468.19, 250)).toEqual([
      { target: "group", id: 16, month: "2026-08", amount: 468.19, before: 250 },
    ]);
  });

  it("garde before à null quand aucun montant n'existait à ce mois", () => {
    expect(envelopeWrites(16, "2026-08", 300, null)).toEqual([
      { target: "group", id: 16, month: "2026-08", amount: 300, before: null },
    ]);
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

  // Une décision « permanent » écrit un montant DURABLE : le montant d'avant qu'elle
  // capture doit donc être le montant durable de ce mois-là, jamais une exception qui y
  // serait posée. Sinon annuler la décision restaurerait l'exception comme un montant
  // permanent, et tous les mois suivants la reprendraient.
  it("ignore une exception posée au même mois : ce n'est pas ce qu'une décision permanente écrase", () => {
    const serie = [
      { effectiveMonth: "2026-08", amount: 80 },
      { effectiveMonth: "2026-08", amount: 500, scope: "once" as const },
    ];
    expect(amountAt(serie, "2026-08")).toBe(80);
  });

  it("rend null quand le mois ne porte qu'une exception", () => {
    expect(amountAt([{ effectiveMonth: "2026-08", amount: 500, scope: "once" as const }], "2026-08")).toBeNull();
  });

  it("choisit la bonne entrée parmi plusieurs, dont une antérieure", () => {
    const serie = [
      { effectiveMonth: "2026-01", amount: 50 },
      { effectiveMonth: "2026-08", amount: 80 },
    ];
    expect(amountAt(serie, "2026-08")).toBe(80);
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
