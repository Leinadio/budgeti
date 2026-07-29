"use server";
import { db } from "../../db/index";
import { setOverspendDecision, deleteOverspendDecision, getOverspendDecision } from "../../db/repositories/overspend-decisions";
import { setBudgetAmount, deleteBudgetAmount, listBudgetAmounts } from "../../db/repositories/budget-amounts";
import {
  insertEnvelopeGroup,
  insertRecurringGroup,
  renameGroup,
  deleteGroup,
  insertLine,
  updateLine,
  deleteLine,
  hasIncomeGroup,
} from "../../db/repositories/groups";
import { toDatedBudgets, onceBudgetWrites, addMonthsKey } from "../../lib/history";
import { monthKey } from "../../lib/money";
import { revalidatePath } from "next/cache";

// Enregistre la décision de l'utilisateur sur un dépassement (groupId 0 = non
// catégorisés). « Permanent » relève le budget (ou la provision du groupe 0) au
// mois suivant le mois courant : le passé et le mois courant gardent leur budget
// réel.
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
  if (decision === "permanent" && newBudget != null && Number.isFinite(newBudget) && newBudget > 0) {
    const currentMonth = monthKey(new Date().toISOString().slice(0, 10));
    setBudgetAmount(database, groupId, addMonthsKey(currentMonth, 1), newBudget);
  }
  revalidatePath("/historique");
  revalidatePath("/");
}

// Annule une décision de dépassement : le dépassement redevient « à trancher »
// (undecided), ce qui n'est PAS reporté sur le Solde si dépassement des mois à
// venir (seuls les dépassements marqués « permanent » le sont). Si la décision
// était « permanent », retire aussi la hausse de budget qu'elle avait écrite.
export async function undoOverspendDecision(
  accountId: string,
  groupId: number,
  month: string,
): Promise<void> {
  if (!/^\d{4}-\d{2}$/.test(month)) return;
  const database = db();
  const existing = getOverspendDecision(database, accountId, groupId, month);
  if (existing?.decision === "permanent") {
    const currentMonth = monthKey(new Date().toISOString().slice(0, 10));
    deleteBudgetAmount(database, groupId, addMonthsKey(currentMonth, 1));
  }
  deleteOverspendDecision(database, accountId, groupId, month);
  revalidatePath("/historique");
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
  revalidatePath("/");
}

// Revalidation commune aux actions de gestion d'un groupe : le changement touche
// l'Historique, le Prévisionnel, les Transactions (réassignation possible) et le
// Tableau de bord.
async function revalidate() {
  revalidatePath("/historique");
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
    const datedForGroup = toDatedBudgets(listBudgetAmounts(database))[groupId] ?? [];
    const { writes } = onceBudgetWrites(datedForGroup, month, amount);
    for (const w of writes) setBudgetAmount(database, groupId, w.effectiveMonth, w.amount);
  } else {
    setBudgetAmount(database, groupId, month, amount);
  }
  await revalidate();
}

// Fixe la provision des non catégorisés (budget daté du groupe 0, une case
// virtuelle sans ligne dans `groups`) pour un mois, avec la même sémantique
// once/ongoing que setGroupAmount, gardée comme une action à part pour ce motif.
export async function setUncatProvision(
  month: string,
  amount: number,
  scope: "once" | "ongoing",
): Promise<void> {
  if (!/^\d{4}-\d{2}$/.test(month) || !Number.isFinite(amount) || amount < 0) return;
  const database = db();
  if (scope === "once") {
    const datedForGroup = toDatedBudgets(listBudgetAmounts(database))[0] ?? [];
    const { writes } = onceBudgetWrites(datedForGroup, month, amount);
    for (const w of writes) setBudgetAmount(database, 0, w.effectiveMonth, w.amount);
  } else {
    setBudgetAmount(database, 0, month, amount);
  }
  revalidatePath("/historique");
  revalidatePath("/");
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
