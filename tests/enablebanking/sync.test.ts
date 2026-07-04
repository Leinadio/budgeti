import { expect, test } from "vitest";
import { getDb } from "../../src/db/index";
import { seed } from "../../src/db/seed";
import { syncAll } from "../../src/enablebanking/sync";
import { listTransactions } from "../../src/db/repositories/transactions";
import { totalBalance } from "../../src/db/repositories/accounts";

const fakeEbGet = async (path: string): Promise<any> => {
  if (path.endsWith("/balances")) {
    return { balances: [{ balance_amount: { amount: "500.00", currency: "EUR" } }] };
  }
  if (path.endsWith("/transactions")) {
    return {
      transactions: [
        {
          entry_reference: "tx1",
          booking_date: "2026-07-01",
          transaction_amount: { amount: "30.00", currency: "EUR" },
          credit_debit_indicator: "DBIT",
          remittance_information: ["CARREFOUR MARKET"],
        },
      ],
    };
  }
  return {};
};

test("sync imports balance + categorized transactions", async () => {
  const db = getDb(":memory:");
  seed(db);
  const result = await syncAll(db, {
    ebGet: fakeEbGet,
    accountUids: ["acc1"],
    accountName: "CIC",
  });
  expect(result.imported).toBe(1);
  expect(totalBalance(db)).toBe(500);
  const txns = listTransactions(db);
  expect(txns[0].category).toBe("Courses");
  expect(txns[0].amount).toBe(-30);
});

test("sync deduplicates on re-run (imported === 0 on second call)", async () => {
  const db = getDb(":memory:");
  seed(db);
  await syncAll(db, { ebGet: fakeEbGet, accountUids: ["acc1"], accountName: "CIC" });
  const second = await syncAll(db, { ebGet: fakeEbGet, accountUids: ["acc1"], accountName: "CIC" });
  expect(second.imported).toBe(0);
  expect(listTransactions(db)).toHaveLength(1);
});
