import { expect, test } from "vitest";
import { getDb } from "../../src/db/index";
import { ensureCategory, listCategories } from "../../src/db/repositories/categories";
import { upsertTransaction, listTransactions } from "../../src/db/repositories/transactions";
import { upsertAccount, totalBalance, setAccountAlias, listAccounts, deleteAccount } from "../../src/db/repositories/accounts";
import { setSetting, getSetting } from "../../src/db/repositories/settings";
import {
  listGroups,
  insertGroup,
  deleteGroup,
  insertLine,
  deleteLine,
  getGroupDirection,
} from "../../src/db/repositories/groups";

test("category ensure is idempotent", () => {
  const db = getDb(":memory:");
  const a = ensureCategory(db, "Courses");
  const b = ensureCategory(db, "Courses");
  expect(a).toBe(b);
  expect(listCategories(db)).toHaveLength(1);
});

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

test("group + lines insert, list nested, delete line", () => {
  const db = getDb(":memory:");
  upsertAccount(db, { id: "acc1", name: "CIC", iban_masked: null, balance: 0, currency: "EUR", last_synced: null });
  const gid = insertGroup(db, "acc1", "Abonnements", "out");
  insertLine(db, gid, "Spotify", 10, 3, "SPOTIFY");
  insertLine(db, gid, "Courses", 300, null, "CARREFOUR");

  const groups = listGroups(db);
  expect(groups).toHaveLength(1);
  expect(groups[0]).toMatchObject({ id: gid, accountId: "acc1", name: "Abonnements", direction: "out" });
  expect(groups[0].lines).toHaveLength(2);
  expect(groups[0].lines[0]).toMatchObject({ name: "Spotify", amount: 10, day: 3, keyword: "SPOTIFY" });
  expect(groups[0].lines[1]).toMatchObject({ name: "Courses", amount: 300, day: null, keyword: "CARREFOUR" });

  deleteLine(db, groups[0].lines[0].id);
  expect(listGroups(db)[0].lines).toHaveLength(1);
});

test("deleteGroup cascades to its lines", () => {
  const db = getDb(":memory:");
  upsertAccount(db, { id: "acc1", name: "CIC", iban_masked: null, balance: 0, currency: "EUR", last_synced: null });
  const gid = insertGroup(db, "acc1", "Abonnements", "out");
  insertLine(db, gid, "Spotify", 10, 3, "SPOTIFY");
  deleteGroup(db, gid);
  expect(listGroups(db)).toHaveLength(0);
  const orphans = db.prepare("SELECT COUNT(*) AS n FROM group_lines").get() as { n: number };
  expect(orphans.n).toBe(0);
});

test("getGroupDirection returns the direction or null if unknown", () => {
  const db = getDb(":memory:");
  upsertAccount(db, { id: "acc1", name: "CIC", iban_masked: null, balance: 0, currency: "EUR", last_synced: null });
  const inId = insertGroup(db, "acc1", "Salaire", "in");
  const outId = insertGroup(db, "acc1", "Abonnements", "out");

  expect(getGroupDirection(db, inId)).toBe("in");
  expect(getGroupDirection(db, outId)).toBe("out");
  expect(getGroupDirection(db, 9999)).toBeNull();
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
  const g1 = insertGroup(db, "a1", "Abonnements", "out");
  insertLine(db, g1, "Spotify", 10, 3, "SPOTIFY");
  const g2 = insertGroup(db, "a2", "Courses", "out");
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
