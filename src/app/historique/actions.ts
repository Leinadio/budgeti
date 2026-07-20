"use server";
import { db } from "../../db/index";
import { setOverspendDecision } from "../../db/repositories/overspend-decisions";
import { setBudgetAmount, listBudgetAmounts } from "../../db/repositories/budget-amounts";
import {
  insertEnvelopeGroup,
  insertRecurringGroup,
  renameGroup,
  deleteGroup,
  insertLine,
  updateLine,
  deleteLine,
  listGroups,
  hasIncomeGroup,
} from "../../db/repositories/groups";
import { monthKey } from "../../lib/money";
import { addMonthsKey, toDatedBudgets, budgetInForce, onceBudgetWrites } from "../../lib/history";
import type { Group } from "../../lib/forecast";
import { revalidatePath } from "next/cache";

// Enregistre la décision de l'utilisateur sur un dépassement (groupId 0 = non
// catégorisés). « permanent » relève aussi le budget du groupe, effectif au mois
// SUIVANT le mois courant : le mois courant et les mois passés gardent leur budget
// (et donc leur dépassement réel visible dans l'historique) ; seule la projection
// des mois à venir intègre le nouveau budget.
export async function decideOverspend(
  accountId: string,
  groupId: number,
  month: string,
  decision: "exceptional" | "permanent",
  newBudget?: number,
): Promise<void> {
  if (!/^\d{4}-\d{2}$/.test(month)) return;
  const database = db();
  setOverspendDecision(database, { accountId, groupId, month, decision, decidedAt: new Date().toISOString() });
  if (decision === "permanent" && groupId !== 0 && newBudget != null && Number.isFinite(newBudget) && newBudget > 0) {
    const currentMonth = monthKey(new Date().toISOString().slice(0, 10));
    setBudgetAmount(database, groupId, addMonthsKey(currentMonth, 1), newBudget);
  }
  revalidatePath("/historique");
  revalidatePath("/previsionnel");
  revalidatePath("/");
}

// Création inline d'un groupe (enveloppe ou récurrent) depuis le tableau de
// l'Historique. Toujours en dépense (« out ») et sans rémunération associée ;
// la durée de vie fixe la portée : « ce mois seulement » (endMonth = startMonth)
// ou permanente (endMonth = null).
export async function createGroup(input: {
  accountId: string;
  kind: "envelope" | "recurring";
  name: string;
  amount: number | null;
  startMonth: string;
  scope: "once" | "ongoing";
}): Promise<void> {
  const { accountId, kind, name, amount, startMonth, scope } = input;
  if (!/^\d{4}-\d{2}$/.test(startMonth)) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  const endMonth = scope === "once" ? startMonth : null;
  const database = db();
  if (kind === "envelope") {
    insertEnvelopeGroup(database, accountId, trimmed, "out", amount ?? 0, null, startMonth, endMonth);
  } else {
    insertRecurringGroup(database, accountId, trimmed, "out", null, startMonth, endMonth);
  }
  revalidatePath("/historique");
  revalidatePath("/previsionnel");
  revalidatePath("/");
}

// Revalidation commune aux actions de gestion d'un groupe : le changement touche
// l'Historique, le Prévisionnel, les Transactions (réassignation possible) et le
// Tableau de bord.
async function revalidate() {
  revalidatePath("/historique");
  revalidatePath("/previsionnel");
  revalidatePath("/transactions");
  revalidatePath("/");
}

// Création d'une rémunération (principale ou supplémentaire) depuis l'en-tête de
// la section Rémunérations de l'Historique. Toujours en revenu (« in »), toujours
// permanente (start_month = '2000-01', end_month = null : visible sur tout
// l'historique et le prévisionnel) — pas de durée de vie ni de portée ponctuelle,
// contrairement aux groupes de dépense (cf. createGroup). Une seule principale et
// une seule supplémentaire par compte : no-op silencieux si elle existe déjà.
export async function createRemuneration(
  accountId: string,
  incomeKind: "principal" | "supplementary",
  amount: number,
): Promise<void> {
  if (!Number.isFinite(amount) || amount < 0) return;
  const database = db();
  if (hasIncomeGroup(database, accountId, incomeKind)) return; // déjà créée
  const name = incomeKind === "principal" ? "Rémunération principale" : "Rémunération supplémentaire";
  insertEnvelopeGroup(database, accountId, name, "in", amount, incomeKind, "2000-01", null);
  await revalidate();
}

export async function renameGroupAction(groupId: number, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  renameGroup(db(), groupId, trimmed);
  await revalidate();
}

export async function deleteGroupAction(groupId: number): Promise<void> {
  // La FK transactions.group_id ON DELETE SET NULL renvoie les transactions en Non catégorisés.
  deleteGroup(db(), groupId);
  await revalidate();
}

// Fixe le montant d'un groupe pour un mois, en réutilisant les budgets datés.
// « à partir de ce mois » (ongoing) écrit un seul montant daté à `month`. « ce mois
// seulement » (once) écrit le montant à `month` et restaure le montant précédent au
// mois suivant, pour ne pas propager le changement aux mois d'après.
export async function setGroupAmount(
  groupId: number,
  month: string,
  amount: number,
  scope: "once" | "ongoing",
): Promise<void> {
  if (!/^\d{4}-\d{2}$/.test(month) || !Number.isFinite(amount) || amount < 0) return;
  const database = db();
  if (scope === "once") {
    const g = listGroups(database).find((x) => x.id === groupId);
    if (!g) return;
    const grp = g as unknown as Group;
    const datedForGroup = toDatedBudgets(listBudgetAmounts(database))[groupId] ?? [];
    // Budget de base du groupe (sans aucune entrée datée), pour la restauration à month+1.
    const base = budgetInForce(grp, month, {});
    const { writes } = onceBudgetWrites(datedForGroup, base, month, amount);
    for (const w of writes) setBudgetAmount(database, groupId, w.effectiveMonth, w.amount);
  } else {
    setBudgetAmount(database, groupId, month, amount);
  }
  await revalidate();
}

export async function addGroupLine(groupId: number, name: string, amount: number, day: number): Promise<number> {
  const trimmed = name.trim();
  if (!trimmed) return -1;
  const id = insertLine(db(), groupId, trimmed, amount, day);
  await revalidate();
  return id;
}

export async function editGroupLine(lineId: number, name: string, amount: number, day: number): Promise<void> {
  if (!name.trim()) return;
  updateLine(db(), lineId, name.trim(), amount, day);
  await revalidate();
}

export async function removeGroupLine(lineId: number): Promise<void> {
  deleteLine(db(), lineId);
  await revalidate();
}
