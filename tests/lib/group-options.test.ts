// Les groupes proposés au rattachement d'une transaction : ceux qui existent le
// mois de cette transaction. Une enveloppe créée pour juillet n'a rien à faire
// dans le menu d'une dépense d'août.
import { describe, expect, it } from "vitest";
import { groupsForMonth } from "../../src/lib/group-options";

const g = (id: number, name: string, startMonth?: string | null, endMonth?: string | null) =>
  ({ id, name, startMonth, endMonth });

const courses = g(1, "Courses", "2026-01", null);
const sucreries = g(2, "Sucreries", "2026-07", "2026-07");
const stage = g(3, "Stage", "2026-03", "2026-05");
const toujours = g(4, "Sans bornes");

const noms = (l: { name: string }[]) => l.map((x) => x.name);

describe("groupsForMonth", () => {
  it("écarte un groupe qui n'a pas encore commencé", () => {
    expect(noms(groupsForMonth([courses, sucreries], "2026-06"))).toEqual(["Courses"]);
  });

  it("écarte un groupe déjà terminé", () => {
    expect(noms(groupsForMonth([courses, sucreries], "2026-08"))).toEqual(["Courses"]);
  });

  // Le cas de l'exemple : le groupe d'un seul mois n'existe que ce mois-là.
  it("propose un groupe le mois où il vit, bornes incluses", () => {
    expect(noms(groupsForMonth([courses, sucreries], "2026-07"))).toEqual(["Courses", "Sucreries"]);
    expect(noms(groupsForMonth([stage], "2026-03"))).toEqual(["Stage"]);
    expect(noms(groupsForMonth([stage], "2026-05"))).toEqual(["Stage"]);
    expect(noms(groupsForMonth([stage], "2026-06"))).toEqual([]);
  });

  it("propose partout un groupe sans bornes", () => {
    expect(noms(groupsForMonth([toujours], "1999-01"))).toEqual(["Sans bornes"]);
    expect(noms(groupsForMonth([toujours], "2030-12"))).toEqual(["Sans bornes"]);
  });

  it("garde l'ordre reçu", () => {
    expect(noms(groupsForMonth([sucreries, courses, toujours], "2026-07"))).toEqual(["Sucreries", "Courses", "Sans bornes"]);
  });

  // Une transaction déjà rattachée à un groupe qui, depuis, ne vit plus ce mois-là :
  // son groupe reste proposé. Sinon le menu afficherait un choix vide alors que la
  // transaction est rattachée, et le prochain changement de ligne effacerait ce
  // rattachement sans que personne ne l'ait demandé.
  it("garde le groupe déjà rattaché, même s'il ne vit pas ce mois-là", () => {
    expect(noms(groupsForMonth([courses, sucreries], "2026-08", 2))).toEqual(["Courses", "Sucreries"]);
  });

  it("ne rattrape rien quand la transaction n'est rattachée à rien", () => {
    expect(noms(groupsForMonth([courses, sucreries], "2026-08", null))).toEqual(["Courses"]);
  });
});
