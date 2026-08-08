// Ferme la boucle entre le SQL de production et les chiffres affichés. La
// conception (docs/superpowers/specs/2026-07-29-budgets-dates-design.md, section
// Tests, point 1) exige : « sur une base peuplée comme la vraie, les budgets
// calculés avant et après migration sont égaux au centime ». Ce test-là n'existait
// pas :
//   - tests/lib/budget-baseline.test.ts sème via seedDated (dated-fixtures.ts),
//     une réécriture TypeScript du SQL de migrateSeedDatedAmounts — jamais la
//     vraie migration.
//   - tests/db/seed-dated-amounts.test.ts appelle la vraie migration, mais
//     n'assure que sur les lignes brutes de budget_amounts/line_amounts, sans
//     jamais calculer un budget.
// Les deux moitiés de la preuve ne se touchaient jamais. Celle-ci sème les mêmes
// groupes, lignes et transactions que budget-baseline.test.ts, mais dans les
// ANCIENNES colonnes (groups.monthly_amount, group_lines.amount — comme une
// vraie base avant reprise, puisque insertGroup/insertGroup/
// insertLine n'écrivent jamais budget_amounts ni line_amounts), appelle la
// vraie migrateSeedDatedAmounts(), puis calcule les budgets avec computeHistory
// sur ce qui en ressort — comparés aux mêmes valeurs attendues que la fixture
// TypeScript. Un désaccord entre le SQL de production et sa réécriture
// TypeScript ferait échouer ce test-ci sans forcément faire échouer les deux
// autres.
import { expect, test } from "vitest";
import { getDb } from "../../src/db/index";
import { migrateSeedDatedAmounts } from "../../src/db/migrations";
import { upsertAccount } from "../../src/db/repositories/accounts";
import { insertGroup, insertLine, listGroups } from "../../src/db/repositories/groups";
import { listBudgetAmounts } from "../../src/db/repositories/budget-amounts";
import { listLineAmounts } from "../../src/db/repositories/line-amounts";
import { insertManualTransaction, listTransactions } from "../../src/db/repositories/transactions";
import { computeHistory, toDatedBudgets, toDatedLineAmounts } from "../../src/lib/history";
import type { Group, Txn } from "../../src/lib/forecast";

const MONTHS = ["2026-07", "2026-08", "2026-09"];

// Mêmes valeurs que tests/lib/budget-baseline.test.ts (ATTENDU / ATTENDU_LIGNES),
// indexées par nom plutôt que par id : les id auto-incrémentés en base réelle ne
// sont pas ceux, fixes, de la fixture TypeScript.
const ATTENDU: Record<string, number[]> = {
  "Abonnements": [170.94, 170.94, 170.94], // somme des six lignes
  "Impôts": [49, 49, 49],
  "Carburant voiture": [85, 85, 85],
  "Activités": [250, 250, 250],
  "Vêtement": [0, 0, 0],
  "Rémunération Principale": [652.09, 652.09, 652.09],
};
const ATTENDU_LIGNES: Record<string, number[]> = {
  "Direct Assurance voiture": [81.84, 81.84, 81.84],
  "Sosh Internet": [30.99, 30.99, 30.99],
  "Sosh Mobile": [15.99, 15.99, 15.99],
  "Spotify": [12.14, 12.14, 12.14],
  "iCloud": [9.99, 9.99, 9.99],
  "Fitness Park": [19.99, 19.99, 19.99],
  "Prélèvement à la source": [49, 49, 49],
};

