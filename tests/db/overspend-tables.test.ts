import { test, expect } from "vitest";
import { getDb } from "../../src/db/index";
import { upsertAccount } from "../../src/db/repositories/accounts";
import { insertRecurringGroup, insertLine, getGroupKind } from "../../src/db/repositories/groups";
import { listBudgetAmounts, setBudgetAmount } from "../../src/db/repositories/budget-amounts";
import { listLineAmounts, setLineAmount, deleteLineAmount } from "../../src/db/repositories/line-amounts";
import { listOverspendDecisions, setOverspendDecision, getOverspendDecision } from "../../src/db/repositories/overspend-decisions";
import { toDatedBudgets, toDatedLineAmounts, lineAmountInForce, nextMonthKey } from "../../src/lib/history";
import { envelopeWrites, lineWrites, undoWrites, amountAt, canDecidePermanent, type BudgetWrite } from "../../src/lib/overspend-writes";

function freshDb() {
  const db = getDb(":memory:");
  db.prepare(`INSERT INTO accounts (id, name) VALUES ('a1', 'CIC')`).run();
  db.prepare(
    `INSERT INTO groups (id, account_id, name, direction, kind, monthly_amount) VALUES (1, 'a1', 'Courses', 'out', 'envelope', 300)`,
  ).run();
  return db;
}

test("budget_amounts : upsert et lecture triée", () => {
  const db = freshDb();
  setBudgetAmount(db, 1, "2026-08", 400);
  setBudgetAmount(db, 1, "2026-10", 450);
  setBudgetAmount(db, 1, "2026-08", 410); // upsert : remplace le montant d'août
  expect(listBudgetAmounts(db)).toEqual([
    { groupId: 1, effectiveMonth: "2026-08", amount: 410 },
    { groupId: 1, effectiveMonth: "2026-10", amount: 450 },
  ]);
});

test("budget_amounts : provision groupe 0 (non catégorisés) sans FK", () => {
  const db = freshDb();
  setBudgetAmount(db, 0, "2026-08", 400);
  expect(listBudgetAmounts(db)).toEqual([{ groupId: 0, effectiveMonth: "2026-08", amount: 400 }]);
});

test("overspend_decisions : upsert par (compte, groupe, mois), groupId 0 = non catégorisés", () => {
  const db = freshDb();
  setOverspendDecision(db, { accountId: "a1", groupId: 1, month: "2026-07", decision: "exceptional", decidedAt: "2026-08-01T10:00:00Z", writes: null });
  setOverspendDecision(db, { accountId: "a1", groupId: 0, month: "2026-07", decision: "exceptional", decidedAt: "2026-08-01T10:00:00Z", writes: null });
  setOverspendDecision(db, { accountId: "a1", groupId: 1, month: "2026-07", decision: "permanent", decidedAt: "2026-08-02T10:00:00Z", writes: null });
  const rows = listOverspendDecisions(db, "a1");
  expect(rows).toHaveLength(2);
  expect(rows.find((r) => r.groupId === 1)?.decision).toBe("permanent"); // le dernier choix gagne
  expect(rows.find((r) => r.groupId === 0)?.decision).toBe("exceptional");
  expect(listOverspendDecisions(db, "autre")).toHaveLength(0);
});

test("une décision garde la trace de ses écritures", () => {
  const db = getDb(":memory:");
  upsertAccount(db, { id: "a1", name: "CIC", iban_masked: null, balance: 0, currency: "EUR", last_synced: null });
  const writes = [{ target: "line" as const, id: 101, month: "2026-08", amount: 151.84, before: null }];
  setOverspendDecision(db, { accountId: "a1", groupId: 13, month: "2026-07", decision: "permanent", decidedAt: "2026-07-29T10:00:00Z", writes });
  expect(getOverspendDecision(db, "a1", 13, "2026-07")?.writes).toEqual(writes);
});

test("une décision exceptionnelle n'écrit rien", () => {
  const db = getDb(":memory:");
  upsertAccount(db, { id: "a1", name: "CIC", iban_masked: null, balance: 0, currency: "EUR", last_synced: null });
  setOverspendDecision(db, { accountId: "a1", groupId: 13, month: "2026-07", decision: "exceptional", decidedAt: "2026-07-29T10:00:00Z", writes: null });
  expect(getOverspendDecision(db, "a1", 13, "2026-07")?.writes).toBeNull();
});

