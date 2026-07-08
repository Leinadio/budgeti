import { db } from "../../db/index";
import { listTransactions, type TxnView } from "../../db/repositories/transactions";
import { listGroups } from "../../db/repositories/groups";
import { resolveOwnership, type OwnableGroup } from "../../lib/ownership";
import { formatEur } from "../../lib/money";
import { setGroup } from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { GroupSelectField } from "@/components/group-select-field";

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

  return (
    <div className="flex flex-col gap-4">
      {byAccount.size === 0 && (
        <Card>
          <CardContent>
            <p className="text-muted-foreground text-sm">Aucune transaction. Va dans Réglages pour synchroniser.</p>
          </CardContent>
        </Card>
      )}
      {[...byAccount.entries()].map(([accountId, group]) => (
        <Card key={accountId}>
          <CardHeader>
            <CardTitle>{group.label}</CardTitle>
          </CardHeader>
          <CardContent>
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
                {group.items.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="text-muted-foreground">{t.date}</TableCell>
                    <TableCell>{t.label}</TableCell>
                    <TableCell>
                      <form action={setGroup}>
                        <input type="hidden" name="txnId" value={t.id} />
                        <GroupSelectField name="group" options={groupsOfAccount(t.accountId)} defaultValue={t.groupId} />
                      </form>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{statusLabel(t)}</TableCell>
                    <TableCell className="text-right font-medium">{formatEur(t.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
