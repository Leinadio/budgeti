import { describe, it, expect } from "vitest";
import { effectiveBalance } from "../../src/lib/account";

describe("Solde d'un compte privé de ce qui est hors calcul", () => {
  it("devrait retrancher un encaissement non comptabilisé du solde de la banque", () => {
    // Cas réel : un remboursement d'impôts de 3 800 € encaissé puis mis hors calcul.
    // La banque affiche 3 801,92 ; l'app doit raisonner sur 1,92, le solde qu'aurait
    // le compte si l'opération n'avait jamais eu lieu.
    expect(effectiveBalance(3801.92, 3800)).toBeCloseTo(1.92, 2);
  });

  it("devrait rendre le solde au compte quand une sortie est mise hors calcul", () => {
    // Une dépense hors calcul est un montant négatif : la retrancher REMONTE le solde,
    // puisque le compte est censé ne jamais l'avoir payée.
    expect(effectiveBalance(500, -120)).toBe(620);
  });

  it("devrait laisser le solde intact sans aucune transaction hors calcul", () => {
    // undefined = aucune ligne pour ce compte dans le regroupement par compte.
    expect(effectiveBalance(250.99, undefined)).toBe(250.99);
    expect(effectiveBalance(250.99, 0)).toBe(250.99);
  });

  it("devrait pouvoir rendre le solde négatif si l'encaissement hors calcul le portait", () => {
    // Le solde corrigé n'est pas borné à zéro : sans le virement, le compte était à découvert.
    expect(effectiveBalance(100, 300)).toBe(-200);
  });
});
