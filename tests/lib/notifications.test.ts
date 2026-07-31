// Les notifications de l'app : un dépassement de budget, un bandeau. Elles vivent dans
// l'en-tête et non plus au-dessus du tableau, donc elles couvrent TOUS les comptes —
// d'où le besoin de les rassembler et de les ordonner en un seul endroit.
import { describe, expect, it } from "vitest";
import { overspendNotifications, withoutDismissed, notificationId } from "../../src/lib/notifications";
import type { Overspend } from "../../src/lib/history";

const dep = (name: string, month: string, amount: number, groupId = 1, lineId: number | null = null): Overspend => ({
  groupId, lineId, name, month, amount, kind: lineId === null ? "envelope" : "recurring",
});

describe("notifications de dépassement", () => {
  it("fait un bandeau par montant dépassé", () => {
    const n = overspendNotifications([
      { accountId: "a1", accountName: "CIC", byMonth: { "2026-07": [dep("Courses", "2026-07", 50), dep("Essence", "2026-07", 12, 2)] } },
    ]);
    expect(n.map((x) => [x.name, x.amount])).toEqual([
      ["Courses", 50],
      ["Essence", 12],
    ]);
  });

  // Le plus récent d'abord : c'est ce qui appelle une réaction, le reste est de
  // l'histoire qu'on garde sous les yeux sans qu'elle passe devant.
  it("met les mois les plus récents en tête", () => {
    const n = overspendNotifications([
      { accountId: "a1", accountName: "CIC", byMonth: { "2026-05": [dep("Courses", "2026-05", 10)], "2026-07": [dep("Courses", "2026-07", 50)] } },
    ]);
    expect(n.map((x) => x.month)).toEqual(["2026-07", "2026-05"]);
  });

  it("rassemble les comptes et dit à quel compte appartient chaque dépassement", () => {
    const n = overspendNotifications([
      { accountId: "a1", accountName: "CIC courant", byMonth: { "2026-07": [dep("Courses", "2026-07", 50)] } },
      { accountId: "a2", accountName: "CIC joint", byMonth: { "2026-07": [dep("Loyer", "2026-07", 20, 3)] } },
    ]);
    expect(n.map((x) => [x.accountName, x.name])).toEqual([
      ["CIC courant", "Courses"],
      ["CIC joint", "Loyer"],
    ]);
  });

  // Deux comptes peuvent porter un groupe du même identifiant, et une ligne peut avoir
  // le même identifiant qu'un groupe : sans quoi deux notifications distinctes se
  // retrouveraient sous la même clé, et React n'en afficherait qu'une.
  it("donne une clé distincte à chaque bandeau", () => {
    const n = overspendNotifications([
      { accountId: "a1", accountName: "A", byMonth: { "2026-07": [dep("Courses", "2026-07", 50, 1), dep("Netflix", "2026-07", 5, 1, 1)] } },
      { accountId: "a2", accountName: "B", byMonth: { "2026-07": [dep("Courses", "2026-07", 50, 1)] } },
    ]);
    expect(new Set(n.map((x) => x.id)).size).toBe(3);
  });

  // On ne remonte que le mois courant et celui d'avant. Au-delà, un dépassement est de
  // l'histoire ancienne : le rappeler indéfiniment ferait du bouton un compteur qui ne
  // redescend jamais, et une alerte qu'on n'écoute plus n'alerte plus.
  it("ne remonte que le mois courant et le précédent", () => {
    const n = overspendNotifications(
      [{ accountId: "a1", accountName: "CIC", byMonth: {
        "2026-04": [dep("Courses", "2026-04", 10)],
        "2026-05": [dep("Courses", "2026-05", 20)],
        "2026-06": [dep("Courses", "2026-06", 30)],
        "2026-07": [dep("Courses", "2026-07", 40)],
      } }],
      [],
      "2026-07",
    );
    expect(n.map((x) => x.month)).toEqual(["2026-07", "2026-06"]);
  });

  // Sans mois courant fourni, aucun filtre : la fonction reste utilisable telle quelle
  // pour tester le rassemblement et l'ordre, sans avoir à parler de calendrier.
  it("ne filtre rien quand aucun mois courant n'est donné", () => {
    const n = overspendNotifications([
      { accountId: "a1", accountName: "CIC", byMonth: { "2020-01": [dep("Courses", "2020-01", 10)] } },
    ]);
    expect(n).toHaveLength(1);
  });

  it("ne rend rien quand aucun budget n'a dépassé", () => {
    expect(overspendNotifications([{ accountId: "a1", accountName: "CIC", byMonth: {} }])).toEqual([]);
    expect(overspendNotifications([])).toEqual([]);
  });
});

