import { expect, test } from "vitest";
import { getDb } from "../../src/db/index";
import { seed } from "../../src/db/seed";
import { listCategories } from "../../src/db/repositories/categories";
import { listRules } from "../../src/db/repositories/rules";

test("seed inserts defaults once", () => {
  const db = getDb(":memory:");
  seed(db);
  seed(db); // idempotent
  expect(listCategories(db).length).toBeGreaterThan(0);
  expect(listRules(db).length).toBeGreaterThan(0);
  const carrefour = listRules(db).find((r) => r.keyword === "CARREFOUR");
  expect(carrefour?.category).toBe("Courses");
});
