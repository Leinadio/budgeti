"use server";
import { db } from "../../db/index";
import { setBudget } from "../../db/repositories/budgets";
import { monthKey } from "../../lib/money";
import { revalidatePath } from "next/cache";

export async function saveBudget(formData: FormData) {
  const category = String(formData.get("category"));
  const limit = Number.parseFloat(String(formData.get("limit")));
  const month = monthKey(new Date().toISOString().slice(0, 10));
  setBudget(db(), category, month, Number.isFinite(limit) ? limit : 0);
  revalidatePath("/budgets");
  revalidatePath("/");
}
