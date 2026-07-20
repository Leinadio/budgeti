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
  insertLine,
  deleteLine,
  hasIncomeGroup,
  renameGroup,
} from "../../src/db/repositories/groups";
import { setBudgetAmount, listBudgetAmounts } from "../../src/db/repositories/budget-amounts";
import { toDatedBudgets, budgetInForce } from "../../src/lib/history";
import type { Group } from "../../src/lib/forecast";
import { migrateGroupLifespan } from "../../src/db/migrations";

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

test("recurring group: dated lines summed, delete cascades", () => {
  const db = getDb(":memory:");
  upsertAccount(db, { id: "a1", name: "CIC", iban_masked: null, balance: 0, currency: "EUR", last_synced: null });
  const gid = insertRecurringGroup(db, "a1", "Abonnements", "out", null, "2000-01", null);
  insertLine(db, gid, "Spotify", 10, 3);
  insertLine(db, gid, "Netflix", 15, 8);
  const g = listGroups(db)[0];
  expect(g).toMatchObject({ id: gid, name: "Abonnements", kind: "recurring", monthlyAmount: null });
  expect(g.lines.map((l) => [l.name, l.amount, l.day])).toEqual([
    ["Spotify", 10, 3],
    ["Netflix", 15, 8],
  ]);
  deleteGroup(db, gid);
  expect(listGroups(db)).toHaveLength(0);
  expect(db.prepare("SELECT COUNT(*) AS n FROM group_lines").get()).toEqual({ n: 0 });
});

// Garde-fou contre la régression « ligne fantôme » : insertLine doit renvoyer le
// vrai id auto-incrémenté de la ligne créée, pour que deleteLine/updateLine
// appelés juste après (sans recharger la page) visent la bonne ligne en base.
test("insertLine renvoie le vrai id, réutilisable par deleteLine", () => {
  const db = getDb(":memory:");
  upsertAccount(db, { id: "a1", name: "CIC", iban_masked: null, balance: 0, currency: "EUR", last_synced: null });
  const gid = insertRecurringGroup(db, "a1", "Abonnements", "out", null, "2000-01", null);
  const lineId = insertLine(db, gid, "Spotify", 10, 3);
  expect(lineId).toBeGreaterThan(0);
  expect(listGroups(db)[0].lines.map((l) => l.id)).toEqual([lineId]);
  deleteLine(db, lineId);
  expect(listGroups(db)[0].lines).toEqual([]);
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
  const g1 = insertRecurringGroup(db, "a1", "Abonnements", "out", null, "2000-01", null);
  insertLine(db, g1, "Spotify", 10, 3);
  const g2 = insertRecurringGroup(db, "a2", "Courses", "out", null, "2000-01", null);
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
  const gid = insertEnvelopeGroup(db, "a1", "Courses", "out", 300, null, "2000-01", null);
  upsertTransaction(db, { id: "t1", account_id: "a1", date: "2026-07-01", amount: -30, label: "X", category_id: null });
  setTransactionGroup(db, "t1", gid);
  expect(listTransactions(db)[0].groupId).toBe(gid);
  setTransactionGroup(db, "t1", null);
  expect(listTransactions(db)[0].groupId).toBeNull();
});

test("groups carry income_kind for income classification", () => {
  const db = getDb(":memory:");
  upsertAccount(db, { id: "a1", name: "CIC", iban_masked: null, balance: 0, currency: "EUR", last_synced: null });
  const p = insertRecurringGroup(db, "a1", "Rémunération principale", "in", "principal", "2000-01", null);
  const s = insertEnvelopeGroup(db, "a1", "Rémunération supplémentaire", "in", 0, "supplementary", "2000-01", null);
  const c = insertEnvelopeGroup(db, "a1", "Courses", "out", 300, null, "2000-01", null);
  const byId = Object.fromEntries(listGroups(db).map((g) => [g.id, g]));
  expect(byId[p].incomeKind).toBe("principal");
  expect(byId[s].incomeKind).toBe("supplementary");
  expect(byId[c].incomeKind).toBeNull();
});

