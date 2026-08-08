// Raccourcir la durée d'un groupe rend ses transactions des mois retirés aux « non
// catégorisés » — vraiment, en base, et pas seulement à l'affichage. C'est ce qui fait
// qu'elles y RESTENT si on rallonge ensuite : le rattachement a été défait, il se
// refait à la main.
import { beforeEach, expect, test } from "vitest";
import type Database from "better-sqlite3";
import { getDb } from "../../src/db/index";
import { upsertAccount } from "../../src/db/repositories/accounts";
import { insertGroup, insertLine } from "../../src/db/repositories/groups";
import { insertManualTransaction, detachTransactionsInMonths } from "../../src/db/repositories/transactions";

let db: Database.Database;
beforeEach(() => {
  db = getDb(":memory:");
  upsertAccount(db, { id: "a1", name: "CIC", iban_masked: null, balance: 0, currency: "EUR", last_synced: null });
});

const depense = (mois: string, groupId: number | null, lineId: number | null = null) =>
  insertManualTransaction(db, {
    accountId: "a1", date: `${mois}-12`, amount: -30, label: "PRLV", groupId, lineId, incomeKind: null,
  });

const rattachement = (id: string) =>
  db.prepare(`SELECT group_id AS groupId, line_id AS lineId FROM transactions WHERE id = ?`).get(id);

test("détache les transactions du groupe sur les mois donnés, et elles seules", () => {
  const gid = insertGroup(db, "a1", "Courses", "out", 300, null, "2026-01", null);
  const mai = depense("2026-05", gid);
  const juin = depense("2026-06", gid);

  const n = detachTransactionsInMonths(db, { groupId: gid }, ["2026-06"]);

  expect(n).toBe(1);
  expect(rattachement(mai)).toEqual({ groupId: gid, lineId: null });
  expect(rattachement(juin)).toEqual({ groupId: null, lineId: null });
});

// Une ligne de récurrent perd les deux rattachements : le groupe parent aussi. Sans
// ça, la transaction retomberait sous le récurrent au lieu des non catégorisés, et
// l'avertissement affiché aurait menti.
test("détacher une ligne rend la transaction aux non catégorisés, groupe parent compris", () => {
  const gid = insertGroup(db, "a1", "Abonnements", "out", 0, null, "2026-01", null);
  const lid = insertLine(db, gid, "Spotify", 10);
  const t = depense("2026-06", gid, lid);

  detachTransactionsInMonths(db, { lineId: lid }, ["2026-06"]);

  expect(rattachement(t)).toEqual({ groupId: null, lineId: null });
});

test("ne touche pas aux transactions d'un autre groupe", () => {
  const gid = insertGroup(db, "a1", "Courses", "out", 300, null, "2026-01", null);
  const autre = insertGroup(db, "a1", "Essence", "out", 100, null, "2026-01", null);
  const t = depense("2026-06", autre);

  detachTransactionsInMonths(db, { groupId: gid }, ["2026-06"]);

  expect(rattachement(t)).toEqual({ groupId: autre, lineId: null });
});

test("ne fait rien sur une liste de mois vide", () => {
  const gid = insertGroup(db, "a1", "Courses", "out", 300, null, "2026-01", null);
  const t = depense("2026-06", gid);

  expect(detachTransactionsInMonths(db, { groupId: gid }, [])).toBe(0);
  expect(rattachement(t)).toEqual({ groupId: gid, lineId: null });
});
