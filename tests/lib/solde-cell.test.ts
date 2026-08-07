// Ce qu'une case des trois colonnes de solde affiche. Quatre cas, et c'est le genre
// de règle qui se lit mal dans du JSX : d'où sa vie ici, éprouvable.
import { describe, expect, it } from "vitest";
import { soldeCell } from "../../src/lib/solde-cell";

describe("soldeCell", () => {
  // Ligne de départ (« Argent de départ ») ou de résultat : pas une opération, donc
  // pas d'opérateur — et le montant garde son signe.
  it("affiche un montant signé quand la ligne n'opère pas", () => {
    expect(soldeCell(-121.88, null, false)).toEqual({ kind: "plain", value: -121.88 });
    expect(soldeCell(-121.88, undefined, true)).toEqual({ kind: "plain", value: -121.88 });
  });

  // Une ligne qui n'a rien changé ne s'affiche pas : seules les lignes qui opèrent
  // sur le solde occupent la colonne.
  it("laisse la case vide quand la ligne n'a rien bougé", () => {
    expect(soldeCell(300, 0, false)).toEqual({ kind: "empty" });
    expect(soldeCell(300, 0.004, true)).toEqual({ kind: "empty" });
  });

  // L'affichage habituel : l'opérateur du mouvement, puis le solde en VALEUR ABSOLUE.
  // Le signe du solde n'y paraît pas — c'est justement ce que le mode détaillé répare.
  it("affiche l'opérateur du mouvement et le solde en valeur absolue", () => {
    expect(soldeCell(-121.88, -45, false)).toEqual({ kind: "operation", sign: "−", value: 121.88 });
    expect(soldeCell(1200, 300, false)).toEqual({ kind: "operation", sign: "+", value: 1200 });
  });

  // Mode détaillé : le mouvement se dit à part, et le solde reprend son signe. Les
  // deux informations cessent alors de se disputer la même couleur — un solde négatif
  // et une soustraction ne se lisaient pas l'un de l'autre.
  it("sépare le mouvement du solde quand on demande le détail", () => {
    expect(soldeCell(-121.88, -45, true)).toEqual({ kind: "detailed", delta: -45, value: -121.88 });
    expect(soldeCell(1200, 300, true)).toEqual({ kind: "detailed", delta: 300, value: 1200 });
  });
});
