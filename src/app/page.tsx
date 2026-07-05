import { db } from "../db/index";
import { totalBalance, listAccounts } from "../db/repositories/accounts";
import { listTransactions } from "../db/repositories/transactions";
import { listBudgets } from "../db/repositories/budgets";
import { getSetting } from "../db/repositories/settings";
import { computeEnvelopes } from "../lib/budget";
import { buildAlerts } from "../lib/alerts";
import { formatEur, monthKey } from "../lib/money";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";

export const dynamic = "force-dynamic";

export default function Dashboard() {
  const database = db();
  const month = monthKey(new Date().toISOString().slice(0, 10));
  const balance = totalBalance(database);
  const accounts = listAccounts(database);
  const allTxns = listTransactions(database);
  const txns = allTxns.map((t) => ({ date: t.date, amount: t.amount, category: t.category }));
  const budgets = listBudgets(database).map((b) => ({ category: b.category, month: b.month, limit: b.limit }));
  const envelopes = computeEnvelopes(txns, budgets, month);
  const threshold = Number.parseFloat(getSetting(database, "balance_threshold") ?? "0");
  const alerts = buildAlerts(envelopes, balance, threshold);

  const monthSpend = txns
    .filter((t) => monthKey(t.date) === month && t.amount < 0)
    .reduce((s, t) => s + Math.abs(t.amount), 0);

  const accountLabel = (a: (typeof accounts)[number]) =>
    a.iban_masked ? `${a.name} ${a.iban_masked}` : a.name;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-1">
          <div className="text-3xl font-bold">{formatEur(balance)}</div>
          <div className="text-muted-foreground text-sm">
            Solde total ({accounts.length} compte{accounts.length > 1 ? "s" : ""})
          </div>
          <div className="text-muted-foreground text-sm">
            Dépensé ce mois-ci : {formatEur(monthSpend)}
          </div>
        </CardContent>
      </Card>

      {alerts.map((a, i) => (
        <div
          key={i}
          className={cn(
            "rounded-lg px-4 py-3 text-sm",
            a.level === "danger"
              ? "bg-destructive/10 text-destructive"
              : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
          )}
        >
          {a.message}
        </div>
      ))}

      <Card>
        <CardHeader>
          <CardTitle>Enveloppes ({month})</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {envelopes.length === 0 && (
            <p className="text-muted-foreground text-sm">Aucun budget défini. Va dans « Budgets ».</p>
          )}
          {envelopes.map((e) => (
            <div key={e.category} className="flex flex-col gap-1">
              <div className="flex justify-between text-sm">
                <span>{e.category}</span>
                <span>
                  {formatEur(e.spent)} / {formatEur(e.limit)}
                </span>
              </div>
              <Progress
                value={Math.min(100, e.ratio * 100)}
                indicatorClassName={
                  e.ratio >= 1 ? "bg-red-500" : e.ratio >= 0.8 ? "bg-amber-500" : "bg-green-500"
                }
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {accounts.map((a) => {
        const accountTxns = allTxns.filter((t) => t.accountId === a.id).slice(0, 8);
        return (
          <Card key={a.id}>
            <CardHeader className="flex-row items-baseline justify-between">
              <CardTitle>{accountLabel(a)}</CardTitle>
              <span className="text-xl font-bold">{formatEur(a.balance)}</span>
            </CardHeader>
            <CardContent>
              <Table>
                <TableBody>
                  {accountTxns.length === 0 && (
                    <TableRow>
                      <TableCell className="text-muted-foreground">Aucune transaction.</TableCell>
                    </TableRow>
                  )}
                  {accountTxns.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="text-muted-foreground">{t.date}</TableCell>
                      <TableCell>{t.label}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {t.category ?? "À catégoriser"}
                      </TableCell>
                      <TableCell className="text-right font-medium">{formatEur(t.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
