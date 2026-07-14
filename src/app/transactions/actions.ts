"use server";
import { db } from "../../db/index";
import { setTransactionGroup } from "../../db/repositories/transactions";
import { revalidatePath } from "next/cache";

export async function setGroup(
  txnId: string,
  groupId: number | null,
  lineId: number | null = null,
) {
  const gid = groupId !== null && Number.isFinite(groupId) ? groupId : null;
  const lid = lineId !== null && Number.isFinite(lineId) ? lineId : null;
  setTransactionGroup(db(), txnId, gid, false, lid);
  revalidatePath("/transactions");
  revalidatePath("/previsionnel");
  revalidatePath("/historique");
  revalidatePath("/");
}
