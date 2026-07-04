import type Database from "better-sqlite3";

export function ensureCategory(db: Database.Database, name: string): number {
  db.prepare("INSERT OR IGNORE INTO categories (name) VALUES (?)").run(name);
  const row = db.prepare("SELECT id FROM categories WHERE name = ?").get(name) as { id: number };
  return row.id;
}

export function listCategories(db: Database.Database): { id: number; name: string }[] {
  return db.prepare("SELECT id, name FROM categories ORDER BY name").all() as { id: number; name: string }[];
}