// Une notification se ferme d'une croix, et ne revient pas. Elle est écartée par son
// identité (compte, cible, mois) : le montant, lui, peut encore bouger si la dépense
// continue, sans que la notification écartée reparaisse pour autant.
describe("notifications écartées", () => {
  it("n'affiche plus une notification écartée", () => {
    const parCompte = [{ accountId: "a1", accountName: "CIC", byMonth: { "2026-07": [dep("Courses", "2026-07", 50), dep("Essence", "2026-07", 12, 2)] } }];
    const ecartee = overspendNotifications(parCompte)[0].id;
    expect(overspendNotifications(parCompte, [ecartee]).map((x) => x.name)).toEqual(["Essence"]);
  });

  it("ne fait pas revenir une notification écartée quand son montant change", () => {
    const id = overspendNotifications([{ accountId: "a1", accountName: "CIC", byMonth: { "2026-07": [dep("Courses", "2026-07", 50)] } }])[0].id;
    const plusTard = overspendNotifications([{ accountId: "a1", accountName: "CIC", byMonth: { "2026-07": [dep("Courses", "2026-07", 90)] } }], [id]);
    expect(plusTard).toEqual([]);
  });

  it("n'écarte que ce qui est demandé", () => {
    const parCompte = [{ accountId: "a1", accountName: "CIC", byMonth: { "2026-07": [dep("Courses", "2026-07", 50)] } }];
    expect(overspendNotifications(parCompte, ["une::autre::clé"])).toHaveLength(1);
    expect(overspendNotifications(parCompte, [])).toHaveLength(1);
  });
});

// L'identité d'une notification sert de clé d'acquittement, stockée en base : elle doit
// tenir dans le temps. Le nom d'un compte se renomme, son identifiant non — et c'est le
// seul que la grille connaît quand elle doit dire si une case est déjà acquittée.
describe("identité d'une notification", () => {
  it("s'appuie sur l'identifiant du compte, pas sur son nom", () => {
    const avant = overspendNotifications([{ accountId: "a1", accountName: "CIC", byMonth: { "2026-07": [dep("Courses", "2026-07", 50)] } }]);
    const apresRenommage = overspendNotifications([{ accountId: "a1", accountName: "Compte joint", byMonth: { "2026-07": [dep("Courses", "2026-07", 50)] } }]);
    expect(apresRenommage[0].id).toBe(avant[0].id);
  });

  it("compose l'identité du compte, de la cible et du mois", () => {
    const g = overspendNotifications([{ accountId: "a1", accountName: "CIC", byMonth: { "2026-07": [dep("Courses", "2026-07", 50, 7)] } }]);
    const l = overspendNotifications([{ accountId: "a1", accountName: "CIC", byMonth: { "2026-07": [dep("Netflix", "2026-07", 5, 7, 3)] } }]);
    expect(g[0].id).toBe("a1::g7::2026-07");
    expect(l[0].id).toBe("a1::l3::2026-07");
  });
});

// Le tableau lit la même liste que les notifications : filtrer à la source fait que
// l'étiquette sous un montant disparaît en même temps que le bandeau, sans que chaque
// affichage ait à se souvenir de vérifier.
describe("dépassements acquittés retirés de la liste", () => {
  const item = (groupId: number, lineId: number | null, month: string): Overspend => ({
    groupId, lineId, name: "x", month, amount: 10, kind: lineId === null ? "envelope" : "recurring",
  });

  it("retire la case acquittée, et elle seule", () => {
    const byMonth = { "2026-07": [item(16, null, "2026-07"), item(13, 3, "2026-07")] };
    const reste = withoutDismissed(byMonth, "a1", [notificationId("a1", 16, null, "2026-07")]);
    expect(reste["2026-07"].map((x) => x.groupId)).toEqual([13]);
  });

  it("fait disparaître le mois quand il ne reste plus rien", () => {
    const byMonth = { "2026-07": [item(16, null, "2026-07")] };
    expect(withoutDismissed(byMonth, "a1", [notificationId("a1", 16, null, "2026-07")])).toEqual({});
  });

  // Un acquittement vise un compte précis : le même groupe sur un autre compte garde
  // son dépassement.
  it("n'acquitte que le compte visé", () => {
    const byMonth = { "2026-07": [item(16, null, "2026-07")] };
    expect(withoutDismissed(byMonth, "a2", [notificationId("a1", 16, null, "2026-07")])).toEqual(byMonth);
  });

  it("rend la liste telle quelle quand rien n'est acquitté", () => {
    const byMonth = { "2026-07": [item(16, null, "2026-07")] };
    expect(withoutDismissed(byMonth, "a1", [])).toBe(byMonth);
  });
});
