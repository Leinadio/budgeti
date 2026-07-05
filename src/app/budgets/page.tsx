import { db } from "../../db/index";
import { listBudgets } from "../../db/repositories/budgets";
import { listTransactions } from "../../db/repositories/transactions";
import { computeEnvelopes, type Txn } from "../../lib/budget";
import { formatEur, monthKey } from "../../lib/money";
import { saveBudget, removeBudget } from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

export default function BudgetsPage() {
  const database = db();
  const month = monthKey(new Date().toISOString().slice(0, 10));
  const budgets = listBudgets(database);
  const txns: Txn[] = listTransactions(database).map((t) => ({
    date: t.date,
    amount: t.amount,
    category: t.category,
  }));
  const envelopes = computeEnvelopes(txns, budgets, month);
  const spentFor = (c: string) => envelopes.find((e) => e.category === c)?.spent ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Nouveau budget</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={saveBudget} className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="budget-name" className="font-normal">Nom</Label>
              <Input id="budget-name" name="category" placeholder="Ex: Coiffure" required />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="budget-limit" className="font-normal">Montant prévu €</Label>
              <Input
                id="budget-limit"
                type="number"
                name="limit"
                step="0.01"
                placeholder="0.00"
                className="max-w-40"
              />
            </div>
            <Button type="submit" size="sm">Créer</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Budgets — {month}</CardTitle>
        </CardHeader>
        <CardContent>
          {budgets.length === 0 ? (
            <p className="text-muted-foreground text-sm">Aucun budget. Crée-en un ci-dessus.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nom</TableHead>
                  <TableHead className="text-right">Dépense courante</TableHead>
                  <TableHead>Dépense prévue</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {budgets.map((b) => (
                  <TableRow key={b.category}>
                    <TableCell>{b.category}</TableCell>
                    <TableCell className="text-right">{formatEur(spentFor(b.category))}</TableCell>
                    <TableCell>
                      <form action={saveBudget} className="flex items-center gap-2">
                        <input type="hidden" name="category" value={b.category} />
                        <Input
                          type="number"
                          name="limit"
                          step="0.01"
                          defaultValue={b.limit}
                          className="max-w-32"
                        />
                        <Button type="submit" size="sm" variant="secondary">OK</Button>
                      </form>
                    </TableCell>
                    <TableCell>
                      <form action={removeBudget}>
                        <input type="hidden" name="category" value={b.category} />
                        <Button type="submit" size="sm" variant="ghost">Supprimer</Button>
                      </form>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
