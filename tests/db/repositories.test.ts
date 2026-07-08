import { expect, test } from "vitest";
import { getDb } from "../../src/db/index";
import { upsertTransaction, listTransactions, setTransactionGroup } from "../../src/db/repositories/transactions";
import { upsertAccount, totalBalance, setAccountAlias, listAccounts, deleteAccount } from "../../src/db/repositories/accounts";
import { setSetting, getSetting } from "../../src/db/repositories/settings";
import {
  listGroups,
  insertEnvelopeGroup,
  insertRecurringGroup,
  deleteGroup,
  addKeyword,
  insertLine,
  deleteLine,
} from "../../src/db/repositories/groups";

test("transaction upsert dedupes by id and lists back", () => {
  const db = getDb(":memory:");
  upsertAccount(db, { id: "acc1", name: "CIC", iban_masked: "***1234", balance: 500, currency: "EUR", last_synced: null });
  const t = { id: "tx1", account_id: "acc1", date: "2026-07-01", amount: -30, label: "CARREFOUR", category_id: null };
  upsertTransaction(db, t);
  upsertTransaction(db, t); // duplicate ignored
  expect(listTransactions(db)).toHaveLength(1);
  expect(totalBalance(db)).toBe(500);
});

test("settings round-trip", () => {
  const db = getDb(":memory:");
  setSetting(db, "balance_threshold", "200");
  expect(getSetting(db, "balance_threshold")).toBe("200");
  expect(getSetting(db, "missing")).toBeNull();
});

test("envelope group: keywords add/list/remove", () => {
  const db = getDb(":memory:");
  upsertAccount(db, { id: "a1", name: "CIC", iban_masked: null, balance: 0, currency: "EUR", last_synced: null });
  const gid = insertEnvelopeGroup(db, "a1", "Courses", "out", 300);
  addKeyword(db, gid, "CARREFOUR");
  addKeyword(db, gid, "LECLERC");
  const g = listGroups(db)[0];
  expect(g).toMatchObject({ id: gid, accountId: "a1", name: "Courses", direction: "out", kind: "envelope", monthlyAmount: 300 });
  expect(g.keywords.sort()).toEqual(["CARREFOUR", "LECLERC"]);
  expect(g.lines).toEqual([]);
  // rajouter le même mot-clé ne crée pas de doublon
  addKeyword(db, gid, "CARREFOUR");
  expect(listGroups(db)[0].keywords.filter((k) => k === "CARREFOUR")).toHaveLength(1);
  // la suppression d'un groupe emporte ses mots-clés (cascade)
  deleteGroup(db, gid);
  expect(db.prepare("SELECT COUNT(*) AS n FROM group_keywords").get()).toEqual({ n: 0 });
});

test("recurring group: dated lines summed, delete cascades", () => {
  const db = getDb(":memory:");
  upsertAccount(db, { id: "a1", name: "CIC", iban_masked: null, balance: 0, currency: "EUR", last_synced: null });
  const gid = insertRecurringGroup(db, "a1", "Abonnements", "out");
  insertLine(db, gid, "Spotify", 10, 3, "SPOTIFY");
  insertLine(db, gid, "Netflix", 15, 8, "NETFLIX");
  const g = listGroups(db)[0];
  expect(g).toMatchObject({ id: gid, name: "Abonnements", kind: "recurring", monthlyAmount: null });
  expect(g.keywords).toEqual([]);
  expect(g.lines.map((l) => [l.name, l.amount, l.day, l.keyword])).toEqual([
    ["Spotify", 10, 3, "SPOTIFY"],
    ["Netflix", 15, 8, "NETFLIX"],
  ]);
  deleteGroup(db, gid);
  expect(listGroups(db)).toHaveLength(0);
  expect(db.prepare("SELECT COUNT(*) AS n FROM group_lines").get()).toEqual({ n: 0 });
});

test("setAccountAlias sets and resets the alias", () => {
  const db = getDb(":memory:");
  upsertAccount(db, { id: "a1", name: "CIC", iban_masked: null, balance: 0, currency: "EUR", last_synced: null });
  setAccountAlias(db, "a1", "Perso");
  expect(listAccounts(db)[0].custom_name).toBe("Perso");
  setAccountAlias(db, "a1", null);
  expect(listAccounts(db)[0].custom_name).toBeNull();
});

test("upsertAccount preserves a custom alias across a resync", () => {
  const db = getDb(":memory:");
  upsertAccount(db, { id: "a1", name: "CIC", iban_masked: null, balance: 100, currency: "EUR", last_synced: null });
  setAccountAlias(db, "a1", "Compte joint");
  // resynchro : même id, name/balance mis à jour
  upsertAccount(db, { id: "a1", name: "CIC", iban_masked: null, balance: 250, currency: "EUR", last_synced: "2026-07-07" });
  const a = listAccounts(db).find((x) => x.id === "a1")!;
  expect(a.custom_name).toBe("Compte joint"); // alias préservé
  expect(a.balance).toBe(250);                 // solde mis à jour
});

test("deleteAccount removes the account, its transactions, its groups+lines, and its sync uid", () => {
  const db = getDb(":memory:");
  upsertAccount(db, { id: "a1", name: "CIC", iban_masked: null, balance: 100, currency: "EUR", last_synced: null });
  upsertAccount(db, { id: "a2", name: "CIC", iban_masked: null, balance: 50, currency: "EUR", last_synced: null });
  upsertTransaction(db, { id: "t1", account_id: "a1", date: "2026-07-01", amount: -10, label: "X", category_id: null });
  upsertTransaction(db, { id: "t2", account_id: "a2", date: "2026-07-01", amount: -20, label: "Y", category_id: null });
  const g1 = insertRecurringGroup(db, "a1", "Abonnements", "out");
  insertLine(db, g1, "Spotify", 10, 3, "SPOTIFY");
  const g2 = insertRecurringGroup(db, "a2", "Courses", "out");
  setSetting(db, "account_uids", JSON.stringify(["a1", "a2"]));

  deleteAccount(db, "a1");

  expect(listAccounts(db).map((a) => a.id)).toEqual(["a2"]);
  expect(listTransactions(db).map((t) => t.id)).toEqual(["t2"]);
  expect(listGroups(db).map((g) => g.id)).toEqual([g2]);
  // la ligne de g1 (Spotify) a été supprimée en cascade ; g2 n'avait pas de ligne
  expect(db.prepare("SELECT COUNT(*) AS n FROM group_lines").get()).toEqual({ n: 0 });
  // l'uid a1 est retiré de la liste de synchro
  expect(JSON.parse(getSetting(db, "account_uids")!)).toEqual(["a2"]);
});

test("setTransactionGroup attaches and detaches", () => {
  const db = getDb(":memory:");
  upsertAccount(db, { id: "a1", name: "CIC", iban_masked: null, balance: 0, currency: "EUR", last_synced: null });
  const gid = insertEnvelopeGroup(db, "a1", "Courses", "out", 300);
  upsertTransaction(db, { id: "t1", account_id: "a1", date: "2026-07-01", amount: -30, label: "X", category_id: null });
  setTransactionGroup(db, "t1", gid);
  expect(listTransactions(db)[0].groupId).toBe(gid);
  setTransactionGroup(db, "t1", null);
  expect(listTransactions(db)[0].groupId).toBeNull();
});
