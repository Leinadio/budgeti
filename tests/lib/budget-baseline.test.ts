import { describe, it, expect } from "vitest";
import { computeHistory } from "../../src/lib/history";
import type { Group, Txn } from "../../src/lib/forecast";
import { seedDated } from "./dated-fixtures";

// Enveloppe locale : sème les montants des fixtures comme le fait la reprise de
// données (cf. tests/lib/history.test.ts). Les valeurs attendues ci-dessous ne
// changent pas : seule la façon de les fournir à computeHistory change.
const hist = (groups: Group[], txns: Txn[], months: string[], current: string) => {
  const { dated, datedLines } = seedDated(groups);
  return computeHistory(groups, txns, months, current, dated, datedLines);
};

// Jeu calqué sur la vraie base : deux récurrents (Abonnements, Impôts), trois
// enveloppes de dépense (Carburant, Activités, Vêtement) et une rémunération.
// Ce fichier fige les budgets tels qu'ils sortent AUJOURD'HUI. Aucune tâche de
// la refonte n'a le droit de le faire bouger.
const abonnements: Group = {
  id: 13, accountId: "a1", name: "Abonnements", direction: "out",
  monthlyAmount: null, startMonth: "2000-01", endMonth: null,
  lines: [
    { id: 101, name: "Direct Assurance voiture", amount: 81.84 },
    { id: 102, name: "Sosh Internet", amount: 30.99 },
    { id: 103, name: "Sosh Mobile", amount: 15.99 },
    { id: 104, name: "Spotify", amount: 12.14 },
    { id: 105, name: "iCloud", amount: 9.99 },
    { id: 106, name: "Fitness Park", amount: 19.99 },
  ],
};
const impots: Group = {
  id: 15, accountId: "a1", name: "Impôts", direction: "out",
  monthlyAmount: null, startMonth: "2000-01", endMonth: null,
  lines: [{ id: 110, name: "Prélèvement à la source", amount: 49 }],
};
const carburant: Group = {
  id: 14, accountId: "a1", name: "Carburant voiture", direction: "out",
  monthlyAmount: 85, lines: [], startMonth: "2000-01", endMonth: null,
};
const activites: Group = {
  id: 16, accountId: "a1", name: "Activités", direction: "out",
  monthlyAmount: 250, lines: [], startMonth: "2000-01", endMonth: null,
};
const vetement: Group = {
  id: 17, accountId: "a1", name: "Vêtement", direction: "out",
  monthlyAmount: 0, lines: [], startMonth: "2000-01", endMonth: null,
};
const remuneration: Group = {
  id: 21, accountId: "a1", name: "Rémunération Principale", direction: "in",
  monthlyAmount: 652.09, lines: [], startMonth: "2000-01", endMonth: null,
};
const GROUPS = [abonnements, impots, carburant, activites, vetement, remuneration];

const txns: Txn[] = [
  { id: "t1", date: "2026-07-05", amount: -151.84, label: "DIRECT ASSURANCE", accountId: "a1", groupId: 13, lineId: 101 },
  { id: "t2", date: "2026-07-08", amount: -30.99, label: "SOSH INTERNET", accountId: "a1", groupId: 13, lineId: 102 },
  { id: "t3", date: "2026-07-12", amount: -12.14, label: "SPOTIFY", accountId: "a1", groupId: 13, lineId: 104 },
  { id: "t4", date: "2026-07-15", amount: -1.99, label: "ICLOUD", accountId: "a1", groupId: 13, lineId: 105 },
  { id: "t5", date: "2026-07-20", amount: -19, label: "FITNESS PARK", accountId: "a1", groupId: 13, lineId: 106 },
  { id: "t6", date: "2026-07-15", amount: -49, label: "DGFIP", accountId: "a1", groupId: 15, lineId: 110 },
  { id: "t7", date: "2026-07-03", amount: -92.71, label: "TOTAL", accountId: "a1", groupId: 14 },
  { id: "t8", date: "2026-07-10", amount: -468.19, label: "CINEMA", accountId: "a1", groupId: 16 },
];

const MONTHS = ["2026-07", "2026-08", "2026-09"];

// Budget attendu par groupe, pour chacun des trois mois.
const ATTENDU: Record<number, number[]> = {
  13: [170.94, 170.94, 170.94], // somme des six lignes
  15: [49, 49, 49],
  14: [85, 85, 85],
  16: [250, 250, 250],
  17: [0, 0, 0],
  21: [652.09, 652.09, 652.09],
};

// Budget attendu par ligne de récurrent, pour chacun des trois mois.
const ATTENDU_LIGNES: Record<number, number[]> = {
  101: [81.84, 81.84, 81.84],
  102: [30.99, 30.99, 30.99],
  103: [15.99, 15.99, 15.99],
  104: [12.14, 12.14, 12.14],
  105: [9.99, 9.99, 9.99],
  106: [19.99, 19.99, 19.99],
  110: [49, 49, 49],
};

function budgetsParGroupe() {
  const sections = hist(GROUPS, txns, MONTHS, "2026-07");
  const out: Record<number, number[]> = {};
  const outLignes: Record<number, number[]> = {};
  for (const s of sections) {
    for (const r of s.rows) {
      out[r.id] = r.cells.map((c) => c.budgeted);
      for (const sr of r.subRows) outLignes[sr.id] = sr.cells.map((c) => c.budgeted);
    }
  }
  return { out, outLignes };
}

describe("budgets de référence (ne doivent jamais bouger)", () => {
  it("garde le budget de chaque groupe sur trois mois", () => {
    const { out } = budgetsParGroupe();
    for (const [id, attendu] of Object.entries(ATTENDU)) {
      attendu.forEach((v, i) => expect(out[Number(id)][i]).toBeCloseTo(v, 2));
    }
  });

  it("garde le budget de chaque ligne de récurrent sur trois mois", () => {
    const { outLignes } = budgetsParGroupe();
    for (const [id, attendu] of Object.entries(ATTENDU_LIGNES)) {
      attendu.forEach((v, i) => expect(outLignes[Number(id)][i]).toBeCloseTo(v, 2));
    }
  });

  it("garde le dépensé et le reste du mois écoulé", () => {
    const sections = hist(GROUPS, txns, MONTHS, "2026-07");
    const ligne = (id: number) => sections.flatMap((s) => s.rows).find((r) => r.id === id)!;
    // Abonnements : 215,96 dépensés pour 170,94 budgétés, soit 45,02 de dépassement.
    expect(ligne(13).cells[0].depense).toBeCloseTo(215.96, 2);
    expect(ligne(13).cells[0].balance).toBeCloseTo(-45.02, 2);
    // Activités : 468,19 dépensés pour 250 budgétés.
    expect(ligne(16).cells[0].balance).toBeCloseTo(-218.19, 2);
  });
});
