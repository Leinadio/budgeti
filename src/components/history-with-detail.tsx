"use client";
import type { AccountForecast } from "@/lib/forecast";
import type { MonthCell, HistorySection, SoldeColumn, PlannedSoldes, RetainedOverspends, PendingOverspend } from "@/lib/history";
import { CenterScroll } from "@/components/center-scroll";
import { HistoryGrid } from "@/components/history-grid";
import { OverspendBanner } from "@/components/overspend-banner";
import { useDetailSidebar } from "@/components/detail-sidebar";

type SelectGroup = {
  id: number;
  name: string;
  kind: "envelope" | "recurring";
  lines: { id: number; name: string; amount: number; day: number }[];
};

// Le tableau de l'Historique : un clic sur un montant envoie son détail à la
// sidebar de droite, montée au niveau du shell (voir DetailSidebarProvider).
export function HistoryWithDetail(props: {
  months: string[];
  currentMonth: string;
  // Borne haute de la frise (12 mois de projection) : sert au sélecteur de mois
  // du formulaire de création inline d'un groupe (Task 5).
  stripMax: string;
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
  // Dépassements de mois terminés sans décision (bandeau) ; tous les dépassements
  // non tranchés, un par groupe (pastilles) ; budgets courants par groupe
  // (pré-remplissage de la décision).
  pendingClosed?: PendingOverspend[];
  pending?: PendingOverspend[];
  currentBudgets?: Record<number, number>;
}) {
  const { setDetail, selected, anchor } = useDetailSidebar();
  return (
    <div className="flex flex-col gap-3">
      {props.pendingClosed && props.pendingClosed.length > 0 && (
        <OverspendBanner items={props.pendingClosed} accountId={props.accountId} months={props.months} budgets={props.currentBudgets ?? {}} />
      )}
      <CenterScroll>
        <HistoryGrid {...props} onSelect={setDetail} selected={selected} anchor={anchor} />
      </CenterScroll>
    </div>
  );
}
