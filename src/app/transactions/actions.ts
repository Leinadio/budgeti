"use server";
import { db } from "../../db/index";
import { setTransactionCategory } from "../../db/repositories/transactions";
import { ensureCategory } from "../../db/repositories/categories";
import { addRule } from "../../db/repositories/rules";
import { revalidatePath } from "next/cache";

export async function recategorize(formData: FormData) {
  const txnId = String(formData.get("txnId"));
  const category = String(formData.get("category"));
  const label = String(formData.get("label") ?? "");
  const createRule = formData.get("createRule") === "on";
  const database = db();
  setTransactionCategory(database, txnId, ensureCategory(database, category));
  if (createRule && label) {
    const keyword = label.split(" ")[0]?.toUpperCase();
    if (keyword) addRule(database, keyword, category);
  }
  revalidatePath("/transactions");
}
