"use client";
import { createContext, useContext, useState } from "react";
import type { CellDetail } from "@/lib/history-explain";
import { SidebarProvider } from "@/components/ui/sidebar";
import { HistoryDetailSidebar } from "@/components/history-detail-sidebar";

// selected : case active choisie dans le panneau. anchor : montant cliqué dans le
// tableau, surligné tant que le panneau est ouvert (les deux peuvent l'être à la fois).
type Ctx = {
  detail: CellDetail | null;
  setDetail: (d: CellDetail | null) => void;
  selected: string | null;
  setSelected: (r: string | null) => void;
  anchor: string | null;
};
const DetailSidebarContext = createContext<Ctx | null>(null);

export function useDetailSidebar(): Ctx {
  const ctx = useContext(DetailSidebarContext);
  if (!ctx) throw new Error("useDetailSidebar doit être utilisé dans <DetailSidebarProvider>");
  return ctx;
}

// Sidebar de détail (à droite) montée au niveau du shell, comme la navigation de
// gauche : elle occupe sa propre colonne, donc l'en-tête et le contenu se
// rétrécissent quand elle s'ouvre. Montée dans la page, le panneau (toujours
// `fixed` sur toute la hauteur) passerait par-dessus l'en-tête et ressemblerait
// à un Sheet.
//
// Deux SidebarProvider imbriqués : shadcn n'a qu'un état par provider, il en
// faut donc un par sidebar. Celui-ci est l'extérieur (il englobe le shell de
// gauche) et il est piloté par la sélection : ouvert quand un montant est
// sélectionné, fermé sinon. Le SidebarTrigger de l'en-tête, rendu à l'intérieur
// du provider de gauche, continue de piloter la navigation.
export function DetailSidebarProvider({ children }: { children: React.ReactNode }) {
  const [detail, setDetailState] = useState<CellDetail | null>(null);
  // selected : clé de la case du tableau à surligner. selectedPanel : identité de la
  // ligne active dans le panneau. Découplés : une ligne intermédiaire surligne sa
  // case sans aussi activer la ligne « Total » (qui vise la même case).
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedPanel, setSelectedPanel] = useState<string | null>(null);
  // anchor : le montant cliqué dans le tableau (cellRef du détail). Il reste surligné
  // tant que le panneau est ouvert, en plus de la case active (selected) éventuelle.
  const [anchor, setAnchor] = useState<string | null>(null);
  // Cliquer un montant dans le tableau ouvre son détail : ce montant devient l'ancre
  // (surligné jusqu'à la fermeture) et la case active est réinitialisée. Fermer le
  // panneau (d = null) efface tout.
  const setDetail = (d: CellDetail | null) => {
    setDetailState(d);
    setAnchor(d?.cellRef ?? null);
    setSelected(null);
    setSelectedPanel(null);
  };
  const select = (cell: string | null, panel: string) => {
    setSelected(cell);
    setSelectedPanel(panel);
  };
  return (
    <DetailSidebarContext.Provider value={{ detail, setDetail, selected, setSelected, anchor }}>
      <SidebarProvider
        open={detail !== null}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
        // group/detail + data-detail : le contenu (SidebarInset) doit coller a la
        // sidebar de detail quand elle est ouverte (son p-2 fait deja l'ecart).
        // shadcn ne gere ce reglage que pour une sidebar de gauche, via un
        // selecteur `peer` qui ne remonte pas jusqu'a une sidebar placee apres.
        // h-svh + overflow-hidden : le shell tient dans l'ecran et ne defile pas.
        // C'est le contenu de la carte qui defile (voir layout), donc l'en-tete
        // reste en place et les coins arrondis restent visibles.
        className="group/detail h-svh overflow-hidden"
        data-detail={detail ? "open" : "closed"}
        style={{ "--sidebar-width": "26rem" } as React.CSSProperties}
      >
        {children}
        <HistoryDetailSidebar
          detail={detail}
          onClose={() => setDetail(null)}
          selectedPanel={selectedPanel}
          onSelectRow={select}
        />
      </SidebarProvider>
    </DetailSidebarContext.Provider>
  );
}
