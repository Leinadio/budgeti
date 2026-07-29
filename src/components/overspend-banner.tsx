"use client";
import { TriangleAlert } from "lucide-react";
import { monthLabel } from "@/lib/transactions-view";
import { budgetKey, type PendingOverspend } from "@/lib/history";
import { overspendDecisionDetail } from "@/lib/history-detail";
import type { OverspendActionInfo } from "@/lib/history-explain";
import { useDetailSidebar } from "@/components/detail-sidebar";

const NUM = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Bandeau « dépassements à traiter » : listé par mois terminé, chaque élément
// ouvre le side panel de décision du bon groupe et du bon mois.
export function OverspendBanner({ items, accountId, months, budgetsForOverspend, overspentLinesOf }: {
  items: PendingOverspend[];
  accountId: string;
  months: string[]; // mois affichés, pour retrouver l'index de la colonne
  // Budgets par groupe ET par mois (clé budgetKey ; groupe 0 = provision des non
  // catégorisés), pour pré-remplir le champ « Permanent » du bloc de décision au mois
  // DU dépassement. Un dépassement listé ici est par nature ancien : le budget du
  // mois courant proposerait un montant faux dès qu'il a changé depuis.
  budgetsForOverspend?: Record<string, number>;
  // Lignes en dépassement d'un item, pour un récurrent (voir overspentLinesOfPending
  // dans src/lib/history-detail.ts) : le bandeau ne connaît que les items eux-mêmes,
  // pas les lignes de groupe du tableau, donc le calcul lui est fourni tout fait.
  overspentLinesOf: (item: PendingOverspend) => OverspendActionInfo["overspentLines"];
}) {
  const { setDetail } = useDetailSidebar();
  if (items.length === 0) return null;
  const budgetOf = (item: PendingOverspend): number | null =>
    budgetsForOverspend?.[budgetKey(item.groupId, item.month)] ?? null;
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
                budgetOf(it),
                overspentLinesOf(it),
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
