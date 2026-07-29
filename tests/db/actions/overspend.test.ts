// Teste les actions serveur decideOverspend et undoOverspendDecision
// (src/app/historique/actions.ts) réellement appelées, base en mémoire (voir
// ./setup). Les fonctions pures qu'elles composent (envelopeWrites, lineWrites,
// undoWrites, canDecidePermanent...) sont déjà couvertes dans tests/lib/ : ici on
// vérifie ce que l'action ajoute par-dessus — choix de branche, capture du
// montant précédent, défaite d'une décision antérieure, garde-fous.
import { beforeEach, expect, test, vi } from "vitest";
import type Database from "better-sqlite3";
import { freshDb } from "./setup";
import { decideOverspend, undoOverspendDecision } from "../../../src/app/historique/actions";
import { revalidatePath } from "next/cache";
import { insertEnvelopeGroup, insertRecurringGroup, insertLine } from "../../../src/db/repositories/groups";
import { listBudgetAmounts, setBudgetAmount } from "../../../src/db/repositories/budget-amounts";
import { listLineAmounts, setLineAmount } from "../../../src/db/repositories/line-amounts";
import { getOverspendDecision } from "../../../src/db/repositories/overspend-decisions";
import { nextMonthKey, toDatedLineAmounts, lineAmountInForce } from "../../../src/lib/history";

let db: Database.Database;
beforeEach(() => {
  db = freshDb();
  vi.mocked(revalidatePath).mockClear();
});

test("une décision permanente sur une enveloppe relève le budget au mois qui suit le dépassement, pas un mois lié à aujourd'hui", async () => {
  // Dépassement ancien (bien avant la date courante du test) : si le code se
  // trompait et relevait au mois suivant *aujourd'hui* plutôt que suivant le
  // mois du dépassement, l'écriture atterrirait ailleurs qu'en mars 2025.
  const gid = insertEnvelopeGroup(db, "a1", "Courses", "out", 300, null, "2025-01", null);
  setBudgetAmount(db, gid, "2025-01", 300);

  const ok = await decideOverspend("a1", gid, "2025-02", "permanent", 400);

  expect(ok).toBe(true);
  expect(listBudgetAmounts(db).filter((b) => b.groupId === gid)).toEqual([
    { groupId: gid, effectiveMonth: "2025-01", amount: 300 },
    { groupId: gid, effectiveMonth: "2025-03", amount: 400 }, // mois qui SUIT 2025-02, pas 2025-01
  ]);
});

test("une décision exceptionnelle n'écrit aucun montant, seule la décision est enregistrée", async () => {
  const gid = insertEnvelopeGroup(db, "a1", "Courses", "out", 300, null, "2026-01", null);
  setBudgetAmount(db, gid, "2026-01", 300);

  const ok = await decideOverspend("a1", gid, "2026-03", "exceptional");

  expect(ok).toBe(true);
  expect(listBudgetAmounts(db).filter((b) => b.groupId === gid)).toEqual([{ groupId: gid, effectiveMonth: "2026-01", amount: 300 }]);
  expect(getOverspendDecision(db, "a1", gid, "2026-03")).toMatchObject({ decision: "exceptional", writes: null });
});

test("décision permanente sur un récurrent : chaque ligne au montant valide est relevée, le groupe ne reçoit aucune entrée", async () => {
  const gid = insertRecurringGroup(db, "a1", "Abonnements", "out", null, "2026-01", null);
  const spotify = insertLine(db, gid, "Spotify", 10, 3);
  setLineAmount(db, spotify, "2026-01", 10);
  const netflix = insertLine(db, gid, "Netflix", 15, 8);
  setLineAmount(db, netflix, "2026-01", 15);

  const ok = await decideOverspend("a1", gid, "2026-06", "permanent", undefined, [
    { lineId: spotify, amount: 18 },
    { lineId: netflix, amount: 0 }, // invalide (isValidLineAmount exige > 0) : ne doit pas être écrite
  ]);

  expect(ok).toBe(true);
  const cible = nextMonthKey("2026-06");
  expect(listLineAmounts(db).filter((l) => l.effectiveMonth === cible)).toEqual([{ lineId: spotify, effectiveMonth: cible, amount: 18 }]);
  expect(listBudgetAmounts(db).filter((b) => b.groupId === gid)).toEqual([]); // le groupe récurrent ne reçoit jamais d'entrée
});

test("un récurrent sans montants de lignes refuse la décision : rien n'est écrit, aucune décision enregistrée", async () => {
  const gid = insertRecurringGroup(db, "a1", "Abonnements", "out", null, "2026-01", null);
  const lid = insertLine(db, gid, "Spotify", 10, 3);
  setLineAmount(db, lid, "2026-01", 10);

  const ok = await decideOverspend("a1", gid, "2026-06", "permanent", 200); // newBudget envoyé mais sans lineAmounts

  expect(ok).toBe(false);
  expect(listBudgetAmounts(db).filter((b) => b.groupId === gid)).toEqual([]);
  expect(listLineAmounts(db).filter((l) => l.lineId === lid)).toEqual([{ lineId: lid, effectiveMonth: "2026-01", amount: 10 }]);
  expect(getOverspendDecision(db, "a1", gid, "2026-06")).toBeNull();
});

