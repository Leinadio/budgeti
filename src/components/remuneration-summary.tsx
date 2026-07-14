import type { MonthRemuneration } from "@/lib/remuneration";
import { formatEur } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const money = (n: number) => <span className="tabular-nums whitespace-nowrap">{formatEur(n)}</span>;
const signed = (n: number) => (
  <span className={cn("tabular-nums whitespace-nowrap", n < 0 && "text-red-600")}>{formatEur(n)}</span>
);

export function RemunerationSummary({ months }: { months: MonthRemuneration[] }) {
  const shown = months.filter((m) => m.principal + m.supplementary + m.expenses > 0);
  if (shown.length === 0) return null;
  return (
    <Card className="flex flex-col gap-3 p-4">
      <h3 className="font-semibold">Rémunération par mois</h3>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead></TableHead>
              {shown.map((m) => <TableHead key={m.month} className="text-right">{m.month}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="text-muted-foreground">Principal reçu</TableCell>
              {shown.map((m) => <TableCell key={m.month} className="text-right">{money(m.principal)}</TableCell>)}
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">Supplémentaire reçu</TableCell>
              {shown.map((m) => <TableCell key={m.month} className="text-right">{money(m.supplementary)}</TableCell>)}
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">Dépenses</TableCell>
              {shown.map((m) => <TableCell key={m.month} className="text-right">{money(m.expenses)}</TableCell>)}
            </TableRow>
            <TableRow>
              <TableCell>Solde face au principal</TableCell>
              {shown.map((m) => <TableCell key={m.month} className="text-right">{signed(m.balanceVsPrincipal)}</TableCell>)}
            </TableRow>
            <TableRow>
              <TableCell>Solde face au principal + supplémentaire</TableCell>
              {shown.map((m) => <TableCell key={m.month} className="text-right">{signed(m.balanceVsTotal)}</TableCell>)}
            </TableRow>
            <TableRow className="font-semibold">
              <TableCell>À te verser le mois prochain</TableCell>
              {shown.map((m) => <TableCell key={m.month} className="text-right">{money(m.suggestedNextPrincipal)}</TableCell>)}
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
