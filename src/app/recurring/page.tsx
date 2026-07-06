import { db } from "../../db/index";
import { listRecurring } from "../../db/repositories/recurring";
import { listTransactions } from "../../db/repositories/transactions";
import { computeRecurring } from "../../lib/recurring";
import { formatEur, monthKey } from "../../lib/money";
import { addRecurring, removeRecurring } from "./actions";
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

export default function RecurringPage() {
  const database = db();
  const month = monthKey(new Date().toISOString().slice(0, 10));
  const payments = listRecurring(database);
  const txns = listTransactions(database).map((t) => ({
    date: t.date,
    amount: t.amount,
    label: t.label,
  }));
  const summary = computeRecurring(payments, txns, month);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Nouveau paiement récurrent</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={addRecurring} className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="rec-name" className="font-normal">Nom</Label>
              <Input id="rec-name" name="name" placeholder="Ex: Spotify" required />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="rec-keyword" className="font-normal">Mot-clé</Label>
              <Input id="rec-keyword" name="keyword" placeholder="Ex: SPOTIFY" required />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="rec-expected" className="font-normal">Montant prévu €</Label>
              <Input
                id="rec-expected"
                type="number"
                name="expected"
                step="0.01"
                placeholder="0.00"
                className="max-w-32"
              />
            </div>
            <Button type="submit" size="sm">Ajouter</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Paiements récurrents — {month}</CardTitle>
        </CardHeader>
        <CardContent>
          {payments.length === 0 ? (
            <p className="text-muted-foreground text-sm">Aucun paiement récurrent.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nom</TableHead>
                  <TableHead>Mot-clé</TableHead>
                  <TableHead className="text-right">Dépense courante</TableHead>
                  <TableHead className="text-right">Dépense prévue</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>{l.name}</TableCell>
                    <TableCell className="text-muted-foreground">{l.keyword}</TableCell>
                    <TableCell className="text-right">{formatEur(l.spent)}</TableCell>
                    <TableCell className="text-right">{formatEur(l.expected)}</TableCell>
                    <TableCell>
                      <form action={removeRecurring}>
                        <input type="hidden" name="id" value={l.id} />
                        <Button type="submit" size="sm" variant="ghost">Supprimer</Button>
                      </form>
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2">
                  <TableCell className="font-medium" colSpan={2}>Total</TableCell>
                  <TableCell className="text-right font-medium">{formatEur(summary.totalSpent)}</TableCell>
                  <TableCell className="text-right font-medium">{formatEur(summary.totalExpected)}</TableCell>
                  <TableCell></TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
