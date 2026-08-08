import { expect, test } from "vitest";
import { getDb } from "../../src/db/index";
import { upsertAccount } from "../../src/db/repositories/accounts";
import { insertGroup, insertLine, deleteLine } from "../../src/db/repositories/groups";
import { listLineAmounts, setLineAmount, deleteLineAmount } from "../../src/db/repositories/line-amounts";

function seed() {
  const db = getDb(":memory:");
  upsertAccount(db, { id: "a1", name: "CIC", iban_masked: null, balance: 0, currency: "EUR", last_synced: null });
  const gid = insertGroup(db, "a1", "Abonnements", "out", 0, null, "2026-01", null);
  const lid = insertLine(db, gid, "Spotify", 12.14);
  return { db, gid, lid };
}

test("setLineAmount pose un montant daté, puis l'écrase au même mois", () => {
  const { db, lid } = seed();
  setLineAmount(db, lid, "2026-08", 13.5);
  expect(listLineAmounts(db)).toEqual([{ lineId: lid, effectiveMonth: "2026-08", amount: 13.5, scope: "ongoing" }]);
  setLineAmount(db, lid, "2026-08", 14);
  expect(listLineAmounts(db)).toEqual([{ lineId: lid, effectiveMonth: "2026-08", amount: 14, scope: "ongoing" }]);
});

test("listLineAmounts trie par ligne puis par mois croissant", () => {
  const { db, lid } = seed();
  setLineAmount(db, lid, "2026-09", 15);
  setLineAmount(db, lid, "2026-07", 12.14);
  expect(listLineAmounts(db).map((r) => r.effectiveMonth)).toEqual(["2026-07", "2026-09"]);
});

test("deleteLineAmount retire une seule entrée", () => {
  const { db, lid } = seed();
  setLineAmount(db, lid, "2026-07", 12.14);
  setLineAmount(db, lid, "2026-09", 15);
  deleteLineAmount(db, lid, "2026-09");
  expect(listLineAmounts(db).map((r) => r.effectiveMonth)).toEqual(["2026-07"]);
});

test("supprimer une ligne emporte son historique de montants", () => {
  const { db, lid } = seed();
  setLineAmount(db, lid, "2026-07", 12.14);
  deleteLine(db, lid);
  expect(listLineAmounts(db)).toEqual([]);
});
