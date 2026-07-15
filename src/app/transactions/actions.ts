"use server";
import { db } from "../../db/index";
import {
  setTransactionGroup,
  insertManualTransaction,
  updateManualTransaction,
  deleteManualTransaction,
  mergeTransactions,
  ignoreMatch as ignoreMatchRepo,
} from "../../db/repositories/transactions";
import { isValidManualForm, toManualInput, type ManualFormInput } from "@/lib/manual-txn";
import { revalidatePath } from "next/cache";

function revalidateAll() {
  revalidatePath("/transactions");
  revalidatePath("/previsionnel");
  revalidatePath("/historique");
  revalidatePath("/");
}

export async function setGroup(
  txnId: string,
  groupId: number | null,
  lineId: number | null = null,
) {
  const gid = groupId !== null && Number.isFinite(groupId) ? groupId : null;
  const lid = lineId !== null && Number.isFinite(lineId) ? lineId : null;
  setTransactionGroup(db(), txnId, gid, false, lid);
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
