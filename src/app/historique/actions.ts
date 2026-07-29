"use server";
import type Database from "better-sqlite3";
import { db } from "../../db/index";
import { setOverspendDecision, deleteOverspendDecision, getOverspendDecision } from "../../db/repositories/overspend-decisions";
import { setBudgetAmount, deleteBudgetAmount, listBudgetAmounts } from "../../db/repositories/budget-amounts";
import { listLineAmounts, setLineAmount, deleteLineAmount } from "../../db/repositories/line-amounts";
import {
  insertEnvelopeGroup,
  insertRecurringGroup,
  renameGroup,
  deleteGroup,
  insertLine,
  updateLine,
  deleteLine,
  hasIncomeGroup,
  getGroupKind,
} from "../../db/repositories/groups";
import { toDatedBudgets, toDatedLineAmounts, onceBudgetWrites, nextMonthKey } from "../../lib/history";
import { envelopeWrites, lineWrites, undoWrites, amountAt, canDecidePermanent, normalizeWrites, type BudgetWrite } from "../../lib/overspend-writes";
import { revalidatePath } from "next/cache";

// Défait les écritures d'une décision « permanent » : restaure les entrées qui
// avaient un montant d'avant, supprime celles qui n'en avaient pas, laisse
// intactes celles modifiées à la main depuis (undoWrites, pur, fait le tri).
// Partagée par decideOverspend (avant de reposer de nouvelles écritures sur la
// même case) et undoOverspendDecision (annulation).
function applyUndo(database: Database.Database, writes: BudgetWrite[]): void {
  const dated = toDatedBudgets(listBudgetAmounts(database));
  const datedLines = toDatedLineAmounts(listLineAmounts(database));
  const enPlace = (w: BudgetWrite) => amountAt(w.target === "line" ? (datedLines[w.id] ?? []) : (dated[w.id] ?? []), w.month);
  const { restore, remove } = undoWrites(writes, enPlace);
  for (const w of restore) {
    if (w.target === "line") setLineAmount(database, w.id, w.month, w.before!);
    else setBudgetAmount(database, w.id, w.month, w.before!);
  }
  for (const w of remove) {
    if (w.target === "line") deleteLineAmount(database, w.id, w.month);
    else deleteBudgetAmount(database, w.id, w.month);
  }
}

// Enregistre la décision de l'utilisateur sur un dépassement (groupId 0 = non
// catégorisés). « Permanent » relève le budget au mois qui SUIT celui du
// dépassement : le mois du dépassement garde son budget réel. Pour une enveloppe
// (ou la provision du groupe 0), un seul montant ; pour un récurrent, un montant
// par ligne qui a dépassé — un récurrent n'a pas de montant à lui, une décision
// « permanent » sans ventilation par ligne est donc refusée (canDecidePermanent) :
// mieux vaut laisser le dépassement « à trancher » que faire taire l'alerte sans
// rien relever, ou écrire un montant que plus rien ne lit. Re-trancher une case
// déjà décidée défait d'abord les écritures de la décision existante (applyUndo)
// avant d'en poser de nouvelles : sans ça, le montant d'avant capturé par la
// nouvelle décision serait celui posé par l'ancienne, pas la vraie valeur
// d'origine — orpheline, sans recours, une fois la nouvelle décision annulée.
export async function decideOverspend(
  accountId: string,
  groupId: number,
  month: string,
  decision: "exceptional" | "permanent",
  newBudget?: number,
  lineAmounts?: { lineId: number; amount: number }[],
): Promise<void> {
  if (!/^\d{4}-\d{2}$/.test(month)) return;
  const database = db();

  if (decision === "permanent") {
    const kind = groupId === 0 ? "envelope" : (getGroupKind(database, groupId) ?? "envelope");
    if (!canDecidePermanent(kind, lineAmounts)) return;
  }

  const existing = getOverspendDecision(database, accountId, groupId, month);
  if (existing?.writes?.length) applyUndo(database, existing.writes);

  let writes: BudgetWrite[] | null = null;
  if (decision === "permanent") {
    const cible = nextMonthKey(month);
    if (lineAmounts?.length) {
      const datedLines = toDatedLineAmounts(listLineAmounts(database));
      writes = lineWrites(
        month,
        lineAmounts
          .filter((l) => Number.isFinite(l.amount) && l.amount > 0)
          .map((l) => ({
            lineId: l.lineId,
            amount: l.amount,
            before: amountAt(datedLines[l.lineId] ?? [], cible),
          })),
      );
      for (const w of writes) setLineAmount(database, w.id, w.month, w.amount);
    } else if (newBudget != null && Number.isFinite(newBudget) && newBudget > 0) {
      const dated = toDatedBudgets(listBudgetAmounts(database));
      const before = amountAt(dated[groupId] ?? [], cible);
      writes = envelopeWrites(groupId, month, newBudget, before);
      for (const w of writes) setBudgetAmount(database, w.id, w.month, w.amount);
    }
    writes = normalizeWrites(writes);
  }

  setOverspendDecision(database, {
    accountId, groupId, month, decision, decidedAt: new Date().toISOString(), writes,
  });
  revalidatePath("/historique");
  revalidatePath("/");
}

