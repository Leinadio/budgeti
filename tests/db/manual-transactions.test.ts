import { expect, test } from "vitest";
import { getDb } from "../../src/db/index";
import { upsertAccount } from "../../src/db/repositories/accounts";
import { insertManualTransaction, listTransactions, updateManualTransaction, deleteManualTransaction, setIncomeKind, upsertTransaction, findReconcileSuggestions, mergeTransactions, ignoreMatch } from "../../src/db/repositories/transactions";
import { insertEnvelopeGroup } from "../../src/db/repositories/groups";

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

test("findReconcileSuggestions matches by account, amount and date window", () => {
  const db = seed();
  upsertAccount(db, { id: "a2", name: "Livret", iban_masked: null, balance: 0, currency: "EUR", last_synced: null });
  const m = insertManualTransaction(db, {
    accountId: "a1", date: "2026-07-01", amount: 652.09, label: "Rémunération", groupId: null, lineId: null, incomeKind: "principal",
  });
  // candidat valide : même compte, même montant, 3 jours plus tard
  upsertTransaction(db, { id: "bank_ok", account_id: "a1", date: "2026-07-04", amount: 652.09, label: "VIR SEPA", category_id: null });
  // hors fenêtre (10 jours)
  upsertTransaction(db, { id: "bank_far", account_id: "a1", date: "2026-07-11", amount: 652.09, label: "VIR", category_id: null });
  // autre montant
  upsertTransaction(db, { id: "bank_amt", account_id: "a1", date: "2026-07-02", amount: 100, label: "VIR", category_id: null });
  // autre compte
  upsertTransaction(db, { id: "bank_acc", account_id: "a2", date: "2026-07-02", amount: 652.09, label: "VIR", category_id: null });

  const sugg = findReconcileSuggestions(db);
  expect(sugg).toHaveLength(1);
  expect(sugg[0].manual.id).toBe(m);
  expect(sugg[0].synced.id).toBe("bank_ok");
});

test("findReconcileSuggestions skips ignored pairs", () => {
  const db = seed();
  const m = insertManualTransaction(db, {
    accountId: "a1", date: "2026-07-01", amount: 50, label: "top-up", groupId: null, lineId: null, incomeKind: "supplementary",
  });
  upsertTransaction(db, { id: "bank_ok", account_id: "a1", date: "2026-07-02", amount: 50, label: "VIR", category_id: null });
  expect(findReconcileSuggestions(db)).toHaveLength(1);
  db.prepare("INSERT INTO reconcile_ignored (manual_id, synced_id) VALUES (?, ?)").run(m, "bank_ok");
  expect(findReconcileSuggestions(db)).toHaveLength(0);
});

test("findReconcileSuggestions enforces boundary at exactly 5-day window", () => {
  const db = seed();
  const m = insertManualTransaction(db, {
    accountId: "a1", date: "2026-07-01", amount: 100, label: "test boundary", groupId: null, lineId: null, incomeKind: null,
  });
  // +5 days: should be included
  upsertTransaction(db, { id: "bank_5days", account_id: "a1", date: "2026-07-06", amount: 100, label: "VIR", category_id: null });
  // +6 days: should be excluded
  upsertTransaction(db, { id: "bank_6days", account_id: "a1", date: "2026-07-07", amount: 100, label: "VIR", category_id: null });

  const sugg = findReconcileSuggestions(db);
  const syncedIds = sugg.map((s) => s.synced.id);
  expect(syncedIds).toContain("bank_5days");
  expect(syncedIds).not.toContain("bank_6days");
});

test("mergeTransactions keeps the bank row, carries tagging, notes the manual label", () => {
  const db = seed();
  const gid = insertEnvelopeGroup(db, "a1", "Rémunération", "in", 652.09);
  const m = insertManualTransaction(db, {
    accountId: "a1", date: "2026-07-01", amount: 652.09, label: "Rémunération juillet",
    groupId: gid, lineId: null, incomeKind: "principal",
  });
  upsertTransaction(db, { id: "bank1", account_id: "a1", date: "2026-07-03", amount: 652.09, label: "VIR SEPA RECU", category_id: null });

  mergeTransactions(db, { syncedId: "bank1", manualId: m });

  const rows = listTransactions(db);
  expect(rows.map((t) => t.id)).toEqual(["bank1"]); // la manuelle a disparu
  expect(rows[0]).toMatchObject({
    id: "bank1", label: "VIR SEPA RECU", groupId: gid, incomeKind: "principal", note: "Rémunération juillet", manual: false,
  });
});

test("mergeTransactions does not delete the manual row when synced target does not exist", () => {
  const db = seed();
  const gid = insertEnvelopeGroup(db, "a1", "Rémunération", "in", 652.09);
  const m = insertManualTransaction(db, {
    accountId: "a1", date: "2026-07-01", amount: 652.09, label: "Rémunération juillet",
    groupId: gid, lineId: null, incomeKind: "principal",
  });

  // Attempt to merge with a non-existent synced id
  mergeTransactions(db, { syncedId: "does-not-exist", manualId: m });

  // Manual row should still exist unchanged
  const rows = listTransactions(db);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    id: m, manual: true, groupId: gid, incomeKind: "principal", label: "Rémunération juillet",
  });
});

test("ignoreMatch records a dismissed pair so it is no longer suggested", () => {
  const db = seed();
  const m = insertManualTransaction(db, {
    accountId: "a1", date: "2026-07-01", amount: 50, label: "top-up", groupId: null, lineId: null, incomeKind: "supplementary",
  });
  upsertTransaction(db, { id: "bank1", account_id: "a1", date: "2026-07-02", amount: 50, label: "VIR", category_id: null });
  ignoreMatch(db, m, "bank1");
  expect(findReconcileSuggestions(db)).toHaveLength(0);
  // idempotent : deuxième écartement sans erreur
  ignoreMatch(db, m, "bank1");
  expect(db.prepare("SELECT COUNT(*) AS n FROM reconcile_ignored").get()).toEqual({ n: 1 });
});
