import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { seed } from "./seed";
import { migrateBudgets } from "./migrations";

const SCHEMA = readFileSync(join(process.cwd(), "src/db/schema.sql"), "utf8");

export function getDb(path = join(process.cwd(), "data/budget.db")): Database.Database {
  // better-sqlite3 does not create the parent directory; on a fresh checkout
  // the git-ignored data/ folder doesn't exist yet. ":memory:" has no directory.
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  migrateBudgets(db);
  return db;
}

let _db: Database.Database | null = null;
export function db(): Database.Database {
  if (!_db) {
    _db = getDb();
    seed(_db);
  }
  return _db;
}
