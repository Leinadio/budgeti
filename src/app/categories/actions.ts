"use server";
import { db } from "../../db/index";
import { ensureCategory } from "../../db/repositories/categories";
import { addRule } from "../../db/repositories/rules";
import { revalidatePath } from "next/cache";

export async function addCategory(formData: FormData) {
  const name = String(formData.get("name")).trim();
  if (name) ensureCategory(db(), name);
  revalidatePath("/categories");
}

export async function createRule(formData: FormData) {
  const keyword = String(formData.get("keyword")).trim();
  const category = String(formData.get("category")).trim();
  if (keyword && category) addRule(db(), keyword.toUpperCase(), category);
  revalidatePath("/categories");
}
