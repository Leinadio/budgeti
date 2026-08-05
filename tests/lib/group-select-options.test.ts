import { describe, it, expect } from "vitest";
import { groupSelectSections } from "../../src/lib/group-select-options";

const env = (id: number, name: string, lines: { id: number; name: string }[] = []) =>
  ({ id, name, kind: "envelope" as const, lines });
const rec = (id: number, name: string, lines: { id: number; name: string }[] = []) =>
  ({ id, name, kind: "recurring" as const, lines });

describe("groupSelectSections", () => {
  it("range les récurrents avant les enveloppes, comme le tableau", () => {
    const secs = groupSelectSections([env(1, "Courses"), rec(2, "Sosh", [{ id: 10, name: "Internet" }])]);
    expect(secs.map((s) => s.label)).toEqual(["Récurrents", "Enveloppes"]);
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
