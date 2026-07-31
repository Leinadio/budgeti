import type { Overspend } from "./history";

// Mois précédent d'une clé « YYYY-MM ». Copie locale d'addMonthsKey pour garder ce
// module sans dépendance vers history.ts, dont il n'utilise qu'un type.
function previousMonthKey(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1, 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Une notification de l'app : un dépassement de budget, un bandeau. Elles vivent dans
// l'en-tête et non plus au-dessus du tableau de l'Historique, donc elles couvrent tous
// les comptes à la fois — d'où le nom du compte porté par chacune, sans quoi on ne
// saurait pas de quel côté regarder.
// Identité d'une notification de dépassement. Une seule définition, partagée par la
// liste des notifications et par la grille : deux façons de la composer, ce serait deux
// occasions de diverger, et un acquittement qui ne retire rien.
export function notificationId(
  accountId: string, groupId: number, lineId: number | null, month: string,
): string {
  const cible = lineId !== null ? `l${lineId}` : `g${groupId}`;
  return `${accountId}::${cible}::${month}`;
}

export type Notification = {
  id: string;
  accountName: string;
  name: string;   // ce qui a dépassé : une enveloppe, une ligne de récurrent, les non catégorisés
  month: string;  // YYYY-MM
  amount: number; // dépassement, positif
};

// Rassemble les dépassements de tous les comptes en une liste de bandeaux, du mois le
// plus récent au plus ancien : c'est le récent qui appelle une réaction, l'ancien est
// de l'histoire qu'on garde sous les yeux sans qu'elle passe devant. À mois égal, on
// suit l'ordre déjà établi par computeOverspends (par nom), compte par compte.
// `ecartees` : identités des notifications que l'utilisateur a fermées d'une croix.
// L'écart se fait sur l'IDENTITÉ (compte, cible, mois) et non sur le montant : une
// dépense qui continue fait grossir le dépassement, mais l'utilisateur a déjà dit qu'il
// ne voulait plus en entendre parler — le lui remettre sous le nez pour un centime de
// plus, c'est ne pas l'avoir écouté.
//
// `currentMonth` borne la fenêtre : on ne remonte que ce mois-là et celui d'avant. Un
// dépassement plus ancien est de l'histoire, et le rappeler indéfiniment ferait du
// bouton un compteur qui ne redescend jamais — une alerte qu'on n'écoute plus n'alerte
// plus. Absent, aucun filtre : la fonction reste éprouvable sans parler de calendrier.
export function overspendNotifications(
  parCompte: { accountId: string; accountName: string; byMonth: Record<string, Overspend[]> }[],
  ecartees: string[] = [],
  currentMonth?: string,
): Notification[] {
  const closes = new Set(ecartees);
  const depuis = currentMonth ? previousMonthKey(currentMonth) : null;
  const out: Notification[] = [];
  for (const { accountId, accountName, byMonth } of parCompte) {
    for (const [month, items] of Object.entries(byMonth)) {
      if (depuis && month < depuis) continue;
      for (const it of items) {
        // La clé porte le compte ET la nature de la cible : deux comptes peuvent avoir
        // un groupe du même identifiant, et une ligne peut partager le sien avec un
        // groupe. Sans ces deux précisions, deux bandeaux distincts se retrouveraient
        // sous la même clé et React n'en afficherait qu'un.
        // L'IDENTIFIANT du compte, pas son nom : cette clé est stockée en base comme
        // marque d'acquittement, elle doit survivre à un renommage — et c'est le seul
        // que la grille connaît quand elle demande si une case est déjà acquittée.
        const id = notificationId(accountId, it.groupId, it.lineId, month);
        if (closes.has(id)) continue;
        out.push({ id, accountName, name: it.name, month, amount: it.amount });
      }
    }
  }
  return out.sort((a, b) => (a.month === b.month ? 0 : a.month < b.month ? 1 : -1));
}

// Retire d'une liste de dépassements ceux que l'utilisateur a acquittés (« Vu »). Sert
// à la page d'Historique : filtrer À LA SOURCE fait que tout ce qui en découle suit sans
// y penser — l'étiquette sous le montant, le signal porté par un groupe récurrent, le
// bandeau du side panel. Sans ça, chaque affichage devrait se souvenir de vérifier, et
// le premier qui oublierait montrerait un dépassement déjà acquitté.
export function withoutDismissed(
  byMonth: Record<string, Overspend[]>,
  accountId: string,
  dismissed: string[],
): Record<string, Overspend[]> {
  if (dismissed.length === 0) return byMonth;
  const closes = new Set(dismissed);
  const out: Record<string, Overspend[]> = {};
  for (const [month, items] of Object.entries(byMonth)) {
    const restants = items.filter((it) => !closes.has(notificationId(accountId, it.groupId, it.lineId, month)));
    if (restants.length > 0) out[month] = restants;
  }
  return out;
}
