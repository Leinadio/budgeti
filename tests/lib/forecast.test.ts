import { expect, test, it } from "vitest";
import { computeForecast, type Group, type Txn } from "../../src/lib/forecast";

const courses: Group = {
  id: 1, accountId: "a1", name: "Courses", direction: "out", kind: "envelope",
  monthlyAmount: 300, lines: [],
};
const abo: Group = {
  id: 2, accountId: "a1", name: "Abonnements", direction: "out", kind: "recurring",
  monthlyAmount: null,
  lines: [
    { id: 11, name: "Spotify", amount: 10, day: 3 },
    { id: 12, name: "Netflix", amount: 15, day: 8 },
  ],
};
const salaire: Group = {
  id: 3, accountId: "a1", name: "Salaire", direction: "in", kind: "recurring",
  monthlyAmount: null,
  lines: [{ id: 31, name: "Rémunération", amount: 2000, day: 1 }],
};

function tx(p: Partial<Txn>): Txn {
  return { id: "t", date: "2026-07-05", amount: -10, label: "", accountId: "a1", groupId: null, ...p };
}

test("envelope: spent via ownership, remaining floored, subtracted from current", () => {
  const txns = [tx({ id: "t1", amount: -120, label: "CARREFOUR CITY", groupId: 1 }), tx({ id: "t2", amount: -30, label: "LECLERC", groupId: 1 })];
  const f = computeForecast("a1", 1000, [courses], txns, "2026-07");
  // dépensé 150 / 300 -> reste 150
  expect(f.currentEstimate).toBe(850);
  const gv = f.groups.find((g) => g.id === 1)!;
  expect(gv.total).toBe(300);
  expect(gv.spent).toBe(150);
});

test("envelope overspend: remaining floored at 0 but spent kept real", () => {
  const txns = [tx({ id: "t1", amount: -450, label: "CARREFOUR", groupId: 1 })];
  const f = computeForecast("a1", 1000, [courses], txns, "2026-07");
  expect(f.currentEstimate).toBe(1000);
  const gv = f.groups[0];
  expect(gv.spent).toBe(450); // dépense réelle, non plafonnée
  expect(gv.overspend).toBe(150); // 450 - 300
});

test("no overspend: overspend and prevOverspend are 0", () => {
  const txns = [tx({ id: "t1", amount: -120, label: "CARREFOUR" })];
  const f = computeForecast("a1", 1000, [courses], txns, "2026-07");
  const gv = f.groups[0];
  expect(gv.overspend).toBe(0);
  expect(gv.prevOverspend).toBe(0);
});

test("overspend this month only: current overspend set, previous month clean", () => {
  const txns = [tx({ id: "t1", date: "2026-07-05", amount: -500, label: "CARREFOUR", groupId: 1 })];
  const f = computeForecast("a1", 1000, [courses], txns, "2026-07");
  const gv = f.groups[0];
  expect(gv.overspend).toBe(200); // 500 - 300
  expect(gv.prevSpent).toBe(0);
  expect(gv.prevOverspend).toBe(0);
});

test("overspend last month only: prev recap set, current month clean", () => {
  const txns = [tx({ id: "t1", date: "2026-06-10", amount: -500, label: "CARREFOUR", groupId: 1 })];
  const f = computeForecast("a1", 1000, [courses], txns, "2026-07");
  const gv = f.groups[0];
  expect(gv.overspend).toBe(0);
  expect(gv.spent).toBe(0);
  expect(gv.prevSpent).toBe(500);
  expect(gv.prevOverspend).toBe(200); // 500 - 300
});

test("overspend both months: current and previous both set", () => {
  const txns = [
    tx({ id: "t1", date: "2026-07-05", amount: -450, label: "CARREFOUR", groupId: 1 }),
    tx({ id: "t2", date: "2026-06-10", amount: -520, label: "LECLERC", groupId: 1 }),
  ];
  const f = computeForecast("a1", 1000, [courses], txns, "2026-07");
  const gv = f.groups[0];
  expect(gv.overspend).toBe(150); // 450 - 300
  expect(gv.prevOverspend).toBe(220); // 520 - 300
});

test("prevMonthKey handles year boundary (january -> previous december)", () => {
  const txns = [tx({ id: "t1", date: "2025-12-15", amount: -500, label: "CARREFOUR", groupId: 1 })];
  const f = computeForecast("a1", 1000, [courses], txns, "2026-01");
  expect(f.groups[0].prevSpent).toBe(500);
  expect(f.groups[0].prevOverspend).toBe(200);
});

