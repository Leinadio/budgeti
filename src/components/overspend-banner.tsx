"use client";
import { TriangleAlert } from "lucide-react";
import { monthLabel } from "@/lib/transactions-view";
import type { PendingOverspend } from "@/lib/history";
import { overspendDecisionDetail } from "@/lib/history-detail";
import { useDetailSidebar } from "@/components/detail-sidebar";

const NUM = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Bandeau « dépassements à traiter » : listé par mois terminé, chaque élément
// ouvre le side panel de décision du bon groupe et du bon mois.
export function OverspendBanner({ items, accountId, months, currentBudgets, currentUncatProvision }: {
  items: PendingOverspend[];
  accountId: string;
  months: string[]; // mois affichés, pour retrouver l'index de la colonne
  // Budgets courants par groupe et provision non catégorisés en vigueur (groupe 0),
  // pour pré-remplir le champ « Permanent » du bloc de décision.
  currentBudgets?: Record<number, number>;
  currentUncatProvision?: number | null;
}) {
  const { setDetail } = useDetailSidebar();
  if (items.length === 0) return null;
  const currentBudgetOf = (groupId: number): number | null =>
    groupId === 0 ? (currentUncatProvision ?? null) : (currentBudgets?.[groupId] ?? null);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950">
      <TriangleAlert className="size-4 shrink-0 text-amber-600" />
      <span>Des dépassements attendent une décision :</span>
      {items.map((it) => (
        <button
          key={`${it.groupId}-${it.month}`}
          type="button"
          onClick={() =>
            setDetail(
              overspendDecisionDetail(
                it,
                accountId,
                months.indexOf(it.month) === -1 ? null : months.indexOf(it.month),
                null,
                currentBudgetOf(it.groupId),
              ),
            )
          }
          className="cursor-pointer underline decoration-dotted underline-offset-2 hover:no-underline"
        >
          {it.name} ({NUM.format(it.amount)} € · {monthLabel(it.month)})
        </button>
      ))}
    </div>
  );
}