test("les budgets calculés par computeHistory sont égaux au centime avant/après la vraie migration, sur une base peuplée comme la vraie", () => {
  const db = getDb(":memory:");
  upsertAccount(db, { id: "a1", name: "CIC", iban_masked: null, balance: 0, currency: "EUR", last_synced: null });

  // Semé dans les ANCIENNES colonnes seulement (monthly_amount / group_lines.amount),
  // comme une vraie base avant reprise : ces fonctions n'écrivent jamais
  // budget_amounts ni line_amounts (voir src/db/repositories/groups.ts).
  const abo = insertGroup(db, "a1", "Abonnements", "out", 0, null, "2000-01", null);
  const directAssurance = insertLine(db, abo, "Direct Assurance voiture", 81.84);
  const soshInternet = insertLine(db, abo, "Sosh Internet", 30.99);
  insertLine(db, abo, "Sosh Mobile", 15.99);
  const spotify = insertLine(db, abo, "Spotify", 12.14);
  const icloud = insertLine(db, abo, "iCloud", 9.99);
  const fitnessPark = insertLine(db, abo, "Fitness Park", 19.99);
  const impots = insertGroup(db, "a1", "Impôts", "out", 0, null, "2000-01", null);
  const prelevement = insertLine(db, impots, "Prélèvement à la source", 49);
  const carburant = insertGroup(db, "a1", "Carburant voiture", "out", 85, null, "2000-01", null);
  const activites = insertGroup(db, "a1", "Activités", "out", 250, null, "2000-01", null);
  insertGroup(db, "a1", "Vêtement", "out", 0, null, "2000-01", null);
  insertGroup(db, "a1", "Rémunération Principale", "in", 652.09, "principal", "2000-01", null);

  // Mêmes transactions que tests/lib/budget-baseline.test.ts.
  const txn = (id: string, date: string, amount: number, label: string, groupId: number, lineId: number | null) =>
    insertManualTransaction(db, { accountId: "a1", date, amount, label, groupId, lineId, incomeKind: null });
  txn("t1", "2026-07-05", -151.84, "DIRECT ASSURANCE", abo, directAssurance);
  txn("t2", "2026-07-08", -30.99, "SOSH INTERNET", abo, soshInternet);
  txn("t3", "2026-07-12", -12.14, "SPOTIFY", abo, spotify);
  txn("t4", "2026-07-15", -1.99, "ICLOUD", abo, icloud);
  txn("t5", "2026-07-20", -19, "FITNESS PARK", abo, fitnessPark);
  txn("t6", "2026-07-15", -49, "DGFIP", impots, prelevement);
  txn("t7", "2026-07-03", -92.71, "TOTAL", carburant, null);
  txn("t8", "2026-07-10", -468.19, "CINEMA", activites, null);

  // Avant la vraie migration : aucune entrée datée nulle part, comme une vraie
  // base jamais reprise.
  expect(listBudgetAmounts(db)).toEqual([]);
  expect(listLineAmounts(db)).toEqual([]);

  // La vraie migration, réellement appelée (pas seedDated, sa réécriture TypeScript).
  migrateSeedDatedAmounts(db);

  const groups = listGroups(db).filter((g) => g.accountId === "a1") as unknown as Group[];
  const dated = toDatedBudgets(listBudgetAmounts(db));
  const datedLines = toDatedLineAmounts(listLineAmounts(db));
  const txns: Txn[] = listTransactions(db).map((t) => ({
    id: t.id,
    date: t.date,
    amount: t.amount,
    label: t.label,
    accountId: t.accountId,
    groupId: t.groupId,
    lineId: t.lineId,
    excluded: t.excluded,
    incomeKind: t.incomeKind,
  }));

  const sections = computeHistory(groups, txns, MONTHS, "2026-07", dated, datedLines);
  const budgetParNom: Record<string, number[]> = {};
  const budgetParLigneNom: Record<string, number[]> = {};
  for (const s of sections) {
    for (const r of s.rows) {
      budgetParNom[r.name] = r.cells.map((c) => c.budgeted);
      for (const sr of r.subRows) budgetParLigneNom[sr.name] = sr.cells.map((c) => c.budgeted);
    }
  }

  for (const [name, attendu] of Object.entries(ATTENDU)) {
    attendu.forEach((v, i) => expect(budgetParNom[name]?.[i], `${name}, mois ${i}`).toBeCloseTo(v, 2));
  }
  for (const [name, attendu] of Object.entries(ATTENDU_LIGNES)) {
    attendu.forEach((v, i) => expect(budgetParLigneNom[name]?.[i], `${name}, mois ${i}`).toBeCloseTo(v, 2));
  }

  // Même dépensé/reste que la fixture TypeScript, pour le mois écoulé.
  const ligne = (name: string) => sections.flatMap((s) => s.rows).find((r) => r.name === name)!;
  expect(ligne("Abonnements").cells[0].depense).toBeCloseTo(215.96, 2);
  expect(ligne("Abonnements").cells[0].balance).toBeCloseTo(-45.02, 2);
  expect(ligne("Activités").cells[0].balance).toBeCloseTo(-218.19, 2);
});
