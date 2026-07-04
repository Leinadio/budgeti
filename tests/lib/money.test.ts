import { expect, test } from "vitest";
import { parseAmount, formatEur, monthKey } from "../../src/lib/money";

test("parseAmount signs debits negative", () => {
  expect(parseAmount("12.34", "DBIT")).toBe(-12.34);
  expect(parseAmount("50.00", "CRDT")).toBe(50);
});

test("formatEur formats French euros", () => {
  expect(formatEur(-12.3)).toBe("-12,30 €");
  expect(formatEur(1000)).toBe("1 000,00 €");
});

test("monthKey extracts YYYY-MM", () => {
  expect(monthKey("2026-07-04")).toBe("2026-07");
});
