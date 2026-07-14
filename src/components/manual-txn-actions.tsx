"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import type { TxnView } from "@/db/repositories/transactions";
import { removeTransaction } from "@/app/transactions/actions";
import { AddTransactionSheet } from "@/components/add-transaction-sheet";
import { Button } from "@/components/ui/button";

type AccountOpt = { id: string; label: string };
type GroupOpt = { id: number; name: string; accountId: string; direction: "in" | "out" };

export function ManualTxnActions({ txn, accounts, groups }: { txn: TxnView; accounts: AccountOpt[]; groups: GroupOpt[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <span className="inline-flex items-center gap-1">
      <AddTransactionSheet
        accounts={accounts}
        groups={groups}
        edit={{
          id: txn.id, accountId: txn.accountId, date: txn.date,
          direction: txn.amount >= 0 ? "in" : "out", amount: txn.amount,
          label: txn.label, groupId: txn.groupId, incomeKind: txn.incomeKind,
        }}
      />
      <Button variant="ghost" size="sm" disabled={isPending}
        onClick={() => startTransition(async () => { await removeTransaction(txn.id); router.refresh(); })}>
        <Trash2 className="size-4" />
      </Button>
    </span>
  );
}
