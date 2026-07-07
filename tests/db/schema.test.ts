import { expect, test } from "vitest";
import { getDb } from "../../src/db/index";

test("schema creates all tables in an in-memory db", () => {
  const db = getDb(":memory:");
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r: any) => r.name);
  for (const t of ["accounts", "categories", "rules", "transactions", "budgets", "settings", "recurring_payments", "groups", "group_lines"]) {
    expect(tables).toContain(t);
  }
});
