// Changer la durée de vie d'un groupe (ou d'une ligne) après coup : ce que le
// changement coûte, avant de l'écrire. Rallonger n'enlève rien ; raccourcir retire
// des mois de la vie du groupe, et ces mois-là perdent leur budget pendant que leurs
// transactions repassent en non catégorisés. C'est ce qu'on doit pouvoir annoncer.
import { describe, expect, it } from "vitest";
import { droppedMonths, addedMonths, isShrink, countTxnsIn } from "../../src/lib/period-change";

const permanent = { startMonth: "2026-01", endMonth: null };
const mois = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"];

describe("droppedMonths", () => {
  it("rend les mois qui sortent de la vie quand on avance la fin en arrière", () => {
    expect(droppedMonths(permanent, { startMonth: "2026-01", endMonth: "2026-03" }, mois)).toEqual([
      "2026-04",
      "2026-05",
    ]);
  });

  it("rend les mois qui sortent quand on repousse le début", () => {
    expect(droppedMonths(permanent, { startMonth: "2026-03", endMonth: null }, mois)).toEqual([
      "2026-01",
      "2026-02",
    ]);
  });

  it("ne rend rien quand on rallonge", () => {
    expect(droppedMonths({ startMonth: "2026-03", endMonth: "2026-04" }, permanent, mois)).toEqual([]);
  });

  it("ne rend rien quand rien ne change", () => {
    expect(droppedMonths(permanent, permanent, mois)).toEqual([]);
  });

  // Les deux bouts peuvent se resserrer d'un coup : le compte doit tous les voir.
  it("cumule les deux bouts", () => {
    expect(droppedMonths(permanent, { startMonth: "2026-02", endMonth: "2026-04" }, mois)).toEqual([
      "2026-01",
      "2026-05",
    ]);
  });
});

describe("addedMonths", () => {
  it("rend les mois gagnés quand on remonte le début", () => {
    expect(addedMonths({ startMonth: "2026-03", endMonth: null }, permanent, mois)).toEqual([
      "2026-01",
      "2026-02",
    ]);
  });

  it("rend les mois gagnés quand on retire la fin", () => {
    expect(addedMonths({ startMonth: "2026-01", endMonth: "2026-02" }, permanent, mois)).toEqual([
      "2026-03",
      "2026-04",
      "2026-05",
    ]);
  });

  it("ne rend rien quand on raccourcit", () => {
    expect(addedMonths(permanent, { startMonth: "2026-02", endMonth: null }, mois)).toEqual([]);
  });
});

// Ce qui décide s'il faut avertir : un changement qui n'enlève aucun mois passe sans
// rien demander, même s'il touche aux deux dates.
describe("isShrink", () => {
  it("est vrai dès qu'un mois sort de la vie", () => {
    expect(isShrink(permanent, { startMonth: "2026-01", endMonth: "2026-03" }, mois)).toBe(true);
  });

  it("est faux quand on ne fait qu'agrandir", () => {
    expect(isShrink({ startMonth: "2026-03", endMonth: "2026-03" }, permanent, mois)).toBe(false);
  });
});

describe("countTxnsIn", () => {
  it("compte les transactions des mois perdus, et elles seules", () => {
    const txns = ["2026-01", "2026-01", "2026-03", "2026-05"];
    expect(countTxnsIn(["2026-01", "2026-05"], txns)).toBe(3);
  });

  it("rend zéro quand aucun mois n'est perdu", () => {
    expect(countTxnsIn([], ["2026-01"])).toBe(0);
  });
});
