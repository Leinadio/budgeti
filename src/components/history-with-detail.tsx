"use client";
import { useState } from "react";
import type { AccountForecast } from "@/lib/forecast";
import type { MonthCell, HistorySection, SoldeColumn } from "@/lib/history";
import type { CellDetail } from "@/lib/history-explain";
import { SidebarProvider } from "@/components/ui/sidebar";
import { CenterScroll } from "@/components/center-scroll";
import { HistoryGrid } from "@/components/history-grid";
import { HistoryDetailSidebar } from "@/components/history-detail-sidebar";

type SelectGroup = { id: number; name: string; lines: { id: number; name: string }[] };

// Tableau de l'Historique + sa sidebar de détail (à droite). L'état du montant
// sélectionné vit ici, au-dessus du défilement horizontal du tableau : la sidebar
// pousse le tableau au lieu de défiler avec lui.
//
// SidebarProvider imbriqué (celui de la navigation de gauche est dans le layout) :
// c'est le motif shadcn pour deux sidebars indépendantes. Il est piloté par la
// sélection — ouvert quand un montant est sélectionné, fermé sinon.
export function HistoryWithDetail(props: {
  months: string[];
  currentMonth: string;
  forecast: AccountForecast;
  sections: HistorySection[];
  overspend: number[];
  grand: MonthCell[];
  groups: SelectGroup[];
  solde: SoldeColumn;
}) {
  const [selected, setSelected] = useState<CellDetail | null>(null);
  return (
    <SidebarProvider
      open={selected !== null}
      onOpenChange={(open) => {
        if (!open) setSelected(null);
      }}
      className="min-h-0 items-start"
      style={{ "--sidebar-width": "26rem" } as React.CSSProperties}
    >
      <div className="min-w-0 flex-1">
        <CenterScroll>
          <HistoryGrid {...props} onSelect={setSelected} />
        </CenterScroll>
      </div>
      <HistoryDetailSidebar detail={selected} onClose={() => setSelected(null)} />
    </SidebarProvider>
  );
}
