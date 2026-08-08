import { describe, it, expect } from "vitest";
import { groupSelectSections } from "../../src/lib/group-select-options";

const env = (id: number, name: string, lines: { id: number; name: string }[] = []) =>
  ({ id, name, direction: "out" as const, lines });
const rec = (id: number, name: string, lines: { id: number; name: string }[] = []) =>
  ({ id, name, direction: "out" as const, lines });
// Une rémunération est un groupe entrant : c'est son sens, pas sa nature, qui la
// distingue — elle est enregistrée comme une enveloppe.
const rem = (id: number, name: string, lines: { id: number; name: string }[] = []) =>
  ({ id, name, direction: "in" as const, lines });

describe("groupSelectSections", () => {
  // Ce qu'on peut viser suit les sous-postes, pas la nature déclarée : une dépense
  // découpée n'est pas une destination, ses transactions vont dans un sous-poste.
  it("ne laisse pas choisir une enveloppe qui a des sous-postes", () => {
    const [sec] = groupSelectSections([env(1, "Courses", [{ id: 11, name: "Boulangerie" }])]);
    expect(sec.items).toEqual([
      { type: "group", id: 1, name: "Courses", selectable: false },
      { type: "line", id: 11, name: "Boulangerie" },
    ]);
  });

  it("laisse choisir un récurrent qui n'a aucun sous-poste", () => {
    const [sec] = groupSelectSections([rec(2, "Carburant")]);
    expect(sec.items).toEqual([{ type: "group", id: 2, name: "Carburant", selectable: true }]);
  });

  // Une seule liste de dépenses, comme le tableau : « Récurrents » et « Enveloppes »
  // ne recouvraient aucune différence de comportement.
  it("réunit toutes les dépenses sous un seul titre, comme le tableau", () => {
    const secs = groupSelectSections([env(1, "Courses"), rec(2, "Sosh", [{ id: 10, name: "Internet" }])]);
    expect(secs.map((s) => s.label)).toEqual(["Dépenses"]);
    expect(secs[0].items.map((i) => i.name)).toEqual(["Courses", "Sosh", "Internet"]);
  });

  it("sort les rémunérations des enveloppes et les met en tête, comme le tableau", () => {
    const secs = groupSelectSections([env(1, "Courses"), rem(21, "Rémunération Principale")]);
    expect(secs.map((s) => s.label)).toEqual(["Rémunérations", "Dépenses"]);
  });

  it("ne laisse aucune rémunération traîner dans les dépenses", () => {
    const [, depenses] = groupSelectSections([rem(21, "Rémunération Principale"), env(1, "Courses")]);
    expect(depenses.items.map((i) => i.id)).toEqual([1]);
  });

  it("laisse choisir une rémunération, comme une enveloppe", () => {
    const [sec] = groupSelectSections([rem(21, "Rémunération Principale")]);
    expect(sec.items).toEqual([{ type: "group", id: 21, name: "Rémunération Principale", selectable: true }]);
  });

  it("garde un récurrent entrant dans les rémunérations, sans le rendre choisissable", () => {
    const entrant = { id: 30, name: "Loyer perçu", direction: "in" as const, lines: [{ id: 31, name: "Studio" }] };
    const [sec] = groupSelectSections([entrant]);
    expect(sec.label).toBe("Rémunérations");
    expect(sec.items).toEqual([
      { type: "group", id: 30, name: "Loyer perçu", selectable: false },
      { type: "line", id: 31, name: "Studio" },
    ]);
  });

  it("n'ouvre pas une section vide", () => {
    const secs = groupSelectSections([env(1, "Courses")]);
    expect(secs.map((s) => s.label)).toEqual(["Dépenses"]);
  });

  it("ne rend rien quand il n'y a aucun groupe", () => {
    expect(groupSelectSections([])).toEqual([]);
  });

  it("rend une enveloppe choisissable", () => {
    const [sec] = groupSelectSections([env(1, "Courses")]);
    expect(sec.items).toEqual([{ type: "group", id: 1, name: "Courses", selectable: true }]);
  });

  it("rend un récurrent non choisissable, ses lignes en dessous", () => {
    const [sec] = groupSelectSections([
      rec(2, "Sosh", [{ id: 10, name: "Internet" }, { id: 11, name: "Mobile" }]),
    ]);
    expect(sec.items).toEqual([
      { type: "group", id: 2, name: "Sosh", selectable: false },
      { type: "line", id: 10, name: "Internet" },
      { type: "line", id: 11, name: "Mobile" },
    ]);
  });

  it("garde l'ordre reçu à l'intérieur d'une section", () => {
    const [sec] = groupSelectSections([env(3, "Sucreries"), env(1, "Courses")]);
    expect(sec.items.map((i) => i.id)).toEqual([3, 1]);
  });
});
