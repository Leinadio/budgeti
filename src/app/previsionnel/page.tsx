import { db } from "../../db/index";
import { listAccounts } from "../../db/repositories/accounts";
import { listTransactions } from "../../db/repositories/transactions";
import { listGroups } from "../../db/repositories/groups";
import { computeForecast, type Group, type GroupView, type Txn } from "../../lib/forecast";
import { formatEur, monthKey } from "../../lib/money";
import { accountLabel } from "../../lib/account";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Wallet, Repeat, ArrowUpRight, ArrowDownRight, type LucideIcon } from "lucide-react";
import { ForecastDetailSheet } from "@/components/forecast-detail-sheet";

export const dynamic = "force-dynamic";

function GroupTableRow({ g }: { g: GroupView }) {
  const ratio = g.total > 0 ? g.spent / g.total : 0;
  const isIn = g.direction === "in";
  return (
    <TableRow>
      <TableCell className="align-top whitespace-nowrap font-medium">
        <span className="flex items-center gap-2">
          {isIn ? (
            <ArrowUpRight className="size-4 shrink-0 text-sky-600" />
          ) : (
            <ArrowDownRight className="size-4 shrink-0 text-muted-foreground" />
          )}
          {g.name}
        </span>
      </TableCell>
      <TableCell className="w-full align-top">
        <Progress
          value={Math.min(100, ratio * 100)}
          indicatorClassName={
            isIn ? "bg-sky-500" : ratio >= 1 ? "bg-red-500" : ratio >= 0.8 ? "bg-amber-500" : "bg-green-500"
          }
        />
        {g.overspend > 0 && (
          <p className="mt-1.5 text-red-500 text-xs">
            Dépassement de {formatEur(g.overspend)}. Le mois prochain, pense à monter ce budget à {formatEur(g.spent)}.
          </p>
        )}
        {g.prevOverspend > 0 && (
          <p className="mt-1.5 text-red-500 text-xs">
            Le mois dernier : {formatEur(g.prevSpent)} dépensés sur {formatEur(g.total)} de budget. Budget conseillé : {formatEur(g.prevSpent)}.
          </p>
        )}
      </TableCell>
      <TableCell className="align-top text-right whitespace-nowrap tabular-nums">
        {formatEur(g.spent)} <span className="text-muted-foreground">/ {formatEur(g.total)}</span>
      </TableCell>
    </TableRow>
  );
}

function GroupSectionRows({ title, hint, icon: Icon, groups }: { title: string; hint: string; icon: LucideIcon; groups: GroupView[] }) {
  if (groups.length === 0) return null;
  return (
    <>
      <TableRow className="hover:bg-transparent">
        <TableCell colSpan={3} className="text-muted-foreground text-sm font-medium">
          <span className="flex items-center gap-2">
            <Icon className="size-4" />
            {title}
            <span className="text-xs font-normal">{hint}</span>
            <Badge variant="secondary" className="ml-1 tabular-nums">{groups.length}</Badge>
          </span>
        </TableCell>
      </TableRow>
      {groups.map((g) => (
        <GroupTableRow key={g.id} g={g} />
      ))}
    </>
  );
}

export default function PrevisionnelPage() {
  const database = db();
  const month = monthKey(new Date().toISOString().slice(0, 10));
  const accounts = listAccounts(database);
  const allGroups = listGroups(database);
  const allTxns: Txn[] = listTransactions(database).map((t) => ({
    id: t.id,
    date: t.date,
    amount: t.amount,
    label: t.label,
    accountId: t.accountId,
    groupId: t.groupId,
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
        const f = computeForecast(a.id, a.balance, groups, txns, month);
        return (
          <TabsContent key={a.id} value={a.id} className="flex flex-col gap-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex flex-wrap gap-8">
                <div className="flex flex-col">
                  <span className="text-muted-foreground text-xs">Solde actuel</span>
                  <span className="text-xl font-bold tabular-nums">{formatEur(f.balance)}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-muted-foreground text-xs">Estimé fin de mois</span>
                  <span className={cn("text-xl font-bold tabular-nums", f.currentEstimate < 0 && "text-red-600")}>
                    {formatEur(f.currentEstimate)}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-muted-foreground text-xs">Estimé mois prochain</span>
                  <span className={cn("text-xl font-bold tabular-nums", f.nextEstimate < 0 && "text-red-600")}>
                    {formatEur(f.nextEstimate)}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-muted-foreground text-xs">Mois prochain, dépassements maintenus</span>
                  <span className={cn("text-xl font-bold tabular-nums", f.nextEstimateWithOverspend < 0 && "text-red-600")}>
                    {formatEur(f.nextEstimateWithOverspend)}
                  </span>
                </div>
              </div>
              <ForecastDetailSheet label={accountLabel(a)} forecast={f} />
            </div>

            {f.groups.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Groupe</TableHead>
                    <TableHead>Progression</TableHead>
                    <TableHead className="text-right">Dépensé / Budget</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <GroupSectionRows
                    title="Enveloppes"
                    hint="budgets flexibles"
                    icon={Wallet}
                    groups={f.groups.filter((g) => g.kind === "envelope")}
                  />
                  <GroupSectionRows
                    title="Récurrents"
                    hint="échéances fixes"
                    icon={Repeat}
                    groups={f.groups.filter((g) => g.kind === "recurring")}
                  />
                </TableBody>
              </Table>
            ) : (
              <p className="text-muted-foreground text-sm">Aucun groupe sur ce compte.</p>
            )}
          </TabsContent>
        );
      })}
    </Tabs>
  );
}
