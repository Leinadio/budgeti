// --- Les montants ne dépendent pas de la fenêtre affichée ---------------------
//
// Toute la chaîne des soldes est ancrée sur UN point connu : le mois courant se
// ferme sur le solde que la banque annonce aujourd'hui. Les autres mois s'en
// déduisent, de proche en proche, en remontant ou en descendant les mouvements.
//
// Si la fenêtre affichée ne contient pas le mois courant, cette ancre n'a nulle part
// où se poser. computeSolde se rabattait alors sur la borne haute de la fenêtre :
// afficher juillet seul, en août, revenait à dire « fin juillet, j'avais ce que j'ai
// aujourd'hui ». L'argent de départ de juillet changeait donc selon qu'on affichait
// juillet seul ou juillet et août — alors que juillet, lui, n'a pas bougé.
//
// La fenêtre de CALCUL s'étend donc toujours jusqu'au mois courant, et on ne coupe
// qu'à l'affichage.
import { describe, expect, it } from "vitest";
import { computeHistory, computeSolde, sliceSoldeColumn, monthRange } from "../../src/lib/history";
import type { Txn } from "../../src/lib/forecast";
import { calcWindow } from "../../src/lib/calc-window";

const AUJOURD_HUI = "2026-08";
// Le solde que la banque annonce : c'est la seule vérité de toute la chaîne.
const SOLDE = 1804.37;

// Deux mois de mouvements, aucun groupe : tout tombe en non catégorisés, ce qui suffit
// à faire bouger les totaux d'un mois.
const txns: Txn[] = [
  { id: "t7", date: "2026-07-10", amount: 250.99, label: "VIR", accountId: "a1", groupId: null },
  { id: "t8", date: "2026-08-05", amount: 1553.38, label: "VIR", accountId: "a1", groupId: null },
];

// Ce que l'écran affiche pour une fenêtre donnée : on calcule sur la fenêtre étendue,
// puis on coupe — exactement ce que fait la page.
function ouvertures(from: string, to: string): Record<string, number> {
  const w = calcWindow(from, to, AUJOURD_HUI);
  const calcMonths = monthRange(w.calcFrom, w.calcTo);
  const sections = computeHistory([], txns, calcMonths, AUJOURD_HUI);
  const solde = sliceSoldeColumn(
    computeSolde(sections, calcMonths, AUJOURD_HUI, SOLDE),
    w.dropStart,
    w.dropEnd,
  );
  const months = monthRange(from, to);
  // Un zéro négatif reste un zéro : l'arrondi d'une somme de flottants peut rendre -0,
  // que toBe(0) refuserait.
  const arrondi = (v: number) => {
    const r = Math.round(v * 100) / 100;
    return r === 0 ? 0 : r;
  };
  return Object.fromEntries(months.map((m, i) => [m, arrondi(solde.openings[i])]));
}

describe("l'argent de départ d'un mois", () => {
  // 1804,37 aujourd'hui, moins les 1553,38 d'août, moins les 250,99 de juillet : le
  // mois de juillet s'est ouvert à zéro. C'est vrai quelle que soit la fenêtre.
  it("vaut la même chose, affiché seul ou avec ses voisins", () => {
    expect(ouvertures("2026-07", "2026-07")["2026-07"]).toBe(0);
    expect(ouvertures("2026-06", "2026-07")["2026-07"]).toBe(0);
    expect(ouvertures("2026-06", "2026-08")["2026-07"]).toBe(0);
    expect(ouvertures("2026-07", "2026-08")["2026-07"]).toBe(0);
  });

  it("vaut la même chose pour le mois courant lui-même", () => {
    expect(ouvertures("2026-08", "2026-08")["2026-08"]).toBe(250.99);
    expect(ouvertures("2026-06", "2026-08")["2026-08"]).toBe(250.99);
  });

  // Un mois d'avant les mouvements connus : il s'ouvre là où juillet s'est ouvert.
  it("remonte au-delà des mois qui portent des mouvements", () => {
    expect(ouvertures("2026-06", "2026-06")["2026-06"]).toBe(0);
  });
});

// La fenêtre de calcul, seule : elle s'étend des deux côtés jusqu'à contenir le mois
// courant, et dit combien de mois couper à chaque bout pour retrouver l'affichage.
describe("la fenêtre de calcul", () => {
  it("s'étend vers l'avant quand la fenêtre est entièrement passée", () => {
    expect(calcWindow("2026-06", "2026-07", "2026-08")).toEqual({
      calcFrom: "2026-06", calcTo: "2026-08", dropStart: 0, dropEnd: 1,
    });
  });

  it("s'étend vers l'arrière quand la fenêtre est entièrement future", () => {
    expect(calcWindow("2026-10", "2026-11", "2026-08")).toEqual({
      calcFrom: "2026-08", calcTo: "2026-11", dropStart: 2, dropEnd: 0,
    });
  });

  it("ne touche à rien quand le mois courant est déjà dedans", () => {
    expect(calcWindow("2026-07", "2026-09", "2026-08")).toEqual({
      calcFrom: "2026-07", calcTo: "2026-09", dropStart: 0, dropEnd: 0,
    });
  });

  it("garde le mois courant quand la fenêtre s'y arrête", () => {
    expect(calcWindow("2026-06", "2026-08", "2026-08")).toEqual({
      calcFrom: "2026-06", calcTo: "2026-08", dropStart: 0, dropEnd: 0,
    });
  });
});
