import { db } from "../db/index";
import { listAccounts } from "../db/repositories/accounts";
import { listGroups } from "../db/repositories/groups";
import { listTransactions } from "../db/repositories/transactions";
import { listBudgetAmounts } from "../db/repositories/budget-amounts";
import { listLineAmounts } from "../db/repositories/line-amounts";
import { listDismissedNotifications } from "../db/repositories/dismissed-notifications";
import { computeOverspends, toDatedBudgets, toDatedLineAmounts } from "./history";
import { overspendNotifications, type Notification } from "./notifications";
import { accountLabel } from "./account";
import { currentMonthKey } from "./current-month";
import type { Group, Txn } from "./forecast";

// Notifications affichées dans l'en-tête, tous comptes confondus. Vit à part de la page
// d'Historique : l'en-tête est monté par le layout et s'affiche sur toutes les pages,
// il ne peut donc pas dépendre du compte qu'une page particulière a sélectionné.
//
// Lit la base à chaque rendu, comme le reste de l'app (pas de cache) : elle est locale
// et tient dans quelques centaines de lignes.
export function appNotifications(): Notification[] {
  const database = db();
  const currentMonth = currentMonthKey(new Date());
  const groups = listGroups(database) as Group[];
  const dated = toDatedBudgets(listBudgetAmounts(database));
  const datedLines = toDatedLineAmounts(listLineAmounts(database));
  const txns: Txn[] = listTransactions(database).map((t) => ({
    id: t.id, date: t.date, amount: t.amount, label: t.label, accountId: t.accountId,
    groupId: t.groupId, lineId: t.lineId, excluded: t.excluded,
  }));
  return overspendNotifications(
    listAccounts(database).map((a) => ({
      accountId: a.id,
      accountName: accountLabel(a),
      byMonth: computeOverspends(
        groups.filter((g) => g.accountId === a.id),
        txns.filter((t) => t.accountId === a.id),
        currentMonth,
        dated,
        datedLines,
      ).byMonth,
    })),
    listDismissedNotifications(database),
    currentMonth,
  );
}
