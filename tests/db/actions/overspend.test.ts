// Teste les actions serveur decideOverspend et undoOverspendDecision
// (src/app/historique/actions.ts) réellement appelées, base en mémoire (voir
// ./setup). Les fonctions pures qu'elles composent (envelopeWrites, lineWrites,
// undoWrites, canDecidePermanent...) sont déjà couvertes dans tests/lib/ : ici on
// vérifie ce que l'action ajoute par-dessus — choix de branche, capture du
// montant précédent, défaite d'une décision antérieure, garde-fous.
import { beforeEach, expect, test, vi } from "vitest";
import type Database from "better-sqlite3";
import { freshDb, at } from "./setup";
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

// Chaque test place l'horloge sur le mois du dépassement : depuis le verrou, c'est
// le seul mois où une décision est encore recevable (voir month-lock.test.ts pour
// les refus). Un dépassement ancien décidé longtemps après n'est plus une situation
// que ces actions acceptent — la garantie « on relève au mois qui suit le
// dépassement, pas au mois qui suit aujourd'hui » se lit maintenant dans les tests
// unitaires de nextMonthKey et envelopeWrites, où les deux mois peuvent différer.
test("une décision permanente sur une enveloppe relève le budget au mois qui suit le dépassement", async () => {
  const gid = insertEnvelopeGroup(db, "a1", "Courses", "out", 300, null, "2025-01", null);
  setBudgetAmount(db, gid, "2025-01", 300);
  at("2025-02");

  const ok = await decideOverspend("a1", gid, null, "2025-02", "permanent", 400);

  expect(ok).toBe(true);
  expect(listBudgetAmounts(db).filter((b) => b.groupId === gid)).toEqual([
    { groupId: gid, effectiveMonth: "2025-01", amount: 300, scope: "ongoing" },
    { groupId: gid, effectiveMonth: "2025-03", amount: 400, scope: "ongoing" }, // mois qui SUIT 2025-02, pas 2025-01
  ]);
});

test("une décision exceptionnelle n'écrit aucun montant, seule la décision est enregistrée", async () => {
  const gid = insertEnvelopeGroup(db, "a1", "Courses", "out", 300, null, "2026-01", null);
  setBudgetAmount(db, gid, "2026-01", 300);
  at("2026-03");

  const ok = await decideOverspend("a1", gid, null, "2026-03", "exceptional");

  expect(ok).toBe(true);
  expect(listBudgetAmounts(db).filter((b) => b.groupId === gid)).toEqual([{ groupId: gid, effectiveMonth: "2026-01", amount: 300, scope: "ongoing" }]);
  expect(getOverspendDecision(db, "a1", gid, null, "2026-03")).toMatchObject({ decision: "exceptional", writes: null });
});

// Un dépassement de récurrent est celui d'une de ses LIGNES : c'est elle qu'on tranche,
// et c'est son montant à elle qui est relevé. Le groupe ne reçoit jamais d'entrée — il
// n'a pas de montant à lui, son budget est la somme de ses lignes.
test("décision permanente sur une ligne de récurrent : seule cette ligne est relevée", async () => {
  const gid = insertRecurringGroup(db, "a1", "Abonnements", "out", null, "2026-01", null);
  const spotify = insertLine(db, gid, "Spotify", 10, 3);
  setLineAmount(db, spotify, "2026-01", 10);
  const netflix = insertLine(db, gid, "Netflix", 15, 8);
  setLineAmount(db, netflix, "2026-01", 15);
  at("2026-06");

  const ok = await decideOverspend("a1", gid, spotify, "2026-06", "permanent", 18);

  expect(ok).toBe(true);
  const cible = nextMonthKey("2026-06");
  expect(listLineAmounts(db).filter((l) => l.effectiveMonth === cible)).toEqual([{ lineId: spotify, effectiveMonth: cible, amount: 18, scope: "ongoing" }]);
  expect(listBudgetAmounts(db).filter((b) => b.groupId === gid)).toEqual([]); // le groupe récurrent ne reçoit jamais d'entrée
});

// Le groupe d'un récurrent ne porte aucun montant : le trancher ferait taire une alerte
// sans rien relever. C'est refusé, plutôt que d'enregistrer une décision creuse.
test("le groupe d'un récurrent ne se tranche pas", async () => {
  const gid = insertRecurringGroup(db, "a1", "Abonnements", "out", null, "2026-01", null);
  const lid = insertLine(db, gid, "Spotify", 10, 3);
  setLineAmount(db, lid, "2026-01", 10);
  at("2026-06");

  expect(await decideOverspend("a1", gid, null, "2026-06", "permanent", 200)).toBe(false);
  expect(await decideOverspend("a1", gid, null, "2026-06", "exceptional")).toBe(false);
  expect(getOverspendDecision(db, "a1", gid, null, "2026-06")).toBeNull();
});

// Une décision « permanent » qui ne relève rien laisserait le dépassement revenir à
// l'identique le mois suivant, l'alerte en moins.
test("une décision permanente sans montant valide est refusée, rien n'est écrit", async () => {
  const gid = insertRecurringGroup(db, "a1", "Abonnements", "out", null, "2026-01", null);
  const lid = insertLine(db, gid, "Spotify", 10, 3);
  setLineAmount(db, lid, "2026-01", 10);
  at("2026-06");

  expect(await decideOverspend("a1", gid, lid, "2026-06", "permanent")).toBe(false);
  expect(await decideOverspend("a1", gid, lid, "2026-06", "permanent", -5)).toBe(false);
  expect(await decideOverspend("a1", gid, lid, "2026-06", "permanent", 0)).toBe(false);

  expect(listLineAmounts(db).filter((l) => l.lineId === lid)).toEqual([{ lineId: lid, effectiveMonth: "2026-01", amount: 10, scope: "ongoing" }]);
  expect(getOverspendDecision(db, "a1", gid, lid, "2026-06")).toBeNull();
});

