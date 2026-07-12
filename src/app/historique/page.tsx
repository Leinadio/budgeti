import { db } from "../../db/index";
import { listAccounts } from "../../db/repositories/accounts";
import { listTransactions } from "../../db/repositories/transactions";
import { listGroups } from "../../db/repositories/groups";
import { computeHistory, grandTotals, monthlyOverspend, monthsWithData, nextMonthKey } from "../../lib/history";
import { computeForecast, type Group, type Txn } from "../../lib/forecast";
import { ForecastDetailSheet } from "@/components/forecast-detail-sheet";
import { monthKey } from "../../lib/money";
import { accountLabel } from "../../lib/account";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CenterScroll } from "@/components/center-scroll";
import { HistoryGrid } from "@/components/history-grid";

export const dynamic = "force-dynamic";

export default function HistoriquePage() {
  const database = db();
  const currentMonth = monthKey(new Date().toISOString().slice(0, 10));
  const nextMonth = nextMonthKey(currentMonth);
  const accounts = listAccounts(database);
  const allGroups = listGroups(database);
  const allTxns: Txn[] = listTransactions(database).map((t) => ({
    id: t.id,
    date: t.date,
    amount: t.amount,
    label: t.label,
    accountId: t.accountId,
    groupId: t.groupId,
    lineId: t.lineId,
    excluded: t.excluded,
  }));

  if (accounts.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Aucun compte. Synchronise d&apos;abord dans Réglages.
      </p>
    );
  }

  return (
    <Tabs defaultValue={accounts[0].id}>
      <TabsList>
        {accounts.map((a) => (
          <TabsTrigger key={a.id} value={a.id}>
            {accountLabel(a)}
          </TabsTrigger>
        ))}
      </TabsList>
      {accounts.map((a) => {
        const groups = allGroups.filter((g) => g.accountId === a.id) as Group[];
        const txns = allTxns.filter((t) => t.accountId === a.id);
        // Toujours le mois courant et le mois prochain (projection), en plus des mois avec données.
        const months = [...new Set([...monthsWithData(txns), currentMonth, nextMonth])].sort();
        const sections = computeHistory(groups, txns, months, currentMonth);
        const forecast = computeForecast(a.id, a.balance, groups, txns, currentMonth);
        const overspend = monthlyOverspend(sections, months.length);
        const grand = grandTotals(sections, months.length);

        return (
          <TabsContent key={a.id} value={a.id} className="flex flex-col gap-4">
            <div className="flex justify-end">
              <ForecastDetailSheet label={accountLabel(a)} forecast={forecast} />
            </div>
            {sections.length === 0 ? (
              <p className="text-muted-foreground text-sm">Aucune donnée pour ce compte.</p>
            ) : (
              <CenterScroll>
                <HistoryGrid
                  months={months}
                  currentMonth={currentMonth}
                  nextMonth={nextMonth}
                  forecast={forecast}
                  sections={sections}
                  overspend={overspend}
                  grand={grand}
                />
              </CenterScroll>
            )}
          </TabsContent>
        );
      })}
    </Tabs>
  );
}
