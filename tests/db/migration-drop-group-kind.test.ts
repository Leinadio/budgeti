// La nature d'un groupe (« enveloppe » / « récurrent ») disparaît de la base. Elle ne
// décidait plus rien : c'est le fait d'avoir des sous-postes qui commande le budget, le
// dépassement, la prévision et le rattachement.
//
// Ce test ouvre une VRAIE base sur disque, deux fois de suite, parce que c'est là qu'est
// le danger : migrateGroupsV2 se sert de la colonne `kind` comme marqueur de version et
// DÉTRUIT les tables des groupes quand elle ne la trouve pas. La retirer sans changer ce
// marqueur effacerait tous les groupes au redémarrage suivant — un bug qu'une base
// « :memory: », jetée après chaque test, ne montrerait jamais.
import { afterEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb } from "../../src/db/index";
import { upsertAccount } from "../../src/db/repositories/accounts";
import { insertGroup, insertLine, listGroups } from "../../src/db/repositories/groups";

let dossier: string | null = null;

function chemin(): string {
  dossier = mkdtempSync(join(tmpdir(), "budget-migration-"));
  return join(dossier, "test.db");
}

afterEach(() => {
  if (dossier) rmSync(dossier, { recursive: true, force: true });
  dossier = null;
});

// Une base garnie comme la vraie : un compte, une dépense, un sous-poste.
function baseGarnie(path: string) {
  const db = getDb(path);
  upsertAccount(db, { id: "a1", name: "CIC", iban_masked: null, balance: 0, currency: "EUR", last_synced: null });
  const gid = insertGroup(db, "a1", "Courses", "out", 400, "2026-01", null);
  insertLine(db, gid, "Boulangerie", 50);
  db.close();
}

test("retire la nature des groupes", () => {
  const path = chemin();
  baseGarnie(path);

  const db = getDb(path);
  const colonnes = (db.prepare(`PRAGMA table_info(groups)`).all() as { name: string }[]).map((c) => c.name);
  db.close();

  expect(colonnes).not.toContain("kind");
});

// Le vrai risque : rouvrir la base après la migration. Si un marqueur de version se
// trompe, les groupes partent à la poubelle sans un mot.
test("garde les groupes et leurs sous-postes en rouvrant la base", () => {
  const path = chemin();
  baseGarnie(path);

  const db = getDb(path); // deuxième passage complet des migrations
  const groupes = listGroups(db);
  db.close();

  expect(groupes.map((g) => g.name)).toEqual(["Courses"]);
  expect(groupes[0].lines.map((l) => l.name)).toEqual(["Boulangerie"]);
});

// Et une troisième fois, pour que rien ne tienne au hasard d'un seul redémarrage.
test("supporte d'être rouverte encore et encore", () => {
  const path = chemin();
  baseGarnie(path);

  getDb(path).close();
  getDb(path).close();
  const db = getDb(path);
  const groupes = listGroups(db);
  db.close();

  expect(groupes).toHaveLength(1);
});