test("re-trancher un dépassement déjà décidé défait d'abord les écritures de la décision précédente : l'annulation finale retrouve la vraie valeur d'origine", async () => {
  const gid = insertEnvelopeGroup(db, "a1", "Courses", "out", 300, null, "2026-01", null);
  setBudgetAmount(db, gid, "2026-01", 300); // valeur de départ réelle

  const month = "2026-07";
  const cible = nextMonthKey(month); // 2026-08
  at(month);

  await decideOverspend("a1", gid, null, month, "permanent", 400); // première décision
  await decideOverspend("a1", gid, null, month, "permanent", 450); // re-tranchée (le side panel ne passe pas par undo)

  expect(listBudgetAmounts(db).find((b) => b.groupId === gid && b.effectiveMonth === cible)?.amount).toBe(450);

  await undoOverspendDecision("a1", gid, null, month);

  const restant = listBudgetAmounts(db).filter((b) => b.groupId === gid);
  expect(restant.find((b) => b.effectiveMonth === cible)).toBeUndefined(); // aucune trace de 400 ni 450
  expect(restant.find((b) => b.effectiveMonth === "2026-01")?.amount).toBe(300); // la vraie valeur d'origine est intacte
});

test("annuler une décision sans montant antérieur supprime l'entrée posée", async () => {
  const gid = insertEnvelopeGroup(db, "a1", "Courses", "out", 300, null, "2026-01", null);
  setBudgetAmount(db, gid, "2026-01", 300);
  const month = "2026-05";
  const cible = nextMonthKey(month);
  at(month);
  await decideOverspend("a1", gid, null, month, "permanent", 400);
  expect(listBudgetAmounts(db).some((b) => b.groupId === gid && b.effectiveMonth === cible)).toBe(true);

  await undoOverspendDecision("a1", gid, null, month);

  expect(listBudgetAmounts(db).some((b) => b.groupId === gid && b.effectiveMonth === cible)).toBe(false);
  expect(getOverspendDecision(db, "a1", gid, null, month)).toBeNull();
});

test("annuler une décision posée par-dessus un montant antérieur restaure ce montant", async () => {
  const gid = insertEnvelopeGroup(db, "a1", "Courses", "out", 300, null, "2026-01", null);
  setBudgetAmount(db, gid, "2026-01", 300);
  const month = "2026-05";
  const cible = nextMonthKey(month); // 2026-06
  at(month);
  setBudgetAmount(db, gid, cible, 350); // un changement de budget déjà prévu à la cible, avant la décision

  await decideOverspend("a1", gid, null, month, "permanent", 500);
  expect(listBudgetAmounts(db).find((b) => b.groupId === gid && b.effectiveMonth === cible)?.amount).toBe(500);

  await undoOverspendDecision("a1", gid, null, month);

  expect(listBudgetAmounts(db).find((b) => b.groupId === gid && b.effectiveMonth === cible)?.amount).toBe(350);
});

test("annuler une décision laisse intacte une entrée modifiée à la main depuis", async () => {
  const gid = insertEnvelopeGroup(db, "a1", "Courses", "out", 300, null, "2026-01", null);
  setBudgetAmount(db, gid, "2026-01", 300);
  const month = "2026-05";
  const cible = nextMonthKey(month);
  at(month);
  await decideOverspend("a1", gid, null, month, "permanent", 400);

  setBudgetAmount(db, gid, cible, 999); // modification manuelle depuis la décision

  await undoOverspendDecision("a1", gid, null, month);

  expect(listBudgetAmounts(db).find((b) => b.groupId === gid && b.effectiveMonth === cible)?.amount).toBe(999);
  expect(getOverspendDecision(db, "a1", gid, null, month)).toBeNull(); // la décision elle-même redevient « à trancher »
});

test("annuler une décision permanente sur une ligne restaure son montant (branche « line » de applyUndo)", async () => {
  const gid = insertRecurringGroup(db, "a1", "Abonnements", "out", null, "2026-01", null);
  const lid = insertLine(db, gid, "Assurance voiture", 81.84, 5);
  setLineAmount(db, lid, "2026-01", 81.84);
  const month = "2026-06";
  const cible = nextMonthKey(month);
  at(month);

  await decideOverspend("a1", gid, lid, month, "permanent", 151.84);
  expect(lineAmountInForce(lid, cible, toDatedLineAmounts(listLineAmounts(db)))).toBeCloseTo(151.84, 2);

  await undoOverspendDecision("a1", gid, lid, month);

  // Aucun montant antérieur à la cible : l'entrée posée est supprimée, la ligne
  // retombe sur son montant de départ — preuve que undoOverspendDecision emprunte
  // bien la branche `target === "line"` de applyUndo, pas seulement celle des groupes.
  expect(lineAmountInForce(lid, cible, toDatedLineAmounts(listLineAmounts(db)))).toBeCloseTo(81.84, 2);
  expect(getOverspendDecision(db, "a1", gid, lid, month)).toBeNull();
});
