import { db } from "../../db/index";
import { listCategories } from "../../db/repositories/categories";
import { listBudgets } from "../../db/repositories/budgets";
import { monthKey } from "../../lib/money";
import { saveBudget } from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export const dynamic = "force-dynamic";

export default function BudgetsPage() {
  const database = db();
  const month = monthKey(new Date().toISOString().slice(0, 10));
  const categories = listCategories(database);
  const budgets = listBudgets(database).filter((b) => b.month === month);
  const limitFor = (c: string) => budgets.find((b) => b.category === c)?.limit ?? "";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Budgets — {month}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {categories.map((c) => (
          <form key={c.id} action={saveBudget} className="flex items-center gap-2">
            <input type="hidden" name="category" value={c.name} />
            <Label className="w-40 font-normal">{c.name}</Label>
            <Input
              type="number"
              name="limit"
              step="0.01"
              defaultValue={limitFor(c.name)}
              placeholder="Plafond €"
              className="max-w-40"
            />
            <Button type="submit" size="sm">
              Enregistrer
            </Button>
          </form>
        ))}
      </CardContent>
    </Card>
  );
}
