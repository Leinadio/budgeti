import { db } from "../../db/index";
import { listAccounts } from "../../db/repositories/accounts";
import { listTransactions } from "../../db/repositories/transactions";
import { listGroups } from "../../db/repositories/groups";
import {
  computeHistory, grandTotals, monthlyOverspend, monthsWithData, computeSolde,
  computePlannedSoldes, addMonthsKey, monthRange, isMonthKey, clampMonth,
} from "../../lib/history";
import { computeForecast, type Group, type Txn } from "../../lib/forecast";
import { monthRemuneration } from "../../lib/remuneration";
import { ForecastDetailSheet } from "@/components/forecast-detail-sheet";
import { RemunerationSummary } from "@/components/remuneration-summary";
import { monthKey } from "../../lib/money";
import { accountLabel } from "../../lib/account";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { HistoryWithDetail } from "@/components/history-with-detail";
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

  // Bornes communes : la frise monte jusqu'à 12 mois dans le futur (projections).
  // La borne basse est propre à chaque compte (premier mois avec des transactions
  // de ce compte) : pas de mois vides sélectionnables.
  const prevMonth = addMonthsKey(currentMonth, -1);
  const stripMax = addMonthsKey(currentMonth, 12);

  // Plage demandée dans l'URL (clampée par compte plus bas), sinon 3 mois à partir
  // du mois courant (le mois courant en première colonne, puis deux mois de projection).
  const sp = await searchParams;
  const rawFrom = Array.isArray(sp.from) ? sp.from[0] : sp.from;
  const rawTo = Array.isArray(sp.to) ? sp.to[0] : sp.to;

  return (
    <div className="flex flex-col gap-4">
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
          // Frise du compte : du premier mois avec des transactions de CE compte (au
          // moins le mois précédent) jusqu'à stripMax. La plage de l'URL est clampée
          // sur ces bornes : un mois sans montants n'est ni sélectionnable ni affiché.
          const earliest = monthsWithData(txns)[0];
          const stripMin = earliest && earliest < prevMonth ? earliest : prevMonth;
          let from = isMonthKey(rawFrom) ? clampMonth(rawFrom, stripMin, stripMax) : currentMonth;
          let to = isMonthKey(rawTo) ? clampMonth(rawTo, stripMin, stripMax) : addMonthsKey(currentMonth, 2);
          if (from > to) [from, to] = [to, from];
          if (monthRange(from, to).length > MAX_MONTHS) to = addMonthsKey(from, MAX_MONTHS - 1);
          const months = monthRange(from, to);
          const sections = computeHistory(groups, txns, months, currentMonth);
          const forecast = computeForecast(a.id, a.balance, groups, txns, currentMonth);
          const remunMonths = months.map((m) => monthRemuneration(groups, txns, m));
          const overspend = monthlyOverspend(sections, months.length);
          const grand = grandTotals(sections, months.length);
          const solde = computeSolde(sections, months, currentMonth, a.balance);
          const planned = computePlannedSoldes(sections, months, currentMonth, solde.openings);
          const selectGroups = groups.map((g) => ({
            id: g.id,
            name: g.name,
            lines: g.kind === "recurring" ? g.lines.map((l) => ({ id: l.id, name: l.name })) : [],
          }));

          return (
            <TabsContent key={a.id} value={a.id} className="flex flex-col gap-4">
              <MonthRangePicker min={stripMin} max={stripMax} from={from} to={to} current={currentMonth} />
              <RemunerationSummary months={remunMonths} />
              <div className="flex justify-end">
                <ForecastDetailSheet label={accountLabel(a)} forecast={forecast} />
              </div>
              {sections.length === 0 ? (
                <p className="text-muted-foreground text-sm">Aucune donnée pour ce compte.</p>
              ) : (
                <HistoryWithDetail
                  months={months}
                  currentMonth={currentMonth}
                  forecast={forecast}
                  sections={sections}
                  overspend={overspend}
                  grand={grand}
                  groups={selectGroups}
                  solde={solde}
                  planned={planned}
                />
              )}
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
