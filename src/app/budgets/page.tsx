import { db } from "../../db/index";
import { listCategories } from "../../db/repositories/categories";
import { listBudgets } from "../../db/repositories/budgets";
import { monthKey } from "../../lib/money";
import { saveBudget } from "./actions";

export const dynamic = "force-dynamic";

export default function BudgetsPage() {
  const database = db();
  const month = monthKey(new Date().toISOString().slice(0, 10));
  const categories = listCategories(database);
  const budgets = listBudgets(database).filter((b) => b.month === month);
  const limitFor = (c: string) => budgets.find((b) => b.category === c)?.limit ?? "";

  return (
    <div className="card">
      <h2>Budgets — {month}</h2>
      {categories.map((c) => (
        <form key={c.id} action={saveBudget} style={{ display: "flex", gap: ".5rem", marginBottom: ".5rem" }}>
          <input type="hidden" name="category" value={c.name} />
          <span style={{ width: 160 }}>{c.name}</span>
          <input type="number" name="limit" step="0.01" defaultValue={limitFor(c.name)} placeholder="Plafond €" />
          <button type="submit">Enregistrer</button>
        </form>
      ))}
    </div>
  );
}