test("recurring line unseen subtracted; seen ignored; timeline sorted", () => {
  const txns = [tx({ id: "t1", amount: -10, label: "PRLV SPOTIFY", groupId: 2, lineId: 11 })]; // Spotify rattachée
  const f = computeForecast("a1", 1000, [abo], txns, "2026-07");
  // Spotify vue -> ignorée ; Netflix non vue -> -15
  expect(f.currentEstimate).toBe(985);
  expect(f.timeline.map((i) => [i.day, i.name, i.seen])).toEqual([[3, "Spotify", true], [8, "Netflix", false]]);
});

test("recurring in-line added when unseen", () => {
  const f = computeForecast("a1", 500, [salaire], [], "2026-07");
  expect(f.currentEstimate).toBe(2500);
});

test("ambiguous transaction counts in no group", () => {
  const dup: Group = { ...courses, id: 4, name: "Courses2" };
  const txns = [tx({ id: "t1", amount: -50, label: "CARREFOUR" })];
  const f = computeForecast("a1", 1000, [courses, dup], txns, "2026-07");
  // ambiguë -> non comptée : les deux enveloppes gardent reste plein (300 chacune)
  expect(f.currentEstimate).toBe(1000 - 300 - 300);
  expect(f.groups.find((g) => g.id === 1)!.spent).toBe(0);
});

test("manual attachment overrides keyword", () => {
  // "CARREFOUR" matcherait Courses, mais rattaché manuellement à l'enveloppe id 5
  const autre: Group = { id: 5, accountId: "a1", name: "Autre", direction: "out", kind: "envelope", monthlyAmount: 100, lines: [] };
  const txns = [tx({ id: "t1", amount: -40, label: "CARREFOUR", groupId: 5 })];
  const f = computeForecast("a1", 1000, [courses, autre], txns, "2026-07");
  expect(f.groups.find((g) => g.id === 5)!.spent).toBe(40); // compte dans Autre
  expect(f.groups.find((g) => g.id === 1)!.spent).toBe(0);  // pas dans Courses
});

test("manual line attachment marks the line seen even without keyword match", () => {
  // Prélèvement Netflix dont le libellé ne contient pas "NETFLIX", mais rattaché
  // à la main à la ligne Netflix (id 12) : la ligne doit être considérée vue.
  const txns = [tx({ id: "t1", amount: -15, label: "PRLV DIVERS 4821", groupId: 2, lineId: 12 })];
  const f = computeForecast("a1", 1000, [abo], txns, "2026-07");
  // Netflix vue (rattachée) -> ignorée ; Spotify non vue -> -10
  expect(f.currentEstimate).toBe(990);
  expect(f.timeline.map((i) => [i.name, i.seen])).toEqual([["Spotify", false], ["Netflix", true]]);
  // la ligne rattachée compte dans le dépensé "vu" du groupe
  expect(f.groups.find((g) => g.id === 2)!.spent).toBe(15);
});

test("income envelope adds to estimates instead of subtracting", () => {
  const salaireEnv: Group = {
    id: 9, accountId: "a1", name: "Salaire", direction: "in", kind: "envelope",
    monthlyAmount: 2000, lines: [],
  };
  const f = computeForecast("a1", 1000, [salaireEnv], [], "2026-07");
  // rien reçu -> reste à recevoir 2000 : current 1000 + 2000 = 3000
  expect(f.currentEstimate).toBe(3000);
  // mois prochain : + 2000 -> 5000
  expect(f.nextEstimate).toBe(5000);
  // pas de dépassement sur une entrée
  expect(f.groups[0].overspend).toBe(0);
  expect(f.nextSteps.find((s) => s.label.includes("Salaire"))?.amount).toBe(2000);
});

test("overspend projection: next month keeps the overspend", () => {
  const txns = [tx({ id: "t1", amount: -450, label: "CARREFOUR", groupId: 1 })]; // 450 pour 300 de budget
  const f = computeForecast("a1", 1000, [courses], txns, "2026-07");
  // nextEstimate normal : 1000 - 300 (budget) = 700
  expect(f.nextEstimate).toBe(700);
  expect(f.overspendTotal).toBe(150); // 450 - 300
  // avec dépassement maintenu : 700 - 150 = 550
  expect(f.nextEstimateWithOverspend).toBe(550);
  expect(f.overspendSteps).toEqual([{ label: "Courses — dépassement maintenu", amount: -150, groupId: 1 }]);
});

test("no overspend: with-overspend estimate equals next estimate", () => {
  const f = computeForecast("a1", 1000, [courses], [], "2026-07");
  expect(f.overspendTotal).toBe(0);
  expect(f.nextEstimateWithOverspend).toBe(f.nextEstimate);
  expect(f.overspendSteps).toEqual([]);
});

