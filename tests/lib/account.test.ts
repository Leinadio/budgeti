import { expect, test } from "vitest";
import { accountDisplayName, accountLabel } from "../../src/lib/account";

test("accountDisplayName prefers the alias, falls back to the bank name", () => {
  expect(accountDisplayName({ name: "CIC", custom_name: "Joint" })).toBe("Joint");
  expect(accountDisplayName({ name: "CIC", custom_name: null })).toBe("CIC");
  expect(accountDisplayName({ name: "CIC", custom_name: "" })).toBe("CIC");
});

test("accountLabel appends the masked IBAN when present", () => {
  expect(accountLabel({ name: "CIC", custom_name: "Joint", iban_masked: "…1234" })).toBe("Joint …1234");
  expect(accountLabel({ name: "CIC", custom_name: null, iban_masked: "…1234" })).toBe("CIC …1234");
  expect(accountLabel({ name: "CIC", custom_name: null, iban_masked: null })).toBe("CIC");
});
