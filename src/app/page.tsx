import { db } from "../db/index";
import { totalBalance, listAccounts } from "../db/repositories/accounts";
import { listTransactions } from "../db/repositories/transactions";
import { formatEur, monthKey } from "../lib/money";
import { accountLabel } from "../lib/account";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";

export const dynamic = "force-dynamic";

export default function Dashboard() {
  const database = db();
  const month = monthKey(new Date().toISOString().slice(0, 10));
  const balance = totalBalance(database);
  const accounts = listAccounts(database);
  const allTxns = listTransactions(database);

  const monthSpend = allTxns
    .filter((t) => monthKey(t.date) === month && t.amount < 0)
    .reduce((s, t) => s + Math.abs(t.amount), 0);

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
