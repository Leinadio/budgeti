import { describe, it, expect } from "vitest";
import { groupSelectSections } from "../../src/lib/group-select-options";

const env = (id: number, name: string, lines: { id: number; name: string }[] = []) =>
  ({ id, name, kind: "envelope" as const, direction: "out" as const, lines });
const rec = (id: number, name: string, lines: { id: number; name: string }[] = []) =>
  ({ id, name, kind: "recurring" as const, direction: "out" as const, lines });
// Une rémunération est un groupe entrant : c'est son sens, pas sa nature, qui la
// distingue — elle est enregistrée comme une enveloppe.
const rem = (id: number, name: string, lines: { id: number; name: string }[] = []) =>
  ({ id, name, kind: "envelope" as const, direction: "in" as const, lines });

describe("groupSelectSections", () => {
  it("range les récurrents avant les enveloppes, comme le tableau", () => {
    const secs = groupSelectSections([env(1, "Courses"), rec(2, "Sosh", [{ id: 10, name: "Internet" }])]);
    expect(secs.map((s) => s.label)).toEqual(["Récurrents", "Enveloppes"]);
  });

  it("sort les rémunérations des enveloppes et les met en tête, comme le tableau", () => {
    const secs = groupSelectSections([env(1, "Courses"), rem(21, "Rémunération Principale")]);
    expect(secs.map((s) => s.label)).toEqual(["Rémunérations", "Enveloppes"]);
  });

  it("ne laisse aucune rémunération traîner dans les enveloppes", () => {
    const [, enveloppes] = groupSelectSections([rem(21, "Rémunération Principale"), env(1, "Courses")]);
    expect(enveloppes.items.map((i) => i.id)).toEqual([1]);
  });

  it("laisse choisir une rémunération, comme une enveloppe", () => {
    const [sec] = groupSelectSections([rem(21, "Rémunération Principale")]);
    expect(sec.items).toEqual([{ type: "group", id: 21, name: "Rémunération Principale", selectable: true }]);
  });

  it("garde un récurrent entrant dans les rémunérations, sans le rendre choisissable", () => {
    const entrant = { id: 30, name: "Loyer perçu", kind: "recurring" as const, direction: "in" as const, lines: [{ id: 31, name: "Studio" }] };
    const [sec] = groupSelectSections([entrant]);
    expect(sec.label).toBe("Rémunérations");
    expect(sec.items).toEqual([
      { type: "group", id: 30, name: "Loyer perçu", selectable: false },
      { type: "line", id: 31, name: "Studio" },
    ]);
  });

  it("n'ouvre pas une section vide", () => {
    const secs = groupSelectSections([env(1, "Courses")]);
    expect(secs.map((s) => s.label)).toEqual(["Enveloppes"]);
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

  it("garde le titre d'un récurrent sans ligne : il dit pourquoi rien n'est choisissable", () => {
    const [sec] = groupSelectSections([rec(2, "Sosh")]);
    expect(sec.items).toEqual([{ type: "group", id: 2, name: "Sosh", selectable: false }]);
  });

  it("garde l'ordre reçu à l'intérieur d'une section", () => {
    const [sec] = groupSelectSections([env(3, "Sucreries"), env(1, "Courses")]);
    expect(sec.items.map((i) => i.id)).toEqual([3, 1]);
  });

  it("place les lignes d'une enveloppe sous elle", () => {
    const [sec] = groupSelectSections([env(1, "Courses", [{ id: 20, name: "Drive" }])]);
    expect(sec.items).toEqual([
      { type: "group", id: 1, name: "Courses", selectable: true },
      { type: "line", id: 20, name: "Drive" },
    ]);
  });
});
