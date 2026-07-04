import type Database from "better-sqlite3";
import { ensureCategory } from "./categories";

export function listRules(db: Database.Database): { keyword: string; category: string }[] {
  return db
    .prepare(
      "SELECT r.keyword AS keyword, c.name AS category FROM rules r JOIN categories c ON c.id = r.category_id",
    )
    .all() as { keyword: string; category: string }[];
}

export function addRule(db: Database.Database, keyword: string, category: string): void {
  const categoryId = ensureCategory(db, category);
  db.prepare("INSERT INTO rules (keyword, category_id) VALUES (?, ?)").run(keyword, categoryId);
}
