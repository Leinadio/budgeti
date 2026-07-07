"use server";
import { db } from "../../db/index";
import { setSetting } from "../../db/repositories/settings";
import { setAccountAlias } from "../../db/repositories/accounts";
import { revalidatePath } from "next/cache";

export async function saveThreshold(formData: FormData) {
  const value = String(formData.get("threshold"));
  setSetting(db(), "balance_threshold", value);
  revalidatePath("/settings");
  revalidatePath("/");
}

export async function renameAccount(formData: FormData) {
  const id = String(formData.get("id") ?? "").trim();
  const aliasRaw = String(formData.get("alias") ?? "").trim();
  if (!id) return;
  setAccountAlias(db(), id, aliasRaw === "" ? null : aliasRaw);
  revalidatePath("/settings");
  revalidatePath("/");
  revalidatePath("/previsionnel");
  revalidatePath("/groupes");
  revalidatePath("/transactions");
}
