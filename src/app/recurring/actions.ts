"use server";
import { db } from "../../db/index";
import { insertRecurring, deleteRecurring } from "../../db/repositories/recurring";
import { revalidatePath } from "next/cache";

export async function addRecurring(formData: FormData) {
  const name = String(formData.get("name")).trim();
  const keyword = String(formData.get("keyword")).trim();
  const expected = Number.parseFloat(String(formData.get("expected")));
  if (!name || !keyword) return;
  insertRecurring(db(), name, keyword, Number.isFinite(expected) ? expected : 0);
  revalidatePath("/recurring");
  revalidatePath("/");
}

export async function removeRecurring(formData: FormData) {
  const id = Number.parseInt(String(formData.get("id")), 10);
  if (Number.isFinite(id)) deleteRecurring(db(), id);
  revalidatePath("/recurring");
  revalidatePath("/");
}
