"use server";
import { db } from "../../db/index";
import { setTransactionGroup } from "../../db/repositories/transactions";
import { revalidatePath } from "next/cache";

export async function setGroup(txnId: string, groupId: number | null, excluded = false) {
  setTransactionGroup(db(), txnId, groupId !== null && Number.isFinite(groupId) ? groupId : null, excluded);
  revalidatePath("/transactions");
  revalidatePath("/previsionnel");
  revalidatePath("/");
}
