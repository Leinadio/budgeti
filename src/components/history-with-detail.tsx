"use client";
import { useState } from "react";
import type { AccountForecast } from "@/lib/forecast";
import type { MonthCell, HistorySection, SoldeColumn, PlannedSoldes, Overspend, IgnoredBlock } from "@/lib/history";
import { CenterScroll } from "@/components/center-scroll";
import { HistoryGrid, type SelectGroup } from "@/components/history-grid";
import { useDetailSidebar } from "@/components/detail-sidebar";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

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
  // Mode détaillé des colonnes de solde. Ici et non dans la grille : la case doit
  // rester en place quand on fait défiler le tableau de gauche à droite, donc elle vit
  // en dehors du conteneur de défilement.
  const [showDeltas, setShowDeltas] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      {/* Ce que la case répare : dans les colonnes de solde, une case rouge veut dire
          soit « cette ligne retranche », soit « le solde est négatif », et rien ne
          distingue les deux quand ils tombent ensemble. Cochée, elle sépare les deux —
          le mouvement au-dessus, le solde signé en dessous. Le tableau y gagne en
          hauteur, ce qui est le prix à payer, d'où le choix plutôt que l'imposition. */}
      <Label className="text-muted-foreground w-fit gap-2 font-normal">
        <Checkbox checked={showDeltas} onCheckedChange={(v) => setShowDeltas(v === true)} />
        Détailler les mouvements de solde
      </Label>
      <CenterScroll>
        <HistoryGrid
          {...props}
          onSelect={setDetail}
          selected={selected}
          anchor={anchor}
          showDeltas={showDeltas}
        />
      </CenterScroll>
    </div>
  );
}
