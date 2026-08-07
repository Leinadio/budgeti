// Ce que le bouton de rafraîchissement annonce une fois la synchronisation faite.
// Un compte, trois formulations : c'est peu, mais c'est la seule chose que
// l'utilisateur lit du résultat — et « 0 transactions importées » se lit comme une
// panne alors que c'est un succès.
import { describe, expect, it } from "vitest";
import { syncMessage } from "../../src/lib/sync-message";

describe("syncMessage", () => {
  it("dit qu'il n'y avait rien de nouveau plutôt que de compter zéro", () => {
    expect(syncMessage(0)).toBe("Aucune nouvelle transaction");
  });

  it("garde le singulier pour une seule", () => {
    expect(syncMessage(1)).toBe("1 transaction importée");
  });

  it("passe au pluriel au-delà", () => {
    expect(syncMessage(2)).toBe("2 transactions importées");
    expect(syncMessage(37)).toBe("37 transactions importées");
  });

  // Le serveur rend un nombre ; s'il manquait, mieux vaut le cas « rien de nouveau »
  // qu'un « NaN transactions » à l'écran.
  it("retombe sur « rien de nouveau » devant un compte absurde", () => {
    expect(syncMessage(NaN)).toBe("Aucune nouvelle transaction");
    expect(syncMessage(-1)).toBe("Aucune nouvelle transaction");
  });
});
