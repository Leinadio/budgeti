"use client";
import { TriangleAlert } from "lucide-react";
import { monthLabel } from "@/lib/transactions-view";
import { cellKey, groupRow, sectionRow, type CellDetail } from "@/lib/history-explain";
import type { PendingOverspend } from "@/lib/history";
import { useDetailSidebar } from "@/components/detail-sidebar";

const NUM = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Détail minimal ouvert par le bandeau ou la pastille : le montant du
// dépassement et le bloc de décision. cellRef surligne la Balance du bon mois
// quand il est affiché (monthIdx), sinon le panneau s'ouvre sans surbrillance.
export function overspendDecisionDetail(
  item: PendingOverspend,
  accountId: string,
  monthIdx: number | null,
  decision: "exceptional" | "permanent" | null,
): CellDetail {
  return {
    title: "Dépassement",
    subtitle: `${item.name} · ${monthLabel(item.month)}`,
    nodes: [],
    result: item.amount,
    cellRef:
      monthIdx != null
        ? cellKey(item.groupId === 0 ? sectionRow("uncategorized") : groupRow(item.groupId), "reste", monthIdx)
        : undefined,
    overspendAction: {
      accountId,
      groupId: item.groupId,
      groupName: item.name,
      month: item.month,
      amount: item.amount,
      decision,
    },
  };
}

// Bandeau « dépassements à traiter » : listé par mois terminé, chaque élément
// ouvre le side panel de décision du bon groupe et du bon mois.
export function OverspendBanner({ items, accountId, months }: {
  items: PendingOverspend[];
  accountId: string;
  months: string[]; // mois affichés, pour retrouver l'index de la colonne
}) {
  const { setDetail } = useDetailSidebar();
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950">
      <TriangleAlert className="size-4 shrink-0 text-amber-600" />
      <span>Des dépassements attendent une décision :</span>
      {items.map((it) => (
        <button
          key={`${it.groupId}-${it.month}`}
          type="button"
          onClick={() =>
            setDetail(overspendDecisionDetail(it, accountId, months.indexOf(it.month) === -1 ? null : months.indexOf(it.month), null))
          }
          className="cursor-pointer underline decoration-dotted underline-offset-2 hover:no-underline"
        >
          {it.name} ({NUM.format(it.amount)} € · {monthLabel(it.month)})
        </button>
      ))}
    </div>
  );
}
