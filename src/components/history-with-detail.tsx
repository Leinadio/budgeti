"use client";
import type { AccountForecast } from "@/lib/forecast";
import type { MonthCell, HistorySection, SoldeColumn, PlannedSoldes, PendingOverspend } from "@/lib/history";
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
  // Compte affiché et décisions déjà prises sur des dépassements : nécessaires au
  // bloc de décision du side panel (Task 6).
  accountId: string;
  decisions?: { groupId: number; month: string; decision: "exceptional" | "permanent" }[];
  // Tous les dépassements non tranchés, un par groupe (pastilles) ; budgets courants
  // par groupe, pour pré-remplir l'édition de budget d'un groupe (gestion de groupe).
  pending?: PendingOverspend[];
  // Dépassements non tranchés groupés par mois : pastilles sous chaque en-tête de
  // mois dans la grille (Task 4).
  pendingByMonth?: Record<string, PendingOverspend[]>;
  currentBudgets?: Record<number, number>;
  // Provision non catégorisés en vigueur au mois courant, pour pré-remplir le champ
  // « Nouvelle provision » du bloc de décision (Task 5).
  currentUncatProvision?: number | null;
}) {
  const { setDetail, selected, anchor } = useDetailSidebar();
  // Bandeau : les dépassements à trancher de TOUS les mois affichés (mois courant
  // inclus), dans l'ordre de la fenêtre. On les prend dans pendingByMonth (groupés
  // par mois, déjà triés par nom) restreint aux mois affichés : un mois hors fenêtre
  // n'apparaît donc pas dans le bandeau.
  const bannerItems = props.pendingByMonth
    ? props.months.flatMap((m) => props.pendingByMonth![m] ?? [])
    : [];
  return (
    <div className="flex flex-col gap-3">
      {bannerItems.length > 0 && (
        <OverspendBanner
          items={bannerItems}
          accountId={props.accountId}
          months={props.months}
          currentBudgets={props.currentBudgets}
          currentUncatProvision={props.currentUncatProvision}
        />
      )}
      <CenterScroll>
        <HistoryGrid {...props} onSelect={setDetail} selected={selected} anchor={anchor} />
      </CenterScroll>
    </div>
  );
}
