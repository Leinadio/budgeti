"use client";
import type { AccountForecast } from "@/lib/forecast";
import type { MonthCell, HistorySection, SoldeColumn, PlannedSoldes, RetainedOverspends } from "@/lib/history";
import { CenterScroll } from "@/components/center-scroll";
import { HistoryGrid } from "@/components/history-grid";
import { useDetailSidebar } from "@/components/detail-sidebar";

type SelectGroup = { id: number; name: string; lines: { id: number; name: string }[] };

// Le tableau de l'Historique : un clic sur un montant envoie son détail à la
// sidebar de droite, montée au niveau du shell (voir DetailSidebarProvider).
export function HistoryWithDetail(props: {
  months: string[];
  currentMonth: string;
  forecast: AccountForecast;
  sections: HistorySection[];
  overspend: number[];
  grand: MonthCell[];
  groups: SelectGroup[];
  solde: SoldeColumn;
  planned: PlannedSoldes;
  retained?: RetainedOverspends;
  // Compte affiché et décisions déjà prises sur des dépassements : nécessaires au
  // bloc de décision du side panel (Task 6).
  accountId: string;
  decisions?: { groupId: number; month: string; decision: "exceptional" | "permanent" }[];
}) {
  const { setDetail, selected, anchor } = useDetailSidebar();
  return (
    <CenterScroll>
      <HistoryGrid {...props} onSelect={setDetail} selected={selected} anchor={anchor} />
    </CenterScroll>
  );
}