test("un récurrent dont tous les montants de lignes sont invalides refuse la décision, comme s'il n'y en avait aucune", async () => {
  const gid = insertRecurringGroup(db, "a1", "Abonnements", "out", null, "2026-01", null);
  const lid = insertLine(db, gid, "Spotify", 10, 3);
  setLineAmount(db, lid, "2026-01", 10);

  const ok = await decideOverspend("a1", gid, "2026-06", "permanent", undefined, [{ lineId: lid, amount: -5 }]);

  expect(ok).toBe(false);
  expect(listLineAmounts(db).filter((l) => l.lineId === lid)).toEqual([{ lineId: lid, effectiveMonth: "2026-01", amount: 10 }]);
  expect(getOverspendDecision(db, "a1", gid, "2026-06")).toBeNull();
});

test("re-trancher un dépassement déjà décidé défait d'abord les écritures de la décision précédente : l'annulation finale retrouve la vraie valeur d'origine", async () => {
  const gid = insertEnvelopeGroup(db, "a1", "Courses", "out", 300, null, "2026-01", null);
  setBudgetAmount(db, gid, "2026-01", 300); // valeur de départ réelle

  const month = "2026-07";
  const cible = nextMonthKey(month); // 2026-08

  await decideOverspend("a1", gid, month, "permanent", 400); // première décision
  await decideOverspend("a1", gid, month, "permanent", 450); // re-tranchée (le side panel ne passe pas par undo)

  expect(listBudgetAmounts(db).find((b) => b.groupId === gid && b.effectiveMonth === cible)?.amount).toBe(450);

  await undoOverspendDecision("a1", gid, month);

  const restant = listBudgetAmounts(db).filter((b) => b.groupId === gid);
  expect(restant.find((b) => b.effectiveMonth === cible)).toBeUndefined(); // aucune trace de 400 ni 450
  expect(restant.find((b) => b.effectiveMonth === "2026-01")?.amount).toBe(300); // la vraie valeur d'origine est intacte
});

test("annuler une décision sans montant antérieur supprime l'entrée posée", async () => {
  const gid = insertEnvelopeGroup(db, "a1", "Courses", "out", 300, null, "2026-01", null);
  setBudgetAmount(db, gid, "2026-01", 300);
  const month = "2026-05";
  const cible = nextMonthKey(month);
  await decideOverspend("a1", gid, month, "permanent", 400);
  expect(listBudgetAmounts(db).some((b) => b.groupId === gid && b.effectiveMonth === cible)).toBe(true);

  await undoOverspendDecision("a1", gid, month);

  expect(listBudgetAmounts(db).some((b) => b.groupId === gid && b.effectiveMonth === cible)).toBe(false);
  expect(getOverspendDecision(db, "a1", gid, month)).toBeNull();
});

test("annuler une décision posée par-dessus un montant antérieur restaure ce montant", async () => {
  const gid = insertEnvelopeGroup(db, "a1", "Courses", "out", 300, null, "2026-01", null);
  setBudgetAmount(db, gid, "2026-01", 300);
  const month = "2026-05";
  const cible = nextMonthKey(month); // 2026-06
  setBudgetAmount(db, gid, cible, 350); // un changement de budget déjà prévu à la cible, avant la décision

  await decideOverspend("a1", gid, month, "permanent", 500);
  expect(listBudgetAmounts(db).find((b) => b.groupId === gid && b.effectiveMonth === cible)?.amount).toBe(500);

  await undoOverspendDecision("a1", gid, month);

  expect(listBudgetAmounts(db).find((b) => b.groupId === gid && b.effectiveMonth === cible)?.amount).toBe(350);
});

test("annuler une décision laisse intacte une entrée modifiée à la main depuis", async () => {
  const gid = insertEnvelopeGroup(db, "a1", "Courses", "out", 300, null, "2026-01", null);
  setBudgetAmount(db, gid, "2026-01", 300);
  const month = "2026-05";
  const cible = nextMonthKey(month);
  await decideOverspend("a1", gid, month, "permanent", 400);

  setBudgetAmount(db, gid, cible, 999); // modification manuelle depuis la décision

  await undoOverspendDecision("a1", gid, month);

  expect(listBudgetAmounts(db).find((b) => b.groupId === gid && b.effectiveMonth === cible)?.amount).toBe(999);
  expect(getOverspendDecision(db, "a1", gid, month)).toBeNull(); // la décision elle-même redevient « à trancher »
});

test("annuler une décision permanente sur un récurrent restaure la ligne (même branche « line » que pour une enveloppe)", async () => {
  const gid = insertRecurringGroup(db, "a1", "Abonnements", "out", null, "2026-01", null);
  const lid = insertLine(db, gid, "Assurance voiture", 81.84, 5);
  setLineAmount(db, lid, "2026-01", 81.84);
  const month = "2026-06";
  const cible = nextMonthKey(month);

  await decideOverspend("a1", gid, month, "permanent", undefined, [{ lineId: lid, amount: 151.84 }]);
  expect(lineAmountInForce(lid, cible, toDatedLineAmounts(listLineAmounts(db)))).toBeCloseTo(151.84, 2);

  await undoOverspendDecision("a1", gid, month);

  // Aucun montant antérieur à la cible : l'entrée posée est supprimée, la ligne
  // retombe sur son montant de départ — preuve que undoOverspendDecision emprunte
  // bien la branche `target === "line"` de applyUndo, pas seulement celle des groupes.
  expect(lineAmountInForce(lid, cible, toDatedLineAmounts(listLineAmounts(db)))).toBeCloseTo(81.84, 2);
  expect(getOverspendDecision(db, "a1", gid, month)).toBeNull();
});
