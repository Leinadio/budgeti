import { db } from "../../db/index";
import { listTransactions } from "../../db/repositories/transactions";
import { listGroups } from "../../db/repositories/groups";
import { listAccounts } from "../../db/repositories/accounts";
import { accountLabel } from "../../lib/account";
import { TransactionsBrowser } from "@/components/transactions-browser";

export const dynamic = "force-dynamic";

export default function TransactionsPage() {
  const database = db();
  const transactions = listTransactions(database);
  const accounts = listAccounts(database).map((a) => ({ id: a.id, label: accountLabel(a) }));
  const groups = listGroups(database).map((g) => ({
    id: g.id,
    accountId: g.accountId,
    name: g.name,
    direction: g.direction,
    kind: g.kind,
    keywords: g.kind === "envelope" ? g.keywords : g.lines.map((l) => l.keyword),
    lines: g.kind === "recurring" ? g.lines.map((l) => ({ id: l.id, name: l.name })) : [],
  }));

  return <TransactionsBrowser transactions={transactions} groups={groups} accounts={accounts} />;
}
