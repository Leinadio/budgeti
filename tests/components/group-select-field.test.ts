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

const courses = { id: 1, name: "Courses", kind: "envelope" as const, lines: [] };
const sosh = {
  id: 2, name: "Sosh", kind: "recurring" as const,
  lines: [{ id: 10, name: "Internet" }],
};

describe("GroupSelectField", () => {
  it("sépare les récurrents des enveloppes, récurrents d'abord", () => {
    const html = rendu([courses, sosh]);
    expect(html.indexOf('<optgroup label="Récurrents">')).toBeGreaterThan(-1);
    expect(html.indexOf('<optgroup label="Récurrents">')).toBeLessThan(
      html.indexOf('<optgroup label="Enveloppes">'),
    );
  });

  it("n'ouvre pas de section quand la nature est absente", () => {
    expect(rendu([courses])).not.toContain("Récurrents");
  });

  it("laisse choisir une enveloppe", () => {
    expect(rendu([courses])).toContain('<option value="g:1">Courses</option>');
  });

  it("affiche le nom d'un récurrent en titre inerte, jamais choisissable", () => {
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
