import { Fragment } from "react";
import { db } from "../../db/index";
import { listTransactions, type TxnView } from "../../db/repositories/transactions";
import { listGroups } from "../../db/repositories/groups";
import { resolveOwnership, type OwnableGroup } from "../../lib/ownership";
import { formatEur } from "../../lib/money";
import { groupByMonth } from "../../lib/transactions-view";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { GroupSelectField } from "@/components/group-select-field";
import { TruncatedText } from "@/components/truncated-text";

export const dynamic = "force-dynamic";

export default function TransactionsPage() {
  const database = db();
  const txns = listTransactions(database);
  const groups = listGroups(database);
  const ownable: OwnableGroup[] = groups.map((g) => ({
    id: g.id, accountId: g.accountId, direction: g.direction, kind: g.kind,
    keywords: g.kind === "envelope" ? g.keywords : g.lines.map((l) => l.keyword),
  }));
  const groupName = (id: number) => groups.find((g) => g.id === id)?.name ?? "?";

  const statusLabel = (t: TxnView): string => {
    const res = resolveOwnership(
      { id: t.id, date: t.date, amount: t.amount, label: t.label, accountId: t.accountId, groupId: t.groupId },
      ownable,
    );
    if (res.status === "manual") return `${groupName(res.groupId)} (manuel)`;
    if (res.status === "auto") return `${groupName(res.groupId)} (auto)`;
    if (res.status === "ambiguous") return "à répartir";
    return "non budgétée";
  };

  const groupsOfAccount = (accountId: string) =>
    groups.filter((g) => g.accountId === accountId).map((g) => ({ id: g.id, name: g.name }));

  const byAccount = new Map<string, { label: string; items: TxnView[] }>();
  for (const t of txns) {
    const g = byAccount.get(t.accountId) ?? { label: t.accountLabel ?? "Compte", items: [] };
    g.items.push(t);
    byAccount.set(t.accountId, g);
  }
  const accounts = [...byAccount.entries()];

  if (accounts.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Aucune transaction. Va dans Réglages pour synchroniser.
      </p>
    );
  }

  return (
    <Tabs defaultValue={accounts[0][0]}>
      <TabsList>
        {accounts.map(([accountId, group]) => (
          <TabsTrigger key={accountId} value={accountId}>
            {group.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {accounts.map(([accountId, group]) => (
        <TabsContent key={accountId} value={accountId}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Libellé</TableHead>
                <TableHead>Groupe</TableHead>
                <TableHead>Appartenance</TableHead>
                <TableHead className="text-right">Montant</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groupByMonth(group.items).map((m) => (
                <Fragment key={m.month}>
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={5} className="text-muted-foreground text-sm font-medium">
                      {m.label}
                    </TableCell>
                  </TableRow>
                  {m.items.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="text-muted-foreground">{t.date}</TableCell>
                      <TableCell>
                        <TruncatedText text={t.label} className="max-w-[460px]" />
                      </TableCell>
                      <TableCell>
                        <GroupSelectField txnId={t.id} options={groupsOfAccount(t.accountId)} defaultValue={t.groupId} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        <TruncatedText text={statusLabel(t)} className="max-w-[200px]" />
                      </TableCell>
                      <TableCell className="text-right font-medium">{formatEur(t.amount)}</TableCell>
                    </TableRow>
                  ))}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </TabsContent>
      ))}
    </Tabs>
  );
}
