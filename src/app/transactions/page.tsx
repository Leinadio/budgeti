import { db } from "../../db/index";
import { listTransactions, type TxnView } from "../../db/repositories/transactions";
import { listCategories } from "../../db/repositories/categories";
import { formatEur } from "../../lib/money";
import { recategorize } from "./actions";

export const dynamic = "force-dynamic";

export default function TransactionsPage() {
  const database = db();
  const txns = listTransactions(database);
  const categories = listCategories(database);

  // Group transactions by account, preserving date order within each group.
  const groups = new Map<string, { label: string; items: TxnView[] }>();
  for (const t of txns) {
    const g = groups.get(t.accountId) ?? { label: t.accountLabel ?? "Compte", items: [] };
    g.items.push(t);
    groups.set(t.accountId, g);
  }

  return (
    <div>
      {groups.size === 0 && (
        <div className="card">
          <p>Aucune transaction. Va dans Réglages pour synchroniser.</p>
        </div>
      )}
      {[...groups.values()].map((group) => (
        <div className="card" key={group.label}>
          <h2>{group.label}</h2>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Libellé</th>
                <th>Catégorie</th>
                <th style={{ textAlign: "right" }}>Montant</th>
              </tr>
            </thead>
            <tbody>
              {group.items.map((t) => (
                <tr key={t.id}>
                  <td>{t.date}</td>
                  <td>{t.label}</td>
                  <td>
                    <form action={recategorize} style={{ display: "flex", gap: ".25rem" }}>
                      <input type="hidden" name="txnId" value={t.id} />
                      <input type="hidden" name="label" value={t.label} />
                      <select name="category" defaultValue={t.category ?? ""}>
                        <option value="" disabled>À catégoriser</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.name}>{c.name}</option>
                        ))}
                      </select>
                      <label style={{ fontSize: ".75rem" }}>
                        <input type="checkbox" name="createRule" /> règle
                      </label>
                      <button type="submit">OK</button>
                    </form>
                  </td>
                  <td style={{ textAlign: "right" }}>{formatEur(t.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