test("breakdown steps reconstruct both estimates exactly", () => {
  const txns = [tx({ id: "t1", amount: -120, label: "CARREFOUR", groupId: 1 }), tx({ id: "t2", amount: -10, label: "PRLV SPOTIFY", groupId: 2, lineId: 11 })];
  const f = computeForecast("a1", 1000, [courses, abo, salaire], txns, "2026-07");
  const sumCurrent = f.currentSteps.reduce((s, x) => s + x.amount, 0);
  const sumNext = f.nextSteps.reduce((s, x) => s + x.amount, 0);
  expect(f.balance + sumCurrent).toBe(f.currentEstimate);
  expect(f.currentEstimate + sumNext).toBe(f.nextEstimate);
  // Spotify déjà vue -> pas d'étape "pas encore passé" pour elle ce mois-ci.
  expect(f.currentSteps.some((s) => s.label.includes("Spotify"))).toBe(false);
});

test("next month starts from current estimate and applies full amounts", () => {
  const f = computeForecast("a1", 1000, [courses, abo, salaire], [], "2026-07");
  // courant : -300 (courses reste plein) -10 -15 (abo) +2000 (salaire) = 2675
  expect(f.currentEstimate).toBe(2675);
  // suivant : 2675 + (2000 - 10 - 15 - 300) = 4350
  expect(f.nextEstimate).toBe(4350);
});

test("rémunération principale : ajoutée à l'estimé du mois courant ET du mois suivant", () => {
  const principal: Group = {
    id: 40, accountId: "a1", name: "Rémunération principale", direction: "in",
    kind: "envelope", monthlyAmount: 2000, lines: [], incomeKind: "principal",
  };
  const f = computeForecast("a1", 100, [principal], [], "2026-07");
  expect(f.currentEstimate).toBe(2100); // 100 + 2000 attendus
  expect(f.nextEstimate).toBe(4100); // + 2000 le mois suivant
});

test("rémunération supplémentaire : mois courant seulement, pas de projection au mois suivant", () => {
  const supp: Group = {
    id: 41, accountId: "a1", name: "Rémunération supplémentaire", direction: "in",
    kind: "envelope", monthlyAmount: 500, lines: [], incomeKind: "supplementary",
  };
  const f = computeForecast("a1", 100, [supp], [], "2026-07");
  expect(f.currentEstimate).toBe(600); // 100 + 500 attendus ce mois
  expect(f.nextEstimate).toBe(600); // pas d'ajout au mois suivant
});

it("un groupe pas encore né n'entre pas dans l'estimé", () => {
  const futur: Group = { ...courses, id: 70, name: "Futur", startMonth: "2026-10", endMonth: null };
  const f = computeForecast("a1", 1000, [futur], [], "2026-07");
  // Aucun budget projeté : l'estimé courant reste le solde.
  expect(f.currentEstimate).toBe(1000);
  expect(f.groups.some((g) => g.id === 70)).toBe(false);
});

it("enveloppe ponctuelle (fin ce mois-ci) : pèse sur l'estimé courant mais pas sur celui du mois prochain", () => {
  // endMonth = mois courant : vivante ce mois-ci, morte le mois prochain.
  const ponctuel: Group = { ...courses, id: 71, name: "Ponctuel", startMonth: null, endMonth: "2026-07" };
  const f = computeForecast("a1", 1000, [ponctuel], [], "2026-07");
  // Ce mois-ci : reste plein 300 retiré -> 700.
  expect(f.currentEstimate).toBe(700);
  // Mois prochain : le groupe a disparu, l'estimé N'EST PAS amputé du budget.
  // (l'ancienne logique mono-mois donnait 700 - 300 = 400)
  expect(f.nextEstimate).toBe(700);
  expect(f.nextSteps.some((s) => s.groupId === 71)).toBe(false);
});

it("enveloppe qui démarre le mois prochain : absente ce mois-ci, projetée au mois prochain", () => {
  // startMonth = mois courant + 1 : pas encore née ce mois-ci, vivante le mois prochain.
  const futur: Group = { ...courses, id: 72, name: "Bientôt", startMonth: "2026-08", endMonth: null };
  const f = computeForecast("a1", 1000, [futur], [], "2026-07");
  // Ce mois-ci : rien (groupe absent des vues et du calcul courant).
  expect(f.currentEstimate).toBe(1000);
  expect(f.groups.some((g) => g.id === 72)).toBe(false);
  // Mois prochain : le budget est bien projeté (l'ancienne logique laissait 1000).
  expect(f.nextEstimate).toBe(700);
  expect(f.nextSteps.some((s) => s.groupId === 72)).toBe(true);
});
