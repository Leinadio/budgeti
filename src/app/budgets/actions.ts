"use server";
import { db } from "../../db/index";
import { setBudget, deleteBudget } from "../../db/repositories/budgets";
import { revalidatePath } from "next/cache";

export async function saveBudget(formData: FormData) {
  const category = String(formData.get("category")).trim();
  const limit = Number.parseFloat(String(formData.get("limit")));
  if (!category) return;
  setBudget(db(), category, Number.isFinite(limit) ? limit : 0);
  revalidatePath("/budgets");
  revalidatePath("/");
}

export async function removeBudget(formData: FormData) {
  const category = String(formData.get("category"));
  deleteBudget(db(), category);
  revalidatePath("/budgets");
  revalidatePath("/");
}
