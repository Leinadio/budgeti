"use server";
import { db } from "../../db/index";
import { setBudgetAmount, deleteBudgetAmount, deleteBudgetAmountsAfter, listBudgetAmounts } from "../../db/repositories/budget-amounts";
import { listLineAmounts, setLineAmount, deleteLineAmount, deleteLineAmountsAfter } from "../../db/repositories/line-amounts";
import {
  insertEnvelopeGroup,
  insertRecurringGroup,
  renameGroup,
  deleteGroup,
  insertLine,
  renameLine,
  deleteLine,
  hasIncomeGroup,
} from "../../db/repositories/groups";
import { toDatedBudgets, toDatedLineAmounts, isMonthKey, type BudgetScope } from "../../lib/history";
import { canRemoveBudgetChange, budgetChanges, type BudgetChange } from "../../lib/budget-history";
import { revalidatePath } from "next/cache";

// --- Ce que ces actions vérifient avant d'écrire ---------------------------
// Le mois se valide sur sa FORME et rien d'autre (isMonthKey, une clé « YYYY-MM ») :
// le calendrier n'entre pas dans la question. Un mois écoulé s'écrit comme le mois
// courant — c'est tout le sens de pouvoir corriger un budget après coup, une fois le
// relevé sous les yeux. Ce qui reste refusé l'est pour la cohérence des données et
// jamais pour l'ancienneté : un mois mal formé se comparerait n'importe comment aux
// autres en base, et canRemoveBudgetChange protège toujours le montant de départ
// d'une frise, dont rien ne prendrait le relais pour les mois d'avant.
//
// Ces vérifications sont tenues ICI, côté serveur, et pas seulement à l'écran :
// masquer un champ n'empêche pas d'appeler l'action directement.

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
// Rend la vie du budget à jour du groupe : le panneau « Gérer le groupe » garde son
// propre état, figé au clic (detail-sidebar.tsx), que router.refresh() ne remplace
// pas (voir GroupManageBlock côté client) — le rendu lui sert à se resynchroniser
// sans recalculer les écritures une seconde fois, avec le risque de diverger.
export async function setGroupAmount(
  groupId: number,
  month: string,
  amount: number,
  scope: "once" | "ongoing",
): Promise<BudgetChange[]> {
  const database = db();
  if (isMonthKey(month) && Number.isFinite(amount) && amount >= 0) {
    setBudgetAmount(database, groupId, month, amount, scope);
    await revalidate();
  }
  return budgetChanges(toDatedBudgets(listBudgetAmounts(database))[groupId] ?? []);
}

// Propage aux mois suivants un montant d'abord posé pour un seul mois. C'est la
// réponse « oui » à la question qui suit toute modification de budget : « les mois
// suivants doivent-ils prendre ce montant ? ».
//
// Le montant devient durable à partir de ce mois, et TOUT ce qui était posé plus tard
// est supprimé — l'exception de ce mois-ci comprise, devenue redondante. C'est
// destructeur, et c'est le sens de la question : « tous les mois suivants au même
// montant » ne souffre pas d'exception. Laisser vivre un changement postérieur ferait
// répondre l'app autre chose que ce que l'utilisateur a demandé.
//
// Pourquoi une action à part plutôt que deux appels depuis l'écran : les deux écritures
// doivent tomber ensemble. Entre elles, le budget du mois serait porté deux fois, et un
// rendu qui s'intercalerait montrerait un état que personne n'a demandé.
export async function spreadGroupAmount(groupId: number, month: string, amount: number): Promise<BudgetChange[]> {
  const database = db();
  if (isMonthKey(month) && Number.isFinite(amount) && amount >= 0) {
    deleteBudgetAmountsAfter(database, groupId, month);
    deleteBudgetAmount(database, groupId, month, "once");
    setBudgetAmount(database, groupId, month, amount, "ongoing");
    await revalidate();
  }
  return budgetChanges(toDatedBudgets(listBudgetAmounts(database))[groupId] ?? []);
}

// Même chose pour la provision des non catégorisés (groupe 0), gardée à part comme
// setUncatProvision l'est de setGroupAmount.
export async function spreadUncatProvision(month: string, amount: number): Promise<void> {
  if (!isMonthKey(month) || !Number.isFinite(amount) || amount < 0) return;
  const database = db();
  deleteBudgetAmountsAfter(database, 0, month);
  deleteBudgetAmount(database, 0, month, "once");
  setBudgetAmount(database, 0, month, amount, "ongoing");
  revalidatePath("/historique");
  revalidatePath("/");
}

// Même chose pour le montant d'une ligne de récurrent.
export async function spreadGroupLineAmount(lineId: number, month: string, amount: number): Promise<BudgetChange[]> {
  const database = db();
  if (isMonthKey(month) && Number.isFinite(amount) && amount >= 0) {
    deleteLineAmountsAfter(database, lineId, month);
    deleteLineAmount(database, lineId, month, "once");
    setLineAmount(database, lineId, month, amount, "ongoing");
    await revalidate();
  }
  return budgetChanges(toDatedLineAmounts(listLineAmounts(database))[lineId] ?? []);
}

