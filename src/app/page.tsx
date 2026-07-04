import { db } from "../db/index";
import { totalBalance } from "../db/repositories/accounts";
import { listTransactions } from "../db/repositories/transactions";
import { listBudgets } from "../db/repositories/budgets";
import { getSetting } from "../db/repositories/settings";
import { computeEnvelopes } from "../lib/budget";
import { buildAlerts } from "../lib/alerts";
import { formatEur, monthKey } from "../lib/money";

export const dynamic = "force-dynamic";

export default function Dashboard() {
  const database = db();
  const month = monthKey(new Date().toISOString().slice(0, 10));
  const balance = totalBalance(database);
  const allTxns = listTransactions(database);
  const txns = allTxns.map((t) => ({ date: t.date, amount: t.amount, category: t.category }));
  const budgets = listBudgets(database).map((b) => ({ category: b.category, month: b.month, limit: b.limit }));
  const envelopes = computeEnvelopes(txns, budgets, month);
  const threshold = Number.parseFloat(getSetting(database, "balance_threshold") ?? "0");
  const alerts = buildAlerts(envelopes, balance, threshold);

  const monthSpend = txns
    .filter((t) => monthKey(t.date) === month && t.amount < 0)
    .reduce((s, t) => s + Math.abs(t.amount), 0);
  const recent = allTxns.slice(0, 10);

  return (
    <div>
      <div className="card">
        <div style={{ fontSize: "2rem", fontWeight: 700 }}>{formatEur(balance)}</div>
        <div>Dépensé ce mois-ci : {formatEur(monthSpend)}</div>
      </div>

      {alerts.map((a, i) => (
        <div key={i} className={`alert ${a.level}`}>{a.message}</div>
      ))}

      <div className="card">
        <h3>Enveloppes ({month})</h3>
        {envelopes.length === 0 && <p>Aucun budget défini. Va dans « Budgets ».</p>}
        {envelopes.map((e) => (
          <div key={e.category} style={{ marginBottom: ".75rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>{e.category}</span>
              <span>{formatEur(e.spent)} / {formatEur(e.limit)}</span>
            </div>
            <div className="bar">
              <span
                style={{
                  width: `${Math.min(100, e.ratio * 100)}%`,
                  background: e.ratio >= 1 ? "#ef4444" : e.ratio >= 0.8 ? "#f59e0b" : "#22c55e",
                }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <h3>Dernières transactions</h3>
        <table>
          <tbody>
            {recent.map((t) => (
              <tr key={t.id}>
                <td>{t.date}</td>
                <td>{t.label}</td>
                <td>{t.category ?? "À catégoriser"}</td>
                <td style={{ textAlign: "right" }}>{formatEur(t.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
