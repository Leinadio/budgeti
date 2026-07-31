"use server";
import type Database from "better-sqlite3";
import { db } from "../../db/index";
import { setOverspendDecision, deleteOverspendDecision, getOverspendDecision } from "../../db/repositories/overspend-decisions";
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
  getGroupKind,
} from "../../db/repositories/groups";
import { toDatedBudgets, toDatedLineAmounts, nextMonthKey, type BudgetScope } from "../../lib/history";
import { canRemoveBudgetChange, budgetChanges, type BudgetChange } from "../../lib/budget-history";
import { isMonthClosed, currentMonthKey } from "../../lib/month-lock";
import { envelopeWrites, undoWrites, amountAt, normalizeWrites, type BudgetWrite } from "../../lib/overspend-writes";
import { revalidatePath } from "next/cache";

// Mois où l'on peut encore toucher à un budget : bien formé, et pas clos. Un mois
// écoulé est un fait, plus rien n'y entre ni n'en sort (voir src/lib/month-lock.ts).
// Le verrou est tenu ICI, côté serveur, et pas seulement à l'écran : masquer un
// bouton n'empêche pas d'appeler l'action directement — même raisonnement que
// canRemoveBudgetChange, qui protège déjà le montant de départ des deux côtés.
//
// Vérifier le seul mois demandé suffit, y compris en portée « ce mois seulement » :
// la seconde écriture que celle-ci pose tombe au mois SUIVANT, donc plus tard — il
// ne peut pas être clos si celui-ci ne l'est pas.
function monthWritable(month: string): boolean {
  return /^\d{4}-\d{2}$/.test(month) && !isMonthClosed(month, currentMonthKey(new Date()));
}

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

// Enregistre la décision de l'utilisateur sur un dépassement. La case tranchée est
// ce qui PORTE un budget : une enveloppe (groupId, lineId null), les non catégorisés
// (groupId 0), ou UNE LIGNE de récurrent (lineId). Un récurrent n'a pas de budget à
// lui — son budget est la somme de ses lignes — donc son groupe ne se tranche jamais :
// il n'y aurait rien où écrire.
//
// « Permanent » relève le budget au mois qui SUIT celui du dépassement : le mois du
// dépassement garde son budget réel, c'est un fait passé. Re-trancher une case déjà
// décidée défait d'abord les écritures de la décision existante (applyUndo) avant d'en
// poser de nouvelles : sans ça, le montant d'avant capturé par la nouvelle décision
// serait celui posé par l'ancienne, pas la vraie valeur d'origine — orpheline, sans
// recours, une fois la nouvelle décision annulée.
//
// Rend true si la décision a bien été enregistrée, false si elle a été refusée : le
// side panel s'en sert pour ne jamais annoncer une décision qui n'a pas eu lieu.
export async function decideOverspend(
  accountId: string,
  groupId: number,
  lineId: number | null,
  month: string,
  decision: "exceptional" | "permanent",
  newBudget?: number,
): Promise<boolean> {
  // Un dépassement ne se tranche que dans son mois. Après, il compte comme
  // exceptionnel d'office (computeOverspends ne le propose même plus) : « permanent »
  // poserait un montant au mois suivant, en pleine époque close, et « exceptionnel »
  // n'apprendrait rien tout en laissant une trace en base sur un mois présenté comme
  // figé. Le refus vaut donc pour les deux décisions.
  if (!monthWritable(month)) return false;
  const database = db();

  // Le groupe d'un récurrent ne porte aucun montant : le trancher ferait taire une
  // alerte sans rien relever. Ce sont ses lignes qui se tranchent.
  if (lineId === null && groupId !== 0 && getGroupKind(database, groupId) === "recurring") return false;
  // Une décision « permanent » qui ne relève rien laisserait le dépassement revenir
  // à l'identique le mois suivant, l'alerte en moins : autant ne pas la prendre.
  if (decision === "permanent" && !(newBudget != null && Number.isFinite(newBudget) && newBudget > 0)) return false;

  const existing = getOverspendDecision(database, accountId, groupId, lineId, month);
  if (existing?.writes?.length) applyUndo(database, existing.writes);

  let writes: BudgetWrite[] | null = null;
  if (decision === "permanent") {
    // Mois d'effet, déterminé une seule fois ici : envelopeWrites le reçoit tel quel,
    // sans le recalculer (cf. overspend-writes.ts). C'est aussi ce même `cible` qui
    // sert à capturer `before` — les deux visent donc toujours le même mois.
    const cible = nextMonthKey(month);
    if (lineId !== null) {
      const datedLines = toDatedLineAmounts(listLineAmounts(database));
      const before = amountAt(datedLines[lineId] ?? [], cible);
      writes = [{ target: "line", id: lineId, month: cible, amount: newBudget!, before }];
      setLineAmount(database, lineId, cible, newBudget!);
    } else {
      const dated = toDatedBudgets(listBudgetAmounts(database));
      const before = amountAt(dated[groupId] ?? [], cible);
      writes = envelopeWrites(groupId, cible, newBudget!, before);
      for (const w of writes) setBudgetAmount(database, w.id, w.month, w.amount);
    }
    writes = normalizeWrites(writes);
  }

  setOverspendDecision(database, {
    accountId, groupId, lineId, month, decision, decidedAt: new Date().toISOString(), writes,
  });
  revalidatePath("/historique");
  revalidatePath("/");
  return true;
}

// Annule une décision : le dépassement redevient « à trancher ». Les montants
// posés par une décision « permanent » sont défaits — restaurés à leur valeur
// d'avant, ou supprimés s'il n'y en avait pas — sauf ceux modifiés à la main
// depuis, qu'on laisse tels quels.
// Refusée sur un mois clos : défaire des écritures, c'est retirer un montant du
// passé. Une décision prise en son temps reste donc telle quelle, et le panneau
// n'en propose plus l'annulation (voir aussi decideOverspend).
export async function undoOverspendDecision(
  accountId: string, groupId: number, lineId: number | null, month: string,
): Promise<void> {
  if (!monthWritable(month)) return;
  const database = db();
  const existing = getOverspendDecision(database, accountId, groupId, lineId, month);
  if (existing?.writes?.length) applyUndo(database, existing.writes);
  deleteOverspendDecision(database, accountId, groupId, lineId, month);
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
  if (monthWritable(month) && Number.isFinite(amount) && amount >= 0) {
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
  if (monthWritable(month) && Number.isFinite(amount) && amount >= 0) {
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
  if (!monthWritable(month) || !Number.isFinite(amount) || amount < 0) return;
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
  if (monthWritable(month) && Number.isFinite(amount) && amount >= 0) {
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
  if (monthWritable(month) && canRemoveBudgetChange(entries, month, scope)) {
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
  if (!monthWritable(month) || !Number.isFinite(amount) || amount < 0) return;
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
  if (!trimmed || !monthWritable(month)) return -1;
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
// n'entre ici, donc rien à verrouiller : renommer une ligne ne réécrit pas le passé,
// ça corrige un libellé.
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
  if (monthWritable(month) && Number.isFinite(amount) && amount >= 0) {
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
  if (monthWritable(month) && canRemoveBudgetChange(entries, month, scope)) {
    deleteLineAmount(database, lineId, month, scope);
    await revalidate();
    return budgetChanges(toDatedLineAmounts(listLineAmounts(database))[lineId] ?? []);
  }
  return budgetChanges(entries);
}
