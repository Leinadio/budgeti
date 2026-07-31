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
  db.prepare(
    `INSERT INTO dismissed_notifications (id, dismissed_at) VALUES (?, ?) ON CONFLICT(id) DO NOTHING`,
  ).run(id, new Date().toISOString());
}
