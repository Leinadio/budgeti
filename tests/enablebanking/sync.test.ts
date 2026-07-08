import { expect, test } from "vitest";
import { getDb } from "../../src/db/index";
import { syncAll } from "../../src/enablebanking/sync";
import { listTransactions } from "../../src/db/repositories/transactions";
import { totalBalance, listAccounts } from "../../src/db/repositories/accounts";

const fakeEbGet = async (path: string): Promise<any> => {
  if (path.endsWith("/balances")) {
    return { balances: [{ balance_amount: { amount: "500.00", currency: "EUR" } }] };
  }
  if (path.endsWith("/details")) {
    return { account_id: { iban: "FR7630001007941234567890185" }, name: "Compte Courant" };
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

test("sync imports balance + transactions", async () => {
  const db = getDb(":memory:");
  const result = await syncAll(db, {
    ebGet: fakeEbGet,
    accountUids: ["acc1"],
    accountName: "CIC",
  });
  expect(result.imported).toBe(1);
  expect(totalBalance(db)).toBe(500);
  const txns = listTransactions(db);
  expect(txns[0].amount).toBe(-30);
});

test("keeps two accounts separate with their own balance, label and transactions", async () => {
  const perAccount = async (path: string): Promise<any> => {
    const isB = path.includes("accB");
    if (path.endsWith("/balances"))
      return { balances: [{ balance_amount: { amount: isB ? "471.12" : "90.13", currency: "EUR" } }] };
    if (path.endsWith("/details"))
      return { account_id: { iban: isB ? "FR76....0140" : "FR76....4730" }, name: "CIC" };
    if (path.endsWith("/transactions"))
      return {
        transactions: [
          {
            entry_reference: isB ? "b1" : "a1",
            booking_date: "2026-07-02",
            transaction_amount: { amount: "10.00", currency: "EUR" },
            credit_debit_indicator: "DBIT",
            remittance_information: [isB ? "RESTO B" : "COURSES A"],
          },
        ],
      };
    return {};
  };

  const db = getDb(":memory:");
  await syncAll(db, { ebGet: perAccount, accountUids: ["accA", "accB"], accountName: "CIC" });

  const accounts = listAccounts(db);
  expect(accounts).toHaveLength(2);
  expect(accounts.find((a) => a.id === "accA")?.balance).toBe(90.13);
  expect(accounts.find((a) => a.id === "accB")?.balance).toBe(471.12);
  expect(totalBalance(db)).toBeCloseTo(561.25);

  const txns = listTransactions(db);
  const a1 = txns.find((t) => t.id === "a1")!;
  const b1 = txns.find((t) => t.id === "b1")!;
  expect(a1.accountId).toBe("accA");
  expect(b1.accountId).toBe("accB");
  expect(a1.accountLabel).toBe("CIC …4730");
  expect(b1.accountLabel).toBe("CIC …0140");
});

test("sync deduplicates on re-run (imported === 0 on second call)", async () => {
  const db = getDb(":memory:");
  await syncAll(db, { ebGet: fakeEbGet, accountUids: ["acc1"], accountName: "CIC" });
  const second = await syncAll(db, { ebGet: fakeEbGet, accountUids: ["acc1"], accountName: "CIC" });
  expect(second.imported).toBe(0);
  expect(listTransactions(db)).toHaveLength(1);
});
