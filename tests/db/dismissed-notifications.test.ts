// Les notifications fermées d'une croix, pour qu'elles ne reviennent pas au
// rechargement. Une table à part plutôt qu'un stockage navigateur : l'app est locale,
// tout le reste de son état vit en base, et c'est le seul endroit qui survit à un
// changement de navigateur ou à un vidage de cache.
import { expect, test } from "vitest";
import { getDb } from "../../src/db/index";
import {
  listDismissedNotifications, dismissNotification, dismissNotifications, restoreNotifications,
} from "../../src/db/repositories/dismissed-notifications";

const freshDb = () => getDb(":memory:");

// « Tout marquer comme vu » ferme la liste entière d'un geste. En une seule écriture :
// à moitié fait, le panneau garderait des bandeaux en couleur alors que l'utilisateur
// a dit qu'il avait tout vu.
test("ferme d'un coup toutes les notifications données", () => {
  const db = freshDb();

  dismissNotifications(db, ["CIC::g1::2026-07", "CIC::g2::2026-07"]);

  expect(listDismissedNotifications(db).sort()).toEqual(["CIC::g1::2026-07", "CIC::g2::2026-07"]);
});

// Un acquittement se reprend : cliquer « Vu » n'est pas une porte qui claque. Rien
// n'était détruit — la marque partie, le dépassement redevient à voir.
test("rétablit une notification acquittée, et elle seule", () => {
  const db = freshDb();
  dismissNotifications(db, ["CIC::g1::2026-07", "CIC::g2::2026-07"]);

  restoreNotifications(db, ["CIC::g1::2026-07"]);

  expect(listDismissedNotifications(db)).toEqual(["CIC::g2::2026-07"]);
});

test("rétablir supporte une liste vide et une identité jamais acquittée", () => {
  const db = freshDb();
  dismissNotification(db, "CIC::g1::2026-07");

  restoreNotifications(db, []);
  restoreNotifications(db, ["CIC::jamais-vue::2026-07"]);

  expect(listDismissedNotifications(db)).toEqual(["CIC::g1::2026-07"]);
});

test("tout fermer supporte une liste vide et des identités déjà fermées", () => {
  const db = freshDb();
  dismissNotification(db, "CIC::g1::2026-07");

  dismissNotifications(db, []);
  dismissNotifications(db, ["CIC::g1::2026-07"]);

  expect(listDismissedNotifications(db)).toEqual(["CIC::g1::2026-07"]);
});

test("la table existe sur une base neuve", () => {
  expect(listDismissedNotifications(freshDb())).toEqual([]);
});

test("une notification fermée est retenue", () => {
  const db = freshDb();

  dismissNotification(db, "CIC::g1::2026-07");

  expect(listDismissedNotifications(db)).toEqual(["CIC::g1::2026-07"]);
});

// Le même clic peut partir deux fois (double-clic, réseau lent) : la seconde ne doit
// pas faire échouer l'action ni doubler la ligne.
test("fermer deux fois la même notification ne double rien", () => {
  const db = freshDb();

  dismissNotification(db, "CIC::g1::2026-07");
  dismissNotification(db, "CIC::g1::2026-07");

  expect(listDismissedNotifications(db)).toEqual(["CIC::g1::2026-07"]);
});

test("retient plusieurs notifications distinctes", () => {
  const db = freshDb();

  dismissNotification(db, "CIC::g1::2026-07");
  dismissNotification(db, "CIC::g2::2026-07");
  dismissNotification(db, "CIC::g1::2026-06");

  expect(listDismissedNotifications(db).sort()).toEqual([
    "CIC::g1::2026-06",
    "CIC::g1::2026-07",
    "CIC::g2::2026-07",
  ]);
});
