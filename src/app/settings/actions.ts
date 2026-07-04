"use server";
import { db } from "../../db/index";
import { setSetting } from "../../db/repositories/settings";
import { revalidatePath } from "next/cache";

export async function saveThreshold(formData: FormData) {
  const value = String(formData.get("threshold"));
  setSetting(db(), "balance_threshold", value);
  revalidatePath("/settings");
  revalidatePath("/");
}
