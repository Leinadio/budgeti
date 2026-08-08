// Teste setGroup (src/app/transactions/actions.ts) réellement appelée, base en
// mémoire (voir ./setup).
//
// Un récurrent n'est pas une destination : ses dépenses appartiennent à une de ses
// lignes, jamais au groupe lui-même. Le sélecteur ne le propose plus, mais masquer une
// option n'empêche pas d'appeler l'action directement : la règle est tenue ici.
import { beforeEach, expect, test, vi } from "vitest";
import type Database from "better-sqlite3";
import { freshDb } from "./setup";
import { setGroup, addTransaction } from "../../../src/app/transactions/actions";
import { revalidatePath } from "next/cache";
import { insertGroup, insertLine } from "../../../src/db/repositories/groups";
import { insertManualTransaction } from "../../../src/db/repositories/transactions";

let db: Database.Database;
beforeEach(() => {
  db = freshDb();
  vi.mocked(revalidatePath).mockClear();
});

const nouvelleTxn = () =>
  insertManualTransaction(db, {
    accountId: "a1", date: "2026-07-23", amount: -20, label: "PAIEMENT CB REVOLUT",
    groupId: null, lineId: null, });

const rattachement = (id: string) =>
  db.prepare(`SELECT group_id AS groupId, line_id AS lineId FROM transactions WHERE id = ?`).get(id);

test("refuse de rattacher une transaction à un récurrent sans ligne", async () => {
  const gid = insertGroup(db, "a1", "Abonnements", "out", 0, "2026-01", null);
  insertLine(db, gid, "Sosh Internet", 30.99);
  const id = nouvelleTxn();

  await setGroup(id, gid, null);

  expect(rattachement(id)).toEqual({ groupId: null, lineId: null });
});

// La règle suit les sous-postes, pas la nature déclarée : une enveloppe découpée se
// refuse au rattachement direct exactement comme un récurrent. Sans ça, une dépense
// posée sur le groupe le ferait déborder sans venir d'aucun sous-poste.
test("refuse de rattacher une transaction à une enveloppe qui a des sous-postes", async () => {
  const gid = insertGroup(db, "a1", "Courses", "out", 400, "2026-01", null);
  insertLine(db, gid, "Boulangerie", 50);
  const id = nouvelleTxn();

  await setGroup(id, gid, null);

  expect(rattachement(id)).toEqual({ groupId: null, lineId: null });
});

test("accepte le rattachement à une ligne d'un récurrent, groupe parent compris", async () => {
  const gid = insertGroup(db, "a1", "Abonnements", "out", 0, "2026-01", null);
  const lid = insertLine(db, gid, "Sosh Internet", 30.99);
  const id = nouvelleTxn();

  await setGroup(id, gid, lid);

  expect(rattachement(id)).toEqual({ groupId: gid, lineId: lid });
});

// Une enveloppe n'a pas de lignes : elle se rattache directement, comme avant.
test("accepte le rattachement direct à une enveloppe", async () => {
  const gid = insertGroup(db, "a1", "Courses", "out", 300, "2026-01", null);
  const id = nouvelleTxn();

  await setGroup(id, gid, null);

  expect(rattachement(id)).toEqual({ groupId: gid, lineId: null });
});

test("laisse toujours remettre une transaction en non catégorisée", async () => {
  const gid = insertGroup(db, "a1", "Courses", "out", 300, "2026-01", null);
  const id = nouvelleTxn();
  await setGroup(id, gid, null);

  await setGroup(id, null, null);

  expect(rattachement(id)).toEqual({ groupId: null, lineId: null });
});

// Un refus ne doit pas non plus défaire ce qui était en place : la transaction garde
// son rattachement précédent plutôt que de se retrouver nulle part par accident.
test("un refus laisse le rattachement précédent intact", async () => {
  const env = insertGroup(db, "a1", "Courses", "out", 300, "2026-01", null);
  const rec = insertGroup(db, "a1", "Abonnements", "out", 0, "2026-01", null);
  insertLine(db, rec, "Sosh Internet", 30.99);
  const id = nouvelleTxn();
  await setGroup(id, env, null);

  await setGroup(id, rec, null);

  expect(rattachement(id)).toEqual({ groupId: env, lineId: null });
});

// Une ligne qui n'appartient pas au groupe visé n'est pas une destination valide :
// l'accepter écrirait un couple (groupe, ligne) incohérent, que plus rien ne relit.
test("refuse une ligne qui n'appartient pas au groupe visé", async () => {
  const a = insertGroup(db, "a1", "Abonnements", "out", 0, "2026-01", null);
  const b = insertGroup(db, "a1", "Impôts", "out", 0, "2026-01", null);
  const ligneDeB = insertLine(db, b, "Impôts", 49);
  const id = nouvelleTxn();

  await setGroup(id, a, ligneDeB);

  expect(rattachement(id)).toEqual({ groupId: null, lineId: null });
});

// Un groupe ne vit que certains mois : une enveloppe créée pour juillet ne peut pas
// recevoir une dépense d'août. Le menu ne la propose plus, mais masquer une option
// n'empêche pas d'appeler l'action — la règle est tenue ici aussi. Un rattachement
// refusé ne défait rien : la transaction garde ce qu'elle avait.
test("refuse de rattacher une transaction à un groupe qui ne vit pas son mois", async () => {
  const juillet = insertGroup(db, "a1", "Sucreries", "out", 40, "2026-07", "2026-07");
  const id = insertManualTransaction(db, {
    accountId: "a1", date: "2026-08-03", amount: -12, label: "BOULANGERIE",
    groupId: null, lineId: null, });

  await setGroup(id, juillet, null);

  expect(rattachement(id)).toEqual({ groupId: null, lineId: null });
});

test("accepte le rattachement au mois où le groupe vit", async () => {
  const juillet = insertGroup(db, "a1", "Sucreries", "out", 40, "2026-07", "2026-07");
  const id = nouvelleTxn(); // 2026-07-23

  await setGroup(id, juillet, null);

  expect(rattachement(id)).toEqual({ groupId: juillet, lineId: null });
});

// Même règle à la saisie manuelle : le formulaire ne propose plus un groupe qui ne
// vit pas le mois de la date saisie, et l'action ne l'accepte pas davantage. La
// transaction est créée, mais non catégorisée : on ne perd pas la saisie.
test("une transaction saisie à la main ne part pas dans un groupe qui ne vit pas son mois", async () => {
  const juillet = insertGroup(db, "a1", "Sucreries", "out", 40, "2026-07", "2026-07");

  await addTransaction({
    accountId: "a1", date: "2026-08-03", direction: "out", amount: 12,
    label: "BOULANGERIE", groupId: juillet, lineId: null, });

  const row = db.prepare(`SELECT group_id AS groupId FROM transactions WHERE label = 'BOULANGERIE'`).get();
  expect(row).toEqual({ groupId: null });
});
