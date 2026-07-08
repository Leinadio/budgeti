"use server";
import { db } from "../../db/index";
import { setTransactionGroup } from "../../db/repositories/transactions";
import { revalidatePath } from "next/cache";

export async function setGroup(formData: FormData) {
  const txnId = String(formData.get("txnId"));
  const raw = String(formData.get("group") ?? "");
  const groupId = raw === "" ? null : Number.parseInt(raw, 10);
  setTransactionGroup(db(), txnId, groupId !== null && Number.isFinite(groupId) ? groupId : null);
  revalidatePath("/transactions");
  revalidatePath("/previsionnel");
  revalidatePath("/");
}
