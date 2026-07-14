import { expect, test } from "vitest";
import { getDb } from "../../src/db/index";
import { upsertAccount } from "../../src/db/repositories/accounts";
import { insertManualTransaction, listTransactions, updateManualTransaction, deleteManualTransaction, setIncomeKind, upsertTransaction } from "../../src/db/repositories/transactions";

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

test("updateManualTransaction edits a manual row, ignores synced rows", () => {
  const db = seed();
  const id = insertManualTransaction(db, {
    accountId: "a1", date: "2026-07-01", amount: 100, label: "brouillon",
    groupId: null, lineId: null, incomeKind: "principal",
  });
  updateManualTransaction(db, id, {
    date: "2026-07-02", amount: 200, label: "corrigé", groupId: null, lineId: null, incomeKind: "supplementary",
  });
  const t = listTransactions(db).find((x) => x.id === id)!;
  expect(t).toMatchObject({ date: "2026-07-02", amount: 200, label: "corrigé", incomeKind: "supplementary" });

  // une ligne synchronisée n'est pas modifiée
  upsertTransaction(db, { id: "bank1", account_id: "a1", date: "2026-07-01", amount: -50, label: "BANK", category_id: null });
  updateManualTransaction(db, "bank1", { date: "2000-01-01", amount: 999, label: "hack", groupId: null, lineId: null, incomeKind: null });
  expect(listTransactions(db).find((x) => x.id === "bank1")).toMatchObject({ date: "2026-07-01", amount: -50, label: "BANK" });
});

test("deleteManualTransaction removes only manual rows", () => {
  const db = seed();
  const id = insertManualTransaction(db, {
    accountId: "a1", date: "2026-07-01", amount: 10, label: "x", groupId: null, lineId: null, incomeKind: null,
  });
  upsertTransaction(db, { id: "bank1", account_id: "a1", date: "2026-07-01", amount: -50, label: "BANK", category_id: null });
  deleteManualTransaction(db, "bank1"); // refusé (non manuel)
  expect(listTransactions(db)).toHaveLength(2);
  deleteManualTransaction(db, id);
  expect(listTransactions(db).map((t) => t.id)).toEqual(["bank1"]);
});

test("setIncomeKind tags any income row, including a synced one", () => {
  const db = seed();
  upsertTransaction(db, { id: "bank1", account_id: "a1", date: "2026-07-01", amount: 652.09, label: "VIREMENT", category_id: null });
  setIncomeKind(db, "bank1", "principal");
  expect(listTransactions(db).find((x) => x.id === "bank1")!.incomeKind).toBe("principal");
  setIncomeKind(db, "bank1", null);
  expect(listTransactions(db).find((x) => x.id === "bank1")!.incomeKind).toBeNull();
});
