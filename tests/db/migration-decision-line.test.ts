// Une décision de dépassement se prend désormais sur ce qui porte un budget : une
// enveloppe, ou UNE LIGNE de récurrent. La table gagne donc line_id, et son unicité
// devient (compte, groupe, ligne, mois). line_id = 0 signifie « le groupe lui-même »,
// même convention que group_id = 0 pour les non catégorisés ailleurs dans ce schéma —
// et non NULL, que SQLite considère comme distinct de lui-même dans une contrainte
// d'unicité, ce qui laisserait s'empiler des doublons sur une enveloppe.
import { expect, test } from "vitest";
import Database from "better-sqlite3";
import { migrateOverspendDecisionLine } from "../../src/db/migrations";
import { setOverspendDecision, listOverspendDecisions, getOverspendDecision } from "../../src/db/repositories/overspend-decisions";

// Base au schéma d'AVANT : décisions sans ligne.
function dbAvant(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE accounts (id TEXT PRIMARY KEY);
    INSERT INTO accounts (id) VALUES ('a1');
    CREATE TABLE overspend_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      group_id INTEGER NOT NULL,
      month TEXT NOT NULL,
      decision TEXT NOT NULL CHECK (decision IN ('exceptional', 'permanent')),
      decided_at TEXT NOT NULL,
      writes TEXT,
      UNIQUE(account_id, group_id, month)
    );
  `);
  return db;
}

const colonnes = (db: Database.Database) =>
  (db.prepare(`PRAGMA table_info(overspend_decisions)`).all() as { name: string }[]).map((c) => c.name);

test("ajoute la colonne de ligne", () => {
  const db = dbAvant();

  migrateOverspendDecisionLine(db);

  expect(colonnes(db)).toContain("line_id");
});

// Toutes les décisions d'avant portaient sur un groupe entier. Elles restent telles
// quelles : celles des enveloppes et des non catégorisés gardent tout leur sens, et
// celles qui viseraient un récurrent ne font plus taire aucune ligne — c'est voulu,
// une décision de groupe n'est pas une décision de ligne.
test("les décisions déjà prises restent au niveau du groupe", () => {
  const db = dbAvant();
  db.prepare(
    `INSERT INTO overspend_decisions (account_id, group_id, month, decision, decided_at, writes)
     VALUES ('a1', 16, '2026-07', 'permanent', '2026-07-20T10:00:00Z', NULL)`,
  ).run();

  migrateOverspendDecisionLine(db);

  expect(listOverspendDecisions(db, "a1")).toEqual([
    { accountId: "a1", groupId: 16, lineId: null, month: "2026-07", decision: "permanent", decidedAt: "2026-07-20T10:00:00Z", writes: null },
  ]);
});

test("laisse coexister la décision d'un groupe et celles de ses lignes", () => {
  const db = dbAvant();
  migrateOverspendDecisionLine(db);

  setOverspendDecision(db, { accountId: "a1", groupId: 13, lineId: null, month: "2026-07", decision: "exceptional", decidedAt: "t", writes: null });
  setOverspendDecision(db, { accountId: "a1", groupId: 13, lineId: 3, month: "2026-07", decision: "permanent", decidedAt: "t", writes: null });
  setOverspendDecision(db, { accountId: "a1", groupId: 13, lineId: 4, month: "2026-07", decision: "exceptional", decidedAt: "t", writes: null });

  expect(listOverspendDecisions(db, "a1").map((d) => [d.lineId, d.decision])).toEqual([
    [null, "exceptional"],
    [3, "permanent"],
    [4, "exceptional"],
  ]);
});

test("retrancher la même ligne remplace sa décision, sans doubler la ligne", () => {
  const db = dbAvant();
  migrateOverspendDecisionLine(db);

  setOverspendDecision(db, { accountId: "a1", groupId: 13, lineId: 3, month: "2026-07", decision: "exceptional", decidedAt: "t", writes: null });
  setOverspendDecision(db, { accountId: "a1", groupId: 13, lineId: 3, month: "2026-07", decision: "permanent", decidedAt: "t2", writes: null });

  expect(listOverspendDecisions(db, "a1")).toHaveLength(1);
  expect(getOverspendDecision(db, "a1", 13, 3, "2026-07")?.decision).toBe("permanent");
});

// Lire la décision d'une ligne ne doit jamais rendre celle du groupe, ni l'inverse.
test("ne confond pas la décision d'un groupe avec celle d'une de ses lignes", () => {
  const db = dbAvant();
  migrateOverspendDecisionLine(db);
  setOverspendDecision(db, { accountId: "a1", groupId: 13, lineId: null, month: "2026-07", decision: "exceptional", decidedAt: "t", writes: null });

  expect(getOverspendDecision(db, "a1", 13, 3, "2026-07")).toBeNull();
  expect(getOverspendDecision(db, "a1", 13, null, "2026-07")?.decision).toBe("exceptional");
});

test("rejouer la migration ne change rien", () => {
  const db = dbAvant();
  migrateOverspendDecisionLine(db);
  setOverspendDecision(db, { accountId: "a1", groupId: 13, lineId: 3, month: "2026-07", decision: "permanent", decidedAt: "t", writes: null });

  migrateOverspendDecisionLine(db);

  expect(listOverspendDecisions(db, "a1").map((d) => [d.lineId, d.decision])).toEqual([[3, "permanent"]]);
});
