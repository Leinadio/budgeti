import type Database from "better-sqlite3";
import { DEFAULT_CATEGORIES, DEFAULT_RULES } from "../lib/default-rules";
import { ensureCategory, listCategories } from "./repositories/categories";
import { addRule } from "./repositories/rules";

export function seed(db: Database.Database): void {
  if (listCategories(db).length > 0) return;
  for (const name of DEFAULT_CATEGORIES) ensureCategory(db, name);
  for (const rule of DEFAULT_RULES) addRule(db, rule.keyword, rule.category);
}
