"use client";
import type { AccountForecast } from "@/lib/forecast";
import type { MonthCell, HistorySection, SoldeColumn, PlannedSoldes, Overspend, IgnoredBlock } from "@/lib/history";
import { CenterScroll } from "@/components/center-scroll";
import { HistoryGrid, type SelectGroup } from "@/components/history-grid";
import { useDetailSidebar } from "@/components/detail-sidebar";

// SelectGroup vient de HistoryGrid, à qui ce composant ne fait que passer la main.
// Le redéclarer ici l'avait déjà laissé dériver : il lui manquait les bornes de mois,
// et TypeScript ne le voyait pas tant que les champs manquants restaient optionnels.

// Le tableau de l'Historique : un clic sur un montant envoie son détail à la
// sidebar de droite, montée au niveau du shell (voir DetailSidebarProvider).
export function HistoryWithDetail(props: {
  months: string[];
  currentMonth: string;
  // Bornes de la frise (du premier mois avec des transactions de ce compte jusqu'à
  // 12 mois de projection) : ce sont les mois que le calendrier du formulaire de
  // création inline d'un groupe accepte.
  stripMin: string;
  stripMax: string;
  forecast: AccountForecast;
  sections: HistorySection[];
  // Transactions mises hors calcul, affichées en bas du tableau. Hors de sections
  // pour qu'aucun total ne puisse les récupérer.
  ignoredBlocks?: IgnoredBlock[];
  overspend: number[];
  grand: MonthCell[];
  groups: SelectGroup[];
  solde: SoldeColumn;
  planned: PlannedSoldes;
  accountId: string;
  // Dépassements groupés par mois : le bandeau d'alerte au-dessus du tableau, et
  // l'étiquette « dépassement » sur les cases concernées.
  overspendsByMonth?: Record<string, Overspend[]>;
}) {
  const { setDetail, selected, anchor } = useDetailSidebar();
  return (
    <div className="flex flex-col gap-3">
      <CenterScroll>
        <HistoryGrid {...props} onSelect={setDetail} selected={selected} anchor={anchor} />
      </CenterScroll>
    </div>
  );
}
