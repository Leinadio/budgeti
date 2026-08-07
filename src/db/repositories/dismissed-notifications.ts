import type Database from "better-sqlite3";

// Notifications que l'utilisateur a fermées d'une croix. L'identité est celle que
// construit overspendNotifications : « compte::cible::mois ». Une table plutôt qu'un
// stockage navigateur — l'app est locale, tout son état vit en base, et c'est le seul
// endroit qui survit à un changement de navigateur ou à un vidage de cache.
export function listDismissedNotifications(db: Database.Database): string[] {
  return (db.prepare(`SELECT id FROM dismissed_notifications`).all() as { id: string }[]).map((r) => r.id);
}

// Idempotent : le même clic peut partir deux fois (double-clic, réseau lent), la
// seconde ne doit ni échouer ni doubler la ligne.
export function dismissNotification(db: Database.Database, id: string): void {
  dismissNotifications(db, [id]);
}

// « Tout marquer comme vu » : la liste entière d'un geste, dans une seule transaction.
// À moitié faite, elle laisserait des bandeaux en couleur alors que l'utilisateur vient
// de dire qu'il avait tout vu. Idempotente comme sa sœur, et sans objet sur une liste
// vide (le bouton est alors éteint, mais l'action ne doit pas en dépendre).
export function dismissNotifications(db: Database.Database, ids: string[]): void {
  if (ids.length === 0) return;
  const at = new Date().toISOString();
  const stmt = db.prepare(
    `INSERT INTO dismissed_notifications (id, dismissed_at) VALUES (?, ?) ON CONFLICT(id) DO NOTHING`,
  );
  db.transaction(() => {
    for (const id of ids) if (id) stmt.run(id, at);
  })();
}

// Le geste inverse : la marque part, le dépassement redevient à voir. Cliquer « Vu »
// n'est pas une porte qui claque — rien n'avait été détruit, seulement marqué.
// Silencieuse sur une identité jamais acquittée : il n'y a rien à défaire.
export function restoreNotifications(db: Database.Database, ids: string[]): void {
  if (ids.length === 0) return;
  const stmt = db.prepare(`DELETE FROM dismissed_notifications WHERE id = ?`);
  db.transaction(() => {
    for (const id of ids) if (id) stmt.run(id);
  })();
}
