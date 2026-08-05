"use server";
import { db } from "../../db/index";
import {
  setTransactionGroup,
  setTransactionIgnored,
  setTransactionComment,
  insertManualTransaction,
  updateManualTransaction,
  deleteManualTransaction,
  mergeTransactions,
  ignoreMatch as ignoreMatchRepo,
} from "../../db/repositories/transactions";
import { isValidManualForm, toManualInput, type ManualFormInput } from "@/lib/manual-txn";
import { normalizeComment } from "@/lib/txn-comment";
import { canAttachToGroup } from "@/lib/ownership";
import { getGroupKind, getLineGroupId } from "../../db/repositories/groups";
import { revalidatePath } from "next/cache";

function revalidateAll() {
  revalidatePath("/transactions");
  revalidatePath("/historique");
  revalidatePath("/");
}

// Rattache une transaction (groupId null = non catégorisée). Un récurrent n'est pas
// une destination : ses dépenses appartiennent à une de ses lignes, jamais au groupe
// lui-même (canAttachToGroup). Le sélecteur ne le propose plus, mais masquer une option
// n'empêche pas d'appeler cette action directement — la règle est donc tenue ici, comme
// le verrou des mois passés l'est dans les actions de budget.
//
// Un rattachement refusé ne défait rien : la transaction garde ce qu'elle avait, plutôt
// que de se retrouver nulle part par accident.
export async function setGroup(
  txnId: string,
  groupId: number | null,
  lineId: number | null = null,
) {
  const gid = groupId !== null && Number.isFinite(groupId) ? groupId : null;
  const lid = lineId !== null && Number.isFinite(lineId) ? lineId : null;
  const database = db();
  if (gid !== null) {
    const kind = getGroupKind(database, gid);
    if (kind === null || !canAttachToGroup(kind, lid)) return;
    // Une ligne d'un AUTRE groupe écrirait un couple (groupe, ligne) incohérent, que
    // plus aucun calcul ne relit correctement.
    if (lid !== null && getLineGroupId(database, lid) !== gid) return;
  }
  setTransactionGroup(database, txnId, gid, false, lid);
  revalidateAll();
}

// Pose un commentaire sous le libellé d'une transaction. Champ vidé = commentaire
// retiré : normalizeComment en fait un null, pour que la base dise « aucun
// commentaire » plutôt qu'un commentaire vide.
export async function setComment(txnId: string, comment: string) {
  setTransactionComment(db(), txnId, normalizeComment(comment));
  revalidateAll();
}

// Retire (ou remet) une transaction de tous les calculs.
export async function setIgnored(txnId: string, ignored: boolean) {
  setTransactionIgnored(db(), txnId, ignored);
  revalidateAll();
}

export async function addTransaction(form: ManualFormInput) {
  if (!isValidManualForm(form)) return;
  insertManualTransaction(db(), toManualInput(form));
  revalidateAll();
}

export async function editTransaction(id: string, form: ManualFormInput) {
  if (!isValidManualForm(form)) return;
  const { accountId: _accountId, ...rest } = toManualInput(form);
  updateManualTransaction(db(), id, rest);
  revalidateAll();
}

export async function removeTransaction(id: string) {
  deleteManualTransaction(db(), id);
  revalidateAll();
}

export async function mergeTransaction(syncedId: string, manualId: string) {
  mergeTransactions(db(), { syncedId, manualId });
  revalidateAll();
}

export async function ignoreMatch(manualId: string, syncedId: string) {
  ignoreMatchRepo(db(), manualId, syncedId);
  revalidateAll();
}
