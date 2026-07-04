import { expect, test } from "vitest";
import { categorize, type Rule } from "../../src/lib/categorize";
import { DEFAULT_RULES } from "../../src/lib/default-rules";

const rules: Rule[] = [
  { keyword: "CARREFOUR", category: "Courses" },
  { keyword: "SNCF", category: "Transport" },
];

test("matches keyword case-insensitively", () => {
  expect(categorize("CB carrefour market 03/07", rules)).toBe("Courses");
  expect(categorize("PRLV SNCF CONNECT", rules)).toBe("Transport");
});

test("returns null when nothing matches", () => {
  expect(categorize("VIR M. DUPONT", rules)).toBeNull();
});

test("default rules cover common merchants", () => {
  expect(categorize("LECLERC DRIVE", DEFAULT_RULES)).toBe("Courses");
  expect(categorize("UBER EATS", DEFAULT_RULES)).toBe("Restaurants");
});
