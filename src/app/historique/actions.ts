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
  getGroupLifespan,
  getLineLifespan,
  setGroupLifespan,
  setLineLifespan,
} from "../../db/repositories/groups";
import { listTransactions } from "../../db/repositories/transactions";
import { toDatedBudgets, toDatedLineAmounts, isMonthKey, amountInForce, monthRange, type BudgetScope } from "../../lib/history";
import { canRemoveBudgetChange, budgetChanges, type BudgetChange } from "../../lib/budget-history";
import { groupPeriod, type PeriodMode } from "../../lib/group-period";
import { droppedMonths, countTxnsIn } from "../../lib/period-change";
import { currentMonthKey } from "../../lib/current-month";
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
// l'Historique. Toujours en dépense (« out ») et sans rémunération associée.
//
// La durée de vie arrive telle que le formulaire l'a demandée — un seul mois, une
// plage, ou un début sans fin — et c'est groupPeriod qui la traduit en bornes, ici
// et non côté écran : une plage qui finit avant de commencer ne doit pas entrer en
// base, quel que soit l'appelant.
export async function createGroup(input: {
  accountId: string;
  kind: "envelope" | "recurring";
  name: string;
  amount: number | null;
  startMonth: string;
  endMonth?: string;
  period: PeriodMode;
}): Promise<void> {
  const { accountId, kind, name, amount, period } = input;
  const bornes = groupPeriod(period, input.startMonth, input.endMonth);
  if (!bornes) return;
  const { startMonth, endMonth } = bornes;
  const trimmed = name.trim();
  if (!trimmed) return;
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

// --- Changer la durée de vie après coup -------------------------------------
// Un groupe créé « permanent » finit un jour : un abonnement se résilie, un crédit
// se solde. Sans ces actions, le seul moyen de l'arrêter était de le supprimer — ce
// qui efface aussi tout son passé. Déplacer une borne n'efface rien : les montants
// datés restent en base, et remettre la borne où elle était fait revenir les mois
// avec le budget qu'ils avaient.
//
// La règle des bornes est la même qu'à la création, à une nuance près : ici les deux
// bornes peuvent être égales (« un seul mois »), alors que le formulaire de création
// réserve ce cas à son propre choix et exige une fin strictement postérieure quand on
// demande une plage (cf. groupPeriod / minEndMonth).
function bornesValides(startMonth: string, endMonth: string | null): boolean {
  if (!isMonthKey(startMonth)) return false;
  if (endMonth === null) return true;
  return isMonthKey(endMonth) && endMonth >= startMonth;
}

// Les mois qu'on regarde pour juger un changement : du plus ancien mois connu du
// groupe (sa borne actuelle, ses transactions) jusqu'au mois courant.
//
// Les mois à venir en sont exclus volontairement : rien ne s'y est encore passé, les
// retirer n'enlève aucun chiffre déjà lu. Le passé, lui, s'arrête à `horizon`, le
// premier mois que la frise atteint — les groupes hérités sont ancrés en 2000-01 par
// la migration, et annoncer trois cents mois perdus que l'app n'affiche nulle part
// serait faux au sens qui compte : celui de ce qu'on peut voir changer.
function moisRegardes(
  depuis: (string | null | undefined)[],
  currentMonth: string,
  horizon: string | undefined,
): string[] {
  const connus = depuis.filter((m): m is string => isMonthKey(m));
  if (connus.length === 0) return [];
  const plusAncien = connus.reduce((a, b) => (a < b ? a : b));
  const debut = horizon && horizon > plusAncien ? horizon : plusAncien;
  return debut > currentMonth ? [] : monthRange(debut, currentMonth);
}

// Ce qu'un changement de bornes coûterait, calculé sur ce qui est réellement en base
// et rendu à l'écran AVANT d'écrire : les mois qui sortent de la vie du groupe en y
// ayant quelque chose (un budget ou des transactions), et le nombre de transactions
// qui repasseront en non catégorisés — elles restent rattachées, mais aucun calcul ne
// les compte plus sous un groupe qui ne vit pas leur mois.
export type PeriodImpact = { months: string[]; txns: number };

function impact(
  before: { startMonth: string | null; endMonth: string | null },
  after: { startMonth: string; endMonth: string | null },
  txnMonths: string[],
  budgetAt: (month: string) => number,
  horizon: string | undefined,
): PeriodImpact {
  const regardes = moisRegardes(
    [before.startMonth, after.startMonth, ...txnMonths],
    currentMonthKey(new Date()),
    horizon,
  );
  const perdus = droppedMonths(before, after, regardes);
  // Un mois perdu où il n'y avait ni budget ni dépense ne change rien à l'écran :
  // l'annoncer ferait du bruit là où il n'y a pas de perte.
  const avecQuelqueChose = perdus.filter((m) => budgetAt(m) > 0.005 || txnMonths.includes(m));
  return { months: avecQuelqueChose, txns: countTxnsIn(avecQuelqueChose, txnMonths) };
}

// Les mois des transactions : celles rattachées à la cible (un élément par
// transaction — c'est un décompte, pas un ensemble), et le premier mois de toutes,
// qui borne le passé regardé.
function moisDesTxns(cible: { groupId: number } | { lineId: number }): { mine: string[]; horizon: string | undefined } {
  const toutes = listTransactions(db());
  const mois = (t: (typeof toutes)[number]) => t.date.slice(0, 7);
  return {
    mine: toutes.filter((t) => ("lineId" in cible ? t.lineId === cible.lineId : t.groupId === cible.groupId)).map(mois),
    horizon: toutes.map(mois).sort()[0],
  };
}

export async function groupPeriodImpact(
  groupId: number, startMonth: string, endMonth: string | null,
): Promise<PeriodImpact> {
  const database = db();
  const before = getGroupLifespan(database, groupId);
  if (!before || !bornesValides(startMonth, endMonth)) return { months: [], txns: 0 };
  const entries = toDatedBudgets(listBudgetAmounts(database))[groupId] ?? [];
  const { mine, horizon } = moisDesTxns({ groupId });
  return impact(before, { startMonth, endMonth }, mine, (m) => amountInForce(entries, m), horizon);
}

export async function linePeriodImpact(
  lineId: number, startMonth: string, endMonth: string | null,
): Promise<PeriodImpact> {
  const database = db();
  const before = getLineLifespan(database, lineId);
  if (!before || !bornesValides(startMonth, endMonth)) return { months: [], txns: 0 };
  const entries = toDatedLineAmounts(listLineAmounts(database))[lineId] ?? [];
  const { mine, horizon } = moisDesTxns({ lineId });
  return impact(before, { startMonth, endMonth }, mine, (m) => amountInForce(entries, m), horizon);
}

// Écrit les nouvelles bornes. `amountForAdded` (optionnel) est le montant à poser au
// nouveau mois de départ quand on rallonge vers le passé : ces mois-là n'ont jamais eu
// de montant à eux et s'afficheraient à zéro. Posé en portée « ongoing » à ce mois, il
// remplit le trou sans toucher aux montants postérieurs, qui gardent le leur.
export async function setGroupPeriod(
  groupId: number, startMonth: string, endMonth: string | null, amountForAdded?: number,
): Promise<void> {
  if (!bornesValides(startMonth, endMonth)) return;
  const database = db();
  setGroupLifespan(database, groupId, startMonth, endMonth);
  if (amountForAdded != null && Number.isFinite(amountForAdded) && amountForAdded >= 0) {
    setBudgetAmount(database, groupId, startMonth, amountForAdded);
  }
  await revalidate();
}

export async function setLinePeriod(
  lineId: number, startMonth: string, endMonth: string | null, amountForAdded?: number,
): Promise<void> {
  if (!bornesValides(startMonth, endMonth)) return;
  const database = db();
  setLineLifespan(database, lineId, startMonth, endMonth);
  if (amountForAdded != null && Number.isFinite(amountForAdded) && amountForAdded >= 0) {
    setLineAmount(database, lineId, startMonth, amountForAdded);
  }
  await revalidate();
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
// là, pas depuis la création du groupe. C'est donc lui le mois de DÉPART de sa durée
// de vie, et le mois où son montant prend effet.
//
// La durée arrive telle que le formulaire l'a demandée — permanente, ce mois
// seulement, ou jusqu'à un mois donné — et c'est groupPeriod qui la traduit en bornes,
// comme pour un groupe : une plage qui ne dépasse pas son mois de départ ne doit pas
// entrer en base, quel que soit l'appelant. Rend -1 dans ce cas, comme pour un nom
// vide : rien n'a été créé, l'écran ne doit pas ajouter de ligne optimiste.
export async function addGroupLine(
  groupId: number, name: string, amount: number, day: number, month: string,
  period: PeriodMode = "from", endMonth?: string,
): Promise<number> {
  const trimmed = name.trim();
  if (!trimmed || !isMonthKey(month)) return -1;
  const bornes = groupPeriod(period, month, endMonth);
  if (!bornes) return -1;
  const database = db();
  const id = insertLine(database, groupId, trimmed, amount, day, bornes.startMonth, bornes.endMonth);
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
