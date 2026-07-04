import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SCHEMA = readFileSync(join(process.cwd(), "src/db/schema.sql"), "utf8");

export function getDb(path = join(process.cwd(), "data/budget.db")): Database.Database {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

let _db: Database.Database | null = null;
export function db(): Database.Database {
  if (!_db) _db = getDb();
  return _db;
}
