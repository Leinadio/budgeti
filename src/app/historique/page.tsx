import { Fragment } from "react";
import { db } from "../../db/index";
import { listAccounts } from "../../db/repositories/accounts";
import { listTransactions } from "../../db/repositories/transactions";
import { listGroups } from "../../db/repositories/groups";
import { computeHistory, grandTotals, monthlyOverspend, monthsWithData, nextMonthKey, type MonthCell } from "../../lib/history";
import { computeForecast, type AccountForecast, type Group, type Txn } from "../../lib/forecast";
import { ForecastDetailSheet } from "@/components/forecast-detail-sheet";
import { monthLabel } from "../../lib/transactions-view";
import { formatEur, monthKey } from "../../lib/money";
import { accountLabel } from "../../lib/account";
import { cn } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CenterScroll } from "@/components/center-scroll";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";

export const dynamic = "force-dynamic";

const NUM = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (n: number) => NUM.format(n).replace(/[  ]/g, " ");

// mode : "out" (dépense), "in" (entrée) ou "total" (sous-total, montre les deux colonnes).
function AmountCells({ cells, mode }: { cells: MonthCell[]; mode: "out" | "in" | "total" }) {
  return (
    <>
      {cells.map((c, i) => (
        <Fragment key={i}>
          <TableCell className="border-l text-right tabular-nums text-muted-foreground">{fmt(c.budgeted)}</TableCell>
          <TableCell className="text-right tabular-nums">{mode === "in" ? "—" : fmt(c.depense)}</TableCell>
          <TableCell className="text-right tabular-nums">{mode === "out" ? "—" : fmt(c.recu)}</TableCell>
          <TableCell className={cn("text-right tabular-nums", mode === "out" && c.balance < 0 && "text-red-600")}>
            {fmt(c.balance)}
          </TableCell>
        </Fragment>
      ))}
    </>
  );
}

// Estimés du forecast rattachés à leur mois : le mois courant reçoit le solde et
// l'estimé fin de mois ; le mois prochain reçoit les deux estimés de projection.
function ForecastCard({ month, currentMonth, nextMonth, f, overspend }: {
  month: string;
  currentMonth: string;
  nextMonth: string;
  f: AccountForecast;
  overspend: number;
}) {
  const estimates: [string, number][] =
    month === currentMonth
      ? [["Solde actuel", f.balance], ["Estimé fin de mois", f.currentEstimate]]
      : month === nextMonth
        ? [["Estimé mois prochain", f.nextEstimate], ["Dépassements maintenus", f.nextEstimateWithOverspend]]
        : [];
  return (
    <div className="flex flex-col gap-0.5 py-1 text-xs font-normal normal-case">
      {estimates.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-3">
          <span className="text-muted-foreground">{label}</span>
          <span className={cn("font-semibold tabular-nums", value < 0 && "text-red-600")}>{formatEur(value)}</span>
        </div>
      ))}
      <div className="flex justify-between gap-3">
        <span className="text-muted-foreground">Dépassement</span>
        <span className="font-semibold tabular-nums text-red-600">{overspend > 0 ? formatEur(overspend) : "—"}</span>
      </div>
    </div>
  );
}

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

        return (
          <TabsContent key={a.id} value={a.id} className="flex flex-col gap-4">
            <div className="flex justify-end">
              <ForecastDetailSheet label={accountLabel(a)} forecast={forecast} />
            </div>
            {sections.length === 0 ? (
              <p className="text-muted-foreground text-sm">Aucune donnée pour ce compte.</p>
            ) : (
            <CenterScroll>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead rowSpan={3} className="bg-background sticky left-0 z-10 align-bottom">Catégorie</TableHead>
                    {months.map((m, i) => (
                      <TableHead key={m} colSpan={4} className="border-l align-bottom font-normal">
                        <ForecastCard month={m} currentMonth={currentMonth} nextMonth={nextMonth} f={forecast} overspend={overspend[i]} />
                      </TableHead>
                    ))}
                  </TableRow>
                  <TableRow>
                    {months.map((m) => (
                      <TableHead
                        key={m}
                        colSpan={4}
                        data-current-month={m === currentMonth ? "" : undefined}
                        className={cn(
                          "border-l text-center whitespace-nowrap",
                          m === currentMonth && "text-foreground font-semibold",
                          m > currentMonth && "text-muted-foreground italic",
                        )}
                      >
                        {monthLabel(m)}
                        {m > currentMonth ? " · projection" : ""}
                      </TableHead>
                    ))}
                  </TableRow>
                  <TableRow>
                    {months.map((m) => (
                      <Fragment key={m}>
                        <TableHead className="border-l text-right">Budg.</TableHead>
                        <TableHead className="text-right">Dép.</TableHead>
                        <TableHead className="text-right">Reçu</TableHead>
                        <TableHead className="text-right">Solde</TableHead>
                      </Fragment>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow className="bg-muted/60 hover:bg-muted/60 font-semibold">
                    <TableCell className="bg-muted/60 sticky left-0 z-10 whitespace-nowrap">Total</TableCell>
                    <AmountCells cells={grandTotals(sections, months.length)} mode="total" />
                  </TableRow>
                  {sections.map((sec) => (
                    <Fragment key={sec.kind}>
                      <TableRow className="bg-muted/40 hover:bg-muted/40 font-medium">
                        <TableCell className="bg-muted/40 sticky left-0 z-10 whitespace-nowrap">
                          {sec.kind === "envelope" ? "Enveloppes" : "Récurrents"}
                        </TableCell>
                        <AmountCells cells={sec.totals} mode="total" />
                      </TableRow>
                      {sec.rows.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="bg-background sticky left-0 z-10 whitespace-nowrap font-medium">
                            <span className="flex items-center gap-2">
                              {r.direction === "in" ? (
                                <ArrowUpRight className="size-4 shrink-0 text-sky-600" />
                              ) : (
                                <ArrowDownRight className="size-4 shrink-0 text-muted-foreground" />
                              )}
                              {r.name}
                            </span>
                          </TableCell>
                          <AmountCells cells={r.cells} mode={r.direction} />
                        </TableRow>
                      ))}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            </CenterScroll>
            )}
          </TabsContent>
        );
      })}
    </Tabs>
  );
}
