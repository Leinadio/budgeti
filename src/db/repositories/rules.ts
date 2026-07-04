import type Database from "better-sqlite3";
import { ensureCategory } from "./categories";

export function listRules(db: Database.Database): { keyword: string; category: string }[] {
  return db
    .prepare(
      // ORDER BY r.id makes rule precedence explicit: categorize() returns the
      // first match, so insertion order must win (e.g. "UBER EATS" before "UBER").
      "SELECT r.keyword AS keyword, c.name AS category FROM rules r JOIN categories c ON c.id = r.category_id ORDER BY r.id",
    )
    .all() as { keyword: string; category: string }[];
}

export function addRule(db: Database.Database, keyword: string, category: string): void {
  const categoryId = ensureCategory(db, category);
  db.prepare("INSERT INTO rules (keyword, category_id) VALUES (?, ?)").run(keyword, categoryId);
}
