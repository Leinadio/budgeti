import { db } from "../../db/index";
import { listAccounts } from "../../db/repositories/accounts";
import { listTransactions } from "../../db/repositories/transactions";
import { listGroups } from "../../db/repositories/groups";
import {
  computeHistory, grandTotals, monthlyOverspend, monthsWithData,
  addMonthsKey, monthRange, isMonthKey, clampMonth,
} from "../../lib/history";
import { computeForecast, type Group, type Txn } from "../../lib/forecast";
import { monthRemuneration } from "../../lib/remuneration";
import { ForecastDetailSheet } from "@/components/forecast-detail-sheet";
import { RemunerationSummary } from "@/components/remuneration-summary";
import { monthKey } from "../../lib/money";
import { accountLabel } from "../../lib/account";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CenterScroll } from "@/components/center-scroll";
import { HistoryGrid } from "@/components/history-grid";
import { MonthRangePicker } from "@/components/month-range-picker";

export const dynamic = "force-dynamic";

const MAX_MONTHS = 24; // garde-fou : nombre de colonnes affichées au maximum

export default async function HistoriquePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string | string[]; to?: string | string[] }>;
}) {
  const database = db();
  const currentMonth = monthKey(new Date().toISOString().slice(0, 10));
  const nextMonth = addMonthsKey(currentMonth, 1);
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
    incomeKind: t.incomeKind,
  }));

  if (accounts.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Aucun compte. Synchronise d&apos;abord dans Réglages.
      </p>
    );
  }

  // Bande sélectionnable : du plus ancien mois avec données (au moins le mois
  // précédent) jusqu'à 12 mois dans le futur pour les projections.
  const earliest = monthsWithData(allTxns)[0];
  const prevMonth = addMonthsKey(currentMonth, -1);
  const stripMin = earliest && earliest < prevMonth ? earliest : prevMonth;
  const stripMax = addMonthsKey(currentMonth, 12);

  // Plage retenue depuis l'URL, sinon 3 mois centrés sur le mois courant.
  const sp = await searchParams;
  const rawFrom = Array.isArray(sp.from) ? sp.from[0] : sp.from;
  const rawTo = Array.isArray(sp.to) ? sp.to[0] : sp.to;
  let from = isMonthKey(rawFrom) ? clampMonth(rawFrom, stripMin, stripMax) : prevMonth;
  let to = isMonthKey(rawTo) ? clampMonth(rawTo, stripMin, stripMax) : nextMonth;
  if (from > to) [from, to] = [to, from];
  if (monthRange(from, to).length > MAX_MONTHS) to = addMonthsKey(from, MAX_MONTHS - 1);
  const months = monthRange(from, to);

  return (
    <div className="flex flex-col gap-4">
      <MonthRangePicker min={stripMin} max={stripMax} from={from} to={to} current={currentMonth} />
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
          const sections = computeHistory(groups, txns, months, currentMonth);
          const forecast = computeForecast(a.id, a.balance, groups, txns, currentMonth);
          const remunMonths = months.map((m) => monthRemuneration(groups, txns, m));
          const overspend = monthlyOverspend(sections, months.length);
          const grand = grandTotals(sections, months.length);
          const selectGroups = groups.map((g) => ({
            id: g.id,
            name: g.name,
            lines: g.kind === "recurring" ? g.lines.map((l) => ({ id: l.id, name: l.name })) : [],
          }));

          return (
            <TabsContent key={a.id} value={a.id} className="flex flex-col gap-4">
              <RemunerationSummary months={remunMonths} />
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
                    forecast={forecast}
                    sections={sections}
                    overspend={overspend}
                    grand={grand}
                    groups={selectGroups}
                  />
                </CenterScroll>
              )}
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
