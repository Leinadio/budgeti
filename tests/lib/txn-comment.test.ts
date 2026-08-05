// Le commentaire qu'on pose sous une transaction : une note à soi, à côté du
// libellé de la banque, qui lui ne bouge pas.
import { describe, expect, it } from "vitest";
import { normalizeComment, hasComment } from "../../src/lib/txn-comment";

describe("normalizeComment", () => {
  it("retire les espaces de bord", () => {
    expect(normalizeComment("  Remboursé par Marie  ")).toBe("Remboursé par Marie");
  });

  // Effacer le champ, c'est retirer le commentaire : on écrit null, pas une chaîne
  // vide, pour que la base dise « aucun commentaire » et non « commentaire vide ».
  it("rend null quand il ne reste rien", () => {
    expect(normalizeComment("")).toBeNull();
    expect(normalizeComment("   ")).toBeNull();
  });

  // Un commentaire tient sur plusieurs lignes si on le veut ; seuls les bords sont
  // nettoyés, pas ce qu'il y a au milieu.
  it("garde les retours à la ligne intérieurs", () => {
    expect(normalizeComment(" à revoir\navec la banque ")).toBe("à revoir\navec la banque");
  });
});

describe("hasComment", () => {
  it("reconnaît un commentaire écrit", () => {
    expect(hasComment("Remboursé")).toBe(true);
  });

  it("ne prend pas du vide pour un commentaire", () => {
    expect(hasComment(null)).toBe(false);
    expect(hasComment(undefined)).toBe(false);
    expect(hasComment("")).toBe(false);
    expect(hasComment("   ")).toBe(false);
  });
});