test("une hausse permanente sur une ligne prend effet au mois suivant, et s'annule", () => {
  const db = getDb(":memory:");
  upsertAccount(db, { id: "a1", name: "CIC", iban_masked: null, balance: 0, currency: "EUR", last_synced: null });
  const gid = insertRecurringGroup(db, "a1", "Abonnements", "out", null, "2026-01", null);
  const lid = insertLine(db, gid, "Direct Assurance voiture", 81.84, 5);
  setLineAmount(db, lid, "2026-01", 81.84);

  const writes = lineWrites("2026-07", [{ lineId: lid, amount: 151.84, before: null }]);
  for (const w of writes) setLineAmount(db, w.id, w.month, w.amount);
  let datedLines = toDatedLineAmounts(listLineAmounts(db));
  expect(lineAmountInForce(lid, "2026-07", datedLines)).toBeCloseTo(81.84, 2);
  expect(lineAmountInForce(lid, "2026-08", datedLines)).toBeCloseTo(151.84, 2);

  const enPlace = (w: typeof writes[number]) =>
    (toDatedLineAmounts(listLineAmounts(db))[w.id] ?? []).find((e) => e.effectiveMonth === w.month)?.amount ?? null;
  const { remove } = undoWrites(writes, enPlace);
  for (const w of remove) deleteLineAmount(db, w.id, w.month);
  datedLines = toDatedLineAmounts(listLineAmounts(db));
  expect(lineAmountInForce(lid, "2026-08", datedLines)).toBeCloseTo(81.84, 2);
});

// Reproduit le corps de decideOverspend (actions.ts) pour un dépassement de
// GROUPE récurrent sans ventilation par ligne — exactement ce que le formulaire
// actuel du side panel envoie (il n'a pas encore de champ par ligne, cf. brief
// tâche 8). AVANT correctif, l'action n'avait aucun garde-fou sur `kind` et
// écrivait quand même sur budget_amounts. Ce test reproduit fidèlement cette
// logique (via canDecidePermanent, qui doit refuser) : le budget d'un
// récurrent n'a jamais de sens au niveau du groupe (budgetInForce l'ignore et
// migrateSeedDatedAmounts le signale comme vestige), donc rien ne doit jamais
// y être écrit ni aucune décision enregistrée tant qu'on n'a pas de ventilation.
test("un dépassement sur un récurrent sans ventilation par ligne refuse la décision (aucune écriture, aucune décision posée)", () => {
  const db = getDb(":memory:");
  upsertAccount(db, { id: "a1", name: "CIC", iban_masked: null, balance: 0, currency: "EUR", last_synced: null });
  const gid = insertRecurringGroup(db, "a1", "Abonnements", "out", null, "2026-01", null);
  const lid = insertLine(db, gid, "Direct Assurance voiture", 81.84, 5);
  setLineAmount(db, lid, "2026-01", 81.84);

  const month = "2026-07";
  const newBudget = 200; // ce que le champ « Nouveau budget » du side panel envoie
  const kind = getGroupKind(db, gid);
  if (canDecidePermanent(kind!, undefined)) {
    const cible = nextMonthKey(month);
    const before = amountAt(toDatedBudgets(listBudgetAmounts(db))[gid] ?? [], cible);
    const writes = envelopeWrites(gid, month, newBudget, before);
    for (const w of writes) setBudgetAmount(db, w.id, w.month, w.amount);
    setOverspendDecision(db, { accountId: "a1", groupId: gid, month, decision: "permanent", decidedAt: "2026-07-29T10:00:00Z", writes });
  }

  expect(listBudgetAmounts(db).filter((b) => b.groupId === gid)).toEqual([]);
  expect(getOverspendDecision(db, "a1", gid, month)).toBeNull();
});

