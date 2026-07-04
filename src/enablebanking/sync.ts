import type Database from "better-sqlite3";
import { parseAmount } from "../lib/money";
import { categorize } from "../lib/categorize";
import { listRules } from "../db/repositories/rules";
import { ensureCategory } from "../db/repositories/categories";
import { upsertAccount } from "../db/repositories/accounts";
import { upsertTransaction, uncategorized, setTransactionCategory } from "../db/repositories/transactions";

type EbGet = <T>(path: string) => Promise<T>;

type BalancesResponse = { balances: { balance_amount: { amount: string; currency: string } }[] };
type TxnResponse = {
  transactions: {
    entry_reference?: string;
    transaction_id?: string;
    booking_date: string;
    transaction_amount: { amount: string; currency: string };
    credit_debit_indicator: "CRDT" | "DBIT";
    remittance_information?: string[];
  }[];
};

export async function syncAll(
  db: Database.Database,
  deps: { ebGet: EbGet; accountUids: string[]; accountName: string },
): Promise<{ imported: number }> {
  let imported = 0;
  const nowIso = new Date().toISOString();

  for (const uid of deps.accountUids) {
    const balances = await deps.ebGet<BalancesResponse>(`/accounts/${uid}/balances`);
    const balance = Number.parseFloat((balances.balances ?? [])[0]?.balance_amount.amount ?? "0");
    upsertAccount(db, {
      id: uid,
      name: deps.accountName,
      iban_masked: null,
      balance,
      currency: (balances.balances ?? [])[0]?.balance_amount.currency ?? "EUR",
      last_synced: nowIso,
    });

    const txns = await deps.ebGet<TxnResponse>(`/accounts/${uid}/transactions`);
    for (const t of (txns.transactions ?? [])) {
      const id = t.entry_reference ?? t.transaction_id;
      if (!id) continue;
      const label = (t.remittance_information ?? []).join(" ").trim() || "(sans libellé)";
      imported += upsertTransaction(db, {
        id,
        account_id: uid,
        date: t.booking_date,
        amount: parseAmount(t.transaction_amount.amount, t.credit_debit_indicator),
        label,
        category_id: null,
      });
    }
  }

  // Categorize everything still uncategorized.
  const rules = listRules(db);
  for (const t of uncategorized(db)) {
    const category = categorize(t.label, rules);
    if (category) setTransactionCategory(db, t.id, ensureCategory(db, category));
  }

  return { imported };
}
