import { expect, test } from "vitest";
import { getDb } from "../../src/db/index";
import { upsertAccount } from "../../src/db/repositories/accounts";
import { insertManualTransaction, listTransactions } from "../../src/db/repositories/transactions";

function seed() {
  const db = getDb(":memory:");
  upsertAccount(db, { id: "a1", name: "CIC", iban_masked: null, balance: 0, currency: "EUR", last_synced: null });
  return db;
}

test("insertManualTransaction stores a manual row and lists it back", () => {
  const db = seed();
  const id = insertManualTransaction(db, {
    accountId: "a1", date: "2026-07-01", amount: 652.09, label: "Rémunération juillet",
    groupId: null, lineId: null, incomeKind: "principal",
  });
  expect(id.startsWith("manual:")).toBe(true);
  const rows = listTransactions(db);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    id, amount: 652.09, label: "Rémunération juillet",
    manual: true, incomeKind: "principal", note: null,
  });
});
