// Le menu de rattachement est du balisage : ce qui compte est ce que le navigateur
// reçoit (des optgroup, des titres inertes, des retraits), et aucun test de la
// logique de src/lib ne le prouve. On le rend donc pour de vrai, en statique.
// Vitest tourne en environnement node : renderToStaticMarkup suffit, il n'a pas
// besoin de DOM. Le routeur et l'action serveur sont remplacés, ils ne sont pas
// le sujet ici.
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/app/transactions/actions", () => ({ setGroup: async () => {} }));

const { GroupSelectField } = await import("../../src/components/group-select-field");

const rendu = (groups: Parameters<typeof GroupSelectField>[0]["groups"]) =>
  renderToStaticMarkup(
    createElement(GroupSelectField, { txnId: "t1", groups, defaultGroupId: null, defaultLineId: null }),
  );

const courses = { id: 1, name: "Courses", direction: "out" as const, lines: [] };
const sosh = {
  id: 2, name: "Sosh", direction: "out" as const,
  lines: [{ id: 10, name: "Internet" }],
};
const salaire = { id: 21, name: "Rémunération Principale", direction: "in" as const, lines: [] };

describe("GroupSelectField", () => {
  // Une seule liste de dépenses, comme le tableau : plates et découpées y voisinent,
  // et c'est le titre inerte d'une découpée qui dit qu'on vise ses sous-postes.
  it("réunit les dépenses sous un seul titre", () => {
    const html = rendu([courses, sosh]);
    expect(html).toContain('<optgroup label="Dépenses">');
    expect(html).not.toContain('label="Récurrents"');
    expect(html).not.toContain('label="Enveloppes"');
  });

  it("donne aux rémunérations leur propre section, en tête", () => {
    const html = rendu([courses, sosh, salaire]);
    expect(html).toContain('<optgroup label="Rémunérations">');
    expect(html.indexOf('label="Rémunérations"')).toBeLessThan(html.indexOf('label="Dépenses"'));
    // Et elle ne traîne plus au milieu des dépenses.
    expect(html.indexOf("Rémunération Principale")).toBeLessThan(html.indexOf("Courses"));
  });

  it("laisse choisir une dépense plate", () => {
    expect(rendu([courses])).toContain('<option value="g:1">Courses</option>');
  });

  it("affiche le nom d'une dépense découpée en titre inerte, jamais choisissable", () => {
    const html = rendu([sosh]);
    expect(html).toContain('<option value="t:2" disabled="">Sosh</option>');
    expect(html).not.toContain('value="g:2"');
  });

  it("indente les lignes sous leur groupe", () => {
    expect(rendu([sosh])).toContain('<option value="l:10">   › Internet</option>');
  });

  it("garde « Non catégorisé » hors des sections, avec la valeur vide", () => {
    const html = rendu([sosh]);
    expect(html.indexOf('<option value="">Non catégorisé</option>')).toBeLessThan(
      html.indexOf("<optgroup"),
    );
  });
});