// Retire un changement de budget daté (jamais le montant de départ : le panneau
// ne propose la corbeille que sur les autres). La protection est revérifiée ici,
// côté serveur, sur les entrées réellement en base : le panneau ne masque la
// corbeille sur le montant de départ qu'à l'affichage, ça ne suffit pas à
// empêcher un appel direct de cette action avec ce mois-là. Rend la vie du budget
// à jour dans tous les cas, y compris un refus silencieux (mois invalide ou
// suppression refusée) : le panneau ne doit jamais rester sur une vue périmée.
export async function removeGroupAmount(
  groupId: number, month: string, scope: BudgetScope = "ongoing",
): Promise<BudgetChange[]> {
  const database = db();
  const entries = toDatedBudgets(listBudgetAmounts(database))[groupId] ?? [];
  if (isMonthKey(month) && canRemoveBudgetChange(entries, month, scope)) {
    deleteBudgetAmount(database, groupId, month, scope);
    await revalidate();
    return budgetChanges(toDatedBudgets(listBudgetAmounts(database))[groupId] ?? []);
  }
  return budgetChanges(entries);
}

// Fixe la provision des non catégorisés (budget daté du groupe 0, une case
// virtuelle sans ligne dans `groups`) pour un mois, avec la même sémantique
// once/ongoing que setGroupAmount, gardée comme une action à part pour ce motif.
export async function setUncatProvision(
  month: string,
  amount: number,
  scope: "once" | "ongoing",
): Promise<void> {
  if (!isMonthKey(month) || !Number.isFinite(amount) || amount < 0) return;
  const database = db();
  setBudgetAmount(database, 0, month, amount, scope);
  revalidatePath("/historique");
  revalidatePath("/");
}

// `month` est le mois affiché au moment de l'ajout : la ligne compte à partir de
// là, pas depuis la création du groupe.
export async function addGroupLine(
  groupId: number, name: string, amount: number, day: number, month: string,
): Promise<number> {
  const trimmed = name.trim();
  if (!trimmed || !isMonthKey(month)) return -1;
  const database = db();
  const id = insertLine(database, groupId, trimmed, amount, day);
  setLineAmount(database, id, month, amount);
  await revalidate();
  return id;
}

// Modifie le nom et le jour d'une ligne : ses deux seules propriétés qui valent pour
// tous les mois, et donc les seules qu'on puisse changer depuis un panneau qui
// n'affiche aucun mois. Le montant, lui, est daté : il se fixe depuis la case
// « Budget dép. » de la ligne (setGroupLineAmount), au mois de sa colonne. Aucun mois
// n'entre ici, donc rien à valider côté calendrier.
export async function editGroupLine(lineId: number, name: string, day: number): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  renameLine(db(), lineId, trimmed, day);
  await revalidate();
}

// Fixe le seul montant daté d'une ligne de récurrent, pour un mois. Appelée par le
// bloc d'édition ouvert depuis la case « Budget dép. » de la ligne : cette case ne
// connaît ni son nom ni son jour, qui valent pour tous les mois et se modifient
// depuis « Gérer le groupe » (editGroupLine). Même sémantique once/ongoing que
// setGroupAmount, et même vie du montant rendue pour que le panneau se resynchronise
// sur ce que le serveur vient réellement de poser.
export async function setGroupLineAmount(
  lineId: number, month: string, amount: number, scope: "once" | "ongoing",
): Promise<BudgetChange[]> {
  const database = db();
  if (isMonthKey(month) && Number.isFinite(amount) && amount >= 0) {
    setLineAmount(database, lineId, month, amount, scope);
    await revalidate();
  }
  return budgetChanges(toDatedLineAmounts(listLineAmounts(database))[lineId] ?? []);
}

export async function removeGroupLine(lineId: number): Promise<void> {
  deleteLine(db(), lineId);
  await revalidate();
}

// Retire un changement de montant daté d'une ligne de récurrent (jamais le
// montant de départ). Même garde-fou que removeGroupAmount, et pour la même
// raison : une ligne sans entrée datée vaudrait 0, pas « pas de budget ». La
// protection est revérifiée ici, côté serveur, sur les entrées réellement en
// base — voir removeGroupAmount pour le détail du raisonnement, y compris pour
// la vie du budget rendue même en cas de refus.
export async function removeLineAmount(
  lineId: number, month: string, scope: BudgetScope = "ongoing",
): Promise<BudgetChange[]> {
  const database = db();
  const entries = toDatedLineAmounts(listLineAmounts(database))[lineId] ?? [];
  if (isMonthKey(month) && canRemoveBudgetChange(entries, month, scope)) {
    deleteLineAmount(database, lineId, month, scope);
    await revalidate();
    return budgetChanges(toDatedLineAmounts(listLineAmounts(database))[lineId] ?? []);
  }
  return budgetChanges(entries);
}
