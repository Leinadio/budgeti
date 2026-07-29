import { vi } from "vitest";
import type Database from "better-sqlite3";
import { getDb } from "../../../src/db/index";
import { upsertAccount } from "../../../src/db/repositories/accounts";

// Montage commun à tous les tests d'actions serveur (src/app/historique/actions.ts) :
// substitue une base en mémoire au singleton `db()`, et neutralise `revalidatePath`
// (sans objet requête, hors du sens de Next.js en dehors d'une vraie navigation).
// Ce fichier ne matche pas `tests/**/*.test.ts` : Vitest ne l'exécute jamais comme
// suite à lui seul, seulement importé par les fichiers qui en ont besoin. Vivre à cet
// unique endroit évite de recopier `vi.mock` (et son piège de hoisting) dans chaque
// fichier de test — voir la note ci-dessous sur l'ordre d'import.
//
// `ctx` est l'objet stable capturé par la factory de vi.mock : celle-ci s'exécute une
// seule fois, au chargement du module ; c'est pourquoi la base courante est un champ
// réassigné (ctx.db = ...) à chaque test, jamais une variable module-level qu'on
// réassignerait directement (la factory garderait alors sa valeur `null` d'origine).
export const ctx: { db: Database.Database | null } = { db: null };

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../../../src/db/index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/db/index")>();
  return { ...actual, db: () => ctx.db! };
});

// Base en mémoire fraîche, migrations appliquées comme en production (via getDb,
// réexporté intact par le mock ci-dessus grâce à importOriginal), avec un compte
// "a1" déjà présent — préalable de toutes les actions couvertes ici. À appeler dans
// un beforeEach de chaque fichier de test : chaque test démarre sur une base neuve,
// aucun état ne fuit d'un test à l'autre.
//
// IMPORTANT pour tout fichier qui importe ce module : il doit être importé AVANT
// `src/app/historique/actions.ts` (ou tout module import ant `src/db/index`), pour
// que `vi.mock` soit enregistré avant que ces modules soient chargés. Node/Vitest
// évalue les imports d'un fichier dans l'ordre où ils apparaissent : mettre cet
// import en premier suffit, sans avoir besoin d'un vi.mock recopié dans chaque
// fichier (qui bénéficierait, lui, du hoisting automatique de Vitest — mais c'est
// justement ce qu'on évite de dupliquer).
export function freshDb(): Database.Database {
  const database = getDb(":memory:");
  upsertAccount(database, { id: "a1", name: "CIC", iban_masked: null, balance: 0, currency: "EUR", last_synced: null });
  ctx.db = database;
  return database;
}