// Reproduit deux décisions « permanent » successives sur la MÊME case (l'utilisateur
// clique « Modifier » dans le side panel, ce qui ne passe PAS par undo — juste
// setDecided(null) côté client — puis revalide avec un autre montant). AVANT
// correctif, decideOverspend ne défaisait pas les écritures de la décision
// existante avant d'en poser de nouvelles : le `before` de la deuxième décision
// capturait la valeur posée par la PREMIÈRE (400), pas la valeur réelle d'origine
// (300, héritée de l'entrée de janvier). Une fois la deuxième décision annulée, le
// budget retombe donc sur 400 pour toujours — l'entrée d'origine à 300 est
// orpheline, sans recours. Le correctif doit défaire les écritures de la décision
// existante AVANT de calculer la nouvelle : l'annulation finale doit alors
// retrouver 300.
test("re-trancher une décision permanente défait d'abord ses anciennes écritures : l'annulation retrouve la vraie valeur d'origine", () => {
  const db = getDb(":memory:");
  upsertAccount(db, { id: "a1", name: "CIC", iban_masked: null, balance: 0, currency: "EUR", last_synced: null });
  db.prepare(
    `INSERT INTO groups (id, account_id, name, direction, kind, monthly_amount, start_month) VALUES (1, 'a1', 'Courses', 'out', 'envelope', 300, '2026-01')`,
  ).run();
  setBudgetAmount(db, 1, "2026-01", 300); // montant de base réel

  const month = "2026-07";
  const cible = nextMonthKey(month);

  // Reproduction du corps CORRIGÉ de decideOverspend : défait d'abord les
  // écritures de la décision existante (si elle en avait), puis pose les
  // nouvelles — exactement l'ordre appliqué par applyUndo dans actions.ts.
  const decidePermanent = (newBudget: number) => {
    const existing = getOverspendDecision(db, "a1", 1, month);
    if (existing?.writes?.length) {
      const enPlaceAvant = (w: BudgetWrite) => amountAt(toDatedBudgets(listBudgetAmounts(db))[w.id] ?? [], w.month);
      const { restore, remove } = undoWrites(existing.writes, enPlaceAvant);
      for (const w of restore) setBudgetAmount(db, w.id, w.month, w.before!);
      for (const w of remove) db.prepare(`DELETE FROM budget_amounts WHERE group_id = ? AND effective_month = ?`).run(w.id, w.month);
    }
    const dated = toDatedBudgets(listBudgetAmounts(db));
    const before = amountAt(dated[1] ?? [], cible);
    const writes = envelopeWrites(1, month, newBudget, before);
    for (const w of writes) setBudgetAmount(db, w.id, w.month, w.amount);
    setOverspendDecision(db, { accountId: "a1", groupId: 1, month, decision: "permanent", decidedAt: "2026-07-29T10:00:00Z", writes });
  };
  decidePermanent(400); // première décision
  decidePermanent(450); // re-tranchée via « Modifier », sans passer par undo

  // Annulation de la décision (finale) telle qu'enregistrée.
  const existing = getOverspendDecision(db, "a1", 1, month)!;
  const enPlace = (w: BudgetWrite) => amountAt(toDatedBudgets(listBudgetAmounts(db))[w.id] ?? [], w.month);
  const { restore, remove } = undoWrites(existing.writes!, enPlace);
  for (const w of restore) setBudgetAmount(db, w.id, w.month, w.before!);
  for (const w of remove) db.prepare(`DELETE FROM budget_amounts WHERE group_id = ? AND effective_month = ?`).run(w.id, w.month);

  const dated = toDatedBudgets(listBudgetAmounts(db));
  expect(amountAt(dated[1] ?? [], cible)).toBeNull(); // aucune entrée à cible : retombe sur la base
  expect((dated[1] ?? []).find((e) => e.effectiveMonth === "2026-01")?.amount).toBe(300); // la vraie valeur d'origine est intacte
});

// La colonne `writes` est une colonne libre (TEXT), pas contrainte par le schéma :
// une valeur corrompue (écriture concurrente, migration future ratée…) ne doit
// jamais faire planter la lecture. listOverspendDecisions est appelé au
// chargement de /historique : une seule ligne corrompue ne doit pas casser toute
// la page.
test("un JSON invalide dans writes ne fait pas planter la lecture (rend null)", () => {
  const db = getDb(":memory:");
  upsertAccount(db, { id: "a1", name: "CIC", iban_masked: null, balance: 0, currency: "EUR", last_synced: null });
  setOverspendDecision(db, { accountId: "a1", groupId: 13, month: "2026-07", decision: "permanent", decidedAt: "2026-07-29T10:00:00Z", writes: null });
  db.prepare(`UPDATE overspend_decisions SET writes = ? WHERE account_id = ? AND group_id = ? AND month = ?`)
    .run("{ceci n'est pas du JSON", "a1", 13, "2026-07");
  expect(() => getOverspendDecision(db, "a1", 13, "2026-07")).not.toThrow();
  expect(getOverspendDecision(db, "a1", 13, "2026-07")?.writes).toBeNull();
  expect(() => listOverspendDecisions(db, "a1")).not.toThrow();
});