// Annule une décision : le dépassement redevient « à trancher ». Les montants
// posés par une décision « permanent » sont défaits — restaurés à leur valeur
// d'avant, ou supprimés s'il n'y en avait pas — sauf ceux modifiés à la main
// depuis, qu'on laisse tels quels.
export async function undoOverspendDecision(
  accountId: string, groupId: number, month: string,
): Promise<void> {
  if (!/^\d{4}-\d{2}$/.test(month)) return;
  const database = db();
  const existing = getOverspendDecision(database, accountId, groupId, month);
  if (existing?.writes?.length) applyUndo(database, existing.writes);
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
    const gid = insertEnvelopeGroup(database, accountId, trimmed, "out", amount ?? 0, null, startMonth, endMonth);
    setBudgetAmount(database, gid, startMonth, amount ?? 0);
  } else {
    insertRecurringGroup(database, accountId, trimmed, "out", null, startMonth, endMonth);
    // Un récurrent n'a pas de montant à lui : il n'y a rien à poser tant qu'il
    // n'a pas de ligne.
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
  const gid = insertEnvelopeGroup(database, accountId, name, "in", amount, incomeKind, "2000-01", null);
  setBudgetAmount(database, gid, "2000-01", amount);
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

// `month` est le mois affiché au moment de l'ajout : la ligne compte à partir de
// là, pas depuis la création du groupe.
export async function addGroupLine(
  groupId: number, name: string, amount: number, day: number, month: string,
): Promise<number> {
  const trimmed = name.trim();
  if (!trimmed || !/^\d{4}-\d{2}$/.test(month)) return -1;
  const database = db();
  const id = insertLine(database, groupId, trimmed, amount, day);
  setLineAmount(database, id, month, amount);
  await revalidate();
  return id;
}

// Modifie une ligne : le nom et le jour changent pour tous les mois (ce sont des
// propriétés de la ligne), le montant est daté selon la portée choisie.
export async function editGroupLine(
  lineId: number, name: string, day: number, month: string, amount: number, scope: "once" | "ongoing",
): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed || !/^\d{4}-\d{2}$/.test(month) || !Number.isFinite(amount) || amount < 0) return;
  const database = db();
  // updateLine écrit encore group_lines.amount : plus lu par les calculs de
  // budget, mais toujours lu par listGroups (affichage) et par la migration de
  // reprise (migrateSeedDatedAmounts) tant qu'aucune entrée datée n'existe
  // encore pour cette ligne. On lui passe donc le montant courant pour ne pas
  // laisser un champ incohérent en base.
  updateLine(database, lineId, trimmed, amount, day);
  if (scope === "once") {
    const existantes = toDatedLineAmounts(listLineAmounts(database))[lineId] ?? [];
    for (const w of onceBudgetWrites(existantes, month, amount).writes) {
      setLineAmount(database, lineId, w.effectiveMonth, w.amount);
    }
  } else {
    setLineAmount(database, lineId, month, amount);
  }
  await revalidate();
}

export async function removeGroupLine(lineId: number): Promise<void> {
  deleteLine(db(), lineId);
  await revalidate();
}
