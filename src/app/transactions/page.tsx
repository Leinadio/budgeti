import { db } from "../../db/index";
import { listTransactions, type TxnView } from "../../db/repositories/transactions";
import { listCategories } from "../../db/repositories/categories";
import { formatEur } from "../../lib/money";
import { recategorize } from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { CategorySelectField } from "@/components/category-select-field";
import { RuleCheckboxField } from "@/components/rule-checkbox-field";

export const dynamic = "force-dynamic";

export default function TransactionsPage() {
  const database = db();
  const txns = listTransactions(database);
  const categories = listCategories(database).map((c) => c.name);

  // Group transactions by account, preserving date order within each group.
  const groups = new Map<string, { label: string; items: TxnView[] }>();
  for (const t of txns) {
    const g = groups.get(t.accountId) ?? { label: t.accountLabel ?? "Compte", items: [] };
    g.items.push(t);
    groups.set(t.accountId, g);
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.size === 0 && (
        <Card>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              Aucune transaction. Va dans Réglages pour synchroniser.
            </p>
          </CardContent>
        </Card>
      )}
      {[...groups.values()].map((group) => (
        <Card key={group.label}>
          <CardHeader>
            <CardTitle>{group.label}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Libellé</TableHead>
                  <TableHead>Catégorie</TableHead>
                  <TableHead className="text-right">Montant</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.items.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="text-muted-foreground">{t.date}</TableCell>
                    <TableCell>{t.label}</TableCell>
                    <TableCell>
                      <form action={recategorize} className="flex items-center gap-2">
                        <input type="hidden" name="txnId" value={t.id} />
                        <input type="hidden" name="label" value={t.label} />
                        <CategorySelectField
                          name="category"
                          categories={categories}
                          defaultValue={t.category ?? ""}
                        />
                        <RuleCheckboxField name="createRule" label="règle" />
                        <Button type="submit" size="sm" variant="secondary">
                          OK
                        </Button>
                      </form>
                    </TableCell>
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