test("hasIncomeGroup détecte une rémunération existante du même type", () => {
  const db = getDb(":memory:");
  upsertAccount(db, { id: "a1", name: "CIC", iban_masked: null, balance: 0, currency: "EUR", last_synced: null });
  upsertAccount(db, { id: "a2", name: "CIC", iban_masked: null, balance: 0, currency: "EUR", last_synced: null });
  insertEnvelopeGroup(db, "a1", "Rémunération principale", "in", 2000, "principal", "2000-01", null);
  expect(hasIncomeGroup(db, "a1", "principal")).toBe(true);
  expect(hasIncomeGroup(db, "a1", "supplementary")).toBe(false);
  expect(hasIncomeGroup(db, "a2", "principal")).toBe(false);
});

test("stocke et relit la durée de vie d'un groupe (start_month / end_month)", () => {
  const db = getDb(":memory:");
  upsertAccount(db, { id: "a1", name: "CIC", iban_masked: null, balance: 0, currency: "EUR", last_synced: null });
  const permanent = insertEnvelopeGroup(db, "a1", "Courses", "out", 300, null, "2026-07", null);
  const ponctuel = insertEnvelopeGroup(db, "a1", "Cadeau", "out", 50, null, "2026-08", "2026-08");
  const rec = insertRecurringGroup(db, "a1", "Abonnements", "out", null, "2026-07", null);
  const groups = listGroups(db);
  const byId = (id: number) => groups.find((g) => g.id === id)!;
  expect(byId(permanent).startMonth).toBe("2026-07");
  expect(byId(permanent).endMonth).toBeNull();
  expect(byId(ponctuel).endMonth).toBe("2026-08");
  expect(byId(rec).startMonth).toBe("2026-07");
});

test("renomme un groupe sans toucher au reste", () => {
  const db = getDb(":memory:");
  upsertAccount(db, { id: "a1", name: "CIC", iban_masked: null, balance: 0, currency: "EUR", last_synced: null });
  const id = insertEnvelopeGroup(db, "a1", "Ancien", "out", 100, null, "2026-07", null);
  renameGroup(db, id, "Nouveau");
  expect(listGroups(db).find((g) => g.id === id)!.name).toBe("Nouveau");
});

test("setGroupAmount 'once' n'affecte que le mois visé", () => {
  const db = getDb(":memory:");
  upsertAccount(db, { id: "a1", name: "CIC", iban_masked: null, balance: 0, currency: "EUR", last_synced: null });
  const id = insertEnvelopeGroup(db, "a1", "Courses", "out", 300, null, "2026-01", null);
  // Simule l'action 'once' : montant à juillet, restauration du précédent en août.
  const prev = 300; // budget en vigueur avant juillet (monthlyAmount)
  setBudgetAmount(db, id, "2026-07", 500);
  setBudgetAmount(db, id, "2026-08", prev);
  const dated = toDatedBudgets(listBudgetAmounts(db));
  const g = listGroups(db).find((x) => x.id === id)! as unknown as Group;
  expect(budgetInForce(g, "2026-07", dated)).toBe(500);
  expect(budgetInForce(g, "2026-08", dated)).toBe(300);
});

test("les groupes créés avant migration sont visibles partout (start_month '2000-01')", () => {
  const db = getDb(":memory:");
  upsertAccount(db, { id: "a1", name: "CIC", iban_masked: null, balance: 0, currency: "EUR", last_synced: null });
  // Simule une base pré-migration : on insère sans les colonnes, puis on rejoue la migration.
  db.prepare(
    "INSERT INTO groups (account_id, name, direction, kind, monthly_amount) VALUES ('a1','Legacy','out','envelope',200)",
  ).run();
  db.exec("UPDATE groups SET start_month = NULL, end_month = NULL");
  migrateGroupLifespan(db);
  expect(listGroups(db)[0].startMonth).toBe("2000-01");
});
