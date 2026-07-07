import { db } from "../../db/index";
import { listAccounts } from "../../db/repositories/accounts";
import { listTransactions } from "../../db/repositories/transactions";
import { listGroups } from "../../db/repositories/groups";
import { computeForecast, type Group, type Txn } from "../../lib/forecast";
import { formatEur, monthKey } from "../../lib/money";
import { accountLabel } from "../../lib/account";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

export const dynamic = "force-dynamic";

export default function PrevisionnelPage() {
  const database = db();
  const month = monthKey(new Date().toISOString().slice(0, 10));
  const accounts = listAccounts(database);
  const allGroups = listGroups(database);
  const allTxns: Txn[] = listTransactions(database).map((t) => ({
    date: t.date,
    amount: t.amount,
    label: t.label,
    accountId: t.accountId,
  }));

  return (
    <div className="flex flex-col gap-4">
      {accounts.length === 0 && (
        <Card>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              Aucun compte. Synchronise d&apos;abord dans Réglages.
            </p>
          </CardContent>
        </Card>
      )}

      {accounts.map((a) => {
        const groups = allGroups.filter((g) => g.accountId === a.id) as Group[];
        const txns = allTxns.filter((t) => t.accountId === a.id);
        const f = computeForecast(a.id, a.balance, groups, txns, month);
        return (
          <Card key={a.id}>
            <CardHeader>
              <CardTitle>{accountLabel(a)}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-6">
                <div className="flex flex-col">
                  <span className="text-muted-foreground text-xs">Solde actuel</span>
                  <span className="text-xl font-bold">{formatEur(f.balance)}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-muted-foreground text-xs">Estimé fin de mois</span>
                  <span className="text-xl font-bold">{formatEur(f.currentEstimate)}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-muted-foreground text-xs">Estimé mois prochain</span>
                  <span className="text-xl font-bold">{formatEur(f.nextEstimate)}</span>
                </div>
              </div>

              {f.timeline.length > 0 && (
                <div className="flex flex-col gap-1">
                  <span className="text-muted-foreground text-xs">Frise du mois</span>
                  {f.timeline.map((i, idx) => (
                    <div
                      key={idx}
                      className={cn(
                        "flex justify-between text-sm",
                        i.seen && "text-muted-foreground line-through",
                      )}
                    >
                      <span>Le {i.day} · {i.name}</span>
                      <span>{formatEur(i.amount)}</span>
                    </div>
                  ))}
                </div>
              )}

              {f.groups.length > 0 && (
                <div className="flex flex-col gap-3">
                  <span className="text-muted-foreground text-xs">Groupes</span>
                  {f.groups.map((g) => {
                    const ratio = g.total > 0 ? g.spent / g.total : 0;
                    return (
                      <div key={g.id} className="flex flex-col gap-1">
                        <div className="flex justify-between text-sm">
                          <span>{g.name}</span>
                          <span>{formatEur(g.spent)} / {formatEur(g.total)}</span>
                        </div>
                        {g.direction === "out" && (
                          <Progress
                            value={Math.min(100, ratio * 100)}
                            indicatorClassName={
                              ratio >= 1 ? "bg-red-500" : ratio >= 0.8 ? "bg-amber-500" : "bg-green-500"
                            }
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
