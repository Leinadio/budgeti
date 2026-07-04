import { expect, test } from "vitest";
import { buildAlerts } from "../../src/lib/alerts";
import type { Envelope } from "../../src/lib/budget";

const env = (category: string, ratio: number): Envelope => ({
  category,
  limit: 100,
  spent: ratio * 100,
  remaining: 100 - ratio * 100,
  ratio,
});

test("warns at 80%, danger at overspend, danger under balance threshold", () => {
  const alerts = buildAlerts([env("Courses", 0.85), env("Transport", 1.2)], 150, 200);
  expect(alerts).toContainEqual({ level: "warn", message: expect.stringContaining("Courses") });
  expect(alerts).toContainEqual({ level: "danger", message: expect.stringContaining("Transport") });
  expect(alerts.some((a) => a.level === "danger" && a.message.includes("solde"))).toBe(true);
});

test("no alerts when everything is fine", () => {
  expect(buildAlerts([env("Courses", 0.3)], 500, 200)).toEqual([]);
});
